import { describe, expect, it } from 'vitest';
import { addPlanItem, copyDay, copyMeal, movePlanItem, removePlanItem, slotItems, updatePlanQuantity } from './planner';
import { consumePlanned, logIntake, removeIntake, updateIntakeQuantity } from './intake';
import { daySummary } from './day';
import { makeContext } from './nutrition';
import type { Diet, Food, PlanItem } from './types';

const pollo: Food = {
  id: 'pollo', name: 'Pollo', state: 'crudo', group: 'proteinaMagra', origin: 'usuario', status: 'pendiente',
  equivalences: [{ amount: 30, unit: 'g', portions: { proteinaMagra: 1 }, source: { doc: 'd' }, status: 'pendiente' }],
  nutrition: { per: 100, unit: 'g', values: { kcal: 150, protein: 10, carbs: 0, fat: 8 }, source: 't', status: 'pendiente' },
};
const diet = (id: string, targets = {}): Diet => ({
  id, name: id, holder: 'x', documents: [], importedAt: '', status: 'pendiente', notes: [],
  meals: [{ id: 'comida', name: 'Comida', portionTargets: { proteinaMagra: 4 } }, { id: 'cena', name: 'Cena', portionTargets: {} }],
  dailyPortionTargets: { proteinaMagra: 4 }, nutrientTargets: targets, exchangeDocs: ['d'], rules: [], freeFoodIds: [], review: [],
});
const A = diet('A', { kcal: 500 });
const B = diet('B');
const ctx = makeContext({ foods: [pollo], recipes: [] }, A);
const base = { date: '2026-10-16', mealId: 'comida', ref: { kind: 'food', foodId: 'pollo' } as const, unit: 'g' as const };

function planWith(...quantities: number[]): PlanItem[] {
  return quantities.reduce<PlanItem[]>((p, quantity) => addPlanItem(p, { ...base, quantity }), []);
}

describe('planificador', () => {
  it('añadir al plan no aumenta la ingesta real', () => {
    const plan = planWith(120);
    const s = daySummary({ plan, intake: [] }, A, base.date, ctx);
    expect(s.planned.nutrients.kcal).toBe(180);
    expect(s.consumed.nutrients.kcal).toBe(0);
    expect(s.nutrients.kcal.remaining).toBe(500);
  });

  it('editar la cantidad recalcula los totales', () => {
    let plan = planWith(120);
    plan = updatePlanQuantity(plan, plan[0]!.id, 60);
    expect(daySummary({ plan, intake: [] }, A, base.date, ctx).planned.portions.proteinaMagra).toBe(2);
  });

  it('suma varias comidas en el total del día', () => {
    let plan = planWith(60);
    plan = addPlanItem(plan, { ...base, mealId: 'cena', quantity: 90 });
    const s = daySummary({ plan, intake: [] }, A, base.date, ctx);
    expect(s.meals.map((m) => m.planned.portions.proteinaMagra)).toEqual([2, 3]);
    expect(s.planned.portions.proteinaMagra).toBe(5);
    expect(s.planned.nutrients.kcal).toBe(225);
  });

  it('reordena dentro de una comida', () => {
    const plan = planWith(10, 20, 30);
    const moved = movePlanItem(plan, plan[2]!.id, -1);
    expect(slotItems(moved, base).map((p) => p.quantity)).toEqual([10, 30, 20]);
    expect(movePlanItem(moved, slotItems(moved, base)[0]!.id, -1)).toBe(moved);
  });

  it('eliminar no deja referencias colgando', () => {
    const plan = planWith(120);
    const intake = consumePlanned([], plan[0]!);
    const out = removePlanItem(plan, intake, plan[0]!.id);
    expect(out.plan).toHaveLength(0);
    expect(out.intake[0]!.planItemId).toBeUndefined();
    expect(out.intake).toHaveLength(1); // lo comido sigue siendo ingesta real
  });

  it('copia una comida y un día sin compartir identificadores', () => {
    const plan = planWith(30, 60);
    const meal = copyMeal(plan, base, { date: base.date, mealId: 'cena' });
    expect(slotItems(meal, { ...base, mealId: 'cena' })).toHaveLength(2);
    const day = copyDay(plan, [], base.date, '2026-10-17', false);
    const copied = day.plan.filter((p) => p.date === '2026-10-17');
    expect(copied.map((p) => p.quantity)).toEqual([30, 60]);
    expect(copied.some((c) => plan.some((p) => p.id === c.id))).toBe(false);
    const replaced = copyDay(day.plan, [], base.date, '2026-10-17', true);
    expect(replaced.plan.filter((p) => p.date === '2026-10-17')).toHaveLength(2);
  });
});

describe('ingesta', () => {
  it('confirmar dos veces la misma comida no duplica el registro', () => {
    const plan = planWith(120);
    let intake = consumePlanned([], plan[0]!);
    intake = consumePlanned(intake, plan[0]!);
    expect(intake).toHaveLength(1);
  });

  it('ajustar lo comido no altera lo previsto', () => {
    const plan = planWith(120);
    let intake = consumePlanned([], plan[0]!);
    intake = updateIntakeQuantity(intake, intake[0]!.id, 90);
    const s = daySummary({ plan, intake }, A, base.date, ctx);
    expect(s.planned.portions.proteinaMagra).toBe(4);
    expect(s.consumed.portions.proteinaMagra).toBe(3);
    expect(intake[0]!.status).toBe('corregido');
    expect(plan[0]!.quantity).toBe(120);
  });

  it('separa planificado, consumido y restante', () => {
    let plan = planWith(120);
    plan = addPlanItem(plan, { ...base, mealId: 'cena', quantity: 120 });
    const intake = consumePlanned([], plan[0]!);
    const s = daySummary({ plan, intake }, A, base.date, ctx);
    expect(s.nutrients.kcal).toMatchObject({ target: 500, consumed: 180, planned: 360, remaining: 320 });
    expect(s.meals[0]!.pending).toHaveLength(0);
    expect(s.meals[1]!.pending).toHaveLength(1);
  });

  it('registra algo no planificado y lo elimina sin residuos', () => {
    let intake = logIntake([], { ...base, quantity: 30 });
    expect(daySummary({ plan: [], intake }, A, base.date, ctx).consumed.portions.proteinaMagra).toBe(1);
    intake = removeIntake(intake, intake[0]!.id);
    expect(daySummary({ plan: [], intake }, A, base.date, ctx).consumed.nutrients.kcal).toBe(0);
  });

  it('nutrientes sin objetivo: se muestra el consumo, sin restante ni porcentaje', () => {
    const intake = logIntake([], { ...base, quantity: 100 });
    const s = daySummary({ plan: [], intake }, B, base.date, makeContext({ foods: [pollo], recipes: [] }, B));
    expect(s.nutrients.kcal).toEqual({ consumed: 150, planned: 0 });
  });

});
