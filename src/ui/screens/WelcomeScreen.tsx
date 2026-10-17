// Primer arranque: sin pauta. Guía para subir primero la lista de alimentos y después la pauta.

import { currentListDocId } from '../../domain/importFoodList';
import { currentDoc } from '../../domain/importGuides';
import { useStore } from '../../state/store';
import { Icon } from '../components/Icon';
import { href } from '../router';
import { useOptionalSession } from '../Session';

export function WelcomeScreen() {
  const { data } = useStore();
  const session = useOptionalSession();
  const listId = currentListDocId(data);
  const list = data.documents.find((d) => d.id === listId);
  const foods = listId ? data.foods.filter((f) => f.equivalences.some((e) => e.source.doc === listId)).length : 0;

  return (
    <section className="welcome stack-lg" aria-labelledby="h-welcome">
      <header className="page-head">
        <p className="kicker">{session ? `Hola, ${session.user.name}` : 'Bienvenida'}</p>
        <h1 id="h-welcome">Empecemos por tus documentos</h1>
        <p className="muted">Sazora trabaja con lo que te ha dado tu nutricionista. Sube sus PDF y los leemos por ti; antes de guardar nada, revisas lo extraído.</p>
      </header>

      <ol className="onboarding">
        <li className={list ? 'done' : 'now'}>
          <span className="onboarding-mark" aria-hidden="true">{list ? <Icon name="check" size={18} /> : '1'}</span>
          <div>
            <h2>Lista de alimentos</h2>
            {list ? (
              <p className="muted">{list.title}: {foods} alimentos con su porción.</p>
            ) : (
              <p className="muted">Las tablas que dicen cuánto de cada alimento es una porción (carbohidratos, proteínas, grasas, frutas…).</p>
            )}
          </div>
        </li>
        <li className={list ? 'now' : 'locked'}>
          <span className="onboarding-mark" aria-hidden="true">2</span>
          <div>
            <h2>Tu pauta</h2>
            <p className="muted">
              Tu plan personal: porciones de cada comida, indicaciones y platos de ejemplo.
              {!list && ' Se sube después de la lista, para poder enlazar los alimentos.'}
            </p>
          </div>
        </li>
      </ol>

      <section className="stack" aria-labelledby="h-guias-opc">
        <h2 id="h-guias-opc" className="sub">Guías opcionales</h2>
        <ul className="onboarding">
          {([['conversion', 'De crudo a cocido', 'Cuánto pesa cocinada cada porción, para poder pesar ya cocinado.'], ['productos', 'Productos recomendados', 'Los productos de cada supermercado con sus porciones.']] as const).map(([kind, title, text]) => {
            const doc = currentDoc(data, kind);
            return (
              <li key={kind} className={doc ? 'done' : ''}>
                <span className="onboarding-mark" aria-hidden="true">{doc ? <Icon name="check" size={18} /> : '+'}</span>
                <div>
                  <h3>{title}</h3>
                  <p className="muted">{doc ? `${doc.title}: guardada.` : text}</p>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="muted small">Se suben con el mismo botón, en cualquier momento. Las encontrarás en Mi dieta → Guías.</p>
      </section>

      <div className="stack">
        <a className="btn primary" href={href('/dieta/importar')}>
          <Icon name="subir" size={18} /> {list ? 'Subir mi pauta' : 'Subir la lista de alimentos'}
        </a>
        {!list && <p className="muted small">¿Tu nutricionista te dio un único PDF con la lista y la pauta? Súbelo: lo separamos y completamos los dos pasos a la vez.</p>}
      </div>
    </section>
  );
}
