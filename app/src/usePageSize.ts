import { useCallback, useState } from 'react';

export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

const DEFAULT_PAGE_SIZE = 10;
const STORAGE_PREFIX = 'pagesize:';

function readPageSize(key: string): number {
  try {
    const stored = window.localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    const parsed = Number(stored);
    if (PAGE_SIZE_OPTIONS.includes(parsed as (typeof PAGE_SIZE_OPTIONS)[number])) return parsed;
  } catch {
    // armazenamento indisponivel: mantem o padrao
  }
  return DEFAULT_PAGE_SIZE;
}

function writePageSize(key: string, size: number): void {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, String(size));
  } catch {
    // armazenamento indisponivel: a escolha vale so nesta sessao
  }
}

export function usePageSize(key: string): [number, (size: number) => void] {
  const [size, setSize] = useState(() => readPageSize(key));

  const update = useCallback(
    (next: number) => {
      if (!PAGE_SIZE_OPTIONS.includes(next as (typeof PAGE_SIZE_OPTIONS)[number])) return;
      setSize(next);
      writePageSize(key, next);
    },
    [key],
  );

  return [size, update];
}
