import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, dropProject, setup, uniqueEmail } from './helpers.js';

const app = createApp();

let admin: ReturnType<typeof request.agent>;
let projectId = '';
let cardId = '';
let homeProfileId = '';
let kanbanProfileId = '';
let settingsProfileId = '';
let homeUser: ReturnType<typeof request.agent>;
let kanbanUser: ReturnType<typeof request.agent>;
let settingsUser: ReturnType<typeof request.agent>;

async function loginAdmin(): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  return agent;
}

async function createMemberUser(
  profileId: string,
  prefix: string,
  projectIds: string[],
): Promise<ReturnType<typeof request.agent>> {
  const email = uniqueEmail(prefix);
  const password = `senha-${prefix}-123456`;
  const invite = await admin.post('/api/v1/auth/invite').send({
    email,
    profile_id: profileId,
    project_ids: projectIds,
  });
  expect(invite.status).toBe(201);

  const token = String(invite.body.invite_url).split('/convite/')[1];
  const accepted = await request(app).post('/api/v1/auth/accept-invite').send({
    token,
    name: `Usuario ${prefix}`,
    password,
  });
  expect(accepted.status).toBe(201);

  const agent = request.agent(app);
  const login = await agent.post('/api/v1/auth/login').send({ email, password });
  expect(login.status).toBe(200);
  return agent;
}

beforeAll(async () => {
  await setup();
  admin = await loginAdmin();

  const created = await admin.post('/api/v1/projects').send({
    name: `Permissoes Teste ${Date.now()}`,
    description: 'Projeto criado nos testes',
  });
  expect(created.status).toBe(201);
  projectId = created.body.id;

  const card = await admin
    .post(`/api/v1/projects/${projectId}/cards`)
    .send({ title: 'Card de permissoes' });
  expect(card.status).toBe(201);
  cardId = card.body.id;

  const homeProfile = await admin.post('/api/v1/profiles').send({
    name: `Perfil Home ${Date.now()}`,
    screens: ['home'],
    permissions: ['home.registrar_calendario'],
  });
  expect(homeProfile.status).toBe(201);
  homeProfileId = homeProfile.body.id;

  const kanbanProfile = await admin.post('/api/v1/profiles').send({
    name: `Perfil Kanban Somente Leitura ${Date.now()}`,
    screens: ['kanban'],
    permissions: ['kanban.visualizar'],
  });
  expect(kanbanProfile.status).toBe(201);
  kanbanProfileId = kanbanProfile.body.id;

  const settingsProfile = await admin.post('/api/v1/profiles').send({
    name: `Perfil Somente Niveis ${Date.now()}`,
    screens: ['settings'],
    permissions: ['settings.niveis.novo'],
  });
  expect(settingsProfile.status).toBe(201);
  settingsProfileId = settingsProfile.body.id;

  homeUser = await createMemberUser(homeProfileId, 'perm-home', [projectId]);
  kanbanUser = await createMemberUser(kanbanProfileId, 'perm-kanban', [projectId]);
  settingsUser = await createMemberUser(settingsProfileId, 'perm-settings', [projectId]);
});

afterAll(async () => {
  await dropProject(projectId);
  await pool.end();
});

