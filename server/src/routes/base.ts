import { Router } from 'express';
import { z } from 'zod';
import { getProjectPool } from '../db/projectPool.js';
import { audit } from '../middleware/audit.js';
import { requireAnyScreen, requirePermission } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import { broadcastProject } from '../realtime.js';
import { requireSecurityPassword, SECURITY_PASSWORD_HEADER } from '../services/securityPassword.js';
import { parseStructureCsv, parseStructureXlsx } from '../services/baseSpreadsheet.js';
import { deliverWebhooks } from '../services/webhookDelivery.js';

const router = Router({ mergeParams: true });

const idParams = z.object({ id: z.string().uuid('Identificador inválido') });
const nameBody = z.object({ name: z.string().trim().min(1, 'Nome obrigatório').max(80) });
const sectorPatch = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    position: z.number().int().min(0).optional(),
  })
  .refine((body) => body.name !== undefined || body.position !== undefined, {
    message: 'Nada para atualizar',
  });
const departmentCreate = nameBody.extend({ sector_id: z.string().uuid('Setor inválido') });
const importBody = z.object({
  file_base64: z.string().min(1, 'Arquivo obrigatório').max(400_000, 'Arquivo muito grande'),
  filename: z.string().trim().min(1, 'Nome do arquivo obrigatório').max(200),
});
const departmentPatch = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    position: z.number().int().min(0).optional(),
    sector_id: z.string().uuid().optional(),
  })
  .refine(
    (body) =>
      body.name !== undefined || body.position !== undefined || body.sector_id !== undefined,
    { message: 'Nada para atualizar' },
  );

async function gateStructural(
  projectId: string,
  header: string | undefined,
): Promise<Awaited<ReturnType<typeof getProjectPool>>['projectPool']> {
  const { projectPool } = await getProjectPool(projectId);
  await requireSecurityPassword(header, 'base');
  return projectPool;
}

async function renumberSectors(projectPool: Awaited<ReturnType<typeof gateStructural>>): Promise<void> {
  await projectPool.query(
    `UPDATE sectors s SET position = x.rn
     FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY position, created_at) AS rn FROM sectors) x
     WHERE s.id = x.id`,
  );
}

async function renumberDepartments(
  projectPool: Awaited<ReturnType<typeof gateStructural>>,
  sectorId: string,
): Promise<void> {
  await projectPool.query(
    `UPDATE departments d SET position = x.rn
     FROM (
       SELECT id, ROW_NUMBER() OVER (ORDER BY position, created_at) AS rn
       FROM departments WHERE sector_id = $1
     ) x
     WHERE d.id = x.id`,
    [sectorId],
  );
}

router.get('/sectors', requireAnyScreen('base', 'kanban', 'dashboard'), async (req, res, next) => {
  try {
    const { projectPool } = await getProjectPool(req.params.projectId!);
    const [sectors, departments, departmentProgress, sectorProgress, overdueRows] = await Promise.all([
      projectPool.query<{ id: string; name: string; position: number }>(
        'SELECT id, name, position FROM sectors ORDER BY position, created_at',
      ),
      projectPool.query<{ id: string; sector_id: string; name: string; position: number }>(
        'SELECT id, sector_id, name, position FROM departments ORDER BY position, created_at',
      ),
      projectPool.query<{
        department_id: string;
        total_cards: number;
        completed_cards: number;
        percent: number | null;
      }>('SELECT department_id, total_cards, completed_cards, percent FROM department_progress'),
      projectPool.query<{
        sector_id: string;
        total_cards: number;
        completed_cards: number;
        percent: number | null;
      }>('SELECT sector_id, total_cards, completed_cards, percent FROM sector_progress'),
      projectPool.query<{ department_id: string; sector_id: string; overdue_cards: number }>(
        `SELECT d.id AS department_id, d.sector_id, COUNT(c.id)::int AS overdue_cards
         FROM departments d
         LEFT JOIN cards c ON c.department_id = d.id
           AND c.due_date < CURRENT_DATE AND c.completed_at IS NULL
         GROUP BY d.id, d.sector_id`,
      ),
    ]);

    const deptProgressById = new Map(
      departmentProgress.rows.map((row) => [row.department_id, row]),
    );
    const sectorProgressById = new Map(sectorProgress.rows.map((row) => [row.sector_id, row]));
    const deptOverdueById = new Map(overdueRows.rows.map((row) => [row.department_id, row.overdue_cards]));
    const sectorOverdueById = new Map<string, number>();
    for (const row of overdueRows.rows) {
      sectorOverdueById.set(
        row.sector_id,
        (sectorOverdueById.get(row.sector_id) ?? 0) + row.overdue_cards,
      );
    }

    res.json(
      sectors.rows.map((sector) => {
        const progress = sectorProgressById.get(sector.id);
        return {
          id: sector.id,
          name: sector.name,
          position: sector.position,
          percent: progress?.percent ?? null,
          total_cards: progress?.total_cards ?? 0,
          completed_cards: progress?.completed_cards ?? 0,
          overdue_cards: sectorOverdueById.get(sector.id) ?? 0,
          departments: departments.rows
            .filter((department) => department.sector_id === sector.id)
            .map((department) => {
              const departmentState = deptProgressById.get(department.id);
              return {
                id: department.id,
                name: department.name,
                position: department.position,
                percent: departmentState?.percent ?? null,
                total_cards: departmentState?.total_cards ?? 0,
                completed_cards: departmentState?.completed_cards ?? 0,
                overdue_cards: deptOverdueById.get(department.id) ?? 0,
              };
            }),
        };
      }),
    );
  } catch (error) {
    next(error);
  }
});

