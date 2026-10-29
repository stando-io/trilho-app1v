import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';

export default function ProjectPicker() {
  const { user } = useAuth();
  const navigate = useNavigate();

  if (!user) return null;

  const activeProjects = user.projects.filter((project) => project.is_active);

  return (
    <div className="center-page">
      <div className="notice">
        <h1>Escolha um projeto</h1>
        <p>Seu perfil mostra apenas o Dashboard. Selecione o projeto que deseja acompanhar.</p>
        <div className="project-list">
          {activeProjects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => navigate(`/dashboard?proj=${project.id}`)}
            >
              {project.name}
              {project.status === 'Rascunho' && (
                <span className="pill pill-warn">RASCUNHO</span>
              )}
              {project.status === 'Concluído' && (
                <span className="pill pill-success">CONCLUÍDO</span>
              )}
            </button>
          ))}
        </div>
        {activeProjects.length === 0 && (
          <p className="muted">Nenhum projeto ativo disponível para você.</p>
        )}
      </div>
    </div>
  );
}
