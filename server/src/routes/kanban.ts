import { Router } from 'express';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getProjectPool } from '../db/projectPool.js';
import { pool, query } from '../db/pool.js';
import { audit } from '../middleware/audit.js';
import { requirePermission, requireScreen } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import { broadcastProject } from '../realtime.js';
import { isValidDate } from '../services/dates.js';
import { deliverWebhooks } from '../services/webhookDelivery.js';
import { requireSecurityPassword, SECURITY_PASSWORD_HEADER, getCardCharLimits } from '../services/securityPassword.js';
import {
  extractMentionUserIds,
  extractMentionUserIdsByText,
  getCardTargets,
  kanbanCardLink,
  notifyMany,
  stripHtml,
} from '../services/notifications.js';

const router = Router({ mergeParams: true });

const idParams = z.object({ id: z.string().uuid('Identificador inválido') });
const optionalUuid = z.preprocess(
  (value) => (value === '' || value === undefined || value === null ? undefined : value),
  z.string().uuid('Identificador inválido').optional(),
);
const optionalUuidNullable = z.preprocess(
  (value) => (value === undefined ? undefined : value === '' || value === null ? null : value),
  z.union([z.string().uuid('Identificador inválido'), z.null()]).optional(),
);
const optionalDateNullable = z.preprocess(
  (value) => (value === undefined ? undefined : value === '' || value === null ? null : value),
  z
    .union([
      z.string().refine(isValidDate, 'Data inválida'),
      z.null(),
    ])
    .optional(),
);

const columnColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida')
  .nullable();

const columnCreate = z.object({
  name: z.string().trim().min(1, 'Nome obrigatório').max(60),
  is_done: z.boolean().optional().default(false),
  color: columnColor.optional(),
});
const columnPatch = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    position: z.number().int().min(0).optional(),
    is_done: z.boolean().optional(),
    color: columnColor.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Nada para atualizar' });

function buildCardSchemas(titleMax: number, descriptionMax: number) {
  const title = z.string().trim().min(1, 'Título obrigatório').max(titleMax);
  const description = z
    .string()
    .max(descriptionMax, `Descrição excede o limite de ${descriptionMax} caracteres`)
    .optional()
    .default('');
  const fields = {
    title,
    description,
    priority: z.enum(['baixa', 'media', 'alta']).optional().default('media'),
    department_id: optionalUuidNullable,
    responsible_id: optionalUuidNullable,
    responsible_ids: z.array(z.string().uuid('Identificador inválido')).optional(),
    due_date: optionalDateNullable,
    origin: z.string().max(120).optional().default(''),
    column_id: optionalUuid,
    learning_index_active: z.boolean().optional().default(false),
    learning_index_score: z
      .number()
      .int()
      .min(0, 'Nota mínima 0')
      .max(10, 'Nota máxima 10')
      .nullable()
      .optional(),
    learning_index_note: z.string().max(500).optional().default(''),
  };
  const cardCreate = z.object(fields);
  const cardPatch = z
    .object({
      title: fields.title.optional(),
      description: fields.description.optional(),
      priority: fields.priority.optional(),
      department_id: fields.department_id,
      responsible_id: fields.responsible_id,
      responsible_ids: fields.responsible_ids,
      due_date: fields.due_date,
      origin: fields.origin.optional(),
      column_id: fields.column_id,
      position: z.number().int().min(0).optional(),
      learning_index_active: fields.learning_index_active.optional(),
      learning_index_score: fields.learning_index_score,
      learning_index_note: fields.learning_index_note.optional(),
    })
    .refine((body) => Object.keys(body).length > 0, { message: 'Nada para atualizar' });
  return { cardCreate, cardPatch };
}

const listQuery = z.object({
  department_id: optionalUuid,
  sector_id: optionalUuid,
  responsible_id: optionalUuid,
  status: z.enum(['done', 'pending']).optional(),
  q: z.string().max(120).optional(),
});

const subtaskCreate = z.object({ subtask_id: z.string().uuid('Identificador inválido') });
const commentCreate = z.object({
  body: z.string().trim().min(1, 'Comentário obrigatório').max(2000),
});
const uploadBase64 = z.object({
  filename: z.string().trim().min(1, 'Nome obrigatório').max(200),
  data_base64: z.string().min(1, 'Imagem obrigatória'),
  card_id: optionalUuid,
});
const attachmentRename = z.object({
  filename: z.string().trim().min(1, 'Nome obrigatório').max(200),
});
const attachmentOrder = z.object({
  order: z.array(z.string().uuid('Identificador inválido')).min(1, 'Lista obrigatória').max(200),
});

const DANGEROUS_HTML = /<\s*(script|iframe|object|embed|style|link|meta|form|input|button)\b|\son\w+\s*=|javascript\s*:/i;

function assertSafeDescription(description: string): void {
  if (DANGEROUS_HTML.test(description)) {
    throw new ApiError(400, 'Descrição contém conteúdo não permitido');
  }
}

const UPLOADS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'uploads',
);

const MAGIC_BYTES: Array<{ ext: string; test: (buffer: Buffer) => boolean }> = [
  { ext: 'png', test: (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: 'jpg', test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'gif', test: (b) => b.length >= 6 && b.toString('ascii', 0, 4) === 'GIF8' },
  {
    ext: 'webp',
    test: (b) =>
      b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  },
];

function describeCardChanges(
  current: Record<string, unknown>,
  body: Record<string, unknown>,
  columnNames?: Map<string, string>,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const fields: Array<[keyof typeof current, unknown]> = [
    ['title', body.title],
    ['priority', body.priority],
    ['origin', body.origin],
    ['due_date', body.due_date],
    ['department_id', body.department_id],
    ['responsible_id', body.responsible_id],
    ['learning_index_active', body.learning_index_active],
    ['learning_index_score', body.learning_index_score],
    ['learning_index_note', body.learning_index_note],
  ];
  for (const [key, next] of fields) {
    if (next !== undefined && next !== current[key]) {
      changes[key] = { from: current[key] ?? null, to: next ?? null };
    }
  }
  if (body.responsible_ids !== undefined && body.responsible_id === undefined) {
    changes.responsible_ids = { from: '(lista anterior)', to: '(nova lista)' };
  }
  if (body.description !== undefined && body.description !== current.description) {
    changes.description = { from: '(texto anterior)', to: '(novo texto)' };
  }
  if (body.column_id !== undefined && body.column_id !== current.column_id && columnNames) {
    changes.column_id = {
      from: columnNames.get(String(current.column_id)) ?? current.column_id,
      to: columnNames.get(String(body.column_id)) ?? body.column_id,
    };
  }
  return changes;
}

async function gateStructural(projectId: string | undefined, header: string | undefined) {
  const { projectPool } = await getProjectPool(projectId!);
  await requireSecurityPassword(header, 'board');
  return projectPool;
}

async function assertColumn(
  projectPool: Awaited<ReturnType<typeof gateStructural>>,
  columnId: string,
): Promise<{ id: string; name: string; is_done: boolean }> {
  const result = await projectPool.query<{ id: string; name: string; is_done: boolean }>(
    'SELECT id, name, is_done FROM kanban_columns WHERE id = $1',
    [columnId],
  );
  if (result.rowCount === 0) {
    throw new ApiError(400, 'Coluna inexistente');
  }
  return result.rows[0]!;
}

function isDoneColumnName(name: string): boolean {
  return (
    name
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '') === 'concluido'
  );
}

