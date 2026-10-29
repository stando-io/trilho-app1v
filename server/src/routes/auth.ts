import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { hash, verify } from '@node-rs/argon2';
import { pool, query, queryOne } from '../db/pool.js';
import { ApiError } from '../middleware/errors.js';
import { requireAuth, requirePermission, requireScreen } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';
import { generateToken, hashToken } from '../services/tokens.js';
import { config } from '../config.js';

const router = Router();

const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Muitas tentativas. Aguarde alguns minutos.' } },
});

const loginSchema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(1, 'Senha obrigatória'),
});

const inviteSchema = z
  .object({
    email: z.string().email('E-mail inválido'),
    profile_id: z.string().uuid('Perfil inválido').optional(),
    role_id: z.string().uuid('Cargo inválido').optional(),
    project_ids: z.array(z.string().uuid()).default([]),
  })
  .refine((body) => body.profile_id || body.role_id, {
    message: 'Informe o cargo ou o nível de acesso',
    path: ['profile_id'],
  });

const acceptInviteSchema = z.object({
  token: z.string().min(1),
  name: z.string().min(2, 'Nome muito curto'),
  password: z.string().min(8, 'Senha deve ter pelo menos 8 caracteres'),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, 'Senha deve ter pelo menos 8 caracteres'),
});

const resetLinkParamsSchema = z.object({ id: z.string().uuid() });

const updateMeSchema = z
  .object({
    name: z.string().min(2, 'Nome muito curto').optional(),
    avatar_color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida')
      .nullable()
      .optional(),
    avatar_text_color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida')
      .nullable()
      .optional(),
  })
  .refine(
    (body) =>
      body.name !== undefined || body.avatar_color !== undefined || body.avatar_text_color !== undefined,
    { message: 'Nada para atualizar' },
  );

const changePasswordSchema = z.object({
  current_password: z.string().min(1, 'Senha atual obrigatória'),
  password: z.string().min(8, 'Senha deve ter pelo menos 8 caracteres'),
});

interface MeUser {
  id: string;
  name: string;
  email: string;
  avatar_color: string | null;
  avatar_text_color: string | null;
  role: { id: string; name: string } | null;
  profile: { id: string; name: string; screens: string[]; permissions: string[] };
  projects: { id: string; name: string; description: string; is_active: boolean }[];
}

async function mePayload(userId: string): Promise<MeUser> {
  const user = await queryOne<{
    id: string;
    name: string;
    email: string;
    avatar_color: string | null;
    avatar_text_color: string | null;
    role_id: string | null;
    role_name: string | null;
    profile_id: string;
    profile_name: string;
    screens: string[];
    permissions: string[];
  }>(
    `SELECT u.id, u.name, u.email, u.avatar_color, u.avatar_text_color,
            r.id AS role_id, r.name AS role_name,
            p.id AS profile_id, p.name AS profile_name, p.screens, p.permissions
     FROM users u
     JOIN profiles p ON p.id = u.profile_id
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1`,
    [userId],
  );
  if (!user) throw new ApiError(401, 'Usuário não encontrado');

  const projects = await query<{
    id: string;
    name: string;
    description: string;
    is_active: boolean;
    status: string | null;
  }>(
    `SELECT pr.id, pr.name, pr.description, pr.is_active, pr.status
     FROM projects pr
     JOIN project_members pm ON pm.project_id = pr.id
     WHERE pm.user_id = $1
     ORDER BY pr.is_active DESC, pr.name`,
    [userId],
  );

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatar_color: user.avatar_color,
    avatar_text_color: user.avatar_text_color,
    role: user.role_id && user.role_name ? { id: user.role_id, name: user.role_name } : null,
    profile: {
      id: user.profile_id,
      name: user.profile_name,
      screens: user.screens ?? [],
      permissions: user.permissions ?? [],
    },
    projects,
  };
}

function promisifySession(req: Parameters<typeof requireAuth>[0]): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) {
        reject(error);
        return;
      }
      req.session.save((saveError) => {
        if (saveError) {
          reject(saveError);
          return;
        }
        resolve();
      });
    });
  });
}

