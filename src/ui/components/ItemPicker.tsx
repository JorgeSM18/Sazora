// Elegir un alimento o una receta y su cantidad. Muestra al momento lo que aporta.

import { useMemo, useState } from 'react';
import type { Food, ItemRef, Recipe, Unit } from '../../domain/types';
import { itemTotals, suggestedAmount, unitsFor } from '../../domain/nutrition';
import { parseDecimal, validateQuantity } from '../../domain/validation';
import { useCalc, useStore } from '../../state/store';
import { unitText } from '../format';
import { OriginBadge } from './Badges';
import { TotalsLine } from './Values';

export interface PickResult {
  ref: ItemRef;
  quantity: number;
  unit: Unit;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function ItemPicker({ mealId, confirmLabel, onPick, foodsOnly = false }: { mealId?: string; confirmLabel: string; onPick: (r: PickResult) => void; foodsOnly?: boolean }) {
  const { data } = useStore();
  const ctx = useCalc();
  const [tab, setTab] = useState<'recetas' | 'alimentos'>(foodsOnly ? 'alimentos' : 'recetas');
  const [q, setQ] = useState('');
  const [onlyDiet, setOnlyDiet] = useState(true);
  const [selected, setSelected] = useState<{ food?: Food; recipe?: Recipe } | null>(null);

  const inDiet = (f: Food) => ctx.freeFoodIds.has(f.id) || f.equivalences.some((e) => ctx.exchangeDocs.includes(e.source.doc)) || f.origin === 'usuario';
  const recipes = useMemo(
    () =>
      data.recipes
        .filter((r) => norm(r.name).includes(norm(q)))
        .sort((a, b) => Number(b.mealHint === mealId) - Number(a.mealHint === mealId) || Number(b.favorite) - Number(a.favorite)),
    [data.recipes, q, mealId],
  );
  const foods = data.foods.filter((f) => (!onlyDiet || inDiet(f)) && norm(`${f.name} ${f.brand ?? ''}`).includes(norm(q)));

  if (selected) {
    return <AmountStep key={selected.food?.id ?? selected.recipe?.id} {...selected} confirmLabel={confirmLabel} onBack={() => setSelected(null)} onPick={onPick} />;
  }

  return (
    <div className="picker">
      {!foodsOnly && <div className="tabs" role="tablist">
        {(['recetas', 'alimentos'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'recetas' ? 'Recetas y platos' : 'Alimentos'}
          </button>
        ))}
      </div>}
      <label className="field">
        <span>Buscar</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === 'recetas' ? 'Nombre del plato' : 'Nombre del alimento'} autoFocus />
      </label>
      {tab === 'alimentos' && (
        <label className="check">
          <input type="checkbox" checked={onlyDiet} onChange={(e) => setOnlyDiet(e.target.checked)} /> Solo alimentos de mi pauta
        </label>
      )}
      <ul className="pick-list">
        {tab === 'recetas'
          ? recipes.map((r) => (
              <li key={r.id}>
                <button onClick={() => setSelected({ recipe: r })}>
                  <span className="pick-name">{r.name}</span>
                  <span className="pick-meta"><OriginBadge origin={r.origin} /> {r.category}{r.favorite ? ' · ★' : ''}</span>
                </button>
              </li>
            ))
          : foods.slice(0, 80).map((f) => (
              <li key={f.id}>
                <button onClick={() => setSelected({ food: f })}>
                  <span className="pick-name">{f.name}{f.brand ? ` · ${f.brand}` : ''}</span>
                  <span className="pick-meta">{f.state}{ctx.freeFoodIds.has(f.id) ? ' · no se contabiliza' : ''}{!f.nutrition ? ' · sin datos nutricionales' : ''}</span>
                </button>
              </li>
            ))}
      </ul>
      {(tab === 'recetas' ? recipes.length : foods.length) === 0 && <p className="empty">No hay resultados para “{q}”.</p>}
    </div>
  );
}

function AmountStep({ food, recipe, confirmLabel, onBack, onPick }: { food?: Food; recipe?: Recipe; confirmLabel: string; onBack: () => void; onPick: (r: PickResult) => void }) {
  const ctx = useCalc();
  const units: Unit[] = food ? unitsFor(food, ctx) : ['racion'];
  const [unit, setUnit] = useState<Unit>(units[0]!);
  const [qty, setQty] = useState(() => String(food ? suggestedAmount(food, units[0]!, ctx) : 1));
  const [touched, setTouched] = useState(false);
  const ref: ItemRef = food ? { kind: 'food', foodId: food.id } : { kind: 'recipe', recipeId: recipe!.id };
  const error = validateQuantity(qty);
  const n = parseDecimal(qty);

  return (
    <form
      className="stack"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!error && n !== null) onPick({ ref, quantity: n, unit });
      }}
    >
      <button type="button" className="btn ghost small" onClick={onBack}>← Volver a la lista</button>
      <h3>{food?.name ?? recipe!.name}</h3>
      <div className="row">
        <label className="field grow">
          <span>Cantidad</span>
          <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} aria-invalid={touched && !!error} aria-describedby="qty-err" />
        </label>
        <label className="field">
          <span>Unidad</span>
          <select
            value={unit}
            onChange={(e) => {
              const u = e.target.value as Unit;
              setUnit(u);
              if (food) setQty(String(suggestedAmount(food, u, ctx)));
            }}
          >
            {units.map((u) => <option key={u} value={u}>{unitText(u, 2, food)}</option>)}
          </select>
        </label>
      </div>
      {touched && error && <p id="qty-err" className="field-error" role="alert">{error}</p>}
      {!error && n !== null && (
        <p className="preview">Aporta: <TotalsLine totals={itemTotals(ref, n, unit, ctx)} /></p>
      )}
      <button className="btn primary" type="submit">{confirmLabel}</button>
    </form>
  );
}
