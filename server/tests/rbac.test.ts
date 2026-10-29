import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, setup, uniqueEmail } from './helpers.js';

const app = createApp();

let limitedProfileId = '';
let limitedEmail = '';

beforeAll(async () => {
  await setup();

  const admin = request.agent(app);
  await admin.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const profileRes = await admin.post('/api/v1/profiles').send({
    name: `Perfil Dashboard ${Date.now()}`,
    description: 'Somente dashboard',
    screens: ['dashboard'],
  });
  limitedProfileId = profileRes.body.id;

  limitedEmail = uniqueEmail('rbac');
  const invite = await admin.post('/api/v1/auth/invite').send({
    email: limitedEmail,
    profile_id: limitedProfileId,
    project_ids: [],
  });
  const token = String(invite.body.invite_url).split('/convite/')[1];
  await request(app)
    .post('/api/v1/auth/accept-invite')
    .send({ token, name: 'Usuario Dashboard', password: 'senha-rbac-123456' });
});

afterAll(async () => {
  await pool.end();
});

describe('RBAC', () => {
  it('exige autenticacao para perfis', async () => {
    const res = await request(app).get('/api/v1/profiles');
    expect(res.status).toBe(401);
  });

  it('admin com tela de configuracoes acessa perfis', async () => {
    const admin = request.agent(app);
    await admin.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const res = await admin.get('/api/v1/profiles');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('usuario sem a tela de configuracoes nao lista niveis nem cargos', async () => {
    const user = request.agent(app);
    const login = await user
      .post('/api/v1/auth/login')
      .send({ email: limitedEmail, password: 'senha-rbac-123456' });
    expect(login.status).toBe(200);
    expect(login.body.profile.screens).toEqual(['dashboard']);

    const perfis = await user.get('/api/v1/profiles');
    expect(perfis.status).toBe(403);

    const cargos = await user.get('/api/v1/roles');
    expect(cargos.status).toBe(403);
  });

  it('usuario autenticado acessa seus projetos', async () => {
    const user = request.agent(app);
    await user.post('/api/v1/auth/login').send({ email: limitedEmail, password: 'senha-rbac-123456' });
    const res = await user.get('/api/v1/projects');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('perfis so aceitam telas validas', async () => {
    const admin = request.agent(app);
    await admin.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const res = await admin.post('/api/v1/profiles').send({
      name: `Perfil Invalido ${Date.now()}`,
      description: '',
      screens: ['tela-que-nao-existe'],
    });
    expect(res.status).toBe(400);
  });
});
