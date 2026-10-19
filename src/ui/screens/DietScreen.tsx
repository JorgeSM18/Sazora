import { EXCHANGE_GROUPS, type RuleKind, type SourceRef } from '../../domain/types';
import { useDiet, useStore } from '../../state/store';
import { StatusBadge } from '../components/Badges';
import { Icon } from '../components/Icon';
import { fmtPortion, groupLabel } from '../format';
import { href } from '../router';
import { useDocumentUrl } from '../documents';
import { reviewItems } from '../../domain/review';

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

/** Solo la pauta de la nutricionista. Objetivos y descarga están en Ajustes; las dudas, en su propia pantalla. */
export function DietScreen() {
  const { data } = useStore();
  const diet = useDiet();
  const pending = reviewItems(data).filter((r) => !r.resolved).length;
  const daily = EXCHANGE_GROUPS.filter((g) => diet.dailyPortionTargets[g] !== undefined);
  const kinds = (Object.keys(RULE_TITLES) as RuleKind[]).filter((k) => diet.rules.some((r) => r.kind === k));

  return (
    <div className="stack-lg">
      {pending > 0 && (
        <a className="note warn notice-link" href={href('/dudas')}>
          <Icon name="aviso" size={16} /> Hay {pending} {pending === 1 ? 'duda' : 'dudas'} de la importación por revisar <span aria-hidden="true">→</span>
        </a>
      )}

      <header className="page-head">
        <p className="kicker">Mi dieta</p>
        <h1>{diet.name}</h1>
        <p className="muted">{diet.holder} · importada el {diet.importedAt} <StatusBadge status={diet.status} /></p>
        {diet.notes.map((n) => <p key={n} className="note">{n}</p>)}
      </header>

      <section aria-labelledby="h-diarias" className="stack">
        <h2 id="h-diarias">Porciones al día</h2>
        {daily.length === 0 ? (
          <p className="empty">La pauta no indica porciones totales del día.</p>
        ) : (
          <ul className="portion-tiles">
            {daily.map((g) => (
              <li key={g}>
                <span className="portion-value pauta-text">{fmtPortion(diet.dailyPortionTargets[g]!)}</span>
                <span className="portion-label">{groupLabel(g)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="h-pauta" className="stack">
        <h2 id="h-pauta">Porciones por comida</h2>
        <ul className="meal-cards">
          {diet.meals.map((m) => {
            const groups = EXCHANGE_GROUPS.filter((g) => m.portionTargets[g] !== undefined);
            const dishes = data.recipes.filter((r) => r.origin === 'documento' && r.mealHint === m.id);
            return (
              <li key={m.id} className="card">
                <h3>{m.name}{m.time && <span className="muted small"> · {m.time}</span>}</h3>
                {groups.length === 0 ? (
                  <p className="muted small">Sin porciones asignadas.</p>
                ) : (
                  <dl className="portion-list">
                    {groups.map((g) => (
                      <div key={g}><dt>{groupLabel(g)}</dt><dd className="pauta-text">{fmtPortion(m.portionTargets[g]!)}</dd></div>
                    ))}
                  </dl>
                )}
                {dishes.length > 0 && (
                  <p className="small">
                    <span className="muted">Platos de ejemplo: </span>
                    {dishes.map((r, k) => <span key={r.id}>{k > 0 && ' · '}<a href={href(`/recetas/${r.id}`)}>{r.name}</a></span>)}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="h-reglas" className="stack">
        <h2 id="h-reglas">Indicaciones de la pauta</h2>
        {kinds.length === 0 && <p className="empty">La pauta no incluye indicaciones.</p>}
        {kinds.map((kind) => {
          const rules = diet.rules.filter((r) => r.kind === kind);
          return (
            <details key={kind} className="panel rule-group">
              <summary><h3>{RULE_TITLES[kind]} <span className="badge">{rules.length}</span></h3></summary>
              <ul className="rules">
                {rules.map((r) => (
                  <li key={r.id}>{r.text} <SourceTag source={r.source} /> {r.status !== 'verificado' && <StatusBadge status={r.status} />}</li>
                ))}
              </ul>
            </details>
          );
        })}
      </section>
    </div>
  );
}
