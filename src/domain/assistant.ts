// Asistente: la IA interpreta y propone; los números son de Sazora.
// 1) `assistantContext`: lo que el modelo puede saber, ya calculado por el motor (pauta, día, alimentos, recetas).
// 2) `sanitizeAssistantReply`: lo que devuelve es entrada no fiable; una receta con un alimento que no está en
//    la lista, o en una unidad sin equivalencia, se descarta entera. Sus totales los calcula el motor, no el modelo.

import { daySummary, type DaySummary } from './day';
import { findEquivalence, recipePerServing, unitsFor, type CalcContext, type Totals } from './nutrition';
import { newId } from './planner';
import { EXCHANGE_GROUPS, GROUP_LABELS, NUTRIENT_KEYS, NUTRIENT_LABELS, type AppData, type Diet, type ExchangeGroup, type Ingredient, type ItemRef, type Portions, type Recipe, type Unit } from './types';

const n = (v: number) => String(Math.round(v * 100) / 100);
const portionsText = (p: Portions) => EXCHANGE_GROUPS.filter((g) => p[g]).map((g) => `${n(p[g]!)} ${GROUP_LABELS[g]}`).join(' + ') || 'ninguna';
const macrosText = (t: Totals) =>
  NUTRIENT_KEYS.map((k) => `${NUTRIENT_LABELS[k].label} ${t.unknown[k] && t.nutrients[k] === 0 ? 'sin datos' : `${t.unknown[k] ? '≥ ' : ''}${n(t.nutrients[k])} ${NUTRIENT_LABELS[k].unit}`}`).join(', ');

export function assistantContext(data: AppData, diet: Diet, date: string, ctx: CalcContext): string {
  const s = daySummary(data, diet, date, ctx);
  const label = (ref: ItemRef, quantity: number, unit: Unit) =>
    `${ref.kind === 'food' ? ctx.foods.get(ref.foodId)?.name ?? ref.foodId : ctx.recipes.get(ref.recipeId)?.name ?? ref.recipeId} (${n(quantity)} ${unit})`;
  const lines: string[] = [];

  lines.push(`PAUTA: ${diet.name}`, `Porciones al día: ${portionsText(diet.dailyPortionTargets)}`, 'Comidas:');
  for (const m of diet.meals) lines.push(`- ${m.name}: ${portionsText(m.portionTargets)}`);

  lines.push('', `RESUMEN DEL DÍA ${date} (calculado por Sazora)`, 'Porciones por grupo:');
  for (const { group, progress: p } of s.portions) {
    lines.push(`- ${GROUP_LABELS[group]}: pauta ${p.target === undefined ? 'sin fijar' : n(p.target)} · comido ${n(p.consumed)} · planificado ${n(p.planned)}${p.target === undefined ? '' : p.exceededBy ? ` · superado en ${n(p.exceededBy)}` : ` · quedan ${n(p.remaining!)}`}`);
  }
  if (s.consumed.portionsIncomplete) lines.push('(Hay cosas comidas que no se han podido pasar a porciones: lo comido puede ser más.)');
  lines.push('Energía y macros:');
  for (const k of NUTRIENT_KEYS) {
    const p = s.nutrients[k];
    const u = NUTRIENT_LABELS[k].unit;
    const eaten = s.consumed.unknown[k] ? (p.consumed === 0 ? 'sin datos' : `≥ ${n(p.consumed)} ${u} (faltan datos de algún alimento)`) : `${n(p.consumed)} ${u}`;
    const left = p.target === undefined ? 'objetivo sin configurar' : `objetivo ${n(p.target)} ${u} · ${p.exceededBy ? `superado en ${n(p.exceededBy)}` : `quedan ${s.consumed.unknown[k] ? 'como mucho ' : ''}${n(p.remaining!)}`} ${u}`;
    lines.push(`- ${NUTRIENT_LABELS[k].label}: comido ${eaten} · ${left}`);
  }
  lines.push('Por comida:');
  for (const m of s.meals) {
    lines.push(`- ${m.meal.name}: comido: ${m.intake.map((e) => label(e.ref, e.quantity, e.unit)).join('; ') || 'nada'} · planificado sin registrar: ${m.pending.map((i) => label(i.ref, i.quantity, i.unit)).join('; ') || 'nada'}`);
  }

  lines.push('', 'INDICACIONES DE LA PAUTA');
  for (const r of diet.rules) lines.push(`- [${r.kind}] ${r.text}${r.source.page ? ` (pág. ${r.source.page})` : ''}`);
  for (const d of data.documents) {
    if (d.guide?.type !== 'conversion') continue;
    for (const r of [...d.guide.rules, ...d.guide.notes]) lines.push(`- [crudo a cocido] ${r.text} (${d.title}, pág. ${r.page})`);
  }

  lines.push('', 'ALIMENTOS PERMITIDOS (id | nombre | grupo | equivalencias de la pauta | por 100)');
  for (const f of data.foods) {
    const eqs = ctx.exchangeDocs.flatMap((doc) => f.equivalences.filter((e) => e.source.doc === doc && e.unit !== 'porcion'));
    const eq = ctx.freeFoodIds.has(f.id) ? 'no se contabiliza' : eqs.map((e) => `${n(e.amount)} ${e.unit} = ${portionsText(e.portions)}`).join('; ') || 'sin equivalencia en peso';
    const nut = f.nutrition ? `por ${n(f.nutrition.per)} ${f.nutrition.unit}: ${NUTRIENT_KEYS.map((k) => `${NUTRIENT_LABELS[k].label} ${f.nutrition!.values[k] ?? 'sin datos'}`).join(', ')}` : 'sin datos nutricionales';
    lines.push(`${f.id} | ${f.name}${f.brand ? ` (${f.brand})` : ''} [${f.state}] | ${f.group ? GROUP_LABELS[f.group] : 'sin grupo'} | ${eq} | ${nut}`);
  }

  lines.push('', 'RECETAS GUARDADAS (nombre | por ración | ingredientes)');
  for (const r of data.recipes) {
    const t = recipePerServing(r, ctx);
    lines.push(`${r.name} | ${portionsText(t.portions)}${t.portionsIncomplete ? ' (incompleto)' : ''}; ${macrosText(t)} | ${r.ingredients.map((i) => `${i.label}${i.quantity !== undefined && i.unit ? ` ${n(i.quantity)} ${i.unit}` : ''}`).join(', ')}`);
  }
  return lines.join('\n');
}

