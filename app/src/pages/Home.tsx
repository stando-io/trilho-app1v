import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { can, SCREEN_PATHS, useAuth } from '../auth';
import ProjectCalendar from '../components/ProjectCalendar';
import ProgressBar from '../components/ProgressBar';
import ProjectCreateModal from '../components/ProjectCreateModal';
import type { CreateMode } from '../components/ProjectCreateModal';
import TableActions from '../components/TableActions';
import { useToast } from '../components/Toast';
import { useProjectId } from '../project';
import { projectRoleLabel } from '../projectRoles';
import { useProjectEvents } from '../realtime';
import type { CalendarItem, DashboardData, MeUser } from '../types';

const RELOAD_EVENTS = new Set([
  'cards_changed',
  'columns_changed',
  'structure_changed',
  'milestones_changed',
]);

function projectTarget(user: MeUser, projectId: string): string {
  const order = ['dashboard', 'base', 'kanban', 'relatorios'];
  const screen = order.find((item) => user.profile.screens.includes(item));
  const path = screen ? (SCREEN_PATHS[screen] ?? '/') : '/';
  return path === '/' ? `/?proj=${projectId}` : `${path}?proj=${projectId}`;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : (parts[0]?.[1] ?? '');
  return (first + last).toUpperCase();
}

function shortDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

