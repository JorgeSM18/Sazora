import { describe, expect, it } from 'vitest';
import { buildConversionRequest, buildListRequest, buildPlanRequest, buildProductsRequest, CONVERSION_SCHEMA, generate, GROUPS, importDocument, LIST_SCHEMA, listCatalog, parseResponse, PLAN_SCHEMA, PRODUCTS_SCHEMA, slug } from './gemini.mjs';

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
    const r = await importDocument({ pdfBase64: 'x', catalog: [], ...opts(f.fetchImpl) });
    expect(r).toMatchObject({ conversion: { title: 'De crudo a cocido' }, products: { title: 'Productos' }, plan: null, foodList: null });
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
