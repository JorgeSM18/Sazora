import { NUTRIENT_KEYS, NUTRIENT_LABELS, type Diet } from '../../domain/types';
import { semimagraSwap, type DaySummary } from '../../domain/day';
import { fmtPortion, GROUP_SHORT } from '../format';
import { ProgressRow } from './Progress';
import { href } from '../router';

/** Porciones de la pauta y, debajo, energía y macros (con objetivo solo si está configurado). */
export function DayPanel({ summary, diet, compact = false }: { summary: DaySummary; diet: Diet; compact?: boolean }) {
  const targetLabel = diet.nutrientTargetsSource === 'documento' ? 'pauta' : 'objetivo';
  const swap = semimagraSwap(summary);
  const nutrientKeys = compact ? NUTRIENT_KEYS.filter((k) => k === 'kcal' || diet.nutrientTargets[k] !== undefined) : NUTRIENT_KEYS;
  return (
    <div className="day-panel">
      <section aria-labelledby="h-porciones">
        <h3 id="h-porciones">Porciones del día</h3>
        {summary.portions.length === 0 ? (
          <p className="muted">Esta dieta no define porciones.</p>
        ) : (
          summary.portions.map(({ group, progress }) => (
            <ProgressRow key={group} label={GROUP_SHORT[group]} p={progress} unit="" decimals={2} incomplete={summary.consumed.portionsIncomplete} />
          ))
        )}
        {swap && (
          <p className="note">
            <b>Sustitución de tu pauta</b> (1 prot. semimagra = 1 prot. magra + 1 grasa): {fmtPortion(swap.portions)} de la prot. magra de más
            {' '}{swap.portions === 1 ? 'cubre' : 'cubren'} {fmtPortion(swap.portions)} de prot. semimagra si sumas {fmtPortion(swap.portions)} de grasa.
            {swap.fatTarget !== undefined && (swap.fatEaten >= swap.fatTarget + swap.portions
              ? ` Grasas: llevas ${fmtPortion(swap.fatEaten)}, ya cubres las ${fmtPortion(swap.fatTarget + swap.portions)} necesarias.`
              : ` Grasas: llevas ${fmtPortion(swap.fatEaten)} de ${fmtPortion(swap.fatTarget + swap.portions)} (${fmtPortion(swap.fatTarget)} de la pauta + ${fmtPortion(swap.portions)}).`)}
          </p>
        )}
        {(summary.planned.portionsIncomplete || summary.consumed.portionsIncomplete) && (
          <p className="note warn">Algún elemento no tiene equivalencia en porciones: los totales son mínimos.</p>
        )}
      </section>
      <section aria-labelledby="h-energia">
        <h3 id="h-energia">Energía y macros</h3>
        {Object.keys(diet.nutrientTargets).length === 0 && (
          <p className="note">Tu pauta no fija calorías ni macros. Se muestra lo que se puede calcular, sin objetivo. Si tu nutricionista te los ha dado, puedes añadirlos en <a href={href('/ajustes')}>Ajustes</a>.</p>
        )}
        {nutrientKeys.map((k) => (
          <ProgressRow
            key={k}
            label={NUTRIENT_LABELS[k].label}
            p={summary.nutrients[k]}
            unit={NUTRIENT_LABELS[k].unit}
            incomplete={summary.consumed.unknown[k]}
            targetLabel={targetLabel}
          />
        ))}
        {(summary.consumed.unknown.kcal || summary.planned.unknown.kcal) && (
          <p className="note warn">Hay alimentos sin datos nutricionales: los valores marcados con ≥ son mínimos.</p>
        )}
      </section>
    </div>
  );
}
