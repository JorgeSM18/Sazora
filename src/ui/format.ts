// Presentación: redondeo y textos. El redondeo solo ocurre aquí, nunca en el cálculo.

import { GROUP_LABELS, type ExchangeGroup, type Food, type Portions, type Unit } from '../domain/types';

const nf = (max: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: max });
export const fmt = (n: number, max = 0) => nf(max).format(n);
export const fmtPortion = (n: number) => nf(2).format(n);

export const GROUP_SHORT: Record<ExchangeGroup, string> = {
  lacteos: 'Lácteos',
  vegetales: 'Vegetales',
  frutas: 'Fruta',
  carbohidratos: 'Carbohidratos',
  proteinaMagra: 'Prot. magra',
  proteinaSemimagra: 'Prot. semimagra',
  grasas: 'Grasa',
};
export const groupLabel = (g: ExchangeGroup) => GROUP_LABELS[g];

export function portionsText(p: Portions): string {
  const parts = (Object.keys(p) as ExchangeGroup[]).filter((g) => p[g]).map((g) => `${fmtPortion(p[g]!)} ${GROUP_SHORT[g].toLowerCase()}`);
  return parts.join(' · ');
}

export function unitText(unit: Unit, quantity: number, food?: Food): string {
  switch (unit) {
    case 'g':
      return 'g';
    case 'ml':
      return 'ml';
    case 'porcion':
      return quantity === 1 ? 'porción' : 'porciones';
    case 'racion':
      return quantity === 1 ? 'ración' : 'raciones';
    case 'unidad': {
      const label = food?.unitLabel ?? 'unidad';
      return quantity === 1 ? label : plural(label);
    }
  }
}

const plural = (w: string) => (/[aeiouáéó]$/.test(w) ? `${w}s` : w.endsWith('ón') ? `${w.slice(0, -2)}ones` : `${w}es`);

export const amountText = (quantity: number, unit: Unit, food?: Food) =>
  unit === 'g' || unit === 'ml' ? `${fmt(quantity, 1)} ${unit}` : `${fmt(quantity, 2)} ${unitText(unit, quantity, food)}`;

// ── Fechas (siempre fecha local, formato YYYY-MM-DD) ──────────

export function todayISO(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return todayISO(new Date(y!, m! - 1, d! + days));
}

export function dateLong(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(y!, m! - 1, d!));
}

export const isValidISODate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