function dateBR(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

function longDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function popoverPosition(pos: { x: number; y: number }): CSSProperties {
  const width = 340;
  const estimatedHeight = 420;
  const left = Math.max(8, Math.min(pos.x - width / 2, window.innerWidth - width - 8));
  const flip = pos.y + estimatedHeight > window.innerHeight;
  return flip
    ? { left, bottom: window.innerHeight - pos.y + 8 }
    : { left, top: pos.y + 8 };
}

function Chevron({ open }: { open: boolean }) {
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
      style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease' }}
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

export default function Home() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const projectId = useProjectId();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [newName, setNewName] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [milestoneError, setMilestoneError] = useState('');
  const [agendaCollapsed, setAgendaCollapsed] = useState(true);
  const [popover, setPopover] = useState<{ iso: string; x: number; y: number } | null>(null);
  const [popName, setPopName] = useState('');
  const [popDesc, setPopDesc] = useState('');
  const [popError, setPopError] = useState('');
  const popInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!projectId) {
      setData(null);
      return;
    }
    try {
      const result = await api<DashboardData>(`/projects/${projectId}/dashboard`);
      setData(result);
    } catch {
      setData(null);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleEvent = useCallback(
    (event: { type: string }) => {
      if (RELOAD_EVENTS.has(event.type)) void load();
    },
    [load],
  );
  useProjectEvents(projectId, handleEvent);

  const upcoming = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return [...(data?.calendar ?? [])]
      .filter((item) => item.due_date >= today)
      .sort((a, b) => a.due_date.localeCompare(b.due_date));
  }, [data]);

  const milestones = useMemo(
    () =>
      (data?.calendar ?? [])
        .filter((item) => item.kind === 'milestone')
        .sort((a, b) => a.due_date.localeCompare(b.due_date)),
    [data],
  );

  const popoverItems = useMemo(() => {
    if (!popover) return [];
    return (data?.calendar ?? []).filter(
      (item) => item.kind === 'milestone' && item.due_date === popover.iso,
    );
  }, [data, popover]);

  useEffect(() => {
    if (!popover) return;
    popInputRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setPopover(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [popover]);

  if (!user) return null;

const canCreateProject = can(user, 'home.novo_projeto');
const canDownloadTemplate = can(user, 'home.baixar_planilha_modelo');
const canCalendar = can(user, 'home.registrar_calendario');
const canAgenda = can(user, 'home.registrar_agenda');
  const firstName = user.name.split(' ')[0];
  const todayLabel = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  async function handleCreated(projectId: string, mode: CreateMode) {
    toast.success('Projeto criado.');
    setCreating(false);
    await refresh();
    if (mode === 'base-manual') {
      navigate(`/base?proj=${projectId}&setup=1`);
      return;
    }
    if (mode === 'base-importada') {
      navigate(`/base?proj=${projectId}`);
      return;
    }
    navigate(projectTarget(user!, projectId));
  }

  async function createMilestone(event: FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name || !newDate) return;
    setMilestoneError('');
    try {
      await api(`/projects/${projectId}/milestones`, {
        method: 'POST',
        body: JSON.stringify({ name, due_date: newDate, description: newDesc.trim() }),
      });
      setNewName('');
      setNewDate('');
      setNewDesc('');
      await load();
    } catch (err) {
      setMilestoneError(err instanceof ApiError ? err.message : 'Erro ao criar o agendamento');
    }
  }

  async function saveMilestone(id: string) {
    const name = editName.trim();
    if (!name || !editDate) return;
    setMilestoneError('');
    try {
      await api(`/projects/${projectId}/milestones/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, due_date: editDate, description: editDesc.trim() }),
      });
      setEditingId(null);
      await load();
    } catch (err) {
      setMilestoneError(err instanceof ApiError ? err.message : 'Erro ao salvar o agendamento');
    }
  }

  async function deleteMilestone(milestone: CalendarItem) {
    if (!window.confirm(`Excluir o agendamento "${milestone.name}"?`)) return;
    setMilestoneError('');
    try {
      await api(`/projects/${projectId}/milestones/${milestone.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setMilestoneError(err instanceof ApiError ? err.message : 'Erro ao excluir o agendamento');
    }
  }

  function openPopover(iso: string, x: number, y: number) {
    setPopover({ iso, x, y });
    setPopName('');
    setPopDesc('');
    setPopError('');
  }

  function closePopover() {
    setPopover(null);
  }

  async function createFromPopover(event: FormEvent) {
    event.preventDefault();
    if (!popover) return;
    const name = popName.trim();
    if (name.length < 2) return;
    setPopError('');
    try {
      await api(`/projects/${projectId}/milestones`, {
        method: 'POST',
        body: JSON.stringify({ name, due_date: popover.iso, description: popDesc.trim() }),
      });
      setPopover(null);
      await load();
    } catch (err) {
      setPopError(err instanceof ApiError ? err.message : 'Erro ao criar o agendamento');
    }
  }

  function goToRegistrarAgenda() {
    setAgendaCollapsed(false);
    requestAnimationFrame(() => {
      document
        .getElementById('registrar-agenda')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  return (
    <div>
      {creating && (
        <ProjectCreateModal onClose={() => setCreating(false)} onCreated={handleCreated} />
      )}

      {popover && (
        <>
          <div className="agenda-backdrop" onClick={closePopover} aria-hidden="true" />
          <div
            className="agenda-popover"
            role="dialog"
            aria-modal="true"
            aria-label={`Registrar agendamento em ${longDate(popover.iso)}`}
            style={popoverPosition(popover)}
          >
            <div className="agenda-popover-head">
              <strong>{longDate(popover.iso)}</strong>
              <button
                type="button"
                className="icon-btn"
                aria-label="Fechar"
                onClick={closePopover}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
            </div>
            {popoverItems.length > 0 && (
              <ul className="agenda-day-list">
                {popoverItems.map((item) => (
                  <li key={item.id} className="agenda-day-item">
                    <span className="milestone-name">{item.name}</span>
                    {item.description && (
                      <span className="milestone-desc muted small">{item.description}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {popError && <div className="error-box">{popError}</div>}
            <form
              className="agenda-popover-form"
              onSubmit={(event) => void createFromPopover(event)}
            >
              <input
                ref={popInputRef}
                value={popName}
                onChange={(event) => setPopName(event.target.value)}
                placeholder="Título"
                aria-label="Título do agendamento"
                maxLength={120}
              />
              <textarea
                value={popDesc}
                onChange={(event) => setPopDesc(event.target.value)}
                placeholder="Descrição (opcional)"
                aria-label="Descrição do agendamento"
                maxLength={500}
                rows={3}
              />
              <div className="agenda-popover-actions">
                <button type="submit" className="btn" disabled={popName.trim().length < 2}>
                  Registrar
                </button>
                <button type="button" className="btn btn-plain" onClick={closePopover}>
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      {user.projects.length === 0 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <h2>Nenhum projeto vinculado</h2>
          <p>
            Nenhum projeto vinculado a sua conta ainda. Você pode explorar o sistema por inteiro;
            os dados de projetos aparecem quando o administrador vincular você a um projeto.
          </p>
        </div>
      )}

      <div className="home-grid">
        <div className="home-main">
          <section className="hero-gradient home-hero">
            <div className="home-hero-text">
              <span className="home-hero-kicker">{todayLabel}</span>
              <h1>Bem-vindo de volta, {firstName}</h1>
              <p>Acompanhe prazos, eventos e a equipe do projeto em um só lugar.</p>
            </div>
            {(canCreateProject || canDownloadTemplate) && (
              <div className="home-hero-actions">
                {canCreateProject && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setCreating(true)}
                  >
                    Novo projeto
                  </button>
                )}
                {canDownloadTemplate && (
                  <a className="btn btn-secondary" href="/api/v1/projects/base-template" download>
                    Baixar planilha modelo
                  </a>
                )}
              </div>
            )}
          </section>
          <div className="panel">
            <ProjectCalendar
              items={data?.calendar ?? []}
              canManage={canCalendar}
              onDaySelect={openPopover}
            />
          </div>
        </div>

        <div className="home-side">
          <div className="panel home-top-events">
            <div className="panel-head">
              <h2>Próximos eventos</h2>
              <button
                type="button"
                className="btn btn-plain"
                onClick={goToRegistrarAgenda}
              >
                Ver mais
              </button>
            </div>
            {upcoming.length === 0 ? (
              <p className="muted">Nenhum prazo ou agendamento.</p>
            ) : (
              <ul className="event-list">
                {upcoming.slice(0, 8).map((item) => (
                  <li key={`${item.kind}-${item.id}`} className="event-row">
                    <span
                      className={`pill ${item.kind === 'milestone' ? 'pill-primary' : 'pill-warn'}`}
                    >
                      {item.kind === 'milestone' ? 'Agenda' : 'Prazo'}
                    </span>
                    <span className="event-name">{item.name}</span>
                    <span className="muted small">{shortDate(item.due_date)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>Equipe responsável</h2>
            </div>
            {!data || data.team.length === 0 ? (
              <p className="muted">Nenhum membro no projeto.</p>
            ) : (
              <ul className="team-list">
                {data.team.map((member) => {
                  const roleLabel = projectRoleLabel(member.project_role);
                  return (
                    <li key={member.id} className="team-row">
                      <span className="avatar" aria-hidden="true">
                        {initialsOf(member.name)}
                      </span>
                      <span className="team-name">{member.name}</span>
                      {roleLabel && <span className="muted small">{roleLabel}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="panel home-metric">
            <div className="panel-head">
              <h2>Produtividade</h2>
            </div>
            {data ? (
              <>
                <div className="row-between">
                  <span className="muted small">Conclusão geral</span>
                  <ProgressBar percent={data.indicators.completion_percent} />
                </div>
                <p className="hint" style={{ marginTop: 10 }}>
                  {data.indicators.done_cards} concluídos · {data.indicators.pending_cards}{' '}
                  pendentes · {data.indicators.overdue_cards} atrasados
                </p>
              </>
            ) : (
              <p className="muted">Selecione um projeto para ver a produtividade.</p>
            )}
          </div>
        </div>
      </div>

      <div className="panel" id="registrar-agenda">
        <div className="panel-head">
          <h2>Agendas registradas</h2>
          <button
            type="button"
            className="icon-btn"
            aria-expanded={!agendaCollapsed}
            aria-label={
              agendaCollapsed
                ? 'Expandir registro de agenda'
                : 'Recolher registro de agenda'
            }
            onClick={() => setAgendaCollapsed((collapsed) => !collapsed)}
          >
            <Chevron open={!agendaCollapsed} />
          </button>
        </div>
        <div className={agendaCollapsed ? 'agenda-body collapsed' : 'agenda-body'}>
          {milestoneError && <div className="error-box">{milestoneError}</div>}
          {canAgenda && (
            <form
              onSubmit={(event) => void createMilestone(event)}
              className="inline-form agenda-form"
            >
              <input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Nome do agendamento"
                aria-label="Nome do agendamento"
                maxLength={120}
              />
              <input
                type="date"
                value={newDate}
                onChange={(event) => setNewDate(event.target.value)}
                aria-label="Prazo do agendamento"
              />
              <button
                type="submit"
                className="btn"
                disabled={newName.trim().length < 2 || !newDate}
              >
                Registrar agenda
              </button>
              <textarea
                value={newDesc}
                onChange={(event) => setNewDesc(event.target.value)}
                placeholder="Descrição (opcional)"
                aria-label="Descrição do agendamento"
                maxLength={500}
                rows={2}
              />
            </form>
          )}

          {milestones.length === 0 ? (
            <p className="muted" style={{ marginTop: 12 }}>
              Nenhum agendamento cadastrado.
            </p>
          ) : (
            <ul className="milestone-list">
              {milestones.map((milestone) => (
                <li key={milestone.id} className="milestone-row">
                  {editingId === milestone.id ? (
                    <form
                      className="inline-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveMilestone(milestone.id);
                      }}
                    >
                      <input
                        value={editName}
                        onChange={(event) => setEditName(event.target.value)}
                        aria-label="Nome do agendamento"
                        maxLength={120}
                      />
                      <input
                        type="date"
                        value={editDate}
                        onChange={(event) => setEditDate(event.target.value)}
                        aria-label="Prazo do agendamento"
                      />
                      <button
                        type="submit"
                        className="btn"
                        disabled={editName.trim().length < 2 || !editDate}
                      >
                        Salvar
                      </button>
                      <button
                        type="button"
                        className="btn btn-plain"
                        onClick={() => setEditingId(null)}
                      >
                        Cancelar
                      </button>
                      <textarea
                        value={editDesc}
                        onChange={(event) => setEditDesc(event.target.value)}
                        placeholder="Descrição (opcional)"
                        aria-label="Descrição do agendamento"
                        maxLength={500}
                        rows={2}
                      />
                    </form>
                  ) : (
                    <>
                      <span className="milestone-info">
                        <span className="milestone-name">{milestone.name}</span>
                        {milestone.description && (
                          <span className="milestone-desc muted small">
                            {milestone.description}
                          </span>
                        )}
                      </span>
                      <span className="milestone-meta">
                        <span className="muted small">{dateBR(milestone.due_date)}</span>
                        {canAgenda && (
                          <span className="tree-actions">
                            <TableActions
                              onEdit={() => {
                                setEditingId(milestone.id);
                                setEditName(milestone.name);
                                setEditDate(milestone.due_date);
                                setEditDesc(milestone.description ?? '');
                              }}
                              onDelete={() => void deleteMilestone(milestone)}
                            />
                          </span>
                        )}
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
