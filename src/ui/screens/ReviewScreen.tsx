// Dudas de la importación: lo que la lectura de los PDF no pudo confirmar. Marcar una duda como revisada
// no cambia la pauta: solo deja constancia de que se ha comprobado. El texto y su origen se conservan.

import { reviewItems, setReviewResolved } from '../../domain/review';
import type { ReviewItem } from '../../domain/types';
import { useStore } from '../../state/store';
import { SourceTag } from './DietScreen';

export function ReviewScreen() {
  const { data, update } = useStore();
  const all = reviewItems(data);
  const groups: { title: string; items: ReviewItem[]; empty: string }[] = [
    { title: 'Pendientes de revisión', items: all.filter((r) => !r.resolved), empty: 'No queda ninguna duda por revisar.' },
    { title: 'Revisadas', items: all.filter((r) => r.resolved), empty: 'Todavía no has marcado ninguna como revisada.' },
  ];

  return (
    <div className="stack-lg">
      <header className="page-head">
        <h1>Dudas de la importación</h1>
        <p className="muted">Datos de tus documentos que no se pudieron leer con seguridad. Compáralos con el PDF original, en la página indicada. Marcarlos como revisados no modifica tu pauta.</p>
      </header>
      {all.length === 0 ? (
        <p className="empty">No hay dudas registradas.</p>
      ) : (
        groups.map((g, k) => (
          <section key={g.title} aria-labelledby={`h-dudas-${k}`}>
            <h2 id={`h-dudas-${k}`}>{g.title} <span className={`badge ${k === 0 && g.items.length ? 'warn' : ''}`}>{g.items.length}</span></h2>
            {g.items.length === 0 ? (
              <p className="empty">{g.empty}</p>
            ) : (
              <ul className="review">
                {g.items.map((r) => (
                  <li key={r.id} className={r.resolved ? 'done' : ''}>
                    <label className="check">
                      <input type="checkbox" checked={r.resolved} onChange={(e) => update((d) => setReviewResolved(d, r.id, e.target.checked))} />
                      <span>{r.text}</span>
                    </label>
                    <p className="small review-source">
                      {r.source.section && <span className="muted">{r.source.section} · </span>}
                      <SourceTag source={r.source} />
                    </p>
                    {r.source.raw && <blockquote className="raw small">{r.source.raw}</blockquote>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))
      )}
    </div>
  );
}
