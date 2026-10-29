import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { hash } from '@node-rs/argon2';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { getProjectPool } from '../src/db/projectPool.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, dropProject, setup, uniqueEmail } from './helpers.js';

const app = createApp();
const SECURITY_HEADER = 'x-security-password';
const SECURITY_PASSWORD = 'senha-relatorio-123';

let admin: ReturnType<typeof request.agent>;
let projectId = '';
let cardTitle = '';
let cardId = '';
let overdueId = '';
let comercialId = '';
let financeiroId = '';
let prospeccaoId = '';
let adminUserId = '';

async function loginAdmin(): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  return agent;
}

function progressPath(suffix = ''): string {
  return `/api/v1/projects/${projectId}/reports/progress${suffix}`;
}

function cardsPath(suffix = ''): string {
  return `/api/v1/projects/${projectId}/reports/cards${suffix}`;
}

function learningPath(suffix = ''): string {
  return `/api/v1/projects/${projectId}/reports/learning${suffix}`;
}

function filtersPath(): string {
  return `/api/v1/projects/${projectId}/reports/filters`;
}

function isoToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

beforeAll(async () => {
  await setup();
  admin = await loginAdmin();

  const created = await admin.post('/api/v1/projects').send({
    name: `Relatorios Teste ${Date.now()}`,
    description: 'Projeto criado nos testes',
  });
  expect(created.status).toBe(201);
  projectId = created.body.id;

  await admin
    .put(`/api/v1/settings/security-password`)
    .send({ password: SECURITY_PASSWORD });

  const sector = await admin
    .post(`/api/v1/projects/${projectId}/sectors`)
    .set(SECURITY_HEADER, SECURITY_PASSWORD)
    .send({ name: 'Comercial' });
  expect(sector.status).toBe(201);
  comercialId = sector.body.id;

  const financeiro = await admin
    .post(`/api/v1/projects/${projectId}/sectors`)
    .set(SECURITY_HEADER, SECURITY_PASSWORD)
    .send({ name: 'Financeiro' });
  expect(financeiro.status).toBe(201);
  financeiroId = financeiro.body.id;

  const department = await admin
    .post(`/api/v1/projects/${projectId}/departments`)
    .set(SECURITY_HEADER, SECURITY_PASSWORD)
    .send({ sector_id: comercialId, name: 'Prospeccao' });
  expect(department.status).toBe(201);
  prospeccaoId = department.body.id;

  const columns = await admin.get(`/api/v1/projects/${projectId}/columns`);
  expect(columns.status).toBe(200);

  cardTitle = `Card relatorio ${Date.now()}`;
  const card = await admin.post(`/api/v1/projects/${projectId}/cards`).send({
    title: cardTitle,
    column_id: columns.body[0].id,
    department_id: prospeccaoId,
    priority: 'alta',
  });
  expect(card.status).toBe(201);
  cardId = card.body.id;

  const overdue = await admin.post(`/api/v1/projects/${projectId}/cards`).send({
    title: `Card relatorio atrasado ${Date.now()}`,
    column_id: columns.body[0].id,
    priority: 'baixa',
    due_date: '2020-01-01',
  });
  expect(overdue.status).toBe(201);
  overdueId = overdue.body.id;

  const done = await admin.post(`/api/v1/projects/${projectId}/cards`).send({
    title: `Card relatorio concluido ${Date.now()}`,
    column_id: columns.body[0].id,
    department_id: prospeccaoId,
    priority: 'media',
  });
  expect(done.status).toBe(201);
  const { projectPool } = await getProjectPool(projectId);
  await projectPool.query('UPDATE cards SET completed_at = now() WHERE id = $1', [done.body.id]);

  await projectPool.query(
    `UPDATE cards SET learning_index_active = true, learning_index_score = 8,
            learning_index_note = 'Bom desempenho no atendimento'
     WHERE id = $1`,
    [cardId],
  );
  await projectPool.query(
    `UPDATE cards SET learning_index_active = true, learning_index_score = 3,
            learning_index_note = 'Precisa de acompanhamento'
     WHERE id = $1`,
    [overdueId],
  );
  const semNota = await admin.post(`/api/v1/projects/${projectId}/cards`).send({
    title: `Card relatorio sem nota ${Date.now()}`,
    column_id: columns.body[0].id,
    priority: 'media',
  });
  expect(semNota.status).toBe(201);
  await projectPool.query('UPDATE cards SET learning_index_active = true WHERE id = $1', [
    semNota.body.id,
  ]);

  const adminRow = await pool.query<{ id: string }>(
    'SELECT id FROM users WHERE email = $1',
    [ADMIN_EMAIL],
  );
  adminUserId = adminRow.rows[0]!.id;
});

