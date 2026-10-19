import { describe, expect, it } from 'vitest';
import { buildConversionRequest, buildListRequest, buildPlanRequest, buildNutritionRequest, buildProductsRequest, CONVERSION_SCHEMA, generate, GROUPS, importDocument, LIST_SCHEMA, listCatalog, parseResponse, PLAN_SCHEMA, postJson, PRODUCTS_SCHEMA, slug } from './gemini.mjs';

const output = (obj) => ({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(obj) }] }] });
const reply = (status, body) => ({ ok: status === 200, status, statusText: '', json: async () => body });
const busy = reply(503, { error: { message: 'high demand' } });

/** fetch simulado: devuelve las respuestas en orden y guarda los cuerpos enviados. */
function fakeFetch(responses) {
  const sent = [];
  const fetchImpl = async (_url, init) => {
    sent.push(JSON.parse(init.body));
    return responses.shift();
  };
  return { sent, fetchImpl };
}
const opts = (fetchImpl, extra = {}) => ({ apiKey: 'k', models: ['a'], fetchImpl, wait: async () => {}, log: () => {}, ...extra });

describe('peticiones', () => {
  it('pauta: PDF en línea, catálogo y esquema JSON', () => {
    const body = buildPlanRequest({ pdfBase64: 'QUJD', catalog: [{ id: 'arroz', name: 'Arroz' }], model: 'm' });
    expect(body.model).toBe('m');
    expect(body.input[0]).toEqual({ type: 'document', data: 'QUJD', mime_type: 'application/pdf' });
    expect(body.input[1].text).toContain('arroz: Arroz');
    expect(body.response_format.schema).toBe(PLAN_SCHEMA);
    expect(body.system_instruction).toMatch(/No inventes/);
  });

  it('lista: clasifica y usa su propio esquema', () => {
    const body = buildListRequest({ pdfBase64: 'QUJD', model: 'm' });
    expect(body.response_format.schema).toBe(LIST_SCHEMA);
    expect(LIST_SCHEMA.properties.contains.required).toEqual(['lista', 'pauta', 'conversion', 'productos']);
    expect(buildConversionRequest({ pdfBase64: 'x', catalog: [{ id: 'arroz', name: 'Arroz' }], model: 'm' }).response_format.schema).toBe(CONVERSION_SCHEMA);
    expect(buildConversionRequest({ pdfBase64: 'x', catalog: [{ id: 'arroz', name: 'Arroz' }], model: 'm' }).input[1].text).toContain('arroz: Arroz');
    expect(buildProductsRequest({ pdfBase64: 'x', model: 'm' }).response_format.schema).toBe(PRODUCTS_SCHEMA);
    expect(PLAN_SCHEMA.properties.daily_totals.required).toEqual(GROUPS);
  });

  it('el catálogo de una lista usa los mismos ids que la app', () => {
    expect(slug('Plátano macho')).toBe('platano-macho');
    expect(listCatalog({ groups: [{ items: [{ name: 'Harina de maíz (pan)' }] }] })).toEqual([{ id: 'harina-de-maiz-pan', name: 'Harina de maíz (pan)' }]);
    expect(listCatalog(null)).toEqual([]);
  });
});

describe('datos nutricionales', () => {
  it('pide búsqueda de Google y respuesta JSON, con marca y estado de cada alimento', () => {
    const r = buildNutritionRequest({ model: 'm', foods: [{ id: 'yogur-1', name: 'Yogur proteico', brand: 'Mercadona', state: 'listo' }, { id: 'arroz', name: 'Arroz' }] });
    expect(r.tools).toEqual([{ type: 'google_search' }]);
    expect(r.response_format.mime_type).toBe('application/json');
    expect(r.input[0].text).toContain('yogur-1: Yogur proteico (Mercadona) [listo]');
    expect(r.input[0].text).toContain('arroz: Arroz\n'.trim());
  });
});

