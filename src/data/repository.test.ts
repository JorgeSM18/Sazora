import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthError, ConflictError, CorruptDataError, HttpRepository, MemoryRepository, parseData } from './repository';
import { emptyData, fixtureData } from './fixtures';
import { removalBlocker, removeEntity } from './maintenance';
import { addPlanItem } from '../domain/planner';
import { consumePlanned } from '../domain/intake';

const item = { date: '2026-10-16', mealId: 'desayuno', ref: { kind: 'food' as const, foodId: 'arroz' }, quantity: 40, unit: 'g' as const };

describe('datos', () => {
  it('un usuario nuevo empieza vacío: sin lista ni pauta (no hereda las de prueba)', () => {
    const d = emptyData();
    expect(d.diet).toBeNull();
    expect(d.foods).toEqual([]);
    expect(d.documents).toEqual([]);
  });

  it('valida la forma de los datos', () => {
    expect(parseData(fixtureData()).diet!.name).toBe('Plan Nutricional 1.5');
    expect(parseData(emptyData()).diet).toBeNull();
    expect(() => parseData({ foods: 'x' })).toThrow(CorruptDataError);
    expect(() => parseData({ ...emptyData(), schemaVersion: 99 })).toThrow(/no soportada/);
  });

  it('el repositorio en memoria conserva copias independientes', async () => {
    const repo = new MemoryRepository();
    expect(await repo.load()).toBeNull();
    const data = fixtureData();
    data.plan = addPlanItem([], item);
    await repo.save(data);
    data.plan = [];
    expect((await repo.load())!.plan).toHaveLength(1);
  });
});

describe('repositorio del servidor', () => {
  afterEach(() => vi.unstubAllGlobals());
  const respond = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }));

  it('carga, guarda con la versión conocida y avanza la versión', async () => {
    const puts: number[] = [];
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
      if (init?.method !== 'PUT') return respond(200, { data: emptyData(), version: 3 });
      const { version } = JSON.parse(String(init.body)) as { version: number };
      puts.push(version);
      return respond(200, { version: version + 1 });
    });
    const repo = new HttpRepository();
    expect((await repo.load())!.diet).toBeNull();
    await repo.save(emptyData());
    await repo.save(emptyData());
    expect(puts).toEqual([3, 4]);
  });

  it('distingue conflicto entre dispositivos y sesión caducada', async () => {
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => (init?.method === 'PUT' ? respond(409, { conflict: true }) : respond(401, {})));
    const repo = new HttpRepository();
    await expect(repo.load()).rejects.toBeInstanceOf(AuthError);
    await expect(repo.save(emptyData())).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('borrado seguro', () => {
  it('no deja borrar lo que ya consta como comido, y al borrar limpia lo planificado', () => {
    const data = fixtureData();
    const mine = { ...data.recipes[0]!, id: 'mia', origin: 'usuario' as const };
    data.recipes.push(mine);
    data.plan = addPlanItem([], { ...item, ref: { kind: 'recipe', recipeId: 'mia' }, quantity: 1, unit: 'racion' });
    expect(removalBlocker(data, { kind: 'recipe', id: 'mia' })).toBeNull();
    const removed = removeEntity(data, { kind: 'recipe', id: 'mia' });
    expect(removed.plan).toHaveLength(0);
    expect(removed.recipes.some((r) => r.id === 'mia')).toBe(false);

    data.intake = consumePlanned([], data.plan[0]!);
    expect(removalBlocker(data, { kind: 'recipe', id: 'mia' })).toMatch(/comido/);
    expect(removeEntity(data, { kind: 'recipe', id: 'mia' })).toBe(data);
    expect(removalBlocker(data, { kind: 'food', id: 'huevo' })).toMatch(/recetas/);
  });
});
