// Importar documentos de la nutricionista desde PDF: subida → lectura con IA → revisión → confirmar.
// Un PDF puede traer la lista de alimentos, la pauta, la tabla de crudo a cocido, la guía de productos
// o varias de ellas a la vez: se identifica qué trae y se revisa cada parte.

import { useEffect, useRef, useState } from 'react';
import { applyImport, checkExtraction, sanitizeExtraction, unmatchedIngredients, type Extraction, type ImportedDocument } from '../../domain/importPlan';
import { applyFoodList, checkFoodList, currentListDocId, sanitizeFoodList, type FoodList } from '../../domain/importFoodList';
import { applyConversion, applyProducts, checkConversion, checkProducts, currentDoc, sanitizeConversion, sanitizeProducts, type ConversionImport, type ProductImport } from '../../domain/importGuides';
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
const FOUND_KEY = { lista: 'list', pauta: 'plan', conversion: 'conversion', productos: 'products' } as const;

/** Parte leída de un PDF que trae varias (su id lleva el sufijo de la parte), no de un documento propio. */
const isExtra = (docId: string, p: Part) => docId.endsWith(`-${p}`);

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
  | { step: 'analizando'; label: string; done: number; total: number | null; current: string }
  | ({ step: 'revisar'; skipped: string[]; kept: string[] } & Found);

/** Varios PDF se leen de uno en uno (el servidor atiende una importación por usuario) y se juntan. */
interface Batch {
  files: File[];
  next: number;
  found: Found;
  skipped: string[];
  /** Partes descartadas porque ya hay un documento propio de ese tipo. */
  kept: string[];
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

type Progress = { type: 'progreso'; done: number; total: number | null; label: string };

/** Respuesta por líneas del servidor: avance de cada lectura y, al final, { status, body }. */
function readLines(text: string): { progress?: Progress; final?: { status: number; body: ImportResponse } } {
  const out: ReturnType<typeof readLines> = {};
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line) as Progress | { status: number; body: ImportResponse };
      if ('type' in msg) out.progress = msg;
      else out.final = msg;
    } catch {
      // línea a medio llegar: se leerá completa en el siguiente aviso
    }
  }
  return out;
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    r.readAsDataURL(file);
  });
}

