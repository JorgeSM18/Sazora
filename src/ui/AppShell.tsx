import type { ReactNode } from 'react';
import { useStore } from '../state/store';
import { Icon, type IconName } from './components/Icon';
import { Logo } from './components/Logo';
import { href } from './router';
import { useOptionalSession } from './Session';

/** Cada pestaña se marca también en sus subsecciones (Documentos incluye las guías; Mi dieta, los alimentos). */
const NAV: { to: string; label: string; short?: string; icon: IconName; sections: string[] }[] = [
  { to: 'inicio', label: 'Inicio', icon: 'inicio', sections: ['inicio'] },
  { to: 'plan', label: 'Plan', icon: 'plan', sections: ['plan'] },
  { to: 'compra', label: 'Compra', icon: 'compra', sections: ['compra'] },
  { to: 'recetas', label: 'Recetas', icon: 'recetas', sections: ['recetas'] },
  { to: 'guias', label: 'Documentos', short: 'Docs', icon: 'documento', sections: ['guias'] },
  { to: 'dieta', label: 'Mi dieta', icon: 'dieta', sections: ['dieta', 'alimentos'] },
];

const SAVE_TEXT = { guardado: 'Guardado', guardando: 'Guardando…', error: 'Sin guardar', conflicto: 'Sin guardar' } as const;

/** `bare`: sin menú (primer arranque, cuando aún no hay nada subido). */
export function AppShell({ section, bare = false, children }: { section: string; bare?: boolean; children: ReactNode }) {
  const { data, saveState } = useStore();
  const session = useOptionalSession();
  return (
    <div className={bare ? 'shell bare' : 'shell'}>
      <a className="skip" href="#contenido">Saltar al contenido</a>
      <header className="topbar">
        <a href={href('/inicio')} className="brand" aria-label="Sazora, inicio"><Logo /></a>
        <div className="topbar-right">
          {data.diet && <a href={href('/dieta')} className="plan-name">{data.diet.name}</a>}
          <span className={`save-state ${saveState}`} role="status">{SAVE_TEXT[saveState]}</span>
          {session && (
            <button className="btn small ghost" onClick={() => void session.logout()} title={`Sesión de ${session.user.name}`}>
              Salir<span className="sr-only"> ({session.user.name})</span>
            </button>
          )}
        </div>
      </header>
      {saveState === 'conflicto' && (
        <p className="banner error" role="alert">
          Se han guardado cambios desde otro dispositivo. Tus últimos cambios aquí no se han guardado.{' '}
          <button className="btn small" onClick={() => window.location.reload()}>Recargar</button>
        </p>
      )}
      {saveState === 'error' && <p className="banner error" role="alert">No se han podido guardar los últimos cambios. Se reintentará con el próximo cambio; comprueba la conexión.</p>}
      {!bare && (
        <nav className="nav" aria-label="Secciones">
          {NAV.map((n) => (
            <a key={n.to} href={href(`/${n.to}`)} aria-current={n.sections.includes(section) ? 'page' : undefined}>
              <Icon name={n.icon} />
              {n.short ? <><span className="nav-long">{n.label}</span><span className="nav-short" aria-hidden="true">{n.short}</span></> : <span>{n.label}</span>}
            </a>
          ))}
        </nav>
      )}
      <main id="contenido" className="content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
