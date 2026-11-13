import { describe, expect, it } from 'vitest';
import { buildMatchRequest, createNutritionLookup, parseBedcaList, parseBedcaValues, sharesWord } from './nutrition.mjs';

const LIST = '<foodresponse><food><f_id>10</f_id><f_ori_name>Arroz</f_ori_name></food><food><f_id>11</f_id><f_ori_name>Pavo, crudo</f_ori_name></food><food><f_id>12</f_id><f_ori_name>Patatas &quot;chips&quot;</f_ori_name></food></foodresponse>';
const value = (c, v, unit = 'g') => `<foodvalue><c_id>${c}</c_id><best_location>${v}</best_location><v_unit>${unit}</v_unit></foodvalue>`;
const VALUES = `<foodresponse><food><f_id>10</f_id>${value(409, 1464.4, 'kJ')}${value(416, 7)}${value(53, 78)}${value(410, '')}${value(417, 12)}</food></foodresponse>`;
const OFF = { hits: [{ code: '8480000', product_name: 'Yogur proteínas', brands: ['Hacendado'], nutriments: { 'energy-kcal_100g': 57, proteins_100g: 10, carbohydrates_100g: 4, fat_100g: 0.2 } }, { code: '999', product_name: 'Yogur sin datos', nutriments: {} }] };

/** Fuentes y modelo simulados. `matches`: lo que "elige" la IA; `off`: respuesta de Open Food Facts o 'error'. */
function setup({ matches = [], off = OFF } = {}) {
  const store = new Map();
  const calls = { bedca: 0, off: 0, ai: [] };
  const fetchImpl = async (url, init) => {
    if (String(url).includes('bedca')) {
      calls.bedca++;
      return { ok: true, text: async () => (init.body.includes('level="1"') ? LIST : VALUES) };
    }
    calls.off++;
    return off === 'error' ? { ok: false, status: 503 } : { ok: true, json: async () => off };
  };
  const lookup = createNutritionLookup({
    cache: { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) },
    fetchImpl,
    generate: async (build) => {
      calls.ai.push(build('m'));
      return { result: { items: matches }, model: 'm' };
    },
  });
  return { lookup, calls, store };
}

describe('fuentes', () => {
  it('lee la lista y los valores de BEDCA: energía de kJ a kcal, lo que falta queda desconocido', () => {
    expect(parseBedcaList(LIST)).toEqual([{ id: '10', name: 'Arroz' }, { id: '11', name: 'Pavo, crudo' }, { id: '12', name: 'Patatas "chips"' }]);
    expect(parseBedcaValues(VALUES)).toEqual({ kcal: 350, protein: 7, carbs: 78, fat: null });
  });

  it('el emparejado solo lleva nombres: la tabla BEDCA y los candidatos de cada alimento', () => {
    const r = buildMatchRequest({ model: 'm', bedca: [{ id: '10', name: 'Arroz' }], foods: [{ id: 'yogur', name: 'Yogur', brand: 'Mercadona', state: 'listo' }], candidates: new Map([['yogur', [{ code: '8480000', name: 'Yogur · Hacendado', values: { kcal: 57 } }]]]) });
    expect(r.input[0].text).toContain('10: Arroz');
    expect(r.input[0].text).toContain('yogur: Yogur (Mercadona) [listo]\n  off:8480000: Yogur · Hacendado');
    expect(r.input[0].text).not.toContain('57');
    expect(r.tools).toBeUndefined();
  });

  it('descarta emparejados sin ninguna palabra en común', () => {
    expect(sharesWord('Papa/patata', 'Patata, cruda')).toBe(true);
    expect(sharesWord('Quínoa', 'Quinoa')).toBe(true);
    expect(sharesWord('Pechuga de pollo', 'Pavo, crudo')).toBe(false);
  });
});

describe('búsqueda', () => {
  const arroz = { id: 'arroz', name: 'Arroz', state: 'crudo' };
  const yogur = { id: 'yogur', name: 'Yogur +Proteínas', brand: 'Mercadona', state: 'listo' };

  it('los valores salen de la fuente, no de la IA', async () => {
    const { lookup } = setup({ matches: [{ id: 'arroz', match: 'bedca:10', note: null, kcal: 1 }, { id: 'yogur', match: 'off:8480000', note: 'Marca propia' }] });
    const { items } = await lookup({ foods: [arroz, yogur] });
    expect(items[0]).toEqual({ id: 'arroz', found: true, unit: 'g', kcal: 350, protein: 7, carbs: 78, fat: null, source_name: 'BEDCA: Arroz', source_url: 'https://www.bedca.net/bdpub/', note: null });
    expect(items[1]).toMatchObject({ id: 'yogur', found: true, kcal: 57, protein: 10, source_name: 'Open Food Facts: Yogur proteínas · Hacendado', source_url: 'https://world.openfoodfacts.org/product/8480000', note: 'Marca propia' });
  });

  it('una elección que no existe, de otro alimento o sin palabras en común no se acepta', async () => {
    const pollo = { id: 'pollo', name: 'Pechuga de pollo', state: 'crudo' };
    const { lookup } = setup({ matches: [{ id: 'arroz', match: 'bedca:777', note: null }, { id: 'yogur', match: 'off:999', note: null }, { id: 'pollo', match: 'bedca:11', note: null }] });
    const { items } = await lookup({ foods: [arroz, yogur, pollo] });
    expect(items.map((i) => i.found)).toEqual([false, false, false]);
    expect(items[0]).toMatchObject({ id: 'arroz', kcal: null, protein: null, carbs: null, fat: null });
  });

  it('no busca dos veces lo mismo: ni repetidos, ni lo ya encontrado, ni lo no encontrado', async () => {
    const { lookup, calls } = setup({ matches: [{ id: 'arroz', match: 'bedca:10', note: null }, { id: 'yogur', match: null, note: null }] });
    const first = await lookup({ foods: [arroz, { ...arroz, id: 'arroz-2' }, yogur] });
    expect(first.items.map((i) => [i.id, i.found])).toEqual([['arroz', true], ['arroz-2', true], ['yogur', false]]);
    expect(calls.ai).toHaveLength(1);
    expect(calls.ai[0].input[0].text).not.toContain('arroz-2');
    // Otro usuario con la misma lista (otros ids): todo sale de la caché, sin IA ni red.
    const before = { ...calls, ai: calls.ai.length };
    const again = await lookup({ foods: [{ ...arroz, id: 'otro' }, yogur] });
    expect(again).toMatchObject({ model: 'caché', items: [{ id: 'otro', found: true, kcal: 350 }, { id: 'yogur', found: false }] });
    expect({ ...calls, ai: calls.ai.length }).toEqual(before);
  });

  it('si una fuente falla, el "no encontrado" no se guarda y se reintenta la próxima vez', async () => {
    const { lookup, calls } = setup({ off: 'error', matches: [{ id: 'yogur', match: null, note: null }] });
    expect((await lookup({ foods: [yogur] })).items[0].found).toBe(false);
    await lookup({ foods: [yogur] });
    expect(calls.ai).toHaveLength(2);
  });

  it('un producto de marca emparejado con BEDCA avisa de que el valor es genérico', async () => {
    const { lookup } = setup({ matches: [{ id: 'a', match: 'bedca:10', note: null }] });
    const { items } = await lookup({ foods: [{ id: 'a', name: 'Arroz largo', brand: 'Lidl', state: 'crudo' }] });
    expect(items[0].note).toMatch(/genérico de BEDCA/);
  });
});
