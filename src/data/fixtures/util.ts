import type { ExchangeGroup, Food, FoodState, PortionEquivalence, SourceRef, Verification } from '../../domain/types';

export const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export interface ExchangeRow {
  name: string;
  /** Gramos (o ml) por porción tal como figuran. null = celda vacía o "-". */
  amount: number | null;
  household?: string;
  /** Cuántas unidades equivalen a 1 porción, cuando la medida casera es un recuento claro. */
  units?: number;
  unitLabel?: string;
  state?: FoodState;
  /** Duda sobre la fila: queda pendiente de revisión. */
  review?: string;
  note?: string;
}

/** Convierte las filas de una tabla de intercambios en alimentos con equivalencias trazables. */
export function exchangeFoods(doc: string, page: number, section: string, group: ExchangeGroup, defaultState: FoodState, rows: ExchangeRow[]): Food[] {
  return rows.map((r) => {
    const source: SourceRef = { doc, page, section, raw: `${r.name} | ${r.amount ?? '-'} | ${r.household ?? ''}`.trim() };
    const status: Verification = r.review ? 'pendiente' : 'verificado';
    const equivalences: PortionEquivalence[] = [];
    if (r.amount !== null) {
      equivalences.push({ amount: r.amount, unit: 'g', portions: { [group]: 1 }, householdMeasure: r.household, source, status, note: r.review });
    }
    if (r.units) {
      equivalences.push({ amount: r.units, unit: 'unidad', portions: { [group]: 1 }, householdMeasure: r.household, source, status, note: r.review });
    }
    return {
      id: slug(r.name),
      name: r.name,
      state: r.state ?? defaultState,
      group,
      unitLabel: r.unitLabel,
      equivalences,
      origin: 'documento',
      status,
      notes: [r.note, r.review].filter(Boolean).join(' ') || undefined,
    };
  });
}
