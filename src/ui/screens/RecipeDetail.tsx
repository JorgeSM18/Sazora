import { useState } from 'react';
import { ingredientTotals, recipePerServing, recipeTotals, scaleTotals } from '../../domain/nutrition';
import { addPlanItem, newId } from '../../domain/planner';
import { validateQuantity, parseDecimal } from '../../domain/validation';
import { EXCHANGE_GROUPS, type Recipe } from '../../domain/types';
import { removalBlocker, removeEntity } from '../../data/maintenance';
import { useDiet, useCalc, useStore } from '../../state/store';
import { OriginBadge, StatusBadge } from '../components/Badges';
import { Icon } from '../components/Icon';
import { ConfirmButton, Modal } from '../components/Modal';
import { NutrientTable, TotalsLine } from '../components/Values';
import { amountText, portionsText, todayISO } from '../format';
import { href, navigate } from '../router';
import { NotFound } from './NotFound';
import { SourceTag } from './DietScreen';
import { toggleFavorite } from './RecipesScreen';

export function duplicateRecipe(r: Recipe): Recipe {
  return {
    ...r,
    id: newId('recipe'),
    name: `${r.name} (copia)`,
    origin: 'usuario',
    status: 'pendiente',
    favorite: false,
    description: r.origin === 'documento' ? `${r.description}\n\nBasada en un plato documentado de tu pauta.` : r.description,
    createdAt: new Date().toISOString(),
    ingredients: r.ingredients.map((i) => ({ ...i })),
    steps: [...r.steps],
    tags: [...r.tags],
  };
}

