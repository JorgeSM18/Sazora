import { useEffect, useMemo, useState } from 'react';
import { daySummary, type MealDay } from '../../domain/day';
import { addPlanItem, copyDay, copyMeal, movePlanItem, removePlanItem, updatePlanQuantity } from '../../domain/planner';
import { consumePlanned, logIntake, removeIntake, updateIntakeQuantity } from '../../domain/intake';
import { itemTotals } from '../../domain/nutrition';
import type { AppData, ItemRef } from '../../domain/types';
import { useDiet, useCalc, useStore } from '../../state/store';
import { DayPanel } from '../components/DayPanel';
import { Icon } from '../components/Icon';
import { ItemPicker, type PickResult } from '../components/ItemPicker';
import { ConfirmButton, Modal } from '../components/Modal';
import { QuantityEditor } from '../components/QuantityEditor';
import { TotalsLine } from '../components/Values';
import { addDays, amountText, dateLong, isValidISODate, portionsText, todayISO, unitText } from '../format';
import { href, navigate } from '../router';

export function PlannerScreen({ dateParam, mealParam = null }: { dateParam: string | null; mealParam?: string | null }) {
  const { data, update } = useStore();
  const diet = useDiet();
  const ctx = useCalc();
  const date = isValidISODate(dateParam) ? dateParam : todayISO();
  const s = useMemo(() => daySummary(data, diet, date, ctx), [data, diet, date, ctx]);
  const [copyOpen, setCopyOpen] = useState(false);
  // Desde Inicio se llega a una comida concreta (?comida=cena): se baja hasta ella.
  useEffect(() => {
    if (mealParam) document.getElementById(`comida-${mealParam}`)?.scrollIntoView({ block: 'start' });
  }, [mealParam]);
  const go = (d: string) => navigate(`/plan?fecha=${d}`);

  return (
    <div className="stack-lg">
      <header className="date-bar">
        <button className="icon-btn" onClick={() => go(addDays(date, -1))} aria-label="Día anterior"><Icon name="izq" /></button>
        <div className="date-title">
          <h1 className="first-cap">{dateLong(date)}</h1>
          <label className="date-pick">
            <span className="sr-only">Ir a la fecha</span>
            <input type="date" value={date} onChange={(e) => isValidISODate(e.target.value) && go(e.target.value)} />
          </label>
        </div>
        <button className="icon-btn" onClick={() => go(addDays(date, 1))} aria-label="Día siguiente"><Icon name="der" /></button>
      </header>
      <div className="row wrap">
        {date !== todayISO() && <button className="btn small" onClick={() => go(todayISO())}>Ir a hoy</button>}
        <button className="btn small" onClick={() => setCopyOpen(true)}><Icon name="copiar" size={16} /> Copiar otro día aquí</button>
      </div>

      {s.meals.map((m) => <MealSection key={m.meal.id} m={m} date={date} />)}

      <details className="panel" open>
        <summary><h2>Totales del día</h2></summary>
        <DayPanel summary={s} diet={diet} />
      </details>

      <Modal title="Copiar otro día aquí" open={copyOpen} onClose={() => setCopyOpen(false)}>
        <CopyDayForm
          onCopy={(from, replace) => {
            update((d) => ({ ...d, ...copyDay(d.plan, d.intake, from, date, replace) }));
            setCopyOpen(false);
          }}
          date={date}
        />
      </Modal>
    </div>
  );
}

