import { useState } from 'react';
import { EXCHANGE_GROUPS, NUTRIENT_KEYS, NUTRIENT_LABELS, type Diet, type ExchangeGroup, type Food, type NutrientTargets, type RuleKind, type SourceRef } from '../../domain/types';
import { findEquivalence } from '../../domain/nutrition';
import { parseNutrients } from '../../domain/validation';
import { useDiet, useCalc, useStore } from '../../state/store';
import { StatusBadge } from '../components/Badges';
import { fmt, fmtPortion, GROUP_SHORT, groupLabel, portionsText } from '../format';
import { href } from '../router';
import { useDocumentUrl } from '../documents';
import { reviewItems, setReviewResolved } from '../../domain/review';

const RULE_TITLES: Record<RuleKind, string> = {
  libre: 'No se contabiliza',
  equivalencia: 'Equivalencias',
  sustitucion: 'Sustituciones',
  restriccion: 'Restricciones',
  consejo: 'Pautas y consejos',
};

export function SourceTag({ source }: { source: SourceRef }) {
  const { data } = useStore();
  const doc = data.documents.find((d) => d.id === source.doc);
  const text = `${doc?.title ?? source.doc}${source.page ? `, pág. ${source.page}` : ''}`;
  const url = useDocumentUrl()(source.doc, source.page);
  return url ? (
    <a className="source" href={url} target="_blank" rel="noopener" title="Abrir el documento original en esta página">{text}</a>
  ) : (
    <span className="source">{text}</span>
  );
}

