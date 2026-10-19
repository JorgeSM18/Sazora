// Guías de consulta: documentos de la nutricionista que no cambian (lista de alimentos, crudo a cocido)
// y la guía de productos. Versión visual y acceso al PDF original completo.

import { useMemo, useState, type ReactNode } from 'react';
import { cookedToRaw, currentDoc } from '../../domain/importGuides';
import { findEquivalence, foodTotals } from '../../domain/nutrition';
import { parseDecimal } from '../../domain/validation';
import { EXCHANGE_GROUPS, type ConversionGuide, type ExchangeGroup, type Food, type ProductGuide, type SourceDocument } from '../../domain/types';
import { useCalc, useStore } from '../../state/store';
import { Icon } from '../components/Icon';
import { fmt, groupLabel, portionsText } from '../format';
import { href } from '../router';
import { useDocumentUrl } from '../documents';
import { NotFound } from './NotFound';
import { addToDefaultList } from '../../data/shopping';
import { reviewItems } from '../../domain/review';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function PdfButton({ doc }: { doc: SourceDocument }) {
  const url = useDocumentUrl()(doc.id);
  if (!url) return null;
  return (
    <a className="btn" href={url} target="_blank" rel="noopener">
      <Icon name="documento" size={16} /> Ver PDF completo
    </a>
  );
}

function GuideHeader({ title, doc, children }: { title: string; doc?: SourceDocument; children?: ReactNode }) {
  return (
    <header className="page-head">
      <a href={href('/guias')} className="back">← Documentos</a>
      <h1>{title}</h1>
      {doc && <p className="muted small">{doc.title}{doc.author ? ` · ${doc.author}` : ''}{doc.version ? ` · versión ${doc.version}` : ''}</p>}
      {children}
      {doc && <div className="row wrap"><PdfButton doc={doc} /></div>}
    </header>
  );
}

const Missing = ({ what }: { what: string }) => (
  <div className="empty-state">
    <p>Todavía no has subido {what}.</p>
    <a className="btn primary" href={href('/dieta/importar')}><Icon name="subir" size={16} /> Subir PDF</a>
  </div>
);

// ── Índice ─────────────────────────────────────────────────

export function GuidesScreen() {
  const { data } = useStore();
  const lista = currentDoc(data, 'lista-intercambios');
  const conversion = currentDoc(data, 'conversion');
  const productos = currentDoc(data, 'productos');
  const plan = data.diet && data.documents.find((d) => d.id === data.diet!.documents[0] && d.kind === 'plan');
  const pending = reviewItems(data).filter((r) => !r.resolved).length;
  const cards = [
    { to: '/guias/lista', title: 'Lista de alimentos', text: 'Cuánto es 1 porción de cada alimento, por grupos.', doc: lista },
    { to: '/guias/crudo-cocido', title: 'De crudo a cocido', text: 'Cuánto pesa cocinada cada porción, con calculadora.', doc: conversion },
    { to: '/guias/productos', title: 'Productos recomendados', text: 'Por supermercado, con sus porciones.', doc: productos },
  ];
  return (
    <div className="stack-lg">
      <header className="page-head">
        <h1>Documentos</h1>
        <p className="muted">Lo que te ha dado tu nutricionista, para consultarlo en cualquier momento, también en su PDF original.</p>
        <div className="row wrap">
          <a className="btn primary" href={href('/dieta/importar')}><Icon name="subir" size={16} /> Subir PDF</a>
        </div>
        <p className="muted small">¿Te ha dado una versión nueva? Súbela y sustituye a la anterior; antes de guardar revisas lo extraído.</p>
        {pending > 0 && <p className="small"><a href={href('/dudas')}>{pending} {pending === 1 ? 'duda' : 'dudas'} de la importación por revisar</a></p>}
      </header>
      <ul className="cards">
        {cards.map((c) => (
          <li key={c.to} className="card guide-card">
            <a className="card-title" href={href(c.to)}>{c.title}</a>
            <p className="muted small">{c.doc ? c.text : 'Aún no subida.'}</p>
            <div className="row wrap">
              {c.doc ? <a className="btn small primary" href={href(c.to)}>Abrir</a> : <a className="btn small" href={href('/dieta/importar')}>Subir PDF</a>}
              {c.doc && <PdfButton doc={c.doc} />}
              {c.doc && <a className="btn small ghost" href={href('/dieta/importar')}>Sustituir</a>}
            </div>
          </li>
        ))}
        {plan && (
          <li className="card guide-card">
            <a className="card-title" href={href('/dieta')}>Tu pauta</a>
            <p className="muted small">{plan.title}: porciones, indicaciones y platos.</p>
            <div className="row wrap">
              <a className="btn small primary" href={href('/dieta')}>Abrir</a>
              <PdfButton doc={plan} />
              <a className="btn small ghost" href={href('/dieta/importar')}>Sustituir</a>
            </div>
          </li>
        )}
      </ul>
    </div>
  );
}

