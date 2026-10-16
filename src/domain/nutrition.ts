// Motor de cálculo nutricional. Puro y determinista: toda fórmula de la app vive aquí.
// Precisión completa internamente; el redondeo es cosa de la capa de presentación.

import {
  EXCHANGE_GROUPS,
  NUTRIENT_KEYS,
  type AppData,
  type Diet,
  type Food,
  type Ingredient,
  type ItemRef,
  type NutrientKey,
  type Portions,
  type Recipe,
  type Unit,
} from './types';

export type IssueCode =
  | 'sin-datos-nutricionales'
  | 'nutriente-desconocido'
  | 'unidad-incompatible'
  | 'sin-equivalencia'
  | 'no-encontrado'
  | 'ingrediente-sin-calcular';

export interface Issue {
  code: IssueCode;
  subject: string;
}

export interface Totals {
  /** Suma de los valores conocidos. */
  nutrients: Record<NutrientKey, number>;
  /** true si algún componente no tiene ese nutriente: el valor es un mínimo, no un total. */
  unknown: Record<NutrientKey, boolean>;
  portions: Portions;
  /** true si algún componente no se pudo convertir a porciones. */
  portionsIncomplete: boolean;
  issues: Issue[];
}

export interface CalcContext {
  foods: Map<string, Food>;
  recipes: Map<string, Recipe>;
  /** Documentos de la dieta activa, por orden de precedencia. */
  exchangeDocs: string[];
  /** Alimentos que la dieta declara "no contabilizar". */
  freeFoodIds: Set<string>;
}

export function makeContext(data: Pick<AppData, 'foods' | 'recipes'>, diet?: Diet | null): CalcContext {
  return {
    foods: new Map(data.foods.map((f) => [f.id, f])),
    recipes: new Map(data.recipes.map((r) => [r.id, r])),
    exchangeDocs: diet?.exchangeDocs ?? [],
    freeFoodIds: new Set(diet?.freeFoodIds ?? []),
  };
}

const zeroNutrients = () =>
  Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, 0])) as Record<NutrientKey, number>;
const flags = (v: boolean) =>
  Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, v])) as Record<NutrientKey, boolean>;

export function emptyTotals(): Totals {
  return { nutrients: zeroNutrients(), unknown: flags(false), portions: {}, portionsIncomplete: false, issues: [] };
}

export function addTotals(a: Totals, b: Totals): Totals {
  const out = emptyTotals();
  for (const k of NUTRIENT_KEYS) {
    out.nutrients[k] = a.nutrients[k] + b.nutrients[k];
    out.unknown[k] = a.unknown[k] || b.unknown[k];
  }
  out.portions = addPortions(a.portions, b.portions);
  out.portionsIncomplete = a.portionsIncomplete || b.portionsIncomplete;
  out.issues = [...a.issues, ...b.issues];
  return out;
}

export const sumTotals = (list: Totals[]) => list.reduce(addTotals, emptyTotals());

export function scaleTotals(t: Totals, factor: number): Totals {
  const out = { ...t, nutrients: { ...t.nutrients }, portions: {} as Portions };
  for (const k of NUTRIENT_KEYS) out.nutrients[k] = t.nutrients[k] * factor;
  for (const g of EXCHANGE_GROUPS) if (t.portions[g] !== undefined) out.portions[g] = t.portions[g]! * factor;
  return out;
}

export function addPortions(a: Portions, b: Portions): Portions {
  const out: Portions = { ...a };
  for (const g of EXCHANGE_GROUPS) if (b[g] !== undefined) out[g] = (out[g] ?? 0) + b[g]!;
  return out;
}

/** Valores de un alimento para una cantidad. Escala por regla de tres desde su referencia. */
export function foodNutrients(food: Food, quantity: number, unit: Unit, ctx: CalcContext): Totals {
  const out = emptyTotals();
  const n = food.nutrition;
  if (!n) {
    out.unknown = flags(true);
    out.issues.push({ code: 'sin-datos-nutricionales', subject: food.name });
    return out;
  }
  const amount = convert(food, quantity, unit, n.unit, ctx);
  if (amount === null) {
    out.unknown = flags(true);
    out.issues.push({ code: 'unidad-incompatible', subject: food.name });
    return out;
  }
  const factor = amount / n.per;
  for (const k of NUTRIENT_KEYS) {
    const v = n.values[k];
    if (v === null) {
      out.unknown[k] = true;
    } else {
      out.nutrients[k] = v * factor;
    }
  }
  if (NUTRIENT_KEYS.some((k) => n.values[k] === null)) {
    out.issues.push({ code: 'nutriente-desconocido', subject: food.name });
  }
  return out;
}

/** Porciones de intercambio de un alimento según la dieta activa. */
export function foodPortions(food: Food, quantity: number, unit: Unit, ctx: CalcContext): Totals {
  const out = emptyTotals();
  if (ctx.freeFoodIds.has(food.id)) return out;
  if (unit === 'porcion') {
    if (food.group) {
      out.portions = { [food.group]: quantity };
      return out;
    }
  } else {
    const eq = findEquivalence(food, unit, ctx);
    if (eq) {
      const factor = quantity / eq.amount;
      for (const g of EXCHANGE_GROUPS) if (eq.portions[g] !== undefined) out.portions[g] = eq.portions[g]! * factor;
      return out;
    }
  }
  out.portionsIncomplete = true;
  out.issues.push({ code: 'sin-equivalencia', subject: food.name });
  return out;
}

