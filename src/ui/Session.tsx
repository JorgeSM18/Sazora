// Sesión del usuario: comprueba si hay sesión, muestra el acceso y permite salir.
// Los usuarios se crean en el servidor (npm run usuario); no hay registro público.

import { createContext, useCallback, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Loader } from './components/Loader';
import { Logo } from './components/Logo';

export interface User {
  id: number;
  username: string;
  name: string;
}

interface Session {
  user: User;
  logout: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

/** null fuera de SessionGate (p. ej. en pruebas que montan la app directamente). */
export const useOptionalSession = (): Session | null => useContext(SessionContext);

type State = { status: 'checking' } | { status: 'offline' } | { status: 'anon'; expired?: boolean } | { status: 'in'; user: User };

export function SessionGate({ children }: { children: (user: User, onAuthLost: () => void) => ReactNode }) {
  const [state, setState] = useState<State>({ status: 'checking' });

  const check = useCallback(() => {
    setState({ status: 'checking' });
    fetch('/api/sesion', { credentials: 'same-origin' })
      .then(async (r) => {
        if (r.status === 401) return setState({ status: 'anon' });
        if (!r.ok) throw new Error();
        setState({ status: 'in', user: ((await r.json()) as { user: User }).user });
      })
      .catch(() => setState({ status: 'offline' }));
  }, []);
  useEffect(check, [check]);

  const lost = useCallback(() => setState({ status: 'anon', expired: true }), []);
  const logout = useCallback(async () => {
    await fetch('/api/sesion', { method: 'DELETE', credentials: 'same-origin' }).catch(() => {});
    setState({ status: 'anon' });
  }, []);

  if (state.status === 'checking') return <Loader text="Abriendo Sazora…" />;
  if (state.status === 'offline') {
    return (
      <main className="fatal" role="alert">
        <h1>No se puede conectar con Sazora</h1>
        <p>El servidor no responde. Comprueba que estás conectado a la red de casa (o a la VPN) y vuelve a intentarlo.</p>
        <button className="btn" onClick={check}>Reintentar</button>
      </main>
    );
  }
  if (state.status === 'anon') return <LoginScreen expired={state.expired} onLogin={(user) => setState({ status: 'in', user })} />;

  return <SessionContext.Provider value={{ user: state.user, logout }}>{children(state.user, lost)}</SessionContext.Provider>;
}

function LoginScreen({ onLogin, expired }: { onLogin: (u: User) => void; expired?: boolean }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(expired ? 'Tu sesión ha caducado. Vuelve a entrar.' : null);
  const [sending, setSending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return setError('Escribe tu usuario y tu contraseña.');
    setSending(true);
    setError(null);
    try {
      const r = await fetch('/api/sesion', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const body = (await r.json().catch(() => ({}))) as { user?: User; error?: string };
      if (!r.ok || !body.user) throw new Error(body.error ?? 'No se ha podido iniciar sesión.');
      onLogin(body.user);
    } catch (err) {
      setError(err instanceof TypeError ? 'No se puede conectar con el servidor.' : (err as Error).message);
      setPassword('');
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="login">
      <form className="login-card stack" onSubmit={submit} noValidate>
        <Logo height={30} />
        <h1>Entrar</h1>
        {error && <p className="note warn" role="alert">{error}</p>}
        <label className="field">
          <span>Usuario</span>
          <input autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="field">
          <span>Contraseña</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button className="btn primary" type="submit" disabled={sending}>{sending ? 'Entrando…' : 'Entrar'}</button>
        <p className="muted small">¿No tienes usuario? Se crea en el servidor de Sazora.</p>
      </form>
    </main>
  );
}
