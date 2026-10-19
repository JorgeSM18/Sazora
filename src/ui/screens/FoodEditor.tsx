import { useState } from 'react';
import { EXCHANGE_GROUPS, NUTRIENT_KEYS, NUTRIENT_LABELS, type ExchangeGroup, type Food, type FoodState, type MeasureUnit, type Verification } from '../../domain/types';
import { newId } from '../../domain/planner';
import { parseDecimal, parseNutrients, validateName, validateQuantity } from '../../domain/validation';
import { removalBlocker, removeEntity } from '../../data/maintenance';
import { useStore } from '../../state/store';
import { OriginBadge, StatusBadge } from '../components/Badges';
import { ConfirmButton } from '../components/Modal';
import { fmt, groupLabel, portionsText } from '../format';
import { href, navigate } from '../router';
import { NotFound } from './NotFound';
import { SourceTag } from './DietScreen';

const STATES: FoodState[] = ['crudo', 'cocido', 'escurrido', 'listo', 'otro'];

export function FoodEditor({ foodId }: { foodId?: string }) {
  const { data, update } = useStore();
  const food = foodId ? data.foods.find((f) => f.id === foodId) : undefined;
  if (foodId && !food) {
    return <NotFound title="Este alimento ya no está" message="Puede que se haya eliminado del catálogo." back={{ to: '/alimentos', label: 'Volver a alimentos' }} />;
  }
  const isNew = !food;
  const editableIdentity = isNew || food.origin === 'usuario';
  const blocker = food && removalBlocker(data, { kind: 'food', id: food.id });

  return (
    <div className="stack-lg">
      <header className="page-head">
        <a href={href('/alimentos')} className="back">← Alimentos</a>
        <h1>{food ? food.name : 'Nuevo alimento'}</h1>
        {food && (
          <p className="badges">
            <OriginBadge origin={food.origin} /> <StatusBadge status={food.status} /> <span className="badge">{food.state}</span>
            {food.group && <span className="badge">{groupLabel(food.group)}</span>}
          </p>
        )}
        {food?.notes && <p className="note">{food.notes}</p>}
      </header>

      {food && food.equivalences.length > 0 && (
        <section aria-labelledby="h-eq">
          <h2 id="h-eq">Equivalencias documentadas</h2>
          <ul className="rules">
            {food.equivalences.map((e, k) => (
              <li key={k}>
                {e.unit === 'porcion' ? '1 porción' : `${fmt(e.amount, 2)} ${e.unit === 'unidad' ? food.unitLabel ?? 'ud.' : e.unit}`} = <b className="pauta-text">{portionsText(e.portions)}</b>
                {e.householdMeasure ? ` (${e.householdMeasure})` : ''} <SourceTag source={e.source} /> {e.status !== 'verificado' && <StatusBadge status={e.status} />}
                {e.note && <span className="muted small"> {e.note}</span>}
              </li>
            ))}
          </ul>
          <p className="muted small">Las equivalencias vienen de los documentos y no se editan aquí.</p>
        </section>
      )}

      <FoodForm
        key={food?.id ?? 'nuevo'}
        food={food}
        editableIdentity={editableIdentity}
        onSave={(f) => {
          update((d) => ({ ...d, foods: isNew ? [...d.foods, f] : d.foods.map((x) => (x.id === f.id ? f : x)) }));
          navigate(`/alimentos/${f.id}`);
        }}
      />

      {food?.origin === 'usuario' && (
        <section className="panel">
          {blocker ? <p className="muted">No se puede eliminar: {blocker}</p> : (
            <ConfirmButton title="Eliminar alimento" message={`Se eliminará “${food.name}” y se quitará de los planes donde aparezca.`} onConfirm={() => { update((d) => removeEntity(d, { kind: 'food', id: food.id })); navigate('/alimentos'); }}>
              Eliminar alimento
            </ConfirmButton>
          )}
        </section>
      )}
    </div>
  );
}

type NField = Record<(typeof NUTRIENT_KEYS)[number], string>;

