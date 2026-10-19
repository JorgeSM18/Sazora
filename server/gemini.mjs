// Lectura de documentos de la nutricionista con la API de Gemini (endpoint Interactions).
// Dos tareas: 1) clasificar el PDF y extraer la lista de alimentos si la trae; 2) extraer la pauta.
// Funciones puras para construir peticiones y leer respuestas; la red está en importDocument.

import * as http from 'node:http';
import * as https from 'node:https';

export const GROUPS = ['lacteos', 'vegetales', 'frutas', 'carbohidratos', 'proteinaMagra', 'proteinaSemimagra', 'grasas'];
const STATES = ['crudo', 'cocido', 'escurrido', 'listo', 'otro'];
/** Partes que puede traer un PDF de la nutricionista. */
export const PARTS = ['lista', 'pauta', 'conversion', 'productos'];

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
    contains: {
      type: 'object',
      description: 'Qué partes trae el PDF (puede traer varias).',
      properties: {
        lista: { type: 'boolean', description: 'Tablas de intercambios: para muchos alimentos, cuánto es 1 porción.' },
        pauta: { type: 'boolean', description: 'Plan personal: porciones por comida, menús de ejemplo e indicaciones.' },
        conversion: { type: 'boolean', description: 'Tabla de pesos de crudo a cocido.' },
        productos: { type: 'boolean', description: 'Guía de productos recomendados por supermercado con sus porciones.' },
      },
      required: PARTS,
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
  required: ['contains', 'food_list'],
};

const LIST_INSTRUCTIONS = `Eres un asistente que clasifica y transcribe documentos de una nutricionista.
1. Indica qué partes trae el PDF (pueden ser varias): "lista" (tablas de intercambios: para muchos alimentos, cuánto es 1 porción), "pauta" (plan personal con porciones por comida), "conversion" (tabla de pesos de crudo a cocido), "productos" (productos recomendados por supermercado con sus porciones). Si no es ninguna, todo false.
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
- Si el PDF también trae la lista de alimentos, la tabla de crudo a cocido o la guía de productos por supermercado, ignóralas aquí: no las copies en equivalences.
- Para catalog_id usa el identificador del catálogo SOLO si el alimento es claramente el mismo; si hay dudas, null.
- Cantidades: "40g" → 40 y unidad g; "2 huevos" → 2 y unidad unidad; "1 lata" → 1 unidad. Si no hay cantidad, quantity y unit null.
- Registra en doubts cualquier ambigüedad, dato ilegible, contradicción entre páginas o cuenta que no cuadre.
- Las páginas se cuentan desde 1. Ignora las imágenes de productos salvo que tengan texto con una equivalencia.`;

// ── 3. Tabla de crudo a cocido ─────────────────────────────────────────────

const literal = { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, page }, required: ['text', 'page'] } };

export const CONVERSION_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    rules: { ...literal, description: 'Reglas generales y avisos importantes, literales.' },
    items: {
      type: 'array',
      description: 'Una fila por línea de la tabla. Si una fila agrupa varios alimentos (p. ej. "Pollo, Pavo, Ternera, Cerdo"), van todos en names.',
      items: {
        type: 'object',
        properties: {
          names: { type: 'array', items: { type: 'string' } },
          catalog_ids: { type: 'array', description: 'Para cada nombre, su id del catálogo si es claramente el mismo alimento; si no, null.', items: nullableString },
          section: { type: 'string', description: 'Sección de la tabla (Carbohidratos, Proteínas, Legumbres…).' },
          group: { type: 'string', enum: GROUPS },
          raw_grams: { type: 'number' },
          cooked_min_grams: { type: 'number' },
          cooked_max_grams: { type: 'number', description: 'Igual que el mínimo si la tabla da un solo valor.' },
          page,
        },
        required: ['names', 'catalog_ids', 'section', 'group', 'raw_grams', 'cooked_min_grams', 'cooked_max_grams', 'page'],
      },
    },
    notes: { ...literal, description: 'Notas al pie, literales (p. ej. sobre legumbres de bote).' },
    doubts,
  },
  required: ['title', 'rules', 'items', 'notes', 'doubts'],
};

