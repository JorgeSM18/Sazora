import { describe, expect, it } from 'vitest';
import { applyConversion, applyProducts, checkConversion, checkProducts, currentDoc, sanitizeConversion, sanitizeProducts } from './importGuides';
import { applyImport, sanitizeExtraction } from './importPlan';
import { foodTotals, makeContext } from './nutrition';
import { reviewItems } from './review';
import { addPlanItem } from './planner';
import { emptyData, fixtureData } from '../data/fixtures';

// Lo que devolvería Gemini para la tabla de crudo a cocido.
const CONVERSION = {
  title: 'De crudo a cocido',
  rules: [{ text: 'Si cocinas el pollo con verduras y salsas ligeras, pesa la preparación final: cuenta igual que en crudo.', page: 1 }],
  items: [
    { names: ['Arroz'], catalog_ids: ['arroz'], section: 'Carbohidratos', group: 'carbohidratos', raw_grams: 20, cooked_min_grams: 50, cooked_max_grams: 50, page: 1 },
    { names: ['Avena'], catalog_ids: ['avena-harina-de-avena'], section: 'Carbohidratos', group: 'carbohidratos', raw_grams: 30, cooked_min_grams: 100, cooked_max_grams: 100, page: 1 },
    { names: ['Pollo', 'Pavo', 'Ternera', 'Cerdo'], catalog_ids: ['pechuga-solomillo-de-pollo-o-pavo', null, 'carne-roja-magra-solomillo-lomo', 'lomo-de-cerdo'], section: 'Proteínas', group: 'proteinaMagra', raw_grams: 30, cooked_min_grams: 20, cooked_max_grams: 25, page: 1 },
    { names: ['Inventado'], catalog_ids: ['no-existe'], section: 'X', group: 'grasas', raw_grams: 10, cooked_min_grams: 8, cooked_max_grams: 8, page: 1 },
    { names: [], raw_grams: 0 },
  ],
  notes: [{ text: 'Las legumbres de bote rinden un poco más: 1 porción son 150 g.', page: 1 }],
  doubts: [],
};

const PRODUCTS = {
  title: 'Mis productos favoritos',
  author: null,
  stores: [
    { store: 'Mercadona', products: [
      { name: 'Natillas +proteínas', category: 'Postres altos en proteína', amount: 1, unit: 'unidad', unit_label: 'natilla', portions: { proteinaMagra: 1.5, carbohidratos: 1 }, raw: '1 natilla = 1 y 1/2 porciones de proteína + 1 de carbohidrato.', page: 12 },
      { name: 'Verduras salteadas', category: 'Verduras', amount: null, unit: null, unit_label: null, portions: {}, raw: 'Muy prácticas.', page: 20 },
    ] },
    { store: 'Lidl', products: [{ name: 'Yogur proteico natural', category: 'Proteína', amount: 70, unit: 'g', unit_label: null, portions: { proteinaMagra: 1 }, raw: '70g = 1 porción de proteína magra.', page: 2 }] },
  ],
  doubts: [{ text: 'En la pág. 30 no se identifica el producto de la foto.', page: 30 }],
};

const DOC = (id: string) => ({ id, url: `/api/documentos/${id}.pdf` });

describe('crudo a cocido', () => {
  const conv = sanitizeConversion(CONVERSION);

  it('sanea las filas y conserva rangos, reglas y notas', () => {
    expect(conv.rows).toHaveLength(4);
    expect(conv.rows[2]).toMatchObject({ names: ['Pollo', 'Pavo', 'Ternera', 'Cerdo'], cookedMin: 20, cookedMax: 25 });
    expect(conv.rules[0]!.text).toMatch(/preparación final/);
    expect(conv.notes).toHaveLength(1);
  });

  it('crea la versión cocida de cada alimento de la lista, escalada a su porción', () => {
    const data = applyConversion(fixtureData(), conv, DOC('pdf-cc'));
    const ctx = makeContext(data, data.diet);
    const arroz = data.foods.find((f) => f.id === 'arroz-cocido')!;
    expect(arroz.name).toBe('Arroz (cocido)');
    expect(foodTotals(arroz, 100, 'g', ctx).portions.carbohidratos).toBeCloseTo(2); // 50 g cocido = 1 porción
    // Avena: 30 g crudo → 100 g cocido; la porción de la lista son 20 g → 66,7 g cocida.
    expect(foodTotals(data.foods.find((f) => f.id === 'avena-harina-de-avena-cocido')!, 200, 'g', ctx).portions.carbohidratos).toBeCloseTo(3);
    // Rango 20-25 g: se usa el punto medio y queda pendiente de revisión.
    const pollo = data.foods.find((f) => f.id === 'pechuga-solomillo-de-pollo-o-pavo-cocido')!;
    expect(pollo.equivalences[0]).toMatchObject({ amount: 22.5, status: 'pendiente', householdMeasure: '20-25 g cocido = 30 g crudo' });
    expect(data.foods.some((f) => f.id === 'no-existe-cocido')).toBe(false);
    // La guía queda guardada y la pauta usa el documento.
    expect(currentDoc(data, 'conversion')!.guide).toMatchObject({ type: 'conversion' });
    expect(data.diet!.exchangeDocs).toContain('pdf-cc');
  });

  it('avisa de lo que no se puede enlazar', () => {
    const checks = checkConversion(conv, fixtureData()).map((c) => c.text).join(' | ');
    expect(checks).toMatch(/4 filas/);
    expect(checks).toMatch(/Sin enlazar a tu lista.*Pavo.*Inventado/);
    expect(checkConversion(conv, emptyData()).some((c) => /Aún no tienes lista/.test(c.text))).toBe(true);
  });

  it('una tabla nueva sustituye a la anterior sin perder lo que ya se usa', () => {
    let data = applyConversion(fixtureData(), conv, DOC('pdf-cc1'));
    data = { ...data, plan: addPlanItem([], { date: '2026-10-17', mealId: 'almuerzo', ref: { kind: 'food', foodId: 'arroz-cocido' }, quantity: 100, unit: 'g' }) };
    const onlyRice = sanitizeConversion({ ...CONVERSION, items: [CONVERSION.items[0]] });
    const v2 = applyConversion(data, onlyRice, DOC('pdf-cc2'));
    expect(v2.documents.filter((d) => d.kind === 'conversion').map((d) => d.id)).toEqual(['pdf-cc1', 'pdf-cc2']);
    expect(v2.diet!.exchangeDocs.filter((d) => d.startsWith('pdf-cc'))).toEqual(['pdf-cc2']);
    expect(v2.foods.find((f) => f.id === 'arroz-cocido')!.equivalences[0]!.source.doc).toBe('pdf-cc2');
    expect(v2.foods.some((f) => f.id === 'lomo-de-cerdo-cocido')).toBe(false);
  });
});