export interface AssistantReply {
  reply: string;
  /** Propuestas válidas, listas para guardar (pendientes de revisión). */
  recipes: Recipe[];
  /** Propuestas descartadas por usar algo que no está en la lista de alimentos. */
  discarded: number;
}

type Raw = Record<string, unknown>;
const UNITS = ['porcion', 'g', 'ml', 'unidad'] as const;

export function sanitizeAssistantReply(input: unknown, data: Pick<AppData, 'foods'>, ctx: CalcContext, now: string): AssistantReply {
  const raw = (input ?? {}) as Raw;
  const foods = new Map(data.foods.map((f) => [f.id, f]));
  const recipes: Recipe[] = [];
  let discarded = 0;
  for (const r of Array.isArray(raw.recipes) ? (raw.recipes as Raw[]) : []) {
    const name = typeof r?.name === 'string' ? r.name.trim().slice(0, 120) : '';
    const list = Array.isArray(r?.ingredients) ? (r.ingredients as Raw[]) : [];
    const ingredients: Ingredient[] = [];
    for (const i of list) {
      const food = foods.get(String(i?.food_id));
      const unit = UNITS.find((u) => u === i?.unit);
      const quantity = typeof i?.quantity === 'number' && Number.isFinite(i.quantity) && i.quantity > 0 ? i.quantity : null;
      if (!food || !unit || quantity === null || !unitsFor(food, ctx).includes(unit)) break;
      ingredients.push({ foodId: food.id, label: food.name, quantity, unit });
    }
    if (!name || !list.length || ingredients.length !== list.length) {
      discarded++;
      continue;
    }
    const servings = Number.isInteger(r.servings) && (r.servings as number) > 0 ? (r.servings as number) : 1;
    const steps = (Array.isArray(r.steps) ? r.steps : []).filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim().slice(0, 500)).slice(0, 20);
    recipes.push({ id: newId('recipe'), name, description: 'Propuesta del asistente. Revísala antes de usarla.', ingredients, servings, steps, category: 'Comida', tags: ['asistente'], origin: 'usuario', status: 'pendiente', favorite: false, createdAt: now });
  }
  return { reply: typeof raw.reply === 'string' ? raw.reply.trim().slice(0, 6000) : '', recipes, discarded };
}

/** Grupos en los que unas porciones superan lo que queda del día según la pauta. Los grupos sin objetivo no se comprueban. */
export function overRemaining(portions: Portions, s: DaySummary): { group: ExchangeGroup; by: number }[] {
  return s.portions.flatMap(({ group, progress: p }) => {
    const by = (portions[group] ?? 0) - (p.remaining ?? Infinity);
    return by > 1e-9 ? [{ group, by }] : [];
  });
}

/** "2 porciones" de un alimento, en la cantidad que marca su equivalencia (p. ej. 40 g). null si no hay una directa. */
export function portionAmount(ing: Ingredient, ctx: CalcContext): { amount: number; unit: Unit } | null {
  const food = ing.foodId ? ctx.foods.get(ing.foodId) : undefined;
  if (!food?.group || ing.unit !== 'porcion' || ing.quantity === undefined) return null;
  for (const unit of ['g', 'ml', 'unidad'] as const) {
    const per = findEquivalence(food, unit, ctx);
    const portions = per?.portions[food.group];
    if (per && portions) return { amount: (ing.quantity * per.amount) / portions, unit };
  }
  return null;
}