afterAll(async () => {
  if (projectId) await dropProject(projectId);
  await pool.end();
});

describe('Relatorios: progresso', () => {
  it('exige autenticacao', async () => {
    const res = await request(app).get(progressPath());
    expect(res.status).toBe(401);
  });

  it('valida o formato', async () => {
    const res = await admin.get(progressPath('?format=pdf'));
    expect(res.status).toBe(400);
  });

  it('valida o id do projeto', async () => {
    const res = await admin.get('/api/v1/projects/nao-e-uuid/reports/progress');
    expect(res.status).toBe(400);
  });

  it('retorna tabela json com projeto e setores', async () => {
    const res = await admin.get(progressPath());
    expect(res.status).toBe(200);
    expect(res.body.columns).toEqual([
      'Escopo',
      'Cartões',
      'Concluídos',
      'Pendentes',
      'Atrasados',
      'Percentual',
    ]);
    expect(res.body.rows[0][0]).toBe('Projeto');
    const sectorRow = res.body.rows.find((row: string[]) => row[0] === 'Comercial');
    expect(sectorRow).toBeTruthy();
    expect(res.body.rows.length).toBeGreaterThanOrEqual(2);
  });

  it('exporta csv com separador pt-BR e BOM', async () => {
    const res = await admin.get(progressPath('?format=csv'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('relatorio-progresso-');
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
    expect(res.text).toContain('Escopo;Cartões;Concluídos');
    expect(res.text).toContain('Projeto;');
    expect(res.text).toContain('Comercial;');
  });

  it('exporta xlsx legivel', async () => {
    const res = await admin
      .get(progressPath('?format=xlsx'))
      .parse((binaryRes, cb) => {
        const chunks: Buffer[] = [];
        binaryRes.on('data', (chunk: Buffer) => chunks.push(chunk));
        binaryRes.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('relatorio-progresso-');

    const buffer = res.body as Buffer;
    expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    expect(sheet.name).toBe('Progresso do projeto');
    expect(sheet.getRow(1).getCell(1).value).toBe('Escopo');
    expect(sheet.getRow(2).getCell(1).value).toBe('Projeto');
  });
});

describe('Relatorios: cards', () => {
  it('retorna todos os cards do projeto em json', async () => {
    const res = await admin.get(cardsPath());
    expect(res.status).toBe(200);
    expect(res.body.columns).toEqual([
      'Código',
      'Título',
      'Situação',
      'Setor',
      'Departamento',
      'Responsável',
      'Prioridade',
      'Origem',
      'Vencimento',
      'Criado em',
    ]);
    const row = res.body.rows.find((item: string[]) => item[1] === cardTitle);
    expect(row).toBeTruthy();
    expect(row[0]).toMatch(/^ST-\d{4}$/);
    expect(row[2]).toBe('Pendente');
    expect(row[4]).toBe('Prospeccao');
    expect(row[6]).toBe('Alta');
  });

  it('classifica a situacao e troca N/A por traco', async () => {
    const res = await admin.get(cardsPath());
    expect(res.status).toBe(200);
    const overdue = res.body.rows.find((item: string[]) =>
      item[1].startsWith('Card relatorio atrasado'),
    );
    expect(overdue[2]).toBe('Atrasado');
    expect(overdue[3]).toBe('—');
    expect(overdue[4]).toBe('—');
    expect(overdue[8]).toBe('01/01/2020');
    const done = res.body.rows.find((item: string[]) =>
      item[1].startsWith('Card relatorio concluido'),
    );
    expect(done[2]).toBe('Concluído');
  });

  it('exporta csv dos cards', async () => {
    const res = await admin.get(cardsPath('?format=csv'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('relatorio-cards-');
    expect(res.text).toContain('Código;Título;Situação');
    expect(res.text).toContain(cardTitle);
  });

  it('exporta xlsx dos cards', async () => {
    const res = await admin
      .get(cardsPath('?format=xlsx'))
      .parse((binaryRes, cb) => {
        const chunks: Buffer[] = [];
        binaryRes.on('data', (chunk: Buffer) => chunks.push(chunk));
        binaryRes.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('relatorio-cards-');

    const buffer = res.body as Buffer;
    expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    expect(sheet.name).toBe('Cards');
    expect(sheet.getRow(1).getCell(1).value).toBe('Código');
    expect(sheet.rowCount).toBeGreaterThanOrEqual(2);
  });

  it('exige a tela de relatorios', async () => {
    const profile = await admin.post('/api/v1/profiles').set(SECURITY_HEADER, SECURITY_PASSWORD).send({
      name: `Perfil Sem Relatorios ${Date.now()}`,
      description: 'Sem tela de relatorios',
      screens: ['dashboard'],
    });
    expect(profile.status).toBe(201);

    const memberEmail = uniqueEmail('semrelatorios');
    const passwordHash = await hash('semrelatorios-teste-123456');
    const created = await pool.query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash, profile_id, is_active)
       VALUES ('Sem Relatorios', $1, $2, $3, true) RETURNING id`,
      [memberEmail, passwordHash, profile.body.id],
    );
    const userId = created.rows[0].id;

    const added = await admin
      .post(`/api/v1/projects/${projectId}/members`)
      .send({ user_id: userId });
    expect(added.status).toBe(201);

    const member = request.agent(app);
    const login = await member
      .post('/api/v1/auth/login')
      .send({ email: memberEmail, password: 'semrelatorios-teste-123456' });
    expect(login.status).toBe(200);

    const res = await member.get(progressPath());
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('não tem permissão');

    const resFilters = await member.get(filtersPath());
    expect(resFilters.status).toBe(403);

    const removed = await admin.delete(`/api/v1/projects/${projectId}/members/${userId}`);
    expect(removed.status).toBe(204);
  });
});

describe('Relatorios: filtros', () => {
  it('explica as opcoes de filtro sem exigir senha de segurança', async () => {
    const res = await admin.get(filtersPath());
    expect(res.status).toBe(200);
    const sectorNames = res.body.sectors.map((item: { name: string }) => item.name);
    expect(sectorNames).toContain('Comercial');
    expect(sectorNames).toContain('Financeiro');
    const departmentNames = res.body.departments.map((item: { name: string }) => item.name);
    expect(departmentNames).toContain('Prospeccao');
    expect(res.body.users.length).toBeGreaterThan(0);
  });

  it('exige autenticacao', async () => {
    const res = await request(app).get(filtersPath());
    expect(res.status).toBe(401);
  });

  it('filtra o progresso por setor', async () => {
    const res = await admin.get(progressPath(`?sector_id=${comercialId}`));
    expect(res.status).toBe(200);
    const names = res.body.rows.map((item: string[]) => item[0]);
    expect(names).toContain('Projeto');
    expect(names).toContain('Comercial');
    expect(names).not.toContain('Financeiro');
    expect(res.body.rows[0]).toEqual(['Projeto', 2, 1, 1, 0, '50%']);
  });

  it('filtra o progresso por periodo sem dados', async () => {
    const res = await admin.get(progressPath('?date_from=2999-01-01'));
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([['Projeto', 0, 0, 0, 0, '—']]);
  });

  it('filtra cards por setor', async () => {
    const semCartoes = await admin.get(cardsPath(`?sector_id=${financeiroId}`));
    expect(semCartoes.status).toBe(200);
    expect(semCartoes.body.rows).toEqual([]);

    const comCartoes = await admin.get(cardsPath(`?sector_id=${comercialId}`));
    expect(comCartoes.status).toBe(200);
    const titles = comCartoes.body.rows.map((item: string[]) => item[1]);
    expect(titles).toContain(cardTitle);
    expect(titles.some((title: string) => title.startsWith('Card relatorio atrasado'))).toBe(false);
  });

  it('filtra cards por departamento', async () => {
    const res = await admin.get(cardsPath(`?department_id=${prospeccaoId}`));
    expect(res.status).toBe(200);
    const titles = res.body.rows.map((item: string[]) => item[1]);
    expect(titles).toContain(cardTitle);
    expect(titles.some((title: string) => title.startsWith('Card relatorio atrasado'))).toBe(false);
  });

  it('filtra cards por periodo de criacao', async () => {
    const dentro = await admin.get(cardsPath(`?date_from=${isoToday()}&date_to=${isoToday()}`));
    expect(dentro.status).toBe(200);
    expect(dentro.body.rows.length).toBeGreaterThan(0);

    const fora = await admin.get(cardsPath('?date_from=2999-01-01'));
    expect(fora.status).toBe(200);
    expect(fora.body.rows).toEqual([]);
  });

  it('filtra cards por usuario responsavel', async () => {
    const res = await admin.get(cardsPath(`?user_id=${adminUserId}`));
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([]);
  });

  it('rejeita parametros de filtro invalidos', async () => {
    const uuidInvalido = await admin.get(progressPath('?sector_id=abc'));
    expect(uuidInvalido.status).toBe(400);

    const dataInvalida = await admin.get(cardsPath('?date_from=31/12/2026'));
    expect(dataInvalida.status).toBe(400);
  });
});

describe('Relatorios: indice de aprendizado', () => {
  it('exige autenticacao', async () => {
    const res = await request(app).get(learningPath());
    expect(res.status).toBe(401);
  });

  it('valida o formato', async () => {
    const res = await admin.get(learningPath('?format=pdf'));
    expect(res.status).toBe(400);
  });

  it('retorna somente cards avaliados com as 4 colunas', async () => {
    const res = await admin.get(learningPath());
    expect(res.status).toBe(200);
    expect(res.body.columns).toEqual(['Código', 'Técnico', 'Nota', 'Observação']);
    expect(res.body.rows.length).toBe(3);
    for (const row of res.body.rows) {
      expect(row[1]).toBe('Sem responsável');
    }

    const scored = res.body.rows.filter(
      (item: (string | number | null)[]) => typeof item[2] === 'number',
    );
    expect(scored.length).toBe(2);
    expect(scored.map((item: (string | number | null)[]) => item[2])).toEqual([3, 8]);
  });

  it('ordena da menor para a maior nota com sem-nota por ultimo', async () => {
    const res = await admin.get(learningPath());
    expect(res.status).toBe(200);
    const scores = res.body.rows.map((item: (string | number | null)[]) => item[2]);
    expect(scores[0]).toBe(3);
    expect(scores[1]).toBe(8);
    expect(scores[2]).toBeNull();
  });

  it('filtra por setor de quem tem departamento', async () => {
    const res = await admin.get(learningPath(`?sector_id=${comercialId}`));
    expect(res.status).toBe(200);
    const scores = res.body.rows.map((item: (string | number | null)[]) => item[2]);
    expect(scores).toEqual([8]);
    expect(res.body.rows[0][3]).toBe('Bom desempenho no atendimento');
  });

  it('exporta csv com separador pt-BR e BOM', async () => {
    const res = await admin.get(learningPath('?format=csv'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('relatorio-indice-aprendizado-');
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
    expect(res.text).toContain('Código;Técnico;Nota;Observação');
    expect(res.text).toContain('Precisa de acompanhamento');
  });
});
