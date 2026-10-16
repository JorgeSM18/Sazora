// Sesión del usuario: comprueba si hay sesión, muestra el acceso y permite salir.
// Los usuarios se crean en el servidor (npm run usuario); no hay registro público.

import { cloneElement, createContext, useCallback, useContext, useEffect, useState, type FormEvent, type InputHTMLAttributes, type ReactElement, type ReactNode } from 'react';
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
  if (state.status === 'anon') return <AccessScreen expired={state.expired} onLogin={(user) => setState({ status: 'in', user })} />;

  return <SessionContext.Provider value={{ user: state.user, logout }}>{children(state.user, lost)}</SessionContext.Provider>;
}

/** POST JSON a la API. Devuelve el usuario o lanza un error con el mensaje del servidor. */
async function postForUser(url: string, body: object): Promise<User> {
  let r: Response;
  try {
    r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('No se puede conectar con el servidor.');
  }
  const data = (await r.json().catch(() => ({}))) as { user?: User; error?: string };
  if (!r.ok || !data.user) throw new Error(data.error ?? 'Algo ha fallado. Inténtalo de nuevo.');
  return data.user;
}

function AccessScreen({ onLogin, expired }: { onLogin: (u: User) => void; expired?: boolean }) {
  const [mode, setMode] = useState<'entrar' | 'registro'>('entrar');
  const [canRegister, setCanRegister] = useState(false);
  useEffect(() => {
    fetch('/api/registro', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((b: { enabled?: boolean }) => setCanRegister(!!b.enabled))
      .catch(() => setCanRegister(false));
  }, []);

  return (
    <main className="login">
      {mode === 'entrar' ? (
        <LoginForm expired={expired} onLogin={onLogin} footer={
          canRegister
            ? <p className="small">¿Aún no tienes cuenta? <button type="button" className="link-btn" onClick={() => setMode('registro')}>Crear cuenta</button></p>
            : <p className="muted small">¿No tienes usuario? Pide que te lo creen en el servidor de Sazora.</p>
        } />
      ) : (
        <RegisterForm onLogin={onLogin} onBack={() => setMode('entrar')} />
      )}
    </main>
  );
}

function LoginForm({ onLogin, expired, footer }: { onLogin: (u: User) => void; expired?: boolean; footer: ReactNode }) {
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
      onLogin(await postForUser('/api/sesion', { username: username.trim(), password }));
    } catch (err) {
      setError((err as Error).message);
      setPassword('');
    } finally {
      setSending(false);
    }
  }

  return (
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
      {footer}
    </form>
  );
}

const USERNAME = /^[a-z0-9._-]{2,32}$/i;

function RegisterForm({ onLogin, onBack }: { onLogin: (u: User) => void; onBack: () => void }) {
  const [f, setF] = useState({ username: '', name: '', password: '', repeat: '', code: '' });
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const errors = {
    username: USERNAME.test(f.username.trim()) ? null : 'Entre 2 y 32 caracteres: letras sin tildes, números, punto o guion.',
    name: f.name.trim() ? null : 'Escribe cómo quieres que te llamemos.',
    password: f.password.length >= 8 ? null : 'Mínimo 8 caracteres.',
    repeat: f.repeat === f.password ? null : 'Las contraseñas no coinciden.',
    code: f.code.trim() ? null : 'Necesitas el código de invitación.',
  };
  const show = (k: keyof typeof errors) => submitted && errors[k];
  // El error va fuera de la etiqueta (enlazado con aria-describedby) para no alterar el nombre del campo.
  const field = (k: keyof typeof errors, label: string, input: ReactElement<InputHTMLAttributes<HTMLInputElement>>) => (
    <div className="stack-sm">
      <label className="field">
        <span>{label}</span>
        {cloneElement(input, { "aria-invalid": !!show(k), "aria-describedby": show(k) ? `err-${k}` : undefined })}
      </label>
      {show(k) && <span id={`err-${k}`} className="field-error" role="alert">{errors[k]}</span>}
    </div>
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (Object.values(errors).some(Boolean)) return;
    setSending(true);
    setError(null);
    try {
      onLogin(await postForUser('/api/registro', { username: f.username.trim(), name: f.name.trim(), password: f.password, code: f.code.trim() }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="login-card stack" onSubmit={submit} noValidate>
      <Logo height={30} />
      <h1>Crear cuenta</h1>
      <p className="muted small">Necesitas el código de invitación de quien administra Sazora.</p>
      {error && <p className="note warn" role="alert">{error}</p>}
      {field('name', 'Tu nombre', <input autoComplete="given-name" value={f.name} onChange={set('name')} />)}
      {field('username', 'Usuario', <input autoComplete="username" autoCapitalize="none" spellCheck={false} value={f.username} onChange={set('username')} />)}
      {field('password', 'Contraseña', <input type="password" autoComplete="new-password" value={f.password} onChange={set('password')} />)}
      {field('repeat', 'Repite la contraseña', <input type="password" autoComplete="new-password" value={f.repeat} onChange={set('repeat')} />)}
      {field('code', 'Código de invitación', <input autoComplete="off" autoCapitalize="none" spellCheck={false} value={f.code} onChange={set('code')} />)}
      <button className="btn primary" type="submit" disabled={sending}>{sending ? 'Creando cuenta…' : 'Crear cuenta'}</button>
      <p className="small">¿Ya tienes cuenta? <button type="button" className="link-btn" onClick={onBack}>Entrar</button></p>
    </form>
  );
}
