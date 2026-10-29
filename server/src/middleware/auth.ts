import type { NextFunction, Request, Response } from 'express';
import { pool, queryOne } from '../db/pool.js';
import { hashApiKey } from '../services/apiKeys.js';
import { ApiError } from './errors.js';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  screens: string[];
  permissions: string[];
}

declare module 'express-session' {
  interface SessionData {
    userId?: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      apiKeyId?: string;
    }
  }
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  is_active: boolean;
  screens: string[] | null;
  permissions: string[] | null;
}

const SAFE_METHODS = new Set(['GET', 'HEAD']);

async function authenticateApiKey(req: Request, token: string): Promise<void> {
  const key = await queryOne<{ id: string; created_by: string }>(
    'SELECT id, created_by FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL',
    [hashApiKey(token)],
  );
  if (!key) {
    throw new ApiError(401, 'Chave de API inválida ou revogada');
  }

  if (!SAFE_METHODS.has(req.method)) {
    throw new ApiError(403, 'Chave de API somente leitura');
  }

  const user = await queryOne<UserRow>(
    `SELECT u.id, u.name, u.email, u.is_active, p.screens, p.permissions
     FROM users u
     JOIN profiles p ON p.id = u.profile_id
     WHERE u.id = $1`,
    [key.created_by],
  );
  if (!user || !user.is_active) {
    throw new ApiError(401, 'Chave de API inválida ou revogada');
  }

  req.user = {
    id: user.id,
    name: user.name,
    email: user.email,
    screens: user.screens ?? [],
    permissions: user.permissions ?? [],
  };
  req.apiKeyId = key.id;
  try {
    await pool.query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [key.id]);
  } catch (error) {
    console.error('Falha ao registrar uso da chave de API:', error);
  }
}

export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authorization = req.header('authorization');
    if (authorization?.startsWith('Bearer trl_')) {
      await authenticateApiKey(req, authorization.slice('Bearer '.length));
      next();
      return;
    }

    const userId = req.session.userId;
    if (!userId) {
      throw new ApiError(401, 'Autenticação necessária');
    }

    const user = await queryOne<UserRow>(
      `SELECT u.id, u.name, u.email, u.is_active, p.screens, p.permissions
       FROM users u
       JOIN profiles p ON p.id = u.profile_id
       WHERE u.id = $1`,
      [userId],
    );

    if (!user || !user.is_active) {
      req.session.destroy(() => undefined);
      throw new ApiError(401, 'Sessão inválida');
    }

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      screens: user.screens ?? [],
      permissions: user.permissions ?? [],
    };
    next();
  } catch (error) {
    next(error);
  }
}

export function requireScreen(screen: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new ApiError(401, 'Autenticação necessária'));
      return;
    }
    if (!req.user.screens.includes(screen)) {
      next(new ApiError(403, 'Seu perfil não tem acesso a esta área'));
      return;
    }
    next();
  };
}

export function requireAnyScreen(...screens: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new ApiError(401, 'Autenticação necessária'));
      return;
    }
    if (!screens.some((screen) => req.user!.screens.includes(screen))) {
      next(new ApiError(403, 'Seu perfil não tem acesso a esta área'));
      return;
    }
    next();
  };
}

export function requirePermission(...permissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new ApiError(401, 'Autenticação necessária'));
      return;
    }
    if (!permissions.some((permission) => req.user!.permissions.includes(permission))) {
      next(new ApiError(403, 'Seu perfil não tem permissão para esta ação'));
      return;
    }
    next();
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function requireProjectMember(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const projectId = req.params.projectId;
    if (!projectId || !UUID_PATTERN.test(projectId)) {
      throw new ApiError(400, 'Projeto inválido');
    }
    const member = await queryOne(
      'SELECT 1 AS ok FROM project_members WHERE project_id = $1 AND user_id = $2',
      [projectId, req.user!.id],
    );
    if (!member) {
      throw new ApiError(403, 'Você não tem acesso a este projeto');
    }
    next();
  } catch (error) {
    next(error);
  }
}
