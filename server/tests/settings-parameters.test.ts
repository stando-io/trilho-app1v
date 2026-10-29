import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool, queryOne } from '../src/db/pool.js';
import { notify } from '../src/services/notifications.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, setup, uniqueEmail } from './helpers.js';

const app = createApp();

const SECURITY_PASSWORD = 'seguranca-global-1234';

const validPreferences = {
  mode: 'lista',
  kanban: {
    background: 'neutro',
    column_colors: 'status',
    custom_column_color: null,
    density: 'completo',
    grouping: 'status',
  },
  lista: {
    density: 'compacto',
    grouping: 'prioridade',
    sort: 'vencimento',
  },
  calendario: {
    view: 'mes',
    color_by: 'status',
    show_undated: false,
  },
  gantt: {
    scale: 'mensal',
    color_by: 'responsavel',
    show_dependencies: true,
    show_milestones: false,
  },
};

let settingsEmail = '';

beforeAll(async () => {
  await setup();

  const admin = request.agent(app);
  await admin.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const profileRes = await admin.post('/api/v1/profiles').send({
    name: `Perfil So Settings ${Date.now()}`,
    description: 'Tela de configurações sem permissão de parâmetros',
    screens: ['settings'],
    permissions: ['settings.minha_conta'],
  });
  settingsEmail = uniqueEmail('params');
  const invite = await admin.post('/api/v1/auth/invite').send({
    email: settingsEmail,
    profile_id: profileRes.body.id,
    project_ids: [],
  });
  const token = String(invite.body.invite_url).split('/convite/')[1];
  await request(app)
    .post('/api/v1/auth/accept-invite')
    .send({ token, name: 'Usuario Params', password: 'senha-params-123456' });
});

afterAll(async () => {
  await pool.query(
    `UPDATE system_settings
     SET security_password_hash = NULL, security_password_hint = NULL,
         security_gate_all = false,
         security_gate_base = true, security_gate_users = true,
         security_gate_settings = true, security_gate_integrations = true,
         title_max_chars = 200, description_max_chars = 4000,
         notification_prefs = DEFAULT
     WHERE id = 1`,
  );
  await pool.end();
});

describe('Parametros globais (GET/PUT /settings/parameters)', () => {
  it('exige autenticacao para ler e salvar', async () => {
    const get = await request(app).get('/api/v1/settings/parameters');
    expect(get.status).toBe(401);

    const put = await request(app)
      .put('/api/v1/settings/parameters')
      .send({ security_gate_all: true });
    expect(put.status).toBe(401);
  });

  it('devolve o estado padrao desativado', async () => {
    const admin = request.agent(app);
    await admin.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const res = await admin.get('/api/v1/settings/parameters');
    expect(res.status).toBe(200);
    expect(res.body.security_gate_all).toBe(false);
    expect(res.body.security_password_defined).toBe(false);
  });

  it('ativa e desativa o toggle global com auditoria', async () => {
    const admin = request.agent(app);
    await admin.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const on = await admin
      .put('/api/v1/settings/parameters')
      .send({ security_gate_all: true, title_max_chars: 200, description_max_chars: 4000 });
    expect(on.status).toBe(200);
    expect(on.body.security_gate_all).toBe(true);

    const get = await admin.get('/api/v1/settings/parameters');
    expect(get.body.security_gate_all).toBe(true);

    const auditRow = await queryOne<{ action: string }>(
      `SELECT action FROM audit_logs
       WHERE action = 'security_gate_all_toggled'
       ORDER BY created_at DESC LIMIT 1`,
    );
    expect(auditRow?.action).toBe('security_gate_all_toggled');

    const off = await admin
      .put('/api/v1/settings/parameters')
      .send({ security_gate_all: false, title_max_chars: 200, description_max_chars: 4000 });
    expect(off.status).toBe(200);
    expect(off.body.security_gate_all).toBe(false);
  });

  it('recusa valor invalido', async () => {
    const admin = request.agent(app);
    await admin.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const res = await admin
      .put('/api/v1/settings/parameters')
      .send({ security_gate_all: 'sim' });
    expect(res.status).toBe(400);
  });

  it('usuario com tela de settings mas sem settings.parametros recebe 403', async () => {
    const user = request.agent(app);
    const login = await user
      .post('/api/v1/auth/login')
      .send({ email: settingsEmail, password: 'senha-params-123456' });
    expect(login.status).toBe(200);

    const get = await user.get('/api/v1/settings/parameters');
    expect(get.status).toBe(403);

    const put = await user
      .put('/api/v1/settings/parameters')
      .send({ security_gate_all: true });
    expect(put.status).toBe(403);
  });
});