describe('productos por supermercado', () => {
  const products = sanitizeProducts(PRODUCTS);

  it('los productos con equivalencia se pueden usar; el resto queda como guía', () => {
    expect(checkProducts(products).map((c) => c.text)).toEqual(['3 productos en 2 supermercados.', '2 con equivalencia en porciones (se podrán usar en el plan); el resto, solo como guía.']);
    const data = applyProducts(fixtureData(), products, DOC('pdf-mercado'));
    const ctx = makeContext(data, data.diet);
    const natilla = data.foods.find((f) => f.name === 'Natillas +proteínas')!;
    expect(natilla).toMatchObject({ brand: 'Mercadona', unitLabel: 'natilla', status: 'pendiente' });
    expect(foodTotals(natilla, 2, 'unidad', ctx).portions).toEqual({ proteinaMagra: 3, carbohidratos: 2 });
    const guide = currentDoc(data, 'productos')!.guide!;
    expect(guide.type === 'productos' && guide.stores[0]!.products.map((p) => [p.name, p.equivalence, !!p.foodId])).toEqual([
      ['Natillas +proteínas', '1 natilla = 1 carbohidratos + 1,5 proteína magra', true],
      ['Verduras salteadas', '', false],
    ]);
    expect(reviewItems(data).some((r) => r.text.includes('pág. 30'))).toBe(true);
  });

  it('una pauta importada después de las guías las incluye', () => {
    let data = applyProducts(emptyData(), products, DOC('pdf-mercado'));
    data = applyConversion(data, sanitizeConversion(CONVERSION), DOC('pdf-cc'));
    const plan = sanitizeExtraction({ plan_name: 'P', meals: [{ name: 'Comida', page: 1, portions: { carbohidratos: 1 } }], daily_totals: { carbohidratos: 1 } });
    const withPlan = applyImport(data, plan, DOC('pdf-p'), '2026-10-17T00:00:00Z', 'm');
    expect(withPlan.diet!.exchangeDocs).toEqual(['pdf-p', 'pdf-mercado', 'pdf-cc']);
  });

  it('reimportar la guía sustituye los productos que no se usan', () => {
    const v1 = applyProducts(fixtureData(), products, DOC('pdf-m1'));
    const v2 = applyProducts(v1, sanitizeProducts({ ...PRODUCTS, stores: [PRODUCTS.stores[1]] }), DOC('pdf-m2'));
    expect(v2.foods.filter((f) => f.brand === 'Mercadona' && f.origin === 'documento' && f.id.startsWith('pdf-m'))).toHaveLength(0);
    expect(v2.foods.filter((f) => f.id.startsWith('pdf-m2-p'))).toHaveLength(1);
  });
});

describe('calculadora de crudo a cocido', () => {
  it('pasa de cocido a crudo, con rango cuando la tabla lo da', async () => {
    const { cookedToRaw } = await import('./importGuides');
    expect(cookedToRaw({ rawGrams: 20, cookedMin: 50, cookedMax: 50 }, 150)).toEqual({ min: 60, max: 60 });
    const pollo = cookedToRaw({ rawGrams: 30, cookedMin: 20, cookedMax: 25 }, 200);
    expect(pollo.min).toBeCloseTo(240);
    expect(pollo.max).toBeCloseTo(300);
  });
});
