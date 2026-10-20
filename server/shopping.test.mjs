import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.mjs';
import { openDb } from './db.mjs';

let server, base, dir, db;
const cookies = {};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sazora-compra-'));
  db = openDb(':memory:');
  for (const [u, n] of [['ana', 'Ana'], ['pareja', 'Pareja'], ['ajeno', 'Ajeno']]) {
    const user = db.createUser(u, n, `contraseña-${u}`);
    cookies[u] = `sazora_sesion=${db.createSession(user.id).token}`;
  }
  server = createServer(createApp({ db, docsDir: join(dir, 'd'), distDir: join(dir, 'dist'), importDocument: async () => ({}) }));
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}/api/listas`;
});

afterAll(async () => {
  server.closeAllConnections?.();
  server.close();
  db.close();
  await rm(dir, { recursive: true, force: true });
});

const api = async (who, method, path = '', body) => {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { cookie: cookies[who], ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body && JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

/** Abre el canal de eventos y devuelve una función que espera al siguiente snapshot que cumpla `pred`. */
async function listen(who, listId) {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/${listId}/eventos`, { headers: { cookie: cookies[who] }, signal: ctrl.signal });
  expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const next = async (pred) => {
    for (;;) {
      const events = buffer.split('\n\n');
      buffer = events.pop();
      for (const e of events) {
        const data = e.split('\n').find((l) => l.startsWith('data: '));
        if (data) {
          const snap = JSON.parse(data.slice(6));
          if (pred(snap)) return snap;
        }
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('El canal se cerró');
      buffer += decoder.decode(value, { stream: true });
    }
  };
  return { next, close: () => ctrl.abort() };
}

describe('lista de la compra compartida', () => {
  let listId;

  it('crea una lista y la comparte con otro usuario', async () => {
    const created = await api('ana', 'POST', '', { name: 'Casa' });
    expect(created.status).toBe(201);
    listId = created.body.list.id;
    expect((await api('pareja', 'GET', `/${listId}`)).status).toBe(404); // aún no es miembro
    expect((await api('ana', 'POST', `/${listId}/miembros`, { username: 'nadie' })).status).toBe(404);
    const shared = await api('ana', 'POST', `/${listId}/miembros`, { username: 'pareja' });
    expect(shared.body.list.members.map((m) => m.username)).toEqual(['ana', 'pareja']);
    expect((await api('pareja', 'GET')).body.lists.map((l) => l.name)).toEqual(['Casa']);
  });

  it('los cambios de uno llegan al otro en tiempo real', async () => {
    const stream = await listen('pareja', listId);
    await stream.next((s) => s.items.length === 0); // estado inicial

    await api('ana', 'POST', `/${listId}/items`, { items: [{ text: 'Arroz', quantity: '500 g', category: 'Carbohidratos' }, { text: 'Kiwis', quantity: '6' }] });
    const afterAdd = await stream.next((s) => s.items.length === 2);
    expect(afterAdd.items.map((i) => [i.text, i.quantity, i.checked])).toEqual([['Arroz', '500 g', false], ['Kiwis', '6', false]]);

    const kiwi = afterAdd.items[1].id;
    await api('ana', 'PATCH', `/${listId}/items/${kiwi}`, { checked: true });
    const afterCheck = await stream.next((s) => s.items.some((i) => i.id === kiwi && i.checked));
    expect(afterCheck.items.at(-1).text).toBe('Kiwis'); // los comprados, al final

    await api('ana', 'POST', `/${listId}/limpiar`);
    const afterClear = await stream.next((s) => s.items.length === 1);
    expect(afterClear.items[0].text).toBe('Arroz');
    stream.close();
  });

  it('un artículo borrado por otra persona da un error claro', async () => {
    const { body } = await api('pareja', 'GET', `/${listId}`);
    const id = body.items[0].id;
    expect((await api('pareja', 'DELETE', `/${listId}/items/${id}`)).status).toBe(200);
    expect((await api('ana', 'PATCH', `/${listId}/items/${id}`, { checked: true })).status).toBe(404);
  });

  it('quien no es miembro no ve ni modifica la lista', async () => {
    expect((await api('ajeno', 'GET', `/${listId}`)).status).toBe(404);
    expect((await api('ajeno', 'POST', `/${listId}/items`, { items: [{ text: 'X' }] })).status).toBe(404);
    expect((await fetch(`${base}/${listId}/eventos`, { headers: { cookie: cookies.ajeno } })).status).toBe(404);
    expect((await fetch(base)).status).toBe(401);
  });

  it('valida y limita lo que se añade', async () => {
    expect((await api('ana', 'POST', `/${listId}/items`, { items: [{ text: '   ' }] })).status).toBe(400);
    const long = await api('ana', 'POST', `/${listId}/items`, { items: [{ text: 'x'.repeat(500) }] });
    expect(long.body.items.at(-1).text).toHaveLength(200);
  });

  it('crear la lista por defecto dos veces a la vez no la duplica', async () => {
    const [a, b] = await Promise.all([api('ajeno', 'POST', '', { name: 'Lista', ifNone: true }), api('ajeno', 'POST', '', { name: 'Lista', ifNone: true })]);
    expect(a.body.list.id).toBe(b.body.list.id);
    expect((await api('ajeno', 'GET')).body.lists).toHaveLength(1);
  });

  it('al salir el último miembro, la lista desaparece', async () => {
    await api('pareja', 'DELETE', `/${listId}/miembros/yo`);
    expect((await api('pareja', 'GET')).body.lists).toEqual([]);
    expect((await api('ana', 'GET', `/${listId}`)).status).toBe(200);
    await api('ana', 'DELETE', `/${listId}/miembros/yo`);
    expect(db.shopping.snapshot(listId)).toBeNull();
  });
});
