import { describe, expect, it } from 'vitest';
import { fixtureData } from '../data/fixtures';
import { assistantContext, overRemaining, portionAmount, sanitizeAssistantReply } from './assistant';
import { daySummary } from './day';
import { makeContext, recipePerServing } from './nutrition';

const DATE = '2026-11-11';
function setup() {
  const data = fixtureData();
  const diet = data.diet!;
  // Comido hoy: 15 porciones de proteína magra (la pauta fija 13) y 3 de grasa (de 4).
  const eaten = (id: string, foodId: string, quantity: number) => ({ id, date: DATE, mealId: 'almuerzo', ref: { kind: 'food' as const, foodId }, quantity, unit: 'porcion' as const, status: 'registrado' as const, loggedAt: `${DATE}T12:00:00` });
  data.intake = [eaten('i1', 'pescado-blanco', 15), eaten('i2', 'aceite-de-oliva', 3)];
  const ctx = makeContext(data, diet);
  return { data, diet, ctx, summary: daySummary(data, diet, DATE, ctx) };
}

describe('contexto del asistente', () => {
  it('lleva las cifras del día ya calculadas, las indicaciones con su página y los alimentos con su id y equivalencia', () => {
    const { data, diet, ctx } = setup();
    const text = assistantContext(data, diet, DATE, ctx);
    expect(text).toContain('- Proteína magra: pauta 13 · comido 15 · planificado 0 · superado en 2');
    expect(text).toContain('- Grasas: pauta 4 · comido 3 · planificado 0 · quedan 1');
    expect(text).toMatch(/- Energía: comido sin datos · objetivo sin configurar/);
    expect(text).toMatch(/comido: Pescado blanco \(15 porcion\)/);
    const rule = diet.rules[0]!;
    expect(text).toContain(`- [${rule.kind}] ${rule.text} (pág. ${rule.source.page})`);
    expect(text).toMatch(/^arroz \| Arroz \[crudo\] \| Carbohidratos \| .*g = 1 Carbohidratos.*\| sin datos nutricionales$/m);
  });
});

describe('respuesta del asistente', () => {
  const recipe = (ingredients: unknown[]) => ({ reply: 'Idea', recipes: [{ name: 'Arroz con pescado', servings: 1, ingredients, steps: ['Cocer', ''] }] });

  it('acepta solo recetas con alimentos de la lista y unidades con equivalencia; los totales los calcula el motor', () => {
    const { data, ctx, summary } = setup();
    const ok = sanitizeAssistantReply(recipe([{ food_id: 'arroz', quantity: 2, unit: 'porcion' }, { food_id: 'aceite-de-oliva', quantity: 2, unit: 'porcion' }]), data, ctx, 'ahora');
    expect(ok).toMatchObject({ reply: 'Idea', discarded: 0, recipes: [{ name: 'Arroz con pescado', origin: 'usuario', status: 'pendiente', steps: ['Cocer'], ingredients: [{ foodId: 'arroz', label: 'Arroz', quantity: 2, unit: 'porcion' }, { foodId: 'aceite-de-oliva' }] }] });
    const totals = recipePerServing(ok.recipes[0]!, ctx);
    expect(totals.portions).toEqual({ carbohidratos: 2, grasas: 2 });
    // Quedaba 1 de grasa: la propuesta se pasa en 1. De carbohidratos queda de sobra.
    expect(overRemaining(totals.portions, summary)).toEqual([{ group: 'grasas', by: 1 }]);
    const arroz = data.foods.find((f) => f.id === 'arroz')!.equivalences.find((e) => e.unit === 'g')!;
    expect(portionAmount(ok.recipes[0]!.ingredients[0]!, ctx)).toEqual({ amount: (2 * arroz.amount) / arroz.portions.carbohidratos!, unit: 'g' });
  });

  it('descarta entera la receta con un alimento inventado, una cantidad no válida o una unidad sin equivalencia', () => {
    const { data, ctx } = setup();
    for (const bad of [{ food_id: 'unicornio', quantity: 1, unit: 'g' }, { food_id: 'arroz', quantity: -1, unit: 'g' }, { food_id: 'arroz', quantity: 1, unit: 'ml' }, { food_id: 'arroz', quantity: 1, unit: 'taza' }]) {
      expect(sanitizeAssistantReply(recipe([{ food_id: 'arroz', quantity: 1, unit: 'porcion' }, bad]), data, ctx, 'ahora')).toMatchObject({ recipes: [], discarded: 1 });
    }
    expect(sanitizeAssistantReply('basura', data, ctx, 'ahora')).toEqual({ reply: '', recipes: [], discarded: 0 });
  });
});
