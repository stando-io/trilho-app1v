import { useCallback, useRef, useState } from 'react';
import { ApiError } from './api';
import { storeSecurityPassword } from './securityPassword';

interface PendingAction {
  action: () => Promise<unknown>;
}

function isSecurityMessage(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    (error.status === 400 || error.status === 403) &&
    /senha de segurança/i.test(error.message)
  );
}

function isDeferredSecurityError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 400 && /senha de segurança/i.test(error.message);
}

export interface SecurityGate {
  asking: boolean;
  message: string;
  confirm: (password: string) => Promise<void>;
  cancel: () => void;
  guarded: <T>(action: () => Promise<T>) => Promise<{ ok: boolean; value?: T }>;
}

export function useSecurityGate(onError: (message: string) => void): SecurityGate {
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState('');
  const pending = useRef<PendingAction | null>(null);

  const cancel = useCallback(() => {
    pending.current = null;
    setAsking(false);
    setMessage('');
  }, []);

  const confirm = useCallback(
    async (password: string) => {
      storeSecurityPassword(password);
      const entry = pending.current;
      pending.current = null;
      setAsking(false);
      setMessage('');
      if (!entry) {
        storeSecurityPassword(null);
        return;
      }
      try {
        await entry.action();
      } catch (error) {
        if (isSecurityMessage(error)) {
          pending.current = entry;
          setMessage(error.message);
          setAsking(true);
          return;
        }
        if (error instanceof ApiError) {
          onError(error.message);
          return;
        }
        throw error;
      } finally {
        storeSecurityPassword(null);
      }
    },
    [onError],
  );

  const guarded = useCallback(
    async <T,>(action: () => Promise<T>): Promise<{ ok: boolean; value?: T }> => {
      try {
        const value = await action();
        return { ok: true, value };
      } catch (error) {
        if (isDeferredSecurityError(error)) {
          pending.current = { action };
          setMessage(error.message);
          setAsking(true);
          return { ok: false };
        }
        if (error instanceof ApiError) {
          onError(error.message);
          return { ok: false };
        }
        throw error;
      }
    },
    [onError],
  );

  return { asking, message, confirm, cancel, guarded };
}
