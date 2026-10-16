// Importar documentos de la nutricionista desde PDF: subida → lectura con IA → revisión → confirmar.
// Un mismo PDF puede traer la lista de alimentos, la pauta o las dos cosas; se clasifica solo.

import { useEffect, useRef, useState } from 'react';
import { applyImport, checkExtraction, sanitizeExtraction, unmatchedIngredients, type Extraction, type ImportedDocument } from '../../domain/importPlan';
import { applyFoodList, checkFoodList, currentListDocId, sanitizeFoodList, type FoodList } from '../../domain/importFoodList';
import { EXCHANGE_GROUPS, type ExchangeGroup, type Food } from '../../domain/types';
import { parseDecimal } from '../../domain/validation';
import { useStore } from '../../state/store';
import { Icon } from '../components/Icon';
import { ConfirmButton } from '../components/Modal';
import { fmt, GROUP_SHORT } from '../format';
import { href, navigate } from '../router';

const MAX_MB = 40;

interface Found {
  list: FoodList | null;
  plan: Extraction | null;
  listDoc: ImportedDocument;
  planDoc: ImportedDocument;
  model: string;
}

type Phase =
  | { step: 'elegir'; error?: string; canRetry?: boolean }
  | { step: 'subiendo'; percent: number }
  | { step: 'analizando'; since: number }
  | ({ step: 'revisar' } & Found);

interface ImportResponse {
  error?: string;
  kind?: 'lista' | 'pauta' | 'ambos' | 'otro';
  foodList?: unknown;
  plan?: unknown;
  document?: ImportedDocument;
  model?: string;
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    r.readAsDataURL(file);
  });
}

