import type { ReactNode } from 'react';
import { reviewItems } from '../domain/review';
import { useStore } from '../state/store';
import { Icon, type IconName } from './components/Icon';
import { Logo } from './components/Logo';
import { href } from './router';
import { useOptionalSession } from './Session';

type NavItem = { to: string; label: string; icon: IconName; sections: string[] };

/** Tareas de cada día. Cada pestaña se marca también en sus subsecciones (Recetas incluye los alimentos). */
const NAV: NavItem[] = [
  { to: 'inicio', label: 'Inicio', icon: 'inicio', sections: ['inicio'] },
  { to: 'plan', label: 'Plan', icon: 'plan', sections: ['plan'] },
  { to: 'dieta', label: 'Mi dieta', icon: 'dieta', sections: ['dieta'] },
  { to: 'recetas', label: 'Recetas', icon: 'recetas', sections: ['recetas', 'alimentos'] },
  { to: 'compra', label: 'Compra', icon: 'compra', sections: ['compra'] },
];

/** Uso ocasional: barra lateral en escritorio; en el móvil, desde Ajustes. */
const SECONDARY: NavItem[] = [
  { to: 'guias', label: 'Documentos', icon: 'documento', sections: ['guias'] },
  { to: 'dudas', label: 'Dudas de la importación', icon: 'aviso', sections: ['dudas'] },
  { to: 'ajustes', label: 'Ajustes', icon: 'perfil', sections: ['ajustes'] },
];

const SAVE_TEXT = { guardado: 'Guardado', guardando: 'Guardando…', error: 'Sin guardar', conflicto: 'Sin guardar' } as const;

/** `bare`: sin menú (primer arranque, cuando aún no hay nada subido). */
export function AppShell({ section, bare = false, children }: { section: string; bare?: boolean; children: ReactNode }) {
  const { data, saveState } = useStore();
  const session = useOptionalSession();
  const pending = reviewItems(data).filter((r) => !r.resolved).length;
  const link = (n: NavItem) => (
    <a key={n.to} href={href(`/${n.to}`)} aria-current={n.sections.includes(section) ? 'page' : undefined}>
      <Icon name={n.icon} />
      <span>{n.label}</span>
      {n.to === 'dudas' && pending > 0 && <span className="badge warn">{pending}</span>}
    </a>
  );
  return (
    <div className={bare ? 'shell bare' : 'shell'}>
      <a className="skip" href="#contenido">Saltar al contenido</a>
      <header className="topbar">
        <a href={href('/inicio')} className="brand" aria-label="Sazora, inicio"><Logo /></a>
        <div className="topbar-right">
          <span className={`save-state ${saveState}`} role="status">{SAVE_TEXT[saveState]}</span>
          {session && bare && (
            <button className="btn small ghost" onClick={() => void session.logout()} title={`Sesión de ${session.user.name}`}>
              Salir<span className="sr-only"> ({session.user.name})</span>
            </button>
          )}
          {!bare && (
            <a className="btn small ghost settings-link" href={href('/ajustes')} aria-current={section === 'ajustes' ? 'page' : undefined}>
              <Icon name="perfil" size={18} /> Ajustes
            </a>
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
          {NAV.map(link)}
          <div className="nav-secondary">{SECONDARY.map(link)}</div>
        </nav>
      )}
      <main id="contenido" className="content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
