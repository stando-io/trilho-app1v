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
  { id: 'projetos', label: 'PROJETOS' },
  { id: 'tarefas', label: 'TAREFAS (KANBAN)' },
  { id: 'avaliacoes', label: 'AVALIAÇÕES & ESCOPO' },
] as const;

export type WebhookEventGroup = (typeof WEBHOOK_EVENT_GROUPS)[number]['id'];

export const WEBHOOK_EVENTS = [
  { value: 'project.created', label: 'Novo Projeto Criado', group: 'projetos' },
  { value: 'project.completed', label: 'Projeto Concluído', group: 'projetos' },
  { value: 'project.reopened', label: 'Projeto Reaberto', group: 'projetos' },
  { value: 'card.created', label: 'Nova Tarefa Criada', group: 'tarefas' },
  { value: 'card.moved', label: 'Tarefa Movimentada de Coluna', group: 'tarefas' },
  { value: 'card.completed', label: 'Tarefa Concluída', group: 'tarefas' },
  { value: 'comment.created', label: 'Novo Comentário / Menção (@)', group: 'tarefas' },
  { value: 'attachment.created', label: 'Novo Anexo Adicionado', group: 'tarefas' },
  { value: 'card.updated', label: 'Card Atualizado', group: 'tarefas' },
  { value: 'card.deleted', label: 'Card Excluído', group: 'tarefas' },
  {
    value: 'evaluation.created',
    label: 'Nova Avaliação registrada (Índice de Aprendizado)',
    group: 'avaliacoes',
  },
  {
    value: 'structure.created',
    label: 'Novo Setor / Departamento cadastrado na Base',
    group: 'avaliacoes',
  },
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