describe('respuestas', () => {
  it('lee el JSON del paso model_output', () => {
    expect(parseResponse(output({ plan_name: 'X' }))).toEqual({ plan_name: 'X' });
  });

  it('da errores legibles', () => {
    expect(() => parseResponse({ status: 'incomplete' })).toThrow(/cortada/);
    expect(() => parseResponse({ status: 'failed', errors: [{ message: 'cuota' }] })).toThrow(/cuota/);
    expect(() => parseResponse({ status: 'completed', steps: [] })).toThrow(/no devolvió/);
    expect(() => parseResponse({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: '{roto' }] }] })).toThrow(/JSON/);
  });
});

describe('reintentos y modelos de reserva', () => {
  const build = (model) => ({ model });

  it('reintenta cuando Gemini está saturado y acaba funcionando', async () => {
    const f = fakeFetch([busy, reply(200, output({ ok: 1 }))]);
    const waits = [];
    await expect(generate({ ...opts(f.fetchImpl, { wait: async (ms) => waits.push(ms) }), build })).resolves.toEqual({ result: { ok: 1 }, model: 'a' });
    expect(waits).toEqual([2000]);
  });

  it('pasa al modelo de reserva y salta los que ya no existen', async () => {
    const f = fakeFetch([busy, busy, reply(404, { error: { message: 'no longer available' } }), reply(200, output({ ok: 1 }))]);
    await expect(generate({ ...opts(f.fetchImpl, { models: ['a', 'viejo', 'c'] }), build })).resolves.toMatchObject({ model: 'c' });
    expect(f.sent.map((b) => b.model)).toEqual(['a', 'a', 'viejo', 'c']);
  });

  it('si todo sigue saturado, da un error claro y reintentable', async () => {
    const f = fakeFetch([busy, busy]);
    await expect(generate({ ...opts(f.fetchImpl), build })).rejects.toMatchObject({ busy: true, message: expect.stringMatching(/saturado/) });
  });

  it('cuota diaria agotada: no reintenta ese modelo y, si no queda ninguno, lo dice claramente', async () => {
    const quota = reply(429, { error: { message: 'Rate limit exceeded for model a (limit: 20 requests per day on Free Tier). Please retry in 6h25m20.5s or upgrade your tier.' } });
    const f = fakeFetch([quota, quota]);
    const waits = [];
    await expect(generate({ ...opts(f.fetchImpl, { models: ['a', 'b'], wait: async (ms) => waits.push(ms) }), build })).rejects.toMatchObject({
      quota: true,
      busy: false,
      message: expect.stringMatching(/cuota de Gemini.*se libera en 6h25m20s/),
    });
    expect(f.sent.map((b) => b.model)).toEqual(['a', 'b']);
    expect(waits).toEqual([]);
  });

  it('un 429 de cuota sin detalles tampoco se reintenta; uno por minuto sí', async () => {
    const quota = reply(429, { error: { message: 'You exceeded your current quota, please check your plan and billing details.' } });
    const f = fakeFetch([quota]);
    await expect(generate({ ...opts(f.fetchImpl), build })).rejects.toMatchObject({ quota: true, message: expect.stringMatching(/más tarde/) });
    expect(f.sent).toHaveLength(1);

    const perMinute = reply(429, { error: { message: 'Quota exceeded: requests per minute.' } });
    const g = fakeFetch([perMinute, reply(200, output({ ok: 1 }))]);
    await expect(generate({ ...opts(g.fetchImpl), build })).resolves.toMatchObject({ result: { ok: 1 } });
  });

  it('una conexión cortada da un error legible y no se reintenta', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }); };
    await expect(generate({ ...opts(fetchImpl), build })).rejects.toMatchObject({ message: expect.stringMatching(/Se perdió la conexión con Gemini \(ECONNRESET\)/) });
    expect(calls).toBe(1);
  });

  it('postJson envía el JSON y lee la respuesta sin el límite de 300 s de fetch', async () => {
    const { createServer } = await import('node:http');
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => { res.writeHead(201, { 'content-type': 'application/json' }); res.end(JSON.stringify({ got: JSON.parse(body), key: req.headers['x-goog-api-key'] })); });
    });
    await new Promise((r) => server.listen(0, r));
    try {
      const res = await postJson(`http://127.0.0.1:${server.address().port}/`, { headers: { 'content-type': 'application/json', 'x-goog-api-key': 'k' }, body: JSON.stringify({ ñ: 'á' }) });
      expect(res).toMatchObject({ ok: true, status: 201 });
      expect(await res.json()).toEqual({ got: { ñ: 'á' }, key: 'k' });
    } finally {
      server.close();
    }
  });

  it('un error que no es temporal no se reintenta', async () => {
    const f = fakeFetch([reply(400, { error: { message: 'API key not valid' } })]);
    await expect(generate({ ...opts(f.fetchImpl), build })).rejects.toMatchObject({ busy: false, message: expect.stringMatching(/400.*API key/) });
    expect(f.sent).toHaveLength(1);
  });
});

