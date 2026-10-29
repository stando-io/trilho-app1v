import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool, queryOne } from '../src/db/pool.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, setup, uniqueEmail } from './helpers.js';

const app = createApp();
const admin = request.agent(app);

const stamp = Date.now();
const testEmail = uniqueEmail('roles-user');
let adminProfileId = '';
let altProfileId = '';
let altProfileName = '';
let roleId = '';
let secondRoleId = '';
let invitedUserId = '';

async function getUserRow(email: string) {
  const res = await admin.get('/api/v1/users');
  expect(res.status).toBe(200);
  return res.body.find((item: { email: string }) => item.email === email);
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

  const other = await admin.post('/api/v1/profiles').send({
    name: `Nivel Roles ${stamp}`,
    description: 'Nivel de teste de cargos',
    screens: ['dashboard'],
  });
  expect(other.status).toBe(201);
  altProfileId = other.body.id;
  altProfileName = other.body.name;
});

afterAll(async () => {
  await pool.query(
    'UPDATE audit_logs SET user_id = NULL WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)',
    ['roles-user-%'],
  );
  await pool.query('DELETE FROM invitations WHERE email LIKE $1', ['roles-user-%']);
  await pool.query('DELETE FROM users WHERE email LIKE $1', ['roles-user-%']);
  await pool.query('DELETE FROM roles WHERE name LIKE $1', ['Cargo teste %']);
  await pool.query('DELETE FROM profiles WHERE name LIKE $1', ['Nivel Roles %']);
  await pool.end();
});