export function ImportScreen() {
  const { data, update } = useStore();
  const [phase, setPhase] = useState<Phase>({ step: 'elegir' });
  const xhr = useRef<XMLHttpRequest | null>(null);
  const lastFile = useRef<File | null>(null);
  useEffect(() => () => xhr.current?.abort(), []);

  const hasList = !!currentListDocId(data);
  const stage = !hasList ? 'lista' : !data.diet ? 'pauta' : 'actualizar';

  function receive(status: number, body: ImportResponse | null) {
    if (status !== 200 || !body?.document) {
      return setPhase({ step: 'elegir', error: body?.error ?? `El servidor respondió con un error (${status}).`, canRetry: true });
    }
    if (body.kind === 'otro' || (!body.foodList && !body.plan)) {
      return setPhase({ step: 'elegir', error: 'Este PDF no parece una lista de alimentos ni una pauta de tu nutricionista.' });
    }
    const list = body.foodList ? sanitizeFoodList(body.foodList) : null;
    const plan = body.plan ? sanitizeExtraction(body.plan) : null;
    if (plan && !list && !hasList) {
      return setPhase({
        step: 'elegir',
        error: 'Este PDF es una pauta, pero todavía no tienes la lista de alimentos. Sube primero la lista (o un PDF que traiga las dos cosas) y después esta pauta.',
      });
    }
    const doc = body.document;
    const both = !!list && !!plan;
    setPhase({
      step: 'revisar',
      list,
      plan,
      listDoc: both ? { ...doc, id: `${doc.id}-lista` } : doc,
      planDoc: both ? { ...doc, id: `${doc.id}-pauta` } : doc,
      model: body.model ?? 'Gemini',
    });
  }

  async function start(file: File) {
    lastFile.current = null;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return setPhase({ step: 'elegir', error: 'El archivo tiene que ser un PDF.' });
    if (file.size > MAX_MB * 1024 * 1024) return setPhase({ step: 'elegir', error: `El PDF supera los ${MAX_MB} MB.` });
    lastFile.current = file;
    setPhase({ step: 'subiendo', percent: 0 });
    let pdfBase64: string;
    try {
      pdfBase64 = await readBase64(file);
    } catch (e) {
      return setPhase({ step: 'elegir', error: (e as Error).message });
    }
    const req = new XMLHttpRequest();
    xhr.current = req;
    req.open('POST', '/api/importar');
    req.setRequestHeader('content-type', 'application/json');
    req.responseType = 'json';
    req.upload.onprogress = (e) => e.lengthComputable && setPhase({ step: 'subiendo', percent: Math.round((e.loaded / e.total) * 100) });
    req.upload.onload = () => setPhase({ step: 'analizando', since: Date.now() });
    req.onerror = () => setPhase({ step: 'elegir', error: 'No se pudo conectar con el servidor de Sazora.', canRetry: true });
    req.onabort = () => {
      lastFile.current = null;
      setPhase({ step: 'elegir' });
    };
    req.onload = () => receive(req.status, req.response as ImportResponse | null);
    req.send(JSON.stringify({ pdfBase64, catalog: data.foods.map((f) => ({ id: f.id, name: f.brand ? `${f.name} (${f.brand})` : f.name })) }));
  }

  const intro = {
    lista: { kicker: 'Paso 1 de 2', title: 'Sube la lista de alimentos', text: 'Las tablas de tu nutricionista que dicen cuánto de cada alimento es una porción. Si tienes un único PDF con la lista y la pauta, súbelo: se separan solas.' },
    pauta: { kicker: 'Paso 2 de 2', title: 'Sube tu pauta', text: 'Tu plan personal: porciones por comida, indicaciones y platos de ejemplo.' },
    actualizar: { kicker: 'Mi dieta', title: 'Importar desde PDF', text: 'Sube una versión nueva de tu pauta o de tu lista de alimentos. Se detecta qué es y lo revisas antes de guardarlo.' },
  }[stage];

  return (
    <div className="stack-lg">
      <header className="page-head">
        <a href={href(data.diet ? '/dieta' : '/inicio')} className="back">← {data.diet ? 'Mi dieta' : 'Inicio'}</a>
        <p className="kicker">{intro.kicker}</p>
        <h1>{intro.title}</h1>
        <p className="muted">{intro.text}</p>
      </header>

      {phase.step === 'elegir' && (
        <section className="panel stack">
          {phase.error && (
            <div className="note warn" role="alert">
              <p><Icon name="aviso" size={16} /> {phase.error}</p>
              {phase.canRetry && lastFile.current && (
                <button className="btn small" style={{ marginTop: 'var(--space-2)' }} onClick={() => void start(lastFile.current!)}>
                  Reintentar con {lastFile.current.name}
                </button>
              )}
            </div>
          )}
          <PdfDrop onFile={(f) => void start(f)} />
          <p className="note">
            El PDF se guarda en tu usuario de Sazora y se envía a <b>Google Gemini</b> para leerlo. Con la API gratuita, Google puede usar ese contenido para mejorar sus productos; con facturación activada, no.
          </p>
        </section>
      )}

      {(phase.step === 'subiendo' || phase.step === 'analizando') && <Progress phase={phase} onCancel={() => xhr.current?.abort()} />}

      {phase.step === 'revisar' && (
        <Review
          key={phase.planDoc.id}
          found={phase}
          hadDiet={!!data.diet}
          foodsAfterList={phase.list ? applyFoodList(data, phase.list, phase.listDoc).foods : data.foods}
          onDiscard={() => setPhase({ step: 'elegir' })}
          onConfirm={(plan) => {
            update((d) => {
              let next = phase.list ? applyFoodList(d, phase.list, phase.listDoc) : d;
              if (plan) next = applyImport(next, plan, phase.planDoc, new Date().toISOString(), phase.model);
              return next;
            });
            navigate(plan || data.diet ? '/dieta' : '/inicio');
          }}
        />
      )}
    </div>
  );
}

