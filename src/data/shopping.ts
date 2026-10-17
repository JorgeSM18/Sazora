// Cliente de las listas de la compra compartidas (servidor) con actualizaciones en tiempo real.

export interface Member {
  id: number;
  username: string;
  name: string;
}

export interface ShoppingItem {
  id: string;
  text: string;
  quantity: string;
  category: string;
  checked: boolean;
  addedBy: number | null;
}

export interface ShoppingSnapshot {
  list: { id: string; name: string; ownerId: number; members: Member[] };
  items: ShoppingItem[];
}

export interface ListSummary {
  id: string;
  name: string;
  ownerId: number;
  members: Member[];
  pending: number;
}

export type NewItem = Pick<ShoppingItem, 'text' | 'quantity' | 'category'>;

async function call<T>(method: string, path = '', body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api/listas${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('No se puede conectar con el servidor.');
  }
  const data = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(data.error ?? `Error del servidor (${r.status}).`);
  return data;
}

export const shoppingApi = {
  lists: () => call<{ lists: ListSummary[] }>('GET').then((r) => r.lists),
  create: (name: string, ifNone = false) => call<ShoppingSnapshot>('POST', '', { name, ifNone }),
  get: (id: string) => call<ShoppingSnapshot>('GET', `/${id}`),
  rename: (id: string, name: string) => call<ShoppingSnapshot>('PATCH', `/${id}`, { name }),
  share: (id: string, username: string) => call<ShoppingSnapshot>('POST', `/${id}/miembros`, { username }),
  leave: (id: string) => call<{ ok: true }>('DELETE', `/${id}/miembros/yo`),
  add: (id: string, items: NewItem[]) => call<ShoppingSnapshot>('POST', `/${id}/items`, { items }),
  update: (id: string, itemId: string, patch: Partial<Pick<ShoppingItem, 'text' | 'quantity' | 'checked'>>) => call<ShoppingSnapshot>('PATCH', `/${id}/items/${itemId}`, patch),
  remove: (id: string, itemId: string) => call<ShoppingSnapshot>('DELETE', `/${id}/items/${itemId}`),
  clearChecked: (id: string) => call<ShoppingSnapshot>('POST', `/${id}/limpiar`),

  /** Recibe cada cambio de la lista en directo. Devuelve la función para desconectarse. */
  subscribe(id: string, onSnapshot: (s: ShoppingSnapshot) => void, onStatus: (live: boolean) => void): () => void {
    if (typeof EventSource === 'undefined') {
      onStatus(false);
      return () => {};
    }
    const es = new EventSource(`/api/listas/${id}/eventos`);
    es.addEventListener('lista', (e) => onSnapshot(JSON.parse((e as MessageEvent).data) as ShoppingSnapshot));
    es.onopen = () => onStatus(true);
    es.onerror = () => onStatus(false); // EventSource reintenta solo
    return () => es.close();
  },
};

/** Lista por defecto del usuario: la primera; si no tiene ninguna, la crea. El servidor garantiza que no se duplica. */
export async function defaultListId(): Promise<string> {
  return (await shoppingApi.create('Lista de la compra', true)).list.id;
}

/** Añade a la lista por defecto (desde las guías u otras pantallas). */
export async function addToDefaultList(items: NewItem[]): Promise<void> {
  await shoppingApi.add(await defaultListId(), items);
}
