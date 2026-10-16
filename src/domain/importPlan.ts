// Importación de una pauta extraída de un PDF (por IA). La extracción es una entrada no fiable:
// se sanea, se comprueba y solo sustituye la pauta cuando el usuario la confirma.

import { EXCHANGE_GROUPS, type AppData, type Diet, type ExchangeGroup, type Food, type Ingredient, type MeasureUnit, type Portions, type Recipe, type RuleKind } from './types';
import { GROUP_LABELS } from './types';
import { currentListDocId } from './importFoodList';

export type ExtractedPortions = Partial<Record<ExchangeGroup, number | null>>;

export interface Extraction {
  plan_name: string;
  holder: string | null;
  version: string | null;
  meals: { name: string; page: number; portions: ExtractedPortions }[];
  daily_totals: ExtractedPortions;
  daily_totals_page: number | null;
  rules: { text: string; kind: RuleKind; page: number }[];
  equivalences: { food: string; catalog_id: string | null; amount: number; unit: MeasureUnit; portions: ExtractedPortions; page: number; raw: string }[];
  dishes: {
    meal: string;
    name: string;
    page: number;
    raw: string;
    ingredients: { label: string; catalog_id: string | null; quantity: number | null; unit: MeasureUnit | 'porcion' | null; not_counted: boolean }[];
  }[];
  doubts: { text: string; page: number }[];
}

// ── Saneado ──────────────────────────────────────────────

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? v.map(obj) : []);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const strOrNull = (v: unknown) => str(v) || null;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const pageOf = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : 1);
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback);
const KINDS: RuleKind[] = ['libre', 'equivalencia', 'sustitucion', 'restriccion', 'consejo'];

function portionsOf(v: unknown): ExtractedPortions {
  const o = obj(v);
  return Object.fromEntries(EXCHANGE_GROUPS.map((g) => [g, num(o[g])]));
}

export function sanitizeExtraction(input: unknown): Extraction {
  const x = obj(input);
  return {
    plan_name: str(x.plan_name) || 'Pauta importada',
    holder: strOrNull(x.holder),
    version: strOrNull(x.version),
    meals: arr(x.meals).filter((m) => str(m.name)).map((m) => ({ name: str(m.name), page: pageOf(m.page), portions: portionsOf(m.portions) })),
    daily_totals: portionsOf(x.daily_totals),
    daily_totals_page: num(x.daily_totals_page),
    rules: arr(x.rules).filter((r) => str(r.text)).map((r) => ({ text: str(r.text), kind: oneOf(r.kind, KINDS, 'consejo'), page: pageOf(r.page) })),
    equivalences: arr(x.equivalences)
      .filter((e) => str(e.food) && num(e.amount))
      .map((e) => ({ food: str(e.food), catalog_id: strOrNull(e.catalog_id), amount: num(e.amount)!, unit: oneOf(e.unit, ['g', 'ml', 'unidad'] as const, 'g'), portions: portionsOf(e.portions), page: pageOf(e.page), raw: str(e.raw) })),
    dishes: arr(x.dishes)
      .filter((d) => str(d.name) || str(d.raw))
      .map((d) => ({
        meal: str(d.meal),
        name: str(d.name) || str(d.raw).slice(0, 60),
        page: pageOf(d.page),
        raw: str(d.raw),
        ingredients: arr(d.ingredients)
          .filter((i) => str(i.label))
          .map((i) => ({
            label: str(i.label),
            catalog_id: strOrNull(i.catalog_id),
            quantity: num(i.quantity),
            unit: i.unit === null || i.unit === undefined ? null : oneOf(i.unit, ['g', 'ml', 'unidad', 'porcion'] as const, 'g'),
            not_counted: i.not_counted === true,
          })),
      })),
    doubts: arr(x.doubts).filter((d) => str(d.text)).map((d) => ({ text: str(d.text), page: pageOf(d.page) })),
  };
}

// ── Comprobaciones ───────────────────────────────────────

export interface Check {
  ok: boolean;
  text: string;
}