describe('importar un documento', () => {
  const list = { title: 'Lista', author: null, version: null, groups: [{ group: 'carbohidratos', title: 'Carbohidratos', page: 2, note: null, items: [{ name: 'Arroz', amount: 20, unit: 'g' }] }], doubts: [] };
  const has = (o) => ({ lista: false, pauta: false, conversion: false, productos: false, ...o });

  it('solo lista: una única llamada', async () => {
    const f = fakeFetch([reply(200, output({ contains: has({ lista: true }), food_list: list }))]);
    const r = await importDocument({ pdfBase64: 'x', catalog: [], ...opts(f.fetchImpl) });
    expect(r).toMatchObject({ contains: has({ lista: true }), foodList: list, plan: null, conversion: null, products: null });
    expect(f.sent).toHaveLength(1);
  });

  it('PDF con lista y pauta: la pauta se lee con los alimentos de esa lista en el catálogo', async () => {
    const f = fakeFetch([reply(200, output({ contains: has({ lista: true, pauta: true }), food_list: list })), reply(200, output({ plan_name: 'P' }))]);
    const r = await importDocument({ pdfBase64: 'x', catalog: [{ id: 'huevo', name: 'Huevo' }], ...opts(f.fetchImpl) });
    expect(r).toMatchObject({ foodList: list, plan: { plan_name: 'P' } });
    expect(f.sent[1].input[1].text).toContain('huevo: Huevo');
    expect(f.sent[1].input[1].text).toContain('arroz: Arroz');
  });

  it('crudo a cocido y productos: una lectura por parte, con su esquema', async () => {
    const f = fakeFetch([
      reply(200, output({ contains: has({ conversion: true, productos: true }), food_list: null })),
      reply(200, output({ title: 'De crudo a cocido' })),
      reply(200, output({ title: 'Productos' })),
    ]);
    const steps = [];
    const r = await importDocument({ pdfBase64: 'x', catalog: [], onProgress: (p) => steps.push(p), ...opts(f.fetchImpl) });
    expect(r).toMatchObject({ conversion: { title: 'De crudo a cocido' }, products: { title: 'Productos' }, plan: null, foodList: null });
    expect(steps).toEqual([
      { done: 0, total: null, label: 'Identificando el documento' },
      { done: 1, total: 3, label: 'Leyendo la tabla de crudo a cocido' },
      { done: 2, total: 3, label: 'Leyendo los productos recomendados' },
    ]);
    expect(f.sent.map((b) => b.response_format.schema)).toEqual([LIST_SCHEMA, CONVERSION_SCHEMA, PRODUCTS_SCHEMA]);
  });

  it('solo pauta: no se inventa lista', async () => {
    const f = fakeFetch([reply(200, output({ contains: has({ pauta: true }), food_list: list })), reply(200, output({ plan_name: 'P' }))]);
    const r = await importDocument({ pdfBase64: 'x', catalog: [], ...opts(f.fetchImpl) });
    expect(r.foodList).toBeNull();
    expect(r.plan).toEqual({ plan_name: 'P' });
  });

  it('documento que no es de la nutricionista', async () => {
    const f = fakeFetch([reply(200, output({ contains: has({}), food_list: null }))]);
    await expect(importDocument({ pdfBase64: 'x', catalog: [], ...opts(f.fetchImpl) })).resolves.toMatchObject({ plan: null, foodList: null, conversion: null, products: null });
    expect(f.sent).toHaveLength(1);
  });
});
