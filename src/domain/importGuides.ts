// Guías de consulta importadas de PDF: tabla de crudo a cocido y productos por supermercado.
// Igual que el resto de importaciones: entrada no fiable, se sanea y se guarda al confirmar.

import { EXCHANGE_GROUPS, GROUP_LABELS, type AppData, type ConversionGuide, type ConversionRow, type DocumentKind, type ExchangeGroup, type Food, type GuideProduct, type MeasureUnit, type Portions, type ProductGuide, type SourceDocument } from './types';
import type { Check, ImportedDocument } from './importPlan';
import { foodId } from './importFoodList';

// ── Documento vigente de cada tipo ─────────────────────────

/** El último documento importado de ese tipo. */
export const currentDoc = (data: Pick<AppData, 'documents'>, kind: DocumentKind): SourceDocument | undefined =>
  [...data.documents].reverse().find((d) => d.kind === kind);

/** Documentos de consulta vigentes que aportan equivalencias, por orden de precedencia. */
export const guideDocIds = (data: Pick<AppData, 'documents'>): string[] =>
  (['lista-intercambios', 'productos', 'conversion'] as const).map((k) => currentDoc(data, k)?.id).filter((d): d is string => !!d);

/** Guarda el documento y hace que la pauta use este en lugar del anterior del mismo tipo. */
export function attachDocument(data: AppData, doc: SourceDocument): AppData {
  const previous = new Set(data.documents.filter((d) => d.kind === doc.kind).map((d) => d.id));
  const swap = (ids: string[]) => [...ids.filter((d) => !previous.has(d) && d !== doc.id), doc.id];
  return {
    ...data,
    documents: [...data.documents.filter((d) => d.id !== doc.id), doc],
    diet: data.diet && { ...data.diet, documents: swap(data.diet.documents), exchangeDocs: swap(data.diet.exchangeDocs) },
  };
}

/** Quita alimentos generados por documentos anteriores, salvo los que ya se usan (historial y recetas). */
function pruneGenerated(data: AppData, isGenerated: (f: Food) => boolean): Food[] {
  const used = new Set([
    ...[...data.plan, ...data.intake].flatMap((i) => (i.ref.kind === 'food' ? [i.ref.foodId] : [])),
    ...data.recipes.flatMap((r) => r.ingredients.map((i) => i.foodId).filter(Boolean) as string[]),
  ]);
  return data.foods.filter((f) => !isGenerated(f) || used.has(f.id));
}

// ── Saneado ────────────────────────────────────────────────

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? v.map(obj) : []);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const positive = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const pageOf = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : 1);
const literals = (v: unknown) => arr(v).filter((x) => str(x.text)).map((x) => ({ text: str(x.text), page: pageOf(x.page) }));
const isGroup = (g: unknown): g is ExchangeGroup => EXCHANGE_GROUPS.includes(g as ExchangeGroup);

export interface ConversionImport {
  title: string;
  rules: { text: string; page: number }[];
  rows: (Omit<ConversionRow, 'foodIds'> & { catalogIds: (string | null)[] })[];
  notes: { text: string; page: number }[];
  doubts: { text: string; page: number }[];
}

export function sanitizeConversion(input: unknown): ConversionImport {
  const x = obj(input);
  return {
    title: str(x.title) || 'De crudo a cocido',
    rules: literals(x.rules),
    notes: literals(x.notes),
    doubts: literals(x.doubts),
    rows: arr(x.items)
      .map((r) => {
        const names = (Array.isArray(r.names) ? r.names : []).map(str).filter(Boolean);
        const min = positive(r.cooked_min_grams);
        const max = positive(r.cooked_max_grams) ?? min;
        return {
          names,
          catalogIds: names.map((_, k) => str((r.catalog_ids as unknown[] | undefined)?.[k]) || null),
          section: str(r.section) || 'Otros',
          group: isGroup(r.group) ? r.group : ('carbohidratos' as ExchangeGroup),
          rawGrams: positive(r.raw_grams) ?? 0,
          cookedMin: Math.min(min ?? 0, max ?? 0),
          cookedMax: Math.max(min ?? 0, max ?? 0),
          page: pageOf(r.page),
        };
      })
      .filter((r) => r.names.length && r.rawGrams > 0 && r.cookedMin > 0),
  };
}

export interface ProductImport {
  title: string;
  author: string | null;
  stores: { store: string; products: { name: string; category: string; amount: number | null; unit: MeasureUnit | null; unitLabel: string | null; portions: Portions; raw: string; page: number }[] }[];
  doubts: { text: string; page: number }[];
}

