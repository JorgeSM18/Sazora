import type { Origin, Verification } from '../../domain/types';

const STATUS: Record<Verification, { text: string; cls: string }> = {
  verificado: { text: 'Verificado', cls: 'ok' },
  pendiente: { text: 'Pendiente de revisión', cls: 'warn' },
};

export const StatusBadge = ({ status }: { status: Verification }) => (
  <span className={`badge ${STATUS[status].cls}`}>{STATUS[status].text}</span>
);

const ORIGIN: Record<Origin, string> = {
  documento: 'De tu pauta',
  usuario: 'Propia',
};

export const OriginBadge = ({ origin }: { origin: Origin }) => (
  <span className={`badge ${origin === 'documento' ? 'pauta' : ''}`}>{ORIGIN[origin]}</span>
);
