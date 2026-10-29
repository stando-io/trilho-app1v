import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, dropProject, setup, uniqueEmail } from './helpers.js';

const app = createApp();

let agent: ReturnType<typeof request.agent>;
let projectId = '';
let draftId = '';

beforeAll(async () => {
  await setup();
  agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const created = await agent
    .post('/api/v1/projects')
    .send({ name: `Wizard Teste ${Date.now()}`, description: 'Projeto criado nos testes' });
  expect(created.status).toBe(201);
  projectId = created.body.id;
});

afterAll(async () => {
  if (projectId) await dropProject(projectId);
  if (draftId) await dropProject(draftId);
  await pool.end();
});

function csvBase64(rows: string): string {
  return Buffer.from(rows, 'utf8').toString('base64');
}

describe('Projeto rascunho (Etapa 2 — Salvar como Rascunho)', () => {
  it('cria projeto como rascunho com status Rascunho', async () => {
    const res = await agent.post('/api/v1/projects').send({
      name: `Rascunho ${Date.now()}`,
      description: 'Projeto criado nos testes',
      draft: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('Rascunho');
    draftId = res.body.id;

    const list = await agent.get('/api/v1/projects?all=1');
    expect(list.status).toBe(200);
    const found = list.body.find((project: { id: string }) => project.id === draftId);
    expect(found).toBeTruthy();
    expect(found.status).toBe('Rascunho');
  });

  it('expoe o status Rascunho em /auth/me', async () => {
    const me = await agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    const found = me.body.projects.find((project: { id: string }) => project.id === draftId);
    expect(found).toBeTruthy();
    expect(found.status).toBe('Rascunho');
  });

  it('finaliza o rascunho alterando a situacao com justificativa', async () => {
    const ok = await agent.patch(`/api/v1/projects/${draftId}`).send({
      status: 'Em andamento',
      justificativa: 'Rascunho aprovado na reuniao de kickoff',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('Em andamento');

    const audit = await pool.query(
      `SELECT meta FROM audit_logs
       WHERE action = 'project_updated' AND entity_id = $1 AND meta ? 'justificativa'
       ORDER BY id DESC LIMIT 1`,
      [draftId],
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0].meta.justificativa).toBe('Rascunho aprovado na reuniao de kickoff');
  });
});

describe('Justificativa obrigatoria em edicao de projeto', () => {
  it('rejeita edicao sem justificativa', async () => {
    const res = await agent.patch(`/api/v1/projects/${projectId}`).send({ name: 'Novo Nome' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/justificativa/i);
  });

  it('rejeita PATCH vazio sem gerar "Nada para atualizar" errado', async () => {
    const res = await agent.patch(`/api/v1/projects/${projectId}`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/justificativa|nada/i);
  });

  it('registra a justificativa na auditoria a cada edicao', async () => {
    const res = await agent.patch(`/api/v1/projects/${projectId}`).send({
      description: 'Descricao revisada',
      justificativa: 'Atualizacao da descricao apos validacao do cliente',
    });
    expect(res.status).toBe(200);

    const audit = await pool.query(
      `SELECT meta FROM audit_logs
       WHERE action = 'project_updated' AND entity_id = $1 AND meta->>'description' = 'Descricao revisada'
       ORDER BY id DESC LIMIT 1`,
      [projectId],
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0].meta.justificativa).toBe('Atualizacao da descricao apos validacao do cliente');
  });
});

describe('Modelo .xlsx da planilha de estrutura', () => {
  it('baixa o modelo com content-type xlsx', async () => {
    const res = await agent
      .get('/api/v1/projects/base-template')
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheet');
    expect(String(res.headers['content-disposition'])).toContain('modelo-estrutura-base.xlsx');
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect((res.body as Buffer).length).toBeGreaterThan(0);
  });
});

describe('Importacao de planilha de estrutura', () => {
  it('importa CSV valido com setores e departamentos', async () => {
    const csv = 'Nome do Setor;Nome do Departamento\nComercial;Atendimento\nComercial;Vendas\nFinanceiro;\n';
    const res = await agent.post(`/api/v1/projects/${projectId}/base/import`).send({
      file_base64: csvBase64(csv),
      filename: 'estrutura.csv',
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sectors: 2, departments: 2 });

    const sectors = await agent.get(`/api/v1/projects/${projectId}/sectors`);
    expect(sectors.status).toBe(200);
    const nomes = sectors.body.map((sector: { name: string }) => sector.name).sort();
    expect(nomes).toEqual(['Comercial', 'Financeiro']);
  });

  it('rejeita CSV com linha invalida e nao grava nada', async () => {
    const csv = 'Nome do Setor;Nome do Departamento\nComercial;Vendas\n;Sem Setor\n';
    const res = await agent.post(`/api/v1/projects/${projectId}/base/import`).send({
      file_base64: csvBase64(csv),
      filename: 'estrutura-invalida.csv',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Planilha inválida');
    expect(res.body.error.errors).toEqual([{ line: 3, message: 'Nome do Setor obrigatório' }]);

    const sectors = await agent.get(`/api/v1/projects/${projectId}/sectors`);
    expect(sectors.body).toHaveLength(2);
  });

  it('rejeita arquivo em formato nao suportado', async () => {
    const res = await agent.post(`/api/v1/projects/${projectId}/base/import`).send({
      file_base64: Buffer.from('nao-e-planilha').toString('base64'),
      filename: 'estrutura.pdf',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/xlsx|csv/i);
  });

  it('importa .xlsx valido', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Estrutura');
    sheet.addRow(['Nome do Setor', 'Nome do Departamento']);
    sheet.addRow(['Operacoes', 'Logistica']);
    sheet.addRow(['Operacoes', 'Compras']);
    sheet.addRow(['RH', null]);
    const buffer = await workbook.xlsx.writeBuffer();

    const res = await agent.post(`/api/v1/projects/${projectId}/base/import`).send({
      file_base64: Buffer.from(buffer as ArrayBuffer).toString('base64'),
      filename: 'estrutura.xlsx',
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sectors: 2, departments: 2 });

    const sectors = await agent.get(`/api/v1/projects/${projectId}/sectors`);
    const nomes = sectors.body.map((sector: { name: string }) => sector.name);
    expect(nomes).toContain('Operacoes');
  });

  it('registra a importacao na auditoria', async () => {
    const audit = await pool.query(
      `SELECT meta FROM audit_logs
       WHERE action = 'project_base_imported' AND entity_id = $1
       ORDER BY id DESC LIMIT 1`,
      [projectId],
    );
    expect(audit.rowCount).toBe(1);
  });

  it('bloqueia importacao para quem nao e membro do projeto', async () => {
    const admin = request.agent(app);
    await admin.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const profile = await admin.post('/api/v1/profiles').send({
      name: `Perfil Estrangeiro ${Date.now()}`,
      description: 'Sem acesso a projetos',
      screens: ['dashboard'],
    });
    const outsiderEmail = uniqueEmail('import-outsider');
    const invite = await admin.post('/api/v1/auth/invite').send({
      email: outsiderEmail,
      profile_id: profile.body.id,
      project_ids: [],
    });
    const token = String(invite.body.invite_url).split('/convite/')[1];
    const outsider = request.agent(app);
    await outsider.post('/api/v1/auth/accept-invite').send({
      token,
      name: 'Fora do Projeto',
      password: 'senha-outsider-123456',
    });
    const login = await outsider
      .post('/api/v1/auth/login')
      .send({ email: outsiderEmail, password: 'senha-outsider-123456' });
    expect(login.status).toBe(200);

    const res = await outsider.post(`/api/v1/projects/${projectId}/base/import`).send({
      file_base64: csvBase64('Nome do Setor;Nome do Departamento\nHacking;;\n'),
      filename: 'estrutura.csv',
    });
    expect(res.status).toBe(403);
  });
});
