import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { api, ApiError } from '../api';
import { can, useAuth } from '../auth';
import CardModal from '../components/CardModal';
import InlinePrompt from '../components/InlinePrompt';
import LoadingOverlay from '../components/LoadingOverlay';
import SecurityPrompt from '../components/SecurityPrompt';
import TableActions from '../components/TableActions';
import { useToast } from '../components/Toast';
import { useProjectId } from '../project';
import { useProjectEvents } from '../realtime';
import type { CardDraft, KanbanColumn, Member, Sector } from '../types';
import { useSecurityGate } from '../useSecurityGate';

type BaseView = 'setores' | 'departamentos';

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

function DeptArrow() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="5 4 5 14 15 14" />
      <polyline points="11 10 15 14 11 18" />
    </svg>
  );
}

function LampIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
      <path d="M9 18h6" />
      <path d="M10 22h4" />
    </svg>
  );
}

export default function Base() {
  const projectId = useProjectId();
  const toast = useToast();
  const { user } = useAuth();
  const location = useLocation();

  const [sectors, setSectors] = useState<Sector[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<BaseView>('setores');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [newSectorName, setNewSectorName] = useState('');
  const [newDepartment, setNewDepartment] = useState<{ sectorId: string; name: string } | null>(
    null,
  );
  const [newDeptSector, setNewDeptSector] = useState('');
  const [newDeptName, setNewDeptName] = useState('');
  const [renaming, setRenaming] = useState<{
    kind: 'sector' | 'department';
    id: string;
    name: string;
  } | null>(null);
  const [draft, setDraft] = useState<CardDraft | null>(null);
  const [columns, setColumns] = useState<KanbanColumn[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState('');

  const gate = useSecurityGate(toast.error);
  const setupMode = new URLSearchParams(location.search).get('setup') === '1';

  const canCreateRegistro = can(user, 'base.novo_registro');
  const canEditAction = can(user, 'base.acoes.editar');
  const canDeleteAction = can(user, 'base.acoes.excluir');
  const canCreateCard = can(user, 'kanban.criar_cards');
  const canEditCard = can(user, 'kanban.editar_cards');

  function openNewTask(departmentId: string) {
    setModalError('');
    setDraft({
      id: null,
      task_code: '',
      title: '',
      description: '',
      priority: 'media',
      department_id: departmentId,
      responsible_id: '',
      due_date: '',
      origin: '',
      column_id: '',
      learning_index_active: false,
      learning_index_score: null,
      learning_index_note: '',
    });
    if (columns.length === 0 && projectId) {
      void api<KanbanColumn[]>(`/projects/${projectId}/columns`)
        .then(setColumns)
        .catch(() => undefined);
    }
    if (members.length === 0 && projectId) {
      void api<Member[]>(`/projects/${projectId}/members`)
        .then(setMembers)
        .catch(() => undefined);
    }
  }

  const load = useCallback(async () => {
    if (!projectId) {
      setSectors([]);
      setLoaded(true);
      return;
    }
    try {
      const data = await api<Sector[]>(`/projects/${projectId}/sectors`);
      setSectors(data);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao carregar a base');
    } finally {
      setLoaded(true);
    }
  }, [projectId]);

  useEffect(() => {
    setLoaded(false);
    void load();
  }, [load]);

  useEffect(() => {
    if (location.hash !== '#novo-setor') return;
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById('novo-setor')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      document.getElementById('novo-setor-input')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.hash]);

  const handleEvent = useCallback(
    (event: { type: string }) => {
      if (event.type === 'structure_changed' || event.type === 'cards_changed') void load();
    },
    [load],
  );
  useProjectEvents(projectId, handleEvent);

  function structural(task: () => Promise<unknown>) {
    return gate.guarded(async () => {
      await task();
      await load();
    });
  }

  async function saveCard(event: FormEvent) {
    event.preventDefault();
    if (!draft || !projectId) return;
    setModalBusy(true);
    setModalError('');
    try {
      if (draft.id) {
        await api(`/projects/${projectId}/cards/${draft.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            title: draft.title.trim(),
            description: draft.description,
            priority: draft.priority,
            department_id: draft.department_id || null,
            responsible_id: draft.responsible_id || null,
            due_date: draft.due_date || null,
            origin: draft.origin,
            column_id: draft.column_id,
            learning_index_active: draft.learning_index_active,
            learning_index_score: draft.learning_index_score,
            learning_index_note: draft.learning_index_note,
          }),
        });
      } else {
        await api(`/projects/${projectId}/cards`, {
          method: 'POST',
          body: JSON.stringify({
            title: draft.title.trim(),
            description: draft.description,
            priority: draft.priority,
            department_id: draft.department_id || null,
            responsible_id: draft.responsible_id || null,
            due_date: draft.due_date || null,
            origin: draft.origin,
            column_id: draft.column_id,
            learning_index_active: draft.learning_index_active,
            learning_index_score: draft.learning_index_score,
            learning_index_note: draft.learning_index_note,
          }),
        });
      }
      setDraft(null);
      await load();
    } catch (err) {
      setModalError(err instanceof ApiError ? err.message : 'Erro ao salvar o card');
    } finally {
      setModalBusy(false);
    }
  }

  async function createSector(event: FormEvent) {
    event.preventDefault();
    const name = newSectorName.trim();
    if (!name) return;
    let createdId: string | null = null;
    const result = await structural(async () => {
      const created = await api<{ id: string }>(`/projects/${projectId}/sectors`, {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      createdId = created.id;
    });
    if (result.ok) {
      setNewSectorName('');
      if (setupMode && createdId) {
        const sectorId = createdId;
        setExpanded((prev) => new Set(prev).add(sectorId));
        setNewDepartment({ sectorId, name: '' });
      }
    }
  }

  function postDepartment(sectorId: string, name: string) {
    return structural(() =>
      api(`/projects/${projectId}/departments`, {
        method: 'POST',
        body: JSON.stringify({ sector_id: sectorId, name }),
      }),
    );
  }

  async function createDepartment(sectorId: string, name: string) {
    const result = await postDepartment(sectorId, name);
    if (result.ok) setNewDepartment(null);
  }

  async function createDepartmentFromCard(event: FormEvent) {
    event.preventDefault();
    const name = newDeptName.trim();
    if (!newDeptSector || !name) return;
    const result = await postDepartment(newDeptSector, name);
    if (result.ok) {
      setNewDeptSector('');
      setNewDeptName('');
    }
  }

  async function saveRename(kind: 'sector' | 'department', id: string, name: string) {
    const path = kind === 'sector' ? 'sectors' : 'departments';
    const result = await structural(() =>
      api(`/projects/${projectId}/${path}/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      }),
    );
    if (result.ok) setRenaming(null);
  }

  async function deleteSector(sector: Sector) {
    if (!window.confirm(`Excluir o setor "${sector.name}"?`)) return;
    await structural(() => api(`/projects/${projectId}/sectors/${sector.id}`, { method: 'DELETE' }));
  }

  async function deleteDepartment(departmentId: string, name: string) {
    if (!window.confirm(`Excluir o departamento "${name}"?`)) return;
    await structural(() =>
      api(`/projects/${projectId}/departments/${departmentId}`, { method: 'DELETE' }),
    );
  }

  function toggleSector(sectorId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(sectorId)) next.delete(sectorId);
      else next.add(sectorId);
      return next;
    });
  }

  if (!projectId) {
    return (
      <div>
        <h1>Base</h1>
        <div className="panel">
          <h2>Nenhum projeto selecionado</h2>
          <p>Selecione ou crie um projeto para ver setores e departamentos.</p>
        </div>
      </div>
    );
  }

  const departments = sectors.flatMap((sector) =>
    sector.departments.map((department) => ({
      ...department,
      sectorId: sector.id,
      sectorName: sector.name,
    })),
  );

  return (
    <div>
      <div className="base-top">
        <div className="tip-card">
          <span className="tip-icon">
            <LampIcon />
          </span>
          <div className="tip-body">
            <h3>Dicas de Gestão</h3>
            <p>
              Organize setores por áreas de negócio para facilitar o acompanhamento de progresso
              e produtividade. Abra demandas diretamente pelo departamento para agilizar o fluxo
              no Quadro.
            </p>
          </div>
        </div>

        {canCreateRegistro && (
          <div className={`panel base-create${view === 'setores' ? ' base-create-setores' : ''}`} id="novo-setor">
            {view === 'setores' ? (
              <form onSubmit={(event) => void createSector(event)}>
                <h3 className="base-create-title">Criar Setor</h3>
                <label className="field">
                  <span>Nome do setor</span>
                  <input
                    id="novo-setor-input"
                    value={newSectorName}
                    onChange={(event) => setNewSectorName(event.target.value)}
                    placeholder="Ex: Engenharia de Software"
                    aria-label="Nome do novo setor"
                  />
                </label>
                <button
                  type="submit"
                  className="btn"
                  disabled={newSectorName.trim().length === 0}
                >
                  Criar setor
                </button>
              </form>
            ) : (
              <form onSubmit={(event) => void createDepartmentFromCard(event)}>
                <h3 className="base-create-title">Criar Departamento</h3>
                <label className="field">
                  <span>Setor</span>
                  <select
                    value={newDeptSector}
                    onChange={(event) => setNewDeptSector(event.target.value)}
                    aria-label="Setor do novo departamento"
                  >
                    <option value="">Selecione o Setor...</option>
                    {sectors.map((sector) => (
                      <option key={sector.id} value={sector.id}>
                        {sector.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Nome do departamento</span>
                  <input
                    value={newDeptName}
                    onChange={(event) => setNewDeptName(event.target.value)}
                    placeholder="Ex: Financeiro"
                    aria-label="Nome do novo departamento"
                  />
                </label>
                <button
                  type="submit"
                  className="btn"
                  disabled={!newDeptSector || newDeptName.trim().length === 0}
                >
                  Salvar Departamento
                </button>
              </form>
            )}
          </div>
        )}
      </div>

        <div className="panel">
          <div className="panel-head">
            <div className="base-title">
              <h2>Estrutura atual</h2>
              <span className="pill pill-primary">
                {sectors.length} {sectors.length === 1 ? 'Setor' : 'Setores'}
              </span>
              <span className="pill pill-primary">
                {departments.length}{' '}
                {departments.length === 1 ? 'Departamento' : 'Departamentos'}
              </span>
            </div>
            <div className="tabs" role="tablist" aria-label="Visão da estrutura">
              <button
                type="button"
                role="tab"
                aria-selected={view === 'setores'}
                className={`tab${view === 'setores' ? ' tab-active' : ''}`}
                onClick={() => setView('setores')}
              >
                Setores
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'departamentos'}
                className={`tab${view === 'departamentos' ? ' tab-active' : ''}`}
                onClick={() => setView('departamentos')}
              >
                Departamentos
              </button>
            </div>
          </div>

          {!loaded ? (
            <LoadingOverlay />
          ) : view === 'setores' ? (
            sectors.length === 0 ? (
              <p style={{ marginTop: 12 }}>
                Nenhum setor criado. Crie o primeiro setor para organizar a base do projeto.
              </p>
            ) : (
              <>
                <div className="base-table-head" aria-hidden="true">
                  <span className="base-th-name">Grupo / departamento</span>
                  <span className="base-th-actions">Ações</span>
                </div>
                <ul className="tree base-tree">
                {sectors.map((sector) => {
                  return (
                    <li key={sector.id} className="tree-item">
                      <div
                        className="tree-row tree-row-sector"
                        onClick={(event) => {
                          if ((event.target as HTMLElement).closest('button')) return;
                          toggleSector(sector.id);
                        }}
                      >
                        <span className="tree-text">
                          <button
                            type="button"
                            className="tree-toggle"
                            aria-label={expanded.has(sector.id) ? 'Recolher' : 'Expandir'}
                            onClick={() => toggleSector(sector.id)}
                          >
                            <Chevron open={expanded.has(sector.id)} />
                          </button>
                          <span className="tree-text-col">
                            <span className="tree-name">{sector.name}</span>
                            <span className="muted small">
                              {sector.departments.length}{' '}
                              {sector.departments.length === 1
                                ? 'departamento'
                                : 'departamentos'}
                            </span>
                          </span>
                          </span>
                          <span className="tree-actions">
                            {canCreateRegistro && (
                              <button
                                type="button"
                                className="btn btn-plain"
                                onClick={() =>
                                  setNewDepartment({ sectorId: sector.id, name: '' })
                                }
                              >
                                Novo departamento
                              </button>
                            )}
                            <TableActions
                              onEdit={
                                canEditAction
                                  ? () =>
                                      setRenaming({
                                        kind: 'sector',
                                        id: sector.id,
                                        name: sector.name,
                                      })
                                  : undefined
                              }
                              onDelete={
                                canDeleteAction ? () => void deleteSector(sector) : undefined
                              }
                              editLabel="Renomear"
                              editTitle="Renomear setor"
                            />
                          </span>
                        </div>

                        {renaming?.kind === 'sector' && renaming.id === sector.id && (
                          <InlinePrompt
                            initialValue={renaming.name}
                            label="Novo nome do setor"
                            onSubmit={(value) => void saveRename('sector', sector.id, value)}
                            onCancel={() => setRenaming(null)}
                          />
                        )}

                        {newDepartment?.sectorId === sector.id && (
                          <InlinePrompt
                            initialValue={newDepartment.name}
                            label="Nome do departamento"
                            onSubmit={(value) => void createDepartment(sector.id, value)}
                            onCancel={() => setNewDepartment(null)}
                          />
                        )}

                        {expanded.has(sector.id) && (
                          <ul className="tree-sub">
                            {sector.departments.length === 0 && (
                              <li className="muted small">Sem departamentos neste setor.</li>
                            )}
                            {sector.departments.map((department) => {
                              return (
                                <li key={department.id}>
                                  <div className="tree-row">
                                    <span className="tree-text">
                                      <span className="tree-dept-icon">
                                        <DeptArrow />
                                      </span>
                                      <span className="tree-text-col">
                                        <span className="tree-name">{department.name}</span>
                                      </span>
                                    </span>
                                    <span className="tree-actions">
                                      {canCreateCard && (
                                        <button
                                          type="button"
                                          className="btn"
                                          onClick={() => openNewTask(department.id)}
                                        >
                                          Nova tarefa
                                        </button>
                                      )}
                                      <TableActions
                                        onEdit={
                                          canEditAction
                                            ? () =>
                                                setRenaming({
                                                  kind: 'department',
                                                  id: department.id,
                                                  name: department.name,
                                                })
                                            : undefined
                                        }
                                        onDelete={
                                          canDeleteAction
                                            ? () =>
                                                void deleteDepartment(
                                                  department.id,
                                                  department.name,
                                                )
                                            : undefined
                                        }
                                        editLabel="Renomear"
                                        editTitle="Renomear departamento"
                                      />
                                    </span>
                                  </div>
                                  {renaming?.kind === 'department' &&
                                    renaming.id === department.id && (
                                      <InlinePrompt
                                        initialValue={renaming.name}
                                        label="Novo nome do departamento"
                                        onSubmit={(value) =>
                                          void saveRename('department', department.id, value)
                                        }
                                        onCancel={() => setRenaming(null)}
                                      />
                                    )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            )
          ) : departments.length === 0 ? (
            <p style={{ marginTop: 12 }}>
              Nenhum departamento criado. Abra um setor e adicione o primeiro departamento.
            </p>
          ) : (
            <>
              <div className="base-table-head" aria-hidden="true">
                <span className="base-th-name">Departamento</span>
                <span className="base-th-actions">Ações</span>
              </div>
              <ul className="tree base-tree">
                {departments.map((department) => {
                  return (
                    <li key={department.id} className="tree-item">
                      <div className="tree-row">
                        <span className="tree-text">
                          <span className="tree-dept-icon">
                            <DeptArrow />
                          </span>
                          <span className="tree-text-col">
                            <span className="tree-name">{department.name}</span>
                            <span className="muted small">Setor {department.sectorName}</span>
                          </span>
                        </span>
                        <span className="tree-actions">
                          {canCreateCard && (
                            <button
                              type="button"
                              className="btn"
                              onClick={() => openNewTask(department.id)}
                            >
                              Nova tarefa
                            </button>
                          )}
                          <TableActions
                            onEdit={
                              canEditAction
                                ? () =>
                                    setRenaming({
                                      kind: 'department',
                                      id: department.id,
                                      name: department.name,
                                    })
                                : undefined
                            }
                            onDelete={
                              canDeleteAction
                                ? () => void deleteDepartment(department.id, department.name)
                                : undefined
                            }
                            editLabel="Renomear"
                            editTitle="Renomear departamento"
                          />
                        </span>
                      </div>
                      {renaming?.kind === 'department' && renaming.id === department.id && (
                        <InlinePrompt
                          initialValue={renaming.name}
                          label="Novo nome do departamento"
                          onSubmit={(value) => void saveRename('department', department.id, value)}
                          onCancel={() => setRenaming(null)}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

      {draft && (
        <CardModal
          draft={draft}
          setDraft={setDraft}
          columns={columns}
          sectors={sectors}
          members={members}
          projectId={projectId}
          canCreateCard={canCreateCard}
          canEditCard={canEditCard}
          canDeleteCard={false}
          busy={modalBusy}
          error={modalError}
          onSave={(event) => void saveCard(event)}
          onDelete={() => undefined}
          onPrev={null}
          onNext={null}
        />
      )}

      <SecurityPrompt gate={gate} />
    </div>
  );
}
