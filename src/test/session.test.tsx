import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionGate } from '../ui/Session';

type Handler = (url: string, init?: RequestInit) => [number, unknown];

function server(handler: Handler) {
  const calls: { url: string; body?: unknown }[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const [status, body] = handler(url, init);
    return new Response(JSON.stringify(body), { status });
  });
  return calls;
}

const gate = () => render(<SessionGate>{(user) => <p>Hola, {user.name}</p>}</SessionGate>);

afterEach(() => vi.unstubAllGlobals());

describe('acceso', () => {
  it('sin registro activado no ofrece crear cuenta', async () => {
    server((url) => (url === '/api/registro' ? [200, { enabled: false }] : [401, {}]));
    gate();
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument();
    expect(await screen.findByText(/Pide que te lo creen/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Crear cuenta' })).not.toBeInTheDocument();
  });

  it('crea una cuenta con código de invitación y entra', async () => {
    const user = userEvent.setup();
    const calls = server((url, init) => {
      if (url === '/api/registro' && init?.method === 'POST') return [201, { user: { id: 7, username: 'marta', name: 'Marta' } }];
      if (url === '/api/registro') return [200, { enabled: true }];
      return [401, {}];
    });
    gate();
    await user.click(await screen.findByRole('button', { name: 'Crear cuenta' }));
    expect(screen.getByRole('heading', { name: 'Crear cuenta' })).toBeInTheDocument();

    // Validación antes de enviar.
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(screen.getByText('Necesitas el código de invitación.')).toBeInTheDocument();
    expect(calls.some((c) => c.body)).toBe(false);

    await user.type(screen.getByLabelText('Tu nombre'), 'Marta');
    await user.type(screen.getByLabelText('Usuario'), 'marta');
    await user.type(screen.getByLabelText('Contraseña'), 'contraseña-larga');
    await user.type(screen.getByLabelText('Repite la contraseña'), 'contraseña-otra');
    await user.type(screen.getByLabelText('Código de invitación'), 'codigo-123');
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(screen.getByText('Las contraseñas no coinciden.')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Repite la contraseña'));
    await user.type(screen.getByLabelText('Repite la contraseña'), 'contraseña-larga');
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(await screen.findByText('Hola, Marta')).toBeInTheDocument();
    expect(calls.find((c) => c.body)!.body).toEqual({ username: 'marta', name: 'Marta', password: 'contraseña-larga', code: 'codigo-123' });
  });

  it('muestra el error del servidor (código incorrecto)', async () => {
    const user = userEvent.setup();
    server((url, init) => {
      if (url === '/api/registro' && init?.method === 'POST') return [403, { error: 'El código de invitación no es correcto.' }];
      if (url === '/api/registro') return [200, { enabled: true }];
      return [401, {}];
    });
    gate();
    await user.click(await screen.findByRole('button', { name: 'Crear cuenta' }));
    await user.type(screen.getByLabelText('Tu nombre'), 'X');
    await user.type(screen.getByLabelText('Usuario'), 'xx');
    await user.type(screen.getByLabelText('Contraseña'), 'contraseña-x');
    await user.type(screen.getByLabelText('Repite la contraseña'), 'contraseña-x');
    await user.type(screen.getByLabelText('Código de invitación'), 'mal');
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(await screen.findByText('El código de invitación no es correcto.')).toBeInTheDocument();
  });
});
