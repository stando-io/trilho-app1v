import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../middleware/audit.js';
import { requireAuth, requirePermission, requireScreen } from '../middleware/auth.js';
import { pool } from '../db/pool.js';
import {
  deleteSecurityPassword,
  getSecurityState,
  getCardCharLimits,
  setSecurityPassword,
  setSecurityGate,
  setSecurityGateAll,
  setCardCharLimits,
  getNotificationPrefs,
  setNotificationPrefs,
  NOTIFICATION_TYPES,
  type NotificationType,
} from '../services/securityPassword.js';
import {
  DEFAULT_VIEW_PREFERENCES,
  resolveViewPreferences,
  viewPreferencesSchema,
} from '../services/viewPreferences.js';
import { notifyMany } from '../services/notifications.js';

const router = Router();

async function notifyScopeChange(actorId: string, action: 'set' | 'deleted'): Promise<void> {
  const users = await pool.query<{ id: string }>(
    'SELECT id FROM users WHERE is_active = true',
  );
  await notifyMany(
    users.rows.map((user) => ({
      userId: user.id,
      actorId,
      type: 'security_password_changed',
      title: action === 'set' ? 'Senha de segurança alterada' : 'Senha de segurança removida',
      body:
        action === 'set'
          ? 'A senha de segurança global do sistema foi alterada.'
          : 'A senha de segurança global do sistema foi removida.',
      screen: 'settings',
      link: '/configuracoes',
    })),
  );
}

router.get('/view-preferences', requireAuth, async (_req, res, next) => {
  try {
    const result = await pool.query<{ view_preferences: unknown }>(
      'SELECT view_preferences FROM system_settings WHERE id = 1',
    );
    res.json({ preferences: resolveViewPreferences(result.rows[0]?.view_preferences) });
  } catch (error) {
    next(error);
  }
});

router.get('/limits', requireAuth, async (_req, res, next) => {
  try {
    res.json(await getCardCharLimits());
  } catch (error) {
    next(error);
  }
});

router.use(requireAuth, requireScreen('settings'));

const setBody = z.object({
  password: z.string().min(4, 'Senha de segurança muito curta').max(100),
  hint: z.string().trim().max(140).optional(),
});

router.get('/security-password', requirePermission('settings.seguranca'), async (_req, res, next) => {
  try {
    res.json(await getSecurityState());
  } catch (error) {
    next(error);
  }
});

router.put('/security-password', requirePermission('settings.seguranca'), async (req, res, next) => {
  try {
    const body = setBody.parse(req.body);
    await setSecurityPassword(body.password, body.hint || undefined);
    await audit(req, 'security_password_set', 'system_settings', null, {
      hint: body.hint || '',
    });
    await notifyScopeChange(req.user!.id, 'set');
    res.json({ defined: true });
  } catch (error) {
    next(error);
  }
});

router.delete('/security-password', requirePermission('settings.seguranca'), async (req, res, next) => {
  try {
    await deleteSecurityPassword();
    await audit(req, 'security_password_deleted', 'system_settings', null, {});
    await notifyScopeChange(req.user!.id, 'deleted');
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

const gateBody = z.object({
  area: z.enum(['base', 'users', 'settings', 'integrations', 'home', 'dashboard', 'board']),
  enabled: z.boolean(),
});

router.patch('/security-password/gates', requirePermission('settings.seguranca'), async (req, res, next) => {
  try {
    const body = gateBody.parse(req.body);
    await setSecurityGate(body.area, body.enabled);
    await audit(req, 'security_gate_toggled', 'system_settings', null, {
      area: body.area,
      enabled: body.enabled,
    });
    res.json({ area: body.area, enabled: body.enabled });
  } catch (error) {
    next(error);
  }
});

router.get('/parameters', requirePermission('settings.parametros'), async (_req, res, next) => {
  try {
    const [state, limits, notificationPrefs] = await Promise.all([
      getSecurityState(),
      getCardCharLimits(),
      getNotificationPrefs(),
    ]);
    res.json({
      security_gate_all: state.global,
      security_password_defined: state.defined,
      title_max_chars: limits.title_max_chars,
      description_max_chars: limits.description_max_chars,
      notification_prefs: notificationPrefs,
    });
  } catch (error) {
    next(error);
  }
});

const notificationPrefsBody = z.object<Record<NotificationType, z.ZodBoolean>>(
  NOTIFICATION_TYPES.reduce<Record<string, z.ZodBoolean>>((shape, type) => {
    shape[type] = z.boolean();
    return shape;
  }, {}) as Record<NotificationType, z.ZodBoolean>,
);

const parametersBody = z.object({
  security_gate_all: z.boolean(),
  title_max_chars: z.number().int().min(10).max(1000),
  description_max_chars: z.number().int().min(100).max(50000),
  notification_prefs: notificationPrefsBody.optional(),
});

router.put('/parameters', requirePermission('settings.parametros'), async (req, res, next) => {
  try {
    const body = parametersBody.parse(req.body);
    await setSecurityGateAll(body.security_gate_all);
    await setCardCharLimits(body.title_max_chars, body.description_max_chars);
    await audit(req, 'security_gate_all_toggled', 'system_settings', null, {
      enabled: body.security_gate_all,
    });
    await audit(req, 'card_char_limits_updated', 'system_settings', null, {
      title_max_chars: body.title_max_chars,
      description_max_chars: body.description_max_chars,
    });
    const notificationPrefs = body.notification_prefs;
    if (notificationPrefs) {
      await setNotificationPrefs(notificationPrefs);
      await audit(req, 'notification_prefs_updated', 'system_settings', null, {
        disabled: NOTIFICATION_TYPES.filter((type) => !notificationPrefs[type]),
      });
    }
    res.json({
      security_gate_all: body.security_gate_all,
      title_max_chars: body.title_max_chars,
      description_max_chars: body.description_max_chars,
      notification_prefs: await getNotificationPrefs(),
    });
  } catch (error) {
    next(error);
  }
});

router.put('/view-preferences', requirePermission('settings.temas'), async (req, res, next) => {
  try {
    const body = viewPreferencesSchema.parse(req.body);
    await pool.query(
      `INSERT INTO system_settings (id, view_preferences)
       VALUES (1, $1::jsonb)
       ON CONFLICT (id) DO UPDATE SET view_preferences = EXCLUDED.view_preferences`,
      [JSON.stringify(body)],
    );
    await audit(req, 'view_preferences_updated', 'system_settings', null, {
      mode: body.mode,
    });
    res.json({ preferences: body });
  } catch (error) {
    next(error);
  }
});

router.delete('/view-preferences', requirePermission('settings.temas'), async (req, res, next) => {
  try {
    await pool.query('UPDATE system_settings SET view_preferences = NULL WHERE id = 1');
    await audit(req, 'view_preferences_reset', 'system_settings', null, {});
    res.json({ preferences: DEFAULT_VIEW_PREFERENCES });
  } catch (error) {
    next(error);
  }
});

export default router;
