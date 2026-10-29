import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { can, useAuth } from '../auth';
import DonutChart, { donutColor, type DonutSlice } from '../components/DonutChart';
import LineChart from '../components/LineChart';
import LoadingOverlay from '../components/LoadingOverlay';
import PaginationFooter from '../components/PaginationFooter';
import ProjectEditModal from '../components/ProjectEditModal';
import ScoreBar from '../components/ScoreBar';
import SecurityPrompt from '../components/SecurityPrompt';
import TableActions from '../components/TableActions';
import { useToast } from '../components/Toast';
import { useProjectId } from '../project';
import { useProjectEvents } from '../realtime';
import type { DashboardData, MeUser, Project } from '../types';
import { usePageSize } from '../usePageSize';
import { useSecurityGate } from '../useSecurityGate';

const RELOAD_EVENTS = new Set([
  'cards_changed',
  'columns_changed',
  'structure_changed',
  'milestones_changed',
]);

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : (parts[0]?.[1] ?? '');
  return (first + last).toUpperCase();
}

function CountBar({ value, max, tone }: { value: number; max: number; tone?: string }) {
  const width = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="bar" aria-label={`${value} de ${max} cards`}>
      <div
        className={`bar-fill${tone ? ` progress-${tone}` : ''}`}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

export default function Dashboard() {
  const projectId = useProjectId();
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [data, setData] = useState<DashboardData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [projectPage, setProjectPage] = useState(1);
  const [projectPageSize, setProjectPageSize] = usePageSize('dashboard:projetos');
  const [editing, setEditing] = useState<Project | null>(null);
  const [concluding, setConcluding] = useState<Project | null>(null);
  const [concludeJustificativa, setConcludeJustificativa] = useState('');
  const [concludeJustError, setConcludeJustError] = useState('');
  const [concludingBusy, setConcludingBusy] = useState(false);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [deleteJustificativa, setDeleteJustificativa] = useState('');
  const [deleteJustError, setDeleteJustError] = useState('');
  const [deletingBusy, setDeletingBusy] = useState(false);
  const gate = useSecurityGate(toast.error);

  const load = useCallback(async () => {
    if (!projectId) {
      setData(null);
      setLoaded(true);
      return;
    }
    try {
      const result = await api<DashboardData>(`/projects/${projectId}/dashboard`);
      setData(result);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao carregar o dashboard');
    } finally {
      setLoaded(true);
    }
  }, [projectId]);

  useEffect(() => {
    setLoaded(false);
    void load();
  }, [load]);

  const handleEvent = useCallback(
    (event: { type: string }) => {
      if (RELOAD_EVENTS.has(event.type)) void load();
    },
    [load],
  );
  useProjectEvents(projectId, handleEvent);

  async function applyContext(userResult: MeUser | null, changedProjectId: string) {
    if (changedProjectId !== projectId) return;
    const current = userResult?.projects.find((project) => project.id === projectId);
    if (current?.is_active) return;
    const next = userResult?.projects.find((project) => project.is_active);
    navigate(next ? `/dashboard?proj=${next.id}` : '/escolher-projeto');
  }

  async function probeSecurity(projectIdToCheck: string) {
    try {
      await api(`/projects/${projectIdToCheck}`, {
        method: 'PATCH',
        body: JSON.stringify({}),
      });
    } catch (err) {
      if (
        err instanceof ApiError &&
        ((err.status === 400 && err.message === 'Nada para atualizar') ||
          (err.status === 409 && err.message === 'Projeto concluído — reabra para editar'))
      ) {
        return;
      }
      throw err;
    }
  }

  function askEdit(project: Project) {
    void gate.guarded(async () => {
      await probeSecurity(project.id);
      setEditing(project);
    });
  }

  function askConclude(project: Project) {
    void gate.guarded(async () => {
      setConcludeJustificativa('');
      setConcludeJustError('');
      setConcluding(project);
    });
  }

  async function confirmConclude() {
    const project = concluding;
    if (!project) return;
    const justification = concludeJustificativa.trim();
    if (justification.length < 3) {
      setConcludeJustError('Informe a justificativa com pelo menos 3 caracteres');
      return;
    }
    setConcludingBusy(true);
    setConcludeJustError('');
    try {
      await api(`/projects/${project.id}/conclude`, {
        method: 'POST',
        body: JSON.stringify({ justificativa: justification }),
      });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao concluir o projeto');
      setConcludingBusy(false);
      setConcluding(null);
      return;
    }
    setConcludingBusy(false);
    setConcluding(null);
    toast.success('Projeto concluído.');
    const me = await refresh();
    await applyContext(me, project.id);
  }

  function askDelete(project: Project) {
    void gate.guarded(async () => {
      setDeleteJustificativa('');
      setDeleteJustError('');
      setDeleting(project);
    });
  }

  async function confirmDelete() {
    const project = deleting;
    if (!project) return;
    const justification = deleteJustificativa.trim();
    if (justification.length < 3) {
      setDeleteJustError('Informe a justificativa com pelo menos 3 caracteres');
      return;
    }
    setDeletingBusy(true);
    try {
      await api(`/projects/${project.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ justificativa: justification }),
      });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao excluir o projeto');
      setDeletingBusy(false);
      return;
    }
    setDeletingBusy(false);
    setDeleting(null);
    toast.success('Projeto excluído.');
    const me = await refresh();
    await applyContext(me, project.id);
  }

  async function handleSaved() {
    const me = await refresh();
    await applyContext(me, editing?.id ?? '');
  }

  const hasAlert = (data?.sector_temperature ?? []).some((sector) => sector.overdue_cards > 0);
  const statusSlices: DonutSlice[] = (data?.by_status ?? []).map((status, index) => ({
    label: status.name,
    value: status.total,
    color: donutColor(index),
  }));
  const statusTotal = statusSlices.reduce((sum, slice) => sum + slice.value, 0);

  const projects = user?.projects ?? [];
  const projectPages = Math.max(1, Math.ceil(projects.length / projectPageSize));
  const projectPageSafe = Math.min(projectPage, projectPages);
  const visibleProjects = projects.slice(
    (projectPageSafe - 1) * projectPageSize,
    projectPageSafe * projectPageSize,
  );
  const canEditProject = can(user, 'dashboard.projetos_recentes.editar');
  const canDeleteProject = can(user, 'dashboard.projetos_recentes.excluir');
  const canSeeReports = can(user, 'dashboard.ver_relatorio_detalhado');

  if (!projectId) {
    return (
      <div>
        <h1>Dashboard</h1>
        <div className="panel">
          <h2>Nenhum projeto selecionado</h2>
          <p>Selecione ou crie um projeto para ver os indicadores.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {!loaded ? (
        <div className="panel">
          <LoadingOverlay />
        </div>
      ) : !data ? (
        <div className="panel">
          <p>Não foi possível carregar os dados do projeto.</p>
        </div>
      ) : (
        <>
          <section className="panel dash-progress-card">
            <div className="panel-head">
              <div className="panel-title">
                <h2>Progresso geral</h2>
                <p className="hint">Evolução do projeto atual</p>
              </div>
              {canSeeReports && (
                <Link className="dash-hero-cta" to={`/relatorios?proj=${projectId}`}>
                  <span className="dash-hero-cta-icon" aria-hidden="true">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="3 17 9 11 13 15 21 7" />
                      <polyline points="15 7 21 7 21 13" />
                    </svg>
                  </span>
                  <span>Ver relatório</span>
                </Link>
              )}
            </div>

            <div className="dash-progress-summary">
              <strong className="dash-progress-number">
                {data.indicators.completion_percent ?? 0}%
              </strong>
              <span className="dash-progress-count">
                {data.indicators.done_cards} de {data.indicators.total_cards} concluídas
              </span>
            </div>

            <div
              className="dash-hero-bar"
              role="progressbar"
              aria-label="Progresso geral"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={data.indicators.completion_percent ?? 0}
            >
              <div
                className="dash-hero-bar-fill"
                style={{
                  width: `${data.indicators.completion_percent ?? 0}%`,
                  backgroundSize:
                    (data.indicators.completion_percent ?? 0) > 0
                      ? `${10000 / (data.indicators.completion_percent ?? 1)}% 100%`
                      : '0 0',
                }}
              />
            </div>

            <ul className="dash-legend">
              <li>
                <span className="chart-dot chart-success" aria-hidden="true" />
                {data.indicators.done_cards} concluídos
              </li>
              <li>
                <span className="chart-dot chart-warning" aria-hidden="true" />
                {data.indicators.pending_cards} pendentes
              </li>
              <li>
                <span className="chart-dot chart-danger" aria-hidden="true" />
                {data.indicators.overdue_cards} atrasados
              </li>
            </ul>

            <LineChart points={data.weekly_evolution} />
          </section>

          <div className="dash-grid">
            <div className="panel">
              <div className="panel-head">
                <div className="panel-title">
                  <h2>Índice de Aprendizado</h2>
                  <p className="hint">Média do índice de aprendizado por setor</p>
                </div>
                {data.sector_temperature.length > 0 && (
                  <span className={`pill ${hasAlert ? 'pill-warn' : 'pill-ok'}`}>
                    {hasAlert ? 'Atenção' : 'Estável'}
                  </span>
                )}
              </div>
              {data.sector_temperature.length === 0 ? (
                <p className="muted">Nenhum setor cadastrado ainda.</p>
              ) : (
                <>
                  <ul className="bar-list">
                    {data.sector_temperature.map((sector) => (
                      <li key={sector.id} className="bar-row">
                        <span className="bar-name">{sector.name}</span>
                        <ScoreBar score={sector.avg_score} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            <div className="panel">
              <div className="panel-head">
                <div className="panel-title">
                  <h2>Distribuição por status</h2>
                  <p className="hint">Total de cards por coluna do quadro</p>
                </div>
              </div>
              {data.by_status.length === 0 ? (
                <p className="muted">Nenhuma coluna encontrada.</p>
              ) : (
                <>
                  <DonutChart slices={statusSlices} total={statusTotal} />
                  <ul className="donut-legend">
                    {statusSlices.map((slice) => (
                      <li key={slice.label}>
                        <span
                          className="chart-dot"
                          style={{ background: slice.color }}
                          aria-hidden="true"
                        />
                        <span className="donut-legend-name">{slice.label}</span>
                        <span className="donut-legend-count">{slice.value}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            <div className="panel">
              <div className="panel-head">
                <div className="panel-title">
                  <h2>Equipe</h2>
                  <p className="hint">Cards atribuídos por membro</p>
                </div>
              </div>
              {data.team.length === 0 ? (
                <p className="muted">Nenhum membro no projeto.</p>
              ) : (
                <ul className="team-list">
                  {data.team.map((member) => {
                    const load = data.by_responsible.find(
                      (row) => row.responsible_id === member.id,
                    );
                    const done = load?.done ?? 0;
                    const total = load?.total ?? 0;
                    return (
                      <li key={member.id} className="team-row">
                        <span className="avatar" aria-hidden="true">
                          {initialsOf(member.name)}
                        </span>
                        <span className="team-name">{member.name}</span>
                        <span className="team-load">
                          <CountBar value={done} max={total} />
                          <span className="muted small">
                            {done}/{total}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="panel panel-list" style={{ marginTop: 16 }}>
            <div className="panel-head">
              <div className="panel-head-text">
                <h2>Projetos Recentes</h2>
                <p className="panel-desc">Projetos vinculados à sua conta.</p>
              </div>
            </div>
            <div className="panel-list-body">
              {projects.length === 0 ? (
                <p className="muted">Nenhum projeto vinculado a sua conta.</p>
              ) : (
                <>
                  <table className="table table-actions-right">
                    <thead>
                      <tr>
                        <th>Projeto</th>
                        <th>Situação</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleProjects.map((project) => {
                        const isCurrent = project.id === projectId;
                        const status = !project.is_active
                          ? { label: 'Inativo', className: 'pill' }
                          : project.status === 'Rascunho'
                            ? { label: 'RASCUNHO', className: 'pill pill-warn' }
                            : project.status === 'Concluído'
                              ? { label: 'CONCLUÍDO', className: 'pill pill-success' }
                              : isCurrent
                                ? { label: 'ATUAL', className: 'pill pill-primary' }
                                : { label: 'Disponível', className: 'pill pill-info' };
                        return (
                          <tr key={project.id}>
                            <td>
                              <span className="proj-cell">
                                <span className="proj-icon" aria-hidden="true">
                                  {project.name.slice(0, 2).toUpperCase()}
                                </span>
                                <span className="proj-name">{project.name}</span>
                              </span>
                            </td>
                            <td>
                              <span className={status.className}>{status.label}</span>
                            </td>
                            <td className="proj-action">
                              <button
                                type="button"
                                className="btn btn-plain"
                                disabled={isCurrent || !project.is_active}
                                onClick={() => navigate(`/dashboard?proj=${project.id}`)}
                              >
                                Abrir
                              </button>
                              {canEditProject && project.is_active && project.status !== 'Concluído' && (
                                <button
                                  type="button"
                                  className="icon-btn"
                                  aria-label="Concluir"
                                  title="Concluir projeto"
                                  onClick={() => askConclude(project)}
                                >
                                  <svg
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    aria-hidden="true"
                                  >
                                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                                    <polyline points="22 4 12 14.01 9 11.01" />
                                  </svg>
                                </button>
                              )}
                              {(canEditProject || canDeleteProject) && (
                                <TableActions
                                  onEdit={canEditProject ? () => askEdit(project) : undefined}
                                  onDelete={canDeleteProject ? () => askDelete(project) : undefined}
                                />
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <PaginationFooter
                    total={projects.length}
                    page={projectPageSafe}
                    pageSize={projectPageSize}
                    onPageChange={setProjectPage}
                    onPageSizeChange={(size) => {
                      setProjectPageSize(size);
                      setProjectPage(1);
                    }}
                  />
                </>
              )}
            </div>
          </div>
        </>
      )}

      <SecurityPrompt gate={gate} />
      {concluding && (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget && !concludingBusy) setConcluding(null);
          }}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-label="Concluir Projeto">
            <h3>Concluir Projeto</h3>
            <p className="step-subtitle">
              Tem certeza de que deseja marcar o projeto {concluding.name} como CONCLUÍDO? Isso
              atualizará o status do projeto e desabilitará novas edições diretas sem reabertura.
            </p>
            <p className="step-subtitle">
              Informe a justificativa para concluir este projeto. A justificativa fica registrada
              na auditoria.
            </p>
            {concludeJustError && <div className="error-box">{concludeJustError}</div>}
            <label className="field">
              <span>Justificativa *</span>
              <textarea
                value={concludeJustificativa}
                rows={3}
                placeholder="Ex.: Escopo entregue e aprovado pelo cliente"
                aria-label="Justificativa da conclusão"
                onChange={(event) => {
                  setConcludeJustificativa(event.target.value);
                  setConcludeJustError('');
                }}
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-plain"
                disabled={concludingBusy}
                onClick={() => setConcluding(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-warning"
                disabled={concludingBusy}
                onClick={() => void confirmConclude()}
              >
                {concludingBusy ? 'Concluindo' : 'Concluir'}
              </button>
            </div>
          </div>
        </div>
      )}
      {deleting && (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget && !deletingBusy) setDeleting(null);
          }}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-label="Excluir Projeto">
            <h3>Excluir Projeto</h3>
            <p className="step-subtitle">
              Tem certeza de que deseja excluir o projeto {deleting.name}? Esta ação é permanente e
              não pode ser desfeita.
            </p>
            {deleteJustError && <div className="error-box">{deleteJustError}</div>}
            <label className="field">
              <span>Justificativa *</span>
              <textarea
                value={deleteJustificativa}
                rows={3}
                placeholder="Ex.: Projeto cancelado pelo cliente"
                aria-label="Justificativa da exclusão"
                onChange={(event) => {
                  setDeleteJustificativa(event.target.value);
                  setDeleteJustError('');
                }}
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-plain"
                disabled={deletingBusy}
                onClick={() => setDeleting(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={deletingBusy}
                onClick={() => void confirmDelete()}
              >
                {deletingBusy ? 'Excluindo' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}
      {editing && (
        <ProjectEditModal
          project={editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
