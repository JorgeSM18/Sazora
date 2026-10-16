import { useMemo } from 'react';
import { daySummary } from '../../domain/day';
import { reviewItems } from '../../domain/review';
import { useDiet, useCalc, useStore } from '../../state/store';
import { DayPanel } from '../components/DayPanel';
import { Icon } from '../components/Icon';
import { TotalsLine } from '../components/Values';
import { dateLong, isValidISODate, todayISO } from '../format';
import { href } from '../router';

export function HomeScreen({ dateParam }: { dateParam: string | null }) {
  const { data } = useStore();
  const diet = useDiet();
  const ctx = useCalc();
  const date = isValidISODate(dateParam) ? dateParam : todayISO();
  const s = useMemo(() => daySummary(data, diet, date, ctx), [data, diet, date, ctx]);

  const pendingReview = reviewItems(data).filter((r) => !r.resolved).length;
  const issueSubjects = [...new Set([...s.planned.issues, ...s.consumed.issues].map((i) => i.subject))];
  const planLink = href(`/plan?fecha=${date}`);

  return (
    <div className="stack-lg">
      <header className="page-head">
        <p className="kicker">{date === todayISO() ? 'Hoy' : 'Día seleccionado'}</p>
        <h1 className="first-cap">{dateLong(date)}</h1>
        <p className="muted">{diet.name} · {diet.holder}</p>
      </header>

      <section aria-labelledby="h-comidas">
        <div className="section-head">
          <h2 id="h-comidas">Comidas</h2>
          <a className="btn small" href={planLink}>Abrir el plan del día</a>
        </div>
        <ul className="meal-status">
          {s.meals.map((m) => {
            const registered = m.intake.length > 0;
            const status = m.plan.length === 0 && !registered
              ? { text: 'Sin planificar', cls: '' }
              : m.pending.length > 0
                ? { text: `${m.pending.length} por registrar`, cls: 'warn' }
                : { text: 'Registrada', cls: 'ok' };
            return (
              <li key={m.meal.id}>
                <a href={planLink}>
                  <span className="meal-name">{m.meal.name}</span>
                  <span className={`badge ${status.cls}`}>{status.text}</span>
                  {m.plan.length > 0 && (
                    <span className="meal-detail">
                      Previsto: <TotalsLine totals={m.planned} showMacros={false} />
                    </span>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      </section>

      <DayPanel summary={s} diet={diet} compact />

      {(issueSubjects.length > 0 || pendingReview > 0) && (
        <section aria-labelledby="h-avisos" className="notices">
          <h2 id="h-avisos">Avisos</h2>
          {issueSubjects.length > 0 && (
            <p className="note warn"><Icon name="aviso" size={16} /> Datos incompletos hoy en: {issueSubjects.slice(0, 6).join(', ')}{issueSubjects.length > 6 ? '…' : ''}. <a href={href('/alimentos')}>Completar alimentos</a></p>
          )}
          {pendingReview > 0 && (
            <p className="note"><Icon name="aviso" size={16} /> {pendingReview} dudas de la importación de tu pauta están pendientes de revisión. <a href={href('/dieta')}>Revisarlas</a></p>
          )}
        </section>
      )}

      <nav className="quick" aria-label="Accesos rápidos">
        <a href={planLink} className="quick-card"><Icon name="plan" /> Planificar y registrar</a>
        <a href={href('/recetas')} className="quick-card"><Icon name="recetas" /> Recetario</a>
        <a href={href('/dieta')} className="quick-card"><Icon name="dieta" /> Consultar mi pauta</a>
      </nav>
    </div>
  );
}