const defined = (p: ExtractedPortions): Portions =>
  Object.fromEntries(EXCHANGE_GROUPS.filter((g) => p[g] !== null && p[g] !== undefined).map((g) => [g, p[g]!])) as Portions;

export function checkExtraction(x: Extraction): Check[] {
  const checks: Check[] = [];
  checks.push(x.meals.length > 0 ? { ok: true, text: `${x.meals.length} comidas con porciones.` } : { ok: false, text: 'No se ha encontrado ninguna comida con porciones.' });
  for (const m of x.meals) {
    if (Object.keys(defined(m.portions)).length === 0) checks.push({ ok: false, text: `${m.name}: sin porciones.` });
  }
  const totals = defined(x.daily_totals);
  if (Object.keys(totals).length === 0) {
    checks.push({ ok: false, text: 'El documento no trae porciones totales del día: se calcularán sumando las comidas.' });
  } else {
    const wrong = EXCHANGE_GROUPS.filter((g) => {
      const sum = x.meals.reduce((s, m) => s + (m.portions[g] ?? 0), 0);
      return Math.abs(sum - (totals[g] ?? 0)) > 1e-9;
    });
    checks.push(
      wrong.length === 0
        ? { ok: true, text: 'La suma de las comidas coincide con las porciones totales del día.' }
        : { ok: false, text: `La suma de las comidas no coincide con el total del día en: ${wrong.map((g) => GROUP_LABELS[g].toLowerCase()).join(', ')}.` },
    );
  }
  return checks;
}

// ── Aplicar ──────────────────────────────────────────────

const slugify = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';

export interface ImportedDocument {
  id: string;
  url: string;
}

/** Ingredientes que no se podrán calcular (sin enlazar a un alimento conocido). */
export function unmatchedIngredients(x: Extraction, data: Pick<AppData, 'foods'>): string[] {
  const ids = new Set(data.foods.map((f) => f.id));
  return x.dishes.flatMap((d) => d.ingredients.filter((i) => !i.not_counted && !(i.catalog_id && ids.has(i.catalog_id) && i.quantity !== null && i.unit)).map((i) => `${i.label} (${d.name})`));
}

/**
 * Sustituye la pauta por la importada. Se conserva el historial (plan e ingesta), las recetas
 * propias y los alimentos. Los platos de la pauta anterior que ya se usaron pasan a recetas propias.
 */
