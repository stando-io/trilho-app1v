import { hash } from '@node-rs/argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool, queryOne } from '../src/db/pool.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, dropProject, setup, uniqueEmail } from './helpers.js';

const app = createApp();
const SECURITY_HEADER = 'x-security-password';
const SECURITY_PASSWORD = 'senha-dashboard-123';

let agent: ReturnType<typeof request.agent>;
let visitorAgent: ReturnType<typeof request.agent>;
let projectId = '';
let adminId = '';
let milestoneId = '';

async function createUserWithScreens(email: string, profileName: string, screens: string[]) {
  const profile = await queryOne<{ id: string }>(
    `INSERT INTO profiles (name, description, screens)
     VALUES ($1, 'Perfil de teste para dashboard', $2::jsonb)
     RETURNING id`,
    [profileName, JSON.stringify(screens)],
  );
  if (!profile) throw new Error('Falha ao criar perfil de teste');
  const passwordHash = await hash(ADMIN_PASSWORD);
  const user = await queryOne<{ id: string }>(
    `INSERT INTO users (name, email, password_hash, profile_id, is_active)
     VALUES ('Usuario Dashboard', $1, $2, $3, true)
     RETURNING id`,
    [email, passwordHash, profile.id],
  );
  if (!user) throw new Error('Falha ao criar usuario de teste');
  return user.id;
}