export function sanitizeProducts(input: unknown): ProductImport {
  const x = obj(input);
  return {
    title: str(x.title) || 'Productos recomendados',
    author: str(x.author) || null,
    doubts: literals(x.doubts),
    stores: arr(x.stores)
      .filter((s) => str(s.store))
      .map((s) => ({
        store: str(s.store),
        products: arr(s.products)
          .filter((p) => str(p.name))
          .map((p) => {
            const portions = obj(p.portions);
            return {
              name: str(p.name),
              category: str(p.category) || 'Otros',
              amount: positive(p.amount),
              unit: (['g', 'ml', 'unidad'] as const).includes(p.unit as MeasureUnit) ? (p.unit as MeasureUnit) : null,
              unitLabel: str(p.unit_label) || null,
              portions: Object.fromEntries(EXCHANGE_GROUPS.filter((g) => positive(portions[g])).map((g) => [g, positive(portions[g])!])) as Portions,
              raw: str(p.raw),
              page: pageOf(p.page),
            };
          }),
      })),
  };
}

// ── Comprobaciones ─────────────────────────────────────────

/** Gramos crudos de 1 porción del alimento según la lista vigente. */
function portionRawGrams(food: Food, listDocId: string | undefined): number | null {
  const eq = food.equivalences.find((e) => e.unit === 'g' && e.source.doc === listDocId && food.group && e.portions[food.group]);
  return eq && food.group ? eq.amount / eq.portions[food.group]! : null;
}

export function checkConversion(c: ConversionImport, data: Pick<AppData, 'foods' | 'documents'>): Check[] {
  const ids = new Set(data.foods.map((f) => f.id));
  const linked = c.rows.flatMap((r) => r.catalogIds).filter((id): id is string => !!id && ids.has(id));
  const unlinked = c.rows.flatMap((r) => r.names.filter((_, k) => !(r.catalogIds[k] && ids.has(r.catalogIds[k]!))));
  const checks: Check[] = [{ ok: c.rows.length > 0, text: c.rows.length ? `${c.rows.length} filas de equivalencias de crudo a cocido.` : 'No se ha encontrado ninguna fila.' }];
  if (!currentDoc(data, 'lista-intercambios')) checks.push({ ok: false, text: 'Aún no tienes lista de alimentos: la tabla se guardará como guía, pero no se crearán los alimentos cocidos hasta que la importes y vuelvas a subir esta tabla.' });
  else checks.push({ ok: true, text: `${linked.length} alimentos de tu lista tendrán su versión cocida.` });
  if (unlinked.length) checks.push({ ok: false, text: `Sin enlazar a tu lista (solo como guía): ${unlinked.join(', ')}.` });
  return checks;
}

export function checkProducts(p: ProductImport): Check[] {
  const all = p.stores.flatMap((s) => s.products);
  const withEq = all.filter((x) => x.amount && x.unit && Object.keys(x.portions).length).length;
  return [
    { ok: all.length > 0, text: all.length ? `${all.length} productos en ${p.stores.length} supermercados.` : 'No se ha encontrado ningún producto.' },
    { ok: true, text: `${withEq} con equivalencia en porciones (se podrán usar en el plan); el resto, solo como guía.` },
  ];
}

// ── Aplicar ────────────────────────────────────────────────

const fmtG = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','));

/**
 * Guarda la tabla de crudo a cocido y crea, para cada alimento de la lista que aparece en ella,
 * su versión cocida: el peso cocinado de 1 porción, escalado desde la porción en crudo de la lista.
 */
