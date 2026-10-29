import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { pool, query, queryOne } from '../db/pool.js';
import { getProjectPool } from '../db/projectPool.js';
import { deprovisionProject, provisionProject } from '../db/provision.js';
import { audit } from '../middleware/audit.js';
import { requireAnyScreen, requireAuth, requirePermission, requireProjectMember, requireScreen } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import {
  gateSystemProject,
  getSecurityState,
  SECURITY_PASSWORD_HEADER,
} from '../services/securityPassword.js';
import { buildStructureTemplate } from '../services/baseSpreadsheet.js';
import { notify } from '../services/notifications.js';
import { deliverWebhooks } from '../services/webhookDelivery.js';
import { PROJECT_ROLE_PRIORITY, projectRoleExpr } from '../services/projectRole.js';
import auditRouter from './audit.js';
import baseRouter from './base.js';
import dashboardRouter from './dashboard.js';
import kanbanRouter from './kanban.js';
import milestonesRouter from './milestones.js';
import reportsRouter from './reports.js';

const router = Router();

const PROJECT_STATUSES = ['Em prospecção', 'Iniciado', 'Em andamento'] as const;
const EDIT_STATUSES = [...PROJECT_STATUSES, 'Rascunho'] as const;
const CONCLUDED_STATUS = 'Concluído';
const PROJECT_CLOSED_EDIT_MSG = 'Projeto concluído — reabra para editar';
const TEAM_ROLES = [
  'gerente_projeto',
  'analista_processo',
  'lider_implantacao',
  'vice_lider_implantacao',
] as const;

const dateField = z.preprocess(
  (value) => (value === undefined || value === '' ? null : value),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida').nullable(),
);
const textField = (max: number) =>
  z.preprocess(
    (value) => (value === undefined || value === null ? '' : value),
    z.string().trim().max(max, 'Texto muito longo'),
  );
const userField = z.preprocess(
  (value) => (value === undefined || value === '' ? null : value),
  z.string().uuid('Usuário inválido').nullable(),
);
const statusField = z.preprocess(
  (value) => (value === undefined || value === '' ? null : value),
  z.enum(PROJECT_STATUSES).nullable(),
);

const teamSchema = z.object({
  gerente_projeto: userField.optional(),
  analista_processo: userField.optional(),
  lider_implantacao: userField.optional(),
  vice_lider_implantacao: userField.optional(),
  tecnicos_implantacao: z.array(z.string().uuid('Usuário inválido')).default([]),
  operacao_assistida: z.array(z.string().uuid('Usuário inválido')).default([]),
});

const createSchema = z.object({
  name: z.string().trim().min(2, 'Nome do projeto muito curto').max(80),
  contract_number: textField(60),
  client_name: textField(120),
  start_date: dateField,
  due_date: dateField,
  manager_id: userField,
  status: statusField,
  draft: z.boolean().optional(),
  team: teamSchema.optional(),
});
const editSchema = z
  .object({
    name: z.string().trim().min(2, 'Nome do projeto muito curto').max(80).optional(),
    description: z.string().max(2000, 'Descrição muito longa').optional(),
    is_active: z.boolean().optional(),
    status: z.enum(EDIT_STATUSES).optional(),
    justificativa: z
      .string()
      .trim()
      .min(3, 'Informe a justificativa da alteração')
      .max(500, 'Justificativa muito longa')
      .optional(),
  })
  .refine(
    (body) =>
      body.name !== undefined ||
      body.description !== undefined ||
      body.is_active !== undefined ||
      body.status !== undefined,
    { message: 'Nada para atualizar' },
  )
  .refine(
    (body) =>
      body.name === undefined &&
      body.description === undefined &&
      body.is_active === undefined &&
      body.status === undefined
        ? true
        : body.justificativa !== undefined,
    { message: 'Informe a justificativa da alteração' },
  );