// ── Lista de alimentos ─────────────────────────────────────

export function FoodListGuide() {
  const { data } = useStore();
  const ctx = useCalc();
  const doc = currentDoc(data, 'lista-intercambios');
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<ExchangeGroup | ''>('');
  const foods = useMemo(
    () => (doc ? data.foods.filter((f) => f.group && f.equivalences.some((e) => e.source.doc === doc.id)) : []),
    [data.foods, doc],
  );
  if (!doc) return <><GuideHeader title="Lista de alimentos" /><Missing what="la lista de alimentos" /></>;

  const byId = new Map(data.foods.map((f) => [f.id, f]));
  const shown = foods.filter((f) => (!group || f.group === group) && norm(f.name).includes(norm(q)));
  const groups = EXCHANGE_GROUPS.filter((g) => shown.some((f) => f.group === g));

  return (
    <div className="stack-lg">
      <GuideHeader title="Lista de alimentos" doc={doc} />
      <div className="filters">
        <label className="field grow"><span>Buscar</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Arroz, pollo, aguacate…" /></label>
      </div>
      <div className="chips" role="group" aria-label="Grupo">
        <button className={!group ? 'chip on' : 'chip'} aria-pressed={!group} onClick={() => setGroup('')}>Todos</button>
        {EXCHANGE_GROUPS.filter((g) => foods.some((f) => f.group === g)).map((g) => (
          <button key={g} className={group === g ? 'chip on' : 'chip'} aria-pressed={group === g} onClick={() => setGroup(g)}>{groupLabel(g)}</button>
        ))}
      </div>
      {shown.length === 0 && <p className="empty">Ningún alimento coincide.</p>}
      {groups.map((g) => (
        <section key={g} aria-labelledby={`h-g-${g}`} className="stack">
          <h2 id={`h-g-${g}`}>{groupLabel(g)}</h2>
          <ul className="food-grid">
            {shown.filter((f) => f.group === g).map((f) => (
              <FoodCard key={f.id} food={f} docId={doc.id} cooked={byId.get(`${f.id}-cocido`)} ctx={ctx} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function FoodCard({ food, docId, cooked, ctx }: { food: Food; docId: string; cooked?: Food; ctx: ReturnType<typeof useCalc> }) {
  const eqs = food.equivalences.filter((e) => e.source.doc === docId);
  const cookedEq = cooked && findEquivalence(cooked, 'g', ctx);
  return (
    <li className="food-card">
      <a href={href(`/alimentos/${food.id}`)} className="food-card-name">{food.name}</a>
      {eqs.map((e, k) => (
        <p key={k} className="pauta-text">
          {e.unit === 'porcion' ? '1 porción' : `${fmt(e.amount, 1)} ${e.unit === 'unidad' ? food.unitLabel ?? 'ud.' : e.unit}`}
          {e.unit !== 'porcion' && <span className="muted"> = {portionsText(e.portions)}</span>}
        </p>
      ))}
      {eqs[0]?.householdMeasure && <p className="muted small">{eqs[0].householdMeasure}</p>}
      {cookedEq && <p className="small cooked">Cocido: {cookedEq.householdMeasure}</p>}
      <span className="badge">{food.state}</span>
    </li>
  );
}

// ── Crudo a cocido ─────────────────────────────────────────

export function ConversionGuideScreen() {
  const { data } = useStore();
  const ctx = useCalc();
  const doc = currentDoc(data, 'conversion');
  const guide = doc?.guide as ConversionGuide | undefined;
  const [rowIndex, setRowIndex] = useState(0);
  const [grams, setGrams] = useState('');
  if (!doc || !guide) return <><GuideHeader title="De crudo a cocido" /><Missing what="la tabla de crudo a cocido" /></>;

  const sections = [...new Set(guide.rows.map((r) => r.section))];
  const row = guide.rows[rowIndex];
  const n = parseDecimal(grams);
  const raw = row && n && n > 0 ? cookedToRaw(row, n) : null;
  const cookedFood = row?.foodIds[0] ? data.foods.find((f) => f.id === `${row.foodIds[0]}-cocido`) : undefined;
  const portions = cookedFood && n && n > 0 ? foodTotals(cookedFood, n, 'g', ctx).portions : null;
  const range = (min: number, max: number) => (Math.abs(min - max) < 0.5 ? `${fmt(min)}` : `${fmt(min)}-${fmt(max)}`);

  return (
    <div className="stack-lg">
      <GuideHeader title="De crudo a cocido" doc={doc} />

      <section className="panel stack calc" aria-labelledby="h-calc">
        <h2 id="h-calc">¿Cuánto es lo que has cocinado?</h2>
        <div className="grid-fields">
          <label className="field"><span>Alimento</span>
            <select value={rowIndex} onChange={(e) => setRowIndex(Number(e.target.value))}>
              {guide.rows.map((r, k) => <option key={k} value={k}>{r.names.join(', ')}</option>)}
            </select>
          </label>
          <label className="field"><span>Peso cocinado (g)</span>
            <input inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} placeholder="p. ej. 150" />
          </label>
        </div>
        {raw && (
          <p className="calc-result" role="status">
            ≈ <b>{range(raw.min, raw.max)} g en crudo</b>
            {portions && Object.keys(portions).length > 0 && <> · <b className="pauta-text">{portionsText(portions)}</b></>}
          </p>
        )}
        {raw && !portions && <p className="muted small">Este alimento no está enlazado a tu lista: se muestra solo el peso en crudo.</p>}
      </section>

      {guide.rules.map((r, k) => <p key={k} className="note">{r.text}</p>)}

      {sections.map((s) => (
        <section key={s} aria-labelledby={`h-cc-${s}`} className="stack">
          <h2 id={`h-cc-${s}`}>{s}</h2>
          <div className="table-scroll">
            <table className="data">
              <thead><tr><th scope="col">Alimento</th><th scope="col" className="num">Crudo</th><th scope="col" className="num">Cocido</th></tr></thead>
              <tbody>
                {guide.rows.filter((r) => r.section === s).map((r, k) => (
                  <tr key={k}>
                    <th scope="row">{r.names.join(', ')}</th>
                    <td className="num">{fmt(r.rawGrams)} g</td>
                    <td className="num">{range(r.cookedMin, r.cookedMax)} g</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {guide.notes.map((r, k) => <p key={k} className="muted small">{r.text}</p>)}
    </div>
  );
}

// ── Productos ──────────────────────────────────────────────

export function ProductsGuideScreen({ onAdd }: { onAdd?: (text: string) => Promise<void> }) {
  const { data } = useStore();
  const doc = currentDoc(data, 'productos');
  const guide = doc?.guide as ProductGuide | undefined;
  const [store, setStore] = useState('');
  const [q, setQ] = useState('');
  const [added, setAdded] = useState<string | null>(null);
  if (!doc || !guide) return <><GuideHeader title="Productos recomendados" /><Missing what="la guía de productos" /></>;

  const stores = guide.stores.filter((s) => !store || s.store === store);
  const match = (p: { name: string; raw: string; category: string }) => norm(`${p.name} ${p.raw} ${p.category}`).includes(norm(q));

  return (
    <div className="stack-lg">
      <GuideHeader title="Productos recomendados" doc={doc} />
      <div className="filters">
        <label className="field grow"><span>Buscar</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Yogur, pan, tortitas…" /></label>
      </div>
      <div className="chips" role="group" aria-label="Supermercado">
        <button className={!store ? 'chip on' : 'chip'} aria-pressed={!store} onClick={() => setStore('')}>Todos</button>
        {guide.stores.map((s) => (
          <button key={s.store} className={store === s.store ? 'chip on' : 'chip'} aria-pressed={store === s.store} onClick={() => setStore(s.store)}>{s.store}</button>
        ))}
      </div>
      {added && <p className="note" role="status">Añadido a la compra: {added}</p>}
      {stores.map((s) => {
        const items = s.products.filter(match);
        if (!items.length) return null;
        const categories = [...new Set(items.map((p) => p.category))];
        return (
          <section key={s.store} aria-labelledby={`h-st-${s.store}`} className="stack">
            <h2 id={`h-st-${s.store}`}>{s.store}</h2>
            {categories.map((c) => (
              <div key={c} className="stack">
                <h3 className="sub">{c}</h3>
                <ul className="product-list">
                  {items.filter((p) => p.category === c).map((p, k) => (
                    <li key={k}>
                      <div>
                        <p className="product-name">{p.foodId ? <a href={href(`/alimentos/${p.foodId}`)}>{p.name}</a> : p.name}</p>
                        {p.equivalence && <p className="pauta-text small">{p.equivalence}</p>}
                        {p.raw && p.raw !== p.equivalence && <p className="muted small">{p.raw}</p>}
                      </div>
                      {onAdd && (
                        <button className="btn small ghost" onClick={() => onAdd(`${p.name} (${s.store})`).then(() => setAdded(p.name), (e: Error) => setAdded(`no se pudo añadir (${e.message})`))} aria-label={`Añadir ${p.name} a la compra`}>
                          <Icon name="mas" size={16} /> Compra
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        );
      })}
      {stores.every((s) => !s.products.some(match)) && <p className="empty">Ningún producto coincide.</p>}
    </div>
  );
}

/** Ruta /guias/:id */
export function GuideRoute({ id }: { id?: string }) {
  if (!id) return <GuidesScreen />;
  if (id === 'lista') return <FoodListGuide />;
  if (id === 'crudo-cocido') return <ConversionGuideScreen />;
  if (id === 'productos') return <ProductsGuideScreen onAdd={(text) => addToDefaultList([{ text, quantity: '', category: 'Productos recomendados' }])} />;
  return <NotFound />;
}