describe('Exigencia global de senha de segurança', () => {
  async function enableGlobalGate(admin: request.Agent): Promise<void> {
    await admin
      .put('/api/v1/settings/security-password')
      .send({ password: SECURITY_PASSWORD, hint: 'dica de teste' });
    const res = await admin
      .put('/api/v1/settings/parameters')
      .send({ security_gate_all: true, title_max_chars: 200, description_max_chars: 4000 });
    expect(res.status).toBe(200);
  }

  it('bloqueia mutacoes sem senha, com senha errada e libera com senha correta', async () => {
    const admin = request.agent(app);
    await admin.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    await enableGlobalGate(admin);

    const withoutHeader = await admin
      .put('/api/v1/settings/view-preferences')
      .send(validPreferences);
    expect(withoutHeader.status).toBe(400);
    expect(withoutHeader.body.error.message).toMatch(/senha de segurança/i);

    const wrongHeader = await admin
      .put('/api/v1/settings/view-preferences')
      .set('x-security-password', 'senha-errada-9999')
      .send(validPreferences);
    expect(wrongHeader.status).toBe(400);
    expect(wrongHeader.body.error.message).toMatch(/senha de segurança/i);

    const withHeader = await admin
      .put('/api/v1/settings/view-preferences')
      .set('x-security-password', SECURITY_PASSWORD)
      .send(validPreferences);
    expect(withHeader.status).toBe(200);
    expect(withHeader.body.preferences.mode).toBe('lista');
  });

  it('libera leituras e excecoes de autenticacao mesmo com o toggle ativo', async () => {
    const admin = request.agent(app);
    await admin.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const health = await admin.get('/api/v1/health');
    expect(health.status).toBe(200);

    const me = await admin.get('/api/v1/auth/me');
    expect(me.status).toBe(200);

    const logout = await admin.post('/api/v1/auth/logout');
    expect(logout.status).toBe(204);
  });

  it('libera mutacoes de novo apos desativar o toggle global', async () => {
    const admin = request.agent(app);
    await admin.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const off = await admin
      .put('/api/v1/settings/parameters')
      .set('x-security-password', SECURITY_PASSWORD)
      .send({ security_gate_all: false, title_max_chars: 200, description_max_chars: 4000 });
    expect(off.status).toBe(200);

    const gateRow = await queryOne<{ security_gate_all: boolean }>(
      'SELECT security_gate_all FROM system_settings WHERE id = 1',
    );
    expect(gateRow?.security_gate_all).toBe(false);

    const remove = await admin.delete('/api/v1/settings/security-password');
    expect(remove.status).toBe(204);
  });
});

