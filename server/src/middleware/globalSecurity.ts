import type { NextFunction, Request, Response } from 'express';
import { enforceGlobalSecurity, SECURITY_PASSWORD_HEADER } from '../services/securityPassword.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const EXEMPT_PATHS = new Set([
  '/auth/login',
  '/auth/logout',
  '/auth/accept-invite',
  '/auth/reset-password',
]);

/**
 * Exige a senha de seguranca em qualquer mutacao quando o toggle global
 * "Exigir Senha de Seguranca para Qualquer Edicao" esta habilitado.
 */
export async function globalSecurityGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!MUTATING_METHODS.has(req.method)) return next();
  if (EXEMPT_PATHS.has(req.path)) return next();
  try {
    await enforceGlobalSecurity(req.header(SECURITY_PASSWORD_HEADER) ?? undefined);
    next();
  } catch (error) {
    next(error);
  }
}
