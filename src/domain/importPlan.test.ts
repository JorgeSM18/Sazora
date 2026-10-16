import { describe, expect, it } from 'vitest';
import { applyImport, checkExtraction, sanitizeExtraction, unmatchedIngredients } from './importPlan';
import { fixtureData } from '../data/fixtures';
import { addPlanItem } from './planner';
import { consumePlanned } from './intake';
import { makeContext, foodTotals, recipePerServing } from './nutrition';
import { daySummary } from './day';

const p = (o: Record<string, number>) => ({ lacteos: null, vegetales: null, frutas: null, carbohidratos: null, proteinaMagra: null, proteinaSemimagra: null, grasas: null, ...o });

// Lo que devolvería Gemini para el Plan 1.5 (abreviado).
const raw = {
  plan_name: 'Plan Nutricional 1.6',
  holder: 'Persona de prueba',
  version: '1.6',
  meals: [
    { name: 'Desayuno', page: 2, portions: p({ frutas: 1, carbohidratos: 2, proteinaMagra: 2, proteinaSemimagra: 2, grasas: 1 }) },
    { name: 'Almuerzo', page: 2, portions: p({ vegetales: 1, carbohidratos: 2, proteinaMagra: 4, grasas: 2 }) },
  ],
  daily_totals: p({ lacteos: 0, vegetales: 1, frutas: 1, carbohidratos: 4, proteinaMagra: 6, proteinaSemimagra: 2, grasas: 4 }),
  daily_totals_page: 3,
  rules: [{ text: 'La mermelada sin azúcar no se contabiliza.', kind: 'libre', page: 6 }, { text: 'Regla rara', kind: 'inventado', page: 0 }],
  equivalences: [
    { food: 'Queso fresco light', catalog_id: 'queso-fresco-light', amount: 45, unit: 'g', portions: p({ proteinaMagra: 1 }), page: 9, raw: 'Queso fresco light 45g' },
    { food: 'Pan de centeno Marca X', catalog_id: null, amount: 1, unit: 'unidad', portions: p({ carbohidratos: 1 }), page: 13, raw: '1 rebanada = 1p' },
    { food: 'Inventado', catalog_id: 'no-existe', amount: 10, unit: 'g', portions: p({}), page: 5, raw: '' },
  ],
  dishes: [
    {
      meal: 'Almuerzo', name: 'Pollo con arroz', page: 4, raw: '120g de pollo con 40g de arroz y canela',
      ingredients: [
        { label: 'Pollo', catalog_id: 'pechuga-solomillo-de-pollo-o-pavo', quantity: 120, unit: 'g', not_counted: false },
        { label: 'Arroz', catalog_id: 'arroz', quantity: 40, unit: 'g', not_counted: false },
        { label: 'Canela', catalog_id: null, quantity: null, unit: null, not_counted: true },
        { label: 'Salsa secreta', catalog_id: 'inventada', quantity: 10, unit: 'g', not_counted: false },
      ],
    },
  ],
  doubts: [{ text: 'El total de grasas no se lee bien.', page: 3 }],
};
const DOC = { id: 'pdf-abc', url: '/api/documentos/abc.pdf' };

describe('saneado de la extracción', () => {
  it('descarta lo inválido sin romperse', () => {
    const x = sanitizeExtraction({ meals: [{ name: '' }, { name: 'Cena', portions: { grasas: -1, frutas: 'dos' } }], rules: 'no es lista' });
    expect(x.plan_name).toBe('Pauta importada');
    expect(x.meals).toHaveLength(1);
    expect(x.meals[0]!.portions.grasas).toBeNull();
    expect(x.meals[0]!.portions.frutas).toBeNull();
    expect(x.rules).toEqual([]);
    expect(sanitizeExtraction(null).meals).toEqual([]);
  });

  it('normaliza tipos de regla y páginas desconocidos', () => {
    const x = sanitizeExtraction(raw);
    expect(x.rules[1]).toEqual({ text: 'Regla rara', kind: 'consejo', page: 1 });
  });
});

describe('comprobaciones', () => {
  it('detecta que las comidas no suman el total del día', () => {
    const checks = checkExtraction(sanitizeExtraction(raw));
    expect(checks.find((c) => c.ok && c.text.includes('coincide'))).toBeUndefined();
    expect(checks.some((c) => !c.ok && /grasas/.test(c.text))).toBe(true);
  });

  it('da por buena una tabla que cuadra', () => {
    const ok = sanitizeExtraction({ ...raw, daily_totals: p({ vegetales: 1, frutas: 1, carbohidratos: 4, proteinaMagra: 6, proteinaSemimagra: 2, grasas: 3 }) });
    expect(checkExtraction(ok).every((c) => c.ok)).toBe(true);
  });
});

