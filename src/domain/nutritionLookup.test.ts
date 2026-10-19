import { describe, expect, it } from 'vitest';
import { fixtureData } from '../data/fixtures';
import { applyNutritionLookup, sanitizeNutritionLookup } from './nutritionLookup';

const item = (o: Record<string, unknown>) => ({ id: 'arroz', found: true, unit: 'g', kcal: 350, protein: 7, carbs: 78, fat: 1, source_name: 'BEDCA', source_url: 'https://www.bedca.net/', note: null, ...o });

describe('búsqueda de datos nutricionales', () => {
  const asked = [{ id: 'arroz' }, { id: 'yogur' }];

  it('se queda solo con lo pedido, encontrado y con fuente', () => {
    const out = sanitizeNutritionLookup({ items: [
      item({}),
      item({ id: 'otro' }),
      item({ id: 'yogur', found: false }),
      item({ id: 'yogur', source_name: '' }),
      item({ id: 'arroz', kcal: 999 }), // repetido
    ] }, asked);
    expect(out).toEqual([{ foodId: 'arroz', unit: 'g', values: { kcal: 350, protein: 7, carbs: 78, fat: 1 }, source: 'BEDCA', url: 'https://www.bedca.net/', note: undefined, warnings: [] }]);
  });

  it('lo desconocido o fuera de rango queda como desconocido, nunca 0', () => {
    const [r] = sanitizeNutritionLookup({ items: [item({ kcal: null, fat: 140, protein: -2, source_url: 'javascript:x' })] }, asked);
    expect(r!.values).toEqual({ kcal: null, protein: null, carbs: 78, fat: null });
    expect(r!.url).toBeUndefined();
    expect(sanitizeNutritionLookup({ items: [item({ kcal: null, protein: null, carbs: null, fat: null })] }, asked)).toEqual([]);
    expect(sanitizeNutritionLookup('basura', asked)).toEqual([]);
  });

  it('avisa si las calorías no cuadran con los macros', () => {
    const [r] = sanitizeNutritionLookup({ items: [item({ kcal: 100 })] }, asked);
    expect(r!.warnings[0]).toMatch(/no cuadran/);
  });

  it('guarda por 100 g, pendiente de revisión y con su fuente, sin pisar datos ya puestos', () => {
    const data = fixtureData();
    const withData = data.foods.find((f) => f.nutrition)!;
    const found = sanitizeNutritionLookup({ items: [item({}), item({ id: withData.id })] }, [{ id: 'arroz' }, { id: withData.id }]);
    const next = applyNutritionLookup(data, found, '2026-10-17');
    expect(next.foods.find((f) => f.id === 'arroz')!.nutrition).toEqual({
      per: 100, unit: 'g', values: { kcal: 350, protein: 7, carbs: 78, fat: 1 }, status: 'pendiente',
      source: 'BEDCA (https://www.bedca.net/) · buscado con Gemini el 2026-10-17',
    });
    expect(next.foods.find((f) => f.id === withData.id)!.nutrition).toEqual(withData.nutrition);
  });
});
