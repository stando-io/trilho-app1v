import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db/pool.js';
import { requirePermission } from '../middleware/auth.js';

const router = Router({ mergeParams: true });

function optionalText(max: number) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().min(1).max(max).optional(),
  );
}

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  action: optionalText(80),
  search: optionalText(120),
});

interface AuditItem {
  id: string;
  action: string;
  entity: string;
  created_at: string;
  user_name: string | null;
  user_email: string | null;
  task_code: string | null;
  detail: string;
}

router.get('/audit', requirePermission('settings.auditoria'), async (req, res, next) => {
  try {
    const q = listQuery.parse(req.query);
    const params: unknown[] = [req.params.projectId];
    let where = `a.meta->>'project_id' = $1`;
    if (q.action) {
      params.push(q.action);
      where += ` AND a.action = $${params.length}`;
    }
    if (q.search) {
      params.push(`%${q.search}%`);
      where += ` AND (u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`;
    }

    const total = await queryOne<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE ${where}`,
      params,
    );

    const offset = (q.page - 1) * q.limit;
    const items = await query<AuditItem>(
      `SELECT a.id, a.action, a.entity, a.created_at,
              u.name AS user_name, u.email AS user_email,
              a.meta->>'task_code' AS task_code,
              COALESCE(a.meta->>'details', a.meta->>'title', a.meta->>'name', a.meta->>'email',
                       a.meta->>'color', a.entity_id, '') AS detail
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE ${where}
       ORDER BY a.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, q.limit, offset],
    );

    res.json({ items, total: total?.total ?? 0, page: q.page, limit: q.limit });
  } catch (error) {
    next(error);
  }
});

export default router;
