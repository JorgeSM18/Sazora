// Operaciones de mantenimiento sobre el conjunto de datos.

import type { AppData } from '../domain/types';

type Ref = { kind: 'food'; id: string } | { kind: 'recipe'; id: string };
const matches = (r: AppData['plan'][number]['ref'], ref: Ref) =>
  ref.kind === 'food' ? r.kind === 'food' && r.foodId === ref.id : r.kind === 'recipe' && r.recipeId === ref.id;

/** Motivo por el que no se puede borrar, o null. La ingesta real y las recetas que lo usan lo bloquean. */
export function removalBlocker(data: AppData, ref: Ref): string | null {
  const eaten = data.intake.filter((e) => matches(e.ref, ref)).length;
  if (eaten) return `Está en ${eaten} registro(s) de lo comido. Elimina antes esos registros.`;
  if (ref.kind === 'food') {
    const used = data.recipes.filter((r) => r.ingredients.some((i) => i.foodId === ref.id));
    if (used.length) return `Lo usan estas recetas: ${used.map((r) => r.name).join(', ')}.`;
  }
  return null;
}

/** Elimina un alimento o receta y lo que lo tenía planificado. Comprueba antes removalBlocker. */
export function removeEntity(data: AppData, ref: Ref): AppData {
  if (removalBlocker(data, ref)) return data;
  return {
    ...data,
    foods: ref.kind === 'food' ? data.foods.filter((f) => f.id !== ref.id) : data.foods,
    recipes: ref.kind === 'recipe' ? data.recipes.filter((r) => r.id !== ref.id) : data.recipes,
    plan: data.plan.filter((p) => !matches(p.ref, ref)),
  };
}
