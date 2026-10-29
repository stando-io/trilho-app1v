import type { Pool } from 'pg';
import { pool } from '../db/pool.js';
import { getProjectPool } from '../db/projectPool.js';
import { sendToUser } from '../realtime.js';
import type { NotificationPrefs } from './securityPassword.js';
import { getNotificationPrefs } from './securityPassword.js';

export interface NotificationRow {
  id: string;
  actor_id: string | null;
  type: string;
  title: string;
  body: string;
  project_id: string | null;
  card_id: string | null;
  screen: string | null;
  link: string | null;
  read_at: Date | null;
  created_at: Date;
}

export interface NotifyInput {
  userId: string;
  actorId: string | null;
  type: string;
  title: string;
  body?: string;
  projectId?: string | null;
  cardId?: string | null;
  screen?: string | null;
  link?: string | null;
  dedupeKey?: string | null;
}

export async function notify(input: NotifyInput): Promise<boolean> {
  if (input.actorId && input.userId === input.actorId) return false;

  const prefs = await getNotificationPrefs();
  if (prefs[input.type as keyof NotificationPrefs] === false) return false;

  const result = await pool.query<{ id: string; created_at: Date }>(
    `INSERT INTO notifications
       (user_id, actor_id, type, title, body, project_id, card_id, screen, link, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING id, created_at`,
    [
      input.userId,
      input.actorId,
      input.type,
      input.title,
      input.body ?? '',
      input.projectId ?? null,
      input.cardId ?? null,
      input.screen ?? null,
      input.link ?? null,
      input.dedupeKey ?? null,
    ],
  );
  if (result.rowCount === 0) return false;

  sendToUser(input.userId, 'notification', {
    notification: {
      id: result.rows[0]!.id,
      actor_id: input.actorId ?? null,
      type: input.type,
      title: input.title,
      body: input.body ?? '',
      project_id: input.projectId ?? null,
      card_id: input.cardId ?? null,
      screen: input.screen ?? null,
      link: input.link ?? null,
      read_at: null,
      created_at: result.rows[0]!.created_at,
    },
  });
  return true;
}

export async function notifyMany(inputs: NotifyInput[]): Promise<number> {
  let created = 0;
  for (const input of inputs) {
    if (await notify(input)) created += 1;
  }
  return created;
}

const MENTION_USER_RE = /data-user="([0-9a-fA-F-]{36})"/g;

export function extractMentionUserIds(html: string): string[] {
  const ids = new Set<string>();
  for (const match of html.matchAll(MENTION_USER_RE)) {
    ids.add(match[1]!.toLowerCase());
  }
  return [...ids];
}

export function extractMentionUserIdsByText(
  text: string,
  members: Array<{ id: string; name: string }>,
): string[] {
  const ids = new Set<string>();
  for (const member of members) {
    const name = member.name.trim().toLowerCase();
    if (!name) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`@${escaped}(?![\\w-])`, 'i');
    if (re.test(text)) ids.add(member.id);
  }
  return [...ids];
}

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function getProjectMemberIds(projectId: string): Promise<string[]> {
  const result = await pool.query<{ user_id: string }>(
    'SELECT user_id FROM project_members WHERE project_id = $1',
    [projectId],
  );
  return result.rows.map((row) => row.user_id);
}

export interface CardTargets {
  userIds: string[];
}

export async function getCardTargets(
  projectPool: Pool,
  cardId: string,
  extraUserIds: string[] = [],
): Promise<CardTargets> {
  const card = await projectPool.query<{
    created_by: string | null;
    responsible_id: string | null;
  }>('SELECT created_by, responsible_id FROM cards WHERE id = $1', [cardId]);
  const responsibles = await projectPool.query<{ user_id: string }>(
    'SELECT user_id FROM card_responsibles WHERE card_id = $1',
    [cardId],
  );
  const ids = new Set<string>(extraUserIds);
  if (card.rows[0]?.created_by) ids.add(card.rows[0].created_by);
  if (card.rows[0]?.responsible_id) ids.add(card.rows[0].responsible_id);
  for (const row of responsibles.rows) ids.add(row.user_id);
  return { userIds: [...ids] };
}

export function kanbanCardLink(projectId: string, cardId: string): string {
  return `/kanban?proj=${projectId}&card=${cardId}`;
}

interface DeadlineCardRow {
  id: string;
  title: string;
  task_code: string;
  due_date: Date | string;
  created_by: string | null;
  responsible_id: string | null;
  project_id: string;
}

function localDateParam(date: Date | string): string {
  if (typeof date === 'string') {
    return date.slice(0, 10);
  }
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export async function runDeadlineScan(
  now = new Date(),
  onlyProjectId?: string,
): Promise<number> {
  const today = localDateParam(now);
  const tomorrowDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrow = localDateParam(tomorrowDate);

  const projects = onlyProjectId
    ? await pool.query<{ id: string; db_name: string }>(
        'SELECT id, db_name FROM projects WHERE id = $1',
        [onlyProjectId],
      )
    : await pool.query<{ id: string; db_name: string }>('SELECT id, db_name FROM projects');

  let sent = 0;
  for (const project of projects.rows) {
    let projectPool: Pool;
    try {
      projectPool = (await getProjectPool(project.id)).projectPool;
    } catch {
      continue;
    }
    const cards = await projectPool.query<Omit<DeadlineCardRow, 'project_id'>>(
      `SELECT id, title, task_code, due_date, created_by, responsible_id
       FROM cards
       WHERE completed_at IS NULL
         AND learning_index_score IS NULL
         AND due_date::date = ANY($1::date[])`,
      [[today, tomorrow]],
    );
    for (const card of cards.rows) {
      const due = localDateParam(card.due_date);
      const isToday = due === today;
      const targets = await getCardTargets(projectPool, card.id);
      const kind = isToday ? 'hoje' : 'amanha';
      const inputs: NotifyInput[] = targets.userIds.map((userId) => ({
        userId,
        actorId: null,
        type: 'card_deadline',
        title: `Prazo ${kind}: ${card.task_code}`,
        body: `"${card.title}" vence ${isToday ? 'hoje' : 'amanhã'}.`,
        projectId: project.id,
        cardId: card.id,
        screen: 'kanban',
        link: kanbanCardLink(project.id, card.id),
        dedupeKey: `deadline:${userId}:${card.id}:${due}`,
      }));
      sent += await notifyMany(inputs);
    }
  }
  return sent;
}

const DEADLINE_SCAN_INTERVAL_MS = 60 * 60 * 1000;

export function startDeadlineScheduler(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void runDeadlineScan().catch((error) => {
      console.error('[notifications] varredura de prazos falhou', error);
    });
  }, DEADLINE_SCAN_INTERVAL_MS);
  timer.unref?.();
  return timer;
}

