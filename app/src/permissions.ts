export interface PermissionAction {
  type: 'action';
  key: string;
  label: string;
}

export interface PermissionGroup {
  type: 'group';
  label: string;
  children: PermissionNode[];
}

export interface PermissionModule {
  type: 'module';
  key: string;
  label: string;
  children: PermissionNode[];
}

export type PermissionNode = PermissionModule | PermissionGroup | PermissionAction;

export const PERMISSION_TREE: PermissionModule[] = [
  {
    type: 'module',
    key: 'home',
    label: 'Início',
    children: [
      { type: 'action', key: 'home.novo_projeto', label: 'Novo projeto' },
      { type: 'action', key: 'home.baixar_planilha_modelo', label: 'Baixar planilha modelo' },
      { type: 'action', key: 'home.registrar_calendario', label: 'Registrar no calendário' },
      { type: 'action', key: 'home.registrar_agenda', label: 'Registrar na agenda' },
    ],
  },
  {
    type: 'module',
    key: 'dashboard',
    label: 'Dashboard',
    children: [
      {
        type: 'action',
        key: 'dashboard.ver_relatorio_detalhado',
        label: 'Ver relatório detalhado',
      },
      {
        type: 'group',
        label: 'Projetos recentes',
        children: [
          { type: 'action', key: 'dashboard.projetos_recentes.editar', label: 'Editar' },
          { type: 'action', key: 'dashboard.projetos_recentes.excluir', label: 'Excluir' },
        ],
      },
    ],
  },
  {
    type: 'module',
    key: 'base',
    label: 'Base',
    children: [
      { type: 'action', key: 'base.novo_registro', label: 'Novo registro' },
      {
        type: 'group',
        label: 'Ações (Setores/Departamentos)',
        children: [
          { type: 'action', key: 'base.acoes.editar', label: 'Editar' },
          { type: 'action', key: 'base.acoes.excluir', label: 'Excluir' },
        ],
      },
    ],
  },
  {
    type: 'module',
    key: 'kanban',
    label: 'Quadro',
    children: [
      { type: 'action', key: 'kanban.visualizar', label: 'Visualizar' },
      { type: 'action', key: 'kanban.criar_cards', label: 'Criar cards' },
      { type: 'action', key: 'kanban.editar_cards', label: 'Editar cards' },
      { type: 'action', key: 'kanban.mover_cards', label: 'Mover cards' },
      { type: 'action', key: 'kanban.excluir_cards', label: 'Excluir cards' },
    ],
  },
  {
    type: 'module',
    key: 'reports',
    label: 'Relatórios',
    children: [
      { type: 'action', key: 'reports.visualizar', label: 'Visualizar' },
      { type: 'action', key: 'reports.filtrar', label: 'Filtrar' },
      { type: 'action', key: 'reports.exportar', label: 'Exportar' },
    ],
  },
  {
    type: 'module',
    key: 'settings',
    label: 'Configurações',
    children: [
      { type: 'action', key: 'settings.minha_conta', label: 'Minha conta' },
      {
        type: 'group',
        label: 'Usuários e Permissões',
        children: [
          {
            type: 'group',
            label: 'Usuários',
            children: [
              { type: 'action', key: 'settings.usuarios.novo', label: 'Novo' },
              { type: 'action', key: 'settings.usuarios.editar', label: 'Editar' },
              { type: 'action', key: 'settings.usuarios.excluir', label: 'Excluir' },
            ],
          },
          {
            type: 'group',
            label: 'Cargos',
            children: [
              { type: 'action', key: 'settings.cargos.novo', label: 'Novo' },
              { type: 'action', key: 'settings.cargos.editar', label: 'Editar' },
              { type: 'action', key: 'settings.cargos.excluir', label: 'Excluir' },
            ],
          },
          {
            type: 'group',
            label: 'Níveis de Acesso',
            children: [
              { type: 'action', key: 'settings.niveis.novo', label: 'Novo' },
              { type: 'action', key: 'settings.niveis.editar', label: 'Editar' },
              { type: 'action', key: 'settings.niveis.excluir', label: 'Excluir' },
            ],
          },
        ],
      },
      { type: 'action', key: 'settings.temas', label: 'Temas' },
      { type: 'action', key: 'settings.seguranca', label: 'Senha de Segurança' },
      { type: 'action', key: 'settings.integracoes', label: 'Integrações' },
      { type: 'action', key: 'settings.parametros', label: 'Parâmetros' },
      { type: 'action', key: 'settings.auditoria', label: 'Auditoria' },
    ],
  },
];

const MODULE_BY_KEY = new Map(PERMISSION_TREE.map((module) => [module.key, module]));

export function actionKeysOf(node: PermissionNode): string[] {
  if (node.type === 'action') return [node.key];
  return node.children.flatMap((child) => actionKeysOf(child));
}

export function moduleOf(key: string): string {
  return key.split('.')[0] ?? '';
}

export function actionsForScreens(screens: readonly string[]): string[] {
  return PERMISSION_TREE.filter((module) => screens.includes(module.key)).flatMap((module) =>
    actionKeysOf(module),
  );
}

export function defaultProfileScreens(): string[] {
  return ['dashboard'];
}

export function defaultProfilePermissions(): string[] {
  const dashboard = MODULE_BY_KEY.get('dashboard');
  return dashboard ? actionKeysOf(dashboard) : [];
}

export const MODULE_LABELS: Record<string, string> = Object.fromEntries(
  PERMISSION_TREE.map((module) => [module.key, module.label]),
);
