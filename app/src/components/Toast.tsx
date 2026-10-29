import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

type ToastKind = 'success' | 'error';

interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
}

interface ToastApi {
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
}

const DURATION_MS = 5000;
const EXIT_MS = 260;

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast precisa estar dentro de ToastProvider');
  return value;
}

function SuccessIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M15 9l-6 6M9 9l6 6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const [closing, setClosing] = useState(false);
  const timers = useRef<{ dismiss: number | null; exit: number | null }>({
    dismiss: null,
    exit: null,
  });

  const clearTimers = useCallback(() => {
    if (timers.current.dismiss !== null) {
      window.clearTimeout(timers.current.dismiss);
      timers.current.dismiss = null;
    }
    if (timers.current.exit !== null) {
      window.clearTimeout(timers.current.exit);
      timers.current.exit = null;
    }
  }, []);

  const close = useCallback(() => {
    if (timers.current.exit !== null) return;
    if (timers.current.dismiss !== null) {
      window.clearTimeout(timers.current.dismiss);
      timers.current.dismiss = null;
    }
    setClosing(true);
    timers.current.exit = window.setTimeout(() => {
      setToast(null);
      setClosing(false);
      timers.current.exit = null;
    }, EXIT_MS);
  }, []);

  const show = useCallback(
    (kind: ToastKind, title: string, description?: string) => {
      clearTimers();
      setClosing(false);
      setToast({ id: Date.now(), kind, title, description });
      timers.current.dismiss = window.setTimeout(() => close(), DURATION_MS);
    },
    [clearTimers, close],
  );

  useEffect(() => clearTimers, [clearTimers]);

  const api = useMemo<ToastApi>(
    () => ({
      success: (title, description) => show('success', title, description),
      error: (title, description) => show('error', title, description),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast && (
        <div
          key={toast.id}
          className={`toast toast-${toast.kind}${closing ? ' toast-closing' : ''}`}
          role={toast.kind === 'error' ? 'alert' : 'status'}
          aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
        >
          <span className="toast-icon">
            {toast.kind === 'success' ? <SuccessIcon /> : <ErrorIcon />}
          </span>
          <span className="toast-body">
            <span className="toast-title">{toast.title}</span>
            {toast.description ? <span className="toast-desc">{toast.description}</span> : null}
          </span>
          <button
            type="button"
            className="toast-close"
            aria-label="Fechar notificação"
            onClick={close}
          >
            <CloseIcon />
          </button>
          <span className="toast-progress" />
        </div>
      )}
    </ToastContext.Provider>
  );
}
