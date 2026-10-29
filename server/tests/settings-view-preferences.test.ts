import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool, queryOne } from '../src/db/pool.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, setup, uniqueEmail } from './helpers.js';

const app = createApp();

let limitedEmail = '';

const samplePreferences = {
  mode: 'gantt',
  kanban: {
    background: 'escuro',
    column_colors: 'personalizado',
    custom_column_color: '#112233',
    density: 'compacto',
    grouping: 'prioridade',
  },
  lista: {
    density: 'compacto',
    grouping: 'setor',
    sort: 'vencimento',
  },
  calendario: {
    view: 'semana',
    color_by: 'prioridade',
    show_undated: true,
  },
  gantt: {
    scale: 'mensal',
    color_by: 'responsavel',
    show_dependencies: true,
    show_milestones: false,
  },
};

beforeAll(async () => {
  await setup();

  const admin = request.agent(app);
  await admin.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const profileRes = await admin.post('/api/v1/profiles').send({
    name: `Perfil Somente Dashboard ${Date.now()}`,
    description: 'Somente dashboard',
    screens: ['dashboard'],
  });
  limitedEmail = uniqueEmail('viewprefs');
  const invite = await admin.post('/api/v1/auth/invite').send({
    email: limitedEmail,
    profile_id: profileRes.body.id,
    project_ids: [],
  });
  const token = String(invite.body.invite_url).split('/convite/')[1];
  await request(app)
    .post('/api/v1/auth/accept-invite')
    .send({ token, name: 'Usuario Dashboard', password: 'senha-viewprefs-123456' });
});

afterAll(async () => {
  await pool.end();
});

describe('Preferencias globais de visualizacao (GET/PUT/DELETE /settings/view-preferences)', () => {
  it('exige autenticacao para ler, salvar e restaurar', async () => {
    const get = await request(app).get('/api/v1/settings/view-preferences');
    expect(get.status).toBe(401);

    const put = await request(app)
      .put('/api/v1/settings/view-preferences')
      .send(samplePreferences);
    expect(put.status).toBe(401);

    const remove = await request(app).delete('/api/v1/settings/view-preferences');
    expect(remove.status).toBe(401);
  });

  it('sem configuracao salva devolve o padrao completo', async () => {
    const admin = request.agent(app);
    await admin.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const res = await admin.get('/api/v1/settings/view-preferences');
    expect(res.status).toBe(200);
    expect(res.body.preferences.mode).toBe('kanban');
    expect(res.body.preferences.kanban.grouping).toBe('status');
    expect(res.body.preferences.calendario.view).toBe('mes');
    expect(res.body.preferences.gantt.show_milestones).toBe(true);
  });

  it('salva preferencias validas, devolve no GET e audita', async () => {
    const admin = request.agent(app);
    await admin.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const put = await admin
      .put('/api/v1/settings/view-preferences')
      .send(samplePreferences);
    expect(put.status).toBe(200);
    expect(put.body.preferences).toEqual(samplePreferences);

    const get = await admin.get('/api/v1/settings/view-preferences');
    expect(get.status).toBe(200);
    expect(get.body.preferences).toEqual(samplePreferences);

    const row = await queryOne<{ action: string; entity: string }>(
      `SELECT action, entity FROM audit_logs
       WHERE action = 'view_preferences_updated' AND entity = 'system_settings'
       ORDER BY created_at DESC LIMIT 1`,
    );
    expect(row?.action).toBe('view_preferences_updated');
    expect(row?.entity).toBe('system_settings');
  });

  it('recusa valor invalido em campo', async () => {
    const admin = request.agent(app);
    await admin.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const res = await admin
      .put('/api/v1/settings/view-preferences')
      .send({ ...samplePreferences, mode: 'tela-inexistente' });
    expect(res.status).toBe(400);
  });

  it('recusa cor personalizada fora do formato', async () => {
    const admin = request.agent(app);
    await admin.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const res = await admin.put('/api/v1/settings/view-preferences').send({
      ...samplePreferences,
      kanban: { ...samplePreferences.kanban, custom_column_color: 'roxo' },
    });
    expect(res.status).toBe(400);
  });

  it('restaura o padrao com DELETE e audita', async () => {
    const admin = request.agent(app);
    await admin.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const remove = await admin.delete('/api/v1/settings/view-preferences');
    expect(remove.status).toBe(200);
    expect(remove.body.preferences.mode).toBe('kanban');

    const get = await admin.get('/api/v1/settings/view-preferences');
    expect(get.body.preferences).toEqual(remove.body.preferences);

    const row = await queryOne<{ action: string }>(
      `SELECT action FROM audit_logs
       WHERE action = 'view_preferences_reset'
       ORDER BY created_at DESC LIMIT 1`,
    );
    expect(row?.action).toBe('view_preferences_reset');
  });

  it('usuario so com dashboard le GET e recebe 403 ao salvar e restaurar', async () => {
    const user = request.agent(app);
    const login = await user
      .post('/api/v1/auth/login')
      .send({ email: limitedEmail, password: 'senha-viewprefs-123456' });
    expect(login.status).toBe(200);

    const get = await user.get('/api/v1/settings/view-preferences');
    expect(get.status).toBe(200);

    const put = await user
      .put('/api/v1/settings/view-preferences')
      .send(samplePreferences);
    expect(put.status).toBe(403);

    const remove = await user.delete('/api/v1/settings/view-preferences');
    expect(remove.status).toBe(403);
  });
});
