// Registro de la ingesta real. Independiente del plan: editar lo comido no toca lo previsto.

import { newId } from './planner';
import type { IntakeEntry, PlanItem } from './types';

export const intakeFor = (intake: IntakeEntry[], planItemId: string) =>
  intake.find((e) => e.planItemId === planItemId);

/** Marca como comido un elemento planificado. Si ya estaba registrado, actualiza ese registro (sin duplicar). */
export function consumePlanned(
  intake: IntakeEntry[],
  item: PlanItem,
  quantity: number = item.quantity,
  now = new Date().toISOString(),
): IntakeEntry[] {
  const existing = intakeFor(intake, item.id);
  if (existing) return updateIntakeQuantity(intake, existing.id, quantity);
  return [
    ...intake,
    {
      id: newId('intake'),
      date: item.date,
      mealId: item.mealId,
      ref: item.ref,
      quantity,
      unit: item.unit,
      planItemId: item.id,
      status: 'registrado',
      loggedAt: now,
    },
  ];
}

/** Registra algo que no estaba planificado. */
export function logIntake(
  intake: IntakeEntry[],
  input: Pick<IntakeEntry, 'date' | 'mealId' | 'ref' | 'quantity' | 'unit'>,
  now = new Date().toISOString(),
): IntakeEntry[] {
  return [...intake, { ...input, id: newId('intake'), status: 'registrado', loggedAt: now }];
}

export function updateIntakeQuantity(intake: IntakeEntry[], id: string, quantity: number): IntakeEntry[] {
  return intake.map((e) => (e.id === id && e.quantity !== quantity ? { ...e, quantity, status: 'corregido' } : e));
}

export const removeIntake = (intake: IntakeEntry[], id: string) => intake.filter((e) => e.id !== id);
