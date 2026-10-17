// Rutas HTTP de Sazora. Sin dependencias; se construye con sus piezas (BD, importador, carpetas)
// para poder probarla sin red. El arranque está en index.mjs.

import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const COOKIE = 'sazora_sesion';
const MB = 1024 * 1024;
const TYPES = { '.webmanifest': 'application/manifest+json', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };

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
 * @param {string} [deps.registrationCode]  código de invitación; sin él, el registro está desactivado
 */
export function createApp({ db, importDocument, docsDir, distDir, secureCookies = false, registrationCode }) {
  const attempts = new Map(); // intentos fallidos (login, registro): clave → { n, until }
  const MAX_FAILS = 5;
  const WINDOW = 10 * 60_000;
  const blocked = (key, now = Date.now()) => {
    if (attempts.size > 1000) for (const [k, v] of attempts) if (v.until <= now) attempts.delete(k);
    const a = attempts.get(key);
    return !!a && a.n >= MAX_FAILS && a.until > now;
  };
  const fail = (key, now = Date.now()) => {
    const a = attempts.get(key);
    attempts.set(key, { n: (a && a.until > now ? a.n : 0) + 1, until: now + WINDOW });
  };
  const sameSecret = (a, b) => timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());
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
    const key = `login|${req.socket.remoteAddress}|${String(username).toLowerCase()}`;
    if (blocked(key)) throw new HttpError(429, 'Demasiados intentos. Espera unos minutos.');
    const user = db.authenticate(String(username ?? ''), String(password ?? ''));
    if (!user) {
      fail(key);
      throw new HttpError(401, 'Usuario o contraseña incorrectos.');
    }
    attempts.delete(key);
    startSession(res, req, user, 200);
  }

  function startSession(res, req, user, status) {
    const { token, maxAge } = db.createSession(user.id);
    send(res, status, { user }, 'application/json', { 'set-cookie': sessionCookie(token, maxAge, req) });
  }

  /** Alta de usuario con el código de invitación del servidor. Sin código configurado, desactivado. */
  async function register(req, res) {
    if (!registrationCode) throw new HttpError(403, 'El registro está desactivado. Pide que te creen el usuario en el servidor.');
    const { username, name, password, code } = await readJson(req, 10_000);
    if (String(name ?? '').length > 80 || String(password ?? '').length > 256 || String(code ?? '').length > 256) throw new HttpError(400, 'Algún dato es demasiado largo.');
    const key = `registro|${req.socket.remoteAddress}`;
    if (blocked(key)) throw new HttpError(429, 'Demasiados intentos. Espera unos minutos.');
    if (!sameSecret(code ?? '', registrationCode)) {
      fail(key);
      throw new HttpError(403, 'El código de invitación no es correcto.');
    }
    let user;
    try {
      user = db.createUser(String(username ?? '').trim(), String(name ?? '').trim(), String(password ?? ''));
    } catch (e) {
      throw new HttpError(String(e.message).includes('UNIQUE') ? 409 : 400, String(e.message).includes('UNIQUE') ? 'Ese usuario ya existe.' : e.message);
    }
    attempts.delete(key);
    startSession(res, req, user, 201);
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

  // ── Listas de la compra compartidas ─────────────────────
  const shop = db.shopping;
  /** Conexiones en tiempo real (Server-Sent Events) por lista. */
  const listeners = new Map(); // listId → Set<{ res, userId }>

  function broadcast(listId) {
    const subs = listeners.get(listId);
    if (!subs?.size) return;
    const snap = shop.snapshot(listId);
    for (const s of [...subs]) {
      // Si ya no es miembro (o la lista no existe), se corta su conexión.
      if (!snap || !shop.isMember(listId, s.userId)) {
        s.res.end();
        subs.delete(s);
        continue;
      }
      s.res.write(`event: lista\ndata: ${JSON.stringify(snap)}\n\n`);
    }
  }

  function requireMember(listId, user) {
    if (!shop.isMember(listId, user.id)) throw new HttpError(404, 'Lista no encontrada.');
  }

  function subscribe(req, res, listId, user) {
    requireMember(listId, user);
    res.writeHead(200, { ...SECURITY, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(`retry: 3000\nevent: lista\ndata: ${JSON.stringify(shop.snapshot(listId))}\n\n`);
    const sub = { res, userId: user.id };
    if (!listeners.has(listId)) listeners.set(listId, new Set());
    listeners.get(listId).add(sub);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(ping);
      listeners.get(listId)?.delete(sub);
    });
  }

  async function shopping(req, res, url, user) {
    const m = url.pathname.match(/^\/api\/listas(?:\/([0-9a-f-]{36}))?(?:\/(miembros|items|limpiar|eventos))?(?:\/([0-9a-f-]{36}|yo))?$/);
    if (!m) throw new HttpError(404, 'Ruta no encontrada.');
    const [, listId, sub, itemId] = m;
    const route = `${req.method} ${listId ? ':lista' : ''}${sub ? `/${sub}` : ''}${itemId ? '/:id' : ''}`;
    const reply = (status = 200) => send(res, status, shop.snapshot(listId));
    const changed = (status = 200) => {
      broadcast(listId);
      reply(status);
    };
    const body = () => readJson(req, 200_000);
    const fail = (e) => {
      throw new HttpError(400, e.message);
    };

    if (route === 'GET ') return send(res, 200, { lists: shop.listsFor(user.id) });
    if (route === 'POST ') {
      const { name, ifNone } = await body();
      let id;
      try {
        id = shop.createList(user.id, name, { ifNone: ifNone === true });
      } catch (e) {
        fail(e);
      }
      return send(res, 201, shop.snapshot(id));
    }
    requireMember(listId, user);
    if (route === 'GET :lista/eventos') return subscribe(req, res, listId, user);
    if (route === 'GET :lista') return reply();
    if (route === 'PATCH :lista') {
      shop.rename(listId, (await body()).name);
      return changed();
    }
    if (route === 'POST :lista/miembros') {
      const added = shop.addMember(listId, (await body()).username);
      if (!added) throw new HttpError(404, 'No existe ningún usuario con ese nombre.');
      return changed();
    }
    if (route === 'DELETE :lista/miembros/:id' && itemId === 'yo') {
      shop.leave(listId, user.id);
      broadcast(listId);
      return send(res, 200, { ok: true });
    }
    if (route === 'POST :lista/items') {
      try {
        shop.addItems(listId, user.id, (await body()).items);
      } catch (e) {
        fail(e);
      }
      return changed(201);
    }
    if (route === 'PATCH :lista/items/:id') {
      const { text, quantity, checked } = await body();
      if (!shop.updateItem(listId, itemId, { text, quantity, checked })) throw new HttpError(404, 'Ese artículo ya no está en la lista.');
      return changed();
    }
    if (route === 'DELETE :lista/items/:id') {
      shop.deleteItem(listId, itemId);
      return changed();
    }
    if (route === 'POST :lista/limpiar') {
      shop.clearChecked(listId);
      return changed();
    }
    throw new HttpError(404, 'Ruta no encontrada.');
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
      if (route === 'GET /api/registro') return send(res, 200, { enabled: !!registrationCode });
      if (route === 'POST /api/registro') return await register(req, res);
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
      if (url.pathname === '/api/listas' || url.pathname.startsWith('/api/listas/')) return await shopping(req, res, url, requireUser(req));

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