function FoodForm({ food, editableIdentity, onSave }: { food?: Food; editableIdentity: boolean; onSave: (f: Food) => void }) {
  const n = food?.nutrition;
  const { saveState } = useStore();
  const [name, setName] = useState(food?.name ?? '');
  const [brand, setBrand] = useState(food?.brand ?? '');
  const [state, setState] = useState<FoodState>(food?.state ?? 'listo');
  const [group, setGroup] = useState<ExchangeGroup | ''>(food?.group ?? '');
  const [unitLabel, setUnitLabel] = useState(food?.unitLabel ?? '');
  const [hasNutrition, setHasNutrition] = useState(!!n);
  const [per, setPer] = useState(String(n?.per ?? 100));
  const [unit, setUnit] = useState<MeasureUnit>(n?.unit ?? 'g');
  const [fields, setFields] = useState<NField>(Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, n?.values[k]?.toString() ?? ''])) as NField);
  const [source, setSource] = useState(n?.source ?? '');
  const [status, setStatus] = useState<Verification>(n?.status === 'verificado' ? 'verificado' : 'pendiente');
  const [notes, setNotes] = useState(food?.origin === 'usuario' ? food.notes ?? '' : '');
  const [submitted, setSubmitted] = useState(false);
  const [saved, setSaved] = useState(false);

  const parsed = parseNutrients(fields);
  const errors = {
    name: editableIdentity ? validateName(name) : null,
    per: hasNutrition ? validateQuantity(per) : null,
    source: hasNutrition && !source.trim() ? 'Indica de dónde salen los valores (etiqueta, base de datos…).' : null,
    values: hasNutrition && NUTRIENT_KEYS.every((k) => parsed.values[k] === null && !parsed.errors[k]) ? 'Rellena al menos un valor o desmarca “Tengo datos nutricionales”.' : null,
    ...(hasNutrition ? parsed.errors : {}),
  };
  const valid = Object.values(errors).every((e) => !e);
  const show = (e?: string | null) => submitted && e;

  return (
    <form
      className="stack"
      noValidate
      onChange={() => setSaved(false)}
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
        if (!valid) return;
        setSaved(true);
        const base: Food = food ?? { id: newId('food'), name: '', state, equivalences: [], origin: 'usuario', status: 'pendiente' };
        onSave({
          ...base,
          ...(editableIdentity ? { name: name.trim(), brand: brand.trim() || undefined, state, group: group || undefined, unitLabel: unitLabel.trim() || undefined, notes: notes.trim() || undefined } : {}),
          nutrition: hasNutrition ? { per: parseDecimal(per)!, unit, values: parsed.values, source: source.trim(), status } : undefined,
        });
      }}
    >
      {editableIdentity && (
        <section className="grid-fields" aria-label="Datos del alimento">
          <label className="field"><span>Nombre *</span><input value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!show(errors.name)} />{show(errors.name) && <span className="field-error" role="alert">{errors.name}</span>}</label>
          <label className="field"><span>Marca</span><input value={brand} onChange={(e) => setBrand(e.target.value)} /></label>
          <label className="field"><span>Estado</span><select value={state} onChange={(e) => setState(e.target.value as FoodState)}>{STATES.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label className="field"><span>Grupo de intercambio</span>
            <select value={group} onChange={(e) => setGroup(e.target.value as ExchangeGroup | '')}>
              <option value="">Ninguno</option>
              {EXCHANGE_GROUPS.map((g) => <option key={g} value={g}>{groupLabel(g)}</option>)}
            </select>
          </label>
          <label className="field"><span>Nombre de la unidad (rebanada, lata…)</span><input value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)} /></label>
          <label className="field span"><span>Notas</span><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          {group && <p className="note span">Un alimento propio no tiene equivalencia documentada en porciones: solo podrás contarlo en porciones si lo registras directamente en “porciones”.</p>}
        </section>
      )}

      <section className="panel" aria-labelledby="h-nutri">
        <h2 id="h-nutri">Información nutricional</h2>
        <label className="check"><input type="checkbox" checked={hasNutrition} onChange={(e) => setHasNutrition(e.target.checked)} /> Tengo datos nutricionales de este alimento ({state})</label>
        {hasNutrition ? (
          <>
            <div className="grid-fields">
              <label className="field"><span>Valores por</span><input inputMode="decimal" value={per} onChange={(e) => setPer(e.target.value)} aria-invalid={!!show(errors.per)} />{show(errors.per) && <span className="field-error" role="alert">{errors.per}</span>}</label>
              <label className="field"><span>Unidad</span><select value={unit} onChange={(e) => setUnit(e.target.value as MeasureUnit)}><option value="g">g</option><option value="ml">ml</option><option value="unidad">unidad</option></select></label>
              {NUTRIENT_KEYS.map((k) => (
                <label key={k} className="field">
                  <span>{NUTRIENT_LABELS[k].label} ({NUTRIENT_LABELS[k].unit})</span>
                  <input inputMode="decimal" value={fields[k]} placeholder="desconocido" onChange={(e) => setFields({ ...fields, [k]: e.target.value })} aria-invalid={!!show(parsed.errors[k])} />
                  {show(parsed.errors[k]) && <span className="field-error" role="alert">{parsed.errors[k]}</span>}
                </label>
              ))}
              <label className="field span"><span>Fuente de los valores *</span><input value={source} onChange={(e) => setSource(e.target.value)} placeholder="p. ej. etiqueta del envase" aria-invalid={!!show(errors.source)} />{show(errors.source) && <span className="field-error" role="alert">{errors.source}</span>}</label>
              <label className="field"><span>Estado de verificación</span><select value={status} onChange={(e) => setStatus(e.target.value as Verification)}><option value="verificado">Verificado</option><option value="pendiente">Pendiente de revisión</option></select></label>
            </div>
            {show(errors.values) && <p className="field-error" role="alert">{errors.values}</p>}
            <p className="muted small">Deja vacío lo que no sepas: se mostrará como desconocido, nunca como 0. Los valores de un alimento crudo no sirven para su versión cocinada.</p>
          </>
        ) : (
          <p className="muted">Sin datos: se usará para porciones, pero sus calorías y macros aparecerán como desconocidos.</p>
        )}
      </section>

      {submitted && !valid && <p className="field-error" role="alert">Revisa los campos marcados.</p>}
      <div className="row">
        <button className="btn primary" type="submit">Guardar</button>
        {/* Lo que dice el servidor, no solo el formulario: si falla, lo avisa el banner de error. */}
        {saved && saveState === 'guardado' && <span className="ok-text" role="status">Guardado</span>}
        {saved && saveState === 'guardando' && <span className="muted small" role="status">Guardando…</span>}
      </div>
    </form>
  );
}
