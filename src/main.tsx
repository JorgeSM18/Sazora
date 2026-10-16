import { StrictMode, useMemo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '../brand/tokens.css';
import './styles/app.css';
import { App } from './App';
import { StoreProvider } from './state/store';
import { HttpRepository } from './data/repository';
import { SessionGate } from './ui/Session';

/** Los datos de cada usuario viven en el servidor, ligados a su cuenta. */
function UserData({ onAuthLost, children }: { onAuthLost: () => void; children: ReactNode }) {
  const repo = useMemo(() => new HttpRepository(), []);
  return <StoreProvider repo={repo} onAuthLost={onAuthLost}>{children}</StoreProvider>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionGate>
      {(user, onAuthLost) => (
        <UserData key={user.id} onAuthLost={onAuthLost}>
          <App />
        </UserData>
      )}
    </SessionGate>
  </StrictMode>,
);
