import { useSearchParams } from 'react-router-dom';
import { useAuth } from './auth';

export function useProjectId(): string {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const fromParam = searchParams.get('proj');
  if (fromParam) return fromParam;
  return (
    user?.projects.find(
      (project) =>
        project.is_active && project.status !== 'Rascunho' && project.status !== 'Concluído',
    )?.id ?? ''
  );
}
