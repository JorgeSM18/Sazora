// Iconos de trazo redondo 1.75 en retícula de 24, mismo lenguaje que el logo.

const PATHS = {
  inicio: 'M4 11 12 4l8 7M6 9.5V20h12V9.5',
  dieta: 'M7 4h10v16H7zM10 9h4M10 13h4M10 17h2',
  plan: 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4',
  recetas: 'M5 5c3-1.5 5-1.5 7 0v15c-2-1.5-4-1.5-7 0zM12 5c2-1.5 4-1.5 7 0v15c-3-1.5-5-1.5-7 0',
  alimentos: 'M12 7c-4-3-8 0-7 5 1 6 4 8 7 6 3 2 6 0 7-6 1-5-3-8-7-5zM12 7c0-2 1-3 3-4',
  mas: 'M12 5v14M5 12h14',
  arriba: 'm6 14 6-6 6 6',
  abajo: 'm6 10 6 6 6-6',
  borrar: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  check: 'm5 12 5 5 9-10',
  izq: 'm15 5-7 7 7 7',
  der: 'm9 5 7 7-7 7',
  copiar: 'M8 8h11v11H8zM5 16V5h11',
  estrella: 'm12 4 2.4 5 5.6.6-4.2 3.8 1.2 5.6L12 16.2 7 19l1.2-5.6L4 9.6 9.6 9z',
  cerrar: 'M6 6l12 12M18 6 6 18',
  editar: 'M5 19h4L19 9l-4-4L5 15zM13 7l4 4',
  aviso: 'M12 4 3 20h18zM12 10v4M12 17v.5',
  subir: 'M12 15V4M7 9l5-5 5 5M5 15v5h14v-5',
  documento: 'M7 3h7l4 4v14H7zM14 3v4h4M10 13h5M10 17h5',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, filled = false, size = 20 }: { name: IconName; filled?: boolean; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="icon">
      <path d={PATHS[name]} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
