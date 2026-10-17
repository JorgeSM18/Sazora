// Importación de la lista de alimentos (tabla de intercambios) extraída de un PDF por IA.
// Entrada no fiable: se sanea, se comprueba y solo se guarda cuando el usuario confirma.

import { EXCHANGE_GROUPS, GROUP_LABELS, type AppData, type ExchangeGroup, type Food, type FoodState, type PortionEquivalence } from './types';
import type { Check, ImportedDocument } from './importPlan';

export interface FoodListItem {
  name: string;
  amount: number | null;
  unit: 'g' | 'ml' | null;
  household: string | null;
  units_per_portion: number | null;
  unit_label: string | null;
  state: FoodState;
}

export interface FoodListGroup {
  group: ExchangeGroup;
  title: string;
  page: number;
  note: string | null;
  items: FoodListItem[];
}

export interface FoodList {
  title: string;
  author: string | null;
  version: string | null;
  groups: FoodListGroup[];
  doubts: { text: string; page: number }[];
}

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? v.map(obj) : []);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const strOrNull = (v: unknown) => str(v) || null;
const positive = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const pageOf = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : 1);
const STATES: FoodState[] = ['crudo', 'cocido', 'escurrido', 'listo', 'otro'];

/** Mismo criterio de ids que server/gemini.mjs (slug): la pauta del mismo PDF enlaza con estos ids. */
export const foodId = (name: string) =>
  name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function sanitizeFoodList(input: unknown): FoodList {
  const x = obj(input);
  return {
    title: str(x.title) || 'Lista de alimentos',
    author: strOrNull(x.author),
    version: strOrNull(x.version),
    groups: arr(x.groups)
      .filter((g) => EXCHANGE_GROUPS.includes(g.group as ExchangeGroup))
      .map((g) => ({
        group: g.group as ExchangeGroup,
        title: str(g.title) || GROUP_LABELS[g.group as ExchangeGroup],
        page: pageOf(g.page),
        note: strOrNull(g.note),
        items: arr(g.items)
          .filter((i) => foodId(str(i.name)))
          .map((i) => ({
            name: str(i.name),
            amount: positive(i.amount),
            unit: i.unit === 'ml' ? 'ml' : i.amount === null || i.amount === undefined ? null : 'g',
            household: strOrNull(i.household),
            units_per_portion: positive(i.units_per_portion),
            unit_label: strOrNull(i.unit_label),
            state: STATES.includes(i.state as FoodState) ? (i.state as FoodState) : 'otro',
          })),
      })),
    doubts: arr(x.doubts).filter((d) => str(d.text)).map((d) => ({ text: str(d.text), page: pageOf(d.page) })),
  };
}

const hasMeasure = (g: FoodListGroup, i: FoodListItem) => i.amount !== null || i.units_per_portion !== null || g.group === 'vegetales';

export function checkFoodList(list: FoodList): Check[] {
  const checks: Check[] = [];
  const total = list.groups.reduce((n, g) => n + g.items.length, 0);
  checks.push(total > 0 ? { ok: true, text: `${total} alimentos en ${list.groups.length} tablas.` } : { ok: false, text: 'No se ha encontrado ningún alimento.' });
  const missing = EXCHANGE_GROUPS.filter((g) => !list.groups.some((x) => x.group === g));
  if (missing.length) checks.push({ ok: false, text: `No aparece ninguna tabla de: ${missing.map((g) => GROUP_LABELS[g].toLowerCase()).join(', ')}.` });
  const noMeasure = list.groups.flatMap((g) => g.items.filter((i) => !hasMeasure(g, i)).map((i) => i.name));
  if (noMeasure.length) checks.push({ ok: false, text: `Sin cantidad por porción (no se podrán contar): ${noMeasure.join(', ')}.` });
  const seen = new Set<string>();
  const dup = list.groups.flatMap((g) => g.items.filter((i) => (seen.has(foodId(i.name)) ? true : (seen.add(foodId(i.name)), false))).map((i) => i.name));
  if (dup.length) checks.push({ ok: false, text: `Repetidos (se guarda la primera aparición): ${dup.join(', ')}.` });
  return checks;
}

/** Documento de lista vigente: el último importado. */
export const currentListDocId = (data: Pick<AppData, 'documents'>): string | undefined =>
  [...data.documents].reverse().find((d) => d.kind === 'lista-intercambios')?.id;

/**
 * Guarda la lista. Cada alimento recibe las equivalencias de este documento (sin borrar las de
 * listas anteriores) y la pauta, si existe, pasa a usar esta lista.
 */
export function applyFoodList(data: AppData, list: FoodList, doc: ImportedDocument): AppData {
  const docId = doc.id;
  const byId = new Map(data.foods.map((f) => [f.id, { ...f, equivalences: f.equivalences.filter((e) => e.source.doc !== docId) }]));
  const added = new Set<string>();

  for (const g of list.groups) {
    for (const i of g.items) {
      const id = foodId(i.name);
      if (added.has(id)) continue; // repetido en la misma lista
      added.add(id);
      const source = { doc: docId, page: g.page, section: g.title, raw: [i.name, i.amount ?? '-', i.household ?? ''].join(' | ') };
      const eqs: PortionEquivalence[] = [];
      const base = { portions: { [g.group]: 1 }, householdMeasure: i.household ?? undefined, source, status: 'verificado' as const };
      if (i.amount !== null) eqs.push({ ...base, amount: i.amount, unit: i.unit ?? 'g' });
      if (i.units_per_portion !== null) eqs.push({ ...base, amount: i.units_per_portion, unit: 'unidad' });
      if (eqs.length === 0 && g.group === 'vegetales') eqs.push({ ...base, amount: 1, unit: 'porcion', householdMeasure: g.note ?? undefined });

      const existing = byId.get(id);
      if (existing) {
        byId.set(id, { ...existing, equivalences: [...existing.equivalences, ...eqs] });
      } else {
        const food: Food = {
          id,
          name: i.name,
          state: i.state,
          group: g.group,
          unitLabel: i.unit_label ?? (g.group === 'vegetales' && eqs[0]?.unit === 'porcion' ? 'porción' : undefined),
          equivalences: eqs,
          origin: 'documento',
          status: eqs.length ? 'verificado' : 'pendiente',
          notes: [g.note, eqs.length ? null : 'La lista no indica cuánto es una porción.'].filter(Boolean).join(' ') || undefined,
        };
        byId.set(id, food);
      }
    }
  }

  const previousLists = new Set(data.documents.filter((d) => d.kind === 'lista-intercambios').map((d) => d.id));
  const withThisList = (docs: string[]) => [...docs.filter((d) => !previousLists.has(d) && d !== docId), docId];
  return {
    ...data,
    documents: [
      ...data.documents.filter((d) => d.id !== docId),
      {
        id: docId,
        title: list.title,
        file: doc.url,
        author: list.author ?? undefined,
        version: list.version ?? undefined,
        kind: 'lista-intercambios',
        review: [
          ...checkFoodList(list).filter((c) => !c.ok).map((c, k) => ({ id: `${docId}-c${k}`, text: c.text, source: { doc: docId }, resolved: false })),
          ...list.doubts.map((d, k) => ({ id: `${docId}-d${k}`, text: d.text, source: { doc: docId, page: d.page }, resolved: false })),
        ],
      },
    ],
    foods: [...byId.values()],
    diet: data.diet && { ...data.diet, documents: withThisList(data.diet.documents), exchangeDocs: withThisList(data.diet.exchangeDocs) },
  };
}
