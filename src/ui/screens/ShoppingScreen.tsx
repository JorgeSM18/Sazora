// Lista de la compra compartida, en tiempo real con quien la compartas.

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { defaultListId, shoppingApi, type ListSummary, type ShoppingItem, type ShoppingSnapshot } from '../../data/shopping';
import { shoppingFromPlan } from '../../domain/shopping';
import { useCalc, useStore } from '../../state/store';
import { Icon } from '../components/Icon';
import { ConfirmButton, Modal } from '../components/Modal';
import { addDays, todayISO } from '../format';
import { useOptionalSession } from '../Session';

const SAVED = 'sazora:lista-actual';
const remember = (id: string) => {
  try {
    localStorage.setItem(SAVED, id);
  } catch {
    /* almacenamiento no disponible: no pasa nada */
  }
};
const recalled = () => {
  try {
    return localStorage.getItem(SAVED);
  } catch {
    return null;
  }
};

export function ShoppingScreen() {
  const session = useOptionalSession();
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  const [listId, setListId] = useState<string | null>(null);
  const [snap, setSnap] = useState<ShoppingSnapshot | null>(null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<'compartir' | 'plan' | 'nueva' | null>(null);

  const loadLists = useCallback(async (prefer?: string) => {
    try {
      let all = await shoppingApi.lists();
      if (all.length === 0) {
        await defaultListId();
        all = await shoppingApi.lists();
      }
      setLists(all);
      const pick = [prefer, recalled()].find((id) => id && all.some((l) => l.id === id)) ?? all[0]!.id;
      setListId(pick);
      remember(pick);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => void loadLists(), [loadLists]);

  // Tiempo real: cada cambio (de cualquiera de los miembros) llega como una lista completa.
  useEffect(() => {
    if (!listId) return;
    setSnap(null);
    shoppingApi.get(listId).then(setSnap, (e: Error) => setError(e.message));
    return shoppingApi.subscribe(listId, setSnap, setLive);
  }, [listId]);

  /** Aplica el cambio en pantalla al momento y lo confirma con el servidor. */
  const act = useCallback(
    async (optimistic: (s: ShoppingSnapshot) => ShoppingSnapshot, request: () => Promise<ShoppingSnapshot>) => {
      setSnap((s) => (s ? optimistic(s) : s));
      try {
        setSnap(await request());
        setError(null);
      } catch (e) {
        setError((e as Error).message);
        if (listId) shoppingApi.get(listId).then(setSnap, () => {});
      }
    },
    [listId],
  );

  if (error && !snap && !lists) return <ErrorBox message={error} onRetry={() => { setError(null); void loadLists(); }} />;
  if (!snap || !listId) return <p className="muted" role="status">Cargando la lista…</p>;

  const me = session?.user.id;
  const others = snap.list.members.filter((m) => m.id !== me);
  const pending = snap.items.filter((i) => !i.checked);
  const done = snap.items.filter((i) => i.checked);
  const categories = [...new Set(pending.map((i) => i.category || 'Otros'))].sort((a, b) => (a === 'Otros' ? 1 : b === 'Otros' ? -1 : a.localeCompare(b, 'es')));
  const toggle = (item: ShoppingItem) =>
    act((s) => ({ ...s, items: s.items.map((i) => (i.id === item.id ? { ...i, checked: !i.checked } : i)) }), () => shoppingApi.update(listId, item.id, { checked: !item.checked }));
  const remove = (item: ShoppingItem) =>
    act((s) => ({ ...s, items: s.items.filter((i) => i.id !== item.id) }), () => shoppingApi.remove(listId, item.id));

  return (
    <div className="stack-lg shopping">
      <header className="page-head">
        <div className="section-head">
          <h1>{snap.list.name}</h1>
          <span className={`live ${live ? 'on' : ''}`} role="status">{live ? 'En directo' : 'Reconectando…'}</span>
        </div>
        <p className="muted small">
          {others.length ? `Compartida con ${others.map((m) => m.name).join(', ')}. Los cambios se ven al momento.` : 'Solo tú. Compártela para que la otra persona vea lo mismo y marque lo que compra.'}
        </p>
        {lists && lists.length > 1 && (
          <div className="chips" role="group" aria-label="Lista">
            {lists.map((l) => (
              <button key={l.id} className={l.id === listId ? 'chip on' : 'chip'} aria-pressed={l.id === listId} onClick={() => { setListId(l.id); remember(l.id); }}>{l.name}</button>
            ))}
          </div>
        )}
        <div className="row wrap">
          <button className="btn small" onClick={() => setModal('plan')}><Icon name="plan" size={16} /> Añadir desde el plan</button>
          <button className="btn small ghost" onClick={() => setModal('compartir')}>Compartir</button>
          <button className="btn small ghost" onClick={() => setModal('nueva')}><Icon name="mas" size={16} /> Nueva lista</button>
        </div>
      </header>

      {error && <p className="note warn" role="alert">{error}</p>}

      <AddForm onAdd={(text, quantity) => act((s) => s, () => shoppingApi.add(listId, [{ text, quantity, category: '' }]))} />

      {pending.length === 0 && <div className="empty-state"><p>{done.length ? '¡Todo comprado!' : 'La lista está vacía.'}</p></div>}
      {categories.map((c) => (
        <section key={c} aria-labelledby={`h-cat-${c}`}>
          <h2 id={`h-cat-${c}`} className="sub">{c}</h2>
          <ul className="shop-items">
            {pending.filter((i) => (i.category || 'Otros') === c).map((i) => <Row key={i.id} item={i} onToggle={toggle} onRemove={remove} />)}
          </ul>
        </section>
      ))}

      {done.length > 0 && (
        <section aria-labelledby="h-done" className="stack">
          <div className="section-head">
            <h2 id="h-done" className="sub">Comprado ({done.length})</h2>
            <button className="btn small ghost" onClick={() => act((s) => ({ ...s, items: s.items.filter((i) => !i.checked) }), () => shoppingApi.clearChecked(listId))}>Quitar comprados</button>
          </div>
          <ul className="shop-items done">{done.map((i) => <Row key={i.id} item={i} onToggle={toggle} onRemove={remove} />)}</ul>
        </section>
      )}

      <section className="panel stack" aria-label="Opciones de la lista">
        <ConfirmButton
          className="btn small ghost danger"
          title="Salir de la lista"
          confirmLabel="Salir"
          message={others.length ? 'Dejarás de ver esta lista. Las demás personas la conservan.' : 'Eres la única persona en esta lista: se borrará.'}
          onConfirm={async () => {
            try {
              await shoppingApi.leave(listId);
              await loadLists();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Salir de la lista
        </ConfirmButton>
      </section>

      <Modal title="Compartir la lista" open={modal === 'compartir'} onClose={() => setModal(null)}>
        <ShareForm members={snap.list.members} onShare={async (username) => { setSnap(await shoppingApi.share(listId, username)); }} />
      </Modal>
      <Modal title="Añadir desde el plan" open={modal === 'plan'} onClose={() => setModal(null)}>
        <FromPlan onAdd={async (items) => { setSnap(await shoppingApi.add(listId, items)); setModal(null); }} />
      </Modal>
      <Modal title="Nueva lista" open={modal === 'nueva'} onClose={() => setModal(null)}>
        <NewListForm onCreate={async (name) => { const s = await shoppingApi.create(name); setModal(null); await loadLists(s.list.id); }} />
      </Modal>
    </div>
  );
}

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="empty-state" role="alert">
      <p>No se ha podido abrir la lista de la compra: {message}</p>
      <button className="btn" onClick={onRetry}>Reintentar</button>
    </div>
  );
}

function Row({ item, onToggle, onRemove }: { item: ShoppingItem; onToggle: (i: ShoppingItem) => void; onRemove: (i: ShoppingItem) => void }) {
  return (
    <li className="shop-item">
      <label className="shop-check">
        <input type="checkbox" checked={item.checked} onChange={() => onToggle(item)} />
        <span className="shop-text">{item.text}</span>
        {item.quantity && <span className="shop-qty">{item.quantity}</span>}
      </label>
      <button className="icon-btn" onClick={() => onRemove(item)} aria-label={`Quitar ${item.text}`}><Icon name="borrar" /></button>
    </li>
  );
}

function AddForm({ onAdd }: { onAdd: (text: string, quantity: string) => void }) {
  const [text, setText] = useState('');
  const [quantity, setQuantity] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onAdd(text.trim(), quantity.trim());
    setText('');
    setQuantity('');
  };
  return (
    <form className="shop-add" onSubmit={submit}>
      <label className="field grow"><span className="sr-only">Qué hay que comprar</span><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Añadir… (p. ej. tomates)" /></label>
      <label className="field qty-field"><span className="sr-only">Cantidad</span><input value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Cantidad" /></label>
      <button className="btn primary" type="submit" disabled={!text.trim()}>Añadir</button>
    </form>
  );
}

function ShareForm({ members, onShare }: { members: { id: number; name: string; username: string }[]; onShare: (username: string) => Promise<void> }) {
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setOk(null);
        try {
          await onShare(username.trim());
          setOk(`Compartida con ${username.trim()}.`);
          setUsername('');
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <p className="muted small">Personas en esta lista: {members.map((m) => `${m.name} (${m.username})`).join(', ')}.</p>
      <label className="field"><span>Nombre de usuario de la otra persona</span><input autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} /></label>
      {error && <p className="field-error" role="alert">{error}</p>}
      {ok && <p className="ok-text" role="status">{ok}</p>}
      <button className="btn primary" type="submit" disabled={!username.trim()}>Compartir</button>
    </form>
  );
}

function NewListForm({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const [name, setName] = useState('');
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void onCreate(name.trim()); }}>
      <label className="field"><span>Nombre</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="p. ej. Compra semanal, Lidl…" /></label>
      <button className="btn primary" type="submit" disabled={!name.trim()}>Crear</button>
    </form>
  );
}

