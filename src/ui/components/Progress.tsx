// Fila de progreso: comido (tinta), previsto (gris) y pauta (cerámica). Sin colores de alarma.

import type { Progress } from '../../domain/nutrition';
import { fmt } from '../format';

interface Props {
  label: string;
  p: Progress;
  unit: string;
  decimals?: number;
  incomplete?: boolean;
  /** "pauta" si viene del documento; "objetivo" si lo configuró el usuario. */
  targetLabel?: string;
}

export function ProgressRow({ label, p, unit, decimals = 0, incomplete, targetLabel = 'pauta' }: Props) {
  const f = (n: number) => `${fmt(n, decimals)}${unit ? ` ${unit}` : ''}`;
  const max = Math.max(p.target ?? 0, p.planned, p.consumed, 1e-9);
  const pct = (n: number) => `${Math.min(100, (n / max) * 100)}%`;
  return (
    <div className="progress-row">
      <div className="progress-head">
        <span className="progress-label">{label}</span>
        <span className="progress-values">
          <b>{incomplete ? '≥ ' : ''}{f(p.consumed)}</b> comido
          <span className="muted"> · {f(p.planned)} previsto</span>
          {p.target !== undefined && <span className="pauta-text"> · {targetLabel} {f(p.target)}</span>}
        </span>
      </div>
      {p.target !== undefined && (
        <div className="bar" aria-hidden="true">
          <span className="bar-planned" style={{ width: pct(p.planned) }} />
          <span className="bar-consumed" style={{ width: pct(p.consumed) }} />
          {p.target > 0 && <span className="bar-target" style={{ left: `calc(${pct(p.target)} - 1px)` }} />}
        </div>
      )}
      <div className="progress-foot">
        {p.target === undefined
          ? 'Sin objetivo configurado'
          : p.target === 0 && !p.exceededBy
            ? `La ${targetLabel} asigna 0 a este grupo`
          : p.exceededBy
            ? `${f(p.exceededBy)} por encima de ${targetLabel === 'pauta' ? 'la pauta' : 'el objetivo'}`
            : `Quedan ${f(p.remaining ?? 0)}${p.ratio !== undefined ? ` · ${fmt(p.ratio * 100)} % ${targetLabel === 'pauta' ? 'de la pauta' : 'del objetivo'}` : ''}`}
      </div>
    </div>
  );
}
