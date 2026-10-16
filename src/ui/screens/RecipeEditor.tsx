import { useState } from 'react';
import { ingredientTotals, recipePerServing } from '../../domain/nutrition';
import { newId } from '../../domain/planner';
import { parseDecimal, validateName, validateQuantity, validateServings } from '../../domain/validation';
import type { Ingredient, Recipe } from '../../domain/types';
import { useDiet, useCalc, useStore } from '../../state/store';
import { Icon } from '../components/Icon';
import { ItemPicker } from '../components/ItemPicker';
import { Modal } from '../components/Modal';
import { TotalsLine } from '../components/Values';
import { unitText } from '../format';
import { href, navigate } from '../router';
import { NotFound } from './NotFound';

const blank = (): Recipe => ({
  id: newId('recipe'),
  name: '',
  description: '',
  ingredients: [],
  servings: 1,
  steps: [],
  category: 'Comida',
  tags: [],
  origin: 'usuario',
  status: 'pendiente',
  favorite: false,
  createdAt: new Date().toISOString(),
});

export function RecipeEditor({ recipeId }: { recipeId?: string }) {
  const { data, update } = useStore();
  const existing = recipeId ? data.recipes.find((r) => r.id === recipeId) : undefined;
  if (recipeId && !existing) {
    return <NotFound title="Esta receta ya no está" message="Puede que se haya eliminado o que venga de una pauta anterior." back={{ to: '/recetas', label: 'Volver al recetario' }} />;
  }
  if (existing && existing.origin !== 'usuario') {
    return (
      <div className="empty-state">
        <p>Solo se pueden editar recetas propias. Duplica esta receta para crear tu versión.</p>
        <a className="btn" href={href('/recetas')}>Volver al recetario</a>
      </div>
    );
  }
  return (
    <Form
      initial={existing ?? blank()}
      isNew={!existing}
      onSave={(r) => {
        update((d) => ({ ...d, recipes: existing ? d.recipes.map((x) => (x.id === r.id ? r : x)) : [...d.recipes, r] }));
        navigate(`/recetas/${r.id}`);
      }}
    />
  );
}

