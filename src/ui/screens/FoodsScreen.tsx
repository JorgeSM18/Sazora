import { useState } from 'react';
import { EXCHANGE_GROUPS, NUTRIENT_KEYS, type ExchangeGroup, type Food } from '../../domain/types';
import { useStore } from '../../state/store';
import { OriginBadge, StatusBadge } from '../components/Badges';
import { Icon } from '../components/Icon';
import { fmt, groupLabel } from '../format';
import { href } from '../router';
import { CatalogTabs } from './RecipesScreen';
import { NutritionLookup } from '../components/NutritionLookup';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function nutritionStatus(f: Food): { text: string; cls: string } {
  if (!f.nutrition) return { text: 'Sin datos nutricionales', cls: 'warn' };
  const known = NUTRIENT_KEYS.filter((k) => f.nutrition!.values[k] !== null).length;
  const per = `${fmt(f.nutrition.per, 1)} ${f.nutrition.unit === 'unidad' ? f.unitLabel ?? 'ud.' : f.nutrition.unit}`;
  if (known < NUTRIENT_KEYS.length) return { text: `Datos parciales (${known}/4) por ${per}`, cls: 'warn' };
  return { text: `${fmt(f.nutrition.values.kcal!)} kcal por ${per}`, cls: '' };
}

export function FoodsScreen() {
  const { data } = useStore();
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<ExchangeGroup | ''>('');
  const [missing, setMissing] = useState(false);
  const [products, setProducts] = useState(false);
  const productDocs = new Set(data.documents.filter((d) => d.kind === 'productos').map((d) => d.id));
  const isProduct = (f: Food) => f.equivalences.some((e) => productDocs.has(e.source.doc));
  const list = data.foods
    .filter((f) => norm(`${f.name} ${f.brand ?? ''}`).includes(norm(q)) && (!group || f.group === group) && (!missing || !f.nutrition) && (!products || isProduct(f)))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const withoutData = data.foods.filter((f) => !f.nutrition).length;

  return (
    <div className="stack-lg">
      <CatalogTabs current="alimentos" />
      <header className="section-head">
        <h1>Alimentos</h1>
        <a className="btn primary" href={href('/alimentos/nuevo')}><Icon name="mas" size={16} /> Nuevo alimento</a>
      </header>
      <p className="note">
        Tus documentos dicen <b>cuánto es una porción</b>, pero no traen calorías ni macros. {withoutData} alimentos no tienen datos nutricionales:
        puedes añadirlos desde la etiqueta del producto o una fuente fiable, o buscarlos con Gemini (se buscan los de la lista filtrada). Mientras tanto se calculan porciones, no calorías.
      </p>
      <div className="filters">
        <label className="field grow"><span>Buscar</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre o marca" /></label>
        <label className="field"><span>Grupo</span>
          <select value={group} onChange={(e) => setGroup(e.target.value as ExchangeGroup | '')}>
            <option value="">Todos</option>
            {EXCHANGE_GROUPS.map((g) => <option key={g} value={g}>{groupLabel(g)}</option>)}
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={missing} onChange={(e) => setMissing(e.target.checked)} /> Solo sin datos nutricionales</label>
        {productDocs.size > 0 && <label className="check"><input type="checkbox" checked={products} onChange={(e) => setProducts(e.target.checked)} /> Solo productos recomendados</label>}
      </div>
      <div className="row wrap"><NutritionLookup foods={list} /></div>
      {list.length === 0 ? (
        <div className="empty-state"><p>Ningún alimento coincide.</p><a className="btn" href={href('/alimentos/nuevo')}>Crear alimento</a></div>
      ) : (
        <ul className="list">
          {list.map((f) => {
            const ns = nutritionStatus(f);
            return (
              <li key={f.id}>
                <a href={href(`/alimentos/${f.id}`)}>
                  <span className="list-title">{f.name}{f.brand ? <span className="muted"> · {f.brand}</span> : null}</span>
                  <span className="list-meta">
                    <OriginBadge origin={f.origin} /> {f.group && <span className="badge">{groupLabel(f.group)}</span>} <span className="badge">{f.state}</span>
                    {f.status === 'pendiente' && <StatusBadge status="pendiente" />}
                    <span className={`small ${ns.cls === 'warn' ? 'warn-text' : 'muted'}`}>{ns.text}</span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
