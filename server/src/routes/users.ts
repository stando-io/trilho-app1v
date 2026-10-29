import { Router } from 'express';
import { z } from 'zod';
import { hash } from '@node-rs/argon2';
import { pool, query, queryOne } from '../db/pool.js';
import { ApiError } from '../middleware/errors.js';
import { requireAuth, requirePermission, requireScreen } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';
import { requireSecurityPassword, SECURITY_PASSWORD_HEADER } from '../services/securityPassword.js';

const router = Router();

const patchSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email('E-mail inválido').optional(),
  profile_id: z.string().uuid().optional(),
  role_id: z.string().uuid().nullable().optional(),
  project_ids: z.array(z.string().uuid()).optional(),
  is_active: z.boolean().optional(),
});

router.get(
  '/',
  requireAuth,
  requirePermission(
    'settings.usuarios.novo',
    'settings.usuarios.editar',
    'settings.usuarios.excluir',
    'home.novo_projeto',
    'dashboard.projetos_recentes.editar',
  ),
  async (_req, res, next) => {
    try {
      const rows = await query(
        `SELECT u.id, u.name, u.email, u.is_active, u.created_at, u.last_login_at,
              p.id AS profile_id, p.name AS profile_name,
              r.id AS role_id, r.name AS role_name,
              COALESCE(
                (SELECT json_agg(pm.project_id ORDER BY pm.project_id)
                 FROM project_members pm WHERE pm.user_id = u.id),
                '[]'::json
              ) AS project_ids
       FROM users u
       JOIN profiles p ON p.id = u.profile_id
       LEFT JOIN roles r ON r.id = u.role_id
       ORDER BY u.name`,
      );
      res.json(rows);
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/:id',
  requireAuth,
  requireScreen('settings'),
  requirePermission('settings.usuarios.editar'),
  async (req, res, next) => {
  try {
    await requireSecurityPassword(req.headers[SECURITY_PASSWORD_HEADER] as string | undefined, 'users');
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = patchSchema.parse(req.body);

    if (params.id === req.user!.id && body.is_active === false) {
      throw new ApiError(400, 'Você não pode desativar o próprio usuário');
    }

    const existing = await queryOne('SELECT id FROM users WHERE id = $1', [params.id]);
    if (!existing) throw new ApiError(404, 'Usuário inexistente');

    if (body.email) {
      const emailTaken = await queryOne(
        'SELECT id FROM users WHERE lower(email) = lower($1) AND id <> $2',
        [body.email, params.id],
      );
      if (emailTaken) throw new ApiError(409, 'Já existe um usuário com este e-mail');
    }

    if (body.profile_id) {
      const profile = await queryOne('SELECT id FROM profiles WHERE id = $1', [body.profile_id]);
      if (!profile) throw new ApiError(400, 'Perfil inexistente');
    }

    let inheritedProfileId: string | null = null;
    if (body.role_id) {
      const role = await queryOne<{ profile_id: string }>(
        'SELECT profile_id FROM roles WHERE id = $1',
        [body.role_id],
      );
      if (!role) throw new ApiError(400, 'Cargo inexistente');
      inheritedProfileId = role.profile_id;
    }
    const profileId = inheritedProfileId ?? body.profile_id ?? null;

    await pool.query(
      `UPDATE users
       SET name = COALESCE($2, name),
           email = COALESCE($3, email),
           profile_id = COALESCE($4, profile_id),
           role_id = CASE WHEN $6 THEN $5::uuid ELSE role_id END,
           is_active = COALESCE($7, is_active),
           updated_at = now()
       WHERE id = $1`,
      [
        params.id,
        body.name?.trim() ?? null,
        body.email?.trim().toLowerCase() ?? null,
        profileId,
        body.role_id === undefined ? null : body.role_id,
        body.role_id !== undefined,
        body.is_active ?? null,
      ],
    );

    if (body.project_ids) {
      const found = body.project_ids.length
        ? await query<{ id: string }>('SELECT id FROM projects WHERE id = ANY($1::uuid[])', [
            body.project_ids,
          ])
        : [];
      if (found.length !== body.project_ids.length) {
        throw new ApiError(400, 'Projeto inexistente na lista');
      }

      await pool.query('DELETE FROM project_members WHERE user_id = $1', [params.id]);
      for (const projectId of body.project_ids) {
        await pool.query(
          'INSERT INTO project_members (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [projectId, params.id],
        );
      }
    }

    await audit(req, 'user_updated', 'user', params.id, { fields: Object.keys(body) });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

const setPasswordSchema = z.object({
  password: z.string().min(8, 'A senha deve ter no mínimo 8 caracteres').max(128),
});

router.post(
  '/:id/set-password',
  requireAuth,
  requireScreen('settings'),
  requirePermission('settings.usuarios.editar'),
  async (req, res, next) => {
    try {
      await requireSecurityPassword(req.headers[SECURITY_PASSWORD_HEADER] as string | undefined, 'users');
      const params = z.object({ id: z.string().uuid() }).parse(req.params);
      const body = setPasswordSchema.parse(req.body);

      if (params.id === req.user!.id) {
        throw new ApiError(400, 'Use "Alterar senha" para definir a sua própria senha');
      }

      const existing = await queryOne('SELECT id FROM users WHERE id = $1', [params.id]);
      if (!existing) throw new ApiError(404, 'Usuário inexistente');

      const passwordHash = await hash(body.password);
      await pool.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [
        passwordHash,
        params.id,
      ]);

      await audit(req, 'password_set', 'user', params.id);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  '/:id',
  requireAuth,
  requireScreen('settings'),
  requirePermission('settings.usuarios.excluir'),
  async (req, res, next) => {
  try {
    await requireSecurityPassword(req.headers[SECURITY_PASSWORD_HEADER] as string | undefined, 'users');
    const params = z.object({ id: z.string().uuid() }).parse(req.params);

    if (params.id === req.user!.id) {
      throw new ApiError(400, 'Você não pode excluir o próprio usuário');
    }

    const existing = await queryOne('SELECT id FROM users WHERE id = $1', [params.id]);
    if (!existing) throw new ApiError(404, 'Usuário inexistente');

    await pool.query('DELETE FROM users WHERE id = $1', [params.id]);

    await audit(req, 'user_deleted', 'user', params.id);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
