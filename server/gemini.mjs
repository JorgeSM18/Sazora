// Lectura de documentos de la nutricionista con la API de Gemini (endpoint Interactions).
// Dos tareas: 1) clasificar el PDF y extraer la lista de alimentos si la trae; 2) extraer la pauta.
// Funciones puras para construir peticiones y leer respuestas; la red está en importDocument.

export const GROUPS = ['lacteos', 'vegetales', 'frutas', 'carbohidratos', 'proteinaMagra', 'proteinaSemimagra', 'grasas'];
const STATES = ['crudo', 'cocido', 'escurrido', 'listo', 'otro'];
export const KINDS = ['lista', 'pauta', 'ambos', 'otro'];

const nullableNumber = { type: ['number', 'null'] };
const nullableString = { type: ['string', 'null'] };
const page = { type: 'integer', description: 'Página del PDF, empezando en 1.' };
const doubts = {
  type: 'array',
  description: 'Ambigüedades, datos ilegibles o contradicciones encontradas.',
  items: { type: 'object', properties: { text: { type: 'string' }, page }, required: ['text', 'page'] },
};
const portions = {
  type: 'object',
  description: 'Porciones por grupo de intercambio. null si el documento no indica ese grupo.',
  properties: Object.fromEntries(GROUPS.map((g) => [g, nullableNumber])),
  required: GROUPS,
};

// ── 1. Clasificar y extraer la lista de alimentos ──────────────────────────

export const LIST_SCHEMA = {
  type: 'object',
  properties: {
    kind: {
      type: 'string',
      enum: KINDS,
      description: 'lista = tablas de intercambios (cuánto de cada alimento es 1 porción). pauta = plan personal con porciones por comida. ambos = el PDF trae las dos cosas.',
    },
    food_list: {
      type: ['object', 'null'],
      description: 'Solo si el PDF contiene la lista de alimentos; si no, null.',
      properties: {
        title: { type: 'string' },
        author: nullableString,
        version: nullableString,
        groups: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              group: { type: 'string', enum: GROUPS },
              title: { type: 'string', description: 'Título de la tabla tal como aparece (p. ej. "Legumbres").' },
              page,
              note: { ...nullableString, description: 'Aclaración general de la tabla, p. ej. "1 porción = 1/2 taza cocidos".' },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    amount: { ...nullableNumber, description: 'Cantidad que equivale a 1 porción (columna de gramos).' },
                    unit: { type: ['string', 'null'], enum: ['g', 'ml', null] },
                    household: { ...nullableString, description: 'Medida casera tal como aparece.' },
                    units_per_portion: { ...nullableNumber, description: 'Solo si la medida casera es un recuento claro: "3 unidades" → 3, "1/2 unidad" → 0.5.' },
                    unit_label: { ...nullableString, description: 'Nombre de la unidad: galleta, rebanada, scoop…' },
                    state: { type: 'string', enum: STATES },
                  },
                  required: ['name', 'amount', 'unit', 'household', 'units_per_portion', 'unit_label', 'state'],
                },
              },
            },
            required: ['group', 'title', 'page', 'note', 'items'],
          },
        },
        doubts,
      },
      required: ['title', 'author', 'version', 'groups', 'doubts'],
    },
  },
  required: ['kind', 'food_list'],
};

const LIST_INSTRUCTIONS = `Eres un asistente que clasifica y transcribe documentos de una nutricionista.
1. Clasifica el PDF: "lista" si contiene tablas de intercambios (para muchos alimentos, cuánto es 1 porción), "pauta" si es un plan personal con porciones por comida, "ambos" si trae las dos cosas, "otro" si no es ninguna.
2. Si contiene la lista, transcríbela COMPLETA, fila a fila y tabla a tabla. Si no, food_list = null.
Reglas:
- Transcribe solo lo escrito. No inventes alimentos, cantidades ni medidas. Celda vacía o "-" → null.
- Grupos: ${GROUPS.join(', ')}. Asigna cada tabla a su grupo. Las legumbres van a carbohidratos y lo anotas en doubts. Las subtablas de lácteos (descremados, semidesnatados, enteros) van a lacteos indicando la subtabla en note.
- "50g (cocido)" → amount 50, unit g, state cocido. Si la cabecera dice "peso en crudo": state crudo para lo que se cocina antes de comerlo (cereales, legumbres, carnes, pescados, tubérculos) y listo para lo que se come tal cual (fruta, pan, queso, aceite, frutos secos, lácteos).
- Tablas sin gramos (como vegetales): amount null y la equivalencia general en note.
- Si un nombre aparece repetido, transcríbelo una vez y anótalo en doubts. Si dos palabras aparecen pegadas, sepáralas y anótalo.
- Las páginas se cuentan desde 1.`;

