import { Router } from 'express';
import { z } from 'zod';
import { pool, query, queryOne } from '../db/pool.js';
import { ApiError } from '../middleware/errors.js';
import { requireAuth, requirePermission, requireScreen } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';
import { requireSecurityPassword, SECURITY_PASSWORD_HEADER } from '../services/securityPassword.js';
import { notifyMany } from '../services/notifications.js';
import { SCREENS } from '../services/screens.js';
import {
  PERMISSION_LEAVES,
  moduleOf,
  permissionsForScreens,
} from '../services/permissions.js';

const router = Router();

router.use(requireAuth, requireScreen('settings'));

const screensSchema = z
  .array(z.enum(SCREENS))
  .refine((items) => items.every((item) => SCREENS.includes(item)), {
    message: 'Tela desconhecida',
  });

const permissionsSchema = z
  .array(z.enum(PERMISSION_LEAVES))
  .refine((items) => new Set(items).size === items.length, {
    message: 'Permissão duplicada',
  });

function assertPermissionsMatchScreens(screens: string[], permissions: string[]): void {
  const invalid = permissions.find((item) => !screens.includes(moduleOf(item)));
  if (invalid) {
    throw new ApiError(400, `Permissão "${invalid}" exige a tela correspondente`);
  }
}

const createSchema = z.object({
  name: z.string().min(2, 'Nome muito curto'),
  description: z.string().default(''),
  screens: screensSchema,
  permissions: permissionsSchema.optional(),
});

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  description: z.string().optional(),
  screens: screensSchema.optional(),
  permissions: permissionsSchema.optional(),
});

router.get(
  '/',
  requirePermission('settings.niveis.novo', 'settings.niveis.editar', 'settings.niveis.excluir'),
  async (_req, res, next) => {
    try {
      const rows = await query(
        `SELECT p.id, p.name, p.description, p.screens, p.permissions,
              (SELECT count(*)::int FROM users u WHERE u.profile_id = p.id) AS users_count
       FROM profiles p
       ORDER BY p.name`,
      );
      res.json(rows);
    } catch (error) {
      next(error);
    }
  },
);

router.post('/', requirePermission('settings.niveis.novo'), async (req, res, next) => {
  try {
    await requireSecurityPassword(req.headers[SECURITY_PASSWORD_HEADER] as string | undefined, 'users');
    const body = createSchema.parse(req.body);
    const permissions = body.permissions ?? permissionsForScreens(body.screens);
    assertPermissionsMatchScreens(body.screens, permissions);
    const row = await queryOne(
      `INSERT INTO profiles (name, description, screens, permissions)
       VALUES ($1, $2, $3::jsonb, $4::jsonb) RETURNING id, name, description, screens, permissions`,
      [body.name.trim(), body.description, JSON.stringify(body.screens), JSON.stringify(permissions)],
    );
    await audit(req, 'profile_created', 'profile', row?.id ?? null, { name: body.name });
    res.status(201).json(row);
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as { code?: string }).code === '23505') {
      next(new ApiError(409, 'Ja existe um perfil com este nome'));
      return;
    }
    next(error);
  }
});

router.put('/:id', requirePermission('settings.niveis.editar'), async (req, res, next) => {
  try {
    await requireSecurityPassword(req.headers[SECURITY_PASSWORD_HEADER] as string | undefined, 'users');
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = updateSchema.parse(req.body);

    const existing = await queryOne<{ screens: string[] }>(
      'SELECT id, screens FROM profiles WHERE id = $1',
      [params.id],
    );
    if (!existing) throw new ApiError(404, 'Perfil inexistente');

    const screens = body.screens ?? existing.screens;
    const permissions =
      body.permissions ?? (body.screens ? permissionsForScreens(body.screens) : undefined);
    if (permissions) assertPermissionsMatchScreens(screens, permissions);

    const row = await queryOne(
      `UPDATE profiles
       SET name = COALESCE($2, name),
           description = COALESCE($3, description),
           screens = COALESCE($4::jsonb, screens),
           permissions = COALESCE($5::jsonb, permissions),
           updated_at = now()
       WHERE id = $1
       RETURNING id, name, description, screens, permissions`,
      [
        params.id,
        body.name?.trim() ?? null,
        body.description ?? null,
        body.screens ? JSON.stringify(body.screens) : null,
        permissions ? JSON.stringify(permissions) : null,
      ],
    );

    await audit(req, 'profile_updated', 'profile', params.id, { fields: Object.keys(body) });
    if (body.permissions !== undefined || body.screens !== undefined) {
      const affected = await pool.query<{ id: string }>(
        'SELECT id FROM users WHERE profile_id = $1 AND is_active = true',
        [params.id],
      );
      const profileName = (row as { name?: string } | null)?.name ?? '';
      await notifyMany(
        affected.rows.map((affectedUser) => ({
          userId: affectedUser.id,
          actorId: req.user!.id,
          type: 'permissions_updated',
          title: 'Permissões atualizadas',
          body: `O nível de acesso "${profileName}" foi atualizado.`,
          screen: 'settings',
          link: '/configuracoes',
        })),
      );
    }
    res.json(row);
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as { code?: string }).code === '23505') {
      next(new ApiError(409, 'Ja existe um perfil com este nome'));
      return;
    }
    next(error);
  }
});

router.delete('/:id', requirePermission('settings.niveis.excluir'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    await requireSecurityPassword(req.headers[SECURITY_PASSWORD_HEADER] as string | undefined, 'users');
    const params = z.object({ id: z.string().uuid() }).parse(req.params);

    await client.query('BEGIN');
    await client.query('DELETE FROM invitations WHERE profile_id = $1 AND accepted_at IS NULL', [
      params.id,
    ]);
    const result = await client.query('DELETE FROM profiles WHERE id = $1', [params.id]);
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      throw new ApiError(404, 'Perfil inexistente');
    }
    await client.query('COMMIT');

    await audit(req, 'profile_deleted', 'profile', params.id);
    res.status(204).end();
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (error instanceof Error && 'code' in error && (error as { code?: string }).code === '23503') {
      next(new ApiError(409, 'Perfil em uso por usuários ou cargos. Reatribua antes de excluir.'));
      return;
    }
    next(error);
  } finally {
    client.release();
  }
});

export default router;