const CONVERSION_INSTRUCTIONS = `Transcribe la tabla de pesos de crudo a cocido de la nutricionista.
- Una fila por línea de la tabla, con los gramos en crudo y en cocido tal como aparecen. "75-85g" → mínimo 75 y máximo 85; un solo valor → mínimo y máximo iguales.
- Grupos: ${GROUPS.join(', ')} (legumbres → carbohidratos; carnes y pescados → proteinaMagra).
- catalog_ids: usa el id del catálogo SOLO si el alimento es claramente el mismo; si no, null.
- Reglas generales, avisos "importante" y notas al pie: literales, sin resumir.
- No inventes filas ni valores. Lo ambiguo, en doubts. Páginas desde 1.`;

// ── 4. Productos recomendados por supermercado ─────────────────────────────

export const PRODUCTS_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    author: nullableString,
    stores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          store: { type: 'string', description: 'Nombre del supermercado tal como aparece (Lidl, Mercadona…).' },
          products: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Nombre del producto: el del texto o, si solo aparece en la foto, el que se lee en el envase.' },
                category: { type: 'string', description: 'Apartado de la página (p. ej. "Productos altos en proteína", "Opciones de panes").' },
                amount: { ...nullableNumber, description: 'Cantidad de la equivalencia (70 en "70g = 1 porción"; 1 en "1 natilla = …").' },
                unit: { type: ['string', 'null'], enum: ['g', 'ml', 'unidad', null] },
                unit_label: { ...nullableString, description: 'Qué es la unidad: natilla, tarrina, rebanada, paquete…' },
                portions: { ...portions, description: 'Porciones que equivalen a esa cantidad. Todo null si el texto no da equivalencia.' },
                raw: { type: 'string', description: 'Texto literal de la equivalencia o recomendación.' },
                page,
              },
              required: ['name', 'category', 'amount', 'unit', 'unit_label', 'portions', 'raw', 'page'],
            },
          },
        },
        required: ['store', 'products'],
      },
    },
    doubts,
  },
  required: ['title', 'author', 'stores', 'doubts'],
};

const PRODUCTS_INSTRUCTIONS = `Transcribe la guía de productos recomendados por supermercado de la nutricionista.
- Agrupa por supermercado en el orden del documento. Un producto por recomendación.
- "1 natilla = 1 y 1/2 porciones de proteína + 1 de carbohidrato" → amount 1, unit unidad, unit_label "natilla", proteinaMagra 1.5, carbohidratos 1.
- "Proteína" sin más es proteinaMagra; "proteína semimagra (1 de proteína + 1 de grasa)" es proteinaSemimagra 1.
- Si el texto se refiere a una foto ("1 = 1 porción") y no se sabe qué producto exacto es, usa el nombre del envase si se lee; si no, describe el tipo de producto y anótalo en doubts.
- Recomendaciones sin equivalencia (verduras salteadas, bebidas vegetales…): inclúyelas con amount, unit y portions a null.
- No inventes equivalencias. Lo ambiguo, en doubts. Páginas desde 1.`;

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

export function buildConversionRequest({ pdfBase64, catalog, model }) {
  return {
    model,
    system_instruction: CONVERSION_INSTRUCTIONS,
    input: [pdfPart(pdfBase64), { type: 'text', text: `Catálogo de alimentos conocidos (id: nombre):\n${catalog.map((f) => `${f.id}: ${f.name}`).join('\n')}\n\nTranscribe la tabla de crudo a cocido.` }],
    response_format: jsonFormat(CONVERSION_SCHEMA),
  };
}

export function buildProductsRequest({ pdfBase64, model }) {
  return {
    model,
    system_instruction: PRODUCTS_INSTRUCTIONS,
    input: [pdfPart(pdfBase64), { type: 'text', text: 'Transcribe la guía de productos recomendados por supermercado.' }],
    response_format: jsonFormat(PRODUCTS_SCHEMA),
  };
}

// ── Datos nutricionales buscados en la web ─────────────────────────────────

const nullableMacro = (description) => ({ ...nullableNumber, description });

