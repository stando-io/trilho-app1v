import { Router } from 'express';
import { z } from 'zod';
import { getProjectPool } from '../db/projectPool.js';
import { audit } from '../middleware/audit.js';
import { requirePermission, requireScreen } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import { broadcastProject } from '../realtime.js';
import { isValidDate } from '../services/dates.js';
import { requireSecurityPassword, SECURITY_PASSWORD_HEADER } from '../services/securityPassword.js';

const router = Router({ mergeParams: true });

const idParams = z.object({ id: z.string().uuid('Identificador inválido') });
const milestoneCreate = z.object({
  name: z.string().trim().min(2, 'Nome do marco muito curto').max(120),
  due_date: z.string().refine(isValidDate, 'Data inválida'),
  description: z.string().trim().max(500, 'Descrição muito longa').optional(),
});
const milestonePatch = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    due_date: z.string().refine(isValidDate, 'Data inválida').optional(),
    description: z.string().trim().max(500).optional(),
  })
  .refine(
    (body) =>
      body.name !== undefined || body.due_date !== undefined || body.description !== undefined,
    {
      message: 'Nada para atualizar',
    },
  );

router.get('/milestones', requireScreen('dashboard'), async (req, res, next) => {
  try {
    const { projectPool } = await getProjectPool(req.params.projectId!);
    const result = await projectPool.query(
      'SELECT id, name, due_date, description, created_at FROM milestones ORDER BY due_date, created_at',
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post('/milestones', requirePermission('home.registrar_agenda'), async (req, res, next) => {
  try {
    await requireSecurityPassword(req.header(SECURITY_PASSWORD_HEADER), 'home');
    const body = milestoneCreate.parse(req.body);
    const projectId = req.params.projectId!;
    const { projectPool } = await getProjectPool(projectId);
    const result = await projectPool.query<{
      id: string;
      name: string;
      due_date: string;
      description: string;
    }>(
      'INSERT INTO milestones (name, due_date, description) VALUES ($1, $2, $3) RETURNING id, name, due_date, description',
      [body.name, body.due_date, body.description ?? ''],
    );
    const milestone = result.rows[0]!;
    await audit(req, 'milestone_created', 'milestone', milestone.id, {
      project_id: projectId,
      name: milestone.name,
      due_date: milestone.due_date,
    });
    broadcastProject(projectId, 'milestones_changed');
    res.status(201).json(milestone);
  } catch (error) {
    next(error);
  }
});

router.patch('/milestones/:id', requirePermission('home.registrar_agenda'), async (req, res, next) => {
  try {
    await requireSecurityPassword(req.header(SECURITY_PASSWORD_HEADER), 'home');
    const params = idParams.parse(req.params);
    const body = milestonePatch.parse(req.body);
    const projectId = req.params.projectId!;
    const { projectPool } = await getProjectPool(projectId);

    const updated = await projectPool.query<{
      id: string;
      name: string;
      due_date: string;
      description: string;
    }>(
      `UPDATE milestones
       SET name = COALESCE($1, name),
           due_date = COALESCE($2, due_date),
           description = COALESCE($3, description)
       WHERE id = $4
       RETURNING id, name, due_date, description`,
      [body.name ?? null, body.due_date ?? null, body.description ?? null, params.id],
    );
    if (updated.rowCount === 0) {
      throw new ApiError(404, 'Marco não encontrado');
    }
    await audit(req, 'milestone_updated', 'milestone', params.id, {
      project_id: projectId,
      fields: Object.keys(body),
    });
    broadcastProject(projectId, 'milestones_changed');
    res.json(updated.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.delete('/milestones/:id', requirePermission('home.registrar_agenda'), async (req, res, next) => {
  try {
    await requireSecurityPassword(req.header(SECURITY_PASSWORD_HEADER), 'home');
    const params = idParams.parse(req.params);
    const projectId = req.params.projectId!;
    const { projectPool } = await getProjectPool(projectId);

    const deleted = await projectPool.query('DELETE FROM milestones WHERE id = $1 RETURNING id', [
      params.id,
    ]);
    if (deleted.rowCount === 0) {
      throw new ApiError(404, 'Marco não encontrado');
    }
    await audit(req, 'milestone_deleted', 'milestone', params.id, {
      project_id: projectId,
    });
    broadcastProject(projectId, 'milestones_changed');
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
