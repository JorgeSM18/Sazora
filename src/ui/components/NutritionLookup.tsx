// Buscar con Gemini (búsqueda web) los datos por 100 g de los alimentos sin datos nutricionales.
// Se revisan antes de guardar y se guardan como pendientes de revisión, con su fuente.

import { useRef, useState } from 'react';
import { applyNutritionLookup, sanitizeNutritionLookup, type NutritionFound } from '../../domain/nutritionLookup';
import { NUTRIENT_KEYS, NUTRIENT_LABELS, type Food } from '../../domain/types';
import { useStore } from '../../state/store';
import { fmt, todayISO } from '../format';
import { Icon } from './Icon';
import { Modal } from './Modal';

const GROUP = 20; // el servidor acepta hasta 20 por consulta

async function lookup(foods: Food[]): Promise<unknown> {
  let r: Response;
  try {
    r = await fetch('/api/nutricion', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ foods: foods.map((f) => ({ id: f.id, name: f.name, brand: f.brand, state: f.state })) }),
    });
  } catch {
    throw new Error('No se puede conectar con el servidor.');
  }
  const body = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) throw new Error(body.error ?? `Error del servidor (${r.status}).`);
  return body;
}

type State =
  | { step: 'confirmar' }
  | { step: 'buscando'; group: number }
  | { step: 'revisar'; found: NutritionFound[]; error?: string };

export function NutritionLookup({ foods }: { foods: Food[] }) {
  const { update } = useStore();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ step: 'confirmar' });
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const running = useRef(false);
  const targets = foods.filter((f) => !f.nutrition);
  const groups = Math.ceil(targets.length / GROUP);
  const names = new Map(targets.map((f) => [f.id, f.brand ? `${f.name} · ${f.brand}` : f.name]));

  async function run() {
    running.current = true;
    const found: NutritionFound[] = [];
    let error: string | undefined;
    for (let g = 0; g < groups && running.current; g++) {
      setState({ step: 'buscando', group: g + 1 });
      const chunk = targets.slice(g * GROUP, (g + 1) * GROUP);
      try {
        found.push(...sanitizeNutritionLookup(await lookup(chunk), chunk));
      } catch (e) {
        error = (e as Error).message;
        break;
      }
    }
    if (!running.current) return;
    running.current = false;
    setSkip(new Set());
    setState({ step: 'revisar', found, error });
  }

  const close = () => {
    running.current = false;
    setOpen(false);
    setState({ step: 'confirmar' });
  };

  return (
    <>
      <button className="btn" disabled={!targets.length} onClick={() => setOpen(true)}>
        <Icon name="alimentos" size={16} /> Buscar datos con Gemini{targets.length ? ` (${targets.length})` : ''}
      </button>
      <Modal title="Buscar datos nutricionales" open={open} onClose={close}>
        {state.step === 'confirmar' && (
          <div className="stack">
            <p>Gemini buscará en la web los valores por 100 g (o 100 ml) de los <b>{targets.length}</b> alimentos de esta lista que no tienen datos: primero la web del supermercado o del fabricante; para alimentos genéricos, bases de datos como BEDCA o USDA.</p>
            <p className="muted small">Solo se envían el nombre, la marca o supermercado y el estado de cada alimento. Se hace en {groups} {groups === 1 ? 'consulta' : 'consultas'} de tu cuota de Gemini. Antes de guardar revisas lo encontrado; se guarda como pendiente de revisión, con su fuente, y no cambia los alimentos que ya tienen datos.</p>
            <div className="row end">
              <button className="btn ghost" onClick={close}>Cancelar</button>
              <button className="btn primary" onClick={() => void run()}>Buscar</button>
            </div>
          </div>
        )}
        {state.step === 'buscando' && (
          <div className="loader" aria-live="polite" aria-busy="true">
            <div className="spinner" aria-hidden="true" />
            <p className="loader-title">Buscando… consulta {state.group} de {groups}</p>
            <p className="muted small">Cada consulta puede tardar uno o dos minutos.</p>
          </div>
        )}
        {state.step === 'revisar' && (
          <div className="stack">
            {state.error && (
              <p className="note warn" role="alert">
                <Icon name="aviso" size={16} /> {state.found.length ? 'La búsqueda se ha interrumpido' : 'No se ha podido buscar'}: {state.error}
                {state.found.length > 0 && ' Puedes guardar lo encontrado hasta ahora.'}
              </p>
            )}
            {(!state.error || state.found.length > 0) && (
              <p>Encontrados <b>{state.found.length}</b> de {targets.length}. Lo que no aparece se queda sin datos: no se completa con estimaciones.</p>
            )}
            {state.found.length > 0 && (
              <ul className="review lookup-results">
                {state.found.map((n) => (
                  <li key={n.foodId}>
                    <label className="check">
                      <input type="checkbox" checked={!skip.has(n.foodId)} onChange={(e) => setSkip((s) => { const x = new Set(s); if (e.target.checked) x.delete(n.foodId); else x.add(n.foodId); return x; })} />
                      <span><b>{names.get(n.foodId)}</b></span>
                    </label>
                    <p className="small review-source">
                      Por 100 {n.unit}: {NUTRIENT_KEYS.map((k) => `${NUTRIENT_LABELS[k].label} ${n.values[k] === null ? '—' : `${fmt(n.values[k]!, 1)} ${NUTRIENT_LABELS[k].unit}`}`).join(' · ')}
                    </p>
                    <p className="small review-source muted">
                      Fuente: {n.url ? <a href={n.url} target="_blank" rel="noopener noreferrer">{n.source}</a> : n.source}{n.note ? ` · ${n.note}` : ''}
                    </p>
                    {n.warnings.map((w) => <p key={w} className="small review-source warn-text">{w}</p>)}
                  </li>
                ))}
              </ul>
            )}
            <div className="row end">
              <button className="btn ghost" onClick={close}>{state.found.length ? 'Descartar' : 'Cerrar'}</button>
              {state.found.length > 0 && (
                <button
                  className="btn primary"
                  disabled={state.found.length === skip.size}
                  onClick={() => {
                    const chosen = state.found.filter((n) => !skip.has(n.foodId));
                    update((d) => applyNutritionLookup(d, chosen, todayISO()));
                    close();
                  }}
                >
                  Guardar {state.found.length - skip.size}
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