// ── 2. Extraer la pauta ────────────────────────────────────────────────────

export const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    plan_name: { type: 'string' },
    holder: { ...nullableString, description: 'Persona a la que va dirigida la pauta.' },
    version: nullableString,
    meals: {
      type: 'array',
      description: 'Comidas del día en orden, con sus porciones objetivo.',
      items: { type: 'object', properties: { name: { type: 'string' }, page, portions }, required: ['name', 'page', 'portions'] },
    },
    daily_totals: { ...portions, description: 'Porciones totales del día tal como figuran en el documento.' },
    daily_totals_page: { type: ['integer', 'null'] },
    rules: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          kind: { type: 'string', enum: ['libre', 'equivalencia', 'sustitucion', 'restriccion', 'consejo'] },
          page,
        },
        required: ['text', 'kind', 'page'],
      },
    },
    equivalences: {
      type: 'array',
      description: 'Equivalencias explícitas "X cantidad de alimento = N porciones" que aparecen en la pauta.',
      items: {
        type: 'object',
        properties: {
          food: { type: 'string' },
          catalog_id: nullableString,
          amount: { type: 'number' },
          unit: { type: 'string', enum: ['g', 'ml', 'unidad'] },
          portions,
          page,
          raw: { type: 'string' },
        },
        required: ['food', 'catalog_id', 'amount', 'unit', 'portions', 'page', 'raw'],
      },
    },
    dishes: {
      type: 'array',
      description: 'Platos o menús de ejemplo.',
      items: {
        type: 'object',
        properties: {
          meal: { type: 'string' },
          name: { type: 'string' },
          page,
          raw: { type: 'string', description: 'Texto literal del plato en el PDF.' },
          ingredients: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                catalog_id: nullableString,
                quantity: nullableNumber,
                unit: { type: ['string', 'null'], enum: ['g', 'ml', 'unidad', 'porcion', null] },
                not_counted: { type: 'boolean', description: 'true si el documento dice que no se contabiliza (especias, edulcorante, verduras libres...).' },
              },
              required: ['label', 'catalog_id', 'quantity', 'unit', 'not_counted'],
            },
          },
        },
        required: ['meal', 'name', 'page', 'raw', 'ingredients'],
      },
    },
    doubts,
  },
  required: ['plan_name', 'holder', 'version', 'meals', 'daily_totals', 'daily_totals_page', 'rules', 'equivalences', 'dishes', 'doubts'],
};

const PLAN_INSTRUCTIONS = `Eres un asistente que transcribe pautas nutricionales en PDF a datos estructurados.
Reglas obligatorias:
- Transcribe solo lo que está escrito. No inventes cantidades, porciones, calorías ni alimentos. Si algo no figura, usa null.
- Los grupos de intercambio son: ${GROUPS.join(', ')}. "Almidones" y "carbohidratos" son el mismo grupo. "Proteína M" es proteinaMagra y "proteína SM" es proteinaSemimagra. "Leche/yogurt" y "lácteos" son lacteos.
- Una celda vacía en una tabla de porciones es null, no 0. Un 0 escrito es 0.
- Si el PDF también trae la lista de alimentos (tablas de intercambios), ignórala aquí: no la copies en equivalences.
- Para catalog_id usa el identificador del catálogo SOLO si el alimento es claramente el mismo; si hay dudas, null.
- Cantidades: "40g" → 40 y unidad g; "2 huevos" → 2 y unidad unidad; "1 lata" → 1 unidad. Si no hay cantidad, quantity y unit null.
- Registra en doubts cualquier ambigüedad, dato ilegible, contradicción entre páginas o cuenta que no cuadre.
- Las páginas se cuentan desde 1. Ignora las imágenes de productos salvo que tengan texto con una equivalencia.`;

// ── Peticiones y respuestas ────────────────────────────────────────────────

const pdfPart = (pdfBase64) => ({ type: 'document', data: pdfBase64, mime_type: 'application/pdf' });
const jsonFormat = (schema) => ({ type: 'text', mime_type: 'application/json', schema });

export function buildListRequest({ pdfBase64, model }) {
  return {
    model,
    system_instruction: LIST_INSTRUCTIONS,
    input: [pdfPart(pdfBase64), { type: 'text', text: 'Clasifica el documento y transcribe la lista de alimentos si la contiene.' }],
    response_format: jsonFormat(LIST_SCHEMA),
  };
}

