// Resumen de un día: lo planificado y lo consumido por comida, y el progreso frente a los objetivos.

import { EXCHANGE_GROUPS, NUTRIENT_KEYS, type AppData, type Diet, type ExchangeGroup, type IntakeEntry, type MealSlot, type NutrientKey, type PlanItem } from './types';
import { itemTotals, progress, sumTotals, type CalcContext, type Progress, type Totals } from './nutrition';

export interface MealDay {
  meal: MealSlot;
  plan: PlanItem[];
  intake: IntakeEntry[];
  planned: Totals;
  consumed: Totals;
  /** Elementos planificados aún sin registrar. */
  pending: PlanItem[];
}

export interface DaySummary {
  date: string;
  meals: MealDay[];
  planned: Totals;
  consumed: Totals;
  nutrients: Record<NutrientKey, Progress>;
  portions: { group: ExchangeGroup; progress: Progress }[];
}

const totalsOf = (list: (PlanItem | IntakeEntry)[], ctx: CalcContext) =>
  sumTotals(list.map((i) => itemTotals(i.ref, i.quantity, i.unit, ctx)));

export interface SemimagraSwap {
  /** Porciones de magra de más que cubren semimagra que falta. */
  portions: number;
  /** Grasa del día según la pauta (si la fija). */
  fatTarget?: number;
  fatEaten: number;
}

/**
 * Sustitución de la pauta: 1 porción de proteína semimagra = 1 de magra + 1 de grasa.
 * Si sobra magra comida y falta semimagra, esa magra la cubre sumando la misma grasa. Solo informa:
 * no cambia los totales ni da por hecho que se haya sustituido.
 */
export function semimagraSwap(s: DaySummary): SemimagraSwap | null {
  const get = (g: ExchangeGroup) => s.portions.find((p) => p.group === g)?.progress;
  const magra = get('proteinaMagra');
  const semi = get('proteinaSemimagra');
  if (magra?.target === undefined || semi?.target === undefined) return null;
  const portions = Math.min(magra.exceededBy ?? 0, semi.remaining ?? 0);
  if (portions <= 0) return null;
  const fat = get('grasas');
  return { portions, fatTarget: fat?.target, fatEaten: fat?.consumed ?? 0 };
}

export function daySummary(data: Pick<AppData, 'plan' | 'intake'>, diet: Diet, date: string, ctx: CalcContext): DaySummary {
  const plan = data.plan.filter((p) => p.date === date);
  const intake = data.intake.filter((e) => e.date === date);
  const linked = new Set(intake.map((e) => e.planItemId).filter(Boolean));

  const meals = diet.meals.map((meal) => {
    const mp = plan.filter((p) => p.mealId === meal.id).sort((a, b) => a.order - b.order);
    const mi = intake.filter((e) => e.mealId === meal.id).sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
    return {
      meal,
      plan: mp,
      intake: mi,
      planned: totalsOf(mp, ctx),
      consumed: totalsOf(mi, ctx),
      pending: mp.filter((p) => !linked.has(p.id)),
    };
  });

  const planned = sumTotals(meals.map((m) => m.planned));
  const consumed = sumTotals(meals.map((m) => m.consumed));

  const nutrients = Object.fromEntries(
    NUTRIENT_KEYS.map((k) => [k, progress(diet.nutrientTargets[k], consumed.nutrients[k], planned.nutrients[k])]),
  ) as Record<NutrientKey, Progress>;

  const portions = EXCHANGE_GROUPS.filter(
    (g) => diet.dailyPortionTargets[g] !== undefined || planned.portions[g] || consumed.portions[g],
  ).map((group) => ({
    group,
    progress: progress(diet.dailyPortionTargets[group], consumed.portions[group] ?? 0, planned.portions[group] ?? 0),
  }));

  return { date, meals, planned, consumed, nutrients, portions };
}
