import { describe, expect, it } from 'vitest';
import { foodTotals, itemTotals, makeContext, progress, recipePerServing, recipeTotals, sumTotals } from './nutrition';
import type { Diet, Food, Recipe } from './types';

const src = { doc: 'test' };
const food = (id: string, per100: [number | null, number | null, number | null, number | null] | null, extra: Partial<Food> = {}): Food => ({
  id,
  name: id,
  state: 'crudo',
  equivalences: [],
  origin: 'usuario',
  status: 'pendiente',
  nutrition: per100 ? {
    per: 100,
    unit: 'g',
    values: { kcal: per100[0], protein: per100[1], carbs: per100[2], fat: per100[3] },
    source: 'test',
    status: 'pendiente',
  } : undefined,
  ...extra,
});

const pollo = food('pollo', [150, 10, 0, 8], {
  group: 'proteinaMagra',
  equivalences: [{ amount: 30, unit: 'g', portions: { proteinaMagra: 1 }, source: src, status: 'verificado' }],
});
const arroz = food('arroz', [350, 7, 78, 1], {
  group: 'carbohidratos',
  equivalences: [{ amount: 20, unit: 'g', portions: { carbohidratos: 1 }, source: src, status: 'verificado' }],
});
const misterio = food('misterio', null);
const parcial = food('parcial', [null, 20, null, null]);
const leche = food('leche', null, {
  nutrition: { per: 100, unit: 'ml', values: { kcal: 40, protein: 3, carbs: 5, fat: 1 }, source: 't', status: 'pendiente' },
});

const diet = { exchangeDocs: ['test'], freeFoodIds: [] } as unknown as Diet;
const recipe: Recipe = {
  id: 'r1', name: 'Pollo con arroz', description: '', servings: 2, steps: [], category: 'Comida', tags: [],
  origin: 'usuario', status: 'pendiente', favorite: false, createdAt: '',
  ingredients: [
    { foodId: 'pollo', label: 'pollo', quantity: 200, unit: 'g' },
    { foodId: 'arroz', label: 'arroz', quantity: 80, unit: 'g' },
  ],
};
const ctx = makeContext({ foods: [pollo, arroz, misterio, parcial, leche], recipes: [recipe] }, diet);

describe('escalado de un alimento', () => {
  it('escala por 100 g con la cantidad real (ejemplo de referencia)', () => {
    const t = foodTotals(pollo, 200, 'g', ctx);
    expect(t.nutrients.kcal).toBe(300);
    expect(t.nutrients.protein).toBe(20);
    expect(t.unknown.kcal).toBe(false);
  });

  it('calcula porciones desde la equivalencia documentada', () => {
    expect(foodTotals(pollo, 90, 'g', ctx).portions).toEqual({ proteinaMagra: 3 });
  });

  it('convierte porciones a gramos para los nutrientes solo con equivalencia documentada', () => {
    const t = foodTotals(arroz, 2, 'porcion', ctx);
    expect(t.portions).toEqual({ carbohidratos: 2 });
    expect(t.nutrients.kcal).toBeCloseTo(140); // 2 × 20 g = 40 g
  });
});

describe('nutrientes desconocidos', () => {
  it('un alimento sin datos no aporta 0: queda marcado como desconocido', () => {
    const t = foodTotals(misterio, 100, 'g', ctx);
    expect(t.unknown).toEqual({ kcal: true, protein: true, carbs: true, fat: true });
    expect(t.issues.map((i) => i.code)).toContain('sin-datos-nutricionales');
  });

  it('un nutriente desconocido contamina el total como "incompleto" sin borrar los conocidos', () => {
    const t = sumTotals([foodTotals(pollo, 100, 'g', ctx), foodTotals(parcial, 100, 'g', ctx)]);
    expect(t.nutrients.protein).toBe(30);
    expect(t.unknown.protein).toBe(false);
    expect(t.nutrients.kcal).toBe(150);
    expect(t.unknown.kcal).toBe(true);
  });
});

describe('unidades incompatibles', () => {
  it('no convierte ml a g sin densidad', () => {
    const t = foodTotals(leche, 200, 'g', ctx);
    expect(t.unknown.kcal).toBe(true);
    expect(t.issues.map((i) => i.code)).toContain('unidad-incompatible');
  });

  it('sí calcula en la unidad de referencia', () => {
    expect(foodTotals(leche, 250, 'ml', ctx).nutrients.kcal).toBe(100);
  });

  it('sin equivalencia en esa unidad, las porciones quedan incompletas', () => {
    const t = foodTotals(pollo, 1, 'unidad', ctx);
    expect(t.portionsIncomplete).toBe(true);
    expect(t.portions).toEqual({});
  });

  it('una receta solo se mide en raciones', () => {
    expect(itemTotals({ kind: 'recipe', recipeId: 'r1' }, 100, 'g', ctx).issues[0]?.code).toBe('unidad-incompatible');
  });
});

describe('recetas', () => {
  it('suma varios ingredientes', () => {
    const t = recipeTotals(recipe, ctx);
    expect(t.nutrients.kcal).toBeCloseTo(300 + 280);
    expect(t.nutrients.protein).toBeCloseTo(20 + 5.6);
    expect(t.portions).toEqual({ proteinaMagra: 200 / 30, carbohidratos: 4 });
  });

  it('divide por raciones', () => {
    const t = recipePerServing(recipe, ctx);
    expect(t.nutrients.kcal).toBeCloseTo(290);
    expect(t.portions.carbohidratos).toBeCloseTo(2);
  });

  it('escala por raciones planificadas', () => {
    expect(itemTotals({ kind: 'recipe', recipeId: 'r1' }, 1.5, 'racion', ctx).nutrients.kcal).toBeCloseTo(435);
  });

  it('marca como incompleta una receta con ingredientes de texto libre no contabilizables', () => {
    const r = { ...recipe, ingredients: [...recipe.ingredients, { label: 'una salsa' }] };
    expect(recipeTotals(r, ctx).unknown.kcal).toBe(true);
    const libre = { ...recipe, ingredients: [...recipe.ingredients, { label: 'especias', note: 'libre' }] };
    expect(recipeTotals(libre, ctx).unknown.kcal).toBe(false);
  });

  it('no mezcla crudo y cocinado: un alimento cocinado sin datos no hereda los del crudo', () => {
    const arrozCocido = food('arroz-cocido', null, { state: 'cocido', group: 'carbohidratos' });
    const c = makeContext({ foods: [arroz, arrozCocido], recipes: [] }, diet);
    const t = foodTotals(arrozCocido, 100, 'g', c);
    expect(t.unknown.kcal).toBe(true);
    expect(t.portionsIncomplete).toBe(true);
  });
});

describe('objetivos', () => {
  it('sin objetivo no inventa restante ni porcentaje', () => {
    expect(progress(undefined, 500, 800)).toEqual({ consumed: 500, planned: 800 });
  });

  it('restante nunca negativo; el exceso se informa aparte', () => {
    const p = progress(2000, 2300, 2300);
    expect(p.remaining).toBe(0);
    expect(p.exceededBy).toBe(300);
    expect(p.ratio).toBeCloseTo(1.15);
  });

  it('objetivo 0 documentado: no hay porcentaje, cualquier consumo es exceso', () => {
    const p = progress(0, 1, 0);
    expect(p.ratio).toBeUndefined();
    expect(p.exceededBy).toBe(1);
  });
});