export function applyImport(data: AppData, x: Extraction, doc: ImportedDocument, importedAt: string, model: string): AppData {
  const docId = doc.id;
  const listDocs = [currentListDocId(data)].filter((d): d is string => !!d);
  const src = (page: number, raw?: string) => ({ doc: docId, page, raw });
  const foodIds = new Set(data.foods.map((f) => f.id));
  const known = (id: string | null): id is string => !!id && foodIds.has(id);

  // Comidas
  const used = new Set<string>();
  const meals = x.meals.map((m) => {
    let id = slugify(m.name);
    while (used.has(id)) id += '-2';
    used.add(id);
    return { id, name: m.name, portionTargets: defined(m.portions) };
  });
  const mealIdByName = new Map(meals.map((m) => [slugify(m.name), m.id]));
  const totals = defined(x.daily_totals);
  const daily: Portions = Object.keys(totals).length
    ? totals
    : Object.fromEntries(EXCHANGE_GROUPS.map((g) => [g, meals.reduce((s, m) => s + (m.portionTargets[g] ?? 0), 0)]).filter(([, n]) => n));

  // Equivalencias del documento
  const extraEq = new Map<string, Food['equivalences']>();
  const newFoods: Food[] = [];
  x.equivalences.forEach((e, k) => {
    const portions = defined(e.portions);
    if (Object.keys(portions).length === 0) return;
    const eq = { amount: e.amount, unit: e.unit, portions, source: src(e.page, e.raw), status: 'pendiente' as const };
    if (known(e.catalog_id)) {
      extraEq.set(e.catalog_id, [...(extraEq.get(e.catalog_id) ?? []), eq]);
    } else {
      const groups = Object.keys(portions) as (keyof Portions)[];
      newFoods.push({
        id: `${docId}-f${k}`,
        name: e.food,
        state: 'otro',
        group: groups.length === 1 ? groups[0] : undefined,
        equivalences: [eq],
        origin: 'documento',
        status: 'pendiente',
        notes: 'Alimento añadido al importar la pauta. Revisa su estado (crudo, cocido…).',
      });
    }
  });

  // Platos de ejemplo
  const recipes: Recipe[] = x.dishes.map((d, k) => ({
    id: `${docId}-r${k}`,
    name: d.name,
    description: d.raw,
    servings: 1,
    steps: [],
    category: d.meal || 'Comida',
    tags: [x.plan_name],
    origin: 'documento',
    mealHint: mealIdByName.get(slugify(d.meal)),
    source: src(d.page, d.raw),
    status: 'pendiente',
    favorite: false,
    createdAt: importedAt,
    ingredients: d.ingredients.map((i): Ingredient =>
      i.not_counted
        ? { label: i.label, note: 'libre' }
        : known(i.catalog_id) && i.quantity !== null && i.unit
          ? { foodId: i.catalog_id, label: i.label, quantity: i.quantity, unit: i.unit }
          : { label: i.label, note: 'Sin enlazar a un alimento conocido.' },
    ),
  }));

  const failed = checkExtraction(x).filter((c) => !c.ok);
  const diet: Diet = {
    id: `diet-${docId}`,
    name: x.plan_name,
    holder: x.holder ?? '',
    documents: [docId, ...listDocs],
    documentVersion: x.version ?? undefined,
    importedAt: importedAt.slice(0, 10),
    status: 'pendiente',
    notes: [`Importada del PDF con IA (${model}). Revisa las porciones y las dudas antes de usarla como referencia.`],
    meals,
    dailyPortionTargets: daily,
    nutrientTargets: {},
    exchangeDocs: [docId, ...listDocs],
    rules: x.rules.map((r, k) => ({ id: `${docId}-n${k}`, kind: r.kind, text: r.text, source: src(r.page), status: 'verificado' })),
    freeFoodIds: [],
    review: [
      ...failed.map((c, k) => ({ id: `${docId}-c${k}`, text: c.text, source: src(x.daily_totals_page ?? 1), resolved: false })),
      ...x.doubts.map((d, k) => ({ id: `${docId}-d${k}`, text: d.text, source: src(d.page), resolved: false })),
    ],
  };

  // Platos de la pauta anterior: se quitan, salvo los que ya están en el plan o en lo comido.
  const referenced = new Set([...data.plan, ...data.intake].flatMap((i) => (i.ref.kind === 'recipe' ? [i.ref.recipeId] : [])));
  // Si se reimporta el mismo PDF, los platos nuevos sustituyen a los suyos (mismo id).
  const newIds = new Set(recipes.map((r) => r.id));
  const keptRecipes = data.recipes.flatMap((r) =>
    newIds.has(r.id) ? [] : r.origin !== 'documento' ? [r] : referenced.has(r.id) ? [{ ...r, origin: 'usuario' as const, tags: [...r.tags, 'pauta anterior'] }] : [],
  );
  // Lo que venga de una importación anterior del mismo documento se regenera.
  const ownPrefix = `${docId}-f`;
  const baseFoods = data.foods
    .filter((f) => !f.id.startsWith(ownPrefix))
    .map((f) => ({ ...f, equivalences: f.equivalences.filter((e) => e.source.doc !== docId) }));

  return {
    ...data,
    documents: [...data.documents.filter((d) => d.id !== docId), { id: docId, title: x.plan_name, file: doc.url, version: x.version ?? undefined, kind: 'plan' }],
    diet,
    foods: [...baseFoods.map((f) => (extraEq.has(f.id) ? { ...f, equivalences: [...f.equivalences, ...extraEq.get(f.id)!] } : f)), ...newFoods],
    recipes: [...keptRecipes, ...recipes],
  };
}
