import { describe, expect, it } from 'vitest';
import { fixtureData } from '.';
import { PLAN_15_EXTRA_EQUIVALENCES } from './plan-1-5';
import { foodTotals, makeContext, recipePerServing } from '../../domain/nutrition';

const data = fixtureData();
const plan = data.diet!;
const ctxPlan = makeContext(data, plan);
const food = (id: string) => data.foods.find((f) => f.id === id)!;

describe('fixtures', () => {
  it('ids únicos', () => {
    for (const list of [data.foods, data.recipes]) {
      const ids = list.map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('todas las referencias apuntan a alimentos existentes', () => {
    const ids = new Set(data.foods.map((f) => f.id));
    for (const r of data.recipes) for (const i of r.ingredients) if (i.foodId) expect(ids, `${r.id} → ${i.foodId}`).toContain(i.foodId);
    for (const id of Object.keys(PLAN_15_EXTRA_EQUIVALENCES)) expect(ids).toContain(id);
    for (const id of plan.freeFoodIds) expect(ids).toContain(id);
  });

  it('las porciones de las comidas suman las porciones totales del plan 1.5 (págs. 2 y 3)', () => {
    const sum: Record<string, number> = {};
    for (const m of plan.meals) for (const [g, n] of Object.entries(m.portionTargets)) sum[g] = (sum[g] ?? 0) + n;
    const { lacteos, ...daily } = plan.dailyPortionTargets;
    expect(lacteos).toBe(0);
    expect(sum).toEqual(daily);
  });

  it('el plan 1.5 no trae objetivos de calorías ni macros', () => {
    expect(plan.nutrientTargets).toEqual({});
  });

  it('los alimentos de los documentos no tienen datos nutricionales inventados', () => {
    const conDatos = data.foods.filter((f) => f.origin === 'documento' && f.nutrition).map((f) => f.id);
    expect(conDatos).toEqual(['yogur-proteico-bebible']);
    expect(food('yogur-proteico-bebible').nutrition!.values.kcal).toBeNull();
  });

  it.each([
    ['p15-desayuno-1', 'desayuno'],
    ['p15-desayuno-2', 'desayuno'],
    ['p15-almuerzo-3', 'almuerzo'],
    ['p15-merienda-2', 'merienda'],
    ['p15-cena-3', 'cena'],
  ])('el plato documentado %s cuadra con las porciones de %s', (recipeId, mealId) => {
    const r = data.recipes.find((x) => x.id === recipeId)!;
    const t = recipePerServing(r, ctxPlan);
    expect(t.portionsIncomplete).toBe(false);
    const target = plan.meals.find((m) => m.id === mealId)!.portionTargets;
    for (const [g, n] of Object.entries(target)) expect(t.portions[g as keyof typeof t.portions], g).toBeCloseTo(n);
  });

  it('los platos con ingredientes sin documentar quedan marcados como incompletos', () => {
    for (const id of ['p15-desayuno-3', 'p15-almuerzo-2', 'p15-cena-2', 'p15-merienda-1']) {
      expect(recipePerServing(data.recipes.find((r) => r.id === id)!, ctxPlan).portionsIncomplete, id).toBe(true);
    }
  });

  it('en el plan 1.5 el queso fresco light usa la equivalencia del plan (50 g), no la de la lista (60 g)', () => {
    expect(foodTotals(food('queso-fresco-light'), 50, 'g', ctxPlan).portions.proteinaMagra).toBe(1);
  });

  it('los alimentos libres de la pauta no cuentan porciones', () => {
    const t = foodTotals(food('mermelada-sin-azucar'), 1, 'unidad', ctxPlan);
    expect(t.portions).toEqual({});
    expect(t.portionsIncomplete).toBe(false);
  });

});