router.post('/sectors', requirePermission('base.novo_registro'), async (req, res, next) => {
  try {
    const body = nameBody.parse(req.body);
    const projectPool = await gateStructural(req.params.projectId!, req.header(SECURITY_PASSWORD_HEADER));
    const row = await projectPool.query<{ id: string; name: string; position: number }>(
      `INSERT INTO sectors (name, position)
       VALUES ($1, COALESCE((SELECT MAX(position) FROM sectors), 0) + 1)
       RETURNING id, name, position`,
      [body.name],
    );
    const sector = row.rows[0]!;
    await audit(req, 'sector_created', 'sector', sector.id, {
      project_id: req.params.projectId,
      name: sector.name,
    });
    void deliverWebhooks('structure.created', {
      project_id: req.params.projectId!,
      kind: 'sector',
      structure_id: sector.id,
      name: sector.name,
    });
    broadcastProject(req.params.projectId!, 'structure_changed');
    res.status(201).json(sector);
  } catch (error) {
    next(error);
  }
});

router.patch('/sectors/:id', requirePermission('base.acoes.editar'), async (req, res, next) => {
  try {
    const params = idParams.parse(req.params);
    const body = sectorPatch.parse(req.body);
    const projectPool = await gateStructural(req.params.projectId!, req.header(SECURITY_PASSWORD_HEADER));

    const existing = await projectPool.query('SELECT id FROM sectors WHERE id = $1', [params.id]);
    if (existing.rowCount === 0) {
      throw new ApiError(404, 'Setor não encontrado');
    }

    const updated = await projectPool.query<{ id: string; name: string; position: number }>(
      `UPDATE sectors
       SET name = COALESCE($1, name),
           position = COALESCE($2, position)
       WHERE id = $3
       RETURNING id, name, position`,
      [body.name ?? null, body.position ?? null, params.id],
    );
    await renumberSectors(projectPool);
    await audit(req, 'sector_updated', 'sector', params.id, {
      project_id: req.params.projectId,
      fields: Object.keys(body),
    });
    broadcastProject(req.params.projectId!, 'structure_changed');
    res.json(updated.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.delete('/sectors/:id', requirePermission('base.acoes.excluir'), async (req, res, next) => {
  try {
    const params = idParams.parse(req.params);
    const projectPool = await gateStructural(req.params.projectId!, req.header(SECURITY_PASSWORD_HEADER));

    const departments = await projectPool.query(
      'SELECT id FROM departments WHERE sector_id = $1 LIMIT 1',
      [params.id],
    );
    if ((departments.rowCount ?? 0) > 0) {
      throw new ApiError(400, 'Remova os departamentos do setor antes de exclui-lo');
    }
    const deleted = await projectPool.query('DELETE FROM sectors WHERE id = $1', [params.id]);
    if (deleted.rowCount === 0) {
      throw new ApiError(404, 'Setor não encontrado');
    }
    await renumberSectors(projectPool);
    await audit(req, 'sector_deleted', 'sector', params.id, {
      project_id: req.params.projectId,
    });
    broadcastProject(req.params.projectId!, 'structure_changed');
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.post('/departments', requirePermission('base.novo_registro'), async (req, res, next) => {
  try {
    const body = departmentCreate.parse(req.body);
    const projectPool = await gateStructural(req.params.projectId!, req.header(SECURITY_PASSWORD_HEADER));

    const sector = await projectPool.query('SELECT id FROM sectors WHERE id = $1', [body.sector_id]);
    if (sector.rowCount === 0) {
      throw new ApiError(400, 'Setor inexistente');
    }
    const row = await projectPool.query<{ id: string; name: string; sector_id: string; position: number }>(
      `INSERT INTO departments (sector_id, name, position)
       VALUES ($1, $2, COALESCE((SELECT MAX(position) FROM departments WHERE sector_id = $1), 0) + 1)
       RETURNING id, name, sector_id, position`,
      [body.sector_id, body.name],
    );
    const department = row.rows[0]!;
    await audit(req, 'department_created', 'department', department.id, {
      project_id: req.params.projectId,
      name: department.name,
      sector_id: department.sector_id,
    });
    void deliverWebhooks('structure.created', {
      project_id: req.params.projectId!,
      kind: 'department',
      structure_id: department.id,
      name: department.name,
    });
    broadcastProject(req.params.projectId!, 'structure_changed');
    res.status(201).json(department);
  } catch (error) {
    next(error);
  }
});

router.post('/base/import', requirePermission('home.novo_projeto'), async (req, res, next) => {
  try {
    const body = importBody.parse(req.body);
    const lower = body.filename.toLowerCase();
    let buffer: Buffer;
    try {
      buffer = Buffer.from(body.file_base64, 'base64');
    } catch {
      throw new ApiError(400, 'Arquivo inválido');
    }
    if (buffer.length === 0) {
      throw new ApiError(400, 'Arquivo vazio');
    }

    let parsed;
    if (lower.endsWith('.xlsx')) {
      parsed = await parseStructureXlsx(buffer);
    } else if (lower.endsWith('.csv')) {
      parsed = parseStructureCsv(buffer.toString('utf-8'));
    } else {
      throw new ApiError(400, 'Formato não suportado. Use .xlsx ou .csv');
    }

    if (parsed.errors.length > 0) {
      res.status(400).json({
        error: { message: 'Planilha inválida', errors: parsed.errors },
      });
      return;
    }

    const { projectPool } = await getProjectPool(req.params.projectId!);
    const sectorIds = new Map<string, string>();
    let sectorCount = 0;
    let departmentCount = 0;
    for (const row of parsed.rows) {
      let sectorId = sectorIds.get(row.sector);
      if (!sectorId) {
        const created = await projectPool.query<{ id: string }>(
          `INSERT INTO sectors (name, position)
           VALUES ($1, COALESCE((SELECT MAX(position) FROM sectors), 0) + 1)
           RETURNING id`,
          [row.sector],
        );
        sectorId = created.rows[0]!.id;
        sectorIds.set(row.sector, sectorId);
        sectorCount += 1;
      }
      if (row.department) {
        await projectPool.query(
          `INSERT INTO departments (sector_id, name, position)
           VALUES ($1, $2, COALESCE((SELECT MAX(position) FROM departments WHERE sector_id = $1), 0) + 1)`,
          [sectorId, row.department],
        );
        departmentCount += 1;
      }
    }

    await audit(req, 'project_base_imported', 'project', req.params.projectId!, {
      filename: body.filename,
      sectors: sectorCount,
      departments: departmentCount,
    });
    broadcastProject(req.params.projectId!, 'structure_changed');
    res.json({ sectors: sectorCount, departments: departmentCount });
  } catch (error) {
    next(error);
  }
});

router.patch('/departments/:id', requirePermission('base.acoes.editar'), async (req, res, next) => {
  try {
    const params = idParams.parse(req.params);
    const body = departmentPatch.parse(req.body);
    const projectPool = await gateStructural(req.params.projectId!, req.header(SECURITY_PASSWORD_HEADER));

    const existing = await projectPool.query<{ sector_id: string }>(
      'SELECT sector_id FROM departments WHERE id = $1',
      [params.id],
    );
    if (existing.rowCount === 0) {
      throw new ApiError(404, 'Departamento não encontrado');
    }
    const previousSectorId = existing.rows[0]!.sector_id;

    if (body.sector_id) {
      const sector = await projectPool.query('SELECT id FROM sectors WHERE id = $1', [
        body.sector_id,
      ]);
      if (sector.rowCount === 0) {
        throw new ApiError(400, 'Setor inexistente');
      }
    }
    const targetSectorId = body.sector_id ?? previousSectorId;

    const updated = await projectPool.query<{
      id: string;
      name: string;
      sector_id: string;
      position: number;
    }>(
      `UPDATE departments
       SET name = COALESCE($1, name),
           position = COALESCE($2, position),
           sector_id = $3
       WHERE id = $4
       RETURNING id, name, sector_id, position`,
      [body.name ?? null, body.position ?? null, targetSectorId, params.id],
    );
    await renumberDepartments(projectPool, previousSectorId);
    if (targetSectorId !== previousSectorId) {
      await renumberDepartments(projectPool, targetSectorId);
    }
    await audit(req, 'department_updated', 'department', params.id, {
      project_id: req.params.projectId,
      fields: Object.keys(body),
    });
    broadcastProject(req.params.projectId!, 'structure_changed');
    res.json(updated.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.delete('/departments/:id', requirePermission('base.acoes.excluir'), async (req, res, next) => {
  try {
    const params = idParams.parse(req.params);
    const projectPool = await gateStructural(req.params.projectId!, req.header(SECURITY_PASSWORD_HEADER));

    const department = await projectPool.query<{ sector_id: string }>(
      'SELECT sector_id FROM departments WHERE id = $1',
      [params.id],
    );
    if (department.rowCount === 0) {
      throw new ApiError(404, 'Departamento não encontrado');
    }
    const cards = await projectPool.query('SELECT id FROM cards WHERE department_id = $1 LIMIT 1', [
      params.id,
    ]);
    if ((cards.rowCount ?? 0) > 0) {
      throw new ApiError(400, 'Mova ou exclua os cards do departamento antes de exclui-lo');
    }
    await projectPool.query('DELETE FROM departments WHERE id = $1', [params.id]);
    await renumberDepartments(projectPool, department.rows[0]!.sector_id);
    await audit(req, 'department_deleted', 'department', params.id, {
      project_id: req.params.projectId,
    });
    broadcastProject(req.params.projectId!, 'structure_changed');
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.get(
  '/progress',
  requireAnyScreen('base', 'kanban', 'dashboard'),
  async (req, res, next) => {
    try {
      const { projectPool } = await getProjectPool(req.params.projectId!);
      const [departments, sectors] = await Promise.all([
        projectPool.query(
          'SELECT department_id, sector_id, total_cards, completed_cards, percent FROM department_progress',
        ),
        projectPool.query(
          'SELECT sector_id, total_cards, completed_cards, percent FROM sector_progress',
        ),
      ]);
      res.json({ departments: departments.rows, sectors: sectors.rows });
    } catch (error) {
      next(error);
    }
  },
);

const boardBackgroundBody = z.object({
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida')
    .nullable(),
});

router.get(
  '/settings/board-background',
  requireAnyScreen('kanban', 'settings'),
  async (req, res, next) => {
    try {
      const { projectPool } = await getProjectPool(req.params.projectId!);
      const result = await projectPool.query<{ board_background: string }>(
        'SELECT board_background FROM project_settings WHERE id = 1',
      );
      res.json({ color: result.rows[0]?.board_background || null });
    } catch (error) {
      next(error);
    }
  },
);

router.put('/settings/board-background', requirePermission('settings.temas'), async (req, res, next) => {
  try {
    const body = boardBackgroundBody.parse(req.body);
    const { projectPool } = await getProjectPool(req.params.projectId!);
    await projectPool.query('UPDATE project_settings SET board_background = $1 WHERE id = 1', [
      body.color ?? '',
    ]);
    await audit(req, 'board_background_set', 'project_settings', req.params.projectId, {
      project_id: req.params.projectId,
      color: body.color,
    });
    res.json({ color: body.color });
  } catch (error) {
    next(error);
  }
});

export default router;
