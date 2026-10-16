// Cantidad editable en línea. Confirma al salir del campo o con Enter; nunca guarda un valor inválido.

import { useId, useState } from 'react';
import { parseDecimal, validateQuantity } from '../../domain/validation';

export function QuantityEditor({ value, unitLabel, label, onCommit }: { value: number; unitLabel: string; label: string; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const commit = () => {
    const err = validateQuantity(text);
    setError(err);
    const n = parseDecimal(text);
    if (!err && n !== null && n !== value) onCommit(n);
  };

  return (
    <span className="qty">
      <input
        aria-label={label}
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.blur())}
        aria-invalid={!!error}
        aria-describedby={error ? id : undefined}
      />
      <span className="qty-unit">{unitLabel}</span>
      {error && <span id={id} className="field-error" role="alert">{error}</span>}
    </span>
  );
}
