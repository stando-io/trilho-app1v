import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db/pool.js';
import { audit } from '../middleware/audit.js';
import { requireAuth, requirePermission, requireScreen } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import { generateApiKey } from '../services/apiKeys.js';
import { requireSecurityPassword, SECURITY_PASSWORD_HEADER } from '../services/securityPassword.js';

const router = Router();

const createSchema = z.object({
  name: z.string().trim().min(2, 'Nome da chave muito curto').max(80, 'Nome da chave muito longo'),
});

interface KeyRow {
  id: string;
  name: string;
  key_prefix: string;
  key_suffix: string | null;
  created_by_name: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

router.get(
  '/',
  requireAuth,
  requireScreen('settings'),
  requirePermission('settings.integracoes'),
  async (_req, res, next) => {
    try {
      const rows = await query<KeyRow>(
        `SELECT k.id, k.name, k.key_prefix, k.key_suffix, u.name AS created_by_name,
              k.created_at, k.last_used_at, k.revoked_at
       FROM api_keys k
       JOIN users u ON u.id = k.created_by
       ORDER BY k.created_at DESC`,
      );
      res.json(rows);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/',
  requireAuth,
  requireScreen('settings'),
  requirePermission('settings.integracoes'),
  async (req, res, next) => {
  try {
    await requireSecurityPassword(req.headers[SECURITY_PASSWORD_HEADER] as string | undefined, 'integrations');
    const body = createSchema.parse(req.body);
    const { token, keyPrefix, keyHash, keySuffix } = generateApiKey();
    const row = await queryOne<{ id: string; created_at: string }>(
      `INSERT INTO api_keys (name, key_hash, key_prefix, key_suffix, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [body.name, keyHash, keyPrefix, keySuffix, req.user!.id],
    );
    if (!row) throw new ApiError(500, 'Falha ao gravar a chave de API');
    await audit(req, 'api_key_created', 'api_key', row.id, {
      name: body.name,
      key_prefix: keyPrefix,
    });
    res.status(201).json({
      id: row.id,
      name: body.name,
      key: token,
      key_prefix: keyPrefix,
      created_at: row.created_at,
    });
  } catch (error) {
    next(error);
  }
});

router.delete(
  '/:keyId',
  requireAuth,
  requireScreen('settings'),
  requirePermission('settings.integracoes'),
  async (req, res, next) => {
  try {
    await requireSecurityPassword(req.headers[SECURITY_PASSWORD_HEADER] as string | undefined, 'integrations');
    const keyId = z.string().uuid('Chave inválida').parse(req.params.keyId);
    const existing = await queryOne<{ revoked_at: string | null; name: string; key_prefix: string }>(
      'SELECT revoked_at, name, key_prefix FROM api_keys WHERE id = $1',
      [keyId],
    );
    if (!existing) throw new ApiError(404, 'Chave não encontrada');

    if (existing.revoked_at) {
      await query('DELETE FROM api_keys WHERE id = $1', [keyId]);
      await audit(req, 'api_key_deleted', 'api_key', keyId, {
        name: existing.name,
        key_prefix: existing.key_prefix,
      });
      res.status(204).end();
      return;
    }

    await queryOne('UPDATE api_keys SET revoked_at = now() WHERE id = $1 RETURNING id', [keyId]);
    await audit(req, 'api_key_revoked', 'api_key', keyId, {
      name: existing.name,
      key_prefix: existing.key_prefix,
    });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