const justificativaSchema = z.object({
  justificativa: z
    .string({ required_error: 'Informe a justificativa da alteração' })
    .trim()
    .min(3, 'Informe a justificativa da alteração')
    .max(500, 'Justificativa muito longa'),
});
const roleField = z.enum(PROJECT_ROLE_PRIORITY).nullable();
const memberBody = z.object({
  user_id: z.string().uuid('Usuário inválido'),
  project_role: roleField.optional(),
});
const memberRoleBody = z.object({ project_role: roleField });
const memberParams = z.object({
  projectId: z.string().uuid('Projeto inválido'),
  userId: z.string().uuid('Usuário inválido'),
});

async function assertProjectEditable(projectId: string): Promise<void> {
  const row = await queryOne<{ status: string | null }>(
    'SELECT status FROM projects WHERE id = $1',
    [projectId],
  );
  if (row?.status === CONCLUDED_STATUS) {
    throw new ApiError(409, PROJECT_CLOSED_EDIT_MSG);
  }
}

async function editableProjectGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (req.method === 'GET' || req.method === 'HEAD') {
    next();
    return;
  }
  try {
    await assertProjectEditable(req.params.projectId!);
    next();
  } catch (error) {
    next(error);
  }
}

async function scopeAuditMeta(): Promise<{ scope_required: boolean; scope_validated: boolean }> {
  const state = await getSecurityState();
  const required = state.defined && (state.global || state.gates.dashboard);
  return { scope_required: required, scope_validated: required };
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const wantsAll = req.query.all === '1' && req.user!.screens.includes('settings');
    const rows = wantsAll
      ? await query<{ id: string; name: string; status: string | null }>(
          `SELECT id, name, status FROM projects WHERE is_active = true ORDER BY name`,
        )
      : await query<{ id: string; name: string; status: string | null }>(
          `SELECT pr.id, pr.name, pr.status
           FROM projects pr
           JOIN project_members pm ON pm.project_id = pr.id
           WHERE pm.user_id = $1 AND pr.is_active = true
           ORDER BY pr.name`,
          [req.user!.id],
        );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.get(
  '/base-template',
  requireAuth,
  requirePermission('home.baixar_planilha_modelo'),
  async (_req, res, next) => {
    try {
      const buffer = await buildStructureTemplate();
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader('Content-Disposition', 'attachment; filename="modelo-estrutura-base.xlsx"');
      res.send(buffer);
    } catch (error) {
      next(error);
    }
  },
);

router.post('/', requireAuth, requirePermission('home.novo_projeto'), async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const { id, dbName } = await provisionProject(body.name);

    const assignments: Array<{ role: string; userId: string }> = [];
    const team = body.team;
    if (team) {
      const leadership: Array<[string, string | null]> = TEAM_ROLES.map((role) => [
        role,
        team[role] ?? null,
      ]);
      for (const [role, userId] of leadership) {
        if (userId) assignments.push({ role, userId });
      }
      for (const userId of team.tecnicos_implantacao) {
        assignments.push({ role: 'tecnico_implantacao', userId });
      }
      for (const userId of team.operacao_assistida) {
        assignments.push({ role: 'operacao_assistida', userId });
      }
    }

    const referencedIds = [
      ...new Set([body.manager_id, ...assignments.map((item) => item.userId)].filter(Boolean)),
    ];
    if (referencedIds.length > 0) {
      const found = await query<{ id: string }>(
        'SELECT id FROM users WHERE id = ANY($1::uuid[])',
        [referencedIds],
      );
      if (found.length !== referencedIds.length) {
        throw new ApiError(400, 'Usuário inexistente na lista');
      }
    }

    const storedStatus = body.draft ? 'Rascunho' : body.status;
    await pool.query(
      `UPDATE projects
       SET contract_number = $2,
           client_name = $3,
           start_date = $4,
           due_date = $5,
           status = $6,
           manager_id = $7
       WHERE id = $1`,
      [
        id,
        body.contract_number || null,
        body.client_name || null,
        body.start_date,
        body.due_date,
        storedStatus,
        body.manager_id,
      ],
    );
    for (const item of assignments) {
      await pool.query(
        'INSERT INTO project_team (project_id, role, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [id, item.role, item.userId],
      );
    }
    for (const userId of new Set(assignments.map((item) => item.userId))) {
      await pool.query(
        'INSERT INTO project_members (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [id, userId],
      );
    }

    await pool.query(
      'INSERT INTO project_members (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [id, req.user!.id],
    );
    await audit(req, 'project_created', 'project', id, {
      name: body.name,
      db_name: dbName,
      project_id: id,
      client_name: body.client_name || '',
      contract_number: body.contract_number || '',
      status: storedStatus ?? '',
      draft: body.draft === true,
      team_count: assignments.length,
      details: `O projeto ${body.name} (ID: prj_${id}) foi criado pelo usuário ${req.user!.name} (ID: ${req.user!.id}).`,
    });
    void deliverWebhooks('project.created', {
      project_id: id,
      name: body.name,
      status: storedStatus ?? '',
    });
    res.status(201).json({ id, name: body.name, db_name: dbName, status: storedStatus });
  } catch (error) {
    next(error);
  }
});

