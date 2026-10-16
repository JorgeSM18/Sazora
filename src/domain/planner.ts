// Operaciones puras del planificador. Lo planificado nunca suma a la ingesta real.

import type { IntakeEntry, PlanItem } from './types';

export const newId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

type Slot = Pick<PlanItem, 'date' | 'mealId'>;
const sameSlot = (a: Slot, b: Slot) => a.date === b.date && a.mealId === b.mealId;

export const slotItems = (plan: PlanItem[], slot: Slot) =>
  plan.filter((p) => sameSlot(p, slot)).sort((a, b) => a.order - b.order);

const nextOrder = (plan: PlanItem[], slot: Slot) =>
  Math.max(-1, ...slotItems(plan, slot).map((p) => p.order)) + 1;

export function addPlanItem(plan: PlanItem[], input: Omit<PlanItem, 'id' | 'order'>): PlanItem[] {
  return [...plan, { ...input, id: newId('plan'), order: nextOrder(plan, input) }];
}

export function updatePlanQuantity(plan: PlanItem[], id: string, quantity: number): PlanItem[] {
  return plan.map((p) => (p.id === id ? { ...p, quantity } : p));
}

/** Borra un elemento planificado. Si ya se registró como comido, el registro se conserva (es ingesta real) pero pierde el vínculo. */
export function removePlanItem(plan: PlanItem[], intake: IntakeEntry[], id: string) {
  return {
    plan: plan.filter((p) => p.id !== id),
    intake: intake.map((e) => (e.planItemId === id ? { ...e, planItemId: undefined } : e)),
  };
}

/** Mueve un elemento arriba (-1) o abajo (+1) dentro de su comida. */
export function movePlanItem(plan: PlanItem[], id: string, delta: -1 | 1): PlanItem[] {
  const item = plan.find((p) => p.id === id);
  if (!item) return plan;
  const list = slotItems(plan, item);
  const i = list.findIndex((p) => p.id === id);
  const j = i + delta;
  if (j < 0 || j >= list.length) return plan;
  [list[i], list[j]] = [list[j]!, list[i]!];
  const order = new Map(list.map((p, k) => [p.id, k]));
  return plan.map((p) => (order.has(p.id) ? { ...p, order: order.get(p.id)! } : p));
}

/** Copia los elementos de una comida a otra comida (mismo u otro día). Se añaden al final. */
export function copyMeal(plan: PlanItem[], from: Slot, to: Slot): PlanItem[] {
  let order = nextOrder(plan, to);
  const clones = slotItems(plan, from).map((p) => ({ ...p, ...to, id: newId('plan'), order: order++ }));
  return [...plan, ...clones];
}

/** Copia todo un día. `replace` borra antes lo planificado en el destino (sus registros de ingesta se conservan desvinculados). */
export function copyDay(
  plan: PlanItem[],
  intake: IntakeEntry[],
  fromDate: string,
  toDate: string,
  replace: boolean,
) {
  if (fromDate === toDate) return { plan, intake };
  let next = { plan, intake };
  if (replace) {
    for (const p of plan.filter((p) => p.date === toDate)) {
      next = removePlanItem(next.plan, next.intake, p.id);
    }
  }
  const meals = [...new Set(plan.filter((p) => p.date === fromDate).map((p) => p.mealId))];
  let out = next.plan;
  for (const mealId of meals) out = copyMeal(out, { date: fromDate, mealId }, { date: toDate, mealId });
  return { plan: out, intake: next.intake };
}