function MealSection({ m, date }: { m: MealDay; date: string }) {
  const { data, update } = useStore();
  const diet = useDiet();
  const ctx = useCalc();
  const [adding, setAdding] = useState<'plan' | 'intake' | null>(null);
  const [copying, setCopying] = useState(false);
  const linked = new Map(m.intake.filter((e) => e.planItemId).map((e) => [e.planItemId!, e]));
  const slot = { date, mealId: m.meal.id };
  const target = portionsText(m.meal.portionTargets);

  const add = (r: PickResult) => {
    update((d) =>
      adding === 'plan'
        ? { ...d, plan: addPlanItem(d.plan, { ...slot, ...r }) }
        : { ...d, intake: logIntake(d.intake, { ...slot, ...r }) },
    );
    setAdding(null);
  };

  return (
    <section className="meal" id={`comida-${m.meal.id}`} aria-labelledby={`h-${m.meal.id}`}>
      <header className="meal-head">
        <h2 id={`h-${m.meal.id}`}>{m.meal.name}</h2>
        {target && <p className="pauta-text small">Pauta: {target}</p>}
      </header>

      <h3 className="sub">Previsto</h3>
      {m.plan.length === 0 ? (
        <p className="empty">Nada planificado para esta comida.</p>
      ) : (
        <ul className="items">
          {m.plan.map((p, idx) => {
            const eaten = linked.get(p.id);
            return (
              <li key={p.id} className="item">
                <ItemName itemRef={p.ref} data={data} />
                <div className="item-amount">
                  <QuantityEditor key={`${p.id}-${p.quantity}`} value={p.quantity} unitLabel={unitText(p.unit, p.quantity, foodOf(data, p.ref))} label={`Cantidad prevista de ${nameOf(data, p.ref)}`} onCommit={(n) => update((d) => ({ ...d, plan: updatePlanQuantity(d.plan, p.id, n) }))} />
                </div>
                <div className="item-totals"><TotalsLine totals={itemTotals(p.ref, p.quantity, p.unit, ctx)} /></div>
                <div className="item-actions">
                  {eaten ? (
                    <span className="badge ok"><Icon name="check" size={14} /> Comido</span>
                  ) : (
                    <button className="btn small primary" onClick={() => update((d) => ({ ...d, intake: consumePlanned(d.intake, p) }))}>Marcar comido</button>
                  )}
                  <button className="icon-btn" disabled={idx === 0} onClick={() => update((d) => ({ ...d, plan: movePlanItem(d.plan, p.id, -1) }))} aria-label={`Subir ${nameOf(data, p.ref)}`}><Icon name="arriba" /></button>
                  <button className="icon-btn" disabled={idx === m.plan.length - 1} onClick={() => update((d) => ({ ...d, plan: movePlanItem(d.plan, p.id, 1) }))} aria-label={`Bajar ${nameOf(data, p.ref)}`}><Icon name="abajo" /></button>
                  <ConfirmButton className="icon-btn" ariaLabel={`Quitar ${nameOf(data, p.ref)} del plan`} title="Quitar del plan" message={eaten ? 'Se quitará del plan. Lo que registraste como comido se conserva.' : `Se quitará ${nameOf(data, p.ref)} del plan de esta comida.`} confirmLabel="Quitar" onConfirm={() => update((d) => ({ ...d, ...removePlanItem(d.plan, d.intake, p.id) }))}>
                    <Icon name="borrar" />
                  </ConfirmButton>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="row wrap">
        <button className="btn small" onClick={() => setAdding('plan')}><Icon name="mas" size={16} /> Añadir al plan</button>
        {m.plan.length > 0 && <button className="btn small ghost" onClick={() => setCopying(true)}><Icon name="copiar" size={16} /> Copiar comida a…</button>}
        {m.pending.length > 1 && (
          <button className="btn small ghost" onClick={() => update((d) => ({ ...d, intake: m.pending.reduce((acc, p) => consumePlanned(acc, p), d.intake) }))}>Marcar todo comido</button>
        )}
      </div>
      {m.plan.length > 0 && <p className="subtotal">Previsto: <TotalsLine totals={m.planned} /></p>}

      <h3 className="sub">Comido</h3>
      {m.intake.length === 0 ? (
        <p className="empty">Todavía no has registrado nada.</p>
      ) : (
        <ul className="items consumed">
          {m.intake.map((e) => {
            const planned = e.planItemId ? m.plan.find((p) => p.id === e.planItemId) : undefined;
            return (
              <li key={e.id} className="item">
                <ItemName itemRef={e.ref} data={data} />
                <div className="item-amount">
                  <QuantityEditor key={`${e.id}-${e.quantity}`} value={e.quantity} unitLabel={unitText(e.unit, e.quantity, foodOf(data, e.ref))} label={`Cantidad comida de ${nameOf(data, e.ref)}`} onCommit={(n) => update((d) => ({ ...d, intake: updateIntakeQuantity(d.intake, e.id, n) }))} />
                  <span className="muted small">{planned ? `previsto ${amountText(planned.quantity, planned.unit, foodOf(data, planned.ref))}` : 'no estaba previsto'}{e.status === 'corregido' ? ' · corregido' : ''}</span>
                </div>
                <div className="item-totals"><TotalsLine totals={itemTotals(e.ref, e.quantity, e.unit, ctx)} /></div>
                <div className="item-actions">
                  <ConfirmButton className="icon-btn" ariaLabel={`Eliminar registro de ${nameOf(data, e.ref)}`} title="Eliminar registro" message="Se eliminará este registro de lo comido. Lo planificado no cambia." onConfirm={() => update((d) => ({ ...d, intake: removeIntake(d.intake, e.id) }))}>
                    <Icon name="borrar" />
                  </ConfirmButton>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="row wrap">
        <button className="btn small ghost" onClick={() => setAdding('intake')}><Icon name="mas" size={16} /> Registrar algo no previsto</button>
      </div>
      {m.intake.length > 0 && <p className="subtotal">Comido: <TotalsLine totals={m.consumed} /></p>}

      <Modal title={adding === 'plan' ? `Añadir a ${m.meal.name}` : `Registrar en ${m.meal.name}`} open={adding !== null} onClose={() => setAdding(null)}>
        <ItemPicker mealId={m.meal.id} confirmLabel={adding === 'plan' ? 'Añadir al plan' : 'Registrar como comido'} onPick={add} />
      </Modal>
      <Modal title={`Copiar ${m.meal.name}`} open={copying} onClose={() => setCopying(false)}>
        <CopyMealForm
          date={date}
          meals={diet.meals}
          defaultMeal={m.meal.id}
          onCopy={(toDate, toMeal) => {
            update((d) => ({ ...d, plan: copyMeal(d.plan, slot, { date: toDate, mealId: toMeal }) }));
            setCopying(false);
          }}
        />
      </Modal>
    </section>
  );
}

const foodOf = (data: AppData, ref: ItemRef) => (ref.kind === 'food' ? data.foods.find((f) => f.id === ref.foodId) : undefined);
const nameOf = (data: AppData, ref: ItemRef) =>
  ref.kind === 'food' ? data.foods.find((f) => f.id === ref.foodId)?.name ?? 'Alimento eliminado' : data.recipes.find((r) => r.id === ref.recipeId)?.name ?? 'Receta eliminada';

function ItemName({ itemRef, data }: { itemRef: ItemRef; data: AppData }) {
  const to = itemRef.kind === 'food' ? `/alimentos/${itemRef.foodId}` : `/recetas/${itemRef.recipeId}`;
  return <a className="item-name" href={href(to)}>{nameOf(data, itemRef)}</a>;
}

function CopyDayForm({ date, onCopy }: { date: string; onCopy: (from: string, replace: boolean) => void }) {
  const [from, setFrom] = useState(addDays(date, -1));
  const [replace, setReplace] = useState(false);
  const same = from === date;
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); if (!same && isValidISODate(from)) onCopy(from, replace); }}>
      <label className="field"><span>Copiar el plan del día</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required /></label>
      <label className="check"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Sustituir lo que ya hay planificado hoy (lo registrado como comido se conserva)</label>
      {same && <p className="field-error" role="alert">Elige un día distinto.</p>}
      <p className="muted small">Solo se copia lo previsto; nada se marca como comido.</p>
      <button className="btn primary" type="submit" disabled={same}>Copiar</button>
    </form>
  );
}

function CopyMealForm({ date, meals, defaultMeal, onCopy }: { date: string; meals: { id: string; name: string }[]; defaultMeal: string; onCopy: (date: string, meal: string) => void }) {
  const [toDate, setToDate] = useState(addDays(date, 1));
  const [toMeal, setToMeal] = useState(defaultMeal);
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); if (isValidISODate(toDate)) onCopy(toDate, toMeal); }}>
      <label className="field"><span>Día de destino</span><input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} required /></label>
      <label className="field"><span>Comida de destino</span>
        <select value={toMeal} onChange={(e) => setToMeal(e.target.value)}>{meals.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
      </label>
      <p className="muted small">Se añade al final de esa comida, sin borrar lo que haya.</p>
      <button className="btn primary" type="submit">Copiar</button>
    </form>
  );
}

