import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api';
import LoadingOverlay from './LoadingOverlay';
import { useToast } from './Toast';
import type { SecurityGate } from '../useSecurityGate';

export interface UserModalRow {
  id: string;
  name: string;
  email: string;
  is_active: boolean;
  profile_id: string;
  profile_name: string;
  role_id: string | null;
  role_name: string | null;
  project_ids: string[];
  created_at: string;
  last_login_at: string | null;
}

export interface UserModalRole {
  id: string;
  name: string;
}

export interface UserModalProject {
  id: string;
  name: string;
}

interface UserModalProps {
  mode: 'edit' | 'create';
  user: UserModalRow | null;
  roles: UserModalRole[];
  rolesLoaded: boolean;
  projects: UserModalProject[];
  projectsLoaded: boolean;
  currentUserId: string;
  gate: SecurityGate;
  onClose: () => void;
  onSaved: () => void;
}

type ModalTab = 'dados' | 'projetos' | 'senha';

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function UserModal({
  mode,
  user,
  roles,
  rolesLoaded,
  projects,
  projectsLoaded,
  currentUserId,
  gate,
  onClose,
  onSaved,
}: UserModalProps) {
  const toast = useToast();
  const isEdit = mode === 'edit' && user !== null;

  const [tab, setTab] = useState<ModalTab>('dados');
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [roleId, setRoleId] = useState(user?.role_id ?? '');
  const [projectIds, setProjectIds] = useState<string[]>(user?.project_ids ?? []);
  const [isActive, setIsActive] = useState(user?.is_active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  const [linkUrl, setLinkUrl] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);

  const [inviteUrl, setInviteUrl] = useState('');

  const nameTrimmed = name.trim();
  const emailTrimmed = email.trim();
  const emailValid = /\S+@\S+\.\S+/.test(emailTrimmed);
  const canSave = nameTrimmed.length >= 2 && emailValid && Boolean(roleId);
  const canToggleActive = isEdit && user !== null && user.id !== currentUserId;

  async function handleToggleActive() {
    if (!user || !canToggleActive || busy) return;
    setBusy(true);
    setError('');
    const next = !isActive;
    const result = await gate.guarded(async () => {
      await api(`/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: next }),
      });
    });
    if (result.ok) {
      setIsActive(next);
      toast.success(next ? 'Usuário ativado.' : 'Usuário desativado.');
      onSaved();
    }
    setBusy(false);
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!canSave || busy) return;
    setBusy(true);
    setError('');
    if (isEdit && user) {
      const body: Record<string, unknown> = {
        name: nameTrimmed,
        email: emailTrimmed,
        project_ids: projectIds,
        role_id: roleId || null,
      };
      const result = await gate.guarded(async () => {
        await api(`/users/${user.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      });
      if (result.ok) {
        toast.success('Usuário atualizado.');
        onSaved();
        onClose();
      }
    } else {
      const result = await gate.guarded(async () => {
        return api<{ invite_url: string }>('/auth/invite', {
          method: 'POST',
          body: JSON.stringify({
            email: emailTrimmed,
            role_id: roleId,
            project_ids: projectIds,
          }),
        });
      });
      if (result.ok && result.value) {
        setInviteUrl(result.value.invite_url);
        toast.success('Convite gerado. Compartilhe o link com a pessoa.');
      }
    }
    setBusy(false);
  }

  async function handleSetPassword() {
    if (!user || passwordBusy) return;
    setPasswordError('');
    if (newPassword.length < 8) {
      setPasswordError('A senha deve ter no mínimo 8 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('As senhas não conferem.');
      return;
    }
    setPasswordBusy(true);
    const result = await gate.guarded(async () => {
      await api(`/users/${user.id}/set-password`, {
        method: 'POST',
        body: JSON.stringify({ password: newPassword }),
      });
    });
    if (result.ok) {
      toast.success('Senha redefinida com sucesso.');
      setNewPassword('');
      setConfirmPassword('');
    }
    setPasswordBusy(false);
  }

  async function handleSendResetLink() {
    if (!user || linkBusy) return;
    setLinkBusy(true);
    setError('');
    try {
      const data = await api<{ reset_url: string }>(`/auth/users/${user.id}/reset-link`, {
        method: 'POST',
      });
      setLinkUrl(data.reset_url);
      toast.success('Link de redefinição gerado. Compartilhe com o usuário.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao gerar o link';
      setError(message);
      toast.error(message);
    } finally {
      setLinkBusy(false);
    }
  }

  async function copyLink(url: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(successMessage);
    } catch {
      toast.error('Não foi possível copiar automaticamente. Selecione o link e copie.');
    }
  }

  function toggleProject(projectId: string, checked: boolean) {
    setProjectIds((ids) =>
      checked ? [...ids, projectId] : ids.filter((id) => id !== projectId),
    );
  }

  function formatCreated(value: string): string {
    return formatDateTime(value);
  }

  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal user-modal" role="dialog" aria-modal="true">
        <header className="user-modal-head">
          <div className="user-modal-identity">
            <div className="user-modal-name-row">
              <span className="user-modal-name">{nameTrimmed || (isEdit ? user?.name : 'Novo usuário')}</span>
              <span className="user-modal-label">{isEdit ? 'Editar' : 'Novo'}</span>
              {isEdit && (
                <span className={`pill ${isActive ? 'pill-ok' : 'pill-danger'}`}>
                  {isActive ? 'Ativo' : 'Inativo'}
                </span>
              )}
            </div>
            <span className="user-modal-email">
              {emailTrimmed || (isEdit ? user?.email : 'Informe o e-mail')}
            </span>
          </div>
          <div className="user-modal-head-actions">
            {canToggleActive && (
              <button
                type="button"
                className={`btn btn-danger-ghost ${isActive ? '' : 'user-modal-activate'}`}
                disabled={busy}
                onClick={() => void handleToggleActive()}
              >
                {isActive ? 'Desativar' : 'Ativar'}
              </button>
            )}
            <button
              type="button"
              className="icon-btn"
              aria-label="Fechar"
              title="Fechar"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </header>

        {error && <div className="error-box">{error}</div>}

        {inviteUrl ? (
          <div className="user-modal-invite-done">
            <p className="muted">
              Envie este link para a pessoa criar a conta. Ele aparece apenas agora.
            </p>
            <code className="key-value">{inviteUrl}</code>
            <div className="user-modal-invite-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void copyLink(inviteUrl, 'Link de convite copiado.')}
              >
                Copiar link
              </button>
              <button type="button" className="btn" onClick={onClose}>
                Concluir
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={(event) => void handleSave(event)}>
            <div className="user-modal-body">
              <div className="user-modal-main">
                <div className="user-modal-tabs" role="tablist" aria-label="Seções do usuário">
                  <button
                    type="button"
                    role="tab"
                    className="user-modal-tab"
                    aria-selected={tab === 'dados'}
                    onClick={() => setTab('dados')}
                  >
                    Dados
                  </button>
                  {isEdit && (
                    <button
                      type="button"
                      role="tab"
                      className="user-modal-tab"
                      aria-selected={tab === 'projetos'}
                      onClick={() => setTab('projetos')}
                    >
                      Projetos
                    </button>
                  )}
                  {isEdit && (
                    <button
                      type="button"
                      role="tab"
                      className="user-modal-tab"
                      aria-selected={tab === 'senha'}
                      onClick={() => setTab('senha')}
                    >
                      Redefinir senha
                    </button>
                  )}
                </div>

                {tab === 'dados' && (
                  <div className="user-modal-fields">
                    <label className="field">
                      <span>Nome</span>
                      <input
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        required
                        minLength={2}
                        maxLength={80}
                      />
                    </label>
                    <label className="field">
                      <span>E-mail</span>
                      <input
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        required
                        maxLength={160}
                      />
                    </label>
                    <label className="field">
                      <span>Cargo</span>
                      <select
                        value={roleId}
                        onChange={(event) => setRoleId(event.target.value)}
                        disabled={!rolesLoaded || (isEdit && user?.id === currentUserId)}
                        required
                      >
                        <option value="" disabled>
                          Selecione o cargo
                        </option>
                        {roles.map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}

                {isEdit && tab === 'projetos' && (
                  <fieldset className="screens-grid user-modal-projects">
                    <legend>Projetos</legend>
                    {!projectsLoaded ? (
                      <LoadingOverlay />
                    ) : projects.length === 0 ? (
                      <p className="muted">Nenhum projeto disponível.</p>
                    ) : (
                      projects.map((project) => (
                        <label key={project.id} className="screen-check">
                          <input
                            type="checkbox"
                            checked={projectIds.includes(project.id)}
                            onChange={(event) => toggleProject(project.id, event.target.checked)}
                          />
                          {project.name}
                        </label>
                      ))
                    )}
                  </fieldset>
                )}

                {isEdit && tab === 'senha' && (
                  <div className="user-modal-fields">
                    {passwordError && <div className="error-box">{passwordError}</div>}
                    <label className="field">
                      <span>Nova senha</span>
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                        minLength={8}
                        maxLength={128}
                      />
                    </label>
                    <label className="field">
                      <span>Confirmar nova senha</span>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        minLength={8}
                        maxLength={128}
                      />
                    </label>
                    <button
                      type="button"
                      className="btn"
                      disabled={passwordBusy || newPassword.length < 8 || newPassword !== confirmPassword}
                      onClick={() => void handleSetPassword()}
                    >
                      {passwordBusy ? 'Salvando...' : 'Salvar nova senha'}
                    </button>
                    <p className="muted user-modal-hint">
                      Alternativa: envie um link de redefinição por e-mail pelo bloco ao lado.
                    </p>
                  </div>
                )}
              </div>

              <aside className="user-modal-side">
                {isEdit ? (
                  <>
                    <h4 className="user-modal-side-title">Informações da conta</h4>
                    <dl className="user-modal-info">
                      <div className="user-modal-info-row">
                        <dt>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                            <line x1="16" y1="2" x2="16" y2="6" />
                            <line x1="8" y1="2" x2="8" y2="6" />
                            <line x1="3" y1="10" x2="21" y2="10" />
                          </svg>
                          Criado em
                        </dt>
                        <dd>{formatCreated(user!.created_at)}</dd>
                      </div>
                      <div className="user-modal-info-row">
                        <dt>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <circle cx="12" cy="12" r="10" />
                            <polyline points="12 6 12 12 16 14" />
                          </svg>
                          Último acesso
                        </dt>
                        <dd>{formatDateTime(user!.last_login_at)}</dd>
                      </div>
                      <div className="user-modal-info-row">
                        <dt>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                          </svg>
                          Projetos
                        </dt>
                        <dd>{projectIds.length}</dd>
                      </div>
                      <div className="user-modal-info-row">
                        <dt>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                          </svg>
                          Nível de acesso
                        </dt>
                        <dd>
                          <span className="pill pill-muted">{user!.profile_name}</span>
                        </dd>
                      </div>
                    </dl>

                    <div className="user-modal-reset-block">
                      <h4 className="user-modal-side-title">Redefinir senha</h4>
                      <p className="muted">
                        Envie um link de redefinição para o e-mail do usuário. O link expira em 24 horas.
                      </p>
                      {linkUrl && (
                        <div className="user-modal-link-box">
                          <code className="key-value">{linkUrl}</code>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => void copyLink(linkUrl, 'Link de redefinição copiado.')}
                          >
                            Copiar link
                          </button>
                        </div>
                      )}
                      <button
                        type="button"
                        className="btn btn-secondary btn-block"
                        disabled={linkBusy}
                        onClick={() => void handleSendResetLink()}
                      >
                        {linkBusy ? 'Gerando...' : 'Enviar link de redefinição'}
                      </button>
                    </div>
                  </>
                ) : (
                  <fieldset className="screens-grid user-modal-projects">
                    <legend>Projetos</legend>
                    {!projectsLoaded ? (
                      <LoadingOverlay />
                    ) : projects.length === 0 ? (
                      <p className="muted">Nenhum projeto disponível.</p>
                    ) : (
                      projects.map((project) => (
                        <label key={project.id} className="screen-check">
                          <input
                            type="checkbox"
                            checked={projectIds.includes(project.id)}
                            onChange={(event) => toggleProject(project.id, event.target.checked)}
                          />
                          {project.name}
                        </label>
                      ))
                    )}
                  </fieldset>
                )}
              </aside>
            </div>

            <div className="user-modal-foot">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Cancelar
              </button>
              <button type="submit" className="btn" disabled={!canSave || busy}>
                {busy ? 'Salvando...' : isEdit ? 'Salvar' : 'Gerar convite'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
