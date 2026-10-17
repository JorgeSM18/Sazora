// Importar documentos de la nutricionista desde PDF: subida → lectura con IA → revisión → confirmar.
// Un PDF puede traer la lista de alimentos, la pauta, la tabla de crudo a cocido, la guía de productos
// o varias de ellas a la vez: se identifica qué trae y se revisa cada parte.

import { useEffect, useRef, useState } from 'react';
import { applyImport, checkExtraction, sanitizeExtraction, unmatchedIngredients, type Extraction, type ImportedDocument } from '../../domain/importPlan';
import { applyFoodList, checkFoodList, currentListDocId, sanitizeFoodList, type FoodList } from '../../domain/importFoodList';
import { applyConversion, applyProducts, checkConversion, checkProducts, sanitizeConversion, sanitizeProducts, type ConversionImport, type ProductImport } from '../../domain/importGuides';
import { EXCHANGE_GROUPS, type AppData, type ExchangeGroup, type Food } from '../../domain/types';
import { parseDecimal } from '../../domain/validation';
import { useStore } from '../../state/store';
import { Icon } from '../components/Icon';
import { ConfirmButton } from '../components/Modal';
import { fmt, GROUP_SHORT } from '../format';
import { href, navigate } from '../router';

const MAX_MB = 40;

type Part = 'lista' | 'pauta' | 'conversion' | 'productos';

interface Found {
  list: FoodList | null;
  plan: Extraction | null;
  conversion: ConversionImport | null;
  products: ProductImport | null;
  /** Un documento por parte (id con sufijo si su PDF trae varias). */
  docs: Partial<Record<Part, ImportedDocument>>;
  /** Nombre del PDF del que sale cada parte. */
  files: Partial<Record<Part, string>>;
  model: string;
}

const EMPTY: Found = { list: null, plan: null, conversion: null, products: null, docs: {}, files: {}, model: '' };

/** Aplica lo extraído en orden: lista → productos → crudo a cocido → pauta (la pauta enlaza con todo lo anterior). */
function applyFound(d: AppData, f: Found, plan: Extraction | null): AppData {
  let next = f.list ? applyFoodList(d, f.list, f.docs.lista!) : d;
  if (f.products) next = applyProducts(next, f.products, f.docs.productos!);
  if (f.conversion) next = applyConversion(next, f.conversion, f.docs.conversion!);
  if (plan) next = applyImport(next, plan, f.docs.pauta!, new Date().toISOString(), f.model);
  return next;
}

type Phase =
  | { step: 'elegir'; error?: string; canRetry?: boolean }
  | { step: 'subiendo'; percent: number; label: string }
  | { step: 'analizando'; since: number; label: string }
  | ({ step: 'revisar'; skipped: string[] } & Found);

/** Varios PDF se leen de uno en uno (el servidor atiende una importación por usuario) y se juntan. */
interface Batch {
  files: File[];
  next: number;
  found: Found;
  skipped: string[];
  /** PDF ya reenviados al final de la cola por llegar antes que la lista. */
  deferred: Set<File>;
}

interface ImportResponse {
  error?: string;
  contains?: Partial<Record<Part, boolean>>;
  foodList?: unknown;
  plan?: unknown;
  conversion?: unknown;
  products?: unknown;
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
  const batch = useRef<Batch | null>(null);
  useEffect(
    () => () => {
      batch.current = null;
      xhr.current?.abort();
    },
    [],
  );

  const hasList = !!currentListDocId(data);
  const stage = !hasList ? 'lista' : !data.diet ? 'pauta' : 'actualizar';

