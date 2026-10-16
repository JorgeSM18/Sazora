import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.mjs';
import { openDb } from './db.mjs';

let server, base, dir, db;
const imports = [];

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sazora-test-'));
  await mkdir(join(dir, 'dist'));
  await writeFile(join(dir, 'dist', 'index.html'), '<!doctype html><title>Sazora</title>');
  db = openDb(':memory:');
  db.createUser('ana', 'Ana', 'contraseña-ana');
  db.createUser('luis', 'Luis', 'contraseña-luis');
  const handle = createApp({
    db,
    docsDir: join(dir, 'documentos'),
    distDir: join(dir, 'dist'),
    importDocument: async (input) => {
      imports.push(input);
      return { kind: 'pauta', foodList: null, plan: { plan_name: 'P' }, model: 'falso' };
    },
  });
  server = createServer(handle);
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});

afterAll(async () => {
  server.close();
  db.close();
  await rm(dir, { recursive: true, force: true });
});

const json = (method, body, cookie) => ({
  method,
  headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
async function login(username, password) {
  const r = await fetch(`${base}/api/sesion`, json('POST', { username, password }));
  return { status: r.status, cookie: r.headers.get('set-cookie')?.split(';')[0], body: await r.json() };
}
const PDF = Buffer.from('%PDF-1.4 prueba').toString('base64');

describe('sesiones', () => {
  it('sin sesión no hay datos', async () => {
    expect((await fetch(`${base}/api/datos`)).status).toBe(401);
  });

  it('contraseña incorrecta: mensaje genérico, sin revelar si existe el usuario', async () => {
    const a = await login('ana', 'mala');
    const b = await login('nadie', 'mala');
    expect(a.status).toBe(401);
    expect(a.body.error).toBe(b.body.error);
  });

  it('limita los intentos fallidos', async () => {
    for (let i = 0; i < 5; i++) await login('luis', 'mala');
    expect((await login('luis', 'mala')).status).toBe(429);
  });

  it('inicia sesión con cookie HttpOnly y la cierra', async () => {
    const { status, cookie, body } = await login('ana', 'contraseña-ana');
    expect(status).toBe(200);
    expect(body.user).toMatchObject({ username: 'ana', name: 'Ana' });
    const raw = (await fetch(`${base}/api/sesion`, json('POST', { username: 'ana', password: 'contraseña-ana' }))).headers.get('set-cookie');
    expect(raw).toMatch(/HttpOnly/);
    expect(raw).toMatch(/SameSite=Strict/);
    expect((await (await fetch(`${base}/api/sesion`, { headers: { cookie } })).json()).user.username).toBe('ana');
    await fetch(`${base}/api/sesion`, { method: 'DELETE', headers: { cookie } });
    expect((await fetch(`${base}/api/sesion`, { headers: { cookie } })).status).toBe(401);
  });
});

describe('registro con código de invitación', () => {
  async function withApp(registrationCode, fn) {
    const s = createServer(createApp({ db, docsDir: join(dir, 'documentos'), distDir: join(dir, 'dist'), importDocument: async () => ({}), registrationCode }));
    await new Promise((r) => s.listen(0, r));
    try {
      await fn(`http://localhost:${s.address().port}`);
    } finally {
      s.close();
    }
  }
  const register = (url, body) => fetch(`${url}/api/registro`, json('POST', body));

  it('sin código configurado, el registro está desactivado', async () => {
    await withApp(undefined, async (url) => {
      expect(await (await fetch(`${url}/api/registro`)).json()).toEqual({ enabled: false });
      expect((await register(url, { username: 'x', name: 'X', password: 'contraseña-x', code: '' })).status).toBe(403);
    });
  });

  it('con el código correcto crea la cuenta e inicia sesión', async () => {
    await withApp('codigo-secreto-123', async (url) => {
      expect(await (await fetch(`${url}/api/registro`)).json()).toEqual({ enabled: true });
      const r = await register(url, { username: 'marta', name: 'Marta', password: 'contraseña-marta', code: 'codigo-secreto-123' });
      expect(r.status).toBe(201);
      expect((await r.json()).user).toMatchObject({ username: 'marta', name: 'Marta' });
      const cookie = r.headers.get('set-cookie').split(';')[0];
      expect((await fetch(`${url}/api/datos`, { headers: { cookie } })).status).toBe(200);
      // Usuario repetido y contraseña corta: errores claros.
      expect((await register(url, { username: 'marta', name: 'M', password: 'contraseña-2', code: 'codigo-secreto-123' })).status).toBe(409);
      expect(await (await register(url, { username: 'otra', name: 'O', password: 'corta', code: 'codigo-secreto-123' })).json()).toMatchObject({ error: expect.stringMatching(/8 caracteres/) });
    });
  });

  it('un código incorrecto no crea nada y se bloquea tras varios intentos', async () => {
    await withApp('codigo-secreto-123', async (url) => {
      const bad = { username: 'intruso', name: 'I', password: 'contraseña-i', code: 'adivina' };
      for (let i = 0; i < 5; i++) expect((await register(url, bad)).status).toBe(403);
      expect((await register(url, bad)).status).toBe(429);
      expect(db.listUsers().some((u) => u.username === 'intruso')).toBe(false);
    });
  });
});

describe('datos por usuario', () => {
  it('cada usuario tiene los suyos y los conflictos entre dispositivos no se pisan', async () => {
    const ana = (await login('ana', 'contraseña-ana')).cookie;
    db.createUser('eva', 'Eva', 'contraseña-eva');
    const eva = (await login('eva', 'contraseña-eva')).cookie;

    expect(await (await fetch(`${base}/api/datos`, { headers: { cookie: ana } })).json()).toEqual({ data: null, version: 0 });
    const first = await fetch(`${base}/api/datos`, json('PUT', { data: { mio: 'ana' }, version: 0 }, ana));
    expect(await first.json()).toMatchObject({ conflict: false, version: 1 });

    // Otro dispositivo con una versión antigua: 409 con lo último guardado.
    const stale = await fetch(`${base}/api/datos`, json('PUT', { data: { mio: 'viejo' }, version: 0 }, ana));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ conflict: true, version: 1, data: { mio: 'ana' } });

    expect((await (await fetch(`${base}/api/datos`, json('PUT', { data: { mio: 'ana 2' }, version: 1 }, ana))).json()).version).toBe(2);
    expect(await (await fetch(`${base}/api/datos`, { headers: { cookie: eva } })).json()).toEqual({ data: null, version: 0 });
  });

  it('rechaza datos mal formados', async () => {
    const ana = (await login('ana', 'contraseña-ana')).cookie;
    expect((await fetch(`${base}/api/datos`, json('PUT', { data: 'x' }, ana))).status).toBe(400);
    expect((await fetch(`${base}/api/datos`, { method: 'PUT', headers: { cookie: ana, 'content-type': 'text/plain' }, body: '{}' })).status).toBe(415);
  });
});