function Form({ initial, isNew, onSave }: { initial: Recipe; isNew: boolean; onSave: (r: Recipe) => void }) {
  const { data } = useStore();
  const diet = useDiet();
  const ctx = useCalc();
  const [r, setR] = useState(initial);
  const [servings, setServings] = useState(String(initial.servings));
  const [prep, setPrep] = useState(initial.prepMinutes?.toString() ?? '');
  const [steps, setSteps] = useState(initial.steps.join('\n'));
  const [tags, setTags] = useState(initial.tags.join(', '));
  const [picking, setPicking] = useState(false);
  const [freeText, setFreeText] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const categories = [...new Set([...diet.meals.map((m) => m.name), 'Comida', 'Postre', 'Otra'])];
  const errors = {
    name: validateName(r.name),
    servings: validateServings(servings),
    prep: prep.trim() && validateQuantity(prep) ? 'Escribe los minutos como número o déjalo vacío.' : null,
    ingredients: r.ingredients.length === 0 ? 'Añade al menos un ingrediente.' : null,
    quantities: r.ingredients.some((i) => i.foodId && validateQuantity(i.quantity ?? 0)) ? 'Hay cantidades de ingredientes no válidas.' : null,
  };
  const valid = Object.values(errors).every((e) => !e);
  const setIng = (k: number, patch: Partial<Ingredient>) => setR({ ...r, ingredients: r.ingredients.map((x, j) => (j === k ? { ...x, ...patch } : x)) });
  const preview = recipePerServing({ ...r, servings: parseDecimal(servings) || 1 }, ctx);
  const show = (e: string | null) => submitted && e;

  return (
    <form
      className="stack-lg"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
        if (!valid) return;
        onSave({
          ...r,
          name: r.name.trim(),
          servings: parseDecimal(servings)!,
          prepMinutes: prep.trim() ? parseDecimal(prep)! : undefined,
          steps: steps.split('\n').map((s) => s.trim()).filter(Boolean),
          tags: tags.split(',').map((s) => s.trim()).filter(Boolean),
        });
      }}
    >
      <header className="page-head">
        <a href={href(isNew ? '/recetas' : `/recetas/${r.id}`)} className="back">← Cancelar</a>
        <h1>{isNew ? 'Nueva receta' : 'Editar receta'}</h1>
      </header>

      <label className="field">
        <span>Nombre *</span>
        <input value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} aria-invalid={!!show(errors.name)} required />
        {show(errors.name) && <span className="field-error" role="alert">{errors.name}</span>}
      </label>
      <label className="field">
        <span>Descripción</span>
        <textarea rows={3} value={r.description} onChange={(e) => setR({ ...r, description: e.target.value })} />
      </label>
      <div className="grid-fields">
        <label className="field"><span>Categoría</span>
          <select value={r.category} onChange={(e) => setR({ ...r, category: e.target.value })}>{categories.map((c) => <option key={c}>{c}</option>)}</select>
        </label>
        <label className="field"><span>Raciones *</span>
          <input inputMode="numeric" value={servings} onChange={(e) => setServings(e.target.value)} aria-invalid={!!show(errors.servings)} />
          {show(errors.servings) && <span className="field-error" role="alert">{errors.servings}</span>}
        </label>
        <label className="field"><span>Tiempo (min)</span>
          <input inputMode="numeric" value={prep} onChange={(e) => setPrep(e.target.value)} aria-invalid={!!show(errors.prep)} />
          {show(errors.prep) && <span className="field-error" role="alert">{errors.prep}</span>}
        </label>
        <label className="field"><span>Etiquetas (separadas por comas)</span><input value={tags} onChange={(e) => setTags(e.target.value)} /></label>
      </div>

      <section aria-labelledby="h-ing-ed">
        <h2 id="h-ing-ed">Ingredientes (para toda la receta)</h2>
        {r.ingredients.length === 0 && <p className="empty">Sin ingredientes todavía.</p>}
        <ul className="items">
          {r.ingredients.map((ing, k) => {
            const food = ing.foodId ? data.foods.find((f) => f.id === ing.foodId) : undefined;
            return (
              <li key={k} className="item">
                <span className="item-name">{ing.label}</span>
                {food ? (
                  <span className="item-amount qty">
                    <input aria-label={`Cantidad de ${ing.label}`} inputMode="decimal" value={ing.quantity ?? ''} onChange={(e) => setIng(k, { quantity: parseDecimal(e.target.value) ?? 0 })} />
                    <span className="qty-unit">{unitText(ing.unit ?? 'g', ing.quantity ?? 0, food)}</span>
                  </span>
                ) : (
                  <label className="check small"><input type="checkbox" checked={ing.note === 'libre'} onChange={(e) => setIng(k, { note: e.target.checked ? 'libre' : undefined })} /> Mi pauta dice que no se contabiliza</label>
                )}
                <span className="item-totals"><TotalsLine totals={ingredientTotals(ing, ctx)} showMacros={false} /></span>
                <span className="item-actions">
                  <button type="button" className="icon-btn" aria-label={`Quitar ${ing.label}`} onClick={() => setR({ ...r, ingredients: r.ingredients.filter((_, j) => j !== k) })}><Icon name="borrar" /></button>
                </span>
              </li>
            );
          })}
        </ul>
        {show(errors.ingredients) && <p className="field-error" role="alert">{errors.ingredients}</p>}
        {show(errors.quantities) && <p className="field-error" role="alert">{errors.quantities}</p>}
        <div className="row wrap">
          <button type="button" className="btn small" onClick={() => setPicking(true)}><Icon name="mas" size={16} /> Añadir alimento</button>
          <label className="field grow inline">
            <span className="sr-only">Ingrediente de texto libre</span>
            <input value={freeText} onChange={(e) => setFreeText(e.target.value)} placeholder="O escribe un ingrediente sin calcular (p. ej. especias)" />
          </label>
          <button type="button" className="btn small ghost" disabled={!freeText.trim()} onClick={() => { setR({ ...r, ingredients: [...r.ingredients, { label: freeText.trim() }] }); setFreeText(''); }}>Añadir texto</button>
        </div>
        <p className="subtotal">Por ración: <TotalsLine totals={preview} /></p>
      </section>

      <label className="field">
        <span>Preparación (un paso por línea)</span>
        <textarea rows={5} value={steps} onChange={(e) => setSteps(e.target.value)} />
      </label>

      {submitted && !valid && <p className="field-error" role="alert">Revisa los campos marcados.</p>}
      <button className="btn primary" type="submit">Guardar receta</button>

      <Modal title="Añadir ingrediente" open={picking} onClose={() => setPicking(false)}>
        <ItemPicker
          foodsOnly
          confirmLabel="Añadir ingrediente"
          onPick={(p) => {
            if (p.ref.kind !== 'food') return;
            const food = data.foods.find((f) => f.id === (p.ref as { foodId: string }).foodId)!;
            setR({ ...r, ingredients: [...r.ingredients, { foodId: food.id, label: food.name, quantity: p.quantity, unit: p.unit as Ingredient['unit'] }] });
            setPicking(false);
          }}
        />
      </Modal>
    </form>
  );
}
