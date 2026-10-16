import { describe, expect, it } from 'vitest';
import { applyFoodList, checkFoodList, currentListDocId, foodId, sanitizeFoodList } from './importFoodList';
import { applyImport, sanitizeExtraction } from './importPlan';
import { reviewItems, setReviewResolved } from './review';
import { foodTotals, makeContext, recipePerServing } from './nutrition';
import { emptyData } from '../data/fixtures';

// Lo que devolvería Gemini para la lista de alimentos (abreviado).
const raw = {
  title: 'Lista de alimentos',
  author: 'Nutricionista',
  version: null,
  groups: [
    { group: 'carbohidratos', title: 'Carbohidratos', page: 2, note: null, items: [
      { name: 'Arroz', amount: 20, unit: 'g', household: '1/2 taza cocido', units_per_portion: null, unit_label: null, state: 'crudo' },
      { name: 'Galleta María', amount: 25, unit: 'g', household: '3 unidades', units_per_portion: 3, unit_label: 'galleta', state: 'listo' },
      { name: 'Tortilla para fajitas', amount: null, unit: null, household: '1 unidad o 2 pequeñas', units_per_portion: null, unit_label: null, state: 'listo' },
    ] },
    { group: 'proteinaMagra', title: 'Proteína magra', page: 4, note: null, items: [
      { name: 'Pechuga de pollo', amount: 30, unit: 'g', household: '1 trozo pequeño', units_per_portion: null, unit_label: null, state: 'crudo' },
      { name: 'Arroz', amount: 99, unit: 'g', household: null, units_per_portion: null, unit_label: null, state: 'crudo' },
    ] },
    { group: 'vegetales', title: 'Vegetales', page: 7, note: '1 porción = 1/2 taza cocidos ó 1 taza crudos', items: [
      { name: 'Brócoli', amount: null, unit: null, household: null, units_per_portion: null, unit_label: null, state: 'crudo' },
    ] },
    { group: 'inventado', title: 'X', page: 1, items: [{ name: 'Nada' }] },
  ],
  doubts: [{ text: 'Legumbres asignadas a carbohidratos.', page: 3 }],
};
const DOC = { id: 'pdf-lista1', url: '/api/documentos/lista1.pdf' };

