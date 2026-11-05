import { Router } from 'express';
import { z } from 'zod';
import { pool, query, queryOne } from '../db/pool.js';
import { ApiError } from '../middleware/errors.js';
import { requireAuth, requirePermission, requireScreen } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';
import { requireSecurityPassword, SECURITY_PASSWORD_HEADER } from '../services/securityPassword.js';

const router = Router();

router.use(requireAuth, requireScreen('settings'));

const listSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const approveSchema = z.object({
  profile_id: z.string().uuid('Nível de acesso inválido'),
  role_id: z.string().uuid('Cargo inválido').optional(),
});

const rejectSchema = z.object({
  reason: z.string().max(500).optional(),
});

async function assertProfileExists(profileId: string): Promise<void> {
  const profile = await queryOne('SELECT id FROM profiles WHERE id = $1', [profileId]);
  if (!profile) throw new ApiError(400, 'Nível de acesso inexistente');
}

async function assertRoleExists(roleId: string): Promise<void> {
  const role = await queryOne('SELECT id FROM roles WHERE id = $1', [roleId]);
  if (!role) throw new ApiError(400, 'Cargo inexistente');
}

router.get(
  '/metrics',
  requirePermission('settings.solicitacoes.visualizar'),
  async (_req, res, next) => {
    try {
      const [pending, approved, rejected] = await Promise.all([
        queryOne<{ total: number }>('SELECT count(*)::int AS total FROM access_requests WHERE status = $1', ['pending']),
        queryOne<{ total: number }>('SELECT count(*)::int AS total FROM access_requests WHERE status = $1', ['approved']),
        queryOne<{ total: number }>('SELECT count(*)::int AS total FROM access_requests WHERE status = $1', ['rejected']),
      ]);
      res.json({
        pending: pending?.total ?? 0,
        approved: approved?.total ?? 0,
        rejected: rejected?.total ?? 0,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/',
  requirePermission('settings.solicitacoes.visualizar'),
  async (req, res, next) => {
    try {
      const params = listSchema.parse(req.query);
      const offset = (params.page - 1) * params.limit;
      const conditions: string[] = [];
      const values: unknown[] = [];

      if (params.status) {
        conditions.push(`status = $${values.length + 1}`);
        values.push(params.status);
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const countRows = await query<{ total: number }>(
        `SELECT count(*)::int AS total FROM access_requests ${where}`,
        values,
      );
      const total = countRows[0]?.total ?? 0;

      const rows = await query(
        `SELECT id, user_id, name, email, company, message, status,
                reviewed_by, reviewed_at, created_at
         FROM access_requests ${where}
         ORDER BY created_at DESC
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, params.limit, offset],
      );

      res.json({ items: rows, total });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/:id/approve',
  requirePermission('settings.solicitacoes.aprovar'),
  async (req, res, next) => {
    try {
      await requireSecurityPassword(req.headers[SECURITY_PASSWORD_HEADER] as string | undefined, 'users');
      const idParam = z.object({ id: z.string().uuid() }).parse(req.params);
      const body = approveSchema.parse(req.body);

      await assertProfileExists(body.profile_id);
      if (body.role_id) await assertRoleExists(body.role_id);

      const request = await queryOne(
        'SELECT id, user_id, status FROM access_requests WHERE id = $1',
        [idParam.id],
      );
      if (!request) throw new ApiError(404, 'Solicitação inexistente');
      if (request.status !== 'pending') {
        throw new ApiError(400, 'Esta solicitação já foi avaliada');
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        await client.query(
          `UPDATE users
           SET approval_status = 'active', is_active = true, profile_id = $2, role_id = $3, updated_at = now()
           WHERE id = $1`,
          [request.user_id, body.profile_id, body.role_id ?? null],
        );

        await client.query(
          `UPDATE access_requests
           SET status = 'approved', reviewed_by = $2, reviewed_at = now()
           WHERE id = $1`,
          [idParam.id, req.user!.id],
        );

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }

      await audit(req, 'access_request_approved', 'access_request', idParam.id, {
        profile_id: body.profile_id,
        role_id: body.role_id ?? null,
      });

      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/:id/reject',
  requirePermission('settings.solicitacoes.aprovar'),
  async (req, res, next) => {
    try {
      await requireSecurityPassword(req.headers[SECURITY_PASSWORD_HEADER] as string | undefined, 'users');
      const idParam = z.object({ id: z.string().uuid() }).parse(req.params);
      const body = rejectSchema.parse(req.body);

      const request = await queryOne(
        'SELECT id, user_id, status FROM access_requests WHERE id = $1',
        [idParam.id],
      );
      if (!request) throw new ApiError(404, 'Solicitação inexistente');
      if (request.status !== 'pending') {
        throw new ApiError(400, 'Esta solicitação já foi avaliada');
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        await client.query(
          `UPDATE users
           SET approval_status = 'rejected', is_active = false, updated_at = now()
           WHERE id = $1`,
          [request.user_id],
        );

        await client.query(
          `UPDATE access_requests
           SET status = 'rejected', reviewed_by = $2, reviewed_at = now(), message = COALESCE($3, message)
           WHERE id = $1`,
          [idParam.id, req.user!.id, body.reason?.trim() || null],
        );

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }

      await audit(req, 'access_request_rejected', 'access_request', idParam.id, {
        reason: body.reason ?? null,
      });

      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  '/:id',
  requirePermission('settings.solicitacoes.excluir'),
  async (req, res, next) => {
    try {
      await requireSecurityPassword(req.headers[SECURITY_PASSWORD_HEADER] as string | undefined, 'users');
      const idParam = z.object({ id: z.string().uuid() }).parse(req.params);

      const request = await queryOne(
        'SELECT id, user_id, status FROM access_requests WHERE id = $1',
        [idParam.id],
      );
      if (!request) throw new ApiError(404, 'Solicitação inexistente');
      if (request.status !== 'rejected') {
        throw new ApiError(400, 'Só é possível excluir solicitações recusadas');
      }

      await pool.query('DELETE FROM users WHERE id = $1', [request.user_id]);

      await audit(req, 'access_request_deleted', 'access_request', idParam.id, {
        user_id: request.user_id,
      });

      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

export default router;
