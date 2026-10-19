// Diálogo nativo (<dialog>): foco atrapado, Escape y fondo inerte sin dependencias.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

export function Modal({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    // jsdom no implementa showModal: se recurre al atributo.
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    }
  }, [open]);
  if (!open) return null;
  // En <body>: un diálogo abierto desde un formulario (p. ej. añadir ingrediente a una receta) no puede quedar
  // dentro de él, o sus botones envían ese formulario y el navegador recarga la página.
  return createPortal(
    <dialog ref={ref} className="modal" aria-label={title} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <header className="modal-head">
        <h2>{title}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar"><Icon name="cerrar" /></button>
      </header>
      <div className="modal-body">{children}</div>
    </dialog>,
    document.body,
  );
}

/** Botón que pide confirmación antes de una acción destructiva. */
export function ConfirmButton({
  children, title, message, confirmLabel = 'Eliminar', onConfirm, className = 'btn ghost danger', ariaLabel,
}: { children: ReactNode; title: string; message: ReactNode; confirmLabel?: string; onConfirm: () => void; className?: string; ariaLabel?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={className} onClick={() => setOpen(true)} aria-label={ariaLabel}>{children}</button>
      <Modal title={title} open={open} onClose={() => setOpen(false)}>
        <p>{message}</p>
        <div className="row end">
          <button className="btn ghost" onClick={() => setOpen(false)}>Cancelar</button>
          <button className="btn danger" onClick={() => { setOpen(false); onConfirm(); }}>{confirmLabel}</button>
        </div>
      </Modal>
    </>
  );
}
