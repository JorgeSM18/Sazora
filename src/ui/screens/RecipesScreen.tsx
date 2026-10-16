import { useState } from 'react';
import { recipePerServing } from '../../domain/nutrition';
import type { Origin, Recipe } from '../../domain/types';
import { useCalc, useStore } from '../../state/store';
import { OriginBadge, StatusBadge } from '../components/Badges';
import { Icon } from '../components/Icon';
import { TotalsLine } from '../components/Values';
import { href } from '../router';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const toggleFavorite = (recipes: Recipe[], id: string) => recipes.map((r) => (r.id === id ? { ...r, favorite: !r.favorite } : r));

export function RecipesScreen() {
  const { data, update } = useStore();
  const ctx = useCalc();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [origin, setOrigin] = useState<Origin | ''>('');
  const [favs, setFavs] = useState(false);

  const visible = data.recipes;
  const categories = [...new Set(visible.map((r) => r.category))].sort();
  const list = visible.filter(
    (r) =>
      norm(`${r.name} ${r.tags.join(' ')}`).includes(norm(q)) &&
      (!category || r.category === category) &&
      (!origin || r.origin === origin) &&
      (!favs || r.favorite),
  );

  return (
    <div className="stack-lg">
      <header className="section-head">
        <h1>Recetas</h1>
        <a className="btn primary" href={href('/recetas/nueva')}><Icon name="mas" size={16} /> Nueva receta</a>
      </header>
      <div className="filters">
        <label className="field grow"><span>Buscar</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre o etiqueta" /></label>
        <label className="field"><span>Categoría</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Todas</option>
            {categories.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="field"><span>Origen</span>
          <select value={origin} onChange={(e) => setOrigin(e.target.value as Origin | '')}>
            <option value="">Todos</option>
            <option value="documento">De tu pauta</option>
            <option value="usuario">Propias</option>
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={favs} onChange={(e) => setFavs(e.target.checked)} /> Solo favoritas</label>
      </div>

      {list.length === 0 ? (
        <div className="empty-state">
          <p>{visible.length === 0 ? 'Todavía no hay recetas.' : 'Ninguna receta coincide con los filtros.'}</p>
          <a className="btn" href={href('/recetas/nueva')}>Crear una receta</a>
        </div>
      ) : (
        <ul className="cards">
          {list.map((r) => (
            <li key={r.id} className="card recipe-card">
              <div className="card-top">
                <a className="card-title" href={href(`/recetas/${r.id}`)}>{r.name}</a>
                <button className="icon-btn fav" aria-pressed={r.favorite} aria-label={r.favorite ? `Quitar ${r.name} de favoritas` : `Marcar ${r.name} como favorita`} onClick={() => update((d) => ({ ...d, recipes: toggleFavorite(d.recipes, r.id) }))}>
                  <Icon name="estrella" filled={r.favorite} />
                </button>
              </div>
              <p className="badges"><OriginBadge origin={r.origin} /> <span className="badge">{r.category}</span> {r.status === 'pendiente' && <StatusBadge status="pendiente" />}</p>
              <p className="small">Por ración: <TotalsLine totals={recipePerServing(r, ctx)} /></p>
              <p className="muted small">{r.servings} {r.servings === 1 ? 'ración' : 'raciones'}{r.prepMinutes ? ` · ${r.prepMinutes} min` : ''}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