router.post('/login', publicLimiter, async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);

    const user = await queryOne<{
      id: string;
      password_hash: string | null;
      is_active: boolean;
    }>(
      'SELECT id, password_hash, is_active FROM users WHERE lower(email) = lower($1)',
      [body.email],
    );

    const invalidError = new ApiError(401, 'E-mail ou senha inválidos');

    if (!user || !user.is_active || !user.password_hash) {
      await audit(req, 'login_failed', 'user', null, { email: body.email });
      throw invalidError;
    }

    const valid = await verify(user.password_hash, body.password).catch(() => false);
    if (!valid) {
      await audit(req, 'login_failed', 'user', user.id, { email: body.email });
      throw invalidError;
    }

    await promisifySession(req);
    req.session.userId = user.id;
    await new Promise<void>((resolve, reject) => {
      req.session.save((error) => (error ? reject(error) : resolve()));
    });
    await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);

    await audit(req, 'login', 'user', user.id);
    res.json(await mePayload(user.id));
  } catch (error) {
    next(error);
  }
});

router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user?.id ?? null;
    await new Promise<void>((resolve, reject) => {
      req.session.destroy((error) => (error ? reject(error) : resolve()));
    });
    await audit(req, 'logout', 'user', userId);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    res.json(await mePayload(req.user!.id));
  } catch (error) {
    next(error);
  }
});

