import { z } from 'zod';

export const kanbanViewSchema = z.object({
  background: z.enum(['neutro', 'azul', 'roxo', 'verde', 'ambar', 'escuro']),
  column_colors: z.enum(['status', 'monocromatico', 'personalizado']),
  custom_column_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Cor invalida')
    .nullable(),
  density: z.enum(['completo', 'compacto']),
  grouping: z.enum(['status', 'prioridade', 'responsavel']),
});

export const listViewSchema = z.object({
  density: z.enum(['confortavel', 'compacto']),
  grouping: z.enum(['status', 'prioridade', 'setor', 'responsavel']),
  sort: z.enum(['criacao', 'prioridade', 'vencimento']),
});

export const calendarioViewSchema = z.object({
  view: z.enum(['dia', 'semana', 'mes']),
  color_by: z.enum(['status', 'prioridade', 'responsavel']),
  show_undated: z.boolean(),
});

export const ganttViewSchema = z.object({
  scale: z.enum(['semanal', 'quinzenal', 'mensal']),
  color_by: z.enum(['status', 'prioridade', 'responsavel']),
  show_dependencies: z.boolean(),
  show_milestones: z.boolean(),
});

export const viewPreferencesSchema = z.object({
  mode: z.enum(['kanban', 'lista', 'calendario', 'gantt']),
  kanban: kanbanViewSchema,
  lista: listViewSchema,
  calendario: calendarioViewSchema,
  gantt: ganttViewSchema,
});

export type ViewPreferences = z.infer<typeof viewPreferencesSchema>;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickValid<T>(
  schema: z.ZodType<T>,
  fallback: T,
  value: unknown,
): T {
  if (value === undefined) return fallback;
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

function mergeSection<T extends object>(
  schema: z.ZodType<T>,
  defaults: T,
  stored: unknown,
): T {
  if (!isRecord(stored)) return defaults;
  const parsed = schema.safeParse({ ...defaults, ...stored });
  return parsed.success ? parsed.data : defaults;
}

export function resolveViewPreferences(stored: unknown): ViewPreferences {
  const record = isRecord(stored) ? stored : {};
  return {
    mode: pickValid(viewPreferencesSchema.shape.mode, DEFAULT_VIEW_PREFERENCES.mode, record.mode),
    kanban: mergeSection(kanbanViewSchema, DEFAULT_VIEW_PREFERENCES.kanban, record.kanban),
    lista: mergeSection(listViewSchema, DEFAULT_VIEW_PREFERENCES.lista, record.lista),
    calendario: mergeSection(
      calendarioViewSchema,
      DEFAULT_VIEW_PREFERENCES.calendario,
      record.calendario,
    ),
    gantt: mergeSection(ganttViewSchema, DEFAULT_VIEW_PREFERENCES.gantt, record.gantt),
  };
}