export function applyConversion(data: AppData, c: ConversionImport, doc: ImportedDocument): AppData {
  const listId = currentDoc(data, 'lista-intercambios')?.id;
  const oldDocs = new Set(data.documents.filter((d) => d.kind === 'conversion').map((d) => d.id).concat(doc.id));
  const generatedHere = (f: Food) => f.id.endsWith('-cocido') && f.equivalences.every((e) => oldDocs.has(e.source.doc));
  const foods = pruneGenerated(data, generatedHere);
  const byId = new Map(foods.map((f) => [f.id, f]));
  const created: Food[] = [];

  const rows: ConversionRow[] = c.rows.map((r) => {
    const foodIds: string[] = [];
    r.catalogIds.forEach((id) => {
      const base = id ? byId.get(id) : undefined;
      const raw = base && portionRawGrams(base, listId);
      if (!base || !raw || !base.group) return;
      foodIds.push(base.id);
      const min = (r.cookedMin * raw) / r.rawGrams;
      const max = (r.cookedMax * raw) / r.rawGrams;
      const cooked: Food = {
        id: `${base.id}-cocido`,
        name: `${base.name} (cocido)`,
        state: 'cocido',
        group: base.group,
        equivalences: [{
          amount: (min + max) / 2,
          unit: 'g',
          portions: { [base.group]: 1 },
          householdMeasure: `${min === max ? fmtG(min) : `${fmtG(min)}-${fmtG(max)}`} g cocido = ${fmtG(raw)} g crudo`,
          source: { doc: doc.id, page: r.page, section: r.section, raw: `${r.names.join(', ')} | ${r.rawGrams} g crudo | ${r.cookedMin === r.cookedMax ? r.cookedMin : `${r.cookedMin}-${r.cookedMax}`} g cocido` },
          status: min === max ? 'verificado' : 'pendiente',
          note: min === max ? undefined : 'La tabla da un rango: se usa el punto medio.',
        }],
        origin: 'documento',
        status: 'verificado',
        notes: 'Generado a partir de la tabla de crudo a cocido.',
      };
      if (!created.some((f) => f.id === cooked.id)) created.push(cooked);
    });
    return { names: r.names, foodIds, section: r.section, group: r.group, rawGrams: r.rawGrams, cookedMin: r.cookedMin, cookedMax: r.cookedMax, page: r.page };
  });

  const createdIds = new Set(created.map((f) => f.id));
  const guide: ConversionGuide = { type: 'conversion', rules: c.rules, rows, notes: c.notes };
  return attachDocument(
    { ...data, foods: [...foods.filter((f) => !createdIds.has(f.id)), ...created] },
    {
      id: doc.id,
      title: c.title,
      file: doc.url,
      kind: 'conversion',
      guide,
      review: c.doubts.map((d, k) => ({ id: `${doc.id}-d${k}`, text: d.text, source: { doc: doc.id, page: d.page }, resolved: false })),
    },
  );
}

const portionsLabel = (p: Portions) =>
  (Object.keys(p) as ExchangeGroup[]).map((g) => `${fmtG(p[g]!)} ${GROUP_LABELS[g].toLowerCase()}`).join(' + ');

/** Guarda la guía de productos; los que tienen equivalencia pasan a ser alimentos usables en el plan. */
export function applyProducts(data: AppData, p: ProductImport, doc: ImportedDocument): AppData {
  const oldDocs = new Set(data.documents.filter((d) => d.kind === 'productos').map((d) => d.id).concat(doc.id));
  const foods = pruneGenerated(data, (f) => f.equivalences.length > 0 && f.equivalences.every((e) => oldDocs.has(e.source.doc)) && f.origin === 'documento');
  const created: Food[] = [];
  let k = 0;

  const stores = p.stores.map((s) => ({
    store: s.store,
    products: s.products.map((x): GuideProduct => {
      const usable = x.amount && x.unit && Object.keys(x.portions).length > 0;
      const groups = Object.keys(x.portions) as ExchangeGroup[];
      let id: string | undefined;
      if (usable) {
        id = `${doc.id}-p${k++}-${foodId(x.name).slice(0, 40)}`;
        created.push({
          id,
          name: x.name,
          brand: s.store,
          state: 'listo',
          group: groups.length === 1 ? groups[0] : undefined,
          unitLabel: x.unit === 'unidad' ? x.unitLabel ?? undefined : undefined,
          equivalences: [{ amount: x.amount!, unit: x.unit!, portions: x.portions, householdMeasure: x.raw || undefined, source: { doc: doc.id, page: x.page, section: `${s.store} · ${x.category}`, raw: x.raw }, status: 'pendiente' }],
          origin: 'documento',
          status: 'pendiente',
          notes: `Producto recomendado (${s.store}). Revisa que coincide con el que compras.`,
        });
      }
      const unit = x.unit === 'unidad' ? x.unitLabel ?? 'unidad' : x.unit ?? '';
      return {
        name: x.name,
        category: x.category,
        foodId: id,
        equivalence: usable ? `${fmtG(x.amount!)} ${unit} = ${portionsLabel(x.portions)}` : '',
        raw: x.raw,
        page: x.page,
      };
    }),
  }));

  const guide: ProductGuide = { type: 'productos', stores };
  return attachDocument(
    { ...data, foods: [...foods, ...created] },
    {
      id: doc.id,
      title: p.title,
      file: doc.url,
      author: p.author ?? undefined,
      kind: 'productos',
      guide,
      review: p.doubts.map((d, n) => ({ id: `${doc.id}-d${n}`, text: d.text, source: { doc: doc.id, page: d.page }, resolved: false })),
    },
  );
}

// ── Consulta ───────────────────────────────────────────────

/** Gramos en crudo que corresponden a un peso cocinado, según una fila de la tabla (rango si la tabla lo da). */
export function cookedToRaw(row: Pick<ConversionRow, 'rawGrams' | 'cookedMin' | 'cookedMax'>, cookedGrams: number): { min: number; max: number } {
  // Más cocido por gramo crudo → menos crudo: el rango se invierte.
  return { min: (cookedGrams * row.rawGrams) / row.cookedMax, max: (cookedGrams * row.rawGrams) / row.cookedMin };
}