describe('Limites de caracteres dos cards', () => {
  it('devolve os limites padrao e aceita roundtrip com auditoria', async () => {
    const admin = request.agent(app);
    await admin.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const initial = await admin.get('/api/v1/settings/parameters');
    expect(initial.status).toBe(200);
    expect(initial.body.title_max_chars).toBe(200);
    expect(initial.body.description_max_chars).toBe(4000);

    const saved = await admin
      .put('/api/v1/settings/parameters')
      .send({ security_gate_all: false, title_max_chars: 300, description_max_chars: 6000 });
    expect(saved.status).toBe(200);
    expect(saved.body.title_max_chars).toBe(300);
    expect(saved.body.description_max_chars).toBe(6000);

    const auditRow = await queryOne<{ action: string }>(
      `SELECT action FROM audit_logs
       WHERE action = 'card_char_limits_updated'
       ORDER BY created_at DESC LIMIT 1`,
    );
    expect(auditRow?.action).toBe('card_char_limits_updated');

    const restored = await admin
      .put('/api/v1/settings/parameters')
      .send({ security_gate_all: false, title_max_chars: 200, description_max_chars: 4000 });
    expect(restored.status).toBe(200);
  });

  it('recusa limites fora dos bounds', async () => {
    const admin = request.agent(app);
    await admin.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const titleSmall = await admin
      .put('/api/v1/settings/parameters')
      .send({ security_gate_all: false, title_max_chars: 5, description_max_chars: 4000 });
    expect(titleSmall.status).toBe(400);

    const descBig = await admin
      .put('/api/v1/settings/parameters')
      .send({ security_gate_all: false, title_max_chars: 200, description_max_chars: 999999 });
    expect(descBig.status).toBe(400);
  });

  it('GET /settings/limits exige login mas nao exige settings.parametros', async () => {
    const anon = await request(app).get('/api/v1/settings/limits');
    expect(anon.status).toBe(401);

    const user = request.agent(app);
    const login = await user
      .post('/api/v1/auth/login')
      .send({ email: settingsEmail, password: 'senha-params-123456' });
    expect(login.status).toBe(200);

    const res = await user.get('/api/v1/settings/limits');
    expect(res.status).toBe(200);
    expect(res.body.title_max_chars).toBe(200);
    expect(res.body.description_max_chars).toBe(4000);
  });
});

describe('Notificacoes (notification_prefs)', () => {
  const NOTIF_ALL_TRUE = {
    card_created: true,
    card_moved: true,
    card_assigned: true,
    card_mention: true,
    card_comment: true,
    card_deadline: true,
    card_learning_index: true,
    permissions_updated: true,
    project_member_added: true,
    security_password_changed: true,
  };

  async function adminLogin(): Promise<request.Agent> {
    const admin = request.agent(app);
    await admin.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    return admin;
  }

  it('devolve todos os tipos habilitados por padrao', async () => {
    const admin = await adminLogin();
    const res = await admin.get('/api/v1/settings/parameters');
    expect(res.status).toBe(200);
    for (const type of Object.keys(NOTIF_ALL_TRUE)) {
      expect(res.body.notification_prefs[type]).toBe(true);
    }
  });

  it('salva preferencias com auditoria e ecoa o resultado', async () => {
    const admin = await adminLogin();

    const off = await admin.put('/api/v1/settings/parameters').send({
      security_gate_all: false,
      title_max_chars: 200,
      description_max_chars: 4000,
      notification_prefs: { ...NOTIF_ALL_TRUE, card_moved: false },
    });
    expect(off.status).toBe(200);
    expect(off.body.notification_prefs.card_moved).toBe(false);
    expect(off.body.notification_prefs.card_created).toBe(true);

    const get = await admin.get('/api/v1/settings/parameters');
    expect(get.body.notification_prefs.card_moved).toBe(false);

    const auditRow = await queryOne<{ action: string }>(
      `SELECT action FROM audit_logs
       WHERE action = 'notification_prefs_updated'
       ORDER BY created_at DESC LIMIT 1`,
    );
    expect(auditRow?.action).toBe('notification_prefs_updated');

    const restored = await admin.put('/api/v1/settings/parameters').send({
      security_gate_all: false,
      title_max_chars: 200,
      description_max_chars: 4000,
      notification_prefs: NOTIF_ALL_TRUE,
    });
    expect(restored.status).toBe(200);
    expect(restored.body.notification_prefs.card_moved).toBe(true);
  });

  it('PUT sem notification_prefs preserva as preferencias atuais', async () => {
    const admin = await adminLogin();

    await admin.put('/api/v1/settings/parameters').send({
      security_gate_all: false,
      title_max_chars: 200,
      description_max_chars: 4000,
      notification_prefs: { ...NOTIF_ALL_TRUE, card_comment: false },
    });

    const before = await admin.get('/api/v1/settings/parameters');

    const put = await admin.put('/api/v1/settings/parameters').send({
      security_gate_all: false,
      title_max_chars: 250,
      description_max_chars: 4000,
    });
    expect(put.status).toBe(200);
    expect(put.body.notification_prefs.card_comment).toBe(false);

    const after = await admin.get('/api/v1/settings/parameters');
    expect(after.body.notification_prefs).toEqual(before.body.notification_prefs);

    await admin.put('/api/v1/settings/parameters').send({
      security_gate_all: false,
      title_max_chars: 200,
      description_max_chars: 4000,
      notification_prefs: NOTIF_ALL_TRUE,
    });
  });

  it('notify nao cria registro quando o tipo esta desabilitado', async () => {
    const admin = await adminLogin();
    const userRow = await queryOne<{ id: string }>(
      'SELECT id FROM users ORDER BY created_at LIMIT 1',
    );
    expect(userRow).not.toBeNull();

    const countSecurityNotifications = async (): Promise<number> => {
      const row = await queryOne<{ n: number }>(
        `SELECT count(*)::int AS n FROM notifications
         WHERE type = 'security_password_changed' AND title = 'Filtro de notificacao teste'`,
      );
      return row?.n ?? 0;
    };

    try {
      const disabled = await admin.put('/api/v1/settings/parameters').send({
        security_gate_all: false,
        title_max_chars: 200,
        description_max_chars: 4000,
        notification_prefs: { ...NOTIF_ALL_TRUE, security_password_changed: false },
      });
      expect(disabled.status).toBe(200);

      const before = await countSecurityNotifications();

      const created = await notify({
        userId: userRow!.id,
        actorId: null,
        type: 'security_password_changed',
        title: 'Filtro de notificacao teste',
      });
      expect(created).toBe(false);
      expect(await countSecurityNotifications()).toBe(before);
    } finally {
      const restored = await admin.put('/api/v1/settings/parameters').send({
        security_gate_all: false,
        title_max_chars: 200,
        description_max_chars: 4000,
        notification_prefs: NOTIF_ALL_TRUE,
      });
      expect(restored.status).toBe(200);

      const enabled = await notify({
        userId: userRow!.id,
        actorId: null,
        type: 'security_password_changed',
        title: 'Filtro de notificacao teste',
      });
      expect(enabled).toBe(true);
      await pool.query(
        `DELETE FROM notifications WHERE title = 'Filtro de notificacao teste'`,
      );
    }
  });
});

