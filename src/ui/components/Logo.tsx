// Logotipo [S]azora (brand/logo/sazora-horizontal-color.svg) con colores de los tokens.

export function Logo({ height = 22 }: { height?: number }) {
  return (
    <svg viewBox="0 -4 205 37" height={height} role="img" aria-label="Sazora" className="logo">
      <path d="M16.63 6.25A6.5 6.5 0 1 0 11 16a6.5 6.5 0 1 1-5.63 9.75" fill="none" stroke="var(--color-brand)" strokeWidth="6" strokeLinecap="round" />
      <circle cx="20.9" cy="0.1" r="3.2" fill="var(--color-brand)" />
      <g fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="45" cy="16" r="13" />
        <path d="M58 3v26M73 3h24L73 29h24" />
        <circle cx="120" cy="16" r="13" />
        <path d="M147 3v26m0-13c0-8 5-13 13-13h4" />
        <circle cx="187" cy="16" r="13" />
        <path d="M200 3v26" />
      </g>
    </svg>
  );
}