export function RecipeDetail({ recipeId }: { recipeId: string }) {
  const { data, update } = useStore();
  const diet = useDiet();
  const ctx = useCalc();
  const recipe = data.recipes.find((r) => r.id === recipeId);
  const [servings, setServings] = useState(recipe?.servings ?? 1);
  const [planning, setPlanning] = useState(false);

  if (!recipe) {
    return <NotFound title="Esta receta ya no está" message="Puede que se haya eliminado o que venga de una pauta anterior." back={{ to: '/recetas', label: 'Volver al recetario' }} />;
  }

  const factor = servings / recipe.servings;
  const total = scaleTotals(recipeTotals(recipe, ctx), factor);
  const perServing = recipePerServing(recipe, ctx);
  const meal = diet.meals.find((m) => m.id === recipe.mealHint);
  const counted = recipe.ingredients.filter((i) => i.foodId).length;
  const blocker = removalBlocker(data, { kind: 'recipe', id: recipe.id });
  const matchesMeal =
    meal &&
    !perServing.portionsIncomplete &&
    EXCHANGE_GROUPS.every((g) => Math.abs((perServing.portions[g] ?? 0) - (meal.portionTargets[g] ?? 0)) < 1e-9);

  return (
    <article className="stack-lg recipe">
      <header className="page-head">
        <a href={href('/recetas')} className="back">← Recetas</a>
        <div className="section-head">
          <h1>{recipe.name}</h1>
          <button className="icon-btn fav" aria-pressed={recipe.favorite} aria-label={recipe.favorite ? 'Quitar de favoritas' : 'Marcar como favorita'} onClick={() => update((d) => ({ ...d, recipes: toggleFavorite(d.recipes, recipe.id) }))}>
            <Icon name="estrella" filled={recipe.favorite} size={24} />
          </button>
        </div>
        <p className="badges"><OriginBadge origin={recipe.origin} /> <span className="badge">{recipe.category}</span> <StatusBadge status={recipe.status} /></p>
        {recipe.description && <p className="lead">{recipe.description}</p>}
        {recipe.source && <p className="muted small">Fuente: <SourceTag source={recipe.source} /></p>}
      </header>

      <section className={`compat ${recipe.origin === 'documento' ? 'pauta' : ''}`} aria-label="Relación con tu pauta">
        {recipe.origin === 'documento' ? (
          <p>Plato del ejemplo de tu pauta{meal ? ` para ${meal.name.toLowerCase()}` : ''}.</p>
        ) : (
          <p>Compatibilidad con tu pauta <b>no comprobada</b>: revisa las porciones antes de usarla.</p>
        )}
        <p>Porciones por ración: <b>{portionsText(perServing.portions) || '—'}</b>{perServing.portionsIncomplete ? ' (incompletas)' : ''}.</p>
        {meal && <p>Pauta de {meal.name.toLowerCase()}: {portionsText(meal.portionTargets)}.{matchesMeal ? ' Las porciones calculadas coinciden.' : ''}</p>}
        <p className="muted small">No se comprueban automáticamente otras indicaciones de la pauta (restricciones, alimentos a evitar…).</p>
      </section>

      <div className="row wrap">
        <label className="field stepper">
          <span>Raciones</span>
          <span className="row">
            <button className="icon-btn" onClick={() => setServings((s) => Math.max(1, s - 1))} aria-label="Una ración menos" disabled={servings <= 1}>−</button>
            <output aria-live="polite">{servings}</output>
            <button className="icon-btn" onClick={() => setServings((s) => s + 1)} aria-label="Una ración más">+</button>
          </span>
        </label>
        <button className="btn primary" onClick={() => setPlanning(true)}><Icon name="plan" size={16} /> Añadir al plan</button>
        <button className="btn" onClick={() => { const copy = duplicateRecipe(recipe); update((d) => ({ ...d, recipes: [...d.recipes, copy] })); navigate(`/recetas/${copy.id}/editar`); }}><Icon name="copiar" size={16} /> Duplicar</button>
        {recipe.origin === 'usuario' && <a className="btn" href={href(`/recetas/${recipe.id}/editar`)}><Icon name="editar" size={16} /> Editar</a>}
      </div>
      {recipe.origin !== 'usuario' && <p className="muted small">Los platos de la pauta no se editan: duplícalos para crear tu versión.</p>}

      <section aria-labelledby="h-ing">
        <h2 id="h-ing">Ingredientes <span className="muted">({servings} {servings === 1 ? 'ración' : 'raciones'})</span></h2>
        <ul className="ingredients">
          {recipe.ingredients.map((ing, k) => {
            const food = ing.foodId ? data.foods.find((f) => f.id === ing.foodId) : undefined;
            const t = scaleTotals(ingredientTotals(ing, ctx), factor);
            return (
              <li key={k}>
                <span className="ing-qty">{ing.quantity !== undefined && ing.unit ? amountText(ing.quantity * factor, ing.unit, food) : ''}</span>
                <span className="ing-name">{food ? <a href={href(`/alimentos/${food.id}`)}>{ing.label}</a> : ing.label}</span>
                <span className="ing-meta small">
                  {ing.note === 'libre' ? <span className="muted">no se contabiliza</span> : <TotalsLine totals={t} showMacros={false} />}
                  {ing.note && ing.note !== 'libre' && <span className="muted"> · {ing.note}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {recipe.steps.length > 0 && (
        <section aria-labelledby="h-pasos">
          <h2 id="h-pasos">Preparación{recipe.prepMinutes ? <span className="muted"> · {recipe.prepMinutes} min</span> : null}</h2>
          <ol className="steps">{recipe.steps.map((s, k) => <li key={k}>{s}</li>)}</ol>
        </section>
      )}

      <section aria-labelledby="h-nut" className="two-col">
        <h2 id="h-nut" className="span">Información nutricional</h2>
        <NutrientTable totals={perServing} caption="Por ración" />
        <NutrientTable totals={total} caption={`Total (${servings} ${servings === 1 ? 'ración' : 'raciones'})`} />
        <p className="note span">
          Calculado con {counted} de {recipe.ingredients.length} ingredientes enlazados a alimentos.
          {perServing.issues.length > 0 && ` Sin datos completos: ${[...new Set(perServing.issues.map((i) => i.subject))].join(', ')}.`}
          {' '}Los valores con “≥” son mínimos; “—” significa desconocido.
        </p>
      </section>

      {recipe.origin === 'usuario' && (
        <section className="panel">
          {blocker ? <p className="muted">No se puede eliminar: {blocker}</p> : (
            <ConfirmButton title="Eliminar receta" message={`Se eliminará “${recipe.name}” y se quitará de los planes donde aparezca.`} onConfirm={() => { update((d) => removeEntity(d, { kind: 'recipe', id: recipe.id })); navigate('/recetas'); }}>
              Eliminar receta
            </ConfirmButton>
          )}
        </section>
      )}

      <Modal title="Añadir al plan" open={planning} onClose={() => setPlanning(false)}>
        <AddToPlanForm
          defaultMeal={recipe.mealHint ?? diet.meals[0]!.id}
          defaultServings={1}
          onAdd={(date, mealId, qty) => {
            update((d) => ({ ...d, plan: addPlanItem(d.plan, { date, mealId, ref: { kind: 'recipe', recipeId: recipe.id }, quantity: qty, unit: 'racion' }) }));
            setPlanning(false);
            navigate(`/plan?fecha=${date}`);
          }}
        />
      </Modal>
    </article>
  );
}

function AddToPlanForm({ defaultMeal, defaultServings, onAdd }: { defaultMeal: string; defaultServings: number; onAdd: (date: string, meal: string, qty: number) => void }) {
  const diet = useDiet();
  const [date, setDate] = useState(todayISO());
  const [meal, setMeal] = useState(diet.meals.some((m) => m.id === defaultMeal) ? defaultMeal : diet.meals[0]!.id);
  const [qty, setQty] = useState(String(defaultServings));
  const err = validateQuantity(qty);
  return (
    <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); const n = parseDecimal(qty); if (!err && n !== null) onAdd(date, meal, n); }}>
      <label className="field"><span>Día</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
      <label className="field"><span>Comida</span><select value={meal} onChange={(e) => setMeal(e.target.value)}>{diet.meals.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      <label className="field"><span>Raciones que vas a comer</span><input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} aria-invalid={!!err} /></label>
      {err && <p className="field-error" role="alert">{err}</p>}
      <p className="muted small">Se añade como previsto. Lo marcarás como comido desde el plan.</p>
      <button className="btn primary" type="submit" disabled={!!err}>Añadir al plan</button>
    </form>
  );
}

