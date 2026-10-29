import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { api } from '../api';
import { useToast } from './Toast';
import {
  actionKeysOf,
  actionsForScreens,
  defaultProfilePermissions,
  PERMISSION_TREE,
} from '../permissions';
import type { PermissionNode, PermissionModule } from '../permissions';
import type { Profile } from '../types';
import type { SecurityGate } from '../useSecurityGate';

interface ProfileModalProps {
  mode: 'edit' | 'create';
  profile: Profile | null;
  gate: SecurityGate;
  onClose: () => void;
  onSaved: () => void;
}

interface ProfileDraft {
  name: string;
  description: string;
  screens: string[];
  permissions: string[];
}

function draftFromProfile(profile: Profile | null, mode: 'edit' | 'create'): ProfileDraft {
  if (mode === 'edit' && profile) {
    return {
      name: profile.name,
      description: profile.description,
      screens: [...profile.screens],
      permissions: profile.permissions.length
        ? [...profile.permissions]
        : actionsForScreens(profile.screens),
    };
  }
  return {
    name: '',
    description: '',
    screens: ['dashboard'],
    permissions: defaultProfilePermissions(),
  };
}

function computeExpanded(draft: ProfileDraft): Set<string> {
  const expanded = new Set<string>();
  for (const module of PERMISSION_TREE) {
    const leaves = actionKeysOf(module);
    const hasAny = leaves.some((key) => draft.permissions.includes(key));
    if (hasAny) expanded.add(module.key);
  }
  return expanded;
}

