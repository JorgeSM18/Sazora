// Arranque del servidor de Sazora: web (dist/), API con usuarios y datos, e importación con Gemini.
// Configuración por variables de entorno (ver .env.example).

import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createApp } from './app.mjs';
import { openDb } from './db.mjs';
import { importDocument } from './gemini.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const DATA = resolve(process.env.SAZORA_DATA_DIR || join(ROOT, 'server-data'));
const PORT = Number(process.env.PORT || 8787);
// Primero el modelo principal; si está saturado, los de reserva en orden.
const FALLBACKS = (process.env.GEMINI_FALLBACK_MODELS || 'gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash').split(',').map((s) => s.trim());
const MODELS = [...new Set([process.env.GEMINI_MODEL || 'gemini-3.8-flash', ...FALLBACKS].filter(Boolean))];

mkdirSync(DATA, { recursive: true });
const db = openDb(join(DATA, 'sazora.db'));

const handle = createApp({
  db,
  docsDir: join(DATA, 'documentos'),
  distDir: join(ROOT, 'dist'),
  secureCookies: process.env.COOKIE_SECURE === '1',
  importDocument: async ({ pdfBase64, catalog }) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('El servidor no tiene configurada GEMINI_API_KEY (archivo .env).');
    return importDocument({ pdfBase64, catalog, apiKey, models: MODELS, signal: AbortSignal.timeout(600_000) });
  },
});

createServer(handle).listen(PORT, () => {
  const users = db.listUsers().length;
  console.log(`Sazora escuchando en http://localhost:${PORT} · modelos: ${MODELS.join(', ')} · usuarios: ${users}`);
  if (!users) console.log('No hay usuarios. Crea uno con: npm run usuario -- crear <usuario> "<Nombre>"');
});
