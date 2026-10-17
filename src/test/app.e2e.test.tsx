// Flujos completos sobre la app real (jsdom). Los datos viven en un repositorio en memoria que hace
// de servidor: "cerrar y abrir" es desmontar la app y volver a montarla sobre el mismo repositorio.

import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { StoreProvider } from '../state/store';
import { MemoryRepository } from '../data/repository';
import { emptyData, fixtureData } from '../data/fixtures';
import type { AppData } from '../domain/types';
import { todayISO } from '../ui/format';

let repo: MemoryRepository;

async function open(r: MemoryRepository = repo) {
  render(
    <StoreProvider repo={r} saveDelay={0}>
      <App />
    </StoreProvider>,
  );
  await screen.findByRole('main');
  await act(async () => {}); // termina la carga asíncrona
}

const progressRow = (label: string) =>
  screen.getAllByText(label, { selector: '.progress-label' })[0]!.closest('.progress-row') as HTMLElement;
const mealSection = async (name: string) => (await screen.findByRole('heading', { name })).closest('section')!;
const go = (hash: string) => act(async () => { window.location.hash = hash; });

beforeEach(() => {
  repo = new MemoryRepository(fixtureData());
  window.location.hash = '';
});

describe('con la pauta importada', () => {
  it('abre la pauta directamente', async () => {
    await open();
    expect(screen.getByRole('link', { name: /Plan Nutricional 1\.5/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Comidas' })).toBeInTheDocument();
  });

  it('planifica, registra, ve lo restante y lo conserva al reabrir', async () => {
    const user = userEvent.setup();
    await open();
    await go(`/plan?fecha=${todayISO()}`);

    const almuerzo = await mealSection('Almuerzo');
    await user.click(within(almuerzo).getByRole('button', { name: /Añadir al plan/ }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /Pechuga de pollo con plátano/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Añadir al plan' }));

    expect(progressRow('Prot. magra')).toHaveTextContent('0 comido · 4 previsto · pauta 13');
    await user.click(within(almuerzo).getByRole('button', { name: 'Marcar comido' }));
    const eaten = within(almuerzo).getByLabelText(/Cantidad comida de Pechuga de pollo/);
    await user.clear(eaten);
    await user.type(eaten, '0,5{Enter}');
    expect(progressRow('Prot. magra')).toHaveTextContent('2 comido · 4 previsto');
    expect(progressRow('Prot. magra')).toHaveTextContent('Quedan 11');
    expect(progressRow('Energía')).toHaveTextContent('Sin objetivo configurado');

    // Cerrar y volver a abrir: lo guardado en el "servidor" sigue ahí.
    await act(async () => {});
    cleanup();
    await open();
    await go(`/plan?fecha=${todayISO()}`);
    const again = await mealSection('Almuerzo');
    expect(within(again).getByLabelText(/Cantidad comida de Pechuga de pollo/)).toHaveValue('0.5');
    expect(progressRow('Prot. magra')).toHaveTextContent('Quedan 11');
  });

  it('enlaza las fuentes con el PDF original en su página', async () => {
    const data = fixtureData();
    data.documents = data.documents.map((d) => ({ ...d, file: `/api/documentos/${d.id === 'plan-1-5' ? 'aaaaaaaaaaaaaaaa' : 'bbbbbbbbbbbbbbbb'}.pdf` }));
    await open(new MemoryRepository(data));
    await go('/dieta');
    expect(await screen.findByRole('heading', { name: 'Documentos originales' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Plan Nutricional 1.5, pág. 6' })[0]).toHaveAttribute('href', '/api/documentos/aaaaaaaaaaaaaaaa.pdf#page=6');
  });

  it('muestra la 404 en rutas desconocidas y en fichas que ya no existen', async () => {
    await open();
    for (const route of ['/no-existe', '/plan/extra', '/recetas/abc/borrar', '/dieta/otra']) {
      await go(route);
      expect(await screen.findByRole('heading', { level: 1, name: 'Esta página no está en el menú' }), route).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'Ir al inicio' })).toHaveAttribute('href', '/#/inicio');
    await go('/recetas/receta-borrada');
    expect(await screen.findByRole('heading', { level: 1, name: 'Esta receta ya no está' })).toBeInTheDocument();
    await go('/alimentos/alimento-borrado');
    expect(await screen.findByRole('heading', { level: 1, name: 'Este alimento ya no está' })).toBeInTheDocument();
  });

  it('formulario inválido: no guarda una receta sin nombre ni ingredientes', async () => {
    const user = userEvent.setup();
    await open();
    await go('/recetas/nueva');
    await user.click(await screen.findByRole('button', { name: 'Guardar receta' }));
    expect(screen.getByText('El nombre es obligatorio.')).toBeInTheDocument();
    expect(screen.getByText('Añade al menos un ingrediente.')).toBeInTheDocument();
    expect(repo.saves).toBe(0);
  });
});

// ── Importación ───────────────────────────────────────────────

const P = (o: Record<string, number>) => ({ lacteos: null, vegetales: null, frutas: null, carbohidratos: null, proteinaMagra: null, proteinaSemimagra: null, grasas: null, ...o });
const LIST = {
  title: 'Lista de alimentos', author: null, version: null, doubts: [],
  groups: [
    { group: 'carbohidratos', title: 'Carbohidratos', page: 2, note: null, items: [{ name: 'Arroz', amount: 20, unit: 'g', household: '1/2 taza cocido', units_per_portion: null, unit_label: null, state: 'crudo' }] },
    { group: 'proteinaMagra', title: 'Proteína magra', page: 3, note: null, items: [{ name: 'Pechuga de pollo', amount: 30, unit: 'g', household: null, units_per_portion: null, unit_label: null, state: 'crudo' }] },
  ],
};
const PLAN = {
  plan_name: 'Mi pauta', holder: 'Yo', version: '1',
  meals: [{ name: 'Comida', page: 1, portions: P({ carbohidratos: 2, proteinaMagra: 3 }) }],
  daily_totals: P({ carbohidratos: 2, proteinaMagra: 4 }), daily_totals_page: 1,
  rules: [{ text: 'Las especias no cuentan.', kind: 'libre', page: 2 }], equivalences: [],
  dishes: [{ meal: 'Comida', name: 'Pollo con arroz', page: 2, raw: '120g de pollo y 40g de arroz', ingredients: [
    { label: 'Pollo', catalog_id: 'pechuga-de-pollo', quantity: 120, unit: 'g', not_counted: false },
    { label: 'Arroz', catalog_id: 'arroz', quantity: 40, unit: 'g', not_counted: false },
  ] }],
  doubts: [{ text: 'Una celda se lee mal.', page: 1 }],
};

/** Servidor de importación simulado: el siguiente envío responde con `next`. */
let next: { kind: string; foodList: unknown; plan: unknown; conversion?: unknown; products?: unknown };
let finish: () => void = () => {};
let uploads = 0;
class FakeXHR {
  status = 200; response: unknown = null; responseType = '';
  upload: { onprogress?: (e: unknown) => void; onload?: () => void } = {};
  onload?: () => void; onerror?: () => void; onabort?: () => void;
  open() {} setRequestHeader() {} abort() { this.onabort?.(); }
  send(body: string) {
    expect(JSON.parse(body).pdfBase64).toBeTruthy();
    this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 1 });
    this.upload.onload?.();
    const id = `pdf-${++uploads}`; // el servidor real usa el hash del PDF
    finish = () => { this.response = { ...next, model: 'gemini-test', document: { id, url: '/api/documentos/0123456789abcdef.pdf' } }; this.onload?.(); };
  }
}

describe('empezar de cero', () => {
  const original = globalThis.XMLHttpRequest;
  beforeEach(() => { uploads = 0; globalThis.XMLHttpRequest = FakeXHR as unknown as typeof XMLHttpRequest; });
  afterEach(() => { globalThis.XMLHttpRequest = original; });

  const upload = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.upload(await screen.findByLabelText('PDF de la nutricionista'), new File(['%PDF-1.4 prueba'], 'doc.pdf', { type: 'application/pdf' }));
    expect(await screen.findByText(/Gemini está leyendo el documento/)).toBeInTheDocument();
    await act(async () => finish());
  };

  it('un usuario nuevo ve la bienvenida: primero la lista y después la pauta', async () => {
    const user = userEvent.setup();
    repo = new MemoryRepository(null);
    await open();
    expect(screen.getByRole('heading', { name: 'Empecemos por tus documentos' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Comidas' })).not.toBeInTheDocument();

    // Intentar subir la pauta antes que la lista: se explica el orden y no se guarda nada.
    await user.click(screen.getByRole('link', { name: /Subir la lista de alimentos/ }));
    expect(await screen.findByRole('heading', { name: 'Sube la lista de alimentos' })).toBeInTheDocument();
    next = { kind: 'pauta', foodList: null, plan: PLAN };
    await upload(user);
    expect(await screen.findByText(/todavía no tienes la lista de alimentos/)).toBeInTheDocument();

    // Paso 1: la lista.
    next = { kind: 'lista', foodList: LIST, plan: null };
    await upload(user);
    expect(await screen.findByText(/2 alimentos en 2 tablas/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Guardar lista' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByRole('link', { name: /Subir mi pauta/ })).toBeInTheDocument();
    expect(screen.getByText(/2 alimentos con su porción/)).toBeInTheDocument();

    // Paso 2: la pauta, con sus platos enlazados a la lista.
    await user.click(screen.getByRole('link', { name: /Subir mi pauta/ }));
    expect(await screen.findByRole('heading', { name: 'Sube tu pauta' })).toBeInTheDocument();
    next = { kind: 'pauta', foodList: null, plan: PLAN };
    await upload(user);
    expect(screen.getByText(/no coincide con el total del día en: proteína magra/)).toBeInTheDocument();
    const cell = screen.getByLabelText('Comida, Prot. magra');
    await user.clear(cell);
    await user.type(cell, '4');
    await user.tab();
    expect(screen.getByText('La suma de las comidas coincide con las porciones totales del día.')).toBeInTheDocument();
    expect(screen.queryByText(/Sin enlazar a un alimento/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Usar esta pauta' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Mi pauta' })).toBeInTheDocument();
    await act(async () => {});
    const saved = (await repo.load()) as AppData;
    expect(saved.diet!.meals[0]!.portionTargets).toEqual({ carbohidratos: 2, proteinaMagra: 4 });
    // Subidas: 1 = pauta rechazada, 2 = lista, 3 = pauta.
    expect(saved.diet!.exchangeDocs).toEqual(['pdf-3', 'pdf-2']);
    expect(screen.getByText(/Una celda se lee mal/)).toBeInTheDocument();
  });

  it('un único PDF con lista y pauta completa los dos pasos a la vez', async () => {
    const user = userEvent.setup();
    repo = new MemoryRepository(emptyData());
    await open();
    await user.click(screen.getByRole('link', { name: /Subir la lista de alimentos/ }));
    next = { kind: 'ambos', foodList: LIST, plan: { ...PLAN, daily_totals: P({ carbohidratos: 2, proteinaMagra: 3 }) } };
    await upload(user);
    expect(screen.getByText(/la lista de alimentos y una pauta/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Guardar todo' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Mi pauta' })).toBeInTheDocument();
    await act(async () => {});
    const saved = (await repo.load()) as AppData;
    expect(saved.documents.map((d) => [d.id, d.kind])).toEqual([['pdf-1-lista', 'lista-intercambios'], ['pdf-1-pauta', 'plan']]);
    expect(saved.diet!.exchangeDocs).toEqual(['pdf-1-pauta', 'pdf-1-lista']);
    expect(saved.recipes[0]!.ingredients.every((i) => i.foodId)).toBe(true);
  });

  it('un PDF que no es de la nutricionista no se importa', async () => {
    const user = userEvent.setup();
    repo = new MemoryRepository(null);
    await open();
    await go('/dieta/importar');
    next = { kind: 'otro', foodList: null, plan: null };
    await upload(user);
    expect(await screen.findByText(/no parece un documento de tu nutricionista/)).toBeInTheDocument();
    expect(repo.saves).toBe(0);
  });
});

describe('guías', () => {
  const original = globalThis.XMLHttpRequest;
  beforeEach(() => { uploads = 0; globalThis.XMLHttpRequest = FakeXHR as unknown as typeof XMLHttpRequest; });
  afterEach(() => { globalThis.XMLHttpRequest = original; });

  it('importa crudo a cocido y productos de un PDF y se consultan como guías', async () => {
    const user = userEvent.setup();
    await open();
    await go('/dieta/importar');
    next = {
      kind: 'x', foodList: null, plan: null,
      conversion: {
        title: 'De crudo a cocido', rules: [{ text: 'Con verduras y salsas ligeras, pesa la preparación final.', page: 1 }], notes: [], doubts: [],
        items: [{ names: ['Arroz'], catalog_ids: ['arroz'], section: 'Carbohidratos', group: 'carbohidratos', raw_grams: 20, cooked_min_grams: 50, cooked_max_grams: 50, page: 1 }],
      },
      products: { title: 'Productos', author: null, doubts: [], stores: [{ store: 'Mercadona', products: [{ name: 'Natillas +proteínas', category: 'Postres', amount: 1, unit: 'unidad', unit_label: 'natilla', portions: { proteinaMagra: 1.5, carbohidratos: 1 }, raw: '1 natilla = 1 y 1/2 de proteína + 1 de carbo', page: 12 }] }] },
    };
    await user.upload(await screen.findByLabelText('PDF de la nutricionista'), new File(['%PDF-1.4'], 'guias.pdf', { type: 'application/pdf' }));
    await act(async () => finish());
    expect(await screen.findByText(/la tabla de crudo a cocido y la guía de productos recomendados/)).toBeInTheDocument();
    expect(screen.getByText(/1 alimentos de tu lista tendrán su versión cocida/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Guardar todo' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar' }));

    // Calculadora: 150 g de arroz cocido = 60 g en crudo = 3 porciones.
    await go('/guias/crudo-cocido');
    await user.type(await screen.findByLabelText('Peso cocinado (g)'), '150');
    expect(screen.getByText(/≈/, { selector: '.calc-result' })).toHaveTextContent('≈ 60 g en crudo · 3 carbohidratos');
    expect(screen.getByText(/pesa la preparación final/)).toBeInTheDocument();

    await go('/guias/productos');
    expect(await screen.findByText('1 natilla = 1 carbohidratos + 1,5 proteína magra')).toBeInTheDocument();
    await go('/guias/lista');
    expect(await screen.findByText('Cocido: 50 g cocido = 20 g crudo')).toBeInTheDocument();
  });
});

describe('lista de la compra', () => {
  type Item = { id: string; text: string; quantity: string; category: string; checked: boolean; addedBy: number | null };
  type Snap = { list: { id: string; name: string; ownerId: number; members: { id: number; username: string; name: string }[] }; items: Item[] };
  let snap: Snap;
  let pushes: ((s: Snap) => void)[];

  beforeEach(() => {
    snap = { list: { id: 'l1', name: 'Lista de la compra', ownerId: 1, members: [{ id: 1, username: 'jorge', name: 'Jorge' }] }, items: [] };
    pushes = [];
    let n = 0;
    // Servidor simulado de /api/listas.
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
      if (url === '/api/listas') return json({ lists: [{ ...snap.list, pending: 0 }] });
      if (url.endsWith('/items') && init?.method === 'POST') snap.items.push(...body.items.map((i: Item) => ({ ...i, id: `i${++n}`, checked: false, addedBy: 1 })));
      const item = url.match(/items\/(i\d+)$/)?.[1];
      if (item && init?.method === 'PATCH') snap.items = snap.items.map((i) => (i.id === item ? { ...i, ...body } : i));
      if (url.endsWith('/miembros')) snap.list.members.push({ id: 2, username: body.username, name: 'Pareja' });
      return json(structuredClone(snap));
    });
    // EventSource simulado: guardamos el emisor para "empujar" cambios de la otra persona.
    vi.stubGlobal('EventSource', class {
      listeners: Record<string, (e: MessageEvent) => void> = {};
      onopen?: () => void;
      onerror?: () => void;
      constructor() {
        pushes.push((s) => this.listeners.lista?.({ data: JSON.stringify(s) } as MessageEvent));
        setTimeout(() => this.onopen?.(), 0);
      }
      addEventListener(type: string, fn: (e: MessageEvent) => void) { this.listeners[type] = fn; }
      close() {}
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('añade, marca, comparte y recibe cambios en directo', async () => {
    const user = userEvent.setup();
    await open();
    await go('/compra');
    expect(await screen.findByRole('heading', { level: 1, name: 'Lista de la compra' })).toBeInTheDocument();
    expect(await screen.findByText('En directo')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/Añadir…/), 'Tomates');
    await user.type(screen.getByPlaceholderText('Cantidad'), '1 kg');
    await user.click(screen.getByRole('button', { name: 'Añadir' }));
    expect(await screen.findByText('Tomates')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /Tomates/ }));
    expect(await screen.findByRole('heading', { name: 'Comprado (1)' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Compartir' }));
    await user.type(within(screen.getByRole('dialog')).getByLabelText(/Nombre de usuario/), 'pareja');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Compartir' }));
    expect(await within(screen.getByRole('dialog')).findByText('Compartida con pareja.')).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cerrar' }));

    // La otra persona añade algo: llega por el canal en directo.
    await act(async () => pushes.at(-1)!({ ...structuredClone(snap), items: [...snap.items, { id: 'x', text: 'Pan', quantity: '', category: '', checked: false, addedBy: 2 }] }));
    expect(screen.getByText('Pan')).toBeInTheDocument();
    expect(screen.getByText(/Compartida con .*Pareja/)).toBeInTheDocument();
  });

  it('añade lo planificado, sumado y en crudo', async () => {
    const user = userEvent.setup();
    const data = fixtureData();
    data.plan = [{ id: 'p1', date: todayISO(), mealId: 'almuerzo', order: 0, ref: { kind: 'food', foodId: 'arroz' }, quantity: 2, unit: 'porcion' }];
    await open(new MemoryRepository(data));
    await go('/compra');
    await user.click(await screen.findByRole('button', { name: /Añadir desde el plan/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Arroz')).toBeInTheDocument();
    expect(within(dialog).getByText(/40 g/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Añadir 1 a la lista' }));
    expect(await screen.findByText('Arroz')).toBeInTheDocument();
    expect(snap.items[0]).toMatchObject({ text: 'Arroz', quantity: '40 g', category: 'Carbohidratos' });
  });
});
