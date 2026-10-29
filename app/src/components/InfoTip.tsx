import { useEffect, useRef, useState } from 'react';

type InfoTipProps = {
  text: string;
  label?: string;
};

export function InfoTip({ text, label = 'Informações sobre o painel' }: InfoTipProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      const wrapper = wrapperRef.current;
      if (wrapper && !wrapper.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  return (
    <span
      className="panel-info"
      ref={wrapperRef}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="panel-info-icon"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        i
      </button>
      {open && (
        <span className="panel-info-bubble" role="tooltip">
          {text}
        </span>
      )}
    </span>
  );
}
