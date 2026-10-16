// Datos de la app.
// - emptyData(): lo que tiene un usuario nuevo. Sin lista ni pauta: se importan desde sus PDF.
// - fixtureData(): datos de PRUEBA transcritos a mano de los PDF de docs/ (lista de alimentos y Plan 1.5).
//   Solo para pruebas automáticas y desarrollo; nunca se cargan para un usuario real.

import type { AppData } from '../../domain/types';
import { LISTA, listaFoods } from './lista-alimentos';
import { PLAN_15, PLAN_15_EXTRA_EQUIVALENCES, plan15Diet, plan15Foods, plan15Recipes } from './plan-1-5';

export const SCHEMA_VERSION = 2;
export const FIXTURES_VERSION = 1;

export function emptyData(): AppData {
  return { schemaVersion: SCHEMA_VERSION, fixturesVersion: FIXTURES_VERSION, documents: [], diet: null, foods: [], recipes: [], plan: [], intake: [] };
}

export function fixtureData(): AppData {
  const foods = listaFoods().map((f) => ({
    ...f,
    equivalences: [...f.equivalences, ...(PLAN_15_EXTRA_EQUIVALENCES[f.id] ?? [])],
  }));
  return {
    ...emptyData(),
    documents: [PLAN_15, LISTA],
    diet: plan15Diet(),
    foods: [...foods, ...plan15Foods()],
    recipes: plan15Recipes(),
  };
}
