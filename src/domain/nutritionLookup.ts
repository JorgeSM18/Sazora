// Datos nutricionales buscados en la web por Gemini (por 100 g o 100 ml). Entrada no fiable: se sanea,
// se revisa antes de guardar y se guarda como "pendiente de revisión" con su fuente. Nunca pisa datos ya puestos.

import { NUTRIENT_KEYS, type AppData, type Food, type Nutrients } from './types';

export interface NutritionFound {
  foodId: string;
  unit: 'g' | 'ml';
  values: Nutrients;
  source: string;
  url?: string;
  note?: string;
  /** Avisos de coherencia (no bloquean: se ven al revisar). */
  warnings: string[];
}

type Raw = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const MAX: Record<keyof Nutrients, number> = { kcal: 900, protein: 100, carbs: 100, fat: 100 };

/** Solo resultados de alimentos pedidos, con fuente y valores en rango. Lo que no se encontró se descarta. */
export function sanitizeNutritionLookup(input: unknown, asked: Pick<Food, 'id'>[]): NutritionFound[] {
  const ids = new Set(asked.map((f) => f.id));
  const items = Array.isArray((input as Raw)?.items) ? ((input as Raw).items as Raw[]) : [];
  const out: NutritionFound[] = [];
  for (const i of items) {
    const foodId = str(i?.id);
    const source = str(i?.source_name);
    if (!ids.has(foodId) || i.found !== true || !source || out.some((o) => o.foodId === foodId)) continue;
    const values = Object.fromEntries(NUTRIENT_KEYS.map((k) => {
      const n = num(i[k]);
      return [k, n !== null && n >= 0 && n <= MAX[k] ? n : null];
    })) as Nutrients;
    if (NUTRIENT_KEYS.every((k) => values[k] === null)) continue;
    const warnings: string[] = [];
    const { kcal, protein, carbs, fat } = values;
    if (protein !== null && carbs !== null && fat !== null) {
      if (protein + carbs + fat > 105) warnings.push('Los macros suman más de 100 g por 100.');
      const est = 4 * protein + 4 * carbs + 9 * fat;
      if (kcal !== null && est > 20 && Math.abs(kcal - est) / est > 0.25) warnings.push(`Las calorías no cuadran con los macros (≈${Math.round(est)} kcal).`);
    }
    const url = str(i.source_url);
    out.push({
      foodId,
      unit: i.unit === 'ml' ? 'ml' : 'g',
      values,
      source,
      url: /^https?:\/\//.test(url) ? url : undefined,
      note: str(i.note) || undefined,
      warnings,
    });
  }
  return out;
}

/** Guarda lo encontrado en los alimentos que siguen sin datos, como pendiente de revisión. */
export function applyNutritionLookup(data: AppData, found: NutritionFound[], date: string): AppData {
  const byId = new Map(found.map((f) => [f.foodId, f]));
  return {
    ...data,
    foods: data.foods.map((f) => {
      const n = byId.get(f.id);
      if (!n || f.nutrition) return f;
      const source = `${n.source}${n.url ? ` (${n.url})` : ''} · buscado con Gemini el ${date}${n.note ? ` · ${n.note}` : ''}`;
      return { ...f, nutrition: { per: 100, unit: n.unit, values: n.values, source, status: 'pendiente' } };
    }),
  };
}
