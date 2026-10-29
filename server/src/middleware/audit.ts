import type { Request } from 'express';
import { pool } from '../db/pool.js';

export async function audit(
  req: Request,
  action: string,
  entity: string,
  entityId?: string | null,
  meta: Record<string, unknown> = {},
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, ip, meta)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        req.user?.id ?? null,
        action,
        entity,
        entityId ?? null,
        req.ip ?? null,
        JSON.stringify(meta),
      ],
    );
  } catch (error) {
    console.error('Falha ao gravar auditoria:', error);
  }
}
