import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db/pool.js';
import { audit } from '../middleware/audit.js';
import { requireAuth, requirePermission, requireScreen } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import { requireSecurityPassword, SECURITY_PASSWORD_HEADER } from '../services/securityPassword.js';
import { WEBHOOK_EVENT_KEYS, WEBHOOK_SYSTEMS } from '../services/webhookEvents.js';

const router = Router();

const systemEnum = z.enum(WEBHOOK_SYSTEMS);
const eventsArray = z
  .array(z.enum(WEBHOOK_EVENT_KEYS))
  .min(1, 'Selecione ao menos um evento');

const createSchema = z.object({
  name: z.string().trim().min(2, 'Nome muito curto').max(80, 'Nome muito longo'),
  url: z.string().url('URL inválida').max(2048, 'URL muito longa'),
  system: systemEnum.default('generico'),
  events: eventsArray,
});

const patchSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    url: z.string().url().max(2048).optional(),
    system: systemEnum.optional(),
    events: eventsArray.optional(),
    active: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Nada para atualizar' });

interface WebhookRow {
  id: string;
  name: string;
  url: string;
  system: string;
  events: string[];
  active: boolean;
  created_by_name: string;
  created_at: string;
}

const SELECT_WEBHOOK = `SELECT w.id, w.name, w.url, w.system, w.events, w.active,
        u.name AS created_by_name, w.created_at
 FROM webhooks w
 JOIN users u ON u.id = w.created_by`;

router.get(
  '/',
  requireAuth,
  requireScreen('settings'),
  requirePermission('settings.integracoes'),
  async (_req, res, next) => {
    try {
      const rows = await query<WebhookRow>(`${SELECT_WEBHOOK} ORDER BY w.created_at DESC`);
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
      const row = await queryOne<{ id: string; created_at: string }>(
        `INSERT INTO webhooks (name, url, system, events, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, created_at`,
        [body.name, body.url, body.system, body.events, req.user!.id],
      );
      if (!row) throw new ApiError(500, 'Falha ao gravar o webhook');
      await audit(req, 'webhook_created', 'webhook', row.id, {
        name: body.name,
        system: body.system,
        events: body.events,
        url: body.url,
      });
      res.status(201).json({
        id: row.id,
        name: body.name,
        url: body.url,
        system: body.system,
        events: body.events,
        active: true,
        created_at: row.created_at,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.put(
  '/:webhookId',
  requireAuth,
  requireScreen('settings'),
  requirePermission('settings.integracoes'),
  async (req, res, next) => {
    try {
      await requireSecurityPassword(req.headers[SECURITY_PASSWORD_HEADER] as string | undefined, 'integrations');
      const webhookId = z.string().uuid('Webhook inválido').parse(req.params.webhookId);
      const body = patchSchema.parse(req.body);
      const existing = await queryOne<{ id: string }>('SELECT id FROM webhooks WHERE id = $1', [
        webhookId,
      ]);
      if (!existing) throw new ApiError(404, 'Webhook não encontrado');
      const updated = await queryOne<WebhookRow>(
        `UPDATE webhooks
         SET name = COALESCE($1, name),
             url = COALESCE($2, url),
             system = COALESCE($3, system),
             events = COALESCE($4::text[], events),
             active = COALESCE($5, active)
         WHERE id = $6
         RETURNING id, name, url, system, events, active, created_at`,
        [
          body.name ?? null,
          body.url ?? null,
          body.system ?? null,
          body.events ?? null,
          body.active ?? null,
          webhookId,
        ],
      );
      await audit(req, 'webhook_updated', 'webhook', webhookId, { fields: Object.keys(body) });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  '/:webhookId',
  requireAuth,
  requireScreen('settings'),
  requirePermission('settings.integracoes'),
  async (req, res, next) => {
    try {
      await requireSecurityPassword(req.headers[SECURITY_PASSWORD_HEADER] as string | undefined, 'integrations');
      const webhookId = z.string().uuid('Webhook inválido').parse(req.params.webhookId);
      const deleted = await queryOne<{ id: string }>(
        'DELETE FROM webhooks WHERE id = $1 RETURNING id',
        [webhookId],
      );
      if (!deleted) throw new ApiError(404, 'Webhook não encontrado');
      await audit(req, 'webhook_deleted', 'webhook', webhookId, {});
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

export default router;