async function assertDepartment(
  projectPool: Awaited<ReturnType<typeof gateStructural>>,
  departmentId: string,
): Promise<void> {
  const result = await projectPool.query('SELECT id FROM departments WHERE id = $1', [departmentId]);
  if (result.rowCount === 0) {
    throw new ApiError(400, 'Departamento inexistente');
  }
}

async function assertResponsibles(projectId: string, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const unique = [...new Set(userIds)];
  const members = await query<{ user_id: string }>(
    'SELECT user_id FROM project_members WHERE project_id = $1 AND user_id = ANY($2::uuid[])',
    [projectId, unique],
  );
  const found = new Set(members.map((m) => m.user_id));
  const missing = unique.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new ApiError(400, 'Responsável não é membro do projeto');
  }
}

async function replaceCardResponsibles(
  projectPool: Pool | PoolClient,
  cardId: string,
  userIds: string[],
): Promise<void> {
  await projectPool.query('DELETE FROM card_responsibles WHERE card_id = $1', [cardId]);
  if (userIds.length > 0) {
    const unique = [...new Set(userIds)];
    await projectPool.query(
      `INSERT INTO card_responsibles (card_id, user_id)
       SELECT $1, unnest($2::uuid[])
       ON CONFLICT DO NOTHING`,
      [cardId, unique],
    );
  }
  const primary = userIds.length > 0 ? userIds[0]! : null;
  await projectPool.query('UPDATE cards SET responsible_id = $1 WHERE id = $2', [primary, cardId]);
}

async function renumberColumns(
  projectPool: Awaited<ReturnType<typeof gateStructural>>,
): Promise<void> {
  await projectPool.query(
    `UPDATE kanban_columns k SET position = x.rn
     FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY position, created_at) AS rn FROM kanban_columns) x
     WHERE k.id = x.id`,
  );
}

async function reorderColumns(
  projectPool: Awaited<ReturnType<typeof gateStructural>>,
  targetId: string,
  targetIndex: number,
): Promise<void> {
  const rows = await projectPool.query<{ id: string }>(
    'SELECT id FROM kanban_columns WHERE id <> $1 ORDER BY position, created_at',
    [targetId],
  );
  const ids = rows.rows.map((row) => row.id);
  const clamped = Math.min(Math.max(targetIndex, 0), ids.length);
  ids.splice(clamped, 0, targetId);
  const positions = ids.map((_, index) => index + 1);
  await projectPool.query(
    `UPDATE kanban_columns SET position = x.rn
     FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::int[]) AS rn) x
     WHERE kanban_columns.id = x.id`,
    [ids, positions],
  );
}

async function renumberCards(
  projectPool: Pool | PoolClient,
  columnId: string,
  movedId?: string,
  targetIndex?: number,
): Promise<void> {
  const rows = await projectPool.query<{ id: string }>(
    'SELECT id FROM cards WHERE column_id = $1 ORDER BY position, created_at',
    [columnId],
  );
  let ids = rows.rows.map((row) => row.id);
  if (movedId && targetIndex !== undefined) {
    ids = ids.filter((id) => id !== movedId);
    const clamped = Math.min(Math.max(targetIndex, 0), ids.length);
    ids.splice(clamped, 0, movedId);
  }
  if (ids.length === 0) return;
  const positions = ids.map((_, index) => index);
  await projectPool.query(
    `UPDATE cards SET position = x.rn
     FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::int[]) AS rn) x
     WHERE cards.id = x.id`,
    [ids, positions],
  );
}