export function findEquivalence(food: Food, unit: Unit, ctx: CalcContext) {
  for (const doc of ctx.exchangeDocs) {
    const eq = food.equivalences.find((e) => e.unit === unit && e.source.doc === doc);
    if (eq) return eq;
  }
  return undefined;
}

/**
 * Convierte una cantidad a la unidad de referencia nutricional.
 * Solo se permite misma unidad o pasar por "porción" con una equivalencia documentada.
 * Nunca g↔ml (haría falta densidad) ni g↔unidad sin documento.
 */
function convert(food: Food, quantity: number, from: Unit, to: Unit, ctx: CalcContext): number | null {
  if (from === to) return quantity;
  if (from === 'porcion' && food.group) {
    const eq = findEquivalence(food, to, ctx);
    const per = eq?.portions[food.group];
    if (eq && per) return (quantity * eq.amount) / per;
  }
  return null;
}

/** Unidades en las que se puede medir un alimento con datos útiles para la dieta activa. La primera es la sugerida. */
export function unitsFor(food: Food, ctx: CalcContext): Unit[] {
  const units: Unit[] = [];
  for (const doc of ctx.exchangeDocs) {
    for (const e of food.equivalences) if (e.source.doc === doc && e.unit !== 'porcion') units.push(e.unit);
  }
  if (food.nutrition) units.push(food.nutrition.unit);
  if (food.group) units.push('porcion');
  if (units.length === 0) units.push('g', 'unidad');
  return [...new Set(units)];
}

/** Cantidad sugerida: 1 porción según la equivalencia de la dieta, o la referencia nutricional. */
export function suggestedAmount(food: Food, unit: Unit, ctx: CalcContext): number {
  if (unit === 'porcion') return 1;
  const eq = findEquivalence(food, unit, ctx);
  if (eq) {
    const groups = Object.values(eq.portions);
    return groups.length === 1 && groups[0] ? eq.amount / groups[0] : eq.amount;
  }
  if (food.nutrition?.unit === unit) return food.nutrition.per;
  return unit === 'unidad' ? 1 : 100;
}

export function foodTotals(food: Food, quantity: number, unit: Unit, ctx: CalcContext): Totals {
  const nutr = foodNutrients(food, quantity, unit, ctx);
  const port = foodPortions(food, quantity, unit, ctx);
  return { ...nutr, portions: port.portions, portionsIncomplete: port.portionsIncomplete, issues: [...nutr.issues, ...port.issues] };
}

export function ingredientTotals(ing: Ingredient, ctx: CalcContext): Totals {
  if (!ing.foodId || ing.quantity === undefined || !ing.unit) {
    // Texto libre: si la dieta lo considera "no contabilizar" (note === 'libre'), no penaliza.
    if (ing.note === 'libre') return emptyTotals();
    return incomplete('ingrediente-sin-calcular', ing.label);
  }
  const food = ctx.foods.get(ing.foodId);
  if (!food) return incomplete('no-encontrado', ing.label);
  return foodTotals(food, ing.quantity, ing.unit, ctx);
}

/** Totales de la receta completa (todas sus raciones). */
export function recipeTotals(recipe: Recipe, ctx: CalcContext): Totals {
  return sumTotals(recipe.ingredients.map((i) => ingredientTotals(i, ctx)));
}

export function recipePerServing(recipe: Recipe, ctx: CalcContext): Totals {
  return scaleTotals(recipeTotals(recipe, ctx), 1 / recipe.servings);
}

/** Totales de un elemento de plan o de ingesta. Las recetas se miden en raciones. */
export function itemTotals(ref: ItemRef, quantity: number, unit: Unit, ctx: CalcContext): Totals {
  if (ref.kind === 'food') {
    const food = ctx.foods.get(ref.foodId);
    return food ? foodTotals(food, quantity, unit, ctx) : incomplete('no-encontrado', ref.foodId);
  }
  const recipe = ctx.recipes.get(ref.recipeId);
  if (!recipe) return incomplete('no-encontrado', ref.recipeId);
  if (unit !== 'racion') return incomplete('unidad-incompatible', recipe.name);
  return scaleTotals(recipePerServing(recipe, ctx), quantity);
}

function incomplete(code: IssueCode, subject: string): Totals {
  const t = emptyTotals();
  t.unknown = flags(true);
  t.portionsIncomplete = true;
  t.issues.push({ code, subject });
  return t;
}

export const isComplete = (t: Totals) => !t.portionsIncomplete && NUTRIENT_KEYS.every((k) => !t.unknown[k]);
export const nutrientsAllUnknown = (t: Totals) =>
  NUTRIENT_KEYS.every((k) => t.unknown[k] && t.nutrients[k] === 0);

// ── Objetivos ────────────────────────────────────────────────

export interface Progress {
  target?: number;
  consumed: number;
  planned: number;
  /** Solo con objetivo. Nunca negativo. */
  remaining?: number;
  /** Cuánto se ha superado el objetivo (0 si no). */
  exceededBy?: number;
  /** consumido / objetivo, sin recortar. */
  ratio?: number;
}

export function progress(target: number | undefined, consumed: number, planned: number): Progress {
  if (target === undefined || target < 0) return { consumed, planned };
  return {
    target,
    consumed,
    planned,
    remaining: Math.max(target - consumed, 0),
    exceededBy: Math.max(consumed - target, 0),
    ratio: target > 0 ? consumed / target : undefined,
  };
}
