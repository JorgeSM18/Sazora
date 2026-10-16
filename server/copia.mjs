// Copia de seguridad de la base de datos, segura con el servidor en marcha (VACUUM INTO).
//   npm run copia            → SAZORA_DATA_DIR/copias/sazora-AAAAMMDD-HHMMSS.db
// Conserva las últimas SAZORA_COPIAS (14 por defecto). Los PDF de documentos/ no cambian una vez
// subidos: cópialos junto con estas copias fuera de la VM (ver DESPLIEGUE.md).

import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openDb } from './db.mjs';

const DATA = resolve(process.env.SAZORA_DATA_DIR || join(import.meta.dirname, '..', 'server-data'));
const KEEP = Number(process.env.SAZORA_COPIAS || 14);
const dir = join(DATA, 'copias');
mkdirSync(dir, { recursive: true });

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const file = join(dir, `sazora-${stamp}.db`);
const db = openDb(join(DATA, 'sazora.db'));
try {
  db.backupTo(file);
  console.log(`Copia creada: ${file}`);
} finally {
  db.close();
}

const old = readdirSync(dir).filter((f) => /^sazora-\d{8}-\d{6}\.db$/.test(f)).sort().slice(0, -KEEP);
for (const f of old) rmSync(join(dir, f));
if (old.length) console.log(`Copias antiguas borradas: ${old.length}`);
