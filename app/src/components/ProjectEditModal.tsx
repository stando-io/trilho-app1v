import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, ApiError } from '../api';
import { PROJECT_ROLE_LABELS } from '../projectRoles';
import { useToast } from './Toast';
import type { Member } from '../types';

interface SystemUser {
  id: string;
  name: string;
  email: string;
  is_active: boolean;
}

export interface EditableProject {
  id: string;
  name: string;
  is_active?: boolean;
  status?: string | null;
}

const SITUATION_OPTIONS = ['Em prospecção', 'Iniciado', 'Em andamento', 'Rascunho'] as const;

interface ProjectEditModalProps {
  project: EditableProject;
  onClose: () => void;
  onSaved: () => Promise<unknown> | unknown;
}

export default function ProjectEditModal({ project, onClose, onSaved }: ProjectEditModalProps) {
  const toast = useToast();
  const [name, setName] = useState(project.name);
  const [active, setActive] = useState(project.is_active !== false);
  const [situation, setSituation] = useState(
    project.status === 'Concluído' ? '' : (project.status ?? ''),
  );
  const [members, setMembers] = useState<Member[]>([]);
  const [initialIds, setInitialIds] = useState<Set<string>>(new Set());
  const [initialRoles, setInitialRoles] = useState<Map<string, string | null>>(new Map());
  const [allUsers, setAllUsers] = useState<SystemUser[]>([]);
  const [addUserId, setAddUserId] = useState('');
  const [apiError, setApiError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [justificativa, setJustificativa] = useState('');
  const [justError, setJustError] = useState('');
  const [savingJust, setSavingJust] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenJustificativa, setReopenJustificativa] = useState('');
  const [reopenJustError, setReopenJustError] = useState('');
  const concluded = project.status === 'Concluído';

  const loadMembers = async () => {
    try {
      const rows = await api<Member[]>(`/projects/${project.id}/members`);
      setMembers(rows);
      setInitialIds(new Set(rows.map((row) => row.id)));
      setInitialRoles(new Map(rows.map((row) => [row.id, row.project_role ?? null])));
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Erro ao carregar os membros');
    }
  };

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const rows = await api<SystemUser[]>('/users');
        if (alive) setAllUsers(rows.filter((row) => row.is_active));
      } catch {
        if (alive) setAllUsers([]);
      }
    })();
    void loadMembers();
    return () => {
      alive = false;
    };
  }, [project.id]);

  const memberIds = members.map((member) => member.id);
  const addedIds = memberIds.filter((id) => !initialIds.has(id));
  const removedIds = [...initialIds].filter((id) => !memberIds.includes(id));
  const changedRoleIds = members
    .filter(
      (member) =>
        initialIds.has(member.id) &&
        (member.project_role ?? null) !== (initialRoles.get(member.id) ?? null),
    )
    .map((member) => member.id);

  const candidates = allUsers.filter((user) => !memberIds.includes(user.id));

  function addMember() {
    if (!addUserId) return;
    const user = allUsers.find((row) => row.id === addUserId);
    if (!user) return;
    setMembers((prev) => [
      ...prev,
      { id: user.id, name: user.name, email: user.email, profile_name: null, project_role: null },
    ]);
    setAddUserId('');
  }

  function removeMember(memberId: string) {
    setMembers((prev) => prev.filter((member) => member.id !== memberId));
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setApiError('Informe o nome do projeto');
      return;
    }
    const dirty =
      trimmed !== project.name ||
      active !== (project.is_active !== false) ||
      situation !== (project.status ?? '');
    const noMemberChanges =
      addedIds.length === 0 && removedIds.length === 0 && changedRoleIds.length === 0;
    if (!dirty && noMemberChanges) {
      onClose();
      return;
    }
    if (!dirty) {
      const problems = await applyMemberChanges();
      if (problems.length === 0) {
        await onSaved();
        onClose();
        return;
      }
      setApiError(problems.join(' · '));
      return;
    }
    setJustError('');
    setJustificativa('');
    setConfirmOpen(true);
  }

  async function applyMemberChanges(): Promise<string[]> {
    const problems: string[] = [];
    for (const userId of addedIds) {
      try {
        const member = members.find((row) => row.id === userId);
        await api(`/projects/${project.id}/members`, {
          method: 'POST',
          body: JSON.stringify({
            user_id: userId,
            ...(member?.project_role ? { project_role: member.project_role } : {}),
          }),
        });
      } catch (err) {
        problems.push(err instanceof ApiError ? err.message : 'Erro ao adicionar membro');
      }
    }
    for (const userId of removedIds) {
      try {
        await api(`/projects/${project.id}/members/${userId}`, { method: 'DELETE' });
      } catch (err) {
        problems.push(err instanceof ApiError ? err.message : 'Erro ao remover membro');
      }
    }
    for (const userId of changedRoleIds) {
      try {
        const member = members.find((row) => row.id === userId);
        await api(`/projects/${project.id}/members/${userId}`, {
          method: 'PATCH',
          body: JSON.stringify({ project_role: member?.project_role ?? null }),
        });
      } catch (err) {
        problems.push(err instanceof ApiError ? err.message : 'Erro ao alterar o papel');
      }
    }
    return problems;
  }

  async function confirmSave() {
    const justification = justificativa.trim();
    if (justification.length < 3) {
      setJustError('Informe a justificativa com pelo menos 3 caracteres');
      return;
    }
    setSavingJust(true);
    setJustError('');
    setApiError('');
    const trimmed = name.trim();
    const problems: string[] = [];
    let saved = false;

    try {
      await api(`/projects/${project.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: trimmed,
          is_active: active,
          ...(situation ? { status: situation } : {}),
          justificativa: justification,
        }),
      });
      saved = true;
    } catch (err) {
      problems.push(err instanceof ApiError ? err.message : 'Erro ao salvar o projeto');
    }

    if (saved) {
      problems.push(...(await applyMemberChanges()));
      await onSaved();
    }

    setSavingJust(false);
    if (saved && problems.length === 0) {
      toast.success('Projeto salvo.');
      setConfirmOpen(false);
      onClose();
      return;
    }
    setConfirmOpen(false);
    setApiError(problems.join(' · ') || 'Erro ao salvar');
  }

  async function handleReopen() {
    const justification = reopenJustificativa.trim();
    if (justification.length < 3) {
      setReopenJustError('Informe a justificativa com pelo menos 3 caracteres');
      return;
    }
    setReopening(true);
    setReopenJustError('');
    setApiError('');
    try {
      await api(`/projects/${project.id}/reopen`, {
        method: 'POST',
        body: JSON.stringify({ justificativa: justification }),
      });
      toast.success('Projeto reaberto.');
      await onSaved();
      onClose();
    } catch (err) {
      setApiError(err instanceof ApiError ? err.message : 'Erro ao reabrir o projeto');
      setReopening(false);
      setReopenOpen(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-label="Editar projeto">
        <h3>Editar projeto</h3>
        <p className="step-subtitle">Alterações estruturais protegidas pela Senha de Segurança</p>

        {loadError && <div className="error-box">{loadError}</div>}
        {apiError && <div className="error-box">{apiError}</div>}

        <form onSubmit={(event) => void handleSave(event)}>
          <label className="field">
            <span>Nome do projeto</span>
            <input
              value={name}
              aria-label="Nome do projeto"
              disabled={concluded}
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <label className="field">
            <span>Situação</span>
            <select
              value={situation}
              aria-label="Situação"
              disabled={concluded}
              onChange={(event) => setSituation(event.target.value)}
            >
              <option value="">Não informada</option>
              {SITUATION_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Status de Ativação</span>
            <select
              value={active ? 'ativo' : 'inativo'}
              aria-label="Status de Ativação"
              disabled={concluded}
              onChange={(event) => setActive(event.target.value === 'ativo')}
            >
              <option value="ativo">Ativo</option>
              <option value="inativo">Inativo</option>
            </select>
          </label>

          <div className="modal-section">
            <h4>Membros vinculados</h4>
            {members.length === 0 ? (
              <p className="muted">Nenhum membro vinculado.</p>
            ) : (
              <ul className="member-lines">
                {members.map((member) => (
                  <li key={member.id} className="member-line">
                    <span className="team-name" title={member.email}>
                      {member.name}
                    </span>
                    <select
                      value={member.project_role ?? ''}
                      aria-label={`Papel no projeto de ${member.name}`}
                      disabled={concluded}
                      onChange={(event) => {
                        const value = event.target.value || null;
                        setMembers((prev) =>
                          prev.map((row) =>
                            row.id === member.id ? { ...row, project_role: value } : row,
                          ),
                        );
                      }}
                    >
                      <option value="">Sem papel</option>
                      {Object.entries(PROJECT_ROLE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn btn-plain btn-danger"
                      disabled={concluded}
                      onClick={() => removeMember(member.id)}
                    >
                      Remover
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="member-add-row">
              <select
                value={addUserId}
                aria-label="Adicionar membro"
                disabled={concluded}
                onChange={(event) => setAddUserId(event.target.value)}
              >
                <option value="">Selecione o membro</option>
                {candidates.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-plain"
                disabled={!addUserId || concluded}
                onClick={addMember}
              >
                Adicionar
              </button>
            </div>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-plain" onClick={onClose}>
              Cancelar
            </button>
            {concluded ? (
              <button
                type="button"
                className="btn btn-warning"
                disabled={reopening}
                onClick={() => {
                  setReopenJustificativa('');
                  setReopenJustError('');
                  setReopenOpen(true);
                }}
              >
                Reabrir Projeto
              </button>
            ) : (
              <button type="submit" className="btn">
                Salvar
              </button>
            )}
          </div>
        </form>
      </div>
      {confirmOpen && (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget && !savingJust) setConfirmOpen(false);
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Confirmar alteração"
          >
            <h3>Confirmar alteração</h3>
            <p className="step-subtitle">
              Informe a justificativa para alterar os dados deste projeto. A justificativa fica
              registrada na auditoria.
            </p>
            {justError && <div className="error-box">{justError}</div>}
            <label className="field">
              <span>Justificativa *</span>
              <textarea
                value={justificativa}
                rows={3}
                placeholder="Ex.: Correção do prazo acordado com o cliente"
                aria-label="Justificativa"
                onChange={(event) => {
                  setJustificativa(event.target.value);
                  setJustError('');
                }}
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-plain"
                disabled={savingJust}
                onClick={() => setConfirmOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn"
                disabled={savingJust}
                onClick={() => void confirmSave()}
              >
                {savingJust ? 'Salvando' : 'Confirmar e salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
      {reopenOpen && (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget && !reopening) setReopenOpen(false);
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Reabrir projeto"
          >
            <h3>Reabrir Projeto</h3>
            <p className="step-subtitle">
              Informe a justificativa para reabrir este projeto. A justificativa fica registrada
              na auditoria.
            </p>
            {reopenJustError && <div className="error-box">{reopenJustError}</div>}
            <label className="field">
              <span>Justificativa *</span>
              <textarea
                value={reopenJustificativa}
                rows={3}
                placeholder="Ex.: Retomada do projeto a pedido do cliente"
                aria-label="Justificativa da reabertura"
                onChange={(event) => {
                  setReopenJustificativa(event.target.value);
                  setReopenJustError('');
                }}
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-plain"
                disabled={reopening}
                onClick={() => setReopenOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-warning"
                disabled={reopening}
                onClick={() => void handleReopen()}
              >
                {reopening ? 'Reabrindo' : 'Reabrir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