describe('Enforcement de permissoes nas rotas da API', () => {
  it('bloqueia POST /projects sem home.novo_projeto', async () => {
    const res = await homeUser.post('/api/v1/projects').send({ name: 'Projeto Bloqueado' });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('não tem permissão');

    const adminRes = await admin.post('/api/v1/projects').send({
      name: `Projeto Admin ${Date.now()}`,
      description: 'Projeto criado nos testes',
    });
    expect(adminRes.status).toBe(201);
    await dropProject(adminRes.body.id);
  });

  it('bloqueia POST /milestones sem home.registrar_agenda', async () => {
    const res = await homeUser
      .post(`/api/v1/projects/${projectId}/milestones`)
      .send({ name: 'Marco bloqueado', due_date: '2026-12-31' });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('não tem permissão');

    const ok = await admin
      .post(`/api/v1/projects/${projectId}/milestones`)
      .send({ name: 'Marco admin', due_date: '2026-12-31' });
    expect(ok.status).toBe(201);
  });

  it('bloqueia GET /projects/base-template sem home.baixar_planilha_modelo', async () => {
    const res = await homeUser.get('/api/v1/projects/base-template');
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('não tem permissão');

    const adminRes = await admin.get('/api/v1/projects/base-template');
    expect(adminRes.status).toBe(200);
  });

  it('permite leitura de cards e bloqueia criar, editar e excluir', async () => {
    const list = await kanbanUser.get(`/api/v1/projects/${projectId}/cards`);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);

    const create = await kanbanUser
      .post(`/api/v1/projects/${projectId}/cards`)
      .send({ title: 'Card bloqueado' });
    expect(create.status).toBe(403);
    expect(create.body.error.message).toContain('não tem permissão');

    const patch = await kanbanUser
      .patch(`/api/v1/projects/${projectId}/cards/${cardId}`)
      .send({ title: 'Titulo alterado' });
    expect(patch.status).toBe(403);
    expect(patch.body.error.message).toContain('não tem permissão');

    const remove = await kanbanUser.delete(`/api/v1/projects/${projectId}/cards/${cardId}`);
    expect(remove.status).toBe(403);
    expect(remove.body.error.message).toContain('não tem permissão');
  });

  it('permite criar perfil com settings.niveis.novo e bloqueia editar, excluir e convidar', async () => {
    const created = await settingsUser.post('/api/v1/profiles').send({
      name: `Perfil Criado Pelo Limitado ${Date.now()}`,
      screens: ['dashboard'],
    });
    expect(created.status).toBe(201);

    const edit = await settingsUser.put(`/api/v1/profiles/${created.body.id}`).send({
      description: 'tentativa de edicao',
    });
    expect(edit.status).toBe(403);
    expect(edit.body.error.message).toContain('não tem permissão');

    const remove = await settingsUser.delete(`/api/v1/profiles/${created.body.id}`);
    expect(remove.status).toBe(403);
    expect(remove.body.error.message).toContain('não tem permissão');

    const invite = await settingsUser.post('/api/v1/auth/invite').send({
      email: uniqueEmail('perm-invite-block'),
      profile_id: homeProfileId,
      project_ids: [],
    });
    expect(invite.status).toBe(403);
    expect(invite.body.error.message).toContain('não tem permissão');

    const adminRemove = await admin.delete(`/api/v1/profiles/${created.body.id}`);
    expect(adminRemove.status).toBe(204);
  });

  it('lista de usuarios exige regra de niveis de acesso e PATCH exige permissao', async () => {
    const list = await settingsUser.get('/api/v1/users');
    expect(list.status).toBe(403);
    expect(list.body.error.message).toContain('não tem permissão');

    const patch = await settingsUser
      .patch(`/api/v1/users/${randomUUID()}`)
      .send({ name: 'Nome alterado' });
    expect(patch.status).toBe(403);
    expect(patch.body.error.message).toContain('não tem permissão');
  });

  it('lista de usuarios atende quem pode criar projeto (selecao de membros)', async () => {
    const profile = await admin.post('/api/v1/profiles').send({
      name: `Perfil Criar Projeto ${Date.now()}`,
      screens: ['home'],
      permissions: ['home.novo_projeto'],
    });
    expect(profile.status).toBe(201);

    const creator = await createMemberUser(profile.body.id, 'perm-creator', []);
    const list = await creator.get('/api/v1/users');
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
  });

  it('bloqueia CRUD de cargos sem settings.cargos.*', async () => {
    const create = await settingsUser.post('/api/v1/roles').send({
      name: `Cargo Bloqueado ${Date.now()}`,
      profile_id: homeProfileId,
    });
    expect(create.status).toBe(403);
    expect(create.body.error.message).toContain('não tem permissão');

    const list = await settingsUser.get('/api/v1/roles');
    expect(list.status).toBe(403);
    expect(list.body.error.message).toContain('não tem permissão');
  });

  it('leitura de niveis de acesso funciona para quem tem settings.niveis.novo', async () => {
    const list = await settingsUser.get('/api/v1/profiles');
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
  });

  it('admin mantem acesso total as acoes', async () => {
    const cards = await admin.get(`/api/v1/projects/${projectId}/cards`);
    expect(cards.status).toBe(200);

    const created = await admin
      .post(`/api/v1/projects/${projectId}/cards`)
      .send({ title: 'Card do admin' });
    expect(created.status).toBe(201);

    const removed = await admin.delete(
      `/api/v1/projects/${projectId}/cards/${created.body.id}`,
    );
    expect(removed.status).toBe(204);

    const profiles = await admin.get('/api/v1/profiles');
    expect(profiles.status).toBe(200);
    expect(Array.isArray(profiles.body)).toBe(true);
  });
});
