export const WEBHOOK_SYSTEMS = ['discord', 'slack', 'n8n', 'crm', 'generico'] as const;

export type WebhookSystem = (typeof WEBHOOK_SYSTEMS)[number];

export const WEBHOOK_SYSTEM_LABELS: Record<WebhookSystem, string> = {
  discord: 'Discord',
  slack: 'Slack',
  n8n: 'N8N',
  crm: 'CRM',
  generico: 'Genérico',
};

export const WEBHOOK_EVENT_GROUPS = [
  { id: 'projetos', label: 'Projetos' },
  { id: 'tarefas', label: 'Tarefas (Kanban)' },
  { id: 'base', label: 'Base & Estrutura' },
] as const;

export type WebhookEventGroup = (typeof WEBHOOK_EVENT_GROUPS)[number]['id'];

export const WEBHOOK_EVENTS = [
  { value: 'project.created', label: 'Novo projeto criado', group: 'projetos' },
  { value: 'project.completed', label: 'Projeto concluído', group: 'projetos' },
  { value: 'project.reopened', label: 'Projeto reaberto', group: 'projetos' },
  { value: 'card.created', label: 'Nova tarefa criada', group: 'tarefas' },
  { value: 'card.moved', label: 'Tarefa movimentada de coluna', group: 'tarefas' },
  { value: 'card.completed', label: 'Tarefa concluída', group: 'tarefas' },
  { value: 'comment.created', label: 'Novo comentário ou menção (@)', group: 'tarefas' },
  { value: 'attachment.created', label: 'Novo anexo adicionado', group: 'tarefas' },
  { value: 'card.updated', label: 'Card atualizado', group: 'tarefas' },
  { value: 'card.deleted', label: 'Card excluído', group: 'tarefas' },
  { value: 'structure.created', label: 'Novo setor ou departamento cadastrado', group: 'base' },
  { value: 'evaluation.created', label: 'Nova avaliação de aprendizado lançada', group: 'base' },
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]['value'];

export const WEBHOOK_EVENT_KEYS = WEBHOOK_EVENTS.map((entry) => entry.value) as [
  WebhookEvent,
  ...WebhookEvent[],
];

export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = Object.fromEntries(
  WEBHOOK_EVENTS.map((entry) => [entry.value, entry.label]),
) as Record<WebhookEvent, string>;

export function detectWebhookSystem(url: string): WebhookSystem {
  const value = url.trim().toLowerCase();
  if (value.includes('discord.com') || value.includes('discordapp.com')) return 'discord';
  if (value.includes('hooks.slack.com')) return 'slack';
  if (value.includes('n8n')) return 'n8n';
  return 'generico';
}
