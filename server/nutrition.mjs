// Datos nutricionales (por 100 g) de fuentes abiertas y gratuitas, sin clave:
// BEDCA (base española de composición de alimentos) para genéricos y Open Food Facts para productos de marca.
// La IA solo elige qué entrada corresponde a cada alimento; los valores se copian de la fuente, nunca del modelo.
// Cada resultado (también "no encontrado") se guarda en la caché del servidor: no se busca dos veces lo mismo,
// ni entre usuarios que comparten lista.

const BEDCA_URL = 'https://www.bedca.net/bdpub/procquery.php';
const OFF_URL = 'https://search.openfoodfacts.org/search';
const USER_AGENT = 'Sazora/0.1';
const DAY = 86_400_000;
/** Lo no encontrado se vuelve a intentar pasado este tiempo. */
const NOT_FOUND_TTL = 30 * DAY;
const BEDCA_LIST_TTL = 90 * DAY;
/** Componentes de BEDCA: energía (kJ), proteína, hidratos y grasa. */
const BEDCA_COMPONENTS = { 409: 'kcal', 416: 'protein', 53: 'carbs', 410: 'fat' };

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
export const cacheKey = (f) => `nutricion:${norm(f.name)}|${norm(f.brand)}|${norm(f.state)}`;
const unescapeXml = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const round1 = (n) => Math.round(n * 10) / 10;
const numOrNull = (v) => (v !== '' && v != null && Number.isFinite(Number(v)) ? Number(v) : null);

const bedcaQuery = (level, attributes, field, value) =>
  `<?xml version="1.0" encoding="utf-8"?><foodquery><type level="${level}"/><selection>${attributes.map((a) => `<atribute name="${a}"/>`).join('')}</selection>` +
  `<condition><cond1><atribute1 name="${field}"/></cond1><relation type="EQUAL"/><cond3>${value}</cond3></condition></foodquery>`;