export function ProfileModal({ mode, profile, gate, onClose, onSaved }: ProfileModalProps) {
  const toast = useToast();
  const isEdit = mode === 'edit' && profile !== null;

  const [draft, setDraft] = useState<ProfileDraft>(() => draftFromProfile(profile, mode));
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    computeExpanded(draftFromProfile(profile, mode)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const nameTrimmed = draft.name.trim();
  const canSave = nameTrimmed.length >= 2 && draft.screens.length > 0;

  function toggleModule(moduleKey: string, checked: boolean) {
    setDraft((current) => {
      const screens = checked
        ? current.screens.includes(moduleKey)
          ? current.screens
          : [...current.screens, moduleKey]
        : current.screens.filter((item) => item !== moduleKey);
      const module = PERMISSION_TREE.find((item) => item.key === moduleKey);
      const keys = module ? actionKeysOf(module) : [];
      const next = new Set(current.permissions);
      for (const key of keys) {
        if (checked) next.add(key);
        else next.delete(key);
      }
      return { ...current, screens, permissions: [...next] };
    });
  }

  function toggleAction(key: string, checked: boolean) {
    setDraft((current) => {
      const next = new Set(current.permissions);
      if (checked) next.add(key);
      else next.delete(key);
      return { ...current, permissions: [...next] };
    });
  }

  function toggleNode(node: PermissionNode, checked: boolean) {
    setDraft((current) => {
      const next = new Set(current.permissions);
      for (const key of actionKeysOf(node)) {
        if (checked) next.add(key);
        else next.delete(key);
      }
      return { ...current, permissions: [...next] };
    });
  }

  function toggleExpanded(key: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function expandAll() {
    setExpanded(new Set(PERMISSION_TREE.map((module) => module.key)));
  }

  function collapseAll() {
    setExpanded(new Set());
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!canSave || busy) return;
    setBusy(true);
    setError('');
    const body = JSON.stringify({
      name: nameTrimmed,
      description: draft.description,
      screens: draft.screens,
      permissions: draft.permissions,
    });
    const result = await gate.guarded(async () => {
      if (isEdit && profile) {
        return api(`/profiles/${profile.id}`, { method: 'PUT', body });
      }
      return api('/profiles', { method: 'POST', body });
    });
    if (result.ok) {
      toast.success('Nível de acesso salvo.');
      onSaved();
      onClose();
    }
    setBusy(false);
  }

  function renderSummaryRow(module: PermissionModule) {
    const leaves = actionKeysOf(module);
    const onCount = leaves.filter((key) => draft.permissions.includes(key)).length;
    const full = onCount === leaves.length && onCount > 0;
    return (
      <div key={module.key} className="perm-summary-row">
        <span>{module.label}</span>
        <span
          className={`perm-summary-badge ${full ? 'perm-summary-full' : 'perm-summary-partial'}`}
        >
          {onCount}/{leaves.length}
        </span>
      </div>
    );
  }

  function renderNode(node: PermissionNode, moduleOn: boolean, depth: number): ReactNode {
    const leaves = actionKeysOf(node);
    const onCount = leaves.filter((key) => draft.permissions.includes(key)).length;
    const all = onCount === leaves.length;
    const some = onCount > 0 && !all;
    const indentClass = depth === 1 ? 'perm-children' : 'perm-children perm-children-nested';

    if (node.type === 'action') {
      return (
        <label key={node.key} className="screen-check perm-leaf-row">
          <input
            type="checkbox"
            checked={draft.permissions.includes(node.key)}
            disabled={!moduleOn}
            onChange={(event) => toggleAction(node.key, event.target.checked)}
          />
          {node.label}
        </label>
      );
    }

    const nodeName = node.label;
    return (
      <div key={nodeName} className="perm-group">
        <label className="screen-check perm-node-row">
          <input
            type="checkbox"
            checked={all}
            disabled={!moduleOn}
            ref={(element) => {
              if (element) element.indeterminate = some;
            }}
            onChange={(event) => toggleNode(node, event.target.checked)}
          />
          <span className="perm-node-label">{node.label}</span>
          <span className="perm-count">
            {onCount}/{leaves.length}
          </span>
        </label>
        <div className={indentClass}>
          {node.children.map((child) => renderNode(child, moduleOn, depth + 1))}
        </div>
      </div>
    );
  }

  function renderModule(module: PermissionModule) {
    const moduleOn = draft.screens.includes(module.key);
    const leaves = actionKeysOf(module);
    const onCount = leaves.filter((key) => draft.permissions.includes(key)).length;
    const some = moduleOn && onCount > 0 && onCount < leaves.length;
    const isExpanded = expanded.has(module.key);
    return (
      <div key={module.key} className={`perm-section ${isExpanded ? 'expanded' : ''}`}>
        <div
          className="perm-section-head"
          onClick={() => toggleExpanded(module.key)}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              toggleExpanded(module.key);
            }
          }}
        >
          <input
            type="checkbox"
            checked={moduleOn}
            ref={(element) => {
              if (element) element.indeterminate = some;
            }}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => toggleModule(module.key, event.target.checked)}
          />
          <strong className="perm-section-label">{module.label}</strong>
          <span className="perm-count">
            {onCount}/{leaves.length}
          </span>
          <svg
            className="perm-chevron"
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
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
        {isExpanded && (
          <div className="perm-section-body">
            <div className="perm-section-children">
              {module.children.map((child) => renderNode(child, moduleOn, 1))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal profile-modal" role="dialog" aria-modal="true">
        <header className="profile-modal-head">
          <div className="profile-modal-identity">
            <span className="profile-modal-title">
              {isEdit ? 'Editar nível de acesso' : 'Novo nível de acesso'}
            </span>
            <span className="profile-modal-subtitle">Defina permissões por tela e ação</span>
          </div>
          <div className="profile-modal-head-actions">
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
          <div className="profile-modal-body">
            <div className="profile-modal-top">
              <div className="profile-modal-main">
                <label className="field">
                  <span>Nome</span>
                  <input
                    value={draft.name}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, name: event.target.value }))
                    }
                    placeholder="Ex.: Técnico implantação"
                    required
                    minLength={2}
                    maxLength={80}
                  />
                </label>
                <label className="field">
                  <span>Descrição</span>
                  <input
                    value={draft.description}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, description: event.target.value }))
                    }
                    placeholder="Descreva este perfil..."
                    maxLength={160}
                  />
                </label>
              </div>
              <aside className="profile-modal-side">
                <h4 className="profile-modal-side-title">Resumo de permissões</h4>
                <div className="perm-summary">
                  {PERMISSION_TREE.map((module) => renderSummaryRow(module))}
                </div>
              </aside>
            </div>

            <div className="profile-tree">
              <div className="profile-tree-head">
                <span className="profile-tree-title">Permissões de acesso</span>
                <div className="profile-tree-toggles">
                  <button type="button" className="profile-tree-toggle" onClick={expandAll}>
                    Expandir tudo
                  </button>
                  <button type="button" className="profile-tree-toggle" onClick={collapseAll}>
                    Recolher tudo
                  </button>
                </div>
              </div>
              <div className="profile-tree-sections">
                {PERMISSION_TREE.map((module) => renderModule(module))}
              </div>
            </div>
          </div>

          <div className="profile-modal-foot">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn" disabled={!canSave || busy}>
              {busy ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