describe('Areas de segurança: inicio, dashboard e quadro', () => {
  const NEW_AREAS = ['home', 'dashboard', 'board'] as const;

  async function adminLogin(): Promise<request.Agent> {
    const admin = request.agent(app);
    await admin.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    return admin;
  }

  it('aceita as novas areas no PATCH de gates e persiste no GET', async () => {
    const admin = await adminLogin();

    for (const area of NEW_AREAS) {
      const off = await admin
        .patch('/api/v1/settings/security-password/gates')
        .send({ area, enabled: false });
      expect(off.status).toBe(200);
      expect(off.body).toEqual({ area, enabled: false });
    }

    const securityState = await admin.get('/api/v1/settings/security-password');
    expect(securityState.status).toBe(200);
    expect(securityState.body.gates.home).toBe(false);
    expect(securityState.body.gates.dashboard).toBe(false);
    expect(securityState.body.gates.board).toBe(false);

    for (const area of NEW_AREAS) {
      const on = await admin
        .patch('/api/v1/settings/security-password/gates')
        .send({ area, enabled: true });
      expect(on.status).toBe(200);
    }

    const restored = await admin.get('/api/v1/settings/security-password');
    expect(restored.body.gates.home).toBe(true);
    expect(restored.body.gates.dashboard).toBe(true);
    expect(restored.body.gates.board).toBe(true);
  });

  it('area desconhecida continua rejeitada', async () => {
    const admin = await adminLogin();
    const res = await admin
      .patch('/api/v1/settings/security-password/gates')
      .send({ area: 'inexistente', enabled: false });
    expect(res.status).toBe(400);
  });
});
