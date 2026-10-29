import { hash, verify } from '@node-rs/argon2';
import { ApiError } from '../middleware/errors.js';
import { pool, queryOne } from '../db/pool.js';

export const SECURITY_PASSWORD_HEADER = 'x-security-password';

export type SecurityArea =
  | 'base'
  | 'users'
  | 'settings'
  | 'integrations'
  | 'home'
  | 'dashboard'
  | 'board';

const AREA_COLUMNS: Record<SecurityArea, string> = {
  base: 'security_gate_base',
  users: 'security_gate_users',
  settings: 'security_gate_settings',
  integrations: 'security_gate_integrations',
  home: 'security_gate_home',
  dashboard: 'security_gate_dashboard',
  board: 'security_gate_board',
};

interface SecurityRow {
  security_password_hash: string | null;
  security_password_hint: string | null;
  security_gate_all: boolean;
  security_gate_base: boolean;
  security_gate_users: boolean;
  security_gate_settings: boolean;
  security_gate_integrations: boolean;
  security_gate_home: boolean;
  security_gate_dashboard: boolean;
  security_gate_board: boolean;
  title_max_chars: number;
  description_max_chars: number;
}

export interface CardCharLimits {
  title_max_chars: number;
  description_max_chars: number;
}

async function currentSecurity(): Promise<SecurityRow> {
  const result = await pool.query<SecurityRow>(
    `SELECT security_password_hash, security_password_hint,
            security_gate_all, security_gate_base, security_gate_users,
            security_gate_settings, security_gate_integrations,
            security_gate_home, security_gate_dashboard, security_gate_board,
            title_max_chars, description_max_chars
     FROM system_settings WHERE id = 1`,
  );
  return result.rows[0] ?? {
    security_password_hash: null,
    security_password_hint: null,
    security_gate_all: false,
    security_gate_base: true,
    security_gate_users: true,
    security_gate_settings: true,
    security_gate_integrations: true,
    security_gate_home: true,
    security_gate_dashboard: true,
    security_gate_board: true,
    title_max_chars: 200,
    description_max_chars: 4000,
  };
}

export async function getSecurityState(): Promise<{
  defined: boolean;
  hint: string | null;
  global: boolean;
  gates: Record<SecurityArea, boolean>;
}> {
  const row = await currentSecurity();
  return {
    defined: row.security_password_hash !== null,
    hint: row.security_password_hint,
    global: row.security_gate_all,
    gates: {
      base: row.security_gate_base,
      users: row.security_gate_users,
      settings: row.security_gate_settings,
      integrations: row.security_gate_integrations,
      home: row.security_gate_home,
      dashboard: row.security_gate_dashboard,
      board: row.security_gate_board,
    },
  };
}

export async function getCardCharLimits(): Promise<CardCharLimits> {
  const row = await currentSecurity();
  return {
    title_max_chars: row.title_max_chars,
    description_max_chars: row.description_max_chars,
  };
}

