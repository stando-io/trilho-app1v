import { hash } from '@node-rs/argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool, queryOne } from '../src/db/pool.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, dropProject, setup, uniqueEmail } from './helpers.js';

const app = createApp();

let agent: ReturnType<typeof request.agent>;
let visitorAgent: ReturnType<typeof request.agent>;
let visitorEmail = '';
let projectId = '';
let milestoneId = '';

beforeAll(async () => {
  await setup();

  agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const created = await agent
    .post('/api/v1/projects')
    .send({ name: `Marcos Teste ${Date.now()}`, description: 'Projeto criado nos testes' });
  expect(created.status).toBe(201);
  projectId = created.body.id;

  const profile = await queryOne<{ id: string }>(
    `INSERT INTO profiles (name, description, screens)
     VALUES ($1, 'Perfil de teste para marcos', $2::jsonb)
     RETURNING id`,
    [`Visitante Marcos ${Date.now()}`, JSON.stringify(['dashboard'])],
  );
  if (!profile) throw new Error('Falha ao criar perfil de teste');
  const passwordHash = await hash(ADMIN_PASSWORD);
  visitorEmail = uniqueEmail('visitante-marcos');
  const visitor = await queryOne<{ id: string }>(
    `INSERT INTO users (name, email, password_hash, profile_id, is_active)
     VALUES ('Visitante Marcos', $1, $2, $3, true)
     RETURNING id`,
    [visitorEmail, passwordHash, profile.id],
  );
  if (!visitor) throw new Error('Falha ao criar visitante');
  await pool.query(
    'INSERT INTO project_members (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [projectId, visitor.id],
  );
  visitorAgent = request.agent(app);
  await visitorAgent
    .post('/api/v1/auth/login')
    .send({ email: visitorEmail, password: ADMIN_PASSWORD });
});

afterAll(async () => {
  if (projectId) await dropProject(projectId);
  await pool.end();
});

