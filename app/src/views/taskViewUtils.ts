import type { KanbanCard, KanbanColumn, Priority } from '../types';
import type { ViewPreferences } from '../viewPreferences';

export const PRIORITY_LABELS: Record<Priority, string> = {
  baixa: 'Baixa',
  media: 'Média',
  alta: 'Alta',
};

export const PRIORITY_ORDER: Priority[] = ['alta', 'media', 'baixa'];

const AVATAR_COLORS = ['#5b4fe9', '#2563eb', '#8b5cf6', '#d97706', '#0d9488', '#e11d48'];

const STATUS_FALLBACK_COLORS = ['#5b4fe9', '#2563eb', '#f59e0b', '#8b5cf6', '#0d9488', '#e11d48'];

export const PRIORITY_GROUP_COLORS: Record<Priority, string> = {
  alta: '#e11d48',
  media: '#f59e0b',
  baixa: '#64748b',
};

export const NO_RESPONSIBLE_COLOR = '#64748b';

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function avatarColor(name: string): string {
  let total = 0;
  for (const char of name) total += char.charCodeAt(0);
  return AVATAR_COLORS[total % AVATAR_COLORS.length];
}

export function isOverdue(card: KanbanCard): boolean {
  if (!card.due_date || card.completed_at) return false;
  const today = new Date().toISOString().slice(0, 10);
  return card.due_date < today;
}

export function isToday(dueDate: string | null): boolean {
  if (!dueDate) return false;
  const today = new Date().toISOString().slice(0, 10);
  return dueDate === today;
}

export function dueLabel(dueDate: string): string {
  const now = new Date();
  const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
  const diff = Math.round(
    (Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000,
  );
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Amanha';
  if (diff === -1) return 'Ontem';
  if (diff > 1) return `${diff}d`;
  return `ha ${-diff}d`;
}

export function columnColor(column: KanbanColumn | undefined, index: number): string {
  if (column?.color) return column.color;
  if (column?.is_done) return 'var(--success)';
  return STATUS_FALLBACK_COLORS[index % STATUS_FALLBACK_COLORS.length];
}

export function isFinalColumn(column: KanbanColumn): boolean {
  if (column.is_done) return true;
  const normalized = column.name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  return normalized === 'concluido';
}

export function resolveColumnColor(natural: string, prefs: ViewPreferences): string {
  if (prefs.kanban.column_colors === 'monocromatico') return '#5b4fe9';
  if (prefs.kanban.column_colors === 'personalizado') {
    return prefs.kanban.custom_column_color ?? '#5b4fe9';
  }
  return natural;
}

export function cardGroupColor(
  card: KanbanCard,
  columns: KanbanColumn[],
  prefs: ViewPreferences,
  basis: 'calendario' | 'gantt',
): string {
  const colorBy = prefs[basis].color_by;
  if (colorBy === 'prioridade') return PRIORITY_GROUP_COLORS[card.priority];
  if (colorBy === 'responsavel') {
    return card.responsible_name ? avatarColor(card.responsible_name) : NO_RESPONSIBLE_COLOR;
  }
  const index = columns.findIndex((column) => column.id === card.column_id);
  return columnColor(columns[index], index === -1 ? 0 : index);
}

export function formatShortDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year.slice(2)}`;
}
