// Rutas HTTP de Sazora. Sin dependencias; se construye con sus piezas (BD, importador, carpetas)
// para poder probarla sin red. El arranque está en index.mjs.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const COOKIE = 'sazora_sesion';
const MB = 1024 * 1024;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Cabeceras de seguridad para todas las respuestas; la CSP solo para la página (no para los PDF).
const SECURITY = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", // estilos en línea de React (style={…})
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const send = (res, status, body, type = 'application/json', headers = {}) => {
  const csp = type.startsWith('text/html') ? { 'content-security-policy': CSP } : {};
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...SECURITY, ...csp, ...headers });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

async function readJson(req, maxBytes) {
  if (!String(req.headers['content-type']).startsWith('application/json')) throw new HttpError(415, 'Se esperaba JSON.');
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > maxBytes) throw new HttpError(413, 'La petición es demasiado grande.');
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON no válido.');
  }
}

const cookieToken = (req) =>
  String(req.headers.cookie ?? '')
    .split(';')
    .map((c) => c.trim().split('='))
    .find(([k]) => k === COOKIE)?.[1];

/**
 * @param {object} deps
 * @param {ReturnType<import('./db.mjs').openDb>} deps.db
 * @param {(input: { pdfBase64: string, catalog: {id: string, name: string}[] }) => Promise<object>} deps.importDocument
 * @param {string} deps.docsDir  carpeta de PDF importados (una subcarpeta por usuario)
 * @param {string} deps.distDir  web compilada
 * @param {boolean} [deps.secureCookies]
 */
export function createApp({ db, importDocument, docsDir, distDir, secureCookies = false }) {
  const attempts = new Map(); // límite de intentos de login: clave → { n, until }
  const importing = new Set(); // una importación a la vez por usuario (cada una cuesta llamadas a Gemini)

  const sessionCookie = (token, maxAge, req) =>
    [`${COOKIE}=${token}`, 'HttpOnly', 'SameSite=Strict', 'Path=/', `Max-Age=${maxAge}`, ...(secureCookies || req.headers['x-forwarded-proto'] === 'https' ? ['Secure'] : [])].join('; ');

  function requireUser(req) {
    const user = db.userForSession(cookieToken(req));
    if (!user) throw new HttpError(401, 'Inicia sesión para continuar.');
    return user;
  }

  async function login(req, res) {
    const { username, password } = await readJson(req, 10_000);
    if (String(username ?? '').length > 64 || String(password ?? '').length > 256) throw new HttpError(400, 'Usuario o contraseña demasiado largos.');
    const key = `${req.socket.remoteAddress}|${String(username).toLowerCase()}`;
    const now = Date.now();
    if (attempts.size > 1000) for (const [k, v] of attempts) if (v.until <= now) attempts.delete(k);
    const a = attempts.get(key);
    if (a && a.n >= 5 && a.until > now) throw new HttpError(429, 'Demasiados intentos. Espera unos minutos.');
    const user = db.authenticate(String(username ?? ''), String(password ?? ''));
    if (!user) {
      attempts.set(key, { n: (a && a.until > now ? a.n : 0) + 1, until: now + 10 * 60_000 });
      throw new HttpError(401, 'Usuario o contraseña incorrectos.');
    }
    attempts.delete(key);
    const { token, maxAge } = db.createSession(user.id);
    send(res, 200, { user }, 'application/json', { 'set-cookie': sessionCookie(token, maxAge, req) });
  }

  async function importPdf(req, res, user) {
    if (importing.has(user.id)) throw new HttpError(429, 'Ya hay una importación en curso. Espera a que termine.');
    importing.add(user.id);
    try {
      await importPdfFor(req, res, user);
    } finally {
      importing.delete(user.id);
    }
  }

  async function importPdfFor(req, res, user) {
    const input = await readJson(req, 60 * MB);
    const pdf = Buffer.from(String(input.pdfBase64 ?? ''), 'base64');
    if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new HttpError(400, 'El archivo no es un PDF.');
    const catalog = Array.isArray(input.catalog) ? input.catalog.slice(0, 3000).map((f) => ({ id: String(f.id), name: String(f.name) })) : [];
    // El original se guarda en la carpeta del usuario para poder consultarlo desde la app.
    const sha = createHash('sha256').update(pdf).digest('hex').slice(0, 16);
    const dir = join(docsDir, String(user.id));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${sha}.pdf`), pdf);
    try {
      const result = await importDocument({ pdfBase64: pdf.toString('base64'), catalog });
      send(res, 200, { ...result, document: { id: `pdf-${sha}`, url: `/api/documentos/${sha}.pdf` } });
    } catch (e) {
      const timeout = e?.name === 'TimeoutError';
      send(res, e?.busy ? 503 : 502, { error: timeout ? 'Gemini ha tardado demasiado. Inténtalo de nuevo.' : e.message, retryable: timeout || !!e?.busy });
    }
  }

  async function serveFile(res, file, fallback) {
    try {
      send(res, 200, await readFile(file), TYPES[extname(file)] ?? 'application/octet-stream', { 'cache-control': 'private, max-age=0' });
    } catch {
      // Ruta desconocida: la propia app muestra su página 404, con el código HTTP correcto.
      if (fallback) return send(res, 404, await readFile(fallback).catch(() => 'No encontrado'), 'text/html; charset=utf-8');
      send(res, 404, { error: 'No encontrado.' });
    }
  }

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const route = `${req.method} ${url.pathname}`;
    try {
      if (route === 'POST /api/sesion') return await login(req, res);
      if (route === 'DELETE /api/sesion') {
        db.deleteSession(cookieToken(req));
        return send(res, 200, { ok: true }, 'application/json', { 'set-cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
      }
      if (route === 'GET /api/sesion') return send(res, 200, { user: requireUser(req) });

      if (route === 'GET /api/datos') return send(res, 200, db.getData(requireUser(req).id));
      if (route === 'PUT /api/datos') {
        const user = requireUser(req);
        const { data, version } = await readJson(req, 20 * MB);
        if (typeof data !== 'object' || data === null || !Number.isInteger(version)) throw new HttpError(400, 'Faltan los datos o la versión.');
        const r = db.putData(user.id, data, version);
        return send(res, r.conflict ? 409 : 200, r);
      }
      if (route === 'POST /api/importar') return await importPdf(req, res, requireUser(req));

      const doc = url.pathname.match(/^\/api\/documentos\/([a-f0-9]{16})\.pdf$/);
      if (req.method === 'GET' && doc) return await serveFile(res, join(docsDir, String(requireUser(req).id), `${doc[1]}.pdf`));
      if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'Ruta no encontrada.');

      // Web estática. normalize + comprobación evitan salir de dist/ con "../".
      let decoded;
      try {
        decoded = decodeURIComponent(url.pathname);
      } catch {
        throw new HttpError(400, 'Dirección no válida.');
      }
      const path = normalize(decoded).replace(/^([/\\])+/, '');
      const file = join(distDir, path || 'index.html');
      if (file !== distDir && !file.startsWith(distDir + sep)) throw new HttpError(403, 'Prohibido.');
      return await serveFile(res, file, join(distDir, 'index.html'));
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error(e);
      send(res, 500, { error: 'Error interno.' });
    }
  };
}