describe('aplicar la importación', () => {
  const before = fixtureData();
  // Historial: un plato de la pauta anterior ya comido.
  before.plan = addPlanItem([], { date: '2026-10-16', mealId: 'almuerzo', ref: { kind: 'recipe', recipeId: 'p15-almuerzo-3' }, quantity: 1, unit: 'racion' });
  before.intake = consumePlanned([], before.plan[0]!);
  const x = sanitizeExtraction(raw);
  const after = applyImport(before, x, DOC, '2026-10-20T10:00:00Z', 'modelo-test');

  it('sustituye la pauta con las porciones extraídas', () => {
    expect(after.diet!.name).toBe('Plan Nutricional 1.6');
    expect(after.diet!.meals.map((m) => m.id)).toEqual(['desayuno', 'almuerzo']);
    expect(after.diet!.meals[1]!.portionTargets).toEqual({ vegetales: 1, carbohidratos: 2, proteinaMagra: 4, grasas: 2 });
    expect(after.diet!.dailyPortionTargets.lacteos).toBe(0);
    expect(after.diet!.exchangeDocs).toEqual(['pdf-abc', 'lista-alimentos']);
    expect(after.diet!.nutrientTargets).toEqual({});
    expect(after.documents.find((d) => d.id === 'pdf-abc')!.file).toBe('/api/documentos/abc.pdf');
  });

  it('las dudas y las comprobaciones fallidas quedan para revisar', () => {
    const texts = after.diet!.review.map((r) => r.text);
    expect(texts).toContain('El total de grasas no se lee bien.');
    expect(texts.some((t) => t.includes('no coincide'))).toBe(true);
  });

  it('las equivalencias del nuevo plan prevalecen y crean alimentos nuevos si hace falta', () => {
    const ctx = makeContext(after, after.diet);
    expect(foodTotals(after.foods.find((f) => f.id === 'queso-fresco-light')!, 45, 'g', ctx).portions.proteinaMagra).toBe(1);
    const pan = after.foods.find((f) => f.name === 'Pan de centeno Marca X')!;
    expect(pan.group).toBe('carbohidratos');
    expect(after.foods.some((f) => f.name === 'Inventado')).toBe(false); // sin porciones: se descarta
  });

  it('los platos enlazan solo alimentos que existen; lo demás queda sin calcular', () => {
    const dish = after.recipes.find((r) => r.id === 'pdf-abc-r0')!;
    expect(dish.mealHint).toBe('almuerzo');
    expect(dish.ingredients.map((i) => i.foodId ?? i.note)).toEqual(['pechuga-solomillo-de-pollo-o-pavo', 'arroz', 'libre', 'Sin enlazar a un alimento conocido.']);
    expect(recipePerServing(dish, makeContext(after, after.diet)).portionsIncomplete).toBe(true);
    expect(unmatchedIngredients(x, before)).toEqual(['Salsa secreta (Pollo con arroz)']);
  });

  it('conserva el historial: lo comido sigue calculándose', () => {
    expect(after.recipes.some((r) => r.id === 'p15-almuerzo-1')).toBe(false); // plato anterior sin usar: fuera
    const kept = after.recipes.find((r) => r.id === 'p15-almuerzo-3')!;
    expect(kept.origin).toBe('usuario');
    expect(kept.tags).toContain('pauta anterior');
    const s = daySummary(after, after.diet!, '2026-10-16', makeContext(after, after.diet));
    expect(s.consumed.portions.proteinaMagra).toBe(4);
  });

  it('reimportar el mismo PDF no duplica nada', () => {
    const twice = applyImport(after, x, DOC, '2026-10-21T10:00:00Z', 'modelo-test');
    expect(twice.foods.length).toBe(after.foods.length);
    expect(twice.recipes.length).toBe(after.recipes.length);
    expect(twice.documents.length).toBe(after.documents.length);
    expect(twice.foods.find((f) => f.id === 'queso-fresco-light')!.equivalences.filter((e) => e.source.doc === 'pdf-abc')).toHaveLength(1);
  });
});
