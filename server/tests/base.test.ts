import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, dropProject, setup } from './helpers.js';

const app = createApp();
const SECURITY_HEADER = 'x-security-password';
const SECURITY_PASSWORD = 'senha-estrutural-123';

let agent: ReturnType<typeof request.agent>;
let projectId = '';

beforeAll(async () => {
  await setup();
  agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const created = await agent
    .post('/api/v1/projects')
    .send({ name: `Base Teste ${Date.now()}`, description: 'Projeto criado nos testes' });
  expect(created.status).toBe(201);
  projectId = created.body.id;
});

afterAll(async () => {
  if (projectId) await dropProject(projectId);
  await pool.end();
});

const ALL_GATES = {
  base: true,
  users: true,
  settings: true,
  integrations: true,
  home: true,
  dashboard: true,
  board: true,
};

describe('Base: senha de segurança', () => {
  it('inicia sem senha de segurança global', async () => {
    const res = await agent.get('/api/v1/settings/security-password');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ defined: false, hint: null, global: false, gates: ALL_GATES });
  });

  it('permite alteracao estrutural enquanto nao ha senha global', async () => {
    const criado = await agent
      .post(`/api/v1/projects/${projectId}/sectors`)
      .send({ name: 'Temporario' });
    expect(criado.status).toBe(201);
    const removido = await agent.delete(
      `/api/v1/projects/${projectId}/sectors/${criado.body.id}`,
    );
    expect(removido.status).toBe(204);
  });

  it('define a senha de segurança global com dica', async () => {
    const res = await agent
      .put('/api/v1/settings/security-password')
      .send({ password: SECURITY_PASSWORD, hint: 'Primeira senha do projeto' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ defined: true });

    const check = await agent.get('/api/v1/settings/security-password');
    expect(check.body).toEqual({ defined: true, hint: 'Primeira senha do projeto', global: false, gates: ALL_GATES });
  });

  it('exige a senha no cabecalho para criar setor', async () => {
    const semSenha = await agent
      .post(`/api/v1/projects/${projectId}/sectors`)
      .send({ name: 'Operacoes' });
    expect(semSenha.status).toBe(400);
    expect(semSenha.body.error.message).toMatch(/necessária/i);

    const senhaErrada = await agent
      .post(`/api/v1/projects/${projectId}/sectors`)
      .set(SECURITY_HEADER, 'senha-errada')
      .send({ name: 'Operacoes' });
    expect(senhaErrada.status).toBe(400);
    expect(senhaErrada.body.error.message).toMatch(/inválida/i);
  });

  it('desativa e reativa o gate da area base', async () => {
    const desativado = await agent
      .patch('/api/v1/settings/security-password/gates')
      .send({ area: 'base', enabled: false });
    expect(desativado.status).toBe(200);
    expect(desativado.body).toEqual({ area: 'base', enabled: false });

    const livre = await agent
      .post(`/api/v1/projects/${projectId}/sectors`)
      .send({ name: 'Sem Gate' });
    expect(livre.status).toBe(201);
    await agent.delete(`/api/v1/projects/${projectId}/sectors/${livre.body.id}`);

    const reativado = await agent
      .patch('/api/v1/settings/security-password/gates')
      .send({ area: 'base', enabled: true });
    expect(reativado.status).toBe(200);
    expect(reativado.body).toEqual({ area: 'base', enabled: true });

    const deNovo = await agent
      .post(`/api/v1/projects/${projectId}/sectors`)
      .send({ name: 'Com Gate' });
    expect(deNovo.status).toBe(400);
    expect(deNovo.body.error.message).toMatch(/necessária/i);
  });

  it('gate users nao afeta area base', async () => {
    const setor = await agent
      .post(`/api/v1/projects/${projectId}/sectors`)
      .set(SECURITY_HEADER, SECURITY_PASSWORD)
      .send({ name: 'Usuarios Gate' });
    expect(setor.status).toBe(201);
    await agent.delete(`/api/v1/projects/${projectId}/sectors/${setor.body.id}`).set(SECURITY_HEADER, SECURITY_PASSWORD);

    const user = await agent.get('/api/v1/users');
    expect(user.status).toBe(200);
  });
});

