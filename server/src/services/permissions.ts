import { SCREENS } from './screens.js';

export const PERMISSION_LEAVES = [
  'home.novo_projeto',
  'home.baixar_planilha_modelo',
  'home.registrar_calendario',
  'home.registrar_agenda',
  'dashboard.ver_relatorio_detalhado',
  'dashboard.projetos_recentes.editar',
  'dashboard.projetos_recentes.excluir',
  'base.novo_registro',
  'base.acoes.editar',
  'base.acoes.excluir',
  'kanban.visualizar',
  'kanban.criar_cards',
  'kanban.editar_cards',
  'kanban.mover_cards',
  'kanban.excluir_cards',
  'reports.visualizar',
  'reports.filtrar',
  'reports.exportar',
  'settings.minha_conta',
  'settings.usuarios.novo',
  'settings.usuarios.editar',
  'settings.usuarios.excluir',
  'settings.cargos.novo',
  'settings.cargos.editar',
  'settings.cargos.excluir',
  'settings.niveis.novo',
  'settings.niveis.editar',
  'settings.niveis.excluir',
  'settings.temas',
  'settings.seguranca',
  'settings.integracoes',
  'settings.parametros',
  'settings.auditoria',
] as const;

export type Permission = (typeof PERMISSION_LEAVES)[number];

const LEAF_SET = new Set<string>(PERMISSION_LEAVES);

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && LEAF_SET.has(value);
}

export function moduleOf(permission: string): string {
  return permission.split('.')[0] ?? '';
}

export function permissionsForScreens(screens: readonly string[]): string[] {
  return PERMISSION_LEAVES.filter((leaf) => screens.includes(moduleOf(leaf)));
}

export function isValidPermissionList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => isPermission(item));
}

export function unknownPermissions(value: readonly string[]): string[] {
  return value.filter((item) => !isPermission(item));
}

export function knownScreens(value: readonly string[]): boolean {
  return value.every((item) => SCREENS.includes(item as (typeof SCREENS)[number]));
}