export async function setCardCharLimits(
  titleMaxChars: number,
  descriptionMaxChars: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO system_settings (id, title_max_chars, description_max_chars)
     VALUES (1, $1, $2)
     ON CONFLICT (id) DO UPDATE SET title_max_chars = EXCLUDED.title_max_chars,
                                     description_max_chars = EXCLUDED.description_max_chars`,
    [titleMaxChars, descriptionMaxChars],
  );
}

export const NOTIFICATION_TYPES = [
  'card_created',
  'card_moved',
  'card_assigned',
  'card_mention',
  'card_comment',
  'card_deadline',
  'card_learning_index',
  'permissions_updated',
  'project_member_added',
  'security_password_changed',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export type NotificationPrefs = Record<NotificationType, boolean>;

export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  const result = await pool.query<{ notification_prefs: Record<string, boolean> | null }>(
    'SELECT notification_prefs FROM system_settings WHERE id = 1',
  );
  const stored = result.rows[0]?.notification_prefs ?? {};
  const prefs = {} as NotificationPrefs;
  for (const type of NOTIFICATION_TYPES) {
    prefs[type] = stored[type] !== false;
  }
  return prefs;
}

export async function setNotificationPrefs(prefs: NotificationPrefs): Promise<void> {
  const merged: NotificationPrefs = { ...(await getNotificationPrefs()), ...prefs };
  await pool.query(
    `INSERT INTO system_settings (id, notification_prefs)
     VALUES (1, $1::jsonb)
     ON CONFLICT (id) DO UPDATE SET notification_prefs = EXCLUDED.notification_prefs`,
    [JSON.stringify(merged)],
  );
}

export async function setSecurityPassword(password: string, hint?: string): Promise<void> {
  const passwordHash = await hash(password);
  await pool.query(
    `INSERT INTO system_settings (id, security_password_hash, security_password_hint)
     VALUES (1, $1, $2)
     ON CONFLICT (id)
     DO UPDATE SET security_password_hash = EXCLUDED.security_password_hash,
                   security_password_hint = EXCLUDED.security_password_hint`,
    [passwordHash, hint ?? null],
  );
}

export async function deleteSecurityPassword(): Promise<void> {
  await pool.query(
    'UPDATE system_settings SET security_password_hash = NULL, security_password_hint = NULL WHERE id = 1',
  );
}

export async function setSecurityGate(area: SecurityArea, enabled: boolean): Promise<void> {
  const column = AREA_COLUMNS[area];
  await pool.query(
    `UPDATE system_settings SET ${column} = $1 WHERE id = 1`,
    [enabled],
  );
}

export async function setSecurityGateAll(enabled: boolean): Promise<void> {
  await pool.query(
    `INSERT INTO system_settings (id, security_gate_all)
     VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET security_gate_all = EXCLUDED.security_gate_all`,
    [enabled],
  );
}

async function verifySecurityHeader(row: SecurityRow, headerValue: string | undefined): Promise<void> {
  if (!headerValue) {
    throw new ApiError(400, 'Senha de segurança necessária para esta operação');
  }
  const valid = await verify(row.security_password_hash!, headerValue).catch(() => false);
  if (!valid) {
    throw new ApiError(400, 'Senha de segurança inválida');
  }
}

export async function requireSecurityPassword(
  headerValue: string | undefined,
  area: SecurityArea,
): Promise<void> {
  const row = await currentSecurity();
  if (!row.security_password_hash) return;
  if (row.security_gate_all) {
    await verifySecurityHeader(row, headerValue);
    return;
  }
  const areaEnabled =
    area === 'base' ? row.security_gate_base :
    area === 'users' ? row.security_gate_users :
    area === 'settings' ? row.security_gate_settings :
    area === 'home' ? row.security_gate_home :
    area === 'dashboard' ? row.security_gate_dashboard :
    area === 'board' ? row.security_gate_board :
    row.security_gate_integrations;
  if (!areaEnabled) return;
  await verifySecurityHeader(row, headerValue);
}

/**
 * Aplicado globalmente em todas as mutacoes da API quando o toggle
 * "exigir senha de seguranca para qualquer edicao" esta ativo.
 */
export async function enforceGlobalSecurity(headerValue: string | undefined): Promise<void> {
  const row = await currentSecurity();
  if (!row.security_password_hash || !row.security_gate_all) return;
  await verifySecurityHeader(row, headerValue);
}

export async function gateSystemProject(
  projectId: string,
  headerValue: string | undefined,
  area: SecurityArea,
): Promise<string> {
  const project = await queryOne<{ db_name: string }>(
    'SELECT db_name FROM projects WHERE id = $1',
    [projectId],
  );
  if (!project) {
    throw new ApiError(404, 'Projeto não encontrado');
  }
  await requireSecurityPassword(headerValue, area);
  return project.db_name;
}
