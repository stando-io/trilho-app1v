import { Router } from 'express';
import { z } from 'zod';
import { pool, query, queryOne } from '../db/pool.js';
import { ApiError } from '../middleware/errors.js';
import { requireAuth, requirePermission, requireScreen } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';
import { requireSecurityPassword, SECURITY_PASSWORD_HEADER } from '../services/securityPassword.js';

const router = Router();

router.use(requireAuth, requireScreen('settings'));

const createSchema = z.object({
  name: z.string().min(2, 'Nome muito curto'),
  description: z.string().default(''),
  profile_id: z.string().uuid('Nível de acesso inválido'),
});

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  description: z.string().optional(),
  profile_id: z.string().uuid('Nível de acesso inválido').optional(),
});

async function assertProfileExists(profileId: string): Promise<void> {
  const profile = await queryOne('SELECT id FROM profiles WHERE id = $1', [profileId]);
  if (!profile) throw new ApiError(400, 'Nível de acesso inexistente');
}

router.get(
  '/',
  requirePermission('settings.cargos.novo', 'settings.cargos.editar', 'settings.cargos.excluir'),
  async (_req, res, next) => {
    try {
      const rows = await query(
        `SELECT r.id, r.name, r.description, r.profile_id, p.name AS profile_name,
              r.created_at, r.updated_at,
              (SELECT count(*)::int FROM users u WHERE u.role_id = r.id) AS users_count
       FROM roles r
       JOIN profiles p ON p.id = r.profile_id
       ORDER BY r.name`,
      );
      res.json(rows);
    } catch (error) {
      next(error);
    }
  },
);

router.post('/', requirePermission('settings.cargos.novo'), async (req, res, next) => {
  try {
    await requireSecurityPassword(req.headers[SECURITY_PASSWORD_HEADER] as string | undefined, 'users');
    const body = createSchema.parse(req.body);
    await assertProfileExists(body.profile_id);
    const row = await queryOne(
      `INSERT INTO roles (name, description, profile_id)
       VALUES ($1, $2, $3)
       RETURNING id, name, description, profile_id`,
      [body.name.trim(), body.description, body.profile_id],
    );
    await audit(req, 'role_created', 'role', row?.id ?? null, { name: body.name });
    res.status(201).json(row);
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as { code?: string }).code === '23505') {
      next(new ApiError(409, 'Ja existe um cargo com este nome'));
      return;
    }
    next(error);
  }
});

router.put('/:id', requirePermission('settings.cargos.editar'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    await requireSecurityPassword(req.headers[SECURITY_PASSWORD_HEADER] as string | undefined, 'users');
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = updateSchema.parse(req.body);

    const existing = await queryOne('SELECT id FROM roles WHERE id = $1', [params.id]);
    if (!existing) throw new ApiError(404, 'Cargo inexistente');

    if (body.profile_id) await assertProfileExists(body.profile_id);

    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE roles
       SET name = COALESCE($2, name),
           description = COALESCE($3, description),
           profile_id = COALESCE($4, profile_id),
           updated_at = now()
       WHERE id = $1
       RETURNING id, name, description, profile_id`,
      [
        params.id,
        body.name?.trim() ?? null,
        body.description ?? null,
        body.profile_id ?? null,
      ],
    );
    const row = result.rows[0];

    if (body.profile_id) {
      await client.query(
        'UPDATE users SET profile_id = $2, updated_at = now() WHERE role_id = $1',
        [params.id, body.profile_id],
      );
    }

    await client.query('COMMIT');
    await audit(req, 'role_updated', 'role', params.id, { fields: Object.keys(body) });
    res.json(row);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (error instanceof Error && 'code' in error && (error as { code?: string }).code === '23505') {
      next(new ApiError(409, 'Ja existe um cargo com este nome'));
      return;
    }
    next(error);
  } finally {
    client.release();
  }
});

router.delete('/:id', requirePermission('settings.cargos.excluir'), async (req, res, next) => {
  try {
    await requireSecurityPassword(req.headers[SECURITY_PASSWORD_HEADER] as string | undefined, 'users');
    const params = z.object({ id: z.string().uuid() }).parse(req.params);

    const used = await queryOne<{ n: number }>(
      'SELECT count(*)::int AS n FROM users WHERE role_id = $1',
      [params.id],
    );
    if ((used?.n ?? 0) > 0) {
      throw new ApiError(409, 'Cargo em uso por usuários. Reatribua os usuários antes de excluir.');
    }

    const result = await pool.query('DELETE FROM roles WHERE id = $1', [params.id]);
    if (result.rowCount === 0) throw new ApiError(404, 'Cargo inexistente');

    await audit(req, 'role_deleted', 'role', params.id);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