  /** Sube un PDF y espera lo que lee Gemini. Rechaza solo si se cancela. */
  function upload(file: File, label: string, catalog: Food[]): Promise<{ status: number; body: ImportResponse | null }> {
    setPhase({ step: 'subiendo', percent: 0, label });
    return readBase64(file).then(
      (pdfBase64) =>
        new Promise((resolve, reject) => {
          const req = new XMLHttpRequest();
          xhr.current = req;
          req.open('POST', '/api/importar');
          req.setRequestHeader('content-type', 'application/json');
          req.responseType = 'json';
          req.upload.onprogress = (e) => e.lengthComputable && setPhase({ step: 'subiendo', percent: Math.round((e.loaded / e.total) * 100), label });
          req.upload.onload = () => setPhase({ step: 'analizando', since: Date.now(), label });
          req.onerror = () => resolve({ status: 0, body: { error: 'No se pudo conectar con el servidor de Sazora.' } });
          req.onabort = () => reject(new Error('cancelado'));
          req.onload = () => resolve({ status: req.status, body: req.response as ImportResponse | null });
          req.send(JSON.stringify({ pdfBase64, catalog: catalog.map((f) => ({ id: f.id, name: f.brand ? `${f.name} (${f.brand})` : f.name })) }));
        }),
      (e: Error) => ({ status: 0, body: { error: e.message } }),
    );
  }

  function start(files: File[]) {
    const bad = files.find((f) => f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf'));
    if (bad) return setPhase({ step: 'elegir', error: `${bad.name} no es un PDF.` });
    const big = files.find((f) => f.size > MAX_MB * 1024 * 1024);
    if (big) return setPhase({ step: 'elegir', error: `${big.name} supera los ${MAX_MB} MB.` });
    batch.current = { files, next: 0, found: EMPTY, skipped: [], deferred: new Set() };
    void run();
  }

  async function run() {
    const b = batch.current!;
    while (b.next < b.files.length) {
      const file = b.files[b.next]!;
      const label = b.files.length > 1 ? `PDF ${b.next + 1} de ${b.files.length} · ${file.name}` : file.name;
      let res;
      try {
        res = await upload(file, label, applyFound(data, b.found, null).foods);
      } catch {
        batch.current = null;
        return setPhase({ step: 'elegir' });
      }
      if (batch.current !== b) return;
      const { status, body } = res;
      if (status !== 200 || !body?.document) {
        const error = body?.error ?? `El servidor respondió con un error (${status}).`;
        return setPhase({ step: 'elegir', error: b.files.length > 1 ? `${file.name}: ${error}` : error, canRetry: true });
      }
      const got = {
        lista: body.foodList ? sanitizeFoodList(body.foodList) : null,
        pauta: body.plan ? sanitizeExtraction(body.plan) : null,
        conversion: body.conversion ? sanitizeConversion(body.conversion) : null,
        productos: body.products ? sanitizeProducts(body.products) : null,
      };
      const parts = (Object.keys(got) as Part[]).filter((p) => got[p]);
      b.next++;
      if (!parts.length) {
        if (b.files.length === 1) {
          batch.current = null;
          return setPhase({ step: 'elegir', error: 'Este PDF no parece un documento de tu nutricionista (lista de alimentos, pauta, tabla de crudo a cocido o productos recomendados).' });
        }
        b.skipped.push(file.name);
        continue;
      }
      // Pauta y guías se enlazan con la lista: si aún no la hay y quedan PDF, este se vuelve a leer al final.
      if (!got.lista && !hasList && !b.found.list && b.next < b.files.length && !b.deferred.has(file)) {
        b.deferred.add(file);
        b.files.push(file);
        continue;
      }
      const doc = body.document;
      const docs = { ...b.found.docs };
      const files = { ...b.found.files };
      for (const p of parts) {
        docs[p] = parts.length > 1 ? { ...doc, id: `${doc.id}-${p}` } : doc;
        files[p] = file.name;
      }
      b.found = {
        list: got.lista ?? b.found.list,
        plan: got.pauta ?? b.found.plan,
        conversion: got.conversion ?? b.found.conversion,
        products: got.productos ?? b.found.products,
        docs,
        files,
        model: [...new Set([...b.found.model.split(', '), ...(body.model ?? 'Gemini').split(', ')].filter(Boolean))].join(', '),
      };
    }
    batch.current = null;
    if (!b.found.list && !b.found.plan && !b.found.conversion && !b.found.products) {
      return setPhase({ step: 'elegir', error: 'Ninguno de estos PDF parece un documento de tu nutricionista.' });
    }
    if (b.found.plan && !b.found.list && !hasList) {
      return setPhase({
        step: 'elegir',
        error: 'Este PDF es una pauta, pero todavía no tienes la lista de alimentos. Sube primero la lista (o un PDF que traiga las dos cosas) y después esta pauta.',
      });
    }
    setPhase({ step: 'revisar', ...b.found, skipped: b.skipped });
  }

  const intro = {
    lista: { kicker: 'Paso 1 de 2', title: 'Sube la lista de alimentos', text: 'Las tablas de tu nutricionista que dicen cuánto de cada alimento es una porción. Puedes elegir a la vez todos los PDF que te haya dado (lista, pauta, crudo a cocido, mercado): se identifica cada uno solo.' },
    pauta: { kicker: 'Paso 2 de 2', title: 'Sube tu pauta', text: 'Tu plan personal: porciones por comida, indicaciones y platos de ejemplo.' },
    actualizar: { kicker: 'Mi dieta', title: 'Importar desde PDF', text: 'Sube una versión nueva de tu pauta, tu lista de alimentos, la tabla de crudo a cocido o la guía de productos. Se detecta qué es y lo revisas antes de guardarlo.' },
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
              {phase.canRetry && batch.current && (
                <button className="btn small" style={{ marginTop: 'var(--space-2)' }} onClick={() => void run()}>
                  Reintentar con {batch.current.files[batch.current.next]!.name}
                </button>
              )}
            </div>
          )}
          <PdfDrop onFiles={start} />
          <p className="note">
            El PDF se guarda en tu usuario de Sazora y se envía a <b>Google Gemini</b> para leerlo. Con la API gratuita, Google puede usar ese contenido para mejorar sus productos; con facturación activada, no.
          </p>
        </section>
      )}

      {(phase.step === 'subiendo' || phase.step === 'analizando') && <Progress phase={phase} onCancel={() => xhr.current?.abort()} />}

      {phase.step === 'revisar' && (
        <Review
          key={Object.values(phase.docs).map((d) => d.id).join()}
          found={phase}
          hadDiet={!!data.diet}
          dataAfterGuides={applyFound(data, phase, null)}
          skipped={phase.skipped}
          onDiscard={() => setPhase({ step: 'elegir' })}
          onConfirm={(plan) => {
            update((d) => applyFound(d, phase, plan));
            navigate(plan || data.diet ? '/dieta' : '/inicio');
          }}
        />
      )}
    </div>
  );
}