describe('cargos', () => {
  it('exige sessao para listar e criar', async () => {
    const list = await request(app).get('/api/v1/roles');
    expect(list.status).toBe(401);

    const create = await request(app).post('/api/v1/roles').send({ name: 'Sem sessao' });
    expect(create.status).toBe(401);
  });

  it('cria cargo vinculado a um nivel de acesso', async () => {
    const res = await admin.post('/api/v1/roles').send({
      name: `Cargo teste Operacoes ${stamp}`,
      description: 'Cargo de teste',
      profile_id: altProfileId,
    });
    expect(res.status).toBe(201);
    expect(res.body.profile_id).toBe(altProfileId);
    roleId = res.body.id;
  });

  it('valida nome, nivel e existencia do nivel', async () => {
    const short = await admin.post('/api/v1/roles').send({ name: 'a', profile_id: altProfileId });
    expect(short.status).toBe(400);

    const missing = await admin
      .post('/api/v1/roles')
      .send({ name: 'Cargo teste Sem Nivel', profile_id: '00000000-0000-4000-8000-000000000000' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.message).toBe('Nível de acesso inexistente');
  });

  it('rejeita nome de cargo duplicado', async () => {
    const res = await admin.post('/api/v1/roles').send({
      name: `Cargo teste Operacoes ${stamp}`,
      profile_id: altProfileId,
    });
    expect(res.status).toBe(409);
  });

  it('lista cargos com nivel, contagem e ordenacao', async () => {
    const res = await admin.get('/api/v1/roles');
    expect(res.status).toBe(200);
    const row = res.body.find((item: { id: string }) => item.id === roleId);
    expect(row).toBeTruthy();
    expect(row.profile_name).toBe(altProfileName);
    expect(row.users_count).toBe(0);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('renomeia cargo e rejeita duplicidade na atualizacao', async () => {
    const second = await admin.post('/api/v1/roles').send({
      name: `Cargo teste Apoio ${stamp}`,
      profile_id: adminProfileId,
    });
    expect(second.status).toBe(201);
    secondRoleId = second.body.id;

    const rename = await admin
      .put(`/api/v1/roles/${roleId}`)
      .send({ name: `Cargo teste Operacoes 2 ${stamp}` });
    expect(rename.status).toBe(200);
    expect(rename.body.name).toBe(`Cargo teste Operacoes 2 ${stamp}`);

    const duplicate = await admin
      .put(`/api/v1/roles/${roleId}`)
      .send({ name: `Cargo teste Apoio ${stamp}` });
    expect(duplicate.status).toBe(409);
  });

  it('convite com cargo cria usuario com nivel herdado', async () => {
    const invite = await admin
      .post('/api/v1/auth/invite')
      .send({ email: testEmail, role_id: roleId });
    expect(invite.status).toBe(201);

    const token = String(invite.body.invite_url).split('/convite/')[1];
    const accept = await request(app).post('/api/v1/auth/accept-invite').send({
      token,
      name: 'Usuario Roles',
      password: 'senha-teste-123',
    });
    expect(accept.status).toBe(201);

    const row = await getUserRow(testEmail);
    expect(row).toBeTruthy();
    expect(row.role_id).toBe(roleId);
    expect(row.role_name).toBe(`Cargo teste Operacoes 2 ${stamp}`);
    expect(row.profile_name).toBe(altProfileName);
    invitedUserId = row.id;
  });

  it('convite sem cargo nem nivel e com cargo inexistente sao rejeitados', async () => {
    const without = await admin.post('/api/v1/auth/invite').send({ email: uniqueEmail('roles') });
    expect(without.status).toBe(400);

    const badRole = await admin.post('/api/v1/auth/invite').send({
      email: uniqueEmail('roles'),
      role_id: '00000000-0000-4000-8000-000000000000',
    });
    expect(badRole.status).toBe(400);
    expect(badRole.body.error.message).toBe('Cargo inexistente');
  });

  it('trocar o nivel do cargo propaga para os usuarios do cargo', async () => {
    const change = await admin
      .put(`/api/v1/roles/${roleId}`)
      .send({ profile_id: adminProfileId });
    expect(change.status).toBe(200);

    let row = await getUserRow(testEmail);
    expect(row.profile_name).toBe('Admin Teste');

    const back = await admin.put(`/api/v1/roles/${roleId}`).send({ profile_id: altProfileId });
    expect(back.status).toBe(200);

    row = await getUserRow(testEmail);
    expect(row.profile_name).toBe(altProfileName);
  });

  it('alterar o cargo do usuario pelo PATCH herda o nivel do novo cargo', async () => {
    const clear = await admin
      .patch(`/api/v1/users/${invitedUserId}`)
      .send({ role_id: null });
    expect(clear.status).toBe(204);

    let row = await getUserRow(testEmail);
    expect(row.role_id).toBeNull();
    expect(row.profile_name).toBe(altProfileName);

    const assign = await admin.patch(`/api/v1/users/${invitedUserId}`).send({ role_id: roleId });
    expect(assign.status).toBe(204);

    row = await getUserRow(testEmail);
    expect(row.role_id).toBe(roleId);
    expect(row.role_name).toBe(`Cargo teste Operacoes 2 ${stamp}`);
    expect(row.profile_name).toBe(altProfileName);
  });

  it('bloqueia exclusao de cargo em uso e de cargo inexistente', async () => {
    const inUse = await admin.delete(`/api/v1/roles/${roleId}`);
    expect(inUse.status).toBe(409);
    expect(inUse.body.error.message).toContain('Cargo em uso');

    const missing = await admin.delete('/api/v1/roles/00000000-0000-4000-8000-000000000000');
    expect(missing.status).toBe(404);
  });

  it('limpa o cargo do usuario e exclui os cargos de teste', async () => {
    const clear = await admin
      .patch(`/api/v1/users/${invitedUserId}`)
      .send({ role_id: null });
    expect(clear.status).toBe(204);

    const first = await admin.delete(`/api/v1/roles/${roleId}`);
    expect(first.status).toBe(204);

    const second = await admin.delete(`/api/v1/roles/${secondRoleId}`);
    expect(second.status).toBe(204);
  });

  it('audita criacao, atualizacao e exclusao de cargos', async () => {
    const created = await queryOne<{ action: string; entity: string }>(
      `SELECT action, entity FROM audit_logs
       WHERE action = 'role_created' AND entity_id = $1`,
      [roleId],
    );
    expect(created?.action).toBe('role_created');
    expect(created?.entity).toBe('role');

    const updated = await queryOne<{ action: string }>(
      `SELECT action FROM audit_logs
       WHERE action = 'role_updated' AND entity_id = $1`,
      [roleId],
    );
    expect(updated?.action).toBe('role_updated');

    const deleted = await queryOne<{ action: string }>(
      `SELECT action FROM audit_logs
       WHERE action = 'role_deleted' AND entity_id = $1`,
      [roleId],
    );
    expect(deleted?.action).toBe('role_deleted');
  });
});