function FromPlan({ onAdd }: { onAdd: (items: { text: string; quantity: string; category: string }[]) => Promise<void> }) {
  const { data } = useStore();
  const ctx = useCalc();
  const [from, setFrom] = useState(todayISO());
  const [days, setDays] = useState(7);
  const to = addDays(from, days - 1);
  const suggestions = useMemo(() => shoppingFromPlan(data, from, to, ctx), [data, from, to, ctx]);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const chosen = suggestions.filter((s) => !skip.has(s.key));

  return (
    <div className="stack">
      <div className="grid-fields">
        <label className="field"><span>Desde</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field"><span>Días</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>{[1, 3, 5, 7, 14].map((d) => <option key={d} value={d}>{d}</option>)}</select>
        </label>
      </div>
      {suggestions.length === 0 ? (
        <p className="empty">No hay nada planificado en esos días.</p>
      ) : (
        <ul className="pick-list from-plan">
          {suggestions.map((s) => (
            <li key={s.key}>
              <label className="check">
                <input type="checkbox" checked={!skip.has(s.key)} onChange={() => setSkip((cur) => { const n = new Set(cur); if (n.has(s.key)) n.delete(s.key); else n.add(s.key); return n; })} />
                <span><b>{s.text}</b>{s.quantity && ` · ${s.quantity}`} <span className="muted">{s.category}</span></span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">Cantidades en crudo, sumadas para esos días. Lo cocinado se convierte con tu tabla de crudo a cocido.</p>
      <button
        className="btn primary"
        disabled={chosen.length === 0 || sending}
        onClick={async () => {
          setSending(true);
          try {
            await onAdd(chosen.map((s) => ({ text: s.text, quantity: s.quantity, category: s.category })));
          } finally {
            setSending(false);
          }
        }}
      >
        Añadir {chosen.length} a la lista
      </button>
    </div>
  );
}
