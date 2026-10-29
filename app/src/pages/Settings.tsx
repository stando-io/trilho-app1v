import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { api, ApiError } from '../api';
import { can, SCREEN_LABELS, useAuth } from '../auth';
import TableActions from '../components/TableActions';
import { useToast } from '../components/Toast';
import { UserModal } from '../components/UserModal';
import { RoleModal } from '../components/RoleModal';
import { ProfileModal } from '../components/ProfileModal';
import { ApiKeyModal } from '../components/ApiKeyModal';
import { WebhookModal } from '../components/WebhookModal';
import type { WebhookRow } from '../components/WebhookModal';
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_LABELS, WEBHOOK_SYSTEM_LABELS } from '../webhookEvents';
import { ConfirmDialog } from '../components/ConfirmDialog';
import LoadingOverlay from '../components/LoadingOverlay';
import PaginationFooter from '../components/PaginationFooter';
import SecurityPrompt from '../components/SecurityPrompt';
import { usePageSize } from '../usePageSize';
import { useSecurityGate } from '../useSecurityGate';
import { useProjectId } from '../project';
import {
  DEFAULT_VIEW_PREFERENCES,
  fetchViewPreferences,
  VIEW_BACKGROUNDS,
  VIEW_MODES,
} from '../viewPreferences';
import type { ViewMode, ViewPreferences } from '../viewPreferences';
import type { Profile } from '../types';
import { APP_BADGE, FAQ_ITEMS, MANUALS, RELEASE_NOTE_LABELS, RELEASES } from '../infos';

type Section =
  | 'conta'
  | 'cargos'
  | 'perfis'
  | 'usuarios'
  | 'layout'
  | 'seguranca'
  | 'chaves'
  | 'parametros'
  | 'auditoria'
  | 'infos';

type InfosTab = 'atualizacoes' | 'suporte' | 'manuais' | 'faq' | 'duvidas';

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  key_suffix: string | null;
  created_by_name: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface AuditRow {
  id: string;
  action: string;
  entity: string;
  created_at: string;
  user_name: string | null;
  user_email: string | null;
  task_code: string | null;
  detail: string;
}

interface UserRow {
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

interface RoleRow {
  id: string;
  name: string;
  description: string;
  profile_id: string;
  profile_name: string;
  users_count: number;
}

interface ProjectOption {
  id: string;
  name: string;
}

function formatLastAccess(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const LEADING_SECTION: { id: Section; label: string } = {
  id: 'conta',
  label: 'Minha Conta',
};

const ACCOUNT_GROUP: { id: Section; label: string }[] = [
  { id: 'usuarios', label: 'Usuários' },
  { id: 'cargos', label: 'Cargos' },
  { id: 'perfis', label: 'Níveis de Acesso' },
];

const TRAILING_SECTIONS: { id: Section; label: string; icon?: ReactNode }[] = [
  { id: 'layout', label: 'Personalizar' },
  { id: 'seguranca', label: 'Senha de Segurança' },
  { id: 'chaves', label: 'Integrações' },
  { id: 'parametros', label: 'Parâmetros' },
  { id: 'auditoria', label: 'Auditoria' },
  { id: 'infos', label: 'Infos Trilho', icon: <InfosIcon /> },
];

const INFOS_TABS: { id: InfosTab; label: string }[] = [
  { id: 'atualizacoes', label: 'Atualizações' },
  { id: 'suporte', label: 'Suporte' },
  { id: 'manuais', label: 'Manuais' },
  { id: 'faq', label: 'FAQ' },
  { id: 'duvidas', label: 'Dúvidas gerais e Melhoria' },
];

const ACCOUNT_GROUP_IDS: Section[] = ACCOUNT_GROUP.map((item) => item.id);

const ALL_SECTIONS: Section[] = [
  'conta',
  'usuarios',
  'cargos',
  'perfis',
  'layout',
  'seguranca',
  'chaves',
  'parametros',
  'auditoria',
  'infos',
];

const SECTION_PERMISSIONS: Record<Section, string[]> = {
  conta: ['settings.minha_conta'],
  usuarios: ['settings.usuarios.novo', 'settings.usuarios.editar', 'settings.usuarios.excluir'],
  cargos: ['settings.cargos.novo', 'settings.cargos.editar', 'settings.cargos.excluir'],
  perfis: ['settings.niveis.novo', 'settings.niveis.editar', 'settings.niveis.excluir'],
  layout: ['settings.temas'],
  seguranca: ['settings.seguranca'],
  chaves: ['settings.integracoes'],
  parametros: ['settings.parametros'],
  auditoria: ['settings.auditoria'],
  infos: ['settings.minha_conta'],
};

function InfosIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

function GroupCaret({ open }: { open: boolean }) {
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
      className={open ? 'settings-nav-caret settings-nav-caret-open' : 'settings-nav-caret'}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function LockIcon() {
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
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  project_created: 'Projeto criado',
  project_renamed: 'Projeto renomeado',
  project_updated: 'Projeto atualizado',
  project_completed: 'Conclusão de projeto',
  project_reopened: 'Reabertura de projeto',
  project_deleted: 'Projeto excluído',
  member_added: 'Membro adicionado',
  member_removed: 'Membro removido',
  board_background_set: 'Fundo do quadro alterado',
  security_password_set: 'Senha de segurança alterada',
  card_created: 'Card criado',
  card_updated: 'Card atualizado',
  card_deleted: 'Card excluído',
  column_created: 'Coluna criada',
  column_updated: 'Coluna atualizada',
  column_deleted: 'Coluna excluída',
  column_cards_cleared: 'Cards da coluna apagados',
  milestone_created: 'Agenda criada',
  milestone_updated: 'Agenda atualizada',
  milestone_deleted: 'Agenda excluída',
  sector_created: 'Setor criado',
  sector_updated: 'Setor atualizado',
  sector_deleted: 'Setor excluído',
  department_created: 'Departamento criado',
  department_updated: 'Departamento atualizado',
  department_deleted: 'Departamento excluído',
  api_key_created: 'Chave de API criada',
  api_key_revoked: 'Chave de API revogada',
  role_created: 'Cargo criado',
  role_updated: 'Cargo atualizado',
  role_deleted: 'Cargo excluído',
  user_updated: 'Usuário atualizado',
  user_deleted: 'Usuário excluído',
  user_profile_updated: 'Perfil próprio atualizado',
  password_changed: 'Senha alterada',
  security_gate_toggled: 'Proteção de área alterada',
  security_gate_all_toggled: 'Exigência global de senha de segurança alterada',
  security_password_deleted: 'Senha de segurança excluída',
  security_password_toggled: 'Senha de segurança alternada',
  card_comment_added: 'Comentário adicionado',
  attachment_added: 'Anexo adicionado',
  attachment_removed: 'Anexo removido',
  attachment_reordered: 'Anexos reordenados',
  attachment_renamed: 'Anexo renomeado',
  view_preferences_updated: 'Preferências de visualização atualizadas',
  view_preferences_reset: 'Preferências de visualização redefinidas',
  profile_permissions_updated: 'Permissões de perfil atualizadas',
  card_char_limits_updated: 'Limites de caracteres dos cards atualizados',
  notification_prefs_updated: 'Preferências de notificação atualizadas',
};

const NOTIF_OPTIONS: { type: string; label: string }[] = [
  { type: 'card_created', label: 'Cards criados' },
  { type: 'card_moved', label: 'Card movido de coluna' },
  { type: 'card_assigned', label: 'Atribuição de responsáveis' },
  { type: 'card_mention', label: 'Menções em descrição' },
  { type: 'card_comment', label: 'Comentários' },
  { type: 'card_deadline', label: 'Prazos de vencimento' },
  { type: 'card_learning_index', label: 'Índice de aprendizado' },
  { type: 'permissions_updated', label: 'Permissões atualizadas' },
  { type: 'project_member_added', label: 'Adição a projeto' },
  { type: 'security_password_changed', label: 'Alteração da senha de segurança' },
];

function messageOf(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

const VIEW_MODE_PATHS: Record<ViewMode, ReactNode> = {
  kanban: (
    <>
      <rect x="3" y="4" width="5" height="16" rx="1.5" />
      <rect x="9.5" y="4" width="5" height="11" rx="1.5" />
      <rect x="16" y="4" width="5" height="14" rx="1.5" />
    </>
  ),
  lista: (
    <>
      <circle cx="5" cy="6.5" r="1.6" />
      <line x1="9" y1="6.5" x2="20" y2="6.5" />
      <circle cx="5" cy="12" r="1.6" />
      <line x1="9" y1="12" x2="20" y2="12" />
      <circle cx="5" cy="17.5" r="1.6" />
      <line x1="9" y1="17.5" x2="17" y2="17.5" />
    </>
  ),
  calendario: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="8" y1="3" x2="8" y2="7" />
      <line x1="16" y1="3" x2="16" y2="7" />
    </>
  ),
  gantt: (
    <>
      <rect x="3" y="5" width="10" height="4" rx="1.5" />
      <rect x="7" y="11" width="12" height="4" rx="1.5" />
      <rect x="5" y="17" width="8" height="4" rx="1.5" />
      <line x1="14" y1="3" x2="14" y2="21" strokeDasharray="2 2.5" />
    </>
  ),
};

interface PillOption<T extends string> {
  id: T;
  label: string;
}

function Pills<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: PillOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="view-row">
      <span className="view-label">{label}</span>
      <div className="view-pills" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={value === option.id}
            className={`view-pill${value === option.id ? ' view-pill-on' : ''}`}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ViewToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="view-row view-toggle">
      <span className="view-label">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="view-switch" aria-hidden="true" />
    </label>
  );
}

export default function Settings() {
  const { user, refresh } = useAuth();
  const projectId = useProjectId();
  const toast = useToast();
  const gate = useSecurityGate(toast.error);

  const [section, setSection] = useState<Section>('conta');
  const [accountGroupOpen, setAccountGroupOpen] = useState(false);

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profilesLoaded, setProfilesLoaded] = useState(false);
  const [perfilPage, setPerfilPage] = useState(1);
  const [perfilSearch, setPerfilSearch] = useState('');
  const [perfilPageSize, setPerfilPageSize] = usePageSize('settings:perfis');