/** Zona para elegir o soltar el PDF. El input nativo queda accesible (teclado y lector de pantalla). */
function PdfDrop({ onFiles }: { onFiles: (f: File[]) => void }) {
  const [over, setOver] = useState(false);
  return (
    <label
      className={`dropzone${over ? ' over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = [...e.dataTransfer.files]; if (f.length) onFiles(f); }}
    >
      <input className="sr-only" type="file" multiple accept="application/pdf,.pdf" aria-label="PDF de la nutricionista" onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) onFiles(f); }} />
      <span className="dropzone-icon" aria-hidden="true"><Icon name="documento" size={28} /></span>
      <span className="btn primary dropzone-btn" aria-hidden="true"><Icon name="subir" size={18} /> Elegir PDF</span>
      <span className="dropzone-hint muted small">o arrástralos aquí · puedes elegir varios · máximo {MAX_MB} MB cada uno</span>
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
      <p className="small">{phase.label}</p>
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

const PART_NAMES: Record<Part, string> = { lista: 'la lista de alimentos', pauta: 'una pauta', conversion: 'la tabla de crudo a cocido', productos: 'la guía de productos recomendados' };

function Review({ found, skipped, hadDiet, dataAfterGuides, onDiscard, onConfirm }: {
  found: Found;
  skipped: string[];
  hadDiet: boolean;
  /** Datos tras aplicar lista y guías, para comprobar enlaces de la pauta y de la tabla de cocción. */
  dataAfterGuides: AppData;
  onDiscard: () => void;
  onConfirm: (plan: Extraction | null) => void;
}) {
  const [plan, setPlan] = useState(found.plan);
  const { list, conversion, products } = found;
  const parts = (['lista', 'pauta', 'conversion', 'productos'] as Part[]).filter((p) => ({ lista: list, pauta: plan, conversion, productos: products })[p]);
  const what = parts.map((p) => PART_NAMES[p]).join(', ').replace(/, ([^,]*)$/, ' y $1');
  const confirm = plan
    ? { label: parts.length > 1 ? 'Guardar todo' : 'Usar esta pauta', title: 'Sustituir tu pauta', message: `Esta pauta pasará a ser la tuya${parts.length > 1 ? ' y se guardará el resto del documento' : ''}. Se conservan lo que has planificado y comido, tus recetas y tus alimentos. Los platos de la pauta anterior que ya hayas usado pasan a tus recetas propias.` }
    : list && parts.length === 1
      ? { label: 'Guardar lista', title: 'Guardar la lista', message: hadDiet ? 'Se guardará esta lista y tu pauta pasará a usarla. Las equivalencias de listas anteriores se conservan como historial.' : 'Se guardará la lista de alimentos. Después podrás subir tu pauta.' }
      : { label: parts.length > 1 ? 'Guardar todo' : 'Guardar guía', title: 'Guardar', message: 'Se guardará como guía de consulta en Mi dieta, junto con su PDF original. Si ya tenías una versión anterior, esta la sustituye.' };

  return (
    <div className="stack-lg">
      <section className="panel stack" aria-labelledby="h-rev">
        <h2 id="h-rev">Revisa lo extraído</h2>
        {new Set(Object.values(found.files)).size > 1 ? (
          <ul className="rules">
            {parts.map((p) => <li key={p}><b>{found.files[p]}</b>: {PART_NAMES[p]}</li>)}
          </ul>
        ) : (
          <p>Este PDF contiene <b>{what}</b>.</p>
        )}
        {skipped.length > 0 && <p className="note warn"><Icon name="aviso" size={16} /> No parecen documentos de tu nutricionista y no se importan: {skipped.join(', ')}.</p>}
        <p className="muted small">Leído con {found.model}.</p>
      </section>

      {list && <ListReview list={list} />}
      {products && <ProductsReview products={products} />}
      {conversion && <ConversionReview conversion={conversion} data={dataAfterGuides} />}
      {plan && <PlanReview plan={plan} setPlan={setPlan} foods={dataAfterGuides.foods} />}

      <div className="row wrap">
        <ConfirmButton className="btn primary" title={confirm.title} confirmLabel="Guardar" message={confirm.message} onConfirm={() => onConfirm(plan)}>
          {confirm.label}
        </ConfirmButton>
        <button className="btn ghost" onClick={onDiscard}>Descartar</button>
      </div>
    </div>
  );
}

function ConversionReview({ conversion: c, data }: { conversion: ConversionImport; data: AppData }) {
  return (
    <section className="stack" aria-labelledby="h-rev-cc">
      <h2 id="h-rev-cc">{c.title}</h2>
      <Checks checks={checkConversion(c, data)} />
      <div className="table-scroll">
        <table className="data">
          <thead><tr><th scope="col">Alimento</th><th scope="col">Crudo</th><th scope="col">Cocido</th></tr></thead>
          <tbody>
            {c.rows.map((r, k) => (
              <tr key={k}>
                <th scope="row">{r.names.join(', ')} <span className="muted small">{r.section}</span></th>
                <td className="num">{fmt(r.rawGrams, 1)} g</td>
                <td className="num">{r.cookedMin === r.cookedMax ? fmt(r.cookedMin, 1) : `${fmt(r.cookedMin, 1)}-${fmt(r.cookedMax, 1)}`} g</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {[...c.rules, ...c.notes].map((r, k) => <p key={k} className="note">{r.text}</p>)}
      <Doubts doubts={c.doubts} />
    </section>
  );
}

function ProductsReview({ products: p }: { products: ProductImport }) {
  return (
    <section className="stack" aria-labelledby="h-rev-prod">
      <h2 id="h-rev-prod">{p.title}</h2>
      <Checks checks={checkProducts(p)} />
      {p.stores.map((s, k) => (
        <details key={k} className="panel">
          <summary><h3>{s.store} <span className="muted">({s.products.length})</span></h3></summary>
          <ul className="rules">
            {s.products.map((x, j) => <li key={j}><b>{x.name}</b>{x.raw ? ` — ${x.raw}` : ''} <span className="source">pág. {x.page}</span></li>)}
          </ul>
        </details>
      ))}
      <Doubts doubts={p.doubts} />
    </section>
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