describe('importación y documentos', () => {
  it('importa con sesión, guarda el PDF y solo su dueño puede abrirlo', async () => {
    const ana = (await login('ana', 'contraseña-ana')).cookie;
    db.createUser('pepe', 'Pepe', 'contraseña-pepe');
    const otro = (await login('pepe', 'contraseña-pepe')).cookie;

    expect((await fetch(`${base}/api/importar`, json('POST', { pdfBase64: PDF, catalog: [] }))).status).toBe(401);
    expect((await fetch(`${base}/api/importar`, json('POST', { pdfBase64: Buffer.from('hola').toString('base64') }, ana))).status).toBe(400);

    const r = await fetch(`${base}/api/importar`, json('POST', { pdfBase64: PDF, catalog: [{ id: 'arroz', name: 'Arroz' }] }, ana));
    const body = await r.json();
    expect(body).toMatchObject({ kind: 'pauta', plan: { plan_name: 'P' }, model: 'falso' });
    expect(imports.at(-1).catalog).toEqual([{ id: 'arroz', name: 'Arroz' }]);

    const own = await fetch(`${base}${body.document.url}`, { headers: { cookie: ana } });
    expect(own.status).toBe(200);
    expect(own.headers.get('content-type')).toBe('application/pdf');
    expect((await fetch(`${base}${body.document.url}`, { headers: { cookie: otro } })).status).toBe(404);
    expect((await fetch(`${base}${body.document.url}`)).status).toBe(401);
  });

  it('un error temporal de Gemini llega como reintentable', async () => {
    const busyApp = createApp({ db, docsDir: join(dir, 'documentos'), distDir: join(dir, 'dist'), importDocument: async () => { throw Object.assign(new Error('Gemini está saturado'), { busy: true }); } });
    const s = createServer(busyApp);
    await new Promise((r) => s.listen(0, r));
    const url = `http://localhost:${s.address().port}`;
    const { token } = db.createSession(db.listUsers()[0].id);
    const r = await fetch(`${url}/api/importar`, json('POST', { pdfBase64: PDF, catalog: [] }, `sazora_sesion=${token}`));
    s.close();
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ retryable: true, error: expect.stringMatching(/saturado/) });
  });
});

describe('endurecimiento', () => {
  it('envía cabeceras de seguridad y CSP solo en la página', async () => {
    const page = await fetch(`${base}/`);
    expect(page.headers.get('x-content-type-options')).toBe('nosniff');
    expect(page.headers.get('x-frame-options')).toBe('DENY');
    expect(page.headers.get('content-security-policy')).toMatch(/frame-ancestors 'none'/);
    const api = await fetch(`${base}/api/datos`);
    expect(api.headers.get('content-security-policy')).toBeNull();
    expect(api.headers.get('cache-control')).toBe('no-store');
  });

  it('rechaza direcciones mal codificadas y credenciales desmesuradas', async () => {
    expect((await fetch(`${base}/%E0%A4%A`)).status).toBe(400);
    expect((await login('a'.repeat(100), 'x')).status).toBe(400);
  });

  it('solo permite una importación a la vez por usuario', async () => {
    let release;
    const slow = createApp({ db, docsDir: join(dir, 'documentos'), distDir: join(dir, 'dist'), importDocument: () => new Promise((r) => { release = () => r({ kind: 'otro', foodList: null, plan: null, model: 'm' }); }) });
    const s = createServer(slow);
    await new Promise((r) => s.listen(0, r));
    const url = `http://localhost:${s.address().port}/api/importar`;
    const { token } = db.createSession(db.listUsers()[0].id);
    const first = fetch(url, json('POST', { pdfBase64: PDF, catalog: [] }, `sazora_sesion=${token}`));
    await new Promise((r) => setTimeout(r, 50));
    const second = await fetch(url, json('POST', { pdfBase64: PDF, catalog: [] }, `sazora_sesion=${token}`));
    expect(second.status).toBe(429);
    release();
    expect((await first).status).toBe(200);
    s.close();
  });
});

describe('web estática', () => {
  it('sirve la app y responde 404 en rutas desconocidas sin salir de dist/', async () => {
    expect((await fetch(`${base}/`)).status).toBe(200);
    const unknown = await fetch(`${base}/no-existe`);
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toContain('Sazora');
    expect(await (await fetch(`${base}/..%2f..%2fpackage.json`)).text()).not.toContain('"name"');
    expect((await fetch(`${base}/api/nada`, { headers: {} })).status).toBe(404);
  });
});
