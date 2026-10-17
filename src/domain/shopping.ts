// De lo planificado a la lista de la compra: suma por alimento lo previsto en un rango de días.
// Se compra en crudo: lo planificado en porciones o cocinado se pasa a gramos en crudo cuando hay equivalencia.

import type { AppData, Food, Unit } from './types';
import { findEquivalence, type CalcContext } from './nutrition';
import { GROUP_LABELS } from './types';

export interface ShoppingSuggestion {
  key: string;
  text: string;
  quantity: string;
  category: string;
  /** Cantidad numérica y unidad, para sumar y mostrar. */
  amount?: number;
  unit?: 'g' | 'ml' | 'unidad';
  foodId?: string;
}

const fmt = (n: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: n < 10 ? 1 : 0 }).format(n);

/** Pasa una cantidad a una unidad de compra (g, ml o unidades) y el alimento cocido a su base en crudo. */
function toPurchase(food: Food, quantity: number, unit: Unit, ctx: CalcContext): { food: Food; amount: number; unit: 'g' | 'ml' | 'unidad' } | null {
  let amount = quantity;
  let u: Unit = unit;
  if (u === 'porcion' && food.group) {
    const eq = findEquivalence(food, 'g', ctx) ?? findEquivalence(food, 'unidad', ctx) ?? findEquivalence(food, 'ml', ctx);
    const per = eq?.portions[food.group];
    if (!eq || !per || eq.unit === 'porcion') return null;
    amount = (quantity * eq.amount) / per;
    u = eq.unit;
  }
  if (u !== 'g' && u !== 'ml' && u !== 'unidad') return null;
  // Cocido → crudo, con la equivalencia de la tabla de crudo a cocido y la porción en crudo de la lista.
  if (food.id.endsWith('-cocido') && u === 'g' && food.group) {
    const base = ctx.foods.get(food.id.slice(0, -'-cocido'.length));
    const cooked = findEquivalence(food, 'g', ctx);
    const raw = base && findEquivalence(base, 'g', ctx);
    const group = food.group;
    if (base && cooked && raw?.portions[group] && cooked.portions[group]) {
      const rawPerPortion = raw.amount / raw.portions[group]!;
      const cookedPerPortion = cooked.amount / cooked.portions[group]!;
      return { food: base, amount: (amount * rawPerPortion) / cookedPerPortion, unit: 'g' };
    }
  }
  return { food, amount, unit: u };
}

/** Sugerencias de compra para lo planificado entre `from` y `to` (fechas YYYY-MM-DD, incluidas). */
export function shoppingFromPlan(data: Pick<AppData, 'plan' | 'recipes' | 'foods'>, from: string, to: string, ctx: CalcContext): ShoppingSuggestion[] {
  const byKey = new Map<string, ShoppingSuggestion>();
  const addFood = (foodId: string, quantity: number, unit: Unit) => {
    const food = ctx.foods.get(foodId);
    if (!food) return;
    const p = toPurchase(food, quantity, unit, ctx);
    const target = p?.food ?? food;
    const key = p ? `${target.id}|${p.unit}` : `${food.id}|?`;
    const cur = byKey.get(key);
    const amount = (cur?.amount ?? 0) + (p?.amount ?? 0);
    byKey.set(key, {
      key,
      text: target.brand ? `${target.name} (${target.brand})` : target.name,
      category: target.group ? GROUP_LABELS[target.group] : 'Otros',
      foodId: target.id,
      ...(p ? { amount, unit: p.unit, quantity: `${fmt(amount)} ${p.unit === 'unidad' ? (target.unitLabel ? `${target.unitLabel}${amount === 1 ? '' : 's'}` : amount === 1 ? 'unidad' : 'unidades') : p.unit}` } : { quantity: '' }),
    });
  };
  const addText = (label: string) => {
    const key = `texto|${label.toLowerCase()}`;
    if (!byKey.has(key)) byKey.set(key, { key, text: label, quantity: '', category: 'Otros' });
  };

  for (const item of data.plan) {
    if (item.date < from || item.date > to) continue;
    if (item.ref.kind === 'food') {
      addFood(item.ref.foodId, item.quantity, item.unit);
      continue;
    }
    const recipe = ctx.recipes.get(item.ref.recipeId);
    if (!recipe || item.unit !== 'racion') continue;
    const factor = item.quantity / recipe.servings;
    for (const ing of recipe.ingredients) {
      if (ing.foodId && ing.quantity !== undefined && ing.unit) addFood(ing.foodId, ing.quantity * factor, ing.unit);
      else addText(ing.label);
    }
  }
  return [...byKey.values()].sort((a, b) => a.category.localeCompare(b.category, 'es') || a.text.localeCompare(b.text, 'es'));
}
