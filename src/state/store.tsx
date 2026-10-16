// Estado global: un único AppData por usuario, cargado del servidor y guardado tras cada cambio.
// Toda regla de negocio vive en domain/; aquí solo se aplica y se guarda.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppData, Diet } from '../domain/types';
import { makeContext, type CalcContext } from '../domain/nutrition';
import { emptyData } from '../data/fixtures';
import { AuthError, ConflictError, type Repository } from '../data/repository';
import { Loader } from '../ui/components/Loader';

type LoadState = { status: 'loading' } | { status: 'ready'; data: AppData } | { status: 'error'; message: string };
export type SaveState = 'guardado' | 'guardando' | 'error' | 'conflicto';

interface Store {
  data: AppData;
  update: (fn: (d: AppData) => AppData) => void;
  saveState: SaveState;
}

const StoreContext = createContext<Store | null>(null);

interface Props {
  repo: Repository;
  children: ReactNode;
  /** La sesión ha caducado: volver a la pantalla de acceso. */
  onAuthLost?: () => void;
  /** Espera antes de guardar, para agrupar cambios seguidos. */
  saveDelay?: number;
}

export function StoreProvider({ repo, children, onAuthLost, saveDelay = 400 }: Props) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [saveState, setSaveState] = useState<SaveState>('guardado');
  const pending = useRef<AppData | null>(null);
  const saved = useRef<AppData | null>(null);
  const saving = useRef(false);
  const stopped = useRef(false); // tras un conflicto no se guarda más hasta recargar

  const load = useCallback(() => {
    setState({ status: 'loading' });
    repo.load().then(
      (data) => {
        const d = data ?? emptyData();
        saved.current = d;
        setState({ status: 'ready', data: d });
      },
      (e) => {
        if (e instanceof AuthError) return onAuthLost?.();
        setState({ status: 'error', message: e instanceof Error ? e.message : 'No se pudieron cargar tus datos.' });
      },
    );
  }, [repo, onAuthLost]);

  useEffect(load, [load]);

  const flush = useCallback(async () => {
    if (saving.current || !pending.current || stopped.current) return;
    saving.current = true;
    const data = pending.current;
    pending.current = null;
    setSaveState('guardando');
    try {
      await repo.save(data);
      saved.current = data;
      setSaveState(pending.current ? 'guardando' : 'guardado');
    } catch (e) {
      if (e instanceof ConflictError) {
        stopped.current = true;
        setSaveState('conflicto');
      } else if (e instanceof AuthError) {
        pending.current ??= data;
        onAuthLost?.();
      } else {
        pending.current ??= data; // se reintenta con el próximo cambio
        setSaveState('error');
      }
    } finally {
      saving.current = false;
      if (pending.current && !stopped.current) void flush();
    }
  }, [repo, onAuthLost]);

  // Guarda cada cambio (agrupando los seguidos). No guarda lo recién cargado.
  useEffect(() => {
    if (state.status !== 'ready' || state.data === saved.current) return;
    pending.current = state.data;
    const t = setTimeout(() => void flush(), saveDelay);
    return () => clearTimeout(t);
  }, [state, flush, saveDelay]);

  // Al salir (o cerrar la pestaña) no se pierde lo pendiente.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (pending.current || saving.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      void flush();
    };
  }, [flush]);

  const update = useCallback((fn: (d: AppData) => AppData) => {
    setState((s) => (s.status === 'ready' ? { status: 'ready', data: fn(s.data) } : s));
  }, []);

  if (state.status === 'loading') return <Loader text="Cargando tus datos…" />;
  if (state.status === 'error') {
    return (
      <main className="fatal" role="alert">
        <h1>No se pueden abrir tus datos</h1>
        <p>{state.message}</p>
        <p>No se ha borrado nada. Comprueba la conexión con el servidor y vuelve a intentarlo.</p>
        <button className="btn" onClick={load}>Reintentar</button>
      </main>
    );
  }

  return <StoreContext.Provider value={{ data: state.data, update, saveState }}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error('useStore fuera de StoreProvider');
  return s;
}

/** La pauta importada. Solo para pantallas que se muestran cuando ya existe. */
export function useDiet(): Diet {
  const diet = useStore().data.diet;
  if (!diet) throw new Error('Aún no hay pauta importada.');
  return diet;
}

/** Contexto de cálculo de la pauta (memorizado). */
export function useCalc(): CalcContext {
  const { data } = useStore();
  return useMemo(() => makeContext(data, data.diet ?? undefined), [data]);
}
