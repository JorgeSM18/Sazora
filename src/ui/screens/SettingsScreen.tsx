// Uso ocasional: cuenta, objetivos de energía y macros, descarga de datos y acceso a documentos y dudas.

import { useState } from 'react';
import { NUTRIENT_KEYS, NUTRIENT_LABELS, type Diet, type NutrientTargets } from '../../domain/types';
import { reviewItems } from '../../domain/review';
import { parseNutrients } from '../../domain/validation';
import { useDiet, useStore } from '../../state/store';
import { Icon } from '../components/Icon';
import { href } from '../router';
import { useOptionalSession } from '../Session';

export function SettingsScreen() {
  const { data, update } = useStore();
  const diet = useDiet();
  const session = useOptionalSession();
  const pending = reviewItems(data).filter((r) => !r.resolved).length;

  return (
    <div className="stack-lg">
      <header className="page-head"><h1>Ajustes</h1></header>

      <nav aria-label="Más secciones">
        <ul className="list">
          <li><a href={href('/guias')}><span className="list-title"><Icon name="documento" size={18} /> Documentos</span><span className="muted small">PDF de tu nutricionista, guías y subir una versión nueva</span></a></li>
          <li>
            <a href={href('/dudas')}>
              <span className="list-title"><Icon name="aviso" size={18} /> Dudas de la importación {pending > 0 && <span className="badge warn">{pending} pendientes</span>}</span>
              <span className="muted small">Lo que no se pudo leer con seguridad en los PDF</span>
            </a>
          </li>
        </ul>
      </nav>

      <TargetsForm diet={diet} onSave={(t) => update((x) => ({ ...x, diet: x.diet && { ...x.diet, nutrientTargets: t, nutrientTargetsSource: Object.keys(t).length ? 'usuario' : undefined } }))} />

      <section aria-labelledby="h-datos" className="panel">
        <h2 id="h-datos">Tus datos</h2>
        <p className="muted">Tus datos se guardan en el servidor de Sazora, en tu usuario. Puedes descargar una copia cuando quieras.</p>
        <div className="row wrap">
          <button className="btn" onClick={() => exportJson(data)}>Descargar copia (JSON)</button>
        </div>
      </section>

      {session && (
        <section aria-labelledby="h-cuenta" className="panel">
          <h2 id="h-cuenta">Cuenta</h2>
          <p>{session.user.name} <span className="muted">· {session.user.username}</span></p>
          <div className="row wrap">
            <button className="btn" onClick={() => void session.logout()}>Cerrar sesión</button>
          </div>
        </section>
      )}
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

function TargetsForm({ diet, onSave }: { diet: Diet; onSave: (t: NutrientTargets) => void }) {
  const initial = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, diet.nutrientTargets[k]?.toString() ?? ''])) as Record<(typeof NUTRIENT_KEYS)[number], string>;
  const [fields, setFields] = useState(initial);
  const [saved, setSaved] = useState(false);
  const { values, errors } = parseNutrients(fields);
  const hasErrors = Object.keys(errors).length > 0;
  const set = NUTRIENT_KEYS.filter((k) => diet.nutrientTargets[k] !== undefined).length;
  const status = set === 0 ? { text: 'Sin configurar', cls: '' }
    : set === NUTRIENT_KEYS.length ? { text: 'Configurados', cls: 'ok' }
    : { text: `Configurados parcialmente (${set} de ${NUTRIENT_KEYS.length})`, cls: 'warn' };
  return (
    <section aria-labelledby="h-objetivos" className="panel">
      <h2 id="h-objetivos">Objetivos de energía y macros <span className={`badge ${status.cls}`}>{status.text}</span></h2>
      <p className="muted">
        {diet.nutrientTargetsSource === 'documento' ? 'Objetivos tomados del documento.' : 'Tu pauta no los incluye. Rellénalos solo si tu nutricionista te los ha dado; deja vacío lo que no tengas. Un objetivo vacío no cuenta como cero.'}
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