  const [users, setUsers] = useState<UserRow[]>([]);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [userPage, setUserPage] = useState(1);
  const [userPageSize, setUserPageSize] = usePageSize('settings:usuarios');

  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [rolesLoaded, setRolesLoaded] = useState(false);
  const [rolePage, setRolePage] = useState(1);
  const [roleSearch, setRoleSearch] = useState('');
  const [rolePageSize, setRolePageSize] = usePageSize('settings:cargos');

  const [allProjects, setAllProjects] = useState<ProjectOption[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);

  const [userModalMode, setUserModalMode] = useState<'edit' | 'create' | null>(null);
  const [userModalTarget, setUserModalTarget] = useState<UserRow | null>(null);

  const [roleModalMode, setRoleModalMode] = useState<'edit' | 'create' | null>(null);
  const [roleModalTarget, setRoleModalTarget] = useState<RoleRow | null>(null);

  const [profileModalMode, setProfileModalMode] = useState<'edit' | 'create' | null>(null);
  const [profileModalTarget, setProfileModalTarget] = useState<Profile | null>(null);

  const [viewPrefs, setViewPrefs] = useState<ViewPreferences>(DEFAULT_VIEW_PREFERENCES);
  const [viewDraft, setViewDraft] = useState<ViewPreferences>(DEFAULT_VIEW_PREFERENCES);
  const [viewLoaded, setViewLoaded] = useState(false);
  const [viewBusy, setViewBusy] = useState(false);

  const [securityDefined, setSecurityDefined] = useState<boolean | null>(null);
  const [securityGates, setSecurityGates] = useState<Record<string, boolean> | null>(null);
  const [securityDraft, setSecurityDraft] = useState('');
  const [securityConfirmDraft, setSecurityConfirmDraft] = useState('');
  const [securityHintDraft, setSecurityHintDraft] = useState('');

  const [paramGateAll, setParamGateAll] = useState<boolean | null>(null);
  const [paramPasswordDefined, setParamPasswordDefined] = useState(false);
  const [paramBusy, setParamBusy] = useState(false);
  const [paramTitleMax, setParamTitleMax] = useState<number | null>(null);
  const [paramDescMax, setParamDescMax] = useState<number | null>(null);
  const [titleMaxDraft, setTitleMaxDraft] = useState('');
  const [descMaxDraft, setDescMaxDraft] = useState('');
  const [limitsBusy, setLimitsBusy] = useState(false);
  const [paramNotif, setParamNotif] = useState<Record<string, boolean> | null>(null);
  const [paramNotifBaseline, setParamNotifBaseline] = useState<Record<string, boolean> | null>(null);
  const [notifBusy, setNotifBusy] = useState(false);