describe('lista de alimentos', () => {
  const list = sanitizeFoodList(raw);

  it('sanea: descarta grupos desconocidos y normaliza estados', () => {
    expect(list.groups.map((g) => g.group)).toEqual(['carbohidratos', 'proteinaMagra', 'vegetales']);
    expect(sanitizeFoodList(null).groups).toEqual([]);
    expect(sanitizeFoodList({ groups: [{ group: 'frutas', items: [{ name: 'Kiwi', amount: -5, state: 'raro' }] }] }).groups[0]!.items[0]).toMatchObject({ amount: null, state: 'otro' });
  });

  it('comprueba lo que no se podrá contar y los repetidos', () => {
    const texts = checkFoodList(list).map((c) => c.text).join(' | ');
    expect(texts).toMatch(/6 alimentos en 3 tablas/);
    expect(texts).toMatch(/Sin cantidad por porción.*Tortilla para fajitas/);
    expect(texts).toMatch(/Repetidos.*Arroz/);
    expect(texts).toMatch(/No aparece ninguna tabla de: lácteos, frutas, proteína semimagra, grasas/);
  });

  it('crea los alimentos con sus equivalencias trazables', () => {
    const data = applyFoodList(emptyData(), list, DOC);
    expect(currentListDocId(data)).toBe('pdf-lista1');
    const galleta = data.foods.find((f) => f.id === 'galleta-maria')!;
    expect(galleta.equivalences.map((e) => [e.amount, e.unit])).toEqual([[25, 'g'], [3, 'unidad']]);
    expect(galleta.unitLabel).toBe('galleta');
    expect(galleta.equivalences[0]!.source).toMatchObject({ doc: 'pdf-lista1', page: 2 });
    // Repetido: se queda la primera aparición (carbohidratos, 20 g).
    expect(data.foods.filter((f) => f.id === 'arroz')).toHaveLength(1);
    expect(data.foods.find((f) => f.id === 'arroz')!.group).toBe('carbohidratos');
    // Vegetales: se cuentan en porciones.
    expect(data.foods.find((f) => f.id === foodId('Brócoli'))!.equivalences[0]).toMatchObject({ unit: 'porcion', amount: 1 });
    expect(data.foods.find((f) => f.id === 'tortilla-para-fajitas')!.status).toBe('pendiente');
    // Las dudas quedan en el documento.
    expect(data.documents[0]!.review!.map((r) => r.text)).toContain('Legumbres asignadas a carbohidratos.');
  });

  it('una pauta importada después usa esta lista y enlaza sus platos', () => {
    const withList = applyFoodList(emptyData(), list, DOC);
    const plan = sanitizeExtraction({
      plan_name: 'Mi pauta',
      meals: [{ name: 'Comida', page: 1, portions: { carbohidratos: 2, proteinaMagra: 4 } }],
      daily_totals: { carbohidratos: 2, proteinaMagra: 4 },
      dishes: [{ meal: 'Comida', name: 'Pollo con arroz', page: 2, raw: '120g de pollo y 40g de arroz', ingredients: [
        { label: 'Pollo', catalog_id: 'pechuga-de-pollo', quantity: 120, unit: 'g', not_counted: false },
        { label: 'Arroz', catalog_id: 'arroz', quantity: 40, unit: 'g', not_counted: false },
      ] }],
    });
    const data = applyImport(withList, plan, { id: 'pdf-pauta1', url: '/api/documentos/pauta1.pdf' }, '2026-10-20T00:00:00Z', 'm');
    expect(data.diet!.exchangeDocs).toEqual(['pdf-pauta1', 'pdf-lista1']);
    const ctx = makeContext(data, data.diet);
    const dish = data.recipes.find((r) => r.name === 'Pollo con arroz')!;
    expect(recipePerServing(dish, ctx)).toMatchObject({ portions: { proteinaMagra: 4, carbohidratos: 2 }, portionsIncomplete: false });
    // Las dudas de la lista aparecen junto a las de la pauta y se pueden marcar.
    const doubt = reviewItems(data).find((r) => r.text.startsWith('Legumbres'))!;
    expect(reviewItems(setReviewResolved(data, doubt.id, true)).find((r) => r.id === doubt.id)!.resolved).toBe(true);
  });

  it('una lista nueva sustituye a la anterior en la pauta sin perder el historial de equivalencias', () => {
    const v1 = applyFoodList(emptyData(), list, DOC);
    const plan = sanitizeExtraction({ plan_name: 'P', meals: [{ name: 'Comida', page: 1, portions: { carbohidratos: 1 } }], daily_totals: { carbohidratos: 1 } });
    const withPlan = applyImport(v1, plan, { id: 'pdf-p', url: '/p.pdf' }, '2026-10-20T00:00:00Z', 'm');
    const newList = sanitizeFoodList({ title: 'Lista 2', groups: [{ group: 'carbohidratos', title: 'Carbohidratos', page: 1, items: [{ name: 'Arroz', amount: 25, unit: 'g', state: 'crudo' }] }] });
    const v2 = applyFoodList(withPlan, newList, { id: 'pdf-lista2', url: '/l2.pdf' });
    expect(v2.diet!.exchangeDocs).toEqual(['pdf-p', 'pdf-lista2']);
    const arroz = v2.foods.find((f) => f.id === 'arroz')!;
    expect(arroz.equivalences.map((e) => e.source.doc)).toEqual(['pdf-lista1', 'pdf-lista2']);
    expect(foodTotals(arroz, 25, 'g', makeContext(v2, v2.diet)).portions.carbohidratos).toBe(1);
    // Reimportar la misma lista no duplica.
    expect(applyFoodList(v2, newList, { id: 'pdf-lista2', url: '/l2.pdf' }).foods.find((f) => f.id === 'arroz')!.equivalences).toHaveLength(2);
  });
});