router.patch('/:projectId', requireAuth, requirePermission('dashboard.projetos_recentes.editar'), requireProjectMember, async (req, res, next) => {
  try {
    await gateSystemProject(req.params.projectId!, req.header(SECURITY_PASSWORD_HEADER), 'dashboard');
    const body = editSchema.parse(req.body);

    const current = await queryOne<{
      id: string;
      name: string;
      description: string | null;
      is_active: boolean;
      status: string | null;
    }>(
      'SELECT id, name, description, is_active, status FROM projects WHERE id = $1',
      [req.params.projectId],
    );
    if (!current) {
      res.status(404).json({ error: { message: 'Projeto não encontrado' } });
      return;
    }
    if (current.status === CONCLUDED_STATUS) {
      throw new ApiError(409, PROJECT_CLOSED_EDIT_MSG);
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    const meta: Record<string, unknown> = { project_id: req.params.projectId };
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const FIELD_LABELS: Record<string, string> = {
      name: 'nome',
      description: 'descrição',
      status: 'situação',
      is_active: 'ativação',
    };
    if (body.name !== undefined) {
      values.push(body.name);
      sets.push(`name = $${values.length}`);
      meta.name = body.name;
      if (body.name !== current.name) {
        changes.name = { from: '(texto anterior)', to: '(novo texto)' };
      }
    }
    if (body.description !== undefined) {
      values.push(body.description);
      sets.push(`description = $${values.length}`);
      meta.description = body.description;
      if (body.description !== (current.description ?? '')) {
        changes.description = { from: '(texto anterior)', to: '(novo texto)' };
      }
    }
    if (body.is_active !== undefined) {
      values.push(body.is_active);
      sets.push(`is_active = $${values.length}`);
      meta.is_active = body.is_active;
      if (body.is_active !== current.is_active) {
        changes.is_active = { from: current.is_active, to: body.is_active };
      }
    }
    if (body.status !== undefined) {
      values.push(body.status);
      sets.push(`status = $${values.length}`);
      meta.status = body.status;
      if (body.status !== current.status) {
        changes.status = { from: current.status, to: body.status };
      }
    }
    if (body.justificativa !== undefined) {
      meta.justificativa = body.justificativa;
    }
    values.push(req.params.projectId);

    const row = await queryOne<{
      id: string;
      name: string;
      description: string;
      is_active: boolean;
      status: string | null;
    }>(
      `UPDATE projects SET ${sets.join(', ')} WHERE id = $${values.length}
       RETURNING id, name, description, is_active, status`,
      values,
    );
    if (!row) {
      res.status(404).json({ error: { message: 'Projeto não encontrado' } });
      return;
    }
    const changedLabels = Object.keys(changes)
      .map((field) => FIELD_LABELS[field] ?? field)
      .join(', ');
    meta.changes = changes;
    meta.fields = Object.keys(changes);
    meta.details =
      changedLabels.length > 0
        ? `O projeto ${row.name} (ID: prj_${row.id}) teve alteração de: ${changedLabels}. Justificativa: ${body.justificativa ?? 'N/A'}`
        : undefined;
    await audit(
      req,
      body.name !== undefined ? 'project_renamed' : 'project_updated',
      'project',
      row.id,
      meta,
    );
    res.json(row);
  } catch (error) {
    next(error);
  }
});

router.delete(
  '/:projectId',
  requireAuth,
  requirePermission('dashboard.projetos_recentes.excluir'),
  requireProjectMember,
  async (req, res, next) => {
    try {
      const dbName = await gateSystemProject(req.params.projectId!, req.header(SECURITY_PASSWORD_HEADER), 'dashboard');
      const body = justificativaSchema.parse(req.body);
      const project = await queryOne<{ id: string; name: string }>(
        'SELECT id, name FROM projects WHERE id = $1',
        [req.params.projectId],
      );
      if (!project) {
        res.status(404).json({ error: { message: 'Projeto não encontrado' } });
        return;
      }

      await deprovisionProject(project.id, dbName);
      await audit(req, 'project_deleted', 'project', project.id, {
        name: project.name,
        project_id: project.id,
        db_name: dbName,
        justificativa: body.justificativa,
        details: `O projeto ${project.name} foi excluído. Justificativa: ${body.justificativa}`,
      });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/:projectId/members',
  requireAuth,
  requireProjectMember,
  requireAnyScreen('base', 'kanban', 'settings'),
  async (req, res, next) => {
    try {
      const rows = await query<{
        id: string;
        name: string;
        email: string;
        profile_name: string | null;
        project_role: string | null;
      }>(
        `SELECT u.id, u.name, u.email, p.name AS profile_name,
                ${projectRoleExpr('$1', 'u.id')} AS project_role
         FROM users u
         JOIN profiles p ON p.id = u.profile_id
         JOIN project_members pm ON pm.user_id = u.id
         WHERE pm.project_id = $1
         ORDER BY u.name`,
        [req.params.projectId],
      );
      res.json(rows);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/:projectId/members',
  requireAuth,
  requireScreen('settings'),
  requireProjectMember,
  async (req, res, next) => {
    try {
      await assertProjectEditable(req.params.projectId!);
      const body = memberBody.parse(req.body);
      const user = await queryOne<{ id: string }>(
        'SELECT id FROM users WHERE id = $1 AND is_active = true',
        [body.user_id],
      );
      if (!user) throw new ApiError(404, 'Usuário inexistente ou inativo');

      const existing = await queryOne(
        'SELECT 1 AS ok FROM project_members WHERE project_id = $1 AND user_id = $2',
        [req.params.projectId, body.user_id],
      );
      if (existing) throw new ApiError(409, 'Usuário já é membro deste projeto');

      await pool.query(
        'INSERT INTO project_members (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [req.params.projectId, body.user_id],
      );
      if (body.project_role) {
        await pool.query(
          'INSERT INTO project_team (project_id, role, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [req.params.projectId, body.project_role, body.user_id],
        );
      }
      const row = await queryOne<{
        id: string;
        name: string;
        email: string;
        profile_name: string | null;
        project_role: string | null;
      }>(
        `SELECT u.id, u.name, u.email, p.name AS profile_name,
                ${projectRoleExpr('$1', 'u.id')} AS project_role
         FROM users u
         JOIN profiles p ON p.id = u.profile_id
         JOIN project_members pm ON pm.user_id = u.id
         WHERE pm.project_id = $1 AND u.id = $2`,
        [req.params.projectId, body.user_id],
      );
      await audit(req, 'member_added', 'project_member', body.user_id, {
        project_id: req.params.projectId,
        email: row?.email ?? '',
      });
      const project = await queryOne<{ name: string }>(
        'SELECT name FROM projects WHERE id = $1',
        [req.params.projectId],
      );
      await notify({
        userId: body.user_id,
        actorId: req.user!.id,
        type: 'project_member_added',
        title: 'Você foi adicionado a um projeto',
        body: project?.name ?? '',
        projectId: req.params.projectId,
        screen: 'kanban',
        link: `/kanban?proj=${req.params.projectId}`,
      });
      res.status(201).json(row);
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  '/:projectId/members/:userId',
  requireAuth,
  requireScreen('settings'),
  requireProjectMember,
  async (req, res, next) => {
    try {
      await assertProjectEditable(req.params.projectId!);
      const params = memberParams.parse(req.params);
      const existing = await queryOne(
        'SELECT 1 AS ok FROM project_members WHERE project_id = $1 AND user_id = $2',
        [params.projectId, params.userId],
      );
      if (!existing) throw new ApiError(404, 'Usuário não é membro deste projeto');

      const count = await queryOne<{ total: number }>(
        'SELECT count(*)::int AS total FROM project_members WHERE project_id = $1',
        [params.projectId],
      );
      if ((count?.total ?? 0) <= 1) {
        throw new ApiError(400, 'O projeto precisa de pelo menos um membro');
      }

      const { projectPool } = await getProjectPool(params.projectId);
      const cards = await projectPool.query<{ total: number }>(
        'SELECT count(*)::int AS total FROM cards WHERE responsible_id = $1',
        [params.userId],
      );
      if ((cards.rows[0]?.total ?? 0) > 0) {
        throw new ApiError(
          400,
          'Usuário é responsável por cards deste projeto. Reatribua os cards antes de remover.',
        );
      }

      await pool.query('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [
        params.projectId,
        params.userId,
      ]);
      await pool.query('DELETE FROM project_team WHERE project_id = $1 AND user_id = $2', [
        params.projectId,
        params.userId,
      ]);
      await audit(req, 'member_removed', 'project_member', params.userId, {
        project_id: params.projectId,
      });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/:projectId/members/:userId',
  requireAuth,
  requireScreen('settings'),
  requireProjectMember,
  async (req, res, next) => {
    try {
      await assertProjectEditable(req.params.projectId!);
      const params = memberParams.parse(req.params);
      const body = memberRoleBody.parse(req.body);
      const existing = await queryOne(
        'SELECT 1 AS ok FROM project_members WHERE project_id = $1 AND user_id = $2',
        [params.projectId, params.userId],
      );
      if (!existing) throw new ApiError(404, 'Usuário não é membro deste projeto');

      const previousRows = await query<{ role: string }>(
        'SELECT role FROM project_team WHERE project_id = $1 AND user_id = $2',
        [params.projectId, params.userId],
      );

      await pool.query('DELETE FROM project_team WHERE project_id = $1 AND user_id = $2', [
        params.projectId,
        params.userId,
      ]);
      if (body.project_role) {
        await pool.query(
          'INSERT INTO project_team (project_id, role, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [params.projectId, body.project_role, params.userId],
        );
      }

      const row = await queryOne<{
        id: string;
        name: string;
        email: string;
        profile_name: string | null;
        project_role: string | null;
      }>(
        `SELECT u.id, u.name, u.email, p.name AS profile_name,
                ${projectRoleExpr('$1', 'u.id')} AS project_role
         FROM users u
         JOIN profiles p ON p.id = u.profile_id
         JOIN project_members pm ON pm.user_id = u.id
         WHERE pm.project_id = $1 AND u.id = $2`,
        [params.projectId, params.userId],
      );
      await audit(req, 'member_role_changed', 'project_member', params.userId, {
        project_id: params.projectId,
        from: previousRows.map((row) => row.role),
        to: body.project_role,
      });
      res.json(row);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/:projectId/conclude',
  requireAuth,
  requirePermission('dashboard.projetos_recentes.editar'),
  requireProjectMember,
  async (req, res, next) => {
    try {
      await gateSystemProject(req.params.projectId!, req.header(SECURITY_PASSWORD_HEADER), 'dashboard');
      const body = justificativaSchema.parse(req.body);
      const project = await queryOne<{ id: string; name: string; status: string | null }>(
        'SELECT id, name, status FROM projects WHERE id = $1',
        [req.params.projectId],
      );
      if (!project) {
        res.status(404).json({ error: { message: 'Projeto não encontrado' } });
        return;
      }
      if (project.status === CONCLUDED_STATUS) {
        throw new ApiError(409, 'Projeto já está concluído');
      }

      const row = await queryOne<{ id: string; name: string; status: string | null }>(
        `UPDATE projects SET status = $2 WHERE id = $1 RETURNING id, name, status`,
        [project.id, CONCLUDED_STATUS],
      );
      const details = `O projeto ${project.name} (ID: prj_${project.id}) foi marcado como CONCLUÍDO pelo usuário ${req.user!.name} (ID: ${req.user!.id}). Justificativa: ${body.justificativa}.`;
      await audit(req, 'project_completed', 'project', project.id, {
        project_id: project.id,
        name: project.name,
        details,
        justificativa: body.justificativa,
        previous_status: project.status ?? '',
        ...(await scopeAuditMeta()),
      });
      void deliverWebhooks('project.completed', {
        project_id: project.id,
        name: project.name,
      });
      res.json(row);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/:projectId/reopen',
  requireAuth,
  requirePermission('dashboard.projetos_recentes.editar'),
  requireProjectMember,
  async (req, res, next) => {
    try {
      await gateSystemProject(req.params.projectId!, req.header(SECURITY_PASSWORD_HEADER), 'dashboard');
      const body = justificativaSchema.parse(req.body);
      const project = await queryOne<{ id: string; name: string; status: string | null }>(
        'SELECT id, name, status FROM projects WHERE id = $1',
        [req.params.projectId],
      );
      if (!project) {
        res.status(404).json({ error: { message: 'Projeto não encontrado' } });
        return;
      }
      if (project.status !== CONCLUDED_STATUS) {
        throw new ApiError(409, 'Projeto não está concluído');
      }

      const last = await queryOne<{ meta: Record<string, unknown> | null }>(
        `SELECT meta FROM audit_logs
         WHERE action = 'project_completed' AND entity = 'project' AND entity_id = $1
         ORDER BY id DESC
         LIMIT 1`,
        [project.id],
      );
      const previous = last?.meta?.previous_status;
      const restorable =
        typeof previous === 'string' && (EDIT_STATUSES as readonly string[]).includes(previous)
          ? previous
          : 'Em andamento';

      const row = await queryOne<{ id: string; name: string; status: string | null }>(
        `UPDATE projects SET status = $2 WHERE id = $1 RETURNING id, name, status`,
        [project.id, restorable],
      );
      const details = `O projeto ${project.name} (ID: prj_${project.id}) foi reaberto pelo usuário ${req.user!.name} (ID: ${req.user!.id}). Status restaurado: ${restorable}. Justificativa: ${body.justificativa}.`;
      await audit(req, 'project_reopened', 'project', project.id, {
        project_id: project.id,
        name: project.name,
        details,
        justificativa: body.justificativa,
        restored_status: restorable,
        ...(await scopeAuditMeta()),
      });
      void deliverWebhooks('project.reopened', {
        project_id: project.id,
        name: project.name,
      });
      res.json(row);
    } catch (error) {
      next(error);
    }
  },
);

router.use('/:projectId', requireAuth, requireProjectMember, editableProjectGuard, baseRouter);
router.use('/:projectId', requireAuth, requireProjectMember, auditRouter);
router.use('/:projectId', requireAuth, requireProjectMember, editableProjectGuard, kanbanRouter);
router.use('/:projectId', requireAuth, requireProjectMember, dashboardRouter);
router.use('/:projectId', requireAuth, requireProjectMember, editableProjectGuard, milestonesRouter);
router.use('/:projectId', requireAuth, requireProjectMember, reportsRouter);

export default router;
