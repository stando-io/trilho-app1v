export const PROJECT_ROLE_PRIORITY = [
  'gerente_projeto',
  'analista_processo',
  'lider_implantacao',
  'vice_lider_implantacao',
  'tecnico_implantacao',
  'operacao_assistida',
] as const;

export function projectRoleExpr(projectIdRef: string, userIdRef: string): string {
  const roles = PROJECT_ROLE_PRIORITY.map((role) => `'${role}'`).join(', ');
  return `(SELECT pt.role
           FROM project_team pt
           WHERE pt.project_id = ${projectIdRef} AND pt.user_id = ${userIdRef}
           ORDER BY array_position(ARRAY[${roles}]::text[], pt.role) NULLS LAST
           LIMIT 1)`;
}
