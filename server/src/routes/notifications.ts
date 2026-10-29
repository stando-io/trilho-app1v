import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import type { NotificationRow } from '../services/notifications.js';

const router = Router();

router.use(requireAuth);

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(30),
});

function serialize(row: NotificationRow) {
  return {
    id: row.id,
    actor_id: row.actor_id,
    type: row.type,
    title: row.title,
    body: row.body,
    project_id: row.project_id,
    card_id: row.card_id,
    screen: row.screen,
    link: row.link,
    read_at: row.read_at,
    created_at: row.created_at,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const query = listQuery.parse(req.query);
    const result = await pool.query<NotificationRow>(
      `SELECT id, actor_id, type, title, body, project_id, card_id, screen, link, read_at, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [req.user!.id, query.limit],
    );
    const unread = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL',
      [req.user!.id],
    );
    res.json({
      items: result.rows.map(serialize),
      unread: Number(unread.rows[0]!.count),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/unread-count', async (req, res, next) => {
  try {
    const unread = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL',
      [req.user!.id],
    );
    res.json({ count: Number(unread.rows[0]!.count) });
  } catch (error) {
    next(error);
  }
});

const idParams = z.object({ id: z.string().uuid() });

router.post('/:id/read', async (req, res, next) => {
  try {
    const params = idParams.parse(req.params);
    const result = await pool.query<{ id: string }>(
      `UPDATE notifications SET read_at = COALESCE(read_at, now())
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [params.id, req.user!.id],
    );
    if (result.rowCount === 0) {
      throw new ApiError(404, 'Notificação não encontrada');
    }
    res.json({ id: params.id, read: true });
  } catch (error) {
    next(error);
  }
});

router.post('/read-all', async (req, res, next) => {
  try {
    const result = await pool.query(
      'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL',
      [req.user!.id],
    );
    res.json({ updated: result.rowCount ?? 0 });
  } catch (error) {
    next(error);
  }
});

export default router;
