// Página no encontrada. También la usan las fichas cuya receta o alimento ya no existe.

import { useEffect, useRef } from 'react';
import { href } from '../router';

interface Props {
  title?: string;
  message?: string;
  back?: { to: string; label: string };
}

export function NotFound({
  title = 'Esta página no está en el menú',
  message = 'La dirección no existe o ha cambiado. Puede que vinieras de un enlace antiguo.',
  back,
}: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  // Lleva el foco al título para que los lectores de pantalla anuncien el error.
  useEffect(() => heading.current?.focus(), []);

  return (
    <section className="not-found" aria-labelledby="h-404">
      <svg className="not-found-mark" viewBox="10 0 32 46" aria-hidden="true">
        <path d="M30.93 12A8 8 0 1 0 24 24a8 8 0 1 1-6.93 12" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
        <circle cx="35.5" cy="5.5" r="3.5" fill="currentColor" />
      </svg>
      <p className="kicker">Error 404</p>
      <h1 id="h-404" ref={heading} tabIndex={-1}>{title}</h1>
      <p className="muted">{message}</p>
      <div className="row wrap center">
        {back && <a className="btn primary" href={href(back.to)}>{back.label}</a>}
        <a className={back ? 'btn' : 'btn primary'} href={href('/inicio')}>Ir al inicio</a>
        <a className="btn ghost" href={href('/plan')}>Abrir el plan de hoy</a>
      </div>
    </section>
  );
}
