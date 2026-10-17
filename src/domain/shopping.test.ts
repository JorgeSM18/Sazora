import { describe, expect, it } from 'vitest';
import { shoppingFromPlan } from './shopping';
import { addPlanItem } from './planner';
import { makeContext } from './nutrition';
import { applyConversion, sanitizeConversion } from './importGuides';
import { fixtureData } from '../data/fixtures';

describe('compra desde el plan', () => {
  const base = fixtureData();
  const data = applyConversion(base, sanitizeConversion({
    title: 'Crudo a cocido', rules: [], notes: [], doubts: [],
    items: [{ names: ['Arroz'], catalog_ids: ['arroz'], section: 'Carbohidratos', group: 'carbohidratos', raw_grams: 20, cooked_min_grams: 50, cooked_max_grams: 50, page: 1 }],
  }), { id: 'pdf-cc', url: '/x.pdf' });
  const ctx = makeContext(data, data.diet);
  const at = (date: string, mealId: string, ref: Parameters<typeof addPlanItem>[1]['ref'], quantity: number, unit: Parameters<typeof addPlanItem>[1]['unit']) => ({ date, mealId, ref, quantity, unit });

  it('suma por alimento, pasa porciones y cocido a crudo, e incluye ingredientes de recetas', () => {
    let plan = addPlanItem([], at('2026-10-17', 'almuerzo', { kind: 'food', foodId: 'arroz' }, 40, 'g'));
    plan = addPlanItem(plan, at('2026-10-18', 'cena', { kind: 'food', foodId: 'arroz' }, 1, 'porcion')); // 20 g
    plan = addPlanItem(plan, at('2026-10-18', 'almuerzo', { kind: 'food', foodId: 'arroz-cocido' }, 150, 'g')); // 60 g crudo
    plan = addPlanItem(plan, at('2026-10-19', 'desayuno', { kind: 'recipe', recipeId: 'p15-desayuno-1' }, 2, 'racion'));
    plan = addPlanItem(plan, at('2026-10-30', 'cena', { kind: 'food', foodId: 'kiwi' }, 1, 'unidad')); // fuera de rango

    const list = shoppingFromPlan({ ...data, plan }, '2026-10-17', '2026-10-23', ctx);
    const find = (t: string) => list.find((i) => i.text === t);
    expect(find('Arroz')).toMatchObject({ amount: 120, unit: 'g', quantity: '120 g', category: 'Carbohidratos' });
    // Receta de 1 ración ×2: 2 huevos ×2, 110 g de piña ×2…
    expect(find('Huevo')).toMatchObject({ amount: 4, quantity: '4 huevos' });
    expect(find('Piña')).toMatchObject({ amount: 220, quantity: '220 g', category: 'Frutas' });
    expect(find('Kiwi')).toBeUndefined();
  });

  it('lo que no se puede cuantificar entra como texto, una sola vez', () => {
    let plan = addPlanItem([], at('2026-10-17', 'desayuno', { kind: 'recipe', recipeId: 'p15-desayuno-3' }, 1, 'racion'));
    plan = addPlanItem(plan, at('2026-10-18', 'desayuno', { kind: 'recipe', recipeId: 'p15-desayuno-3' }, 1, 'racion'));
    const list = shoppingFromPlan({ ...data, plan }, '2026-10-17', '2026-10-18', ctx);
    expect(list.filter((i) => i.text === 'Tomate y rúcula')).toEqual([expect.objectContaining({ quantity: '', category: 'Otros' })]);
  });
});