describe('Marcos: CRUD', () => {
  it('cria marco com descricao e lista', async () => {
    const created = await agent
      .post(`/api/v1/projects/${projectId}/milestones`)
      .send({
        name: 'Kickoff executivo',
        due_date: '2027-03-15',
        description: 'Reunião de abertura com stakeholders',
      });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('Kickoff executivo');
    expect(created.body.due_date).toBe('2027-03-15');
    expect(created.body.description).toBe('Reunião de abertura com stakeholders');
    milestoneId = created.body.id;

    const list = await agent.get(`/api/v1/projects/${projectId}/milestones`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(milestoneId);
    expect(list.body[0].description).toBe('Reunião de abertura com stakeholders');
  });

  it('rejeita descricao longa', async () => {
    const res = await agent
      .post(`/api/v1/projects/${projectId}/milestones`)
      .send({ name: 'Descricao gigante', due_date: '2027-02-01', description: 'x'.repeat(501) });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Descrição muito longa/i);
  });

  it('rejeita data inexistente', async () => {
    const res = await agent
      .post(`/api/v1/projects/${projectId}/milestones`)
      .send({ name: 'Data quebrada', due_date: '2026-13-99' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Data inválida/i);
  });

  it('rejeita nome curto', async () => {
    const res = await agent
      .post(`/api/v1/projects/${projectId}/milestones`)
      .send({ name: 'a', due_date: '2027-01-01' });
    expect(res.status).toBe(400);
  });

  it('atualiza nome e prazo', async () => {
    const res = await agent
      .patch(`/api/v1/projects/${projectId}/milestones/${milestoneId}`)
      .send({ name: 'Kickoff revisado', due_date: '2027-04-20' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Kickoff revisado');
    expect(res.body.due_date).toBe('2027-04-20');
    expect(res.body.description).toBe('Reunião de abertura com stakeholders');
  });

  it('atualiza apenas a descricao', async () => {
    const res = await agent
      .patch(`/api/v1/projects/${projectId}/milestones/${milestoneId}`)
      .send({ description: 'Nova descrição do kickoff' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Kickoff revisado');
    expect(res.body.due_date).toBe('2027-04-20');
    expect(res.body.description).toBe('Nova descrição do kickoff');
  });

  it('retorna 404 para marco inexistente e 400 para id invalido', async () => {
    const inexistente = await agent
      .patch(`/api/v1/projects/${projectId}/milestones/00000000-0000-4000-8000-000000000000`)
      .send({ name: 'Fantasma' });
    expect(inexistente.status).toBe(404);

    const invalido = await agent
      .patch(`/api/v1/projects/${projectId}/milestones/nao-e-uuid`)
      .send({ name: 'Invalido' });
    expect(invalido.status).toBe(400);
  });

  it('aparece no calendario do dashboard', async () => {
    const res = await agent.get(`/api/v1/projects/${projectId}/dashboard`);
    expect(res.status).toBe(200);
    const entry = res.body.calendar.find(
      (item: { kind: string; id: string }) => item.kind === 'milestone',
    );
    expect(entry).toBeTruthy();
    expect(entry.id).toBe(milestoneId);
    expect(entry.due_date).toBe('2027-04-20');
    expect(entry.description).toBe('Nova descrição do kickoff');
  });

  it('exclui marco', async () => {
    const res = await agent.delete(`/api/v1/projects/${projectId}/milestones/${milestoneId}`);
    expect(res.status).toBe(204);

    const list = await agent.get(`/api/v1/projects/${projectId}/milestones`);
    expect(list.body).toHaveLength(0);
  });
});

describe('Marcos: perfil visitante (somente dashboard)', () => {
  it('le a lista mas nao escreve', async () => {
    const leitura = await visitorAgent.get(`/api/v1/projects/${projectId}/milestones`);
    expect(leitura.status).toBe(200);
    expect(leitura.body).toHaveLength(0);

    const criacao = await visitorAgent
      .post(`/api/v1/projects/${projectId}/milestones`)
      .send({ name: 'Tentativa visitante', due_date: '2027-06-01' });
    expect(criacao.status).toBe(403);

    const edicao = await visitorAgent
      .patch(`/api/v1/projects/${projectId}/milestones/${milestoneId}`)
      .send({ name: 'Tentativa edicao' });
    expect(edicao.status).toBe(403);

    const exclusao = await visitorAgent.delete(
      `/api/v1/projects/${projectId}/milestones/${milestoneId}`,
    );
    expect(exclusao.status).toBe(403);
  });
});

describe('Marcos: exigencia de senha de segurança (Inicio)', () => {
  const SECURITY_HEADER = 'x-security-password';
  const SECURITY_PASSWORD = 'senha-agenda-123';
  let gateMilestoneId = '';

  afterAll(async () => {
    await pool.query(
      'UPDATE system_settings SET security_password_hash = NULL, security_password_hint = NULL',
    );
  });

  it('cria, edita e exclui apenas com senha quando a area Inicio esta protegida', async () => {
    const defined = await agent
      .put('/api/v1/settings/security-password')
      .send({ password: SECURITY_PASSWORD });
    expect(defined.status).toBe(200);

    const semSenha = await agent
      .post(`/api/v1/projects/${projectId}/milestones`)
      .send({ name: 'Gate agenda', due_date: '2027-07-01' });
    expect(semSenha.status).toBe(400);
    expect(semSenha.body.error.message).toContain('Senha de segurança');

    const comSenha = await agent
      .post(`/api/v1/projects/${projectId}/milestones`)
      .set(SECURITY_HEADER, SECURITY_PASSWORD)
      .send({ name: 'Gate agenda', due_date: '2027-07-01' });
    expect(comSenha.status).toBe(201);
    gateMilestoneId = comSenha.body.id;

    const editaSemSenha = await agent
      .patch(`/api/v1/projects/${projectId}/milestones/${gateMilestoneId}`)
      .send({ name: 'Gate agenda editado' });
    expect(editaSemSenha.status).toBe(400);

    const editaComSenha = await agent
      .patch(`/api/v1/projects/${projectId}/milestones/${gateMilestoneId}`)
      .set(SECURITY_HEADER, SECURITY_PASSWORD)
      .send({ name: 'Gate agenda editado' });
    expect(editaComSenha.status).toBe(200);

    const excluiSemSenha = await agent.delete(
      `/api/v1/projects/${projectId}/milestones/${gateMilestoneId}`,
    );
    expect(excluiSemSenha.status).toBe(400);

    const excluiComSenha = await agent
      .delete(`/api/v1/projects/${projectId}/milestones/${gateMilestoneId}`)
      .set(SECURITY_HEADER, SECURITY_PASSWORD);
    expect(excluiComSenha.status).toBe(204);

    await agent.delete('/api/v1/settings/security-password');
  });

  it('cria sem senha quando o gate da area Inicio esta desligado', async () => {
    const defined = await agent
      .put('/api/v1/settings/security-password')
      .send({ password: SECURITY_PASSWORD });
    expect(defined.status).toBe(200);

    const gateOff = await agent
      .patch('/api/v1/settings/security-password/gates')
      .send({ area: 'home', enabled: false });
    expect(gateOff.status).toBe(200);

    try {
      const semSenha = await agent
        .post(`/api/v1/projects/${projectId}/milestones`)
        .send({ name: 'Gate desligado', due_date: '2027-08-01' });
      expect(semSenha.status).toBe(201);

      const edita = await agent
        .patch(`/api/v1/projects/${projectId}/milestones/${semSenha.body.id}`)
        .send({ name: 'Gate desligado editado' });
      expect(edita.status).toBe(200);

      const exclui = await agent.delete(
        `/api/v1/projects/${projectId}/milestones/${semSenha.body.id}`,
      );
      expect(exclui.status).toBe(204);
    } finally {
      await agent
        .patch('/api/v1/settings/security-password/gates')
        .send({ area: 'home', enabled: true });
      await agent.delete('/api/v1/settings/security-password');
    }
  });
});
