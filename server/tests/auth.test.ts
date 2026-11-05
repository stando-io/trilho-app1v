import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, setup, uniqueEmail } from './helpers.js';

const app = createApp();

beforeAll(async () => {
  await setup();
});

afterAll(async () => {
  await pool.end();
});

describe('autenticacao', () => {
  it('rejeita acesso nao autenticado em /me', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('rejeita login com senha errada', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: ADMIN_EMAIL, password: 'senha-errada-123' });
    expect(res.status).toBe(401);
  });

  it('faz login e retorna dados do usuario', async () => {
    const agent = request.agent(app);
    const login = await agent
      .post('/api/v1/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.email).toBe(ADMIN_EMAIL);
    expect(login.body.profile.screens).toContain('settings');

    const me = await agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(login.body.id);
  });

  it('faz logout e invalida a sessao', async () => {
    const agent = request.agent(app);
    await agent.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const out = await agent.post('/api/v1/auth/logout');
    expect(out.status).toBe(204);
    const me = await agent.get('/api/v1/auth/me');
    expect(me.status).toBe(401);
  });
});

describe('convite e cadastro', () => {
  it('admin cria convite, novo usuario aceita e loga', async () => {
    const admin = request.agent(app);
    await admin.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const profileRes = await admin.post('/api/v1/profiles').send({
      name: `Visitante ${Date.now()}`,
      description: 'So dashboard',
      screens: ['dashboard'],
    });
    expect(profileRes.status).toBe(201);

    const email = uniqueEmail('convite');
    const invite = await admin.post('/api/v1/auth/invite').send({
      email,
      profile_id: profileRes.body.id,
      project_ids: [],
    });
    expect(invite.status).toBe(201);
    expect(invite.body.invite_url).toContain('/convite/');

    const token = String(invite.body.invite_url).split('/convite/')[1];
    const accept = await request(app)
      .post('/api/v1/auth/accept-invite')
      .send({ token, name: 'Usuario Convidado', password: 'senha-do-convite-123' });
    expect(accept.status).toBe(201);
    expect(accept.body.profile.screens).toEqual(['dashboard']);
    expect(accept.body.projects).toEqual([]);

    const novo = request.agent(app);
    const login = await novo
      .post('/api/v1/auth/login')
      .send({ email, password: 'senha-do-convite-123' });
    expect(login.status).toBe(200);
    expect(login.body.name).toBe('Usuario Convidado');
  });

  it('rejeita convite expirado ou invalido', async () => {
    const res = await request(app)
      .post('/api/v1/auth/accept-invite')
      .send({ token: 'token-inexistente', name: 'X', password: 'senha-qualquer-123' });
    expect(res.status).toBe(400);
  });
});

describe('redefinicao de senha', () => {
  it('admin gera link, usuario redefini e loga com a nova senha', async () => {
    const admin = request.agent(app);
    await admin.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const users = await admin.get('/api/v1/users');
    expect(users.status).toBe(200);
    const target = users.body.find((u: { email: string }) => u.email === ADMIN_EMAIL);
    expect(target).toBeTruthy();

    const link = await admin.post(`/api/v1/auth/users/${target.id}/reset-link`);
    expect(link.status).toBe(201);

    const token = String(link.body.reset_url).split('/redefinir/')[1];
    const reset = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'senha-nova-do-teste-123' });
    expect(reset.status).toBe(204);

    const comNova = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: ADMIN_EMAIL, password: 'senha-nova-do-teste-123' });
    expect(comNova.status).toBe(200);

    const comAntiga = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(comAntiga.status).toBe(401);

    const reuso = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'outra-senha-123456' });
    expect(reuso.status).toBe(400);

    const novaAindaFunciona = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: ADMIN_EMAIL, password: 'senha-nova-do-teste-123' });
    expect(novaAindaFunciona.status).toBe(200);
  });
});

