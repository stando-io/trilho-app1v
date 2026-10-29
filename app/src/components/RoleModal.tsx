import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api';
import { useToast } from './Toast';
import type { SecurityGate } from '../useSecurityGate';

export interface RoleModalRow {
  id: string;
  name: string;
  description: string;
  profile_id: string;
  profile_name: string;
  users_count: number;
}

export interface RoleModalProfile {
  id: string;
  name: string;
}

interface RoleModalProps {
  mode: 'edit' | 'create';
  role: RoleModalRow | null;
  profiles: RoleModalProfile[];
  profilesLoaded: boolean;
  gate: SecurityGate;
  onClose: () => void;
  onSaved: () => void;
}

export function RoleModal({
  mode,
  role,
  profiles,
  profilesLoaded,
  gate,
  onClose,
  onSaved,
}: RoleModalProps) {
  const toast = useToast();
  const isEdit = mode === 'edit' && role !== null;

  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [profileId, setProfileId] = useState(role?.profile_id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);

  const nameTrimmed = name.trim();
  const canSave = nameTrimmed.length >= 2 && Boolean(profileId);

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!canSave || busy) return;
    setBusy(true);
    setError('');
    const body = JSON.stringify({
      name: nameTrimmed,
      description,
      profile_id: profileId,
    });
    const result = await gate.guarded(async () => {
      if (isEdit && role) {
        return api(`/roles/${role.id}`, { method: 'PUT', body });
      }
      return api('/roles', { method: 'POST', body });
    });
    if (result.ok) {
      toast.success('Cargo salvo.');
      onSaved();
      onClose();
    }
    setBusy(false);
  }

  async function handleDelete() {
    if (!role || deleting) return;
    if (!window.confirm(`Excluir o cargo "${role.name}"?`)) return;
    setDeleting(true);
    setError('');
    const result = await gate.guarded(async () => {
      await api(`/roles/${role.id}`, { method: 'DELETE' });
    });
    if (result.ok) {
      toast.success('Cargo excluído.');
      onSaved();
      onClose();
    }
    setDeleting(false);
  }

  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal role-modal" role="dialog" aria-modal="true">
        <header className="role-modal-head">
          <div className="role-modal-identity">
            <div className="role-modal-name-row">
              <span className="role-modal-name">
                {nameTrimmed || (isEdit ? role?.name : 'Novo cargo')}
              </span>
              <span className="role-modal-label">{isEdit ? 'Editar' : 'Novo'}</span>
              {isEdit && (
                <span className="role-modal-users-badge pill pill-primary">
                  {role?.users_count ?? 0} {role?.users_count === 1 ? 'usuário' : 'usuários'}
                </span>
              )}
            </div>
          </div>
          <div className="role-modal-head-actions">
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

        <form onSubmit={(event) => void handleSave(event)}>
          <div className="role-modal-body">
            <div className="role-modal-grid">
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
                <span>Nível de Acesso</span>
                <select
                  value={profileId}
                  onChange={(event) => setProfileId(event.target.value)}
                  disabled={!profilesLoaded}
                  required
                >
                  <option value="" disabled>
                    Selecione o nível
                  </option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field">
              <span>Descrição</span>
              <textarea
                className="role-modal-desc"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={160}
                rows={4}
              />
            </label>
          </div>

          <div className="role-modal-foot">
            <div className="role-modal-foot-left">
              {isEdit && (
                <button
                  type="button"
                  className="btn btn-danger-ghost"
                  disabled={deleting || busy}
                  onClick={() => void handleDelete()}
                >
                  {deleting ? 'Excluindo...' : 'Excluir cargo'}
                </button>
              )}
            </div>
            <div className="role-modal-foot-right">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Cancelar
              </button>
              <button type="submit" className="btn" disabled={!canSave || busy}>
                {busy ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
