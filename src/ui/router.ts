// Enrutado mínimo por hash (#/ruta/a?x=1): sin dependencias y funciona como archivo estático.

import { useSyncExternalStore } from 'react';

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

export function useRoute() {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  return { segments: path.split('/').filter(Boolean), query: new URLSearchParams(query) };
}

export const navigate = (to: string) => {
  window.location.hash = to;
};

// Siempre desde la raíz: así los enlaces también funcionan desde una dirección desconocida (404).
export const href = (to: string) => `/#${to}`;