  const [accountName, setAccountName] = useState('');
  const [accountColor, setAccountColor] = useState('');
  const [colorTouched, setColorTouched] = useState(false);
  const [accountTextColor, setAccountTextColor] = useState('');
  const [textColorTouched, setTextColorTouched] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);

  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditLoaded, setAuditLoaded] = useState(false);
  const [auditPage, setAuditPage] = useState(1);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditDraft, setAuditDraft] = useState('');
  const [auditPageSize, setAuditPageSize] = usePageSize('settings:auditoria');

  const [apiKeys, setApiKeys] = useState<ApiKeyRow[]>([]);
  const [apiKeysLoaded, setApiKeysLoaded] = useState(false);
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
  const [confirmingKeyDelete, setConfirmingKeyDelete] = useState<ApiKeyRow | null>(null);

  const [webhooks, setWebhooks] = useState<WebhookRow[]>([]);
  const [webhooksLoaded, setWebhooksLoaded] = useState(false);
  const [webhookModal, setWebhookModal] = useState<{ mode: 'edit' | 'create'; webhook: WebhookRow | null } | null>(null);
  const [confirmingWebhookDelete, setConfirmingWebhookDelete] = useState<WebhookRow | null>(null);

  const [infosTab, setInfosTab] = useState<InfosTab>('atualizacoes');
  const [integrationsTab, setIntegrationsTab] = useState<'api' | 'webhooks' | 'ia'>('api');

  const loadProfiles = useCallback(async () => {
    try {
      setProfiles(await api<Profile[]>('/profiles'));
    } catch (err) {
      toast.error(messageOf(err, 'Erro ao carregar os níveis de acesso'));
    } finally {
      setProfilesLoaded(true);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      setUsers(await api<UserRow[]>('/users'));
    } catch (err) {
      toast.error(messageOf(err, 'Erro ao carregar os usuários'));
    } finally {
      setUsersLoaded(true);
    }
  }, []);

  const loadRoles = useCallback(async () => {
    try {
      setRoles(await api<RoleRow[]>('/roles'));
    } catch (err) {
      toast.error(messageOf(err, 'Erro ao carregar os cargos'));
    } finally {
      setRolesLoaded(true);
    }
  }, []);

  const loadAllProjects = useCallback(async () => {
    try {
      setAllProjects(await api<ProjectOption[]>('/projects?all=1'));
    } catch (err) {
      toast.error(messageOf(err, 'Erro ao carregar os projetos'));
    } finally {
      setProjectsLoaded(true);
    }
  }, []);

  const loadViewPreferences = useCallback(async () => {
    try {
      const prefs = await fetchViewPreferences();
      setViewPrefs(prefs);
      setViewDraft(prefs);
    } catch (err) {
      toast.error(messageOf(err, 'Erro ao carregar as preferências de visualização'));
    } finally {
      setViewLoaded(true);
    }
  }, []);

  const loadSecurity = useCallback(async () => {
    try {
      const data = await api<{ defined: boolean; hint: string | null; gates: Record<string, boolean> }>(
        '/settings/security-password',
      );
      setSecurityDefined(data.defined);
      setSecurityGates(data.gates);
      setSecurityHintDraft(data.hint ?? '');
    } catch {
      setSecurityDefined(null);
    }
  }, []);

  const loadParameters = useCallback(async () => {
    try {
      const data = await api<{
        security_gate_all: boolean;
        security_password_defined: boolean;
        title_max_chars: number;
        description_max_chars: number;
        notification_prefs: Record<string, boolean>;
      }>('/settings/parameters');
      setParamGateAll(data.security_gate_all);
      setParamPasswordDefined(data.security_password_defined);
      setParamTitleMax(data.title_max_chars);
      setParamDescMax(data.description_max_chars);
      setTitleMaxDraft(String(data.title_max_chars));
      setDescMaxDraft(String(data.description_max_chars));
      setParamNotif(data.notification_prefs);
      setParamNotifBaseline(data.notification_prefs);
    } catch {
      setParamGateAll(null);
      setParamTitleMax(null);
      setParamDescMax(null);
      setParamNotif(null);
      setParamNotifBaseline(null);
    }
  }, []);

  const loadAudit = useCallback(async () => {
    if (!projectId) {
      setAuditRows([]);
      setAuditTotal(0);
      setAuditLoaded(true);
      return;
    }
    try {
      const params = new URLSearchParams({
        page: String(auditPage),
        limit: String(auditPageSize),
      });
      if (auditSearch) params.set('search', auditSearch);
      const data = await api<{ items: AuditRow[]; total: number }>(
        `/projects/${projectId}/audit?${params.toString()}`,
      );
      setAuditRows(data.items);
      setAuditTotal(data.total);
    } catch (err) {
      toast.error(messageOf(err, 'Erro ao carregar a auditoria'));
    } finally {
      setAuditLoaded(true);
    }
  }, [projectId, auditPage, auditPageSize, auditSearch]);

  const loadApiKeys = useCallback(async () => {
    try {
      setApiKeys(await api<ApiKeyRow[]>('/keys'));
    } catch (err) {
      toast.error(messageOf(err, 'Erro ao carregar as chaves de API'));
    } finally {
      setApiKeysLoaded(true);
    }
  }, []);

  const loadWebhooks = useCallback(async () => {
    try {
      setWebhooks(await api<WebhookRow[]>('/webhooks'));
    } catch (err) {
      toast.error(messageOf(err, 'Erro ao carregar os webhooks'));
    } finally {
      setWebhooksLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    setAccountName(user.name);
    setAccountColor(user.avatar_color ?? '');
    setAccountTextColor(user.avatar_text_color ?? '');
    setColorTouched(false);
    setTextColorTouched(false);
  }, [user]);

  useEffect(() => {
    if (section === 'conta') {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordError('');
      setPasswordModalOpen(false);
    }
    if (section === 'perfis') {
      setProfilesLoaded(false);
      void loadProfiles();
    }
    if (section === 'usuarios') {
      setUsersLoaded(false);
      void loadUsers();
      void loadRoles();
      void loadAllProjects();
    }
    if (section === 'cargos') {
      setRolesLoaded(false);
      void loadRoles();
      void loadProfiles();
    }
    if (section === 'layout') {
      setViewLoaded(false);
      void loadViewPreferences();
    }
    if (section === 'seguranca') {
      setSecurityDefined(null);
      setSecurityGates(null);
      setSecurityDraft('');
      setSecurityConfirmDraft('');
      setSecurityHintDraft('');
      void loadSecurity();
    }
    if (section === 'chaves') {
      setApiKeysLoaded(false);
      setWebhooksLoaded(false);
      void loadApiKeys();
      void loadWebhooks();
    }
    if (section === 'parametros') {
      setParamGateAll(null);
      setParamNotif(null);
      setParamNotifBaseline(null);
      void loadParameters();
    }
    if (section === 'auditoria') {
      setAuditLoaded(false);
      void loadAudit();
    }
  }, [
    section,
    loadProfiles,
    loadUsers,
    loadRoles,
    loadAllProjects,
    loadViewPreferences,
    loadSecurity,
    loadApiKeys,
    loadWebhooks,
    loadParameters,
    loadAudit,
  ]);

  useEffect(() => {
    if (!user) return;
    const permissions = user.profile.permissions;
    const allowed = SECTION_PERMISSIONS[section].some((key) => permissions.includes(key));
    if (allowed) return;
    const fallback = ALL_SECTIONS.find((item) =>
      SECTION_PERMISSIONS[item].some((key) => permissions.includes(key)),
    );
    if (fallback) setSection(fallback);
  }, [user, section]);

  async function removeProfile(profile: Profile) {
    if (!window.confirm(`Excluir o nível de acesso "${profile.name}"?`)) return;
    const result = await gate.guarded(async () => {
      await api(`/profiles/${profile.id}`, { method: 'DELETE' });
    });
    if (result.ok) {
      await loadProfiles();
      toast.success('Nível de acesso excluído.');
    }
  }

  async function removeRole(role: RoleRow) {
    if (!window.confirm(`Excluir o cargo "${role.name}"?`)) return;
    const result = await gate.guarded(async () => {
      await api(`/roles/${role.id}`, { method: 'DELETE' });
    });
    if (result.ok) {
      await loadRoles();
      toast.success('Cargo excluído.');
    }
  }

  function closeUserModal() {
    setUserModalMode(null);
    setUserModalTarget(null);
  }

  function closeRoleModal() {
    setRoleModalMode(null);
    setRoleModalTarget(null);
  }

  function closeProfileModal() {
    setProfileModalMode(null);
    setProfileModalTarget(null);
  }

  async function removeUser(userRow: UserRow) {
    if (!window.confirm(`Excluir o usuário "${userRow.name}"?`)) return;
    const result = await gate.guarded(async () => {
      await api(`/users/${userRow.id}`, { method: 'DELETE' });
    });
    if (result.ok) {
      await loadUsers();
      toast.success('Usuário excluído.');
    }
  }

  async function saveViewPreferences() {
    setViewBusy(true);
    try {
      const data = await api<{ preferences: ViewPreferences }>('/settings/view-preferences', {
        method: 'PUT',
        body: JSON.stringify(viewDraft),
      });
      setViewPrefs(data.preferences);
      setViewDraft(data.preferences);
      toast.success('Preferências de visualização salvas.');
    } catch (err) {
      toast.error(messageOf(err, 'Erro ao salvar as preferências de visualização'));
    } finally {
      setViewBusy(false);
    }
  }

  async function resetViewPreferences() {
    setViewBusy(true);
    try {
      const data = await api<{ preferences: ViewPreferences }>('/settings/view-preferences', {
        method: 'DELETE',
      });
      setViewPrefs(data.preferences);
      setViewDraft(data.preferences);
      toast.success('Preferências de visualização restauradas.');
    } catch (err) {
      toast.error(messageOf(err, 'Erro ao restaurar as preferências de visualização'));
    } finally {
      setViewBusy(false);
    }
  }

  async function saveSecurityPassword(event: FormEvent) {
    event.preventDefault();
    if (securityDraft.length < 4 || securityDraft !== securityConfirmDraft) return;
    try {
      const hint = securityHintDraft.trim();
      await api('/settings/security-password', {
        method: 'PUT',
        body: JSON.stringify({ password: securityDraft, hint: hint || undefined }),
      });
      setSecurityDraft('');
      setSecurityConfirmDraft('');
      setSecurityHintDraft('');
      setSecurityDefined(true);
      toast.success('Senha de segurança salva. Alterações estruturais pedem essa senha.');
    } catch (err) {
      toast.error(messageOf(err, 'Erro ao salvar a senha de segurança'));
    }
  }

  async function deleteSecurityPassword() {
    const confirmed = window.confirm(
      'Excluir a senha de segurança? Sem senha, alterações estruturais ficam liberadas até uma nova senha ser definida.',
    );
    if (!confirmed) return;
    try {
      await api('/settings/security-password', { method: 'DELETE' });
      setSecurityDefined(false);
      setSecurityDraft('');
      setSecurityConfirmDraft('');
      setSecurityHintDraft('');
      toast.success('Senha de segurança excluída.');
    } catch (err) {
      toast.error(messageOf(err, 'Erro ao excluir a senha de segurança'));
    }
  }

  async function toggleSecurityGate(area: string) {
    if (!securityGates) return;
    const next = !securityGates[area];
    try {
      await api('/settings/security-password/gates', {
        method: 'PATCH',
        body: JSON.stringify({ area, enabled: next }),
      });
      setSecurityGates((prev) => (prev ? { ...prev, [area]: next } : prev));
      toast.success(next ? `Proteção ativada para ${area}.` : `Proteção desativada para ${area}.`);
    } catch (err) {
      toast.error(messageOf(err, 'Erro ao alterar a proteção'));
    }
  }

  async function toggleSecurityGateAll() {
    if (paramGateAll === null || paramBusy) return;
    const next = !paramGateAll;
    setParamBusy(true);
    try {
      await api('/settings/parameters', {
        method: 'PUT',
        body: JSON.stringify({
          security_gate_all: next,
          title_max_chars: paramTitleMax ?? 200,
          description_max_chars: paramDescMax ?? 4000,
        }),
      });
      setParamGateAll(next);
      toast.success(
        next
          ? 'Exigência global de senha de segurança ativada.'
          : 'Exigência global de senha de segurança desativada.',
      );
    } catch (err) {
      toast.error(messageOf(err, 'Erro ao alterar o parâmetro'));
    } finally {
      setParamBusy(false);
    }
  }

  async function saveCharLimits(kind: 'title' | 'description') {
    if (paramGateAll === null || limitsBusy) return;
    const titleValue = Number(kind === 'title' ? titleMaxDraft : String(paramTitleMax ?? 200));
    const descValue = Number(kind === 'description' ? descMaxDraft : String(paramDescMax ?? 4000));
    const invalid =
      !Number.isInteger(titleValue) ||
      titleValue < 10 ||
      titleValue > 1000 ||
      !Number.isInteger(descValue) ||
      descValue < 100 ||
      descValue > 50000;
    if (invalid) {
      toast.error('Limites inválidos. Título: 10-1000. Descrição: 100-50000.');
      return;
    }
    setLimitsBusy(true);
    try {
      const data = await api<{ title_max_chars: number; description_max_chars: number }>(
        '/settings/parameters',
        {
          method: 'PUT',
          body: JSON.stringify({
            security_gate_all: paramGateAll,
            title_max_chars: titleValue,
            description_max_chars: descValue,
          }),
        },
      );
      setParamTitleMax(data.title_max_chars);
      setParamDescMax(data.description_max_chars);
      setTitleMaxDraft(String(data.title_max_chars));
      setDescMaxDraft(String(data.description_max_chars));
      toast.success(
        kind === 'title'
          ? 'Limite de caracteres do título salvo.'
          : 'Limite de caracteres da descrição salvo.',
      );
    } catch (err) {
      toast.error(messageOf(err, 'Erro ao salvar o limite'));
    } finally {
      setLimitsBusy(false);
    }
  }

  function toggleNotifPref(type: string) {
    if (notifBusy) return;
    setParamNotif((previous) => (previous ? { ...previous, [type]: !previous[type] } : previous));
  }

  const notifDirty =
    paramNotif !== null &&
    paramNotifBaseline !== null &&
    JSON.stringify(paramNotif) !== JSON.stringify(paramNotifBaseline);

  async function saveNotifPrefs() {
    if (paramGateAll === null || paramNotif === null || notifBusy) return;
    setNotifBusy(true);
    try {
      const data = await api<{ notification_prefs: Record<string, boolean> }>(
        '/settings/parameters',
        {
          method: 'PUT',
          body: JSON.stringify({
            security_gate_all: paramGateAll,
            title_max_chars: paramTitleMax ?? 200,
            description_max_chars: paramDescMax ?? 4000,
            notification_prefs: paramNotif,
          }),
        },
      );
      setParamNotif(data.notification_prefs);
      setParamNotifBaseline(data.notification_prefs);
      toast.success('Preferências de notificação salvas.');
    } catch (err) {
      toast.error(messageOf(err, 'Erro ao salvar as notificações'));
    } finally {
      setNotifBusy(false);
    }
  }

  async function saveAccount(event: FormEvent) {
    event.preventDefault();
    if (accountBusy) return;
    setAccountBusy(true);
    try {
      const body: {
        name?: string;
        avatar_color?: string | null;
        avatar_text_color?: string | null;
      } = {
        name: accountName.trim(),
      };
      if (colorTouched) body.avatar_color = accountColor || null;
      if (textColorTouched) body.avatar_text_color = accountTextColor || null;
      await api('/auth/me', { method: 'PATCH', body: JSON.stringify(body) });
      setColorTouched(false);
      setTextColorTouched(false);
      await refresh();
      toast.success('Dados da conta atualizados.');
    } catch (err) {
      toast.error(messageOf(err, 'Erro ao salvar os dados da conta'));
    } finally {
      setAccountBusy(false);
    }
  }

  async function changeMyPassword(event: FormEvent) {
    event.preventDefault();
    if (accountBusy) return;
    setPasswordError('');
    setAccountBusy(true);
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ current_password: currentPassword, password: newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordModalOpen(false);
      toast.success('Senha alterada com sucesso.');
    } catch (err) {
      setPasswordError(messageOf(err, 'Erro ao alterar a senha'));
    } finally {
      setAccountBusy(false);
    }
  }

  function applyAuditSearch() {
    setAuditPage(1);
    setAuditSearch(auditDraft.trim());
  }

  function clearAuditSearch() {
    setAuditDraft('');
    setAuditPage(1);
    setAuditSearch('');
  }

  if (!user) return null;
  const currentUser = user;

  function sectionVisible(id: Section): boolean {
    return SECTION_PERMISSIONS[id].some((key) => currentUser.profile.permissions.includes(key));
  }

  const visibleAccountGroup = ACCOUNT_GROUP.filter((item) => sectionVisible(item.id));

  function requireProject(content: ReactNode): ReactNode {
    if (projectId) return content;
    return (
      <div className="panel">
        <h2>Nenhum projeto selecionado</h2>
          <p>Selecione ou crie um projeto para gerenciar esta seção.</p>
      </div>
    );
  }

  function renderConta() {
    const avatarInitial = currentUser.name.trim().charAt(0).toUpperCase() || '?';
    const displayColor = accountColor || '#5b4fe9';
    const displayTextColor = accountTextColor || '#ffffff';
    const nameValid = accountName.trim().length >= 2;

    return (
      <div className="panel panel-list">
        <div className="panel-head">
          <div className="panel-head-text">
            <h2>Sua conta</h2>
            <p className="panel-desc">Seus dados de acesso, preferências visuais e permissões.</p>
          </div>
        </div>
        <div className="panel-list-body">
          <form onSubmit={(event) => void saveAccount(event)}>
            <div className="layout-row conta-avatar-row">
              <span
                className="avatar avatar-lg"
                style={{ backgroundColor: displayColor, color: displayTextColor }}
                aria-hidden="true"
              >
                {avatarInitial}
              </span>
              <div className="conta-colors">
                <div className="layout-row">
                  <span className="muted small">Cor de fundo</span>
                  <input
                    type="color"
                    value={displayColor}
                    onChange={(event) => {
                      setAccountColor(event.target.value);
                      setColorTouched(true);
                    }}
                    aria-label="Cor do fundo do avatar"
                  />
                  <span className="layout-hex">
                    {accountColor ? accountColor : 'Cor padrão'}
                  </span>
                </div>
                <div className="layout-row">
                  <span className="muted small">Cor da letra</span>
                  <input
                    type="color"
                    value={displayTextColor}
                    onChange={(event) => {
                      setAccountTextColor(event.target.value);
                      setTextColorTouched(true);
                    }}
                    aria-label="Cor da letra do avatar"
                  />
                  <span className="layout-hex">
                    {accountTextColor ? accountTextColor : 'Cor padrão'}
                  </span>
                </div>
              </div>
            </div>
            <div className="layout-row conta-form-row">
              <label className="field conta-field">
                <span>Nome de exibição</span>
                <input
                  value={accountName}
                  onChange={(event) => setAccountName(event.target.value)}
                  aria-label="Nome de exibição"
                  maxLength={80}
                />
              </label>
              <label className="field conta-field">
                <span>E-mail (somente leitura)</span>
                <input
                  readOnly
                  disabled
                  value={currentUser.email}
                  aria-label="E-mail (somente leitura)"
                  title="E-mail definido pelo administrador no convite"
                />
              </label>
            </div>
            <div className="layout-row conta-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setPasswordModalOpen(true)}
              >
                <LockIcon />
                Redefinir senha
              </button>
              <button type="submit" className="btn" disabled={accountBusy || !nameValid}>
                Salvar alterações
              </button>
            </div>
          </form>

          <div className="conta-divider" />

          <div className="conta-section-label">Permissões e acesso</div>
          <div className="layout-row">
            <span className="muted small">Perfil</span>
            <span className="pill pill-perm">{currentUser.profile.name}</span>
            <span className="muted small">Cargo</span>
            <span>{currentUser.role?.name ?? 'N/A'}</span>
          </div>
          <div className="layout-row">
            <span className="muted small">Telas</span>
            <span className="perm-pills">
              {currentUser.profile.screens.map((screen) => (
                <span key={screen} className="pill pill-perm">
                  {SCREEN_LABELS[screen] ?? screen}
                </span>
              ))}
            </span>
          </div>
          <div className="layout-row">
            <span className="muted small">Projetos</span>
            <span className="perm-pills">
              {currentUser.projects.length === 0 ? (
                <span className="muted small">Nenhum projeto atribuído</span>
              ) : (
                currentUser.projects.map((project) => (
                  <span key={project.id} className="pill pill-perm">
                    {project.name}
                    {!project.is_active && ' (inativo)'}
                  </span>
                ))
              )}
            </span>
          </div>
         <div className="layout-row">
            {/*<Link to="/esqueci-minha-senha">Gerar nova senha com o administrador</Link>*/}
          </div>
        </div>
      </div>
    );
  }

  function renderPasswordModal() {
    if (!passwordModalOpen) return null;
    const passwordMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
    const passwordValid =
      currentPassword.length > 0 && newPassword.length >= 8 && newPassword === confirmPassword;
    const passwordMessage =
      passwordError || (passwordMismatch ? 'As senhas não coincidem.' : '');

    function closePasswordModal() {
      setPasswordModalOpen(false);
      setPasswordError('');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }

    return (
      <div
        className="modal-backdrop"
        onClick={(event) => {
          if (event.target === event.currentTarget) closePasswordModal();
        }}
      >
        <div className="modal" role="dialog" aria-modal="true">
          <h3>Alterar minha senha</h3>
          {passwordMessage && <div className="error-box">{passwordMessage}</div>}
          <form onSubmit={(event) => void changeMyPassword(event)}>
            <label className="field">
              <span>Senha atual</span>
              <input
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                aria-label="Senha atual"
                autoComplete="current-password"
              />
            </label>
            <label className="field">
              <span>Nova senha</span>
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                aria-label="Nova senha"
                autoComplete="new-password"
              />
            </label>
            <label className="field">
              <span>Confirmar nova senha</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                aria-label="Confirmar nova senha"
                autoComplete="new-password"
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={closePasswordModal}>
                Cancelar
              </button>
              <button type="submit" className="btn" disabled={accountBusy || !passwordValid}>
                Atualizar senha
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  function renderPerfis() {
    const term = perfilSearch.trim().toLowerCase();
    const visible = term
      ? profiles.filter(
          (item) =>
            item.name.toLowerCase().includes(term) ||
            (item.description ?? '').toLowerCase().includes(term),
        )
      : profiles;
    const pages = Math.max(1, Math.ceil(visible.length / perfilPageSize));
    const page = Math.min(perfilPage, pages);
    const rows = visible.slice((page - 1) * perfilPageSize, page * perfilPageSize);
    return (
      <div className="panel panel-list">
        <div className="panel-head">
          <div className="panel-head-text">
            <h2>Níveis de acesso</h2>
            <p className="panel-desc">
              Defina quais telas e ações cada nível de acesso pode usar no sistema.
            </p>
          </div>
          <div className="panel-head-actions">
            <span className="search-box">
              <span className="search-icon" aria-hidden="true">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
              </span>
              <input
                className="settings-search"
                value={perfilSearch}
                onChange={(event) => {
                  setPerfilSearch(event.target.value);
                  setPerfilPage(1);
                }}
                placeholder="Buscar nível de acesso..."
                aria-label="Buscar nível de acesso"
              />
            </span>
            {can(currentUser, 'settings.niveis.novo') && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setProfileModalTarget(null);
                  setProfileModalMode('create');
                }}
              >
                Novo perfil
              </button>
            )}
          </div>
        </div>
        <div className="panel-list-body">
          {!profilesLoaded ? (
            <LoadingOverlay />
          ) : profiles.length === 0 ? (
            <p>
              Nenhum nível de acesso criado. Crie o primeiro nível para definir permissões.
            </p>
          ) : visible.length === 0 ? (
            <p>Nenhum nível de acesso encontrado.</p>
          ) : (
            <>
              <table className="table table-actions-center">
                <thead>
                  <tr>
                    <th>Perfil</th>
                    <th>Permissões principais</th>
                    <th>Usuários</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((profile) => (
                    <tr key={profile.id}>
                      <td>
                        <span className="profile-cell">
                          <span className="profile-text">
                            <strong>{profile.name}</strong>
                            <span className="muted small">
                              {profile.description || 'N/A'}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td>
                        {profile.screens.length === 0 ? (
                          <span className="muted small">N/A</span>
                        ) : (
                          <span className="perm-pills">
                            {profile.screens.map((screen) => (
                              <span key={screen} className="pill pill-perm">
                                {SCREEN_LABELS[screen] ?? screen}
                              </span>
                            ))}
                          </span>
                        )}
                      </td>
                      <td>{profile.users_count ?? 0}</td>
                      <td>
                        <TableActions
                          onEdit={
                            can(currentUser, 'settings.niveis.editar')
                              ? () => {
                                  setProfileModalTarget(profile);
                                  setProfileModalMode('edit');
                                }
                              : undefined
                          }
                          onDelete={
                            can(currentUser, 'settings.niveis.excluir')
                              ? () => void removeProfile(profile)
                              : undefined
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <PaginationFooter
                total={visible.length}
                page={page}
                pageSize={perfilPageSize}
                onPageChange={setPerfilPage}
                onPageSizeChange={(size) => {
                  setPerfilPageSize(size);
                  setPerfilPage(1);
                }}
              />
            </>
          )}
        </div>
      </div>
    );
  }

  function renderUsuarios() {
    const term = userSearch.trim().toLowerCase();
    const visible = term
      ? users.filter(
          (item) =>
            item.name.toLowerCase().includes(term) || item.email.toLowerCase().includes(term),
        )
      : users;
    const pages = Math.max(1, Math.ceil(visible.length / userPageSize));
    const page = Math.min(userPage, pages);
    const rows = visible.slice((page - 1) * userPageSize, page * userPageSize);
    return (
      <div className="panel panel-list">
        <div className="panel-head">
          <div className="panel-head-text">
            <h2>Usuários</h2>
            <p className="panel-desc">
              Pessoas com acesso ao sistema, o cargo de cada uma e a situação da conta.
            </p>
          </div>
          <div className="panel-head-actions">
            <span className="search-box">
              <span className="search-icon" aria-hidden="true">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
              </span>
              <input
                className="settings-search"
                value={userSearch}
                onChange={(event) => {
                  setUserSearch(event.target.value);
                  setUserPage(1);
                }}
                placeholder="Buscar usuário..."
                aria-label="Buscar usuário"
              />
            </span>
            {can(currentUser, 'settings.usuarios.novo') && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setUserModalTarget(null);
                  setUserModalMode('create');
                }}
              >
                Novo usuário
              </button>
            )}
          </div>
        </div>
        <div className="panel-list-body">
          {!usersLoaded ? (
            <LoadingOverlay />
          ) : visible.length === 0 ? (
            <p>Nenhum usuário encontrado.</p>
          ) : (
            <>
              <table className="table table-actions-center">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Email</th>
                    <th>Cargo</th>
                    <th>Situação</th>
                    <th>Último acesso</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.name}</strong>
                      </td>
                      <td className="muted">{item.email}</td>
                      <td>
                        {item.role_name ? (
                          item.role_name
                        ) : (
                          <span className="muted">Sem cargo</span>
                        )}
                      </td>
                      <td>
                        <span
                          className={`status-badge ${item.is_active ? 'status-ok' : 'status-off'}`}
                        >
                          <span className="status-dot" />
                          {item.is_active ? 'ATIVO' : 'INATIVO'}
                        </span>
                      </td>
                      <td className="muted">{formatLastAccess(item.last_login_at)}</td>
                      <td>
                        <TableActions
                          onEdit={
                            can(currentUser, 'settings.usuarios.editar')
                              ? () => {
                                  setUserModalTarget(item);
                                  setUserModalMode('edit');
                                }
                              : undefined
                          }
                          onDelete={
                            can(currentUser, 'settings.usuarios.excluir')
                              ? () => void removeUser(item)
                              : undefined
                          }
                          deleteDisabled={item.id === currentUser.id}
                          deleteTitle={
                            item.id === currentUser.id
                              ? 'Você não pode excluir o próprio usuário'
                              : undefined
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <PaginationFooter
                total={visible.length}
                page={page}
                pageSize={userPageSize}
                onPageChange={setUserPage}
                onPageSizeChange={(size) => {
                  setUserPageSize(size);
                  setUserPage(1);
                }}
              />
            </>
          )}
        </div>
      </div>
    );
  }

  function renderCargos() {
    const term = roleSearch.trim().toLowerCase();
    const visible = term
      ? roles.filter(
          (item) =>
            item.name.toLowerCase().includes(term) ||
            (item.description ?? '').toLowerCase().includes(term) ||
            item.profile_name.toLowerCase().includes(term),
        )
      : roles;
    const pages = Math.max(1, Math.ceil(visible.length / rolePageSize));
    const page = Math.min(rolePage, pages);
    const rows = visible.slice((page - 1) * rolePageSize, page * rolePageSize);
    return (
      <div className="panel panel-list">
        <div className="panel-head">
          <div className="panel-head-text">
            <h2>Cargos</h2>
            <p className="panel-desc">
              Papéis profissionais da equipe: cada cargo herda um nível de acesso e é
              atribuído aos usuários.
            </p>
          </div>
          <div className="panel-head-actions">
            <span className="search-box">
              <span className="search-icon" aria-hidden="true">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
              </span>
              <input
                className="settings-search"
                value={roleSearch}
                onChange={(event) => {
                  setRoleSearch(event.target.value);
                  setRolePage(1);
                }}
                placeholder="Buscar cargo..."
                aria-label="Buscar cargo"
              />
            </span>
            {can(currentUser, 'settings.cargos.novo') && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setRoleModalTarget(null);
                  setRoleModalMode('create');
                }}
              >
                Novo cargo
              </button>
            )}
          </div>
        </div>
        <div className="panel-list-body">
          {!rolesLoaded ? (
            <LoadingOverlay />
          ) : roles.length === 0 ? (
            <p>
              Nenhum cargo criado. Crie o primeiro cargo e escolha o nível de acesso que ele
              herda.
            </p>
          ) : visible.length === 0 ? (
            <p>Nenhum cargo encontrado.</p>
          ) : (
            <>
              <table className="table table-actions-center">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Descrição</th>
                    <th>Nível de Acesso</th>
                    <th>Usuários</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((role) => (
                    <tr key={role.id}>
                      <td>
                        <strong>{role.name}</strong>
                      </td>
                      <td className="muted">{role.description || 'N/A'}</td>
                      <td>{role.profile_name}</td>
                      <td>{role.users_count}</td>
                      <td>
                        <TableActions
                          onEdit={
                            can(currentUser, 'settings.cargos.editar')
                              ? () => {
                                  setRoleModalTarget(role);
                                  setRoleModalMode('edit');
                                }
                              : undefined
                          }
                          onDelete={
                            can(currentUser, 'settings.cargos.excluir')
                              ? () => void removeRole(role)
                              : undefined
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <PaginationFooter
                total={visible.length}
                page={page}
                pageSize={rolePageSize}
                onPageChange={setRolePage}
                onPageSizeChange={(size) => {
                  setRolePageSize(size);
                  setRolePage(1);
                }}
              />
            </>
          )}
        </div>
      </div>
    );
  }

  function renderTemas() {
    if (!viewLoaded) return <LoadingOverlay />;
    const dirty = JSON.stringify(viewDraft) !== JSON.stringify(viewPrefs);
    return (
      <div className="view-prefs">
        <fieldset className="screens-grid">
          <legend>Visão padrão</legend>
          <div className="view-mode-grid">
            {VIEW_MODES.map((mode) => {
              const on = viewDraft.mode === mode.id;
              return (
                <button
                  key={mode.id}
                  type="button"
                  className={`view-mode-card${on ? ' view-mode-on' : ''}`}
                  aria-pressed={on}
                  onClick={() => setViewDraft((prev) => ({ ...prev, mode: mode.id }))}
                >
                  <svg
                    className="view-mode-icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    {VIEW_MODE_PATHS[mode.id]}
                  </svg>
                  <span className="view-mode-name">{mode.label}</span>
                  <span className="view-mode-hint">{mode.hint}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        {viewDraft.mode === 'kanban' && (
          <fieldset className="screens-grid">
            <legend>Kanban</legend>
            <div className="view-row">
              <span className="view-label">Fundo do quadro</span>
              <div className="view-swatches">
                {VIEW_BACKGROUNDS.map((background) => (
                  <button
                    key={background.id}
                    type="button"
                    title={background.label}
                    aria-label={`Fundo ${background.label}`}
                    aria-pressed={viewDraft.kanban.background === background.id}
                    className={`view-swatch${
                      viewDraft.kanban.background === background.id ? ' view-swatch-on' : ''
                    }`}
                    style={{ backgroundColor: background.color }}
                    onClick={() =>
                      setViewDraft((prev) => ({
                        ...prev,
                        kanban: { ...prev.kanban, background: background.id },
                      }))
                    }
                  />
                ))}
              </div>
            </div>
            <Pills
              label="Cores das colunas"
              value={viewDraft.kanban.column_colors}
              options={[
                { id: 'status', label: 'Padrão por status' },
                { id: 'monocromatico', label: 'Monocromática' },
                { id: 'personalizado', label: 'Personalizada' },
              ]}
              onChange={(value) =>
                setViewDraft((prev) => ({ ...prev, kanban: { ...prev.kanban, column_colors: value } }))
              }
            />
            {viewDraft.kanban.column_colors === 'personalizado' && (
              <div className="view-row">
                <span className="view-label">Cor das colunas</span>
                <input
                  type="color"
                  value={viewDraft.kanban.custom_column_color ?? '#5b4fe9'}
                  onChange={(event) =>
                    setViewDraft((prev) => ({
                      ...prev,
                      kanban: { ...prev.kanban, custom_column_color: event.target.value },
                    }))
                  }
                  aria-label="Cor personalizada das colunas"
                />
                <span className="layout-hex">{viewDraft.kanban.custom_column_color ?? '#5b4fe9'}</span>
              </div>
            )}
            <Pills
              label="Densidade"
              value={viewDraft.kanban.density}
              options={[
                { id: 'completo', label: 'Completo' },
                { id: 'compacto', label: 'Compacto' },
              ]}
              onChange={(value) =>
                setViewDraft((prev) => ({ ...prev, kanban: { ...prev.kanban, density: value } }))
              }
            />
            <Pills
              label="Agrupar por"
              value={viewDraft.kanban.grouping}
              options={[
                { id: 'status', label: 'Por status' },
                { id: 'prioridade', label: 'Por prioridade' },
                { id: 'responsavel', label: 'Por responsável' },
              ]}
              onChange={(value) =>
                setViewDraft((prev) => ({ ...prev, kanban: { ...prev.kanban, grouping: value } }))
              }
            />
          </fieldset>
        )}

        {viewDraft.mode === 'lista' && (
          <fieldset className="screens-grid">
            <legend>Lista</legend>
            <Pills
              label="Densidade"
              value={viewDraft.lista.density}
              options={[
                { id: 'confortavel', label: 'Confortável' },
                { id: 'compacto', label: 'Compacto' },
              ]}
              onChange={(value) =>
                setViewDraft((prev) => ({ ...prev, lista: { ...prev.lista, density: value } }))
              }
            />
            <Pills
              label="Agrupar por"
              value={viewDraft.lista.grouping}
              options={[
                { id: 'status', label: 'Por status' },
                { id: 'prioridade', label: 'Por prioridade' },
                { id: 'setor', label: 'Por setor' },
                { id: 'responsavel', label: 'Por responsável' },
              ]}
              onChange={(value) =>
                setViewDraft((prev) => ({ ...prev, lista: { ...prev.lista, grouping: value } }))
              }
            />
            <Pills
              label="Ordenar por"
              value={viewDraft.lista.sort}
              options={[
                { id: 'criacao', label: 'Data de criação' },
                { id: 'prioridade', label: 'Prioridade' },
                { id: 'vencimento', label: 'Vencimento' },
              ]}
              onChange={(value) =>
                setViewDraft((prev) => ({ ...prev, lista: { ...prev.lista, sort: value } }))
              }
            />
          </fieldset>
        )}

        {viewDraft.mode === 'calendario' && (
          <fieldset className="screens-grid">
            <legend>Calendário</legend>
            <Pills
              label="Visão"
              value={viewDraft.calendario.view}
              options={[
                { id: 'dia', label: 'Dia' },
                { id: 'semana', label: 'Semana' },
                { id: 'mes', label: 'Mês' },
              ]}
              onChange={(value) =>
                setViewDraft((prev) => ({ ...prev, calendario: { ...prev.calendario, view: value } }))
              }
            />
            <Pills
              label="Colorir por"
              value={viewDraft.calendario.color_by}
              options={[
                { id: 'status', label: 'Status' },
                { id: 'prioridade', label: 'Prioridade' },
                { id: 'responsavel', label: 'Responsável' },
              ]}
              onChange={(value) =>
                setViewDraft((prev) => ({
                  ...prev,
                  calendario: { ...prev.calendario, color_by: value },
                }))
              }
            />
            <ViewToggle
              label="Mostrar tarefas sem data"
              checked={viewDraft.calendario.show_undated}
              onChange={(checked) =>
                setViewDraft((prev) => ({
                  ...prev,
                  calendario: { ...prev.calendario, show_undated: checked },
                }))
              }
            />
          </fieldset>
        )}

        {viewDraft.mode === 'gantt' && (
          <fieldset className="screens-grid">
            <legend>Gantt</legend>
            <Pills
              label="Escala"
              value={viewDraft.gantt.scale}
              options={[
                { id: 'semanal', label: 'Semanal' },
                { id: 'quinzenal', label: 'Quinzenal' },
                { id: 'mensal', label: 'Mensal' },
              ]}
              onChange={(value) =>
                setViewDraft((prev) => ({ ...prev, gantt: { ...prev.gantt, scale: value } }))
              }
            />
            <Pills
              label="Colorir por"
              value={viewDraft.gantt.color_by}
              options={[
                { id: 'status', label: 'Status' },
                { id: 'prioridade', label: 'Prioridade' },
                { id: 'responsavel', label: 'Responsável' },
              ]}
              onChange={(value) =>
                setViewDraft((prev) => ({ ...prev, gantt: { ...prev.gantt, color_by: value } }))
              }
            />
            <ViewToggle
              label="Mostrar dependências"
              checked={viewDraft.gantt.show_dependencies}
              onChange={(checked) =>
                setViewDraft((prev) => ({
                  ...prev,
                  gantt: { ...prev.gantt, show_dependencies: checked },
                }))
              }
            />
            <ViewToggle
              label="Mostrar marcos"
              checked={viewDraft.gantt.show_milestones}
              onChange={(checked) =>
                setViewDraft((prev) => ({
                  ...prev,
                  gantt: { ...prev.gantt, show_milestones: checked },
                }))
              }
            />
          </fieldset>
        )}

        <div className="shortcut-actions">
          <button
            type="button"
            className="btn"
            disabled={viewBusy || !dirty}
            onClick={() => void saveViewPreferences()}
          >
            Salvar
          </button>
          <button
            type="button"
            className="btn btn-plain"
            disabled={viewBusy}
            onClick={() => void resetViewPreferences()}
          >
            Restaurar padrão
          </button>
        </div>
      </div>
    );
  }

  function renderInfosAtualizacoes() {
    return (
      <div className="infos-updates">
        <div className="infos-version">{APP_BADGE}</div>
        <div className="infos-releases">
          {RELEASES.map((release) => (
            <div className="infos-release" key={release.version}>
              <div className="infos-release-head">
                <strong>Trilho {release.version}</strong>
                <span className="infos-release-date">{release.date}</span>
              </div>
              <ul className="infos-notes">
                {release.notes.map((note) => (
                  <li className="infos-note" key={note.text}>
                    <span className={`rel-tag rel-tag-${note.kind}`}>
                      {RELEASE_NOTE_LABELS[note.kind]}
                    </span>
                    <span>{note.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderInfosSuporte() {
    return (
      <div className="infos-card">
        <div className="infos-card-row">
          <span className="infos-card-icon" aria-hidden="true">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </span>
          <span className="infos-card-title">Abertura de chamado técnico</span>
          <span className="pill">Em desenvolvimento</span>
        </div>
        <p className="infos-card-desc">
          O envio de chamados internos para a equipe do Trilho estará disponível em breve.
        </p>
      </div>
    );
  }

  function renderInfosManuais() {
    return (
      <div>
        <div className="infos-manuals">
          {MANUALS.map((manual) => (
            <div className="infos-manual" key={manual.id}>
              <div className="infos-manual-head">
                <span className="infos-card-icon" aria-hidden="true">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <path d="M14 2v6h6" />
                    <path d="M16 13H8" />
                    <path d="M16 17H8" />
                  </svg>
                </span>
                <span className="infos-manual-title">{manual.title}</span>
              </div>
              <button className="btn btn-plain" type="button" disabled>
                Em desenvolvimento
              </button>
            </div>
          ))}
        </div>
        <p className="infos-card-desc">
          Os manuais estarão disponíveis para acesso e download nesta tela.
        </p>
      </div>
    );
  }

  function renderInfosFaq() {
    return (
      <div className="infos-faq">
        {FAQ_ITEMS.map((item) => (
          <details className="infos-faq-item" key={item.question}>
            <summary className="infos-faq-q">{item.question}</summary>
            <p className="infos-faq-a">{item.answer}</p>
          </details>
        ))}
      </div>
    );
  }

  function renderInfosDuvidas() {
    return (
      <form className="infos-form" onSubmit={(event) => event.preventDefault()}>
        <div className="infos-dev-row">
          <span className="pill">Em desenvolvimento</span>
          <span className="infos-card-desc">O formulário será ativado em breve.</span>
        </div>
        <label className="field">
          <span>Nome</span>
          <input value={currentUser.name} readOnly disabled />
        </label>
        <label className="field">
          <span>E-mail</span>
          <input value={currentUser.email} readOnly disabled />
        </label>
        <label className="field">
          <span>Assunto</span>
          <input disabled />
        </label>
        <label className="field">
          <span>Mensagem</span>
          <textarea rows={4} disabled />
        </label>
        <div className="infos-form-actions">
          <button className="btn" type="button" disabled>
            Enviar
          </button>
        </div>
      </form>
    );
  }

  function renderInfos() {
    return (
      <div className="panel panel-list">
        <div className="panel-head">
          <div className="panel-head-text">
            <h2>Infos Trilho</h2>
            <p className="panel-desc">Central de informações, suporte e atualizações do Trilho.</p>
          </div>
        </div>
        <div className="settings-card-tabs">
          <div className="tabs" role="tablist" aria-label="Abas de informações do Trilho">
            {INFOS_TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={infosTab === item.id}
                className={`tab${infosTab === item.id ? ' tab-active' : ''}`}
                onClick={() => setInfosTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="panel-list-body">
          {infosTab === 'atualizacoes' && renderInfosAtualizacoes()}
          {infosTab === 'suporte' && renderInfosSuporte()}
          {infosTab === 'manuais' && renderInfosManuais()}
          {infosTab === 'faq' && renderInfosFaq()}
          {infosTab === 'duvidas' && renderInfosDuvidas()}
          <p className="infos-footer">
            Projetado, desenvolvido e mantido por Stando • Todos os direitos reservados.
          </p>
        </div>
      </div>
    );
  }

  function renderLayout() {
    return (
      <div className="panel panel-list">
        <div className="panel-head">
          <div className="panel-head-text">
            <h2>Temas</h2>
            <p className="panel-desc">
              Escolha a visão padrão do quadro de tarefas, as cores e a densidade. As preferências
              valem para todo o ambiente.
            </p>
          </div>
        </div>
        <div className="panel-list-body">{renderTemas()}</div>
      </div>
    );
  }

  function renderSeguranca() {
    if (securityDefined === null) {
      return <LoadingOverlay />;
    }
    const mismatch = securityConfirmDraft.length > 0 && securityDraft !== securityConfirmDraft;
    const canSave = securityDraft.length >= 4 && !mismatch;
    const protectedAreas = [
      {
        gateKey: 'home',
        name: 'Início',
        description: 'Criar, editar ou excluir eventos do Calendário/Agenda',
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        ),
      },
      {
        gateKey: 'dashboard',
        name: 'Dashboard',
        description: 'Editar ou excluir projetos recentes',
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
          </svg>
        ),
      },
      {
        gateKey: 'board',
        name: 'Quadro',
        description: 'Criar, mover, editar ou excluir cards do quadro',
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" />
          </svg>
        ),
      },
      {
        gateKey: 'base',
        name: 'Base',
        description: 'Criar, editar ou excluir setores e departamentos',
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
          </svg>
        ),
      },
      {
        gateKey: 'users',
        name: 'Usuários e permissões',
        description: 'Criar, editar ou excluir usuários, cargos e níveis',
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        ),
      },
      {
        gateKey: 'integrations',
        name: 'Integrações',
        description: 'Gerar ou revogar chaves de API e webhooks',
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        ),
      },
    ];
    return (
      <>
      <div className="scope-layout">
        <div className="panel scope-form-card">
          <div className="panel-head">
            <div className="panel-head-text">
              <h2>Senha de Segurança</h2>
              <p className="panel-desc">Proteção para alterações estruturais</p>
            </div>
          </div>
          <div className="scope-info-block">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span>Enquanto não houver senha definida, alterações estruturais são liberadas para todos os usuários com permissão.</span>
          </div>
          <form onSubmit={(event) => void saveSecurityPassword(event)}>
            <div className="scope-form-grid">
              <label className="field">
                <span>Nova senha</span>
                <div className="pw-wrap">
                  <input
                    type="password"
                    value={securityDraft}
                    onChange={(event) => setSecurityDraft(event.target.value)}
                    minLength={4}
                    placeholder={securityDefined ? '••••••••' : undefined}
                    aria-label="Nova senha de segurança"
                  />
                </div>
              </label>
              <label className="field">
                <span>Confirmar senha</span>
                <div className="pw-wrap">
                  <input
                    type="password"
                    value={securityConfirmDraft}
                    onChange={(event) => setSecurityConfirmDraft(event.target.value)}
                    placeholder={securityDefined ? '••••••••' : undefined}
                    aria-label="Confirmar senha de segurança"
                  />
                </div>
              </label>
            </div>
            {mismatch && <p className="scope-error">As senhas não coincidem.</p>}
            <label className="field">
              <span>Dica da senha (opcional)</span>
              <input
                value={securityHintDraft}
                onChange={(event) => setSecurityHintDraft(event.target.value)}
                placeholder="Ex.: data de fundação da empresa"
                maxLength={140}
              />
            </label>
            <div className="scope-form-actions">
              <button type="submit" className="btn" disabled={!canSave}>
                Salvar senha
              </button>
            </div>
          </form>
        </div>
        <div className="scope-right-col">
          <div className="panel scope-protected-card">
            <h3>Onde a senha é solicitada</h3>
            <div className="scope-protected-list">
              {protectedAreas.map((area) => (
                <div key={area.name} className="scope-protected-item">
                  <div className="scope-protected-icon">{area.icon}</div>
                  <div className="scope-protected-text">
                    <strong>{area.name}</strong>
                    <span>{area.description}</span>
                  </div>
                  {securityDefined && securityGates ? (
                    <label className="conexoes-toggle" title={securityGates[area.gateKey] ? 'Protegido' : 'Livre'}>
                      <input
                        type="checkbox"
                        checked={securityGates[area.gateKey] ?? true}
                        onChange={() => void toggleSecurityGate(area.gateKey)}
                        aria-label={`Proteção de ${area.name}`}
                      />
                      <span className="conexoes-toggle-slider" />
                    </label>
                  ) : (
                    <span className="pill">Livre</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {securityDefined && (
        <div className="panel scope-reset-card">
          <h3>Redefinir senha</h3>
          <p>Remove a senha atual e libera as alterações estruturais.</p>
          <button type="button" className="btn btn-danger" onClick={() => void deleteSecurityPassword()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1" />
            </svg>
            Remover senha
          </button>
        </div>
      )}
      </>
    );
  }

  function renderParametros() {
    if (paramGateAll === null || paramNotif === null) {
      return <LoadingOverlay />;
    }
    return (
      <div className="panel panel-list">
        <div className="panel-head">
          <div className="panel-head-text">
            <h2>Parâmetros</h2>
            <p className="panel-desc">Comportamento global do sistema</p>
          </div>
        </div>
        <div className="panel-list-body">
          <div className="scope-protected-list">
            <div className="scope-protected-item">
              <div className="scope-protected-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <div className="scope-protected-text">
                <strong>Exigir Senha de Segurança para Qualquer Edição</strong>
                <span>
                  Quando ativo, qualquer alteração no sistema solicita a senha de segurança,
                  independentemente das áreas protegidas. Exceções: login, convite, redefinição
                  de senha e logout.
                </span>
                {!paramPasswordDefined && (
                  <span className="pill pill-danger" style={{ marginTop: 6, alignSelf: 'flex-start' }}>
                    Defina a senha de segurança primeiro
                  </span>
                )}
              </div>
              <label className="conexoes-toggle" title={paramGateAll ? 'Ativo' : 'Inativo'}>
                <input
                  type="checkbox"
                  checked={paramGateAll}
                  disabled={!paramPasswordDefined || paramBusy}
                  onChange={() => void toggleSecurityGateAll()}
                  aria-label="Exigir senha de segurança para qualquer edição"
                />
                <span className="conexoes-toggle-slider" />
              </label>
            </div>
            <div className="scope-protected-item" style={{ alignItems: 'flex-start' }}>
              <div className="scope-protected-icon" style={{ marginTop: 2 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 7V4h16v3" />
                  <path d="M9 20h6" />
                  <path d="M12 4v16" />
                </svg>
              </div>
              <div className="scope-protected-text" style={{ flex: 1 }}>
                <strong>Limite de caracteres dos cards</strong>
                <span>
                  Tamanho máximo de título e descrição aceitos ao criar ou editar cards do Kanban.
                  Cards já salvos acima do novo limite só ficam bloqueados na próxima edição.
                </span>
                <div className="limits-row">
                  <label className="limits-field">
                    <span>Título (10–1000)</span>
                    <input
                      type="number"
                      min={10}
                      max={1000}
                      value={titleMaxDraft}
                      disabled={limitsBusy}
                      onChange={(event) => setTitleMaxDraft(event.target.value)}
                      aria-label="Limite de caracteres do título"
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={limitsBusy || titleMaxDraft === String(paramTitleMax ?? '')}
                    onClick={() => void saveCharLimits('title')}
                  >
                    Salvar
                  </button>
                </div>
                <div className="limits-row">
                  <label className="limits-field">
                    <span>Descrição (100–50000)</span>
                    <input
                      type="number"
                      min={100}
                      max={50000}
                      value={descMaxDraft}
                      disabled={limitsBusy}
                      onChange={(event) => setDescMaxDraft(event.target.value)}
                      aria-label="Limite de caracteres da descrição"
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={limitsBusy || descMaxDraft === String(paramDescMax ?? '')}
                    onClick={() => void saveCharLimits('description')}
                  >
                    Salvar
                  </button>
                </div>
                <table className="limits-reco">
                  <thead>
                    <tr>
                      <th>Tamanho</th>
                      <th>Título sugerido</th>
                      <th>Descrição sugerida</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Mínimo</td>
                      <td>100–250</td>
                      <td>~500</td>
                    </tr>
                    <tr>
                      <td>Médio (recomendado)</td>
                      <td>~200</td>
                      <td>~4000</td>
                    </tr>
                    <tr>
                      <td>Grande</td>
                      <td>~1000</td>
                      <td>~20000+</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div className="scope-protected-item" style={{ alignItems: 'flex-start' }}>
              <div className="scope-protected-icon" style={{ marginTop: 2 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
              </div>
              <div className="scope-protected-text" style={{ flex: 1 }}>
                <strong>Notificações</strong>
                <span>
                  Escolha quais notificações serão geradas no sino para todos os usuários do sistema.
                </span>
                <div className="notif-grid">
                  {NOTIF_OPTIONS.map((option) => {
                    const enabled = paramNotif[option.type] ?? true;
                    return (
                      <div key={option.type} className="notif-option">
                        <span>{option.label}</span>
                        <label className="conexoes-toggle" title={enabled ? 'Ativo' : 'Inativo'}>
                          <input
                            type="checkbox"
                            checked={enabled}
                            disabled={notifBusy}
                            onChange={() => toggleNotifPref(option.type)}
                            aria-label={option.label}
                          />
                          <span className="conexoes-toggle-slider" />
                        </label>
                      </div>
                    );
                  })}
                </div>
                <div className="limits-row">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={notifBusy || !notifDirty}
                    onClick={() => void saveNotifPrefs()}
                  >
                    Salvar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderAuditoria() {
    return (
      <div className="panel panel-list">
        <div className="panel-head">
          <div className="panel-head-text">
            <h2>Auditoria</h2>
            <p className="panel-desc">Histórico de ações registradas neste projeto.</p>
          </div>
          <div className="panel-head-actions">
            <span className="search-box">
              <span className="search-icon" aria-hidden="true">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
              </span>
              <input
                className="settings-search"
                value={auditDraft}
                onChange={(event) => setAuditDraft(event.target.value)}
                placeholder="Buscar usuário"
                aria-label="Buscar usuário na auditoria"
              />
            </span>
            <button type="button" className="btn" onClick={() => applyAuditSearch()}>
              Buscar
            </button>
            {auditSearch && (
              <button type="button" className="btn btn-plain" onClick={clearAuditSearch}>
                Limpar
              </button>
            )}
          </div>
        </div>
        <div className="panel-list-body">
          {!auditLoaded ? (
            <LoadingOverlay />
          ) : auditRows.length === 0 ? (
            <p>Nenhum registro encontrado.</p>
          ) : (
            <>
              <table className="table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Usuário</th>
                    <th>Ação</th>
                    <th>Detalhes</th>
                    <th>Código do Card</th>
                  </tr>
                </thead>
                <tbody>
                  {auditRows.map((row) => (
                    <tr key={row.id}>
                      <td>{new Date(row.created_at).toLocaleString('pt-BR')}</td>
                      <td>
                        <strong>{row.user_name ?? 'Sistema'}</strong>
                        {row.user_email && <div className="muted small">{row.user_email}</div>}
                      </td>
                      <td>{AUDIT_ACTION_LABELS[row.action] ?? row.action}</td>
                      <td className="muted">{row.detail || 'N/A'}</td>
                      <td>{row.task_code ?? 'N/A'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <PaginationFooter
                total={auditTotal}
                page={auditPage}
                pageSize={auditPageSize}
                onPageChange={setAuditPage}
                onPageSizeChange={(size) => {
                  setAuditPageSize(size);
                  setAuditPage(1);
                }}
              />
            </>
          )}
        </div>
      </div>
    );
  }

  async function revokeApiKey(key: ApiKeyRow) {
    if (!window.confirm(`Revogar a chave "${key.name}"? Passa a recusar qualquer acesso com ela.`)) {
      return;
    }
    const result = await gate.guarded(async () => {
      await api(`/keys/${key.id}`, { method: 'DELETE' });
    });
    if (result.ok) {
      toast.success('Chave de API revogada.');
      await loadApiKeys();
    }
  }

  async function deleteApiKey(key: ApiKeyRow) {
    setConfirmingKeyDelete(null);
    const result = await gate.guarded(async () => {
      await api(`/keys/${key.id}`, { method: 'DELETE' });
    });
    if (result.ok) {
      toast.success('Chave de API excluída permanentemente.');
      await loadApiKeys();
    }
  }

  async function deleteWebhook(webhook: WebhookRow) {
    setConfirmingWebhookDelete(null);
    const result = await gate.guarded(async () => {
      await api(`/webhooks/${webhook.id}`, { method: 'DELETE' });
    });
    if (result.ok) {
      toast.success('Webhook excluído.');
      await loadWebhooks();
    }
  }

  async function copyApiKey(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Chave copiada.');
    } catch {
      toast.error('Não foi possível copiar automaticamente. Selecione o texto e copie manualmente.');
    }
  }

  function renderChaves() {
    return (
      <div className="panel panel-list">
        <div className="panel-head">
          <div className="panel-head-text">
            <h2>Integrações</h2>
            <p className="panel-desc">
              Conecte o Trilho a serviços externos: chaves de API e webhooks.
            </p>
          </div>
        </div>
        <div className="panel-list-body">
          <div className="tabs integrations-tabs">
            <button
              type="button"
              className={`tab${integrationsTab === 'api' ? ' tab-active' : ''}`}
              onClick={() => setIntegrationsTab('api')}
            >
              API
            </button>
            <button
              type="button"
              className={`tab${integrationsTab === 'webhooks' ? ' tab-active' : ''}`}
              onClick={() => setIntegrationsTab('webhooks')}
            >
              Webhooks
            </button>
            <button
              type="button"
              className={`tab${integrationsTab === 'ia' ? ' tab-active' : ''}`}
              onClick={() => setIntegrationsTab('ia')}
            >
              IA <span className="tab-badge">Em breve</span>
            </button>
          </div>
          {integrationsTab === 'api' && renderApiTab()}
          {integrationsTab === 'webhooks' && (
            <div className="integrations-webhooks">
              <button
                type="button"
                className="integrations-add-dashed"
                onClick={() => setWebhookModal({ mode: 'create', webhook: null })}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14" /><path d="M5 12h14" />
                </svg>
                Novo webhook
              </button>
              {!webhooksLoaded ? (
                <LoadingOverlay />
              ) : webhooks.length === 0 ? (
                <p className="integrations-empty">Nenhum webhook configurado.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Nome</th>
                      <th>URL</th>
                      <th>Sistema Destino</th>
                      <th>Eventos</th>
                      <th>Status</th>
                      <th>Criado por</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {webhooks.map((hook) => (
                      <tr key={hook.id}>
                        <td>
                          <strong>{hook.name}</strong>
                        </td>
                        <td>
                          <code className="webhook-url">{hook.url}</code>
                        </td>
                        <td>
                          <span className="chip chip-system">
                            {WEBHOOK_SYSTEM_LABELS[hook.system] ?? hook.system}
                          </span>
                        </td>
                        <td>
                          {hook.events.length >= WEBHOOK_EVENTS.length ? (
                            <span className="chip chip-events-all">Todos os Eventos</span>
                          ) : (
                            <span className="chips-inline">
                              {hook.events.map((value) => (
                                <span key={value} className="chip chip-event" title={value}>
                                  {WEBHOOK_EVENT_LABELS[value] ?? value}
                                </span>
                              ))}
                            </span>
                          )}
                        </td>
                        <td>
                          <span className={`pill ${hook.active ? 'pill-ok' : 'pill-danger'}`}>
                            {hook.active ? 'Ativo' : 'Inativo'}
                          </span>
                        </td>
                        <td>{hook.created_by_name}</td>
                        <td>
                          <div className="key-actions-cell">
                            <button
                              type="button"
                              className="icon-btn"
                              aria-label="Editar webhook"
                              title="Editar webhook"
                              onClick={() => setWebhookModal({ mode: 'edit', webhook: hook })}
                            >
                              ✏️
                            </button>
                            <button
                              type="button"
                              className="icon-btn"
                              aria-label="Excluir webhook"
                              title="Excluir webhook"
                              onClick={() => setConfirmingWebhookDelete(hook)}
                            >
                              🗑️
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
          {integrationsTab === 'ia' && (
            <div className="ia-preview">
              <div className="ia-preview-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5V12h2a2 2 0 0 1 2 2v1h1a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-1a2 2 0 0 1 2-2h1v-1a2 2 0 0 1 2-2h2V9.5A4 4 0 0 1 12 2z" />
                  <circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" />
                </svg>
              </div>
              <h3>Inteligência Artificial</h3>
              <p>Integração com modelos de IA para automações e sugestões dentro do sistema.</p>
              <span className="pill pill-warn">Em breve</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderApiTab() {
    return (
      <>
        <button
          type="button"
          className="integrations-add-dashed"
          onClick={() => setApiKeyModalOpen(true)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14" /><path d="M5 12h14" />
          </svg>
          Nova chave
        </button>
        {!apiKeysLoaded ? (
          <LoadingOverlay />
        ) : apiKeys.length === 0 ? (
          <p className="integrations-empty">Nenhuma chave de API criada.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Criado por</th>
                <th>Criado em</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {apiKeys.map((key) => (
                <tr key={key.id}>
                  <td>
                    <div className="key-name-cell">
                      <strong>{key.name}</strong>
                      <code className="key-masked">
                        trl_••••••••{key.key_suffix ?? '????'}
                      </code>
                    </div>
                  </td>
                  <td>{key.created_by_name}</td>
                  <td>{new Date(key.created_at).toLocaleString('pt-BR')}</td>
                  <td>
                    <div className="key-actions-cell">
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="Copiar chave"
                        title="Copiar prefixo da chave"
                        onClick={() =>
                          void copyApiKey(`trl_••••••••${key.key_suffix ?? ''}`)
                        }
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      </button>
                      {!key.revoked_at && (
                        <button
                          type="button"
                          className="icon-btn icon-btn-danger"
                          aria-label="Revogar"
                          title="Revogar chave"
                          onClick={() => void revokeApiKey(key)}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      )}
                      {key.revoked_at && (
                        <button
                          type="button"
                          className="icon-btn icon-btn-danger"
                          aria-label="Excluir"
                          title="Excluir chave revogada"
                          onClick={() => setConfirmingKeyDelete(key)}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" x2="10" y1="11" y2="17" /><line x1="14" x2="14" y1="11" y2="17" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </>
    );
  }

  function renderSection(): ReactNode {
    if (!sectionVisible(section)) return null;
    switch (section) {
      case 'conta':
        return renderConta();
      case 'perfis':
        return renderPerfis();
      case 'usuarios':
        return renderUsuarios();
      case 'cargos':
        return renderCargos();
      case 'layout':
        return renderLayout();
      case 'seguranca':
        return renderSeguranca();
      case 'chaves':
        return renderChaves();
      case 'parametros':
        return renderParametros();
      case 'auditoria':
        return requireProject(renderAuditoria());
      case 'infos':
        return renderInfos();
    }
  }

  const navItem = (item: { id: Section; label: string; icon?: ReactNode }) => (
    <button
      key={item.id}
      type="button"
      className={section === item.id ? 'settings-nav-active' : undefined}
      aria-current={section === item.id ? 'page' : undefined}
      onClick={() => setSection(item.id)}
    >
      {item.icon && <span className="settings-nav-info-icon">{item.icon}</span>}
      {item.label}
    </button>
  );

  const toggleAccountGroup = () => {
    if (accountGroupOpen) {
      setAccountGroupOpen(false);
      return;
    }
    setAccountGroupOpen(true);
    if (!ACCOUNT_GROUP_IDS.includes(section)) setSection('usuarios');
  };

  const accountGroupActive = ACCOUNT_GROUP_IDS.includes(section);

  return (
    <div>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Seções de configuração">
          <div className="settings-nav-label">WORKSPACE</div>
          {sectionVisible(LEADING_SECTION.id) && navItem(LEADING_SECTION)}
          {visibleAccountGroup.length > 0 && (
            <button
              type="button"
              className={
                accountGroupActive
                  ? 'settings-nav-group settings-nav-group-active'
                  : 'settings-nav-group'
              }
              aria-expanded={accountGroupOpen}
              aria-controls="settings-nav-account-group"
              onClick={toggleAccountGroup}
            >
              Usuários e Permissões
              <GroupCaret open={accountGroupOpen} />
            </button>
          )}
          <div
            id="settings-nav-account-group"
            className={
              accountGroupOpen
                ? 'settings-nav-submenu settings-nav-submenu-open'
                : 'settings-nav-submenu'
            }
          >
            {visibleAccountGroup.map(navItem)}
          </div>
          <div className="settings-nav-label">SISTEMA</div>
          {TRAILING_SECTIONS.filter(
            (item) => item.id !== 'infos' && sectionVisible(item.id),
          ).map(navItem)}
          {sectionVisible('infos') && (
            <>
              <div className="settings-nav-divider" role="separator" />
              {TRAILING_SECTIONS.filter((item) => item.id === 'infos').map(navItem)}
            </>
          )}
        </nav>

        <div className="settings-content">{renderSection()}</div>
      </div>

      {renderPasswordModal()}

      {profileModalMode && (
        <ProfileModal
          mode={profileModalMode}
          profile={profileModalMode === 'edit' ? profileModalTarget : null}
          gate={gate}
          onClose={closeProfileModal}
          onSaved={() => void loadProfiles()}
        />
      )}

      {roleModalMode && (
        <RoleModal
          mode={roleModalMode}
          role={roleModalMode === 'edit' ? roleModalTarget : null}
          profiles={profiles}
          profilesLoaded={profilesLoaded}
          gate={gate}
          onClose={closeRoleModal}
          onSaved={() => void loadRoles()}
        />
      )}

      {userModalMode && (
        <UserModal
          mode={userModalMode}
          user={userModalMode === 'edit' ? userModalTarget : null}
          roles={roles}
          rolesLoaded={rolesLoaded}
          projects={allProjects}
          projectsLoaded={projectsLoaded}
          currentUserId={currentUser.id}
          gate={gate}
          onClose={closeUserModal}
          onSaved={() => void loadUsers()}
        />
      )}

      {apiKeyModalOpen && (
        <ApiKeyModal
          gate={gate}
          onClose={() => setApiKeyModalOpen(false)}
          onSaved={() => void loadApiKeys()}
        />
      )}

      {webhookModal && (
        <WebhookModal
          mode={webhookModal.mode}
          webhook={webhookModal.webhook}
          gate={gate}
          onClose={() => setWebhookModal(null)}
          onSaved={() => void loadWebhooks()}
        />
      )}

      <ConfirmDialog
        open={confirmingKeyDelete !== null}
        title="Excluir chave"
        message={`Excluir permanentemente a chave "${confirmingKeyDelete?.name}"? Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        onConfirm={() => {
          if (confirmingKeyDelete) void deleteApiKey(confirmingKeyDelete);
        }}
        onCancel={() => setConfirmingKeyDelete(null)}
      />

      <ConfirmDialog
        open={confirmingWebhookDelete !== null}
        title="Excluir webhook"
        message={`Excluir o webhook "${confirmingWebhookDelete?.name}"? Ele deixará de receber eventos imediatamente.`}
        confirmLabel="Excluir"
        onConfirm={() => {
          if (confirmingWebhookDelete) void deleteWebhook(confirmingWebhookDelete);
        }}
        onCancel={() => setConfirmingWebhookDelete(null)}
      />

      <SecurityPrompt gate={gate} />
    </div>
  );
}