/** `bare`: sin cabecera, dentro de la pantalla de bienvenida. */
export function ImportScreen({ bare = false }: { bare?: boolean }) {
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
          if (!batch.current) return reject(new Error('cancelado')); // se canceló mientras se leía el archivo
          const req = new XMLHttpRequest();
          xhr.current = req;
          req.open('POST', '/api/importar');
          req.setRequestHeader('content-type', 'application/json');
          req.setRequestHeader('accept', 'application/x-ndjson');
          const analysing = (p?: Progress) => setPhase({ step: 'analizando', label, done: p?.done ?? 0, total: p?.total ?? null, current: p?.label ?? 'Identificando el documento' });
          req.upload.onprogress = (e) => e.lengthComputable && setPhase({ step: 'subiendo', percent: Math.round((e.loaded / e.total) * 100), label });
          req.upload.onload = () => analysing();
          req.onprogress = () => {
            const { progress } = readLines(req.responseText);
            if (progress) analysing(progress);
          };
          req.onerror = () => resolve({ status: 0, body: { error: 'No se pudo conectar con el servidor de Sazora.' } });
          req.onabort = () => reject(new Error('cancelado'));
          req.onload = () => {
            // Los errores previos a la lectura (sesión, PDF no válido…) llegan como JSON normal.
            if (!req.getResponseHeader('content-type')?.includes('ndjson')) {
              let body: ImportResponse | null = null;
              try { body = JSON.parse(req.responseText) as ImportResponse; } catch { /* respuesta vacía o no JSON */ }
              return resolve({ status: req.status, body });
            }
            const { final } = readLines(req.responseText);
            resolve(final ?? { status: 0, body: { error: 'La respuesta del servidor quedó cortada. Inténtalo de nuevo.' } });
          };
          req.send(JSON.stringify({ pdfBase64, catalog: catalog.map((f) => ({ id: f.id, name: f.brand ? `${f.name} (${f.brand})` : f.name })) }));
        }),
      (e: Error) => ({ status: 0, body: { error: e.message } }),
    );
  }

  function cancel() {
    batch.current = null;
    xhr.current?.abort();
    setPhase({ step: 'elegir' });
  }

  function start(files: File[]) {
    const bad = files.find((f) => f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf'));
    if (bad) return setPhase({ step: 'elegir', error: `${bad.name} no es un PDF.` });
    const big = files.find((f) => f.size > MAX_MB * 1024 * 1024);
    if (big) return setPhase({ step: 'elegir', error: `${big.name} supera los ${MAX_MB} MB.` });
    batch.current = { files, next: 0, found: EMPTY, skipped: [], kept: [], deferred: new Set() };
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
      const found: Found = {
        ...b.found,
        docs: { ...b.found.docs },
        files: { ...b.found.files },
        model: [...new Set([...b.found.model.split(', '), ...(body.model ?? 'Gemini').split(', ')].filter(Boolean))].join(', '),
      };
      for (const p of parts) {
        const prev = b.found.docs[p];
        // Un documento propio (p. ej. la lista del mercado) no lo pisa la misma parte que otro PDF trae
        // de pasada (las páginas de productos de la pauta), elija el orden que elija el usuario.
        if (parts.length > 1 && prev && !isExtra(prev.id, p)) {
          b.kept.push(`${file.name} también trae ${PART_NAMES[p]}; se usa la de ${b.found.files[p]}, que es un documento propio.`);
          continue;
        }
        found.docs[p] = parts.length > 1 ? { ...doc, id: `${doc.id}-${p}` } : doc;
        found.files[p] = file.name;
        Object.assign(found, { [FOUND_KEY[p]]: got[p] });
      }
      b.found = found;
    }
    batch.current = null;
    // Lo mismo frente a las guías ya guardadas: las páginas de productos de una pauta nueva no sustituyen
    // a la guía de productos que se subió como documento propio.
    for (const p of ['conversion', 'productos'] as const) {
      const doc = b.found.docs[p];
      const saved = currentDoc(data, p);
      if (doc && isExtra(doc.id, p) && saved && !isExtra(saved.id, p)) {
        b.kept.push(`${b.found.files[p]} también trae ${PART_NAMES[p]}, pero se conserva la que ya tienes (${saved.title}), que es un documento propio. Para cambiarla, sube su PDF.`);
        const docs = { ...b.found.docs };
        const files = { ...b.found.files };
        delete docs[p];
        delete files[p];
        b.found = { ...b.found, [FOUND_KEY[p]]: null, docs, files };
      }
    }
    if (b.kept.length && !b.found.list && !b.found.plan && !b.found.conversion && !b.found.products) {
      return setPhase({ step: 'elegir', error: b.kept.join(' ') });
    }
    if (!b.found.list && !b.found.plan && !b.found.conversion && !b.found.products) {
      return setPhase({ step: 'elegir', error: 'Ninguno de estos PDF parece un documento de tu nutricionista.' });
    }
    if (b.found.plan && !b.found.list && !hasList) {
      return setPhase({
        step: 'elegir',
        error: 'Este PDF es una pauta, pero todavía no tienes la lista de alimentos. Sube primero la lista (o un PDF que traiga las dos cosas) y después esta pauta.',
      });
    }
    setPhase({ step: 'revisar', ...b.found, skipped: b.skipped, kept: b.kept });
  }

  const intro = {
    lista: { kicker: 'Paso 1 de 2', title: 'Sube la lista de alimentos', text: 'Las tablas de tu nutricionista que dicen cuánto de cada alimento es una porción. Puedes elegir a la vez todos los PDF que te haya dado (lista, pauta, crudo a cocido, mercado): se identifica cada uno solo.' },
    pauta: { kicker: 'Paso 2 de 2', title: 'Sube tu pauta', text: 'Tu plan personal: porciones por comida, indicaciones y platos de ejemplo.' },
    actualizar: { kicker: 'Mi dieta', title: 'Importar desde PDF', text: 'Sube una versión nueva de tu pauta, tu lista de alimentos, la tabla de crudo a cocido o la guía de productos. Se detecta qué es y lo revisas antes de guardarlo.' },
  }[stage];

  return (
    <div className="stack-lg">
      {!bare && (
        <header className="page-head">
          <a href={href('/guias')} className="back">← Documentos</a>
          <p className="kicker">{intro.kicker}</p>
          <h1>{intro.title}</h1>
          <p className="muted">{intro.text}</p>
        </header>
      )}

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

      {(phase.step === 'subiendo' || phase.step === 'analizando') && <Progress phase={phase} onCancel={cancel} />}

      {phase.step === 'revisar' && (
        <Review
          key={Object.values(phase.docs).map((d) => d.id).join()}
          found={phase}
          hadDiet={!!data.diet}
          dataAfterGuides={applyFound(data, phase, null)}
          skipped={phase.skipped}
          kept={phase.kept}
          onDiscard={() => setPhase({ step: 'elegir' })}
          onConfirm={(plan) => {
            update((d) => applyFound(d, phase, plan));
            setPhase({ step: 'elegir' });
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
  // El porcentaje es de lecturas terminadas: Gemini no informa de su avance dentro de cada una.
  const percent = phase.step === 'subiendo' ? phase.percent : phase.total ? Math.round((phase.done / phase.total) * 100) : 0;
  const step = phase.step === 'analizando' && (phase.total ? `Paso ${phase.done + 1} de ${phase.total}: ${phase.current}` : phase.current);
  return (
    <section className="panel loader" aria-live="polite" aria-busy="true">
      <div className="spinner" aria-hidden="true" />
      <p className="loader-title">{phase.step === 'subiendo' ? `Subiendo el PDF… ${percent} %` : `Gemini está leyendo el documento… ${percent} %`}</p>
      <div className="bar import-bar" role="progressbar" aria-label={phase.step === 'subiendo' ? 'Subida del PDF' : 'Lectura del PDF'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className="small">{phase.label}</p>
      {step && <p className="small"><b>{step}</b></p>}
      <p className="muted small">{phase.step === 'analizando' ? 'Una lectura para identificar el documento y otra por cada parte que trae (pauta, crudo a cocido, productos). Cada una puede tardar varios minutos; si Gemini está saturado, se reintenta solo.' : 'Preparando el envío.'}</p>
      <div>
        <button className="btn" onClick={onCancel}>Cancelar</button>
      </div>
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
      <p className="muted small">Quedarán en Dudas de la importación (Ajustes → Dudas).</p>
    </details>
  );

const PART_NAMES: Record<Part, string> = { lista: 'la lista de alimentos', pauta: 'una pauta', conversion: 'la tabla de crudo a cocido', productos: 'la guía de productos recomendados' };

function Review({ found, skipped, kept, hadDiet, dataAfterGuides, onDiscard, onConfirm }: {
  found: Found;
  skipped: string[];
  kept: string[];
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
      : { label: parts.length > 1 ? 'Guardar todo' : 'Guardar guía', title: 'Guardar', message: 'Se guardará como guía de consulta en Documentos, junto con su PDF original. Si ya tenías una versión anterior, esta la sustituye.' };

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
        {kept.map((k) => <p key={k} className="note"><Icon name="aviso" size={16} /> {k}</p>)}
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