export const NUTRITION_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'El id del alimento tal como se ha dado.' },
          found: { type: 'boolean', description: 'true solo si has encontrado una fuente fiable para este alimento.' },
          unit: { type: 'string', enum: ['g', 'ml'], description: 'Valores por 100 g, o por 100 ml si la fuente lo da así (bebidas).' },
          kcal: nullableMacro('Energía en kcal por 100 g/ml.'),
          protein: nullableMacro('Proteínas en g por 100 g/ml.'),
          carbs: nullableMacro('Hidratos de carbono en g por 100 g/ml.'),
          fat: nullableMacro('Grasas en g por 100 g/ml.'),
          source_name: { type: 'string', description: 'Fuente concreta: web del supermercado o fabricante, Open Food Facts, BEDCA, USDA…' },
          source_url: nullableString,
          note: { ...nullableString, description: 'Aclaraciones: producto parecido y no el exacto, valores en seco/crudo, etc.' },
        },
        required: ['id', 'found', 'unit', 'kcal', 'protein', 'carbs', 'fat', 'source_name', 'source_url', 'note'],
      },
    },
  },
  required: ['items'],
};

const NUTRITION_INSTRUCTIONS = `Busca en la web la información nutricional por 100 g (o 100 ml) de cada alimento de la lista.
- Si tiene marca o supermercado, busca ese producto exacto: primero la web del supermercado o del fabricante, después Open Food Facts.
- Si es un alimento genérico, usa una base de datos de composición de alimentos (BEDCA, USDA FoodData Central). Indica si el valor es en crudo, cocido o seco.
- Copia los valores de la fuente; no los calcules ni los estimes. Un nutriente que la fuente no da va a null.
- Si no encuentras una fuente fiable, found=false y todos los valores a null. Es mejor no encontrar que inventar.
- Si solo encuentras un producto parecido, dilo en note.`;

/** `foods`: [{ id, name, brand?, state? }]. Búsqueda de Google + respuesta JSON (Gemini 3). */
export function buildNutritionRequest({ foods, model }) {
  const lines = foods.map((f) => `${f.id}: ${f.name}${f.brand ? ` (${f.brand})` : ''}${f.state ? ` [${f.state}]` : ''}`);
  return {
    model,
    system_instruction: NUTRITION_INSTRUCTIONS,
    input: [{ type: 'text', text: `Alimentos (id: nombre (marca o supermercado) [estado]):\n${lines.join('\n')}` }],
    tools: [{ type: 'google_search' }],
    response_format: jsonFormat(NUTRITION_SCHEMA),
  };
}

export async function lookupNutrition({ foods, ...opts }) {
  const r = await generate({ ...opts, build: (model) => buildNutritionRequest({ foods, model }) });
  return { ...r.result, model: r.model };
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
  constructor(message, { status, busy = false, quota = false } = {}) {
    super(message);
    this.status = status;
    this.busy = busy;
    /** Cuota diaria agotada: no se libera en minutos, reintentar ese modelo no sirve. */
    this.quota = quota;
  }
}

/**
 * 429 de cuota agotada ("... 20 requests per day ... retry in 6h25m20s", o solo "You exceeded your current quota"):
 * no se libera en segundos. Solo un límite por minuto merece reintento con espera.
 */
const dailyQuota = (msg) => (/per minute|PerMinute/i.test(msg) ? null : { retryIn: msg.match(/retry in ([\dhms.]+)/i)?.[1]?.replace(/\.\d+s$/, 's') });

/**
 * POST con node:https. No se usa fetch porque corta a los 300 s sin cabeceras de respuesta ("fetch failed"),
 * y leer un PDF grande puede tardar más: aquí el único límite es `signal`.
 */