/** Zona para elegir o soltar el PDF. El input nativo queda accesible (teclado y lector de pantalla). */
function PdfDrop({ onFile }: { onFile: (f: File) => void }) {
  const [over, setOver] = useState(false);
  return (
    <label
      className={`dropzone${over ? ' over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
    >
      <input className="sr-only" type="file" accept="application/pdf,.pdf" aria-label="PDF de la nutricionista" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
      <span className="dropzone-icon" aria-hidden="true"><Icon name="documento" size={28} /></span>
      <span className="btn primary dropzone-btn" aria-hidden="true"><Icon name="subir" size={18} /> Elegir PDF</span>
      <span className="dropzone-hint muted small">o arrástralo aquí · máximo {MAX_MB} MB</span>
    </label>
  );
}

function Progress({ phase, onCancel }: { phase: Extract<Phase, { step: 'subiendo' | 'analizando' }>; onCancel: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const steps = ['Subir el PDF', 'Identificar el documento', 'Leer tablas y pauta', 'Revisar lo extraído'];
  const seconds = phase.step === 'analizando' ? Math.round((now - phase.since) / 1000) : 0;
  const current = phase.step === 'subiendo' ? 0 : seconds < 20 ? 1 : 2;
  return (
    <section className="panel loader" aria-live="polite" aria-busy="true">
      <div className="spinner" aria-hidden="true" />
      <p className="loader-title">{phase.step === 'subiendo' ? `Subiendo el PDF… ${phase.percent} %` : `Gemini está leyendo el documento… ${seconds} s`}</p>
      <p className="muted small">{phase.step === 'analizando' ? 'Puede tardar de uno a varios minutos: primero identifica qué contiene y luego lo transcribe. Si Gemini está saturado, se reintenta solo.' : 'Preparando el envío.'}</p>
      <ol className="steps-progress">
        {steps.map((s, k) => <li key={s} className={k < current ? 'done' : k === current ? 'now' : ''}>{s}</li>)}
      </ol>
      <button className="btn ghost" onClick={onCancel}>Cancelar</button>
    </section>
  );
}

const Checks = ({ checks }: { checks: { ok: boolean; text: string }[] }) => (
  <ul className="checks">
    {checks.map((c) => <li key={c.text} className={c.ok ? 'ok-text' : 'warn-text'}><Icon name={c.ok ? 'check' : 'aviso'} size={16} /> {c.text}</li>)}
  </ul>
);

const Doubts = ({ doubts }: { doubts: { text: string; page: number }[] }) =>
  doubts.length === 0 ? null : (
    <details className="panel">
      <summary><h3>Dudas detectadas ({doubts.length})</h3></summary>
      <ul className="rules">{doubts.map((d, k) => <li key={k}>{d.text} <span className="source">pág. {d.page}</span></li>)}</ul>
      <p className="muted small">Quedarán en Mi dieta → Dudas de la importación.</p>
    </details>
  );

function Review({ found, hadDiet, foodsAfterList, onDiscard, onConfirm }: {
  found: Found;
  hadDiet: boolean;
  foodsAfterList: Food[];
  onDiscard: () => void;
  onConfirm: (plan: Extraction | null) => void;
}) {
  const [plan, setPlan] = useState(found.plan);
  const { list } = found;
  const what = list && plan ? 'la lista de alimentos y una pauta' : list ? 'la lista de alimentos' : 'una pauta';
  const confirm = list && plan
    ? { label: 'Guardar lista y pauta', title: 'Guardar lista y pauta', message: 'Se guardará la lista de alimentos y esta pauta pasará a ser la tuya. Se conservan lo que has planificado y comido y tus recetas propias.' }
    : list
      ? { label: 'Guardar lista', title: 'Guardar la lista', message: hadDiet ? 'Se guardará esta lista y tu pauta pasará a usarla. Las equivalencias de listas anteriores se conservan como historial.' : 'Se guardará la lista de alimentos. Después podrás subir tu pauta.' }
      : { label: 'Usar esta pauta', title: 'Sustituir tu pauta', message: 'Esta pauta pasará a ser la tuya. Se conservan lo que has planificado y comido, tus recetas y tus alimentos. Los platos de la pauta anterior que ya hayas usado pasan a tus recetas propias.' };

  return (
    <div className="stack-lg">
      <section className="panel stack" aria-labelledby="h-rev">
        <h2 id="h-rev">Revisa lo extraído</h2>
        <p>Este PDF contiene <b>{what}</b>. <span className="muted small">Leído con {found.model}.</span></p>
      </section>

      {list && <ListReview list={list} />}
      {plan && <PlanReview plan={plan} setPlan={setPlan} foods={foodsAfterList} />}

      <div className="row wrap">
        <ConfirmButton className="btn primary" title={confirm.title} confirmLabel="Guardar" message={confirm.message} onConfirm={() => onConfirm(plan)}>
          {confirm.label}
        </ConfirmButton>
        <button className="btn ghost" onClick={onDiscard}>Descartar</button>
      </div>
    </div>
  );
}

function ListReview({ list }: { list: FoodList }) {
  return (
    <section className="stack" aria-labelledby="h-rev-lista">
      <h2 id="h-rev-lista">Lista de alimentos: {list.title}</h2>
      <Checks checks={checkFoodList(list)} />
      {list.groups.map((g, k) => (
        <details key={k} className="panel">
          <summary><h3>{g.title} <span className="muted">({g.items.length} · {GROUP_SHORT[g.group]} · pág. {g.page})</span></h3></summary>
          {g.note && <p className="note">{g.note}</p>}
          <div className="table-scroll">
            <table className="data">
              <thead><tr><th scope="col">Alimento</th><th scope="col">1 porción</th><th scope="col">Medida casera</th><th scope="col">Estado</th></tr></thead>
              <tbody>
                {g.items.map((i, j) => (
                  <tr key={j}>
                    <th scope="row">{i.name}</th>
                    <td className="num">{i.amount !== null ? `${fmt(i.amount, 1)} ${i.unit ?? 'g'}` : i.units_per_portion !== null ? `${fmt(i.units_per_portion, 2)} ${i.unit_label ?? 'ud.'}` : '—'}</td>
                    <td>{i.household ?? ''}</td>
                    <td>{i.state}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
      <Doubts doubts={list.doubts} />
    </section>
  );
}

function PlanReview({ plan: x, setPlan, foods }: { plan: Extraction; setPlan: (fn: (p: Extraction | null) => Extraction | null) => void; foods: Food[] }) {
  const groups = EXCHANGE_GROUPS.filter((g) => x.meals.some((m) => m.portions[g] !== null && m.portions[g] !== undefined) || (x.daily_totals[g] !== null && x.daily_totals[g] !== undefined));
  const unmatched = unmatchedIngredients(x, { foods });
  const set = (patch: Partial<Extraction>) => setPlan((p) => p && { ...p, ...patch });
  const setCell = (meal: number | 'total', g: ExchangeGroup, value: string) => {
    const n = value.trim() === '' ? null : parseDecimal(value);
    if (n !== null && n < 0) return;
    setPlan((cur) =>
      !cur ? cur : meal === 'total'
        ? { ...cur, daily_totals: { ...cur.daily_totals, [g]: n } }
        : { ...cur, meals: cur.meals.map((m, k) => (k === meal ? { ...m, portions: { ...m.portions, [g]: n } } : m)) },
    );
  };
  const cell = (meal: number | 'total', g: ExchangeGroup, v: number | null | undefined, label: string) => (
    <td key={g}><input className="cell" inputMode="decimal" aria-label={label} defaultValue={v ?? ''} onBlur={(e) => setCell(meal, g, e.target.value)} /></td>
  );

  return (
    <section className="stack-lg" aria-labelledby="h-rev-pauta">
      <div className="stack">
        <h2 id="h-rev-pauta">Pauta</h2>
        <div className="grid-fields">
          <label className="field"><span>Nombre de la pauta</span><input value={x.plan_name} onChange={(e) => set({ plan_name: e.target.value })} /></label>
          <label className="field"><span>Persona</span><input value={x.holder ?? ''} onChange={(e) => set({ holder: e.target.value || null })} /></label>
          <label className="field"><span>Versión</span><input value={x.version ?? ''} onChange={(e) => set({ version: e.target.value || null })} /></label>
        </div>
        <Checks checks={checkExtraction(x)} />
      </div>

      <div className="stack">
        <h3>Porciones</h3>
        <p className="muted small">Compáralas con el PDF y corrige cualquier celda. Vacío = el grupo no aparece en esa comida.</p>
        <div className="table-scroll">
          <table className="data pauta-table">
            <thead><tr><th scope="col">Comida</th>{groups.map((g) => <th key={g} scope="col">{GROUP_SHORT[g]}</th>)}</tr></thead>
            <tbody>
              {x.meals.map((m, k) => (
                <tr key={k}><th scope="row">{m.name} <span className="muted small">pág. {m.page}</span></th>{groups.map((g) => cell(k, g, m.portions[g], `${m.name}, ${GROUP_SHORT[g]}`))}</tr>
              ))}
              <tr className="total"><th scope="row">Total del día</th>{groups.map((g) => cell('total', g, x.daily_totals[g], `Total del día, ${GROUP_SHORT[g]}`))}</tr>
            </tbody>
          </table>
        </div>
      </div>

      <details className="panel">
        <summary><h3>Indicaciones ({x.rules.length})</h3></summary>
        <ul className="rules">{x.rules.map((r, k) => <li key={k}>{r.text} <span className="source">pág. {r.page}</span></li>)}</ul>
      </details>
      <details className="panel">
        <summary><h3>Equivalencias propias de la pauta ({x.equivalences.length})</h3></summary>
        <ul className="rules">{x.equivalences.map((e, k) => <li key={k}>{e.raw || `${e.amount} ${e.unit} de ${e.food}`} <span className="source">pág. {e.page}</span></li>)}</ul>
      </details>
      <details className="panel">
        <summary><h3>Platos de ejemplo ({x.dishes.length})</h3></summary>
        <ul className="rules">{x.dishes.map((d, k) => <li key={k}><b>{d.name}</b> ({d.meal}) — {d.ingredients.length} ingredientes <span className="source">pág. {d.page}</span></li>)}</ul>
        {unmatched.length > 0 && <p className="note warn">Sin enlazar a un alimento (no se calcularán): {unmatched.join(', ')}.</p>}
      </details>
      <Doubts doubts={x.doubts} />
    </section>
  );
}