describe('Base: setores e departamentos', () => {
  let sectorId = '';

  it('cria setor com a senha correta', async () => {
    const res = await agent
      .post(`/api/v1/projects/${projectId}/sectors`)
      .set(SECURITY_HEADER, SECURITY_PASSWORD)
      .send({ name: 'Operacoes' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Operacoes');
    sectorId = res.body.id;
  });

  it('lista setores na arvore', async () => {
    const res = await agent.get(`/api/v1/projects/${projectId}/sectors`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(sectorId);
    expect(res.body[0].departments).toEqual([]);
    expect(res.body[0].percent).toBeNull();
  });

  it('cria departamento dentro do setor', async () => {
    const res = await agent
      .post(`/api/v1/projects/${projectId}/departments`)
      .set(SECURITY_HEADER, SECURITY_PASSWORD)
      .send({ sector_id: sectorId, name: 'Faturamento' });
    expect(res.status).toBe(201);
    expect(res.body.sector_id).toBe(sectorId);
  });

  it('rejeita departamento em setor inexistente', async () => {
    const res = await agent
      .post(`/api/v1/projects/${projectId}/departments`)
      .set(SECURITY_HEADER, SECURITY_PASSWORD)
      .send({ sector_id: '00000000-0000-4000-8000-000000000000', name: 'Fantasma' });
    expect(res.status).toBe(400);
  });

  it('renomeia setor com senha', async () => {
    const res = await agent
      .patch(`/api/v1/projects/${projectId}/sectors/${sectorId}`)
      .set(SECURITY_HEADER, SECURITY_PASSWORD)
      .send({ name: 'Operacoes Internas' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Operacoes Internas');
  });

  it('impede excluir setor que ainda tem departamento', async () => {
    const res = await agent
      .delete(`/api/v1/projects/${projectId}/sectors/${sectorId}`)
      .set(SECURITY_HEADER, SECURITY_PASSWORD);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/departamentos/i);
  });

  it('expoe o progresso com formato neutro', async () => {
    const res = await agent.get(`/api/v1/projects/${projectId}/progress`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.sectors)).toBe(true);
    expect(Array.isArray(res.body.departments)).toBe(true);
    const sector = res.body.sectors.find(
      (row: { sector_id: string }) => row.sector_id === sectorId,
    );
    expect(Number(sector.total_cards)).toBe(0);
    expect(Number(sector.completed_cards)).toBe(0);
    expect(sector.percent).toBeNull();
  });
});

describe('Base: remocao da senha de segurança', () => {
  it('remove a senha e devolve as alteracoes estruturais ao livre', async () => {
    const removida = await agent.delete('/api/v1/settings/security-password');
    expect(removida.status).toBe(204);

    const check = await agent.get('/api/v1/settings/security-password');
    expect(check.body).toEqual({ defined: false, hint: null, global: false, gates: ALL_GATES });

    const criado = await agent
      .post(`/api/v1/projects/${projectId}/sectors`)
      .send({ name: 'Sem Senha' });
    expect(criado.status).toBe(201);
    const removido = await agent.delete(
      `/api/v1/projects/${projectId}/sectors/${criado.body.id}`,
    );
    expect(removido.status).toBe(204);
  });
});

describe('Base: cards vencidos no progresso', () => {
  let sectorId = '';
  let departmentId = '';
  let cardId = '';
  let columnId = '';
  let doneColumnId = '';

  beforeAll(async () => {
    const columns = await agent.get(`/api/v1/projects/${projectId}/columns`);
    const openColumn = columns.body.find((column: { is_done: boolean }) => !column.is_done);
    const doneColumn = columns.body.find((column: { name: string }) => column.name === 'Concluido');
    columnId = openColumn.id;
    doneColumnId = doneColumn.id;

    const setor = await agent.post(`/api/v1/projects/${projectId}/sectors`).send({ name: 'Atraso' });
    expect(setor.status).toBe(201);
    sectorId = setor.body.id;

    const dept = await agent
      .post(`/api/v1/projects/${projectId}/departments`)
      .send({ sector_id: sectorId, name: 'Prazos' });
    expect(dept.status).toBe(201);
    departmentId = dept.body.id;
  });

  async function fetchSector() {
    const res = await agent.get(`/api/v1/projects/${projectId}/sectors`);
    expect(res.status).toBe(200);
    const sector = res.body.find((row: { id: string }) => row.id === sectorId);
    expect(sector).toBeTruthy();
    return sector;
  }

  it('nao marca atraso sem cards vencidos', async () => {
    const sector = await fetchSector();
    expect(sector.overdue_cards).toBe(0);
    expect(sector.departments[0].overdue_cards).toBe(0);
  });

  it('marca setor e departamento com card vencido', async () => {
    const created = await agent.post(`/api/v1/projects/${projectId}/cards`).send({
      title: 'Card vencido',
      department_id: departmentId,
      column_id: columnId,
      due_date: '2000-01-01',
    });
    expect(created.status).toBe(201);
    cardId = created.body.id;

    const sector = await fetchSector();
    expect(sector.overdue_cards).toBe(1);
    expect(sector.departments[0].overdue_cards).toBe(1);
  });

  it('nao conta card vencido concluido', async () => {
    const moved = await agent
      .patch(`/api/v1/projects/${projectId}/cards/${cardId}`)
      .send({ column_id: doneColumnId });
    expect(moved.status).toBe(200);
    expect(moved.body.completed_at).toBeTruthy();

    const sector = await fetchSector();
    expect(sector.overdue_cards).toBe(0);
    expect(sector.departments[0].overdue_cards).toBe(0);
  });
});