export function DietScreen() {
  const { data, update } = useStore();
  const diet = useDiet();
  const groups = EXCHANGE_GROUPS.filter((g) => diet.meals.some((m) => m.portionTargets[g] !== undefined) || diet.dailyPortionTargets[g] !== undefined);
  const docs = data.documents.filter((d) => diet.documents.includes(d.id));
  const review = reviewItems(data);
  const pending = review.filter((r) => !r.resolved);
  const documentUrl = useDocumentUrl();
  const setDiet = (fn: (d: Diet) => Diet) => update((x) => ({ ...x, diet: x.diet && fn(x.diet) }));

  return (
    <div className="stack-lg">
      <header className="page-head">
        <p className="kicker">Mi dieta</p>
        <h1>{diet.name}</h1>
        <p className="muted">{diet.holder} · importada el {diet.importedAt} <StatusBadge status={diet.status} /></p>
        {diet.notes.map((n) => <p key={n} className="note">{n}</p>)}
      </header>

      <section aria-labelledby="h-docs">
        <h2 id="h-docs">Documentos originales</h2>
        <p className="muted">Los PDF tal como te los dio la nutricionista. Las referencias “pág. N” de esta pantalla abren el documento en esa página.</p>
        <ul className="doc-list">
          {docs.map((d) => {
            const url = documentUrl(d.id);
            return (
              <li key={d.id}>
                {url ? <a className="btn" href={url} target="_blank" rel="noopener">Abrir {d.title}</a> : <span>{d.title}</span>}
                <span className="muted small">{d.version ? `Versión ${d.version}` : ''}{d.version && d.author ? ' · ' : ''}{d.author ?? ''}</span>
              </li>
            );
          })}
        </ul>
        <div className="import-cta">
          <a className="btn primary" href={href('/dieta/importar')}>Importar nueva versión desde PDF</a>
        </div>
      </section>

      <section aria-labelledby="h-pauta">
        <h2 id="h-pauta">Porciones por comida</h2>
        <div className="table-scroll">
          <table className="data pauta-table">
            <thead>
              <tr><th scope="col">Comida</th>{groups.map((g) => <th key={g} scope="col">{GROUP_SHORT[g]}</th>)}</tr>
            </thead>
            <tbody>
              {diet.meals.map((m) => (
                <tr key={m.id}><th scope="row">{m.name}</th>{groups.map((g) => <td key={g} className="num">{m.portionTargets[g] !== undefined ? fmtPortion(m.portionTargets[g]!) : '–'}</td>)}</tr>
              ))}
              <tr className="total"><th scope="row">Total del día</th>{groups.map((g) => <td key={g} className="num">{diet.dailyPortionTargets[g] !== undefined ? fmtPortion(diet.dailyPortionTargets[g]!) : '–'}</td>)}</tr>
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="h-reglas">
        <h2 id="h-reglas">Indicaciones de la pauta</h2>
        {(Object.keys(RULE_TITLES) as RuleKind[]).map((kind) => {
          const rules = diet.rules.filter((r) => r.kind === kind);
          if (!rules.length) return null;
          return (
            <div key={kind} className="rule-group">
              <h3>{RULE_TITLES[kind]}</h3>
              <ul className="rules">
                {rules.map((r) => (
                  <li key={r.id}>{r.text} <SourceTag source={r.source} /> {r.status !== 'verificado' && <StatusBadge status={r.status} />}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      <ExchangeList diet={diet} />

      <section aria-labelledby="h-dudas">
        <h2 id="h-dudas">Dudas de la importación {pending.length > 0 && <span className="badge warn">{pending.length} pendientes</span>}</h2>
        {review.length === 0 ? (
          <p className="empty">No hay dudas registradas.</p>
        ) : (
          <ul className="review">
            {review.map((r) => (
              <li key={r.id} className={r.resolved ? 'done' : ''}>
                <label className="check">
                  <input type="checkbox" checked={r.resolved} onChange={(e) => update((d) => setReviewResolved(d, r.id, e.target.checked))} />
                  <span>{r.text} <SourceTag source={r.source} /></span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      <TargetsForm diet={diet} onSave={(t) => setDiet((d) => ({ ...d, nutrientTargets: t, nutrientTargetsSource: Object.keys(t).length ? 'usuario' : undefined }))} />

      <section aria-labelledby="h-datos" className="panel">
        <h2 id="h-datos">Tus datos</h2>
        <p className="muted">Tus datos se guardan en el servidor de Sazora, en tu usuario. Puedes descargar una copia cuando quieras.</p>
        <div className="row wrap">
          <button className="btn" onClick={() => exportJson(data)}>Descargar copia (JSON)</button>
        </div>
      </section>
    </div>
  );
}

function exportJson(data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `sazora-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function ExchangeList({ diet }: { diet: Diet }) {
  const { data } = useStore();
  const ctx = useCalc();
  const byGroup = new Map<ExchangeGroup, Food[]>();
  for (const f of data.foods) {
    if (f.group && f.equivalences.some((e) => diet.exchangeDocs.includes(e.source.doc))) {
      byGroup.set(f.group, [...(byGroup.get(f.group) ?? []), f]);
    }
  }
  if (byGroup.size === 0) return null;
  return (
    <section aria-labelledby="h-lista">
      <h2 id="h-lista">Equivalencias: qué es 1 porción</h2>
      <p className="muted">Cantidades tal como figuran en tus documentos. Si dos documentos no coinciden, se aplica el primero de tu pauta y la duda queda registrada.</p>
      {EXCHANGE_GROUPS.filter((g) => byGroup.has(g)).map((g) => (
        <details key={g} className="panel">
          <summary><h3>{groupLabel(g)} <span className="muted">({byGroup.get(g)!.length})</span></h3></summary>
          <div className="table-scroll">
            <table className="data">
              <thead><tr><th scope="col">Alimento</th><th scope="col">Cantidad</th><th scope="col">Medida casera</th><th scope="col">Fuente</th></tr></thead>
              <tbody>
                {byGroup.get(g)!.map((f) => {
                  const eq = (['g', 'ml', 'unidad', 'porcion'] as const).map((u) => findEquivalence(f, u, ctx)).find(Boolean)!;
                  return (
                    <tr key={f.id}>
                      <th scope="row"><a href={href(`/alimentos/${f.id}`)}>{f.name}</a>{f.status === 'pendiente' && <> <StatusBadge status="pendiente" /></>}</th>
                      <td className="num">{eq.unit === 'porcion' ? '1 porción' : `${fmt(eq.amount, 2)} ${eq.unit === 'unidad' ? f.unitLabel ?? 'ud.' : eq.unit} = ${portionsText(eq.portions)}`}</td>
                      <td>{eq.householdMeasure ?? ''}</td>
                      <td><SourceTag source={eq.source} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </section>
  );
}

function TargetsForm({ diet, onSave }: { diet: Diet; onSave: (t: NutrientTargets) => void }) {
  const initial = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, diet.nutrientTargets[k]?.toString() ?? ''])) as Record<(typeof NUTRIENT_KEYS)[number], string>;
  const [fields, setFields] = useState(initial);
  const [saved, setSaved] = useState(false);
  const { values, errors } = parseNutrients(fields);
  const hasErrors = Object.keys(errors).length > 0;
  return (
    <section aria-labelledby="h-objetivos" className="panel">
      <h2 id="h-objetivos">Objetivos de energía y macros</h2>
      <p className="muted">
        {diet.nutrientTargetsSource === 'documento' ? 'Objetivos tomados del documento.' : 'Tu pauta no los incluye. Rellénalos solo si tu nutricionista te los ha dado; deja vacío lo que no tengas.'}
      </p>
      <form
        className="grid-fields"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (hasErrors) return;
          const t: NutrientTargets = {};
          for (const k of NUTRIENT_KEYS) if (values[k] !== null) t[k] = values[k]!;
          onSave(t);
          setSaved(true);
        }}
      >
        {NUTRIENT_KEYS.map((k) => (
          <label key={k} className="field">
            <span>{NUTRIENT_LABELS[k].label} ({NUTRIENT_LABELS[k].unit}/día)</span>
            <input inputMode="decimal" value={fields[k]} onChange={(e) => { setSaved(false); setFields({ ...fields, [k]: e.target.value }); }} aria-invalid={!!errors[k]} />
            {errors[k] && <span className="field-error" role="alert">{errors[k]}</span>}
          </label>
        ))}
        <div className="row">
          <button className="btn primary" type="submit" disabled={hasErrors}>Guardar objetivos</button>
          {saved && <span className="ok-text" role="status">Guardado</span>}
        </div>
      </form>
    </section>
  );
}
