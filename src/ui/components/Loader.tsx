// Pantalla de carga a página completa, con el símbolo de la marca.

export function Loader({ text }: { text: string }) {
  return (
    <main className="boot" aria-busy="true" aria-live="polite">
      <svg className="boot-mark" viewBox="10 0 32 46" aria-hidden="true">
        <path d="M30.93 12A8 8 0 1 0 24 24a8 8 0 1 1-6.93 12" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
        <circle className="boot-dot" cx="35.5" cy="5.5" r="3.5" fill="currentColor" />
      </svg>
      <p className="muted">{text}</p>
    </main>
  );
}
