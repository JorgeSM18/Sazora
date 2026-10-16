// Persistencia. La app solo conoce la interfaz Repository.
// - HttpRepository: los datos del usuario en la base de datos del servidor (producción).
// - MemoryRepository: en memoria (pruebas).

import type { AppData } from '../domain/types';
import { SCHEMA_VERSION } from './fixtures';

export interface Repository {
  /** null si el usuario aún no tiene datos guardados. */
  load(): Promise<AppData | null>;
  save(data: AppData): Promise<void>;
}

/** Los datos guardados no tienen la forma esperada. */
export class CorruptDataError extends Error {}
/** Otro dispositivo guardó cambios después de que este cargara los datos. */
export class ConflictError extends Error {}
/** La sesión ha caducado o se ha cerrado. */
export class AuthError extends Error {}

const ARRAYS = ['documents', 'foods', 'recipes', 'plan', 'intake'] as const;

export function parseData(input: unknown): AppData {
  const d = input as Partial<AppData> | null;
  if (typeof d !== 'object' || d === null || ARRAYS.some((k) => !Array.isArray(d[k])) || typeof d.diet !== 'object') {
    throw new CorruptDataError('Los datos guardados no tienen la estructura esperada.');
  }
  if (d.schemaVersion !== SCHEMA_VERSION) {
    // ponytail: sin migraciones todavía; la primera versión de esquema que cambie añade aquí la suya.
    throw new CorruptDataError(`Versión de datos ${d.schemaVersion} no soportada.`);
  }
  return d as AppData;
}

export class HttpRepository implements Repository {
  private version = 0;

  constructor(private base = '/api/datos') {}

  async load() {
    const res = await fetch(this.base, { credentials: 'same-origin' });
    if (res.status === 401) throw new AuthError('La sesión ha caducado.');
    if (!res.ok) throw new Error(`No se pudieron cargar los datos (${res.status}).`);
    const body = (await res.json()) as { data: unknown; version: number };
    this.version = body.version;
    return body.data === null ? null : parseData(body.data);
  }

  async save(data: AppData) {
    const res = await fetch(this.base, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data, version: this.version }),
    });
    if (res.status === 401) throw new AuthError('La sesión ha caducado.');
    if (res.status === 409) throw new ConflictError('Hay cambios guardados desde otro dispositivo.');
    if (!res.ok) throw new Error(`No se pudieron guardar los datos (${res.status}).`);
    this.version = ((await res.json()) as { version: number }).version;
  }
}

export class MemoryRepository implements Repository {
  saves = 0;
  constructor(private data: AppData | null = null) {}
  async load() {
    return this.data && structuredClone(this.data);
  }
  async save(data: AppData) {
    this.saves++;
    this.data = structuredClone(data);
  }
}
