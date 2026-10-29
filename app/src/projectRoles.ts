export const PROJECT_ROLE_LABELS: Record<string, string> = {
  gerente_projeto: 'Gerente de Projeto',
  analista_processo: 'Analista de Processo',
  lider_implantacao: 'Líder de Implantação',
  vice_lider_implantacao: 'Vice-Líder de Implantação',
  tecnico_implantacao: 'Técnico de Implantação',
  operacao_assistida: 'Operação Assistida / Suporte',
};

export function projectRoleLabel(role: string | null | undefined): string | null {
  if (!role) return null;
  return PROJECT_ROLE_LABELS[role] ?? null;
}
