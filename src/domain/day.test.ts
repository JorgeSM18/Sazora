import { describe, expect, it } from 'vitest';
import { semimagraSwap, type DaySummary } from './day';
import { progress } from './nutrition';
import type { ExchangeGroup } from './types';

/** Resumen con solo lo que usa semimagraSwap: [pauta, comido] por grupo. */
const day = (groups: Partial<Record<ExchangeGroup, [number | undefined, number]>>) =>
  ({ portions: Object.entries(groups).map(([group, [t, c]]) => ({ group, progress: progress(t, c, c) })) }) as unknown as DaySummary;

describe('sustitución semimagra = magra + grasa', () => {
  it('la magra de más cubre la semimagra que falta, con la grasa necesaria', () => {
    expect(semimagraSwap(day({ proteinaMagra: [20, 22], proteinaSemimagra: [2, 0], grasas: [4, 3] }))).toEqual({ portions: 2, fatTarget: 4, fatEaten: 3 });
  });

  it('solo cubre lo que falta de semimagra, aunque sobre más magra', () => {
    expect(semimagraSwap(day({ proteinaMagra: [20, 25], proteinaSemimagra: [2, 1] }))?.portions).toBe(1);
  });

  it('no avisa si no sobra magra, no falta semimagra o la pauta no fija alguna de las dos', () => {
    expect(semimagraSwap(day({ proteinaMagra: [20, 20], proteinaSemimagra: [2, 0] }))).toBeNull();
    expect(semimagraSwap(day({ proteinaMagra: [20, 22], proteinaSemimagra: [2, 2] }))).toBeNull();
    expect(semimagraSwap(day({ proteinaMagra: [20, 22] }))).toBeNull();
    expect(semimagraSwap(day({ proteinaMagra: [undefined, 22], proteinaSemimagra: [2, 0] }))).toBeNull();
  });
});