export function postJson(url, { headers, body, signal }) {
  return new Promise((resolve, reject) => {
    const req = (url.startsWith('https:') ? https : http).request(url, { method: 'POST', headers: { ...headers, 'content-length': Buffer.byteLength(body) }, signal }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('error', reject);
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, statusText: res.statusMessage ?? '', json: async () => JSON.parse(text) });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function callOnce({ body, apiKey, signal, fetchImpl }) {
  let res;
  try {
    res = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw signal.reason ?? e; // tiempo agotado o cancelado: se informa como tal
    throw new GeminiError(`Se perdió la conexión con Gemini (${e.code ?? e.message}). Inténtalo de nuevo.`);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error?.message ?? json?.errors?.[0]?.message ?? res.statusText;
    const quota = res.status === 429 && dailyQuota(msg);
    throw Object.assign(new GeminiError(`Error de la API de Gemini (${res.status}): ${msg}`, { status: res.status, busy: RETRYABLE.has(res.status) && !quota, quota: !!quota }), { retryIn: quota?.retryIn });
  }
  return parseResponse(json);
}

/**
 * Ejecuta una petición probando los modelos en orden. Si uno está saturado, reintenta con espera
 * creciente (2 s, 6 s…) y pasa al siguiente; si un modelo ya no existe (404), lo salta.
 * Devuelve { result, model }.
 */
export async function generate({ build, apiKey, models, signal, attempts = 2, fetchImpl = postJson, wait = sleep, log = console.warn }) {
  let last;
  const exhausted = []; // modelos sin cuota diaria
  for (const model of models) {
    for (let i = 0; i < attempts; i++) {
      try {
        return { result: await callOnce({ body: build(model), apiKey, signal, fetchImpl }), model };
      } catch (e) {
        if (!(e instanceof GeminiError) || !(e.busy || e.quota || e.status === 404)) throw e;
        log(`[gemini] ${model} intento ${i + 1}: ${e.message}`);
        last = e;
        if (e.quota) exhausted.push({ model, retryIn: e.retryIn });
        if (e.status === 404 || e.quota) break;
        if (i < attempts - 1) await wait(2000 * 3 ** i);
      }
    }
  }
  if (exhausted.length === models.length) {
    const when = exhausted[0].retryIn ? ` Google indica que se libera en ${exhausted[0].retryIn}.` : '';
    throw new GeminiError(
      `Se ha agotado la cuota de Gemini en todos los modelos (${models.join(', ')}).${when} Vuelve a intentarlo ${when ? 'entonces' : 'más tarde (la cuota gratuita es diaria)'} o activa la facturación en Google AI Studio.`,
      { status: 429, quota: true },
    );
  }
  throw new GeminiError(
    `Gemini está saturado ahora mismo (${models.length * attempts} intentos con ${models.join(', ')}). Es temporal: prueba de nuevo en unos minutos.`,
    { status: last?.status, busy: true },
  );
}

/**
 * Lee un PDF de la nutricionista: identifica qué partes trae y extrae cada una con su esquema.
 * La lista va en la primera lectura; la pauta y la tabla de crudo a cocido se leen con el catálogo
 * de alimentos conocidos (incluida la lista del propio PDF) para enlazarlos.
 * `onProgress({ done, total, label })`: antes de cada lectura (`total` es null hasta saber qué partes trae).
 * Devuelve { contains, foodList, plan, conversion, products, model }.
 */
export async function importDocument({ pdfBase64, catalog, onProgress = () => {}, ...opts }) {
  onProgress({ done: 0, total: null, label: 'Identificando el documento' });
  const first = await generate({ ...opts, build: (model) => buildListRequest({ pdfBase64, model }) });
  const c = first.result?.contains ?? {};
  const contains = Object.fromEntries(PARTS.map((p) => [p, c[p] === true]));
  const foodList = contains.lista ? first.result.food_list ?? null : null;
  const fullCatalog = [...catalog, ...listCatalog(foodList)];
  const models = [first.model];
  const toRead = ['pauta', 'conversion', 'productos'].filter((p) => contains[p]);
  const LABELS = { pauta: 'Leyendo la pauta', conversion: 'Leyendo la tabla de crudo a cocido', productos: 'Leyendo los productos recomendados' };
  const read = async (part, build) => {
    if (!contains[part]) return null;
    onProgress({ done: 1 + toRead.indexOf(part), total: 1 + toRead.length, label: LABELS[part] });
    const r = await generate({ ...opts, build });
    models.push(r.model);
    return r.result;
  };
  const plan = await read('pauta', (model) => buildPlanRequest({ pdfBase64, catalog: fullCatalog, model }));
  const conversion = await read('conversion', (model) => buildConversionRequest({ pdfBase64, catalog: fullCatalog, model }));
  const products = await read('productos', (model) => buildProductsRequest({ pdfBase64, model }));
  return { contains, foodList, plan, conversion, products, model: [...new Set(models)].join(', ') };
}
