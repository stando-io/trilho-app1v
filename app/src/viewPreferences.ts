import { api } from './api';

export type ViewMode = 'kanban' | 'lista' | 'calendario' | 'gantt';

export type ViewBackground = 'neutro' | 'azul' | 'roxo' | 'verde' | 'ambar' | 'escuro';

export type ColumnColorsMode = 'status' | 'monocromatico' | 'personalizado';

export interface ViewPreferences {
  mode: ViewMode;
  kanban: {
    background: ViewBackground;
    column_colors: ColumnColorsMode;
    custom_column_color: string | null;
    density: 'completo' | 'compacto';
    grouping: 'status' | 'prioridade' | 'responsavel';
  };
  lista: {
    density: 'confortavel' | 'compacto';
    grouping: 'status' | 'prioridade' | 'setor' | 'responsavel';
    sort: 'criacao' | 'prioridade' | 'vencimento';
  };
  calendario: {
    view: 'dia' | 'semana' | 'mes';
    color_by: 'status' | 'prioridade' | 'responsavel';
    show_undated: boolean;
  };
  gantt: {
    scale: 'semanal' | 'quinzenal' | 'mensal';
    color_by: 'status' | 'prioridade' | 'responsavel';
    show_dependencies: boolean;
    show_milestones: boolean;
  };
}

export const DEFAULT_VIEW_PREFERENCES: ViewPreferences = {
  mode: 'kanban',
  kanban: {
    background: 'neutro',
    column_colors: 'status',
    custom_column_color: null,
    density: 'completo',
    grouping: 'status',
  },
  lista: {
    density: 'confortavel',
    grouping: 'status',
    sort: 'criacao',
  },
  calendario: {
    view: 'mes',
    color_by: 'status',
    show_undated: false,
  },
  gantt: {
    scale: 'semanal',
    color_by: 'status',
    show_dependencies: false,
    show_milestones: true,
  },
};

export interface ViewModeOption {
  id: ViewMode;
  label: string;
  hint: string;
}

export const VIEW_MODES: ViewModeOption[] = [
  { id: 'kanban', label: 'Kanban', hint: 'Colunas e cartões' },
  { id: 'lista', label: 'Lista', hint: 'Linhas em tabela' },
  { id: 'calendario', label: 'Calendário', hint: 'Tarefas por data' },
  { id: 'gantt', label: 'Gantt', hint: 'Cronograma e prazos' },
];

export const VIEW_BACKGROUNDS: { id: ViewBackground; label: string; color: string }[] = [
  { id: 'neutro', label: 'Neutro', color: '#f1f3f7' },
  { id: 'azul', label: 'Azul', color: '#e3ecff' },
  { id: 'roxo', label: 'Roxo', color: '#ece6ff' },
  { id: 'verde', label: 'Verde', color: '#e2f5ec' },
  { id: 'ambar', label: 'Âmbar', color: '#fdf0dc' },
  { id: 'escuro', label: 'Escuro', color: '#1e2230' },
];

export function viewBackgroundValue(id: ViewBackground): string {
  return VIEW_BACKGROUNDS.find((item) => item.id === id)?.color ?? '#f1f3f7';
}

export async function fetchViewPreferences(): Promise<ViewPreferences> {
  const data = await api<{ preferences: ViewPreferences }>('/settings/view-preferences');
  return data.preferences;
}