router.get('/columns', requirePermission('kanban.visualizar'), async (req, res, next) => {
  try {
    const { projectPool } = await getProjectPool(req.params.projectId!);
    const result = await projectPool.query(
      `SELECT k.id, k.name, k.position, k.is_done, k.locked, k.color,
              count(c.id)::int AS cards_count
       FROM kanban_columns k
       LEFT JOIN cards c ON c.column_id = k.id
       GROUP BY k.id
       ORDER BY k.position, k.created_at`,
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post('/columns', requireScreen('kanban'), async (req, res, next) => {
  try {
    const body = columnCreate.parse(req.body);
    const projectPool = await gateStructural(req.params.projectId, req.header(SECURITY_PASSWORD_HEADER));
    const result = await projectPool.query<{
      id: string;
      name: string;
      position: number;
      is_done: boolean;
      locked: boolean;
      color: string | null;
    }>(
      `INSERT INTO kanban_columns (name, position, is_done, color)
       VALUES ($1, COALESCE((SELECT MAX(position) FROM kanban_columns), 0) + 1, $2, $3)
       RETURNING id, name, position, is_done, locked, color`,
      [body.name, body.is_done, body.color ?? null],
    );
    const column = result.rows[0]!;
    await audit(req, 'column_created', 'kanban_column', column.id, {
      project_id: req.params.projectId,
      name: column.name,
    });
    broadcastProject(req.params.projectId!, 'columns_changed');
    res.status(201).json(column);
  } catch (error) {
    next(error);
  }
});

router.patch('/columns/:id', requireScreen('kanban'), async (req, res, next) => {
  try {
    const params = idParams.parse(req.params);
    const body = columnPatch.parse(req.body);
    const projectPool = await gateStructural(req.params.projectId, req.header(SECURITY_PASSWORD_HEADER));

    const existing = await projectPool.query<{ id: string }>(
      'SELECT id FROM kanban_columns WHERE id = $1',
      [params.id],
    );
    if (existing.rowCount === 0) {
      throw new ApiError(404, 'Coluna não encontrada');
    }

    const updated = await projectPool.query<{
      id: string;
      name: string;
      position: number;
      is_done: boolean;
      locked: boolean;
      color: string | null;
    }>(
      `UPDATE kanban_columns
       SET name = COALESCE($1, name),
           is_done = COALESCE($2, is_done),
           color = CASE WHEN $4::boolean THEN $5 ELSE color END
       WHERE id = $3
       RETURNING id, name, position, is_done, locked, color`,
      [body.name ?? null, body.is_done ?? null, params.id, body.color !== undefined, body.color ?? null],
    );
    if (body.position !== undefined) {
      await reorderColumns(projectPool, params.id, body.position);
    } else {
      await renumberColumns(projectPool);
    }

    if (body.is_done !== undefined) {
      if (body.is_done) {
        await projectPool.query(
          'UPDATE cards SET completed_at = COALESCE(completed_at, now()) WHERE column_id = $1',
          [params.id],
        );
      } else {
        await projectPool.query('UPDATE cards SET completed_at = NULL WHERE column_id = $1', [
          params.id,
        ]);
      }
    }

    await audit(req, 'column_updated', 'kanban_column', params.id, {
      project_id: req.params.projectId,
      fields: Object.keys(body),
    });
    broadcastProject(req.params.projectId!, 'columns_changed');
    const final = await projectPool.query(
      'SELECT id, name, position, is_done, locked, color FROM kanban_columns WHERE id = $1',
      [params.id],
    );
    res.json(final.rows[0] ?? updated.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.delete('/columns/:id', requireScreen('kanban'), async (req, res, next) => {
  try {
    const params = idParams.parse(req.params);
    const projectPool = await gateStructural(req.params.projectId, req.header(SECURITY_PASSWORD_HEADER));

    const existing = await projectPool.query<{ locked: boolean }>(
      'SELECT locked FROM kanban_columns WHERE id = $1',
      [params.id],
    );
    if (existing.rowCount === 0) {
      throw new ApiError(404, 'Coluna não encontrada');
    }
    if (existing.rows[0]!.locked) {
      throw new ApiError(403, 'Coluna padrão não pode ser excluída');
    }
    const cards = await projectPool.query('SELECT id FROM cards WHERE column_id = $1 LIMIT 1', [
      params.id,
    ]);
    if ((cards.rowCount ?? 0) > 0) {
      throw new ApiError(400, 'Mova ou exclua os cards antes de excluir a coluna');
    }
    await projectPool.query('DELETE FROM kanban_columns WHERE id = $1', [params.id]);
    await renumberColumns(projectPool);
    await audit(req, 'column_deleted', 'kanban_column', params.id, {
      project_id: req.params.projectId,
    });
    broadcastProject(req.params.projectId!, 'columns_changed');
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.delete('/columns/:id/cards', requirePermission('kanban.excluir_cards'), async (req, res, next) => {
  try {
    const params = idParams.parse(req.params);
    const projectPool = await gateStructural(req.params.projectId, req.header(SECURITY_PASSWORD_HEADER));

    const existing = await projectPool.query('SELECT id FROM kanban_columns WHERE id = $1', [
      params.id,
    ]);
    if (existing.rowCount === 0) {
      throw new ApiError(404, 'Coluna não encontrada');
    }
    const deleted = await projectPool.query('DELETE FROM cards WHERE column_id = $1', [params.id]);
    await audit(req, 'column_cards_cleared', 'kanban_column', params.id, {
      project_id: req.params.projectId,
      deleted: deleted.rowCount ?? 0,
    });
    broadcastProject(req.params.projectId!, 'cards_changed');
    res.json({ deleted: deleted.rowCount ?? 0 });
  } catch (error) {
    next(error);
  }
});

router.get('/cards', requirePermission('kanban.visualizar'), async (req, res, next) => {
  try {
    const filters = listQuery.parse(req.query);
    const projectId = req.params.projectId!;
    const { projectPool } = await getProjectPool(projectId);

    const [cards, members] = await Promise.all([
      projectPool.query(
        `SELECT c.id, c.task_code, c.title, c.description, c.priority, c.column_id, c.department_id,
                d.name AS department_name, d.sector_id, s.name AS sector_name,
                c.responsible_id, c.origin, c.due_date, c.position, c.completed_at, c.created_at,
                c.learning_index_active, c.learning_index_score, c.learning_index_note,
                COALESCE(cc.total, 0)::int AS comments_count,
                COALESCE(ca.total, 0)::int AS attachments_count,
                COALESCE(st.total, 0)::int AS subtasks_total,
                COALESCE(st.done, 0)::int AS subtasks_done
         FROM cards c
         LEFT JOIN departments d ON d.id = c.department_id
         LEFT JOIN sectors s ON s.id = d.sector_id
         LEFT JOIN (SELECT card_id, COUNT(*) AS total FROM card_comments GROUP BY card_id) cc
           ON cc.card_id = c.id
         LEFT JOIN (SELECT card_id, COUNT(*) AS total FROM card_attachments GROUP BY card_id) ca
           ON ca.card_id = c.id
         LEFT JOIN (
           SELECT cs.card_id,
                  COUNT(*) AS total,
                  COUNT(*) FILTER (WHERE sub.completed_at IS NOT NULL) AS done
           FROM card_subtasks cs
           JOIN cards sub ON sub.id = cs.subtask_id
           GROUP BY cs.card_id
         ) st ON st.card_id = c.id
         WHERE ($1::uuid IS NULL OR c.department_id = $1)
           AND ($2::uuid IS NULL OR d.sector_id = $2)
           AND (
             $3::uuid IS NULL
             OR c.responsible_id = $3
             OR EXISTS (SELECT 1 FROM card_responsibles cr WHERE cr.card_id = c.id AND cr.user_id = $3)
           )
           AND (
             $4::text IS NULL
             OR c.title ILIKE '%' || $4 || '%'
             OR c.description ILIKE '%' || $4 || '%'
             OR c.task_code ILIKE '%' || $4 || '%'
           )
           AND (
             $5::text IS NULL
             OR ($5 = 'done' AND c.completed_at IS NOT NULL)
             OR ($5 = 'pending' AND c.completed_at IS NULL)
           )
         ORDER BY c.position, c.created_at`,
        [
          filters.department_id ?? null,
          filters.sector_id ?? null,
          filters.responsible_id ?? null,
          filters.q ?? null,
          filters.status ?? null,
        ],
      ),
      query<{ id: string; name: string }>(
        `SELECT u.id, u.name
         FROM users u
         JOIN project_members pm ON pm.user_id = u.id
         WHERE pm.project_id = $1`,
        [projectId],
      ),
    ]);

    const cardIds = cards.rows.map((card) => card.id);
    const responsibleRows = cardIds.length
      ? await projectPool.query<{ card_id: string; user_id: string }>(
          `SELECT cr.card_id, cr.user_id
           FROM card_responsibles cr
           WHERE cr.card_id = ANY($1::uuid[])
           ORDER BY cr.created_at`,
          [cardIds],
        )
      : { rows: [] as Array<{ card_id: string; user_id: string }> };

    const nameById = new Map(members.map((member) => [member.id, member.name]));
    const responsiblesByCard = new Map<string, Array<{ id: string; name: string }>>();
    for (const row of responsibleRows.rows) {
      const list = responsiblesByCard.get(row.card_id) ?? [];
      list.push({ id: row.user_id, name: nameById.get(row.user_id) ?? row.user_id });
      responsiblesByCard.set(row.card_id, list);
    }

    res.json(
      cards.rows.map((card) => ({
        ...card,
        responsible_name: card.responsible_id
          ? (nameById.get(card.responsible_id) ?? null)
          : null,
        responsibles: responsiblesByCard.get(card.id) ?? [],
      })),
    );
  } catch (error) {
    next(error);
  }
});

router.post('/cards', requirePermission('kanban.criar_cards'), async (req, res, next) => {
  try {
    const limits = await getCardCharLimits();
    const { cardCreate } = buildCardSchemas(limits.title_max_chars, limits.description_max_chars);
    const body = cardCreate.parse(req.body);
    assertSafeDescription(body.description ?? '');
    const projectId = req.params.projectId!;
    const { projectPool } = await getProjectPool(projectId);

    if (body.department_id) {
      await assertDepartment(projectPool, body.department_id);
    }
    const responsibleIds = body.responsible_ids ?? (body.responsible_id ? [body.responsible_id] : []);
    if (responsibleIds.length > 0) {
      await assertResponsibles(projectId, responsibleIds);
    }

    let columnId = body.column_id;
    if (columnId) {
      await assertColumn(projectPool, columnId);
    } else {
      const first = await projectPool.query<{ id: string }>(
        'SELECT id FROM kanban_columns ORDER BY position, created_at LIMIT 1',
      );
      if (first.rowCount === 0) {
        throw new ApiError(400, 'O quadro não possui colunas');
      }
      columnId = first.rows[0]!.id;
    }

    const result = await projectPool.query<{
      id: string;
      position: number;
      task_code: string;
    }>(
      `INSERT INTO cards (title, description, priority, department_id, responsible_id, due_date,
                          origin, column_id, position, created_by, task_code,
                          learning_index_active, learning_index_score, learning_index_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
               COALESCE((SELECT MAX(position) FROM cards WHERE column_id = $8), -1) + 1,
               $9, 'ST-' || LPAD(nextval('seq_card_task_code')::text, 4, '0'),
               $10, $11, $12)
       RETURNING id, position, task_code`,
      [
        body.title,
        body.description,
        body.priority,
        body.department_id ?? null,
        responsibleIds[0] ?? null,
        body.due_date ?? null,
        body.origin,
        columnId,
        req.user!.id,
        body.learning_index_active,
        body.learning_index_score ?? null,
        body.learning_index_note,
      ],
    );
    const card = result.rows[0]!;
    if (responsibleIds.length > 0) {
      await replaceCardResponsibles(projectPool, card.id, responsibleIds);
    }
    await audit(req, 'card_created', 'card', card.id, {
      project_id: projectId,
      title: body.title,
      task_code: card.task_code,
    });
    const createdTargets = [
      ...new Set([...responsibleIds, ...extractMentionUserIds(body.description)]),
    ];
    await notifyMany(
      createdTargets.map((userId) => ({
        userId,
        actorId: req.user!.id,
        type: 'card_created',
        title: `Novo card: ${card.task_code}`,
        body: body.title,
        projectId,
        cardId: card.id,
        screen: 'kanban',
        link: kanbanCardLink(projectId, card.id),
      })),
    );
    broadcastProject(projectId, 'cards_changed');
    const cardCreatedPayload = {
      project_id: projectId,
      card_id: card.id,
      task_code: card.task_code,
      title: body.title,
    };
    void deliverWebhooks('card.created', cardCreatedPayload);
    res
      .status(201)
      .json({ id: card.id, position: card.position, column_id: columnId, task_code: card.task_code });
  } catch (error) {
    next(error);
  }
});

router.patch('/cards/:id', requirePermission('kanban.editar_cards', 'kanban.mover_cards'), async (req, res, next) => {
  try {
    const params = idParams.parse(req.params);
    const limits = await getCardCharLimits();
    const { cardPatch } = buildCardSchemas(limits.title_max_chars, limits.description_max_chars);
    const body = cardPatch.parse(req.body);
    const projectId = req.params.projectId!;
    const { projectPool } = await getProjectPool(projectId);

    const existing = await projectPool.query<{
      id: string;
      column_id: string;
      position: number;
      completed_at: Date | null;
      title: string;
      description: string;
      priority: string;
      origin: string;
      due_date: Date | null;
      department_id: string | null;
      responsible_id: string | null;
      learning_index_active: boolean;
      learning_index_score: number | null;
      learning_index_note: string;
    }>(
      `SELECT id, column_id, position, completed_at, title, description, priority,
              origin, due_date, department_id, responsible_id,
              learning_index_active, learning_index_score, learning_index_note
       FROM cards WHERE id = $1`,
      [params.id],
    );
    if (existing.rowCount === 0) {
      throw new ApiError(404, 'Card não encontrado');
    }
    const current = existing.rows[0]!;
    if (body.description !== undefined) {
      assertSafeDescription(body.description);
    }

    if (body.department_id) {
      await assertDepartment(projectPool, body.department_id);
    }
    const patchResponsibles = body.responsible_ids ?? (body.responsible_id !== undefined ? [body.responsible_id].filter((id): id is string => !!id) : null);
    if (patchResponsibles && patchResponsibles.length > 0) {
      await assertResponsibles(projectId, patchResponsibles);
    }

    const isMove = body.column_id !== undefined && body.column_id !== current.column_id;
    let targetColumnId = current.column_id;
    let targetIsDone = false;
    let healDoneFlag = false;

    if (body.column_id !== undefined) {
      const column = await assertColumn(projectPool, body.column_id);
      targetColumnId = column.id;
      healDoneFlag = !column.is_done && isDoneColumnName(column.name);
      targetIsDone = column.is_done || healDoneFlag;
    }

    const previousResponsibleRows = await projectPool.query<{ user_id: string }>(
      'SELECT user_id FROM card_responsibles WHERE card_id = $1',
      [params.id],
    );

    const client = await projectPool.connect();
    try {
      await client.query('BEGIN');
      if (healDoneFlag) {
        await client.query('UPDATE kanban_columns SET is_done = true WHERE id = $1', [
          targetColumnId,
        ]);
        await client.query(
          'UPDATE cards SET completed_at = COALESCE(completed_at, now()) WHERE column_id = $1',
          [targetColumnId],
        );
      }
      await client.query(
        `UPDATE cards
         SET title = COALESCE($1, title),
             description = COALESCE($2, description),
             priority = COALESCE($3, priority),
             department_id = CASE WHEN $4::boolean THEN $5 ELSE department_id END,
             responsible_id = CASE WHEN $6::boolean THEN $7 ELSE responsible_id END,
             due_date = CASE WHEN $8::boolean THEN $9 ELSE due_date END,
             origin = COALESCE($10, origin),
             column_id = $11,
             completed_at = CASE
               WHEN $12::boolean THEN (CASE WHEN $13::boolean THEN COALESCE($14::timestamptz, now()) ELSE NULL END)
               ELSE completed_at
             END,
             learning_index_active = CASE WHEN $16::boolean THEN $17 ELSE learning_index_active END,
             learning_index_score = CASE WHEN $18::boolean THEN $19 ELSE learning_index_score END,
             learning_index_note = COALESCE($20, learning_index_note),
             updated_at = now()
         WHERE id = $15`,
        [
          body.title ?? null,
          body.description ?? null,
          body.priority ?? null,
          body.department_id !== undefined,
          body.department_id ?? null,
          body.responsible_id !== undefined,
          body.responsible_id ?? null,
          body.due_date !== undefined,
          body.due_date ?? null,
          body.origin ?? null,
          targetColumnId,
          isMove,
          targetIsDone,
          current.completed_at,
          params.id,
          body.learning_index_active !== undefined,
          body.learning_index_active ?? false,
          body.learning_index_score !== undefined,
          body.learning_index_score ?? null,
          body.learning_index_note ?? null,
        ],
      );

      if (isMove || body.position !== undefined) {
        await renumberCards(client, targetColumnId, params.id, body.position ?? current.position);
        if (isMove && current.column_id !== targetColumnId) {
          await renumberCards(client, current.column_id);
        }
      }
      if (body.responsible_ids !== undefined) {
        await replaceCardResponsibles(client, params.id, body.responsible_ids);
      }
      await client.query('COMMIT');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('[kanban] rollback do movimento de card falhou', rollbackError);
      }
      throw error;
    } finally {
      client.release();
    }

    const updated = await projectPool.query('SELECT * FROM cards WHERE id = $1', [params.id]);
    let columnNames: Map<string, string> | undefined;
    if (body.column_id !== undefined) {
      const ids = [String(current.column_id), String(targetColumnId)];
      const columns = await projectPool.query<{ id: string; name: string }>(
        'SELECT id, name FROM kanban_columns WHERE id = ANY($1::uuid[])',
        [ids],
      );
      columnNames = new Map(columns.rows.map((row) => [row.id, row.name]));
    }
    const changes = describeCardChanges(current as unknown as Record<string, unknown>, body, columnNames);
    await audit(req, 'card_updated', 'card', params.id, {
      project_id: projectId,
      fields: Object.keys(body),
      task_code: updated.rows[0].task_code,
      ...(Object.keys(changes).length > 0 ? { changes } : {}),
    });
    broadcastProject(projectId, 'cards_changed');
    if (healDoneFlag) {
      broadcastProject(projectId, 'columns_changed');
    }

    const cardLink = kanbanCardLink(projectId, params.id);
    const taskCode = String(updated.rows[0]!.task_code);
    const cardTitle = String(updated.rows[0]!.title);

    if (isMove) {
      const moveTargets = await getCardTargets(projectPool, params.id);
      const destination = columnNames?.get(targetColumnId) ?? 'outra coluna';
      await notifyMany(
        moveTargets.userIds.map((userId) => ({
          userId,
          actorId: req.user!.id,
          type: 'card_moved',
          title: `Card movido: ${taskCode}`,
          body: `"${cardTitle}" foi movido para ${destination}.`,
          projectId,
          cardId: params.id,
          screen: 'kanban',
          link: cardLink,
        })),
      );
    }

    if (patchResponsibles) {
      const previousResponsibles = new Set<string>(
        current.responsible_id ? [current.responsible_id] : [],
      );
      for (const row of previousResponsibleRows.rows) previousResponsibles.add(row.user_id);
      const addedResponsibles = patchResponsibles.filter((id) => !previousResponsibles.has(id));
      await notifyMany(
        addedResponsibles.map((userId) => ({
          userId,
          actorId: req.user!.id,
          type: 'card_assigned',
          title: `Você foi designado: ${taskCode}`,
          body: cardTitle,
          projectId,
          cardId: params.id,
          screen: 'kanban',
          link: cardLink,
        })),
      );
    }

    if (body.description !== undefined) {
      const before = new Set(extractMentionUserIds(current.description));
      const newMentions = extractMentionUserIds(body.description).filter(
        (id) => !before.has(id),
      );
      if (newMentions.length > 0) {
        const preview = stripHtml(body.description).slice(0, 160);
        await notifyMany(
          newMentions.map((userId) => ({
            userId,
            actorId: req.user!.id,
            type: 'card_mention',
            title: `Você foi mencionado: ${taskCode}`,
            body: preview,
            projectId,
            cardId: params.id,
            screen: 'kanban',
            link: cardLink,
          })),
        );
      }
    }

    if (
      body.learning_index_score !== undefined &&
      body.learning_index_score !== null &&
      current.learning_index_score === null
    ) {
      const indexTargets = await getCardTargets(projectPool, params.id);
      await notifyMany(
        indexTargets.userIds.map((userId) => ({
          userId,
          actorId: req.user!.id,
          type: 'card_learning_index',
          title: `Índice de aprendizado: ${taskCode}`,
          body: `"${cardTitle}" recebeu nota ${body.learning_index_score}/10.`,
          projectId,
          cardId: params.id,
          screen: 'kanban',
          link: cardLink,
        })),
      );
    }

    const cardEvent = isMove ? 'card.moved' : 'card.updated';
    const cardPayload = {
      project_id: projectId,
      card_id: params.id,
      task_code: updated.rows[0].task_code,
      title: updated.rows[0].title,
    };
    void deliverWebhooks(cardEvent, cardPayload);
    if (isMove && targetIsDone && current.completed_at === null) {
      void deliverWebhooks('card.completed', cardPayload);
    }
    if (body.learning_index_score !== undefined && body.learning_index_score !== null) {
      void deliverWebhooks('evaluation.created', {
        ...cardPayload,
        score: body.learning_index_score,
      });
    }
    res.json(updated.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.post('/cards/:id/assumir', requirePermission('kanban.editar_cards'), async (req, res, next) => {
  try {
    const params = idParams.parse(req.params);
    const projectId = req.params.projectId!;
    const userId = req.user!.id;
    const { projectPool } = await getProjectPool(projectId);

    const card = await projectPool.query<{ id: string; responsible_id: string | null }>(
      'SELECT id, responsible_id FROM cards WHERE id = $1',
      [params.id],
    );
    if (card.rowCount === 0) {
      throw new ApiError(404, 'Card não encontrado');
    }

    const current = await projectPool.query<{ user_id: string }>(
      'SELECT user_id FROM card_responsibles WHERE card_id = $1 ORDER BY created_at',
      [params.id],
    );
    const isAssigned = current.rows.some((row) => row.user_id === userId);

    let updatedIds: string[];
    if (isAssigned) {
      updatedIds = current.rows.map((row) => row.user_id).filter((id) => id !== userId);
    } else {
      updatedIds = [...current.rows.map((row) => row.user_id), userId];
    }

    const client = await projectPool.connect();
    try {
      await client.query('BEGIN');
      await replaceCardResponsibles(client, params.id, updatedIds);
      await client.query('COMMIT');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('[kanban] rollback do assumir card falhou', rollbackError);
      }
      throw error;
    } finally {
      client.release();
    }

    await audit(req, isAssigned ? 'card_unassigned' : 'card_assigned', 'card', params.id, {
      project_id: projectId,
      user_id: userId,
    });
    broadcastProject(projectId, 'cards_changed');

    const updated = await projectPool.query(
      `SELECT c.id, c.task_code, c.title, c.responsible_id
       FROM cards c WHERE c.id = $1`,
      [params.id],
    );
    if (!isAssigned) {
      const assumeTargets = await getCardTargets(projectPool, params.id);
      await notifyMany(
        assumeTargets.userIds
          .filter((id) => id !== userId)
          .map((targetId) => ({
            userId: targetId,
            actorId: userId,
            type: 'card_assigned',
            title: `Card assumido: ${updated.rows[0]!.task_code}`,
            body: String(updated.rows[0]!.title),
            projectId,
            cardId: params.id,
            screen: 'kanban',
            link: kanbanCardLink(projectId, params.id),
          })),
      );
    }
    const responsibles = await projectPool.query<{ user_id: string }>(
      'SELECT user_id FROM card_responsibles WHERE card_id = $1 ORDER BY created_at',
      [params.id],
    );
    const members = await query<{ id: string; name: string }>(
      `SELECT u.id, u.name FROM users u
       JOIN project_members pm ON pm.user_id = u.id
       WHERE pm.project_id = $1 AND u.id = ANY($2::uuid[])`,
      [projectId, responsibles.rows.map((r) => r.user_id)],
    );
    const nameMap = new Map(members.map((m) => [m.id, m.name]));

    res.json({
      ...updated.rows[0],
      assigned: !isAssigned,
      responsibles: responsibles.rows.map((r) => ({
        id: r.user_id,
        name: nameMap.get(r.user_id) ?? r.user_id,
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/cards/:id', requirePermission('kanban.excluir_cards'), async (req, res, next) => {
  try {
    const params = idParams.parse(req.params);
    const projectPool = await gateStructural(req.params.projectId, req.header(SECURITY_PASSWORD_HEADER));

    const deleted = await projectPool.query<{ id: string; task_code: string }>(
      'DELETE FROM cards WHERE id = $1 RETURNING id, task_code',
      [params.id],
    );
    if (deleted.rowCount === 0) {
      throw new ApiError(404, 'Card não encontrado');
    }
    await audit(req, 'card_deleted', 'card', params.id, {
      project_id: req.params.projectId,
      task_code: deleted.rows[0]!.task_code,
    });
    broadcastProject(req.params.projectId!, 'cards_changed');
    const cardDeletedPayload = {
      project_id: req.params.projectId!,
      card_id: params.id,
      task_code: deleted.rows[0]!.task_code,
    };
    void deliverWebhooks('card.deleted', cardDeletedPayload);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.get('/cards/:id/subtasks', requirePermission('kanban.visualizar'), async (req, res, next) => {
  try {
    const params = idParams.parse(req.params);
    const { projectPool } = await getProjectPool(req.params.projectId!);
    const result = await projectPool.query(
      `SELECT s.id, s.subtask_id, c.title, c.task_code, c.completed_at,
              k.name AS column_name, k.color AS column_color
       FROM card_subtasks s
       JOIN cards c ON c.id = s.subtask_id
       LEFT JOIN kanban_columns k ON k.id = c.column_id
       WHERE s.card_id = $1
       ORDER BY s.created_at`,
      [params.id],
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.get('/cards/:id/parents', requirePermission('kanban.visualizar'), async (req, res, next) => {
  try {
    const params = idParams.parse(req.params);
    const { projectPool } = await getProjectPool(req.params.projectId!);
    const result = await projectPool.query(
      `SELECT s.id, s.card_id, c.title, c.task_code, c.completed_at,
              k.name AS column_name, k.color AS column_color
       FROM card_subtasks s
       JOIN cards c ON c.id = s.card_id
       LEFT JOIN kanban_columns k ON k.id = c.column_id
       WHERE s.subtask_id = $1
       ORDER BY s.created_at`,
      [params.id],
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post('/cards/:id/subtasks', requirePermission('kanban.editar_cards'), async (req, res, next) => {
  try {
    const params = idParams.parse(req.params);
    const body = subtaskCreate.parse(req.body);
    if (params.id === body.subtask_id) {
      throw new ApiError(400, 'Um card não pode ser sub-tarefa de si mesmo');
    }
    const { projectPool } = await getProjectPool(req.params.projectId!);
    const card = await projectPool.query('SELECT id FROM cards WHERE id = $1', [params.id]);
    if (card.rowCount === 0) {
      throw new ApiError(404, 'Card não encontrado');
    }
    const subtask = await projectPool.query('SELECT id FROM cards WHERE id = $1', [body.subtask_id]);
    if (subtask.rowCount === 0) {
      throw new ApiError(400, 'Card sub-tarefa inexistente');
    }
    const duplicate = await projectPool.query(
      'SELECT id FROM card_subtasks WHERE card_id = $1 AND subtask_id = $2',
      [params.id, body.subtask_id],
    );
    if (duplicate.rowCount !== 0) {
      throw new ApiError(409, 'Sub-tarefa já vinculada');
    }
    const cycle = await projectPool.query(
      `WITH RECURSIVE descendants AS (
         SELECT subtask_id FROM card_subtasks WHERE card_id = $1
         UNION
         SELECT s.subtask_id FROM card_subtasks s JOIN descendants d ON s.card_id = d.subtask_id
       )
       SELECT 1 FROM descendants WHERE subtask_id = $2`,
      [body.subtask_id, params.id],
    );
    if (cycle.rowCount !== 0) {
      throw new ApiError(400, 'Vincular esta sub-tarefa criaria um ciclo');
    }
    const inserted = await projectPool.query(
      `INSERT INTO card_subtasks (card_id, subtask_id) VALUES ($1, $2)
       ON CONFLICT (card_id, subtask_id) DO NOTHING
       RETURNING id, subtask_id, created_at`,
      [params.id, body.subtask_id],
    );
    if (inserted.rowCount === 0) {
      throw new ApiError(409, 'Sub-tarefa já vinculada');
    }
    await audit(req, 'card_subtask_added', 'card', params.id, {
      project_id: req.params.projectId,
      subtask_id: body.subtask_id,
    });
    broadcastProject(req.params.projectId!, 'cards_changed');
    res.status(201).json(inserted.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.delete(
  '/cards/:id/subtasks/:subtaskId',
  requirePermission('kanban.editar_cards'),
  async (req, res, next) => {
    try {
      const params = z
        .object({ id: z.string().uuid(), subtaskId: z.string().uuid() })
        .parse(req.params);
      const { projectPool } = await getProjectPool(req.params.projectId!);
      const deleted = await projectPool.query(
        'DELETE FROM card_subtasks WHERE card_id = $1 AND subtask_id = $2 RETURNING id',
        [params.id, params.subtaskId],
      );
      if (deleted.rowCount === 0) {
        throw new ApiError(404, 'Sub-tarefa não encontrada');
      }
      await audit(req, 'card_subtask_removed', 'card', params.id, {
        project_id: req.params.projectId,
        subtask_id: params.subtaskId,
      });
      broadcastProject(req.params.projectId!, 'cards_changed');
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

router.get('/cards/:id/activity', requirePermission('kanban.visualizar'), async (req, res, next) => {
  try {
    const params = idParams.parse(req.params);
    const projectId = req.params.projectId!;
    const { projectPool } = await getProjectPool(projectId);

    const card = await projectPool.query('SELECT id FROM cards WHERE id = $1', [params.id]);
    if (card.rowCount === 0) {
      throw new ApiError(404, 'Card não encontrado');
    }

    const auditRows = await query<{
      action: string;
      created_at: Date;
      meta: Record<string, unknown>;
      user_name: string | null;
    }>(
      `SELECT a.action, a.created_at, a.meta, u.name AS user_name
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.entity = 'card' AND a.entity_id = $1 AND a.meta->>'project_id' = $2
       ORDER BY a.id DESC
       LIMIT 100`,
      [params.id, projectId],
    );

    const commentRows = await projectPool.query<{
      id: string;
      body: string;
      user_id: string | null;
      created_at: Date;
    }>(
      'SELECT id, body, user_id, created_at FROM card_comments WHERE card_id = $1 ORDER BY created_at DESC LIMIT 100',
      [params.id],
    );

    const commentUserIds = [
      ...new Set(commentRows.rows.map((row) => row.user_id).filter((id): id is string => !!id)),
    ];
    const users = commentUserIds.length
      ? await query<{ id: string; name: string }>(
          'SELECT id, name FROM users WHERE id = ANY($1::uuid[])',
          [commentUserIds],
        )
      : [];
    const userNameMap = new Map(users.map((user) => [user.id, user.name]));

    const activity = [
      ...auditRows.map((row) => ({
        kind: 'event' as const,
        action: row.action,
        user_name: row.user_name,
        meta: row.meta,
        created_at: row.created_at,
      })),
      ...commentRows.rows.map((row) => ({
        kind: 'comment' as const,
        id: row.id,
        body: row.body,
        user_name: row.user_id ? (userNameMap.get(row.user_id) ?? null) : null,
        created_at: row.created_at,
      })),
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    res.json(activity);
  } catch (error) {
    next(error);
  }
});

router.post('/cards/:id/comments', requirePermission('kanban.editar_cards'), async (req, res, next) => {
  try {
    const params = idParams.parse(req.params);
    const body = commentCreate.parse(req.body);
    const { projectPool } = await getProjectPool(req.params.projectId!);
    const card = await projectPool.query<{ id: string; title: string; task_code: string }>(
      'SELECT id, title, task_code FROM cards WHERE id = $1',
      [params.id],
    );
    if (card.rowCount === 0) {
      throw new ApiError(404, 'Card não encontrado');
    }
    const inserted = await projectPool.query(
      'INSERT INTO card_comments (card_id, user_id, body) VALUES ($1, $2, $3) RETURNING id, body, created_at',
      [params.id, req.user!.id, body.body],
    );
    await audit(req, 'card_comment_added', 'card', params.id, {
      project_id: req.params.projectId,
      comment_id: inserted.rows[0]!.id,
    });
    const mentioned = extractMentionUserIds(body.body);
    const memberNames = await pool.query<{ id: string; name: string }>(
      `SELECT u.id, u.name
       FROM users u
       JOIN project_members pm ON pm.user_id = u.id
       WHERE pm.project_id = $1 AND u.is_active = true`,
      [req.params.projectId],
    );
    const mentionedByText = extractMentionUserIdsByText(body.body, memberNames.rows);
    const targets = await getCardTargets(projectPool, params.id, [
      ...new Set([...mentioned, ...mentionedByText]),
    ]);
    const commentPreview = stripHtml(body.body).slice(0, 160);
    await notifyMany(
      targets.userIds.map((userId) => ({
        userId,
        actorId: req.user!.id,
        type: 'card_comment',
        title: `Novo comentário: ${card.rows[0]!.task_code}`,
        body: commentPreview,
        projectId: req.params.projectId!,
        cardId: params.id,
        screen: 'kanban',
        link: kanbanCardLink(req.params.projectId!, params.id),
      })),
    );
    void deliverWebhooks('comment.created', {
      project_id: req.params.projectId!,
      card_id: params.id,
      task_code: card.rows[0]!.task_code,
      comment_id: inserted.rows[0]!.id,
      preview: commentPreview,
    });
    res.status(201).json(inserted.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.get(
  '/cards/:id/attachments',
  requirePermission('kanban.visualizar'),
  async (req, res, next) => {
    try {
      const params = idParams.parse(req.params);
      const { projectPool } = await getProjectPool(req.params.projectId!);
      const card = await projectPool.query('SELECT id FROM cards WHERE id = $1', [params.id]);
      if (card.rowCount === 0) {
        throw new ApiError(404, 'Card não encontrado');
      }
      const result = await projectPool.query(
        `SELECT id, filename, url, size_bytes, position, created_at
         FROM card_attachments
         WHERE card_id = $1
         ORDER BY position, created_at`,
        [params.id],
      );
      res.json(result.rows);
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/cards/:id/attachments',
  requirePermission('kanban.editar_cards'),
  async (req, res, next) => {
    try {
      const params = idParams.parse(req.params);
      const body = attachmentOrder.parse(req.body);
      const { projectPool } = await getProjectPool(req.params.projectId!);
      const card = await projectPool.query('SELECT id FROM cards WHERE id = $1', [params.id]);
      if (card.rowCount === 0) {
        throw new ApiError(404, 'Card não encontrado');
      }
      const uniqueOrder = [...new Set(body.order)];
      const existing = await projectPool.query<{ id: string }>(
        'SELECT id FROM card_attachments WHERE card_id = $1',
        [params.id],
      );
      const existingIds = new Set(existing.rows.map((row) => row.id));
      if (
        uniqueOrder.length !== existingIds.size ||
        uniqueOrder.some((id) => !existingIds.has(id))
      ) {
        throw new ApiError(400, 'Ordenação não corresponde aos anexos do card');
      }
      await projectPool.query(
        `UPDATE card_attachments SET position = u.idx - 1
         FROM unnest($1::uuid[]) WITH ORDINALITY AS u(id, idx)
         WHERE card_attachments.id = u.id AND card_attachments.card_id = $2`,
        [uniqueOrder, params.id],
      );
      await audit(req, 'attachment_reordered', 'card', params.id, {
        project_id: req.params.projectId,
      });
      broadcastProject(req.params.projectId!, 'cards_changed');
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/cards/:id/attachments/:attachmentId',
  requirePermission('kanban.editar_cards'),
  async (req, res, next) => {
    try {
      const params = z
        .object({ id: z.string().uuid(), attachmentId: z.string().uuid() })
        .parse(req.params);
      const body = attachmentRename.parse(req.body);
      const { projectPool } = await getProjectPool(req.params.projectId!);
      const renamed = await projectPool.query<{ id: string; filename: string }>(
        `UPDATE card_attachments SET filename = $1
         WHERE id = $2 AND card_id = $3
         RETURNING id, filename`,
        [body.filename, params.attachmentId, params.id],
      );
      if (renamed.rowCount === 0) {
        throw new ApiError(404, 'Anexo não encontrado');
      }
      await audit(req, 'attachment_renamed', 'card', params.id, {
        project_id: req.params.projectId,
        attachment_id: params.attachmentId,
        filename: body.filename,
      });
      broadcastProject(req.params.projectId!, 'cards_changed');
      res.json(renamed.rows[0]);
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  '/cards/:id/attachments/:attachmentId',
  requirePermission('kanban.editar_cards'),
  async (req, res, next) => {
    try {
      const params = z
        .object({ id: z.string().uuid(), attachmentId: z.string().uuid() })
        .parse(req.params);
      const { projectPool } = await getProjectPool(req.params.projectId!);
      const deleted = await projectPool.query<{ url: string }>(
        'DELETE FROM card_attachments WHERE id = $1 AND card_id = $2 RETURNING url',
        [params.attachmentId, params.id],
      );
      if (deleted.rowCount === 0) {
        throw new ApiError(404, 'Anexo não encontrado');
      }
      const fileUrl = deleted.rows[0]!.url;
      if (fileUrl.startsWith('/uploads/')) {
        try {
          await unlink(path.join(UPLOADS_DIR, path.basename(fileUrl)));
        } catch {
          // arquivo já removido ou inexistente não interrompe a exclusão
        }
      }
      await audit(req, 'attachment_removed', 'card', params.id, {
        project_id: req.params.projectId,
        attachment_id: params.attachmentId,
      });
      broadcastProject(req.params.projectId!, 'cards_changed');
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/uploads',
  requirePermission('kanban.criar_cards', 'kanban.editar_cards'),
  async (req, res, next) => {
    try {
      const body = uploadBase64.parse(req.body);
      const buffer = Buffer.from(body.data_base64, 'base64');
      if (buffer.length === 0 || buffer.length > 2 * 1024 * 1024) {
        throw new ApiError(400, 'Imagem deve ter entre 1 byte e 2 MB');
      }
      const kind = MAGIC_BYTES.find((entry) => entry.test(buffer));
      if (!kind) {
        throw new ApiError(400, 'Formato não suportado. Use PNG, JPG, GIF ou WEBP');
      }
      const filename = `${randomUUID()}.${kind.ext}`;
      await mkdir(UPLOADS_DIR, { recursive: true });
      await writeFile(path.join(UPLOADS_DIR, filename), buffer);

      let attachmentId: string | null = null;
      if (body.card_id) {
        const { projectPool } = await getProjectPool(req.params.projectId!);
        const card = await projectPool.query('SELECT id FROM cards WHERE id = $1', [body.card_id]);
        if (card.rowCount === 0) {
          throw new ApiError(404, 'Card não encontrado');
        }
        const inserted = await projectPool.query<{ id: string; position: number }>(
          `WITH next_pos AS (
             SELECT COALESCE(MAX(position), -1) + 1 AS position FROM card_attachments WHERE card_id = $1
           )
           INSERT INTO card_attachments (card_id, filename, url, size_bytes, uploaded_by, position)
           SELECT $1, $2, $3, $4, $5, position FROM next_pos
           RETURNING id, position`,
          [body.card_id, body.filename, `/uploads/${filename}`, buffer.length, req.user!.id],
        );
        attachmentId = inserted.rows[0]!.id;
        await audit(req, 'attachment_added', 'card', body.card_id, {
          project_id: req.params.projectId,
          attachment_id: attachmentId,
          filename: body.filename,
        });
        void deliverWebhooks('attachment.created', {
          project_id: req.params.projectId!,
          card_id: body.card_id,
          attachment_id: attachmentId,
          filename: body.filename,
        });
        broadcastProject(req.params.projectId!, 'cards_changed');
      }

      res.status(201).json({ url: `/uploads/${filename}`, attachment_id: attachmentId });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
