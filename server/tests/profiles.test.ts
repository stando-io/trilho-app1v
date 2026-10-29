import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, setup, uniqueEmail } from './helpers.js';

const app = createApp();

let admin: ReturnType<typeof request.agent>;

async function loginAdmin(): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  return agent;
}

beforeAll(async () => {
  await setup();
  admin = await loginAdmin();
});

afterAll(async () => {
  await pool.end();
});

describe('Perfis com permissoes granulares', () => {
  it('cria perfil com permissoes explicitas', async () => {
    const res = await admin.post('/api/v1/profiles').send({
      name: `Perfil Granular ${Date.now()}`,
      description: 'Permissoes explicitas',
      screens: ['kanban', 'dashboard'],
      permissions: ['kanban.visualizar', 'kanban.criar_cards'],
    });
    expect(res.status).toBe(201);
    expect(res.body.screens).toEqual(['kanban', 'dashboard']);
    expect(res.body.permissions).toEqual(['kanban.visualizar', 'kanban.criar_cards']);
  });

  it('deriva permissoes das telas quando omitidas', async () => {
    const res = await admin.post('/api/v1/profiles').send({
      name: `Perfil Derivado ${Date.now()}`,
      screens: ['dashboard'],
    });
    expect(res.status).toBe(201);
    expect(res.body.permissions).toEqual([
      'dashboard.ver_relatorio_detalhado',
      'dashboard.projetos_recentes.editar',
      'dashboard.projetos_recentes.excluir',
    ]);
  });

  it('rejeita chave de permissao desconhecida', async () => {
    const res = await admin.post('/api/v1/profiles').send({
      name: `Perfil Chave Invalida ${Date.now()}`,
      screens: ['dashboard'],
      permissions: ['dashboard.inventada'],
    });
    expect(res.status).toBe(400);
  });

  it('rejeita permissao de modulo fora das telas', async () => {
    const res = await admin.post('/api/v1/profiles').send({
      name: `Perfil Fora Das Telas ${Date.now()}`,
      screens: ['dashboard'],
      permissions: ['kanban.visualizar'],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('exige a tela');
  });

  it('atualiza permissoes via PUT', async () => {
    const created = await admin.post('/api/v1/profiles').send({
      name: `Perfil Edicao ${Date.now()}`,
      screens: ['kanban'],
    });
    expect(created.status).toBe(201);
    expect(created.body.permissions).toHaveLength(5);

    const res = await admin.put(`/api/v1/profiles/${created.body.id}`).send({
      permissions: ['kanban.visualizar'],
    });
    expect(res.status).toBe(200);
    expect(res.body.permissions).toEqual(['kanban.visualizar']);
    expect(res.body.screens).toEqual(['kanban']);
  });

  it('recalcula permissoes quando somente as telas mudam', async () => {
    const created = await admin.post('/api/v1/profiles').send({
      name: `Perfil Telas ${Date.now()}`,
      screens: ['dashboard'],
    });
    expect(created.status).toBe(201);

    const res = await admin.put(`/api/v1/profiles/${created.body.id}`).send({
      screens: ['kanban'],
    });
    expect(res.status).toBe(200);
    expect(res.body.permissions).toEqual([
      'kanban.visualizar',
      'kanban.criar_cards',
      'kanban.editar_cards',
      'kanban.mover_cards',
      'kanban.excluir_cards',
    ]);
  });

  it('exclui perfil sem usuarios', async () => {
    const created = await admin.post('/api/v1/profiles').send({
      name: `Perfil Descartavel ${Date.now()}`,
      screens: ['dashboard'],
    });
    expect(created.status).toBe(201);

    const res = await admin.delete(`/api/v1/profiles/${created.body.id}`);
    expect(res.status).toBe(204);
  });

  it('exclui perfil com convite pendente e remove o convite', async () => {
    const created = await admin.post('/api/v1/profiles').send({
      name: `Perfil Convite Pendente ${Date.now()}`,
      screens: ['dashboard'],
    });
    expect(created.status).toBe(201);

    const email = uniqueEmail('conv-pendente');
    const invite = await admin.post('/api/v1/auth/invite').send({
      email,
      profile_id: created.body.id,
      project_ids: [],
    });
    expect(invite.status).toBe(201);

    const res = await admin.delete(`/api/v1/profiles/${created.body.id}`);
    expect(res.status).toBe(204);

    const remaining = await pool.query('SELECT id FROM invitations WHERE email = $1', [email]);
    expect(remaining.rowCount).toBe(0);
  });

  it('exclui perfil com historico de convite aceito preservando o registro', async () => {
    const created = await admin.post('/api/v1/profiles').send({
      name: `Perfil Convite Aceito ${Date.now()}`,
      screens: ['dashboard'],
    });
    expect(created.status).toBe(201);

    const email = uniqueEmail('conv-aceito');
    const invite = await admin.post('/api/v1/auth/invite').send({
      email,
      profile_id: created.body.id,
      project_ids: [],
    });
    expect(invite.status).toBe(201);
    const token = String(invite.body.invite_url).split('/convite/')[1];
    const accepted = await request(app).post('/api/v1/auth/accept-invite').send({
      token,
      name: 'Convite Aceito',
      password: 'senha-convite-123456',
    });
    expect(accepted.status).toBe(201);

    const users = await admin.get('/api/v1/users');
    const createdUser = users.body.find((row: { email: string }) => row.email === email);
    expect(createdUser).toBeTruthy();
    const removed = await admin.delete(`/api/v1/users/${createdUser.id}`);
    expect(removed.status).toBe(204);

    const res = await admin.delete(`/api/v1/profiles/${created.body.id}`);
    expect(res.status).toBe(204);

    const history = await pool.query('SELECT profile_id FROM invitations WHERE email = $1', [
      email,
    ]);
    expect(history.rowCount).toBe(1);
    expect(history.rows[0]?.profile_id).toBeNull();
  });

  it('nao exclui perfil em uso por usuarios', async () => {
    const created = await admin.post('/api/v1/profiles').send({
      name: `Perfil Em Uso ${Date.now()}`,
      screens: ['dashboard'],
    });
    expect(created.status).toBe(201);

    const email = uniqueEmail('conv-em-uso');
    const invite = await admin.post('/api/v1/auth/invite').send({
      email,
      profile_id: created.body.id,
      project_ids: [],
    });
    expect(invite.status).toBe(201);
    const token = String(invite.body.invite_url).split('/convite/')[1];
    const accepted = await request(app).post('/api/v1/auth/accept-invite').send({
      token,
      name: 'Perfil Em Uso',
      password: 'senha-em-uso-123456',
    });
    expect(accepted.status).toBe(201);

    const res = await admin.delete(`/api/v1/profiles/${created.body.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('Perfil em uso');

    const users = await admin.get('/api/v1/users');
    const createdUser = users.body.find((row: { email: string }) => row.email === email);
    expect(createdUser).toBeTruthy();
    await admin.delete(`/api/v1/users/${createdUser.id}`);
    const cleanup = await admin.delete(`/api/v1/profiles/${created.body.id}`);
    expect(cleanup.status).toBe(204);
  });

  it('nao permite duplicar nome de perfil', async () => {
    const name = `Perfil Unico ${Date.now()}`;
    const first = await admin.post('/api/v1/profiles').send({ name, screens: ['dashboard'] });
    expect(first.status).toBe(201);

    const second = await admin.post('/api/v1/profiles').send({ name, screens: ['kanban'] });
    expect(second.status).toBe(409);
  });
});
