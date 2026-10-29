import { query } from '../db/pool.js';
import {
  WEBHOOK_EVENT_LABELS,
  type WebhookEvent,
  type WebhookSystem,
} from './webhookEvents.js';

const WEBHOOK_TIMEOUT_MS = 5000;

export type { WebhookEvent };

export interface WebhookPayload {
  project_id: string;
  [key: string]: unknown;
}

interface WebhookTarget {
  id: string;
  url: string;
  system: WebhookSystem;
}

const EVENT_COLORS: Record<WebhookEvent, number> = {
  'project.created': 0x2ecc71,
  'project.completed': 0x1abc9c,
  'project.reopened': 0xe67e22,
  'card.created': 0x2ecc71,
  'card.moved': 0xf39c12,
  'card.completed': 0x9b59b6,
  'comment.created': 0x3498db,
  'attachment.created': 0x34495e,
  'card.updated': 0x3498db,
  'card.deleted': 0xe74c3c,
  'evaluation.created': 0xf1c40f,
  'structure.created': 0x16a085,
};

const STRUCTURE_KIND_LABELS: Record<string, string> = {
  sector: 'Setor',
  department: 'Departamento',
};

function embedFields(payload: WebhookPayload): Array<{ name: string; value: string; inline: boolean }> {
  const fields: Array<{ name: string; value: string; inline: boolean }> = [];
  if (typeof payload.task_code === 'string') {
    fields.push({ name: 'Tarefa', value: payload.task_code, inline: true });
  }
  if (typeof payload.title === 'string') {
    fields.push({ name: 'Título', value: payload.title, inline: true });
  }
  if (typeof payload.name === 'string') {
    fields.push({ name: 'Nome', value: payload.name, inline: true });
  }
  if (payload.score !== undefined && payload.score !== null) {
    fields.push({ name: 'Nota', value: String(payload.score), inline: true });
  }
  if (typeof payload.kind === 'string') {
    fields.push({
      name: 'Tipo',
      value: STRUCTURE_KIND_LABELS[payload.kind] ?? payload.kind,
      inline: true,
    });
  }
  fields.push({ name: 'Projeto', value: payload.project_id, inline: true });
  return fields;
}

function slackText(event: WebhookEvent, payload: WebhookPayload): string {
  const label = WEBHOOK_EVENT_LABELS[event];
  const detail =
    (typeof payload.task_code === 'string' ? payload.task_code : '') ||
    (typeof payload.name === 'string' ? payload.name : '');
  const title = typeof payload.title === 'string' ? ` — ${payload.title}` : '';
  return `[Trilho] ${label}${detail ? `: ${detail}` : ''}${title}`;
}

function buildBody(target: WebhookTarget, event: WebhookEvent, payload: WebhookPayload): string {
  if (target.system === 'discord') {
    const embed = {
      title: WEBHOOK_EVENT_LABELS[event],
      color: EVENT_COLORS[event],
      fields: embedFields(payload),
      timestamp: new Date().toISOString(),
    };
    return JSON.stringify({ username: 'Trilho', embeds: [embed] });
  }
  if (target.system === 'slack') {
    return JSON.stringify({ text: slackText(event, payload) });
  }
  return JSON.stringify({ event, ...payload, webhook_id: target.id });
}

export async function deliverWebhooks(event: WebhookEvent, payload: WebhookPayload): Promise<void> {
  const hooks = await query<WebhookTarget>(
    `SELECT id, url, system FROM webhooks
     WHERE active = true AND events @> ARRAY[$1::text]`,
    [event],
  );
  for (const hook of hooks) {
    fetch(hook.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: buildBody(hook, event, payload),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    }).catch(() => {
      // fire-and-forget: falha de entrega não afeta o fluxo principal
    });
  }
}
