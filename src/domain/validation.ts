// Validación de entradas del usuario. Devuelve un mensaje legible o null si es válido.

import { NUTRIENT_KEYS, type Nutrients } from './types';

export function validateQuantity(value: string | number): string | null {
  const n = typeof value === 'number' ? value : parseDecimal(value);
  if (n === null) return 'Escribe una cantidad numérica.';
  if (!(n > 0)) return 'La cantidad debe ser mayor que 0.';
  if (n > 100000) return 'La cantidad es demasiado grande.';
  return null;
}

/** Acepta coma o punto decimal. Cadena vacía → null. */
export function parseDecimal(value: string): number | null {
  const s = value.trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Campo nutricional opcional: vacío = desconocido (null), nunca 0 implícito. */
export function parseNutrients(fields: Record<keyof Nutrients, string>): { values: Nutrients; errors: Partial<Record<keyof Nutrients, string>> } {
  const values = {} as Nutrients;
  const errors: Partial<Record<keyof Nutrients, string>> = {};
  for (const k of NUTRIENT_KEYS) {
    const raw = fields[k];
    if (raw.trim() === '') {
      values[k] = null;
      continue;
    }
    const n = parseDecimal(raw);
    if (n === null || n < 0) errors[k] = 'Debe ser un número mayor o igual que 0, o dejarse vacío si se desconoce.';
    values[k] = n;
  }
  return { values, errors };
}

export function validateName(name: string): string | null {
  return name.trim().length === 0 ? 'El nombre es obligatorio.' : null;
}

export function validateServings(value: string | number): string | null {
  const n = typeof value === 'number' ? value : parseDecimal(value);
  if (n === null || !Number.isInteger(n) || n < 1) return 'Las raciones deben ser un número entero mayor o igual que 1.';
  return null;
}