async function bedcaPost(xml, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(BEDCA_URL, { method: 'POST', headers: { 'content-type': 'text/xml', 'user-agent': USER_AGENT }, body: xml, signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    throw new Error(`No se pudo consultar BEDCA (${e.code ?? e.name}). Inténtalo de nuevo más tarde.`);
  }
  if (!res.ok) throw new Error(`BEDCA respondió con un error (${res.status}). Inténtalo de nuevo más tarde.`);
  return res.text();
}

/** [{ id, name }] de todos los alimentos de BEDCA. */
export function parseBedcaList(xml) {
  return [...xml.matchAll(/<f_id>(\d+)<\/f_id>\s*<f_ori_name>([^<]*)</g)].map((m) => ({ id: m[1], name: unescapeXml(m[2]).trim() }));
}

/** { kcal, protein, carbs, fat } por 100 g de porción comestible; null lo que BEDCA no da. La energía viene en kJ. */
export function parseBedcaValues(xml) {
  const values = { kcal: null, protein: null, carbs: null, fat: null };
  for (const [, block] of xml.matchAll(/<foodvalue>(.*?)<\/foodvalue>/gs)) {
    const tag = (t) => block.match(new RegExp(`<${t}>([^<]*)</${t}>`))?.[1]?.trim() ?? '';
    const key = BEDCA_COMPONENTS[tag('c_id')];
    const n = numOrNull(tag('best_location'));
    if (!key || n === null) continue;
    values[key] = key === 'kcal' ? (/kj/i.test(tag('v_unit')) ? round1(n / 4.184) : n) : n;
  }
  return values;
}

/** Productos de Open Food Facts que podrían ser el alimento: [{ code, name, values }]. */
async function offSearch(food, fetchImpl) {
  const clean = (s) => String(s ?? '').replace(/\([^)]*\)/g, ' ').replace(/[^\p{L}\p{N}%]+/gu, ' ').trim();
  const search = async (q) => {
    const url = `${OFF_URL}?${new URLSearchParams({ q, page_size: '6', langs: 'es', fields: 'code,product_name,brands,nutriments' })}`;
    const res = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Open Food Facts ${res.status}`);
    return (await res.json()).hits ?? [];
  };
  let hits = await search(`${clean(food.name)} ${clean(food.brand)}`.trim());
  if (!hits.length) hits = await search(clean(food.name)); // la marca de la lista suele ser el supermercado, no la del envase
  return hits
    .map((h) => {
      const n = h.nutriments ?? {};
      const values = { kcal: numOrNull(n['energy-kcal_100g']), protein: numOrNull(n.proteins_100g), carbs: numOrNull(n.carbohydrates_100g), fat: numOrNull(n.fat_100g) };
      return { code: String(h.code ?? ''), name: [h.product_name, [].concat(h.brands ?? []).join(', ')].filter(Boolean).join(' · '), values };
    })
    .filter((h) => /^\d+$/.test(h.code) && h.name && Object.values(h.values).some((v) => v !== null));
}

export const MATCH_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'El id del alimento tal como se ha dado.' },
          match: { type: ['string', 'null'], description: '"bedca:<id>" o "off:<código>" de la entrada que es ese mismo alimento; null si ninguna lo es claramente.' },
          note: { type: ['string', 'null'], description: 'Solo si la entrada no es idéntica (otra variedad, otro estado, con piel…): en qué se diferencia.' },
        },
        required: ['id', 'match', 'note'],
      },
    },
  },
  required: ['items'],
};

const MATCH_INSTRUCTIONS = `Emparejas alimentos de la lista de una nutricionista con entradas de bases de datos de composición de alimentos. No das valores nutricionales: solo eliges la entrada.
- Para cada alimento elige como mucho UNA entrada: uno de sus candidatos de Open Food Facts ("off:<código>") si es ese mismo producto, o una fila de la tabla BEDCA ("bedca:<id>") si es un alimento genérico.
- Tiene que ser el mismo alimento y en el mismo estado: [crudo] → entrada en crudo; [cocido] → hervido o cocido; [listo] → tal como se compra o se come. Ten en cuenta sinónimos ("papa/patata", "boniato/batata").
- Candidatos de Open Food Facts: solo si es ese producto y de esa marca, o de la marca propia del supermercado indicado (Mercadona → Hacendado, Lidl → Milbona…). Un producto parecido de otra marca no vale: match = null.
- Otra especie, otro corte u otra variedad de composición distinta no es el mismo alimento (pollo no es pavo, plátano macho no es plátano, pechuga sin piel no es con piel): match = null.
- Si ninguna entrada es claramente el mismo alimento, o el nombre agrupa alimentos muy distintos entre sí, match = null. Es mejor no emparejar que emparejar mal.
- note = null si la entrada es el mismo alimento. Úsala solo para avisar de una diferencia real que la persona deba revisar (p. ej. "BEDCA no distingue integral de blanco").`;

export function buildMatchRequest({ foods, candidates, bedca, model }) {
  const lines = foods.flatMap((f) => [
    `${f.id}: ${f.name}${f.brand ? ` (${f.brand})` : ''}${f.state ? ` [${f.state}]` : ''}`,
    ...(candidates.get(f.id) ?? []).map((c) => `  off:${c.code}: ${c.name}`),
  ]);
  return {
    model,
    system_instruction: MATCH_INSTRUCTIONS,
    input: [{ type: 'text', text: `TABLA BEDCA (id: nombre):\n${bedca.map((b) => `${b.id}: ${b.name}`).join('\n')}\n\nALIMENTOS (id: nombre (marca o supermercado) [estado]) y, debajo, sus candidatos de Open Food Facts:\n${lines.join('\n')}` }],
    response_format: { type: 'text', mime_type: 'application/json', schema: MATCH_SCHEMA },
  };
}

/**
 * Comprobación propia, sin IA: el alimento y la entrada elegida deben compartir al menos una palabra
 * (por su raíz de 4 letras). Descarta emparejados absurdos, como "Pechuga de pollo" con "Pavo, crudo".
 */
export function sharesWord(a, b) {
  const stems = (s) => new Set(norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 4).map((w) => w.slice(0, 4)));
  const other = stems(b);
  return [...stems(a)].some((w) => other.has(w));
}

const NOT_FOUND = Object.freeze({ found: false, unit: 'g', kcal: null, protein: null, carbs: null, fat: null, source_name: '', source_url: null, note: null });

/**
 * Crea la búsqueda. `cache`: { get(key, maxAgeMs?), set(key, value) }; `generate(build)`: llama a Gemini y devuelve { result, model }.
 * Devuelve `lookup({ foods: [{ id, name, brand?, state? }] })` → { items, model }, con el mismo formato que revisa la app.
 */
export function createNutritionLookup({ cache, generate, fetchImpl = fetch }) {
  async function bedcaList() {
    const cached = cache.get('bedca:lista', BEDCA_LIST_TTL);
    if (cached) return cached;
    const list = parseBedcaList(await bedcaPost(bedcaQuery(1, ['f_id', 'f_ori_name'], 'f_origen', 'BEDCA'), fetchImpl));
    if (!list.length) throw new Error('BEDCA no ha devuelto su lista de alimentos. Inténtalo de nuevo más tarde.');
    cache.set('bedca:lista', list);
    return list;
  }

  async function bedcaValues(id) {
    const key = `bedca:${id}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const values = parseBedcaValues(await bedcaPost(bedcaQuery(2, ['f_id', 'c_id', 'best_location', 'v_unit'], 'f_id', id), fetchImpl));
    cache.set(key, values);
    return values;
  }

  return async function lookup({ foods }) {
    const results = new Map(); // clave de caché → resultado sin id
    const pending = [];
    for (const f of foods) {
      const key = cacheKey(f);
      if (results.has(key) || pending.some((p) => cacheKey(p) === key)) continue; // repetido en la misma petición
      const hit = cache.get(key);
      if (hit && (hit.found || cache.get(key, NOT_FOUND_TTL))) results.set(key, hit);
      else pending.push(f);
    }
    let model = 'caché';
    if (pending.length) {
      const bedca = await bedcaList();
      const candidates = new Map();
      const unreliable = new Set(); // una fuente falló: su "no encontrado" no se guarda
      for (const f of pending) {
        if (!f.brand) continue;
        try {
          candidates.set(f.id, await offSearch(f, fetchImpl));
        } catch {
          unreliable.add(f.id);
        }
      }
      const r = await generate((m) => buildMatchRequest({ foods: pending, candidates, bedca, model: m }));
      model = r.model;
      const matches = new Map((Array.isArray(r.result?.items) ? r.result.items : []).map((i) => [String(i?.id), i]));
      const bedcaById = new Map(bedca.map((b) => [b.id, b]));
      for (const f of pending) {
        const m = matches.get(f.id);
        const [source, ref] = String(m?.match ?? '').split(':');
        let item = NOT_FOUND;
        try {
          const named = (x) => (x && sharesWord(f.name, x.name) ? x : undefined);
          const b = source === 'bedca' && named(bedcaById.get(ref));
          const o = source === 'off' && named((candidates.get(f.id) ?? []).find((c) => c.code === ref));
          const entry = b
            ? { values: await bedcaValues(b.id), source_name: `BEDCA: ${b.name}`, source_url: 'https://www.bedca.net/bdpub/', generic: !!f.brand }
            : o && { values: o.values, source_name: `Open Food Facts: ${o.name}`, source_url: `https://world.openfoodfacts.org/product/${o.code}` };
          if (entry && Object.values(entry.values).some((v) => v !== null)) {
            const note = [entry.generic && 'Valor genérico de BEDCA, no del producto de esa marca', typeof m.note === 'string' && m.note.trim().slice(0, 200)].filter(Boolean).join(' · ');
            item = { found: true, unit: 'g', ...entry.values, source_name: entry.source_name, source_url: entry.source_url, note: note || null };
          }
        } catch {
          unreliable.add(f.id);
        }
        if (item.found || !unreliable.has(f.id)) cache.set(cacheKey(f), item);
        results.set(cacheKey(f), item);
      }
    }
    return { items: foods.map((f) => ({ id: f.id, ...results.get(cacheKey(f)) })), model };
  };
}
