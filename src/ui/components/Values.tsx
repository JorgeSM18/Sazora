// Muestra totales sin inventar: desconocido → "—", parcialmente conocido → "≥ valor".

import { NUTRIENT_KEYS, NUTRIENT_LABELS, type NutrientKey } from '../../domain/types';
import type { Totals } from '../../domain/nutrition';
import { fmt, portionsText } from '../format';

export function nutrientText(t: Totals, k: NutrientKey): string {
  const v = t.nutrients[k];
  const unit = NUTRIENT_LABELS[k].unit;
  if (t.unknown[k] && v === 0) return '—';
  return `${t.unknown[k] ? '≥ ' : ''}${fmt(v, k === 'kcal' ? 0 : 1)} ${unit}`;
}

/** Línea compacta: porciones + kcal y macros. */
export function TotalsLine({ totals, showMacros = true }: { totals: Totals; showMacros?: boolean }) {
  const portions = portionsText(totals.portions);
  const allUnknown = NUTRIENT_KEYS.every((k) => totals.unknown[k] && totals.nutrients[k] === 0);
  const muted: string[] = [];
  if (totals.portionsIncomplete) muted.push(portions ? 'porciones incompletas' : 'porciones sin calcular');
  if (showMacros) {
    muted.push(allUnknown ? 'sin datos nutricionales' : NUTRIENT_KEYS.map((k) => `${k === 'kcal' ? '' : NUTRIENT_LABELS[k].label.slice(0, 1) + ' '}${nutrientText(totals, k)}`).join(' · '));
  }
  return (
    <span className="totals-line">
      {portions && <span className="pauta-text">{portions}</span>}
      {muted.length > 0 && <span className="muted">{portions ? ' · ' : ''}{muted.join(' · ')}</span>}
    </span>
  );
}

export function NutrientTable({ totals, caption }: { totals: Totals; caption: string }) {
  return (
    <table className="data">
      <caption>{caption}</caption>
      <tbody>
        {NUTRIENT_KEYS.map((k) => (
          <tr key={k}>
            <th scope="row">{NUTRIENT_LABELS[k].label}</th>
            <td className="num">{nutrientText(totals, k)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