/** `catalog`: [{ id, name }] de alimentos conocidos, para enlazar ingredientes. */
export function buildPlanRequest({ pdfBase64, catalog, model }) {
  return {
    model,
    system_instruction: PLAN_INSTRUCTIONS,
    input: [
      pdfPart(pdfBase64),
      { type: 'text', text: `Catálogo de alimentos conocidos (id: nombre):\n${catalog.map((f) => `${f.id}: ${f.name}`).join('\n')}\n\nTranscribe la pauta del PDF.` },
    ],
    response_format: jsonFormat(PLAN_SCHEMA),
  };
}

/** Mismo criterio de ids que la app (src/data/fixtures/util.ts → slug). */
export const slug = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Alimentos de una lista recién extraída, para que la pauta del mismo PDF pueda enlazarlos. */
export const listCatalog = (foodList) =>
  (foodList?.groups ?? [])
    .flatMap((g) => (g.items ?? []).map((i) => ({ id: slug(String(i.name ?? '')), name: String(i.name ?? '') })))
    .filter((f) => f.id);

/** Extrae el JSON de la respuesta de Interactions o lanza un error legible. */
export function parseResponse(body) {
  if (body?.status && body.status !== 'completed') {
    const why = body.errors?.map((e) => e.message).join('; ');
    throw new Error(body.status === 'incomplete' ? 'La respuesta de Gemini quedó cortada.' : `Gemini no completó la extracción (${body.status}${why ? `: ${why}` : ''}).`);
  }
  const output = body?.steps?.find((s) => s.type === 'model_output');
  const text = output?.content?.find((c) => c.type === 'text')?.text;
  if (!text) throw new Error('Gemini no devolvió contenido.');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Gemini devolvió un JSON no válido.');
  }
}

// ── Red: reintentos y modelos de reserva ───────────────────────────────────

/** Errores temporales de Google (saturación, cuota, fallo interno): merece la pena reintentar. */
const RETRYABLE = new Set([429, 500, 503]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class GeminiError extends Error {
  constructor(message, { status, busy = false } = {}) {
    super(message);
    this.status = status;
    this.busy = busy;
  }
}

async function callOnce({ body, apiKey, signal, fetchImpl }) {
  const res = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
    signal,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error?.message ?? json?.errors?.[0]?.message ?? res.statusText;
    throw new GeminiError(`Error de la API de Gemini (${res.status}): ${msg}`, { status: res.status, busy: RETRYABLE.has(res.status) });
  }
  return parseResponse(json);
}

/**
 * Ejecuta una petición probando los modelos en orden. Si uno está saturado, reintenta con espera
 * creciente (2 s, 6 s…) y pasa al siguiente; si un modelo ya no existe (404), lo salta.
 * Devuelve { result, model }.
 */
export async function generate({ build, apiKey, models, signal, attempts = 2, fetchImpl = fetch, wait = sleep, log = console.warn }) {
  let last;
  for (const model of models) {
    for (let i = 0; i < attempts; i++) {
      try {
        return { result: await callOnce({ body: build(model), apiKey, signal, fetchImpl }), model };
      } catch (e) {
        if (!(e instanceof GeminiError) || !(e.busy || e.status === 404)) throw e;
        log(`[gemini] ${model} intento ${i + 1}: ${e.message}`);
        last = e;
        if (e.status === 404) break;
        if (i < attempts - 1) await wait(2000 * 3 ** i);
      }
    }
  }
  throw new GeminiError(
    `Gemini está saturado ahora mismo (${models.length * attempts} intentos con ${models.join(', ')}). Es temporal: prueba de nuevo en unos minutos.`,
    { status: last?.status, busy: true },
  );
}

/**
 * Lee un PDF de la nutricionista: lo clasifica, extrae la lista si la trae y, si trae pauta,
 * la extrae enlazando ingredientes con los alimentos conocidos y con los de la lista del propio PDF.
 * Devuelve { kind, foodList, plan, model }.
 */
export async function importDocument({ pdfBase64, catalog, ...opts }) {
  const first = await generate({ ...opts, build: (model) => buildListRequest({ pdfBase64, model }) });
  const kind = KINDS.includes(first.result?.kind) ? first.result.kind : 'otro';
  const foodList = kind === 'lista' || kind === 'ambos' ? first.result.food_list ?? null : null;
  if (kind !== 'pauta' && kind !== 'ambos') return { kind, foodList, plan: null, model: first.model };
  const second = await generate({ ...opts, build: (model) => buildPlanRequest({ pdfBase64, catalog: [...catalog, ...listCatalog(foodList)], model }) });
  return { kind, foodList, plan: second.result, model: second.model };
}