describe('minha conta', () => {
  beforeAll(async () => {
    await setup();
  });

  async function createAccount(): Promise<{ agent: ReturnType<typeof request.agent>; email: string }> {
    const admin = request.agent(app);
    await admin.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const profileRes = await admin.post('/api/v1/profiles').send({
      name: `Conta ${Date.now()}`,
      description: 'Para testes de minha conta',
      screens: ['dashboard', 'settings'],
    });
    expect(profileRes.status).toBe(201);

    const email = uniqueEmail('conta');
    const invite = await admin.post('/api/v1/auth/invite').send({
      email,
      profile_id: profileRes.body.id,
      project_ids: [],
    });
    expect(invite.status).toBe(201);

    const token = String(invite.body.invite_url).split('/convite/')[1];
    const agent = request.agent(app);
    const accept = await agent.post('/api/v1/auth/accept-invite').send({
      token,
      name: 'Usuario Conta',
      password: 'senha-da-conta-123',
    });
    expect(accept.status).toBe(201);

    return { agent, email };
  }

  it('rejeita alteracoes na conta sem sessao', async () => {
    const patch = await request(app).patch('/api/v1/auth/me').send({ name: 'Qualquer Nome' });
    expect(patch.status).toBe(401);

    const post = await request(app)
      .post('/api/v1/auth/change-password')
      .send({ current_password: 'senha-qualquer-123', password: 'senha-nova-123456' });
    expect(post.status).toBe(401);
  });

  it('atualiza nome, avatar_color e avatar_text_color e reflete no /me', async () => {
    const { agent } = await createAccount();

    const res = await agent
      .patch('/api/v1/auth/me')
      .send({ name: 'Nome Editado', avatar_color: '#12ab90', avatar_text_color: '#ffffff' });
    expect(res.status).toBe(204);

    const me = await agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.name).toBe('Nome Editado');
    expect(me.body.avatar_color).toBe('#12ab90');
    expect(me.body.avatar_text_color).toBe('#ffffff');
    expect(me.body.role).toBeNull();
    expect(me.body.profile.screens).toContain('settings');
  });

  it('limpa as cores do avatar quando enviadas como null', async () => {
    const { agent } = await createAccount();
    await agent
      .patch('/api/v1/auth/me')
      .send({ avatar_color: '#12ab90', avatar_text_color: '#ffffff' });

    const limpa = await agent
      .patch('/api/v1/auth/me')
      .send({ avatar_color: null, avatar_text_color: null });
    expect(limpa.status).toBe(204);

    const me = await agent.get('/api/v1/auth/me');
    expect(me.body.avatar_color).toBeNull();
    expect(me.body.avatar_text_color).toBeNull();
  });

  it('rejeita nome curto, cor invalida e payload vazio', async () => {
    const { agent } = await createAccount();

    const nome = await agent.patch('/api/v1/auth/me').send({ name: 'A' });
    expect(nome.status).toBe(400);

    const cor = await agent.patch('/api/v1/auth/me').send({ avatar_color: 'vermelho' });
    expect(cor.status).toBe(400);

    const corTexto = await agent.patch('/api/v1/auth/me').send({ avatar_text_color: 'branco' });
    expect(corTexto.status).toBe(400);

    const vazio = await agent.patch('/api/v1/auth/me').send({});
    expect(vazio.status).toBe(400);
  });

  it('troca a propria senha exigindo a senha atual', async () => {
    const { agent, email } = await createAccount();

    const semAtual = await agent
      .post('/api/v1/auth/change-password')
      .send({ password: 'senha-trocada-456' });
    expect(semAtual.status).toBe(400);

    const atualErrada = await agent
      .post('/api/v1/auth/change-password')
      .send({ current_password: 'senha-errada-999', password: 'senha-trocada-456' });
    expect(atualErrada.status).toBe(401);

    const curta = await agent
      .post('/api/v1/auth/change-password')
      .send({ current_password: 'senha-da-conta-123', password: '123' });
    expect(curta.status).toBe(400);

    const troca = await agent
      .post('/api/v1/auth/change-password')
      .send({ current_password: 'senha-da-conta-123', password: 'senha-trocada-456' });
    expect(troca.status).toBe(204);

    const comAntiga = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'senha-da-conta-123' });
    expect(comAntiga.status).toBe(401);

    const comNova = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'senha-trocada-456' });
    expect(comNova.status).toBe(200);
  });
});
