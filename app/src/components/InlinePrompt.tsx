import { useState } from 'react';

export default function InlinePrompt({
  initialValue,
  onSubmit,
  onCancel,
  label,
}: {
  initialValue: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  label: string;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <form
      className="inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) onSubmit(value.trim());
      }}
    >
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-label={label}
        autoFocus
      />
      <button type="submit" className="btn" disabled={value.trim().length === 0}>
        Salvar
      </button>
      <button type="button" className="btn btn-plain" onClick={onCancel}>
        Cancelar
      </button>
    </form>
  );
}