beforeAll(async () => {
  await setup();

  agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const created = await agent
    .post('/api/v1/projects')
    .send({ name: `Dashboard Teste ${Date.now()}`, description: 'Projeto criado nos testes' });
  expect(created.status).toBe(201);
  projectId = created.body.id;

  const me = await agent.get('/api/v1/auth/me');
  adminId = me.body.id;

  await agent
    .put(`/api/v1/settings/security-password`)
    .send({ password: SECURITY_PASSWORD });

  const operacoes = await agent
    .post(`/api/v1/projects/${projectId}/sectors`)
    .set(SECURITY_HEADER, SECURITY_PASSWORD)
    .send({ name: 'Operacoes' });
  expect(operacoes.status).toBe(201);
  await agent
    .post(`/api/v1/projects/${projectId}/sectors`)
    .set(SECURITY_HEADER, SECURITY_PASSWORD)
    .send({ name: 'Financeiro' });

  const departamento = await agent
    .post(`/api/v1/projects/${projectId}/departments`)
    .set(SECURITY_HEADER, SECURITY_PASSWORD)
    .send({ sector_id: operacoes.body.id, name: 'Faturamento' });
  expect(departamento.status).toBe(201);

  const columns = await agent.get(`/api/v1/projects/${projectId}/columns`);
  const novaSolicitacao = columns.body.find((column: { name: string }) => column.name === 'Nova Solicitacao');
  const concluido = columns.body.find((column: { name: string }) => column.name === 'Concluido');
  expect(novaSolicitacao).toBeTruthy();
  expect(concluido).toBeTruthy();

  const vencido = await agent.post(`/api/v1/projects/${projectId}/cards`).send({
    title: 'Fatura em atraso',
    department_id: departamento.body.id,
    due_date: '2020-01-01',
    column_id: novaSolicitacao.id,
  });
  expect(vencido.status).toBe(201);

  const concluidoCard = await agent.post(`/api/v1/projects/${projectId}/cards`).send({
    title: 'Cadastro concluido',
    responsible_id: adminId,
    column_id: novaSolicitacao.id,
  });
  expect(concluidoCard.status).toBe(201);
  const movido = await agent
    .patch(`/api/v1/projects/${projectId}/cards/${concluidoCard.body.id}`)
    .send({ column_id: concluido.id });
  expect(movido.status).toBe(200);

  await agent.post(`/api/v1/projects/${projectId}/cards`).send({
    title: 'Card sem dono',
    column_id: novaSolicitacao.id,
  });

  const milestone = await agent
    .post(`/api/v1/projects/${projectId}/milestones`)
    .set(SECURITY_HEADER, SECURITY_PASSWORD)
    .send({ name: 'Entrega parcial', due_date: '2030-05-10' });
  expect(milestone.status).toBe(201);
  milestoneId = milestone.body.id;

  const visitorEmail = uniqueEmail('visitante-dash');
  const visitorId = await createUserWithScreens(
    visitorEmail,
    `Visitante Dash ${Date.now()}`,
    ['dashboard'],
  );
  await pool.query(
    'INSERT INTO project_members (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [projectId, visitorId],
  );
  await pool.query(
    'INSERT INTO project_team (project_id, role, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [projectId, 'gerente_projeto', adminId],
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

describe('Dashboard: indicadores', () => {
  it('consolida total, pendentes, concluidos, atrasados e conclusao', async () => {
    const res = await agent.get(`/api/v1/projects/${projectId}/dashboard`);
    expect(res.status).toBe(200);
    expect(res.body.indicators).toEqual({
      total_cards: 3,
      pending_cards: 2,
      done_cards: 1,
      overdue_cards: 1,
      completion_percent: 33,
    });
  });

  it('expoe temperatura por setor com neutro para vazio', async () => {
    const res = await agent.get(`/api/v1/projects/${projectId}/dashboard`);
    const sectors: Array<{
      name: string;
      total_cards: number;
      completed_cards: number;
      overdue_cards: number;
      percent: number | null;
      tone: string;
    }> = res.body.sector_temperature;

    expect(sectors).toHaveLength(2);
    const operacoes = sectors.find((sector) => sector.name === 'Operacoes')!;
    expect(operacoes.total_cards).toBe(1);
    expect(operacoes.completed_cards).toBe(0);
    expect(operacoes.overdue_cards).toBe(1);
    expect(operacoes.percent).toBe(0);
    expect(operacoes.tone).toBe('low');

    const financeiro = sectors.find((sector) => sector.name === 'Financeiro')!;
    expect(financeiro.total_cards).toBe(0);
    expect(financeiro.percent).toBeNull();
    expect(financeiro.tone).toBe('neutral');
  });

  it('agrupa cards por coluna de status', async () => {
    const res = await agent.get(`/api/v1/projects/${projectId}/dashboard`);
    const statuses: Array<{ name: string; is_done: boolean; total: number }> = res.body.by_status;
    expect(statuses).toHaveLength(5);
    const nova = statuses.find((status) => status.name === 'Nova Solicitacao')!;
    expect(nova.total).toBe(2);
    expect(nova.is_done).toBe(false);
    const concluida = statuses.find((status) => status.name === 'Concluido')!;
    expect(concluida.total).toBe(1);
    expect(concluida.is_done).toBe(true);
  });

  it('lista responsaveis com nome e padrao sem responsavel', async () => {
    const res = await agent.get(`/api/v1/projects/${projectId}/dashboard`);
    const responsibles: Array<{
      responsible_id: string | null;
      name: string;
      total: number;
      done: number;
    }> = res.body.by_responsible;

    expect(responsibles[0].name).toBe('Sem responsável');
    expect(responsibles[0].responsible_id).toBeNull();
    expect(responsibles[0].total).toBe(2);
    const admin = responsibles.find((row) => row.responsible_id === adminId)!;
    expect(admin.name).toBe('Admin Teste');
    expect(admin.total).toBe(1);
    expect(admin.done).toBe(1);
  });

  it('expoe a equipe com papel no projeto', async () => {
    const res = await agent.get(`/api/v1/projects/${projectId}/dashboard`);
    const team: Array<{ name: string; project_role: string | null }> = res.body.team;
    expect(team).toHaveLength(2);
    expect(team.map((member) => member.name)).toContain('Admin Teste');
    expect(team.map((member) => member.name)).toContain('Usuario Dashboard');
    const admin = team.find((member) => member.name === 'Admin Teste')!;
    expect(admin.project_role).toBe('gerente_projeto');
    const visitor = team.find((member) => member.name === 'Usuario Dashboard')!;
    expect(visitor.project_role).toBeNull();
  });

  it('monta calendario com cards e marcos em ordem de prazo', async () => {
    const res = await agent.get(`/api/v1/projects/${projectId}/dashboard`);
    const calendar: Array<{ kind: string; id: string; name: string; due_date: string }> =
      res.body.calendar;

    expect(calendar).toHaveLength(2);
    expect(calendar[0].kind).toBe('card');
    expect(calendar[0].name).toBe('Fatura em atraso');
    expect(calendar[0].due_date).toBe('2020-01-01');
    expect(calendar[1].kind).toBe('milestone');
    expect(calendar[1].id).toBe(milestoneId);
    expect(calendar[1].due_date).toBe('2030-05-10');
  });
});

describe('Dashboard: evolucao semanal', () => {
  it('projeto criado hoje sem prazo gera apenas o ponto Atual', async () => {
    const created = await agent
      .post('/api/v1/projects')
      .send({ name: `Evo Atual ${Date.now()}`, description: 'Projeto criado nos testes' });
    expect(created.status).toBe(201);

    const res = await agent.get(`/api/v1/projects/${created.body.id}/dashboard`);
    expect(res.status).toBe(200);
    expect(res.body.weekly_evolution).toEqual([{ label: 'Atual', percent: 0 }]);
    await dropProject(created.body.id);
  });

  it('projeto sem prazo conta semanas a partir da criacao', async () => {
    const created = await agent
      .post('/api/v1/projects')
      .send({ name: `Evo Criacao ${Date.now()}`, description: 'Projeto criado nos testes' });
    expect(created.status).toBe(201);
    await pool.query("UPDATE projects SET created_at = now() - interval '10 days' WHERE id = $1", [
      created.body.id,
    ]);

    const res = await agent.get(`/api/v1/projects/${created.body.id}/dashboard`);
    expect(res.status).toBe(200);
    expect(res.body.weekly_evolution).toEqual([
      { label: 'Sem 1', percent: 0 },
      { label: 'Atual', percent: 0 },
    ]);
    await dropProject(created.body.id);
  });

  it('projeto com prazo fixa o eixo e deixa semanas futuras sem ponto', async () => {
    const created = await agent
      .post('/api/v1/projects')
      .send({ name: `Evo Prazo ${Date.now()}`, description: 'Projeto criado nos testes' });
    expect(created.status).toBe(201);
    await pool.query(
      `UPDATE projects SET start_date = CURRENT_DATE - 4, due_date = CURRENT_DATE + 10
       WHERE id = $1`,
      [created.body.id],
    );

    const res = await agent.get(`/api/v1/projects/${created.body.id}/dashboard`);
    expect(res.status).toBe(200);
    expect(res.body.weekly_evolution).toEqual([
      { label: 'Atual', percent: 0 },
      { label: 'Sem 2', percent: null },
    ]);
    await dropProject(created.body.id);
  });
});

describe('Dashboard: acessos', () => {
  it('permite leitura para perfil apenas com dashboard', async () => {
    const res = await visitorAgent.get(`/api/v1/projects/${projectId}/dashboard`);
    expect(res.status).toBe(200);
    expect(res.body.indicators.total_cards).toBe(3);
  });

  it('permite leitura para perfil apenas com home', async () => {
    const homeEmail = uniqueEmail('home-dash');
    await createUserWithScreens(homeEmail, `Home Dash ${Date.now()}`, ['home']);
    const homeAgent = request.agent(app);
    await homeAgent
      .post('/api/v1/auth/login')
      .send({ email: homeEmail, password: ADMIN_PASSWORD });
    await pool.query(
      `INSERT INTO project_members (project_id, user_id)
       SELECT $1, id FROM users WHERE email = $2 ON CONFLICT DO NOTHING`,
      [projectId, homeEmail],
    );

    const res = await homeAgent.get(`/api/v1/projects/${projectId}/dashboard`);
    expect(res.status).toBe(200);
    expect(res.body.indicators.total_cards).toBe(3);
  });

  it('bloqueia leitura para usuario fora do projeto', async () => {
    const outsiderEmail = uniqueEmail('fora-dash');
    await createUserWithScreens(outsiderEmail, `Fora Dash ${Date.now()}`, ['dashboard']);
    const outsiderAgent = request.agent(app);
    await outsiderAgent
      .post('/api/v1/auth/login')
      .send({ email: outsiderEmail, password: ADMIN_PASSWORD });

    const res = await outsiderAgent.get(`/api/v1/projects/${projectId}/dashboard`);
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/acesso/i);
  });
});