router.patch('/me', requireAuth, requirePermission('settings.minha_conta'), async (req, res, next) => {
  try {
    const body = updateMeSchema.parse(req.body);
    const fields: string[] = [];
    const values: (string | null)[] = [];

    if (body.name !== undefined) {
      fields.push(`name = $${values.length + 1}`);
      values.push(body.name.trim());
    }
    if (body.avatar_color !== undefined) {
      fields.push(`avatar_color = $${values.length + 1}`);
      values.push(body.avatar_color);
    }
    if (body.avatar_text_color !== undefined) {
      fields.push(`avatar_text_color = $${values.length + 1}`);
      values.push(body.avatar_text_color);
    }

    values.push(req.user!.id);
    await pool.query(
      `UPDATE users SET ${fields.join(', ')}, updated_at = now() WHERE id = $${values.length}`,
      values,
    );

    const meta: Record<string, unknown> = {};
    if (body.name !== undefined) meta.name = body.name.trim();
    if (body.avatar_color !== undefined) meta.avatar_color = body.avatar_color;
    if (body.avatar_text_color !== undefined) meta.avatar_text_color = body.avatar_text_color;
    await audit(req, 'user_profile_updated', 'user', req.user!.id, meta);

    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.post('/change-password', requireAuth, requirePermission('settings.minha_conta'), async (req, res, next) => {
  try {
    const body = changePasswordSchema.parse(req.body);

    const user = await queryOne<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.user!.id],
    );
    if (!user) throw new ApiError(401, 'Usuário não encontrado');

    const currentValid = await verify(user.password_hash, body.current_password);
    if (!currentValid) throw new ApiError(401, 'Senha atual incorreta');

    const passwordHash = await hash(body.password);
    await pool.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [
      passwordHash,
      req.user!.id,
    ]);
    await audit(req, 'password_changed', 'user', req.user!.id);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.post('/invite', requireAuth, requireScreen('settings'), requirePermission('settings.usuarios.novo'), async (req, res, next) => {
  try {
    const body = inviteSchema.parse(req.body);

    let profileId: string | null = body.profile_id ?? null;
    if (body.role_id) {
      const role = await queryOne<{ profile_id: string }>(
        'SELECT profile_id FROM roles WHERE id = $1',
        [body.role_id],
      );
      if (!role) throw new ApiError(400, 'Cargo inexistente');
      profileId = role.profile_id;
    }

    const profile = await queryOne('SELECT id FROM profiles WHERE id = $1', [profileId]);
    if (!profile) throw new ApiError(400, 'Perfil inexistente');

    if (body.project_ids.length > 0) {
      const found = await query<{ id: string }>(
        'SELECT id FROM projects WHERE id = ANY($1::uuid[])',
        [body.project_ids],
      );
      if (found.length !== body.project_ids.length) {
        throw new ApiError(400, 'Projeto inexistente na lista');
      }
    }

    const existing = await queryOne('SELECT id FROM users WHERE lower(email) = lower($1)', [body.email]);
    if (existing) throw new ApiError(409, 'Já existe um usuário com este e-mail');

    const token = generateToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invitation = await queryOne<{ id: string }>(
      `INSERT INTO invitations (email, token_hash, profile_id, role_id, project_ids, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       RETURNING id`,
      [
        body.email.toLowerCase(),
        hashToken(token),
        profileId,
        body.role_id ?? null,
        JSON.stringify(body.project_ids),
        req.user!.id,
        expiresAt.toISOString(),
      ],
    );

    await audit(req, 'invite_created', 'invitation', invitation?.id ?? null, {
      email: body.email,
    });

    res.status(201).json({
      invite_url: `${config.baseUrl}/convite/${token}`,
      expires_at: expiresAt.toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/accept-invite', publicLimiter, async (req, res, next) => {
  try {
    const body = acceptInviteSchema.parse(req.body);

    const invitation = await queryOne<{
      id: string;
      email: string;
      profile_id: string | null;
      role_id: string | null;
      project_ids: string[];
      expires_at: Date;
      accepted_at: Date | null;
    }>(
      `SELECT id, email, profile_id, role_id, project_ids, expires_at, accepted_at
       FROM invitations WHERE token_hash = $1`,
      [hashToken(body.token)],
    );

    if (!invitation || invitation.accepted_at || new Date(invitation.expires_at) < new Date()) {
      throw new ApiError(400, 'Convite inválido ou expirado');
    }

    const profileId = invitation.profile_id;
    if (!profileId) throw new ApiError(400, 'Convite inválido ou expirado');

    const existing = await queryOne('SELECT id FROM users WHERE lower(email) = lower($1)', [
      invitation.email,
    ]);
    if (existing) throw new ApiError(409, 'Este e-mail ja possui cadastro');

    const passwordHash = await hash(body.password);
    const user = await queryOne<{ id: string }>(
      `INSERT INTO users (name, email, password_hash, profile_id, role_id, is_active)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
      [body.name.trim(), invitation.email, passwordHash, profileId, invitation.role_id],
    );
    if (!user) throw new ApiError(500, 'Falha ao criar usuário');

    const projectIds = Array.isArray(invitation.project_ids) ? invitation.project_ids : [];
    for (const projectId of projectIds) {
      await pool.query(
        'INSERT INTO project_members (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [projectId, user.id],
      );
    }

    await pool.query('UPDATE invitations SET accepted_at = now() WHERE id = $1', [invitation.id]);

    await promisifySession(req);
    req.session.userId = user.id;
    await new Promise<void>((resolve, reject) => {
      req.session.save((error) => (error ? reject(error) : resolve()));
    });
    await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);

    await audit(req, 'invite_accepted', 'user', user.id, { email: invitation.email });
    res.status(201).json(await mePayload(user.id));
  } catch (error) {
    next(error);
  }
});

router.post('/users/:id/reset-link', requireAuth, requireScreen('settings'), requirePermission('settings.usuarios.editar'), async (req, res, next) => {
  try {
    const params = resetLinkParamsSchema.parse(req.params);
    const user = await queryOne('SELECT id FROM users WHERE id = $1', [params.id]);
    if (!user) throw new ApiError(404, 'Usuário inexistente');

    const token = generateToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const row = await queryOne<{ id: string }>(
      `INSERT INTO password_resets (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3) RETURNING id`,
      [params.id, hashToken(token), expiresAt.toISOString()],
    );
    if (!row) throw new ApiError(500, 'Falha ao gerar link de redefinição');

    await audit(req, 'reset_link_created', 'user', row.id);
    res.status(201).json({
      reset_url: `${config.baseUrl}/redefinir/${token}`,
      expires_at: expiresAt.toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/reset-password', publicLimiter, async (req, res, next) => {
  try {
    const body = resetPasswordSchema.parse(req.body);

    const reset = await queryOne<{
      id: string;
      user_id: string;
      expires_at: Date;
      used_at: Date | null;
    }>(
      'SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = $1',
      [hashToken(body.token)],
    );

    if (!reset || reset.used_at || new Date(reset.expires_at) < new Date()) {
      throw new ApiError(400, 'Link de redefinição inválido ou expirado');
    }

    const passwordHash = await hash(body.password);
    await pool.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [
      passwordHash,
      reset.user_id,
    ]);
    await pool.query('UPDATE password_resets SET used_at = now() WHERE id = $1', [reset.id]);

    await audit(req, 'password_reset', 'user', reset.user_id);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
