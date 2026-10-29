import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool, queryOne } from '../src/db/pool.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, setup, uniqueEmail } from './helpers.js';

const app = createApp();
const admin = request.agent(app);
const outsider = request.agent(app);

const stamp = Date.now();
const targetEmail = uniqueEmail('userdel');
const limitedEmail = uniqueEmail('limited');
let targetUserId = '';
let limitedProfileId = '';
let adminProfileId = '';

async function getUserRow(email: string) {
  const res = await admin.get('/api/v1/users');
  expect(res.status).toBe(200);
  return res.body.find((item: { email: string }) => item.email === email);
}

async function acceptInvite(email: string, name: string, password: string) {
  const invite = await admin.post('/api/v1/auth/invite').send({ email, profile_id: adminProfileId });
  expect(invite.status).toBe(201);
  const token = String(invite.body.invite_url).split('/convite/')[1];
  const accept = await request(app).post('/api/v1/auth/accept-invite').send({
    token,
    name,
    password,
  });
  expect(accept.status).toBe(201);
}

beforeAll(async () => {
  await setup();
  const login = await admin
    .post('/api/v1/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  expect(login.status).toBe(200);

  const adminProfile = await queryOne<{ id: string }>(
    `SELECT id FROM profiles WHERE name = 'Admin Teste'`,
  );
  adminProfileId = adminProfile!.id;

  const limitedProfile = await admin.post('/api/v1/profiles').send({
    name: `Nivel Users C ${stamp}`,
    description: 'Perfil sem tela de configuracoes',
    screens: ['dashboard'],
  });
  expect(limitedProfile.status).toBe(201);
  limitedProfileId = limitedProfile.body.id;

  await acceptInvite(targetEmail, 'Usuario Excluivel', 'senha-userdel-123');
  const row = await getUserRow(targetEmail);
  expect(row).toBeTruthy();
  targetUserId = row.id;
});

afterAll(async () => {
  await pool.query('UPDATE audit_logs SET user_id = NULL WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)', [
    'userdel-%',
  ]);
  await pool.query('DELETE FROM invitations WHERE email LIKE $1', ['userdel-%']);
  await pool.query('DELETE FROM invitations WHERE email LIKE $1', ['limited-%']);
  await pool.query('DELETE FROM users WHERE email LIKE $1', ['userdel-%']);
  await pool.query('DELETE FROM users WHERE email LIKE $1', ['limited-%']);
  await pool.query('DELETE FROM profiles WHERE name LIKE $1', ['Nivel Users C %']);
  await pool.end();
});

describe('gestao de usuarios', () => {
  it('exige sessao para listar e excluir', async () => {
    const list = await request(app).get('/api/v1/users');
    expect(list.status).toBe(401);

    const remove = await request(app).delete('/api/v1/users/00000000-0000-4000-8000-000000000000');
    expect(remove.status).toBe(401);
  });

  it('proibe excluir o proprio usuario', async () => {
    const me = await getUserRow(ADMIN_EMAIL);
    const res = await admin.delete(`/api/v1/users/${me.id}`);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('próprio usuário');
  });

  it('atualiza projetos do usuario via PATCH project_ids', async () => {
    const projects = await admin.get('/api/v1/projects');
    expect(projects.status).toBe(200);
    if (projects.body.length > 0) {
      const projectId = projects.body[0].id;
      const assign = await admin
        .patch(`/api/v1/users/${targetUserId}`)
        .send({ project_ids: [projectId] });
      expect(assign.status).toBe(204);

      const row = await getUserRow(targetEmail);
      expect(row.project_ids).toContain(projectId);

      const clear = await admin.patch(`/api/v1/users/${targetUserId}`).send({ project_ids: [] });
      expect(clear.status).toBe(204);

      const after = await getUserRow(targetEmail);
      expect(after.project_ids).toEqual([]);
    }
  });

  it('atualiza email do usuario via PATCH email', async () => {
    const newEmail = uniqueEmail('usermail');
    const update = await admin
      .patch(`/api/v1/users/${targetUserId}`)
      .send({ email: newEmail });
    expect(update.status).toBe(204);

    const row = await getUserRow(newEmail);
    expect(row).toBeTruthy();
    expect(row.id).toBe(targetUserId);
  });

  it('retorna 409 ao editar email para o de outro usuario', async () => {
    const res = await admin
      .patch(`/api/v1/users/${targetUserId}`)
      .send({ email: ADMIN_EMAIL });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('este e-mail');
  });

  it('define senha de outro usuario via set-password e permite login', async () => {
    const newPassword = 'senha-nova-setpw-123';
    const res = await admin
      .post(`/api/v1/users/${targetUserId}/set-password`)
      .send({ password: newPassword });
    expect(res.status).toBe(204);

    const list = await admin.get('/api/v1/users');
    const row = list.body.find((item: { id: string }) => item.id === targetUserId);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: row.email, password: newPassword });
    expect(login.status).toBe(200);
  });

  it('proibe definir a propria senha via set-password', async () => {
    const me = await getUserRow(ADMIN_EMAIL);
    const res = await admin
      .post(`/api/v1/users/${me.id}/set-password`)
      .send({ password: 'senha-proppria-123' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('própria senha');
  });

  it('rejeita set-password com senha curta', async () => {
    const res = await admin
      .post(`/api/v1/users/${targetUserId}/set-password`)
      .send({ password: 'curta' });
    expect(res.status).toBe(400);
  });

  it('retorna 404 ao definir senha de usuario inexistente', async () => {
    const res = await admin
      .post('/api/v1/users/00000000-0000-4000-8000-000000000000/set-password')
      .send({ password: 'senha-inexistente-123' });
    expect(res.status).toBe(404);
  });

  it('lista todos os projetos com ?all=1 apenas para quem tem a tela settings', async () => {
    const plain = await admin.get('/api/v1/projects');
    const all = await admin.get('/api/v1/projects?all=1');
    expect(all.status).toBe(200);
    const plainIds = plain.body.map((item: { id: string }) => item.id);
    const allIds = all.body.map((item: { id: string }) => item.id);
    for (const id of plainIds) expect(allIds).toContain(id);

    const limitedInvite = await admin
      .post('/api/v1/auth/invite')
      .send({ email: limitedEmail, profile_id: limitedProfileId });
    expect(limitedInvite.status).toBe(201);
    const token = String(limitedInvite.body.invite_url).split('/convite/')[1];
    const accept = await request(app).post('/api/v1/auth/accept-invite').send({
      token,
      name: 'Usuario Limitado',
      password: 'senha-limited-123456',
    });
    expect(accept.status).toBe(201);

    const login = await outsider
      .post('/api/v1/auth/login')
      .send({ email: limitedEmail, password: 'senha-limited-123456' });
    expect(login.status).toBe(200);

    const limitedPlain = await outsider.get('/api/v1/projects');
    const limitedAll = await outsider.get('/api/v1/projects?all=1');
    expect(limitedAll.status).toBe(200);
    expect(limitedAll.body).toEqual(limitedPlain.body);
  });

  it('exclui usuario, remove da lista e audita', async () => {
    const remove = await admin.delete(`/api/v1/users/${targetUserId}`);
    expect(remove.status).toBe(204);

    const row = await getUserRow(targetEmail);
    expect(row).toBeUndefined();

    const auditRow = await queryOne<{ action: string; entity: string }>(
      `SELECT action, entity FROM audit_logs WHERE action = 'user_deleted' AND entity_id = $1`,
      [targetUserId],
    );
    expect(auditRow?.action).toBe('user_deleted');
    expect(auditRow?.entity).toBe('user');
  });

  it('retorna 404 ao excluir usuario inexistente', async () => {
    const res = await admin.delete('/api/v1/users/00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
  });
});
