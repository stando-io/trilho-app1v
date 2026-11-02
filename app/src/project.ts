import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from './auth';

export function useProjectId(): string {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const [storedProjectId, setStoredProjectId] = useState<string>(() => {
    try {
      return localStorage.getItem('trilho.lastProjectId') || '';
    } catch {
      return '';
    }
  });

  const fromParam = searchParams.get('proj');

  useEffect(() => {
    if (fromParam) {
      try {
        localStorage.setItem('trilho.lastProjectId', fromParam);
      } catch {
        // ignore
      }
      setStoredProjectId(fromParam);
      return;
    }
    if (storedProjectId && !fromParam) {
      const next = new URLSearchParams(searchParams);
      next.set('proj', storedProjectId);
      setSearchParams(next, { replace: true });
    }
  }, [fromParam, storedProjectId, searchParams, setSearchParams]);

  if (fromParam) return fromParam;
  if (storedProjectId) return storedProjectId;

  const autoProject =
    user?.projects.find(
      (project) =>
        project.is_active && project.status !== 'Rascunho' && project.status !== 'Concluído',
    )?.id ?? '';
  if (autoProject) {
    try {
      localStorage.setItem('trilho.lastProjectId', autoProject);
    } catch {
      // ignore
    }
  }
  return autoProject;
}
