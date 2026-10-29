import { useEffect } from 'react';

interface ImageLightboxProps {
  url: string;
  alt: string;
  onClose: () => void;
}

export default function ImageLightbox({ url, alt, onClose }: ImageLightboxProps) {
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      className="lightbox-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
    >
      <figure className="lightbox-figure" onClick={(event) => event.stopPropagation()}>
        <img src={url} alt={alt} />
        <figcaption>{alt}</figcaption>
      </figure>
      <button
        type="button"
        className="lightbox-close"
        aria-label="Fechar visualização"
        onClick={onClose}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
