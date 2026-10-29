import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { hash } from '@node-rs/argon2';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, dropProject, setup, uniqueEmail } from './helpers.js';

const app = createApp();

let projectId = '';
let dbName = '';
let outsiderEmail = '';
let alvoId = '';
let alvoDb = '';
let concludedId = '';

const SECURITY_HEADER = 'x-security-password';
const SECURITY_PASSWORD = 'senha-edicao-123';

beforeAll(async () => {
  await setup();

  const admin = await loginAdmin();
  const profile = await admin.post('/api/v1/profiles').send({
    name: `Perfil Visitante ${Date.now()}`,
    description: 'Sem acesso a projetos',
    screens: ['dashboard'],
  });
  outsiderEmail = uniqueEmail('outsider');
  const invite = await admin.post('/api/v1/auth/invite').send({
    email: outsiderEmail,
    profile_id: profile.body.id,
    project_ids: [],
  });
  const token = String(invite.body.invite_url).split('/convite/')[1];
  await request(app)
    .post('/api/v1/auth/accept-invite')
    .send({ token, name: 'Fora do Projeto', password: 'senha-outsider-123456' });
});

afterAll(async () => {
  if (projectId) await dropProject(projectId);
  if (alvoId) await dropProject(alvoId);
  if (concludedId) await dropProject(concludedId);
  await pool.end();
});

let adminSession: ReturnType<typeof request.agent> | null = null;
let outsiderSession: ReturnType<typeof request.agent> | null = null;

async function loginAdmin() {
  if (adminSession) return adminSession;
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  adminSession = agent;
  return agent;
}

async function loginOutsider() {
  if (outsiderSession) return outsiderSession;
  const agent = request.agent(app);
  const login = await agent
    .post('/api/v1/auth/login')
    .send({ email: outsiderEmail, password: 'senha-outsider-123456' });
  expect(login.status).toBe(200);
  outsiderSession = agent;
  return agent;
}

describe('Projetos (F2)', () => {
  it('exige autenticacao', async () => {
    const res = await request(app).get('/api/v1/projects');
    expect(res.status).toBe(401);
  });

  it('cria projeto com banco dedicado e vincula o criador', async () => {
    const admin = await loginAdmin();
    const name = `Projeto Teste ${Date.now()}`;
    const res = await admin
      .post('/api/v1/projects')
      .send({ name, description: 'Projeto criado nos testes' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.db_name).toMatch(/^trilho_proj_/);
    projectId = res.body.id;
    dbName = res.body.db_name;

    const list = await admin.get('/api/v1/projects');
    expect(list.status).toBe(200);
    expect(list.body.some((project: { id: string }) => project.id === projectId)).toBe(true);

    const databases = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    expect(databases.rowCount).toBe(1);

    const members = await admin.get(`/api/v1/projects/${projectId}/members`);
    expect(members.status).toBe(200);
    expect(members.body).toHaveLength(1);
    expect(members.body[0].email).toBe(ADMIN_EMAIL);
  });

  it('rejeita nome muito curto', async () => {
    const admin = await loginAdmin();
    const res = await admin.post('/api/v1/projects').send({ name: 'A' });
    expect(res.status).toBe(400);
  });

  it('renomeia o projeto com senha de segurança', async () => {
    const admin = await loginAdmin();
    const defined = await admin
      .put('/api/v1/settings/security-password')
      .send({ password: SECURITY_PASSWORD });
    expect(defined.status).toBe(200);

    const novoNome = `Projeto Renomeado ${Date.now()}`;
    const res = await admin
      .patch(`/api/v1/projects/${projectId}`)
      .set(SECURITY_HEADER, SECURITY_PASSWORD)
      .send({ name: novoNome, justificativa: 'Renomeacao aprovada pela lideranca' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe(novoNome);
  });

  it('rejeita renomear sem a senha de segurança', async () => {
    const admin = await loginAdmin();
    const semSenha = await admin.patch(`/api/v1/projects/${projectId}`).send({ name: 'Sem Senha' });
    expect(semSenha.status).toBe(400);
    expect(semSenha.body.error.message).toContain('Senha de segurança necessária');

    const errada = await admin
      .patch(`/api/v1/projects/${projectId}`)
      .set(SECURITY_HEADER, 'senha-errada')
      .send({ name: 'Senha Errada' });
    expect(errada.status).toBe(400);
    expect(errada.body.error.message).toContain('Senha de segurança inválida');
  });

  it('bloqueia usuario que nao e membro do projeto', async () => {
    const outsider = await loginOutsider();

    const members = await outsider.get(`/api/v1/projects/${projectId}/members`);
    expect(members.status).toBe(403);

    const sectors = await outsider.get(`/api/v1/projects/${projectId}/sectors`);
    expect(sectors.status).toBe(403);

    const list = await outsider.get('/api/v1/projects');
    expect(list.status).toBe(200);
    expect(list.body).toEqual([]);
  });

  it('rejeita identificador de projeto invalido', async () => {
    const admin = await loginAdmin();
    const res = await admin.get('/api/v1/projects/nao-e-uuid/members');
    expect(res.status).toBe(400);
  });
});

describe('Membros do projeto (F4)', () => {
  let memberId = '';
  let memberEmail = '';

  it('nao permite remover o ultimo membro', async () => {
    const admin = await loginAdmin();
    const list = await admin.get(`/api/v1/projects/${projectId}/members`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const res = await admin.delete(
      `/api/v1/projects/${projectId}/members/${list.body[0].id}`,
    );
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('pelo menos um membro');
  });

  it('adiciona um usuario ativo como membro', async () => {
    const admin = await loginAdmin();
    const profile = await admin.post('/api/v1/profiles').set(SECURITY_HEADER, SECURITY_PASSWORD).send({
      name: `Perfil Membro ${Date.now()}`,
      description: 'Perfil para membro de teste',
      screens: ['dashboard'],
    });
    expect(profile.status).toBe(201);

    memberEmail = uniqueEmail('member');
    const passwordHash = await hash('membro-teste-123456');
    const created = await pool.query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash, profile_id, is_active)
       VALUES ('Membro Teste', $1, $2, $3, true) RETURNING id`,
      [memberEmail, passwordHash, profile.body.id],
    );
    memberId = created.rows[0].id;

    const res = await admin
      .post(`/api/v1/projects/${projectId}/members`)
      .send({ user_id: memberId });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe(memberEmail);
    expect(res.body.name).toBe('Membro Teste');

    const list = await admin.get(`/api/v1/projects/${projectId}/members`);
    expect(list.body).toHaveLength(2);
    expect(list.body.some((member: { id: string }) => member.id === memberId)).toBe(true);
  });

  it('rejeita adicionar membro duplicado', async () => {
    const admin = await loginAdmin();
    const res = await admin
      .post(`/api/v1/projects/${projectId}/members`)
      .send({ user_id: memberId });
    expect(res.status).toBe(409);
  });

  it('rejeita usuario inexistente', async () => {
    const admin = await loginAdmin();
    const res = await admin.post(`/api/v1/projects/${projectId}/members`).send({
      user_id: '00000000-0000-4000-8000-000000000000',
    });
    expect(res.status).toBe(404);
  });

  it('remove o membro adicionado', async () => {
    const admin = await loginAdmin();
    const res = await admin.delete(`/api/v1/projects/${projectId}/members/${memberId}`);
    expect(res.status).toBe(204);

    const list = await admin.get(`/api/v1/projects/${projectId}/members`);
    expect(list.body).toHaveLength(1);
    expect(list.body.some((member: { id: string }) => member.id === memberId)).toBe(false);
  });

  it('remove membro inexistente retorna 404', async () => {
    const admin = await loginAdmin();
    const res = await admin.delete(
      `/api/v1/projects/${projectId}/members/${memberId}`,
    );
    expect(res.status).toBe(404);
  });
});

describe('Papel no projeto (isolamento do cargo global)', () => {
  let equipeProjectId = '';
  let gerenteId = '';
  let tecnicoId = '';

  async function createTestUser(name: string): Promise<string> {
    const admin = await loginAdmin();
    const profile = await admin.post('/api/v1/profiles').set(SECURITY_HEADER, SECURITY_PASSWORD).send({
      name: `Perfil Papel ${Date.now()}`,
      description: 'Perfil para teste de papel no projeto',
      screens: ['dashboard'],
    });
    expect(profile.status).toBe(201);
    const passwordHash = await hash('papel-teste-123456');
    const created = await pool.query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash, profile_id, is_active)
       VALUES ($1, $2, $3, $4, true) RETURNING id`,
      [name, uniqueEmail('papel'), passwordHash, profile.body.id],
    );
    return created.rows[0].id;
  }

  it('torna a equipe da criacao em membros com papel exposto', async () => {
    gerenteId = await createTestUser('Gerente Papel');
    tecnicoId = await createTestUser('Tecnico Papel');

    const admin = await loginAdmin();
    const res = await admin.post('/api/v1/projects').send({
      name: `Projeto Equipe ${Date.now()}`,
      description: 'Projeto criado nos testes',
      team: {
        gerente_projeto: gerenteId,
        tecnicos_implantacao: [gerenteId, tecnicoId],
      },
    });
    expect(res.status).toBe(201);
    equipeProjectId = res.body.id;

    const list = await admin.get(`/api/v1/projects/${equipeProjectId}/members`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(3);

    const gerente = list.body.find((member: { id: string }) => member.id === gerenteId);
    expect(gerente.project_role).toBe('gerente_projeto');
    const tecnico = list.body.find((member: { id: string }) => member.id === tecnicoId);
    expect(tecnico.project_role).toBe('tecnico_implantacao');
    const criador = list.body.find((member: { id: string }) => member.id !== gerenteId && member.id !== tecnicoId);
    expect(criador.project_role).toBeNull();
  });

  it('remove o papel junto com o membro', async () => {
    const admin = await loginAdmin();
    const res = await admin.delete(`/api/v1/projects/${equipeProjectId}/members/${gerenteId}`);
    expect(res.status).toBe(204);

    const leftover = await pool.query(
      'SELECT 1 FROM project_team WHERE project_id = $1 AND user_id = $2',
      [equipeProjectId, gerenteId],
    );
    expect(leftover.rowCount).toBe(0);

    const readded = await admin
      .post(`/api/v1/projects/${equipeProjectId}/members`)
      .send({ user_id: gerenteId });
    expect(readded.status).toBe(201);
    expect(readded.body.project_role).toBeNull();
  });

  it('altera e limpa o papel de um membro', async () => {
    const admin = await loginAdmin();
    const path = `/api/v1/projects/${equipeProjectId}/members/${gerenteId}`;

    const changed = await admin.patch(path).send({ project_role: 'lider_implantacao' });
    expect(changed.status).toBe(200);
    expect(changed.body.project_role).toBe('lider_implantacao');

    const list = await admin.get(`/api/v1/projects/${equipeProjectId}/members`);
    const gerente = list.body.find((member: { id: string }) => member.id === gerenteId);
    expect(gerente.project_role).toBe('lider_implantacao');

    const cleared = await admin.patch(path).send({ project_role: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.project_role).toBeNull();

    const leftover = await pool.query(
      'SELECT 1 FROM project_team WHERE project_id = $1 AND user_id = $2',
      [equipeProjectId, gerenteId],
    );
    expect(leftover.rowCount).toBe(0);
  });

  it('rejeita papel invalido e nao-membro', async () => {
    const admin = await loginAdmin();

    const invalidRole = await admin
      .patch(`/api/v1/projects/${equipeProjectId}/members/${gerenteId}`)
      .send({ project_role: 'chefe_geral' });
    expect(invalidRole.status).toBe(400);

    const notMember = await admin
      .patch(`/api/v1/projects/${equipeProjectId}/members/${randomUUID()}`)
      .send({ project_role: 'lider_implantacao' });
    expect(notMember.status).toBe(404);
  });

  it('adiciona membro ja com papel', async () => {
    const admin = await loginAdmin();
    const operadoraId = await createTestUser('Operadora Papel');

    const res = await admin.post(`/api/v1/projects/${equipeProjectId}/members`).send({
      user_id: operadoraId,
      project_role: 'operacao_assistida',
    });
    expect(res.status).toBe(201);
    expect(res.body.project_role).toBe('operacao_assistida');
  });

  afterAll(async () => {
    if (equipeProjectId) await dropProject(equipeProjectId);
  });
});

describe('Fundo do quadro (F4)', () => {
  it('le, salva e limpa o fundo do quadro', async () => {
    const admin = await loginAdmin();
    const path = `/api/v1/projects/${projectId}/settings/board-background`;

    const initial = await admin.get(path);
    expect(initial.status).toBe(200);
    expect(initial.body).toEqual({ color: null });

    const saved = await admin.put(path).send({ color: '#eef2ff' });
    expect(saved.status).toBe(200);
    expect(saved.body.color).toBe('#eef2ff');

    const reread = await admin.get(path);
    expect(reread.body.color).toBe('#eef2ff');

    const cleared = await admin.put(path).send({ color: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.color).toBeNull();

    const after = await admin.get(path);
    expect(after.body.color).toBeNull();
  });

  it('rejeita cor invalida', async () => {
    const admin = await loginAdmin();
    const res = await admin
      .put(`/api/v1/projects/${projectId}/settings/board-background`)
      .send({ color: 'vermelho' });
    expect(res.status).toBe(400);
  });
});

describe('Auditoria do projeto (F4)', () => {
  const auditPath = () => `/api/v1/projects/${projectId}/audit`;

  it('exige autenticacao e identificador valido', async () => {
    const unauth = await request(app).get('/api/v1/projects/qualquer/audit');
    expect(unauth.status).toBe(401);

    const admin = await loginAdmin();
    const invalid = await admin.get('/api/v1/projects/nao-e-uuid/audit');
    expect(invalid.status).toBe(400);
  });

  it('lista a auditoria do projeto', async () => {
    const admin = await loginAdmin();
    const res = await admin.get(auditPath());
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    expect(Array.isArray(res.body.items)).toBe(true);
    const first = res.body.items[0];
    expect(first.action).toBeTruthy();
    expect(first.user_name).toBeTruthy();
    expect(first).toHaveProperty('task_code');
    expect(first).toHaveProperty('detail');
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(10);
  });

  it('filtra por acao e mantem o escopo do projeto', async () => {
    const admin = await loginAdmin();
    const res = await admin.get(`${auditPath()}?action=project_created`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(
      res.body.items.every((item: { action: string }) => item.action === 'project_created'),
    ).toBe(true);
  });

  it('filtra por busca de usuario', async () => {
    const admin = await loginAdmin();
    const hit = await admin.get(`${auditPath()}?search=${encodeURIComponent(ADMIN_EMAIL)}`);
    expect(hit.status).toBe(200);
    expect(hit.body.total).toBeGreaterThanOrEqual(1);
    expect(
      hit.body.items.every((item: { user_email: string }) =>
        item.user_email.includes(ADMIN_EMAIL),
      ),
    ).toBe(true);

    const miss = await admin.get(`${auditPath()}?search=usuario-inexistente-zzz`);
    expect(miss.status).toBe(200);
    expect(miss.body.total).toBe(0);
    expect(miss.body.items).toHaveLength(0);
  });

  it('pagina os registros', async () => {
    const admin = await loginAdmin();
    const first = await admin.get(`${auditPath()}?page=1&limit=2`);
    expect(first.status).toBe(200);
    expect(first.body.items.length).toBeLessThanOrEqual(2);

    const second = await admin.get(`${auditPath()}?page=2&limit=2`);
    expect(second.status).toBe(200);
    expect(second.body.total).toBe(first.body.total);
    if (first.body.total > 2) {
      expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
    }
  });

  it('aceita limit de 100', async () => {
    const admin = await loginAdmin();
    const res = await admin.get(`${auditPath()}?limit=100`);
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(100);
    expect(res.body.items.length).toBeLessThanOrEqual(100);
  });

  it('inclui o codigo do card nas acoes de card', async () => {
    const admin = await loginAdmin();
    const columns = await admin.get(`/api/v1/projects/${projectId}/columns`);
    expect(columns.status).toBe(200);
    expect(columns.body.length).toBeGreaterThan(0);

    const created = await admin.post(`/api/v1/projects/${projectId}/cards`).send({
      title: 'Card para auditoria',
      column_id: columns.body[0].id,
    });
    expect(created.status).toBe(201);
    expect(created.body.task_code).toMatch(/^ST-\d{4}$/);

    const res = await admin.get(`${auditPath()}?action=card_created&limit=50`);
    expect(res.status).toBe(200);
    const item = res.body.items.find(
      (row: { detail: string }) => row.detail === 'Card para auditoria',
    );
    expect(item).toBeTruthy();
    expect(item.task_code).toBe(created.body.task_code);
  });

  it('exige a tela de configuracoes', async () => {
    const admin = await loginAdmin();
    const profile = await admin.post('/api/v1/profiles').set(SECURITY_HEADER, SECURITY_PASSWORD).send({
      name: `Perfil Sem Config ${Date.now()}`,
      description: 'Sem tela de configuracoes',
      screens: ['dashboard'],
    });
    expect(profile.status).toBe(201);

    const memberEmail = uniqueEmail('semconfig');
    const passwordHash = await hash('semconfig-teste-123456');
    const created = await pool.query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash, profile_id, is_active)
       VALUES ('Sem Config', $1, $2, $3, true) RETURNING id`,
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
      .send({ email: memberEmail, password: 'semconfig-teste-123456' });
    expect(login.status).toBe(200);

    const res = await member.get(auditPath());
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('não tem permissão');

    const removed = await admin.delete(`/api/v1/projects/${projectId}/members/${userId}`);
    expect(removed.status).toBe(204);
  });
});

describe('Edicao e exclusao de projetos (senha de )', () => {
  it('cria o projeto alvo', async () => {
    const admin = await loginAdmin();
    const res = await admin
      .post('/api/v1/projects')
      .send({ name: `Projeto Alvo ${Date.now()}`, description: 'Projeto criado nos testes' });
    expect(res.status).toBe(201);
    alvoId = res.body.id;
    alvoDb = res.body.db_name;
  });

  it('libera a edicao quando a senha global e removida', async () => {
    const admin = await loginAdmin();
    const removida = await admin.delete('/api/v1/settings/security-password');
    expect(removida.status).toBe(204);

    const res = await admin
      .patch(`/api/v1/projects/${alvoId}`)
      .send({ description: 'x', justificativa: 'Ajuste de descricao a pedido do cliente' });
    expect(res.status).toBe(200);
    expect(res.body.description).toBe('x');
  });

  it('define a senha de segurança e valida a edicao', async () => {
    const admin = await loginAdmin();
    const defined = await admin
      .put('/api/v1/settings/security-password')
      .send({ password: SECURITY_PASSWORD });
    expect(defined.status).toBe(200);

    const semSenha = await admin.patch(`/api/v1/projects/${alvoId}`).send({ description: 'x' });
    expect(semSenha.status).toBe(400);
    expect(semSenha.body.error.message).toContain('Senha de segurança necessária');

    const errada = await admin
      .patch(`/api/v1/projects/${alvoId}`)
      .set(SECURITY_HEADER, 'senha-errada')
      .send({ description: 'x' });
    expect(errada.status).toBe(400);
    expect(errada.body.error.message).toContain('Senha de segurança inválida');

    const ok = await admin
      .patch(`/api/v1/projects/${alvoId}`)
      .set(SECURITY_HEADER, SECURITY_PASSWORD)
      .send({
        description: 'Descricao do alvo',
        is_active: false,
        justificativa: 'Projeto encerrado temporariamente',
      });
    expect(ok.status).toBe(200);
    expect(ok.body.description).toBe('Descricao do alvo');
    expect(ok.body.is_active).toBe(false);

    const list = await admin.get('/api/v1/projects');
    expect(list.body.some((project: { id: string }) => project.id === alvoId)).toBe(false);

    const me = await admin.get('/api/v1/auth/me');
    const alvo = me.body.projects.find((project: { id: string }) => project.id === alvoId);
    expect(alvo).toBeTruthy();
    expect(alvo.is_active).toBe(false);
  });

  it('reativa o projeto inativo pelo mesmo gate', async () => {
    const admin = await loginAdmin();
    const res = await admin
      .patch(`/api/v1/projects/${alvoId}`)
      .set(SECURITY_HEADER, SECURITY_PASSWORD)
      .send({ is_active: true, justificativa: 'Reativacao autorizada pelo CEO' });
    expect(res.status).toBe(200);
    expect(res.body.is_active).toBe(true);

    const list = await admin.get('/api/v1/projects');
    expect(list.body.some((project: { id: string }) => project.id === alvoId)).toBe(true);
  });

  it('valida a senha de segurança antes de excluir', async () => {
    const admin = await loginAdmin();

    const semSenha = await admin.delete(`/api/v1/projects/${alvoId}`);
    expect(semSenha.status).toBe(400);
    expect(semSenha.body.error.message).toContain('Senha de segurança necessária');

    const errada = await admin
      .delete(`/api/v1/projects/${alvoId}`)
      .set(SECURITY_HEADER, 'senha-errada');
    expect(errada.status).toBe(400);
    expect(errada.body.error.message).toContain('Senha de segurança inválida');
  });

  it('exige justificativa para excluir o projeto', async () => {
    const admin = await loginAdmin();

    const semBody = await admin
      .delete(`/api/v1/projects/${alvoId}`)
      .set(SECURITY_HEADER, SECURITY_PASSWORD);
    expect(semBody.status).toBe(400);
    expect(semBody.body.error.message).toBe('Informe a justificativa da alteração');

    const corpoCurto = await admin
      .delete(`/api/v1/projects/${alvoId}`)
      .set(SECURITY_HEADER, SECURITY_PASSWORD)
      .send({ justificativa: 'ab' });
    expect(corpoCurto.status).toBe(400);
    expect(corpoCurto.body.error.message).toBe('Informe a justificativa da alteração');
  });

  it('exclui o projeto por definitivo com a senha correta', async () => {
    const admin = await loginAdmin();
    const res = await admin
      .delete(`/api/v1/projects/${alvoId}`)
      .set(SECURITY_HEADER, SECURITY_PASSWORD)
      .send({ justificativa: 'Projeto descontinuado pelo cliente' });
    expect(res.status).toBe(204);

    const row = await pool.query('SELECT 1 FROM projects WHERE id = $1', [alvoId]);
    expect(row.rowCount).toBe(0);

    const databases = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [alvoDb]);
    expect(databases.rowCount).toBe(0);

    const list = await admin.get('/api/v1/projects');
    expect(list.body.some((project: { id: string }) => project.id === alvoId)).toBe(false);

    const auditRow = await pool.query(
      `SELECT meta FROM audit_logs
        WHERE action = 'project_deleted' AND entity = 'project' AND entity_id = $1
        ORDER BY id DESC LIMIT 1`,
      [alvoId],
    );
    expect(auditRow.rowCount).toBe(1);
    expect(auditRow.rows[0].meta.justificativa).toBe('Projeto descontinuado pelo cliente');
    expect(auditRow.rows[0].meta.details).toContain('Justificativa: Projeto descontinuado pelo cliente');

    alvoId = '';
    alvoDb = '';
  });

  it('nao permite editar ou excluir projeto de terceiros', async () => {
    const outsider = await loginOutsider();

    const edit = await outsider
      .patch(`/api/v1/projects/${projectId}`)
      .set(SECURITY_HEADER, SECURITY_PASSWORD)
      .send({ description: 'invasao' });
    expect(edit.status).toBe(403);

    const remove = await outsider
      .delete(`/api/v1/projects/${projectId}`)
      .set(SECURITY_HEADER, SECURITY_PASSWORD);
    expect(remove.status).toBe(403);
  });
});

describe('Projeto concluido', () => {
  let previousStatus = '';
  let memberId = '';

  async function createMemberFixture(): Promise<string> {
    const admin = await loginAdmin();
    const profile = await admin.post('/api/v1/profiles').send({
      name: `Perfil Cong ${Date.now()}`,
      description: 'Perfil para teste de conclusao',
      screens: ['dashboard'],
    });
    expect(profile.status).toBe(201);
    const passwordHash = await hash('cong-teste-123456');
    const created = await pool.query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash, profile_id, is_active)
       VALUES ($1, $2, $3, $4, true) RETURNING id`,
      [`Membro Cong ${Date.now()}`, uniqueEmail('cong'), passwordHash, profile.body.id],
    );
    return created.rows[0].id;
  }

  beforeAll(async () => {
    const admin = await loginAdmin();
    await admin.delete('/api/v1/settings/security-password');
    const created = await admin
      .post('/api/v1/projects')
      .send({
        name: `Projeto Conclusao ${Date.now()}`,
        description: 'Projeto para validar conclusao',
        status: 'Em andamento',
      });
    expect(created.status).toBe(201);
    concludedId = created.body.id;
    previousStatus = created.body.status;
    memberId = await createMemberFixture();
  });

  it('registra project_updated com diff e details em portugues', async () => {
    const admin = await loginAdmin();
    const res = await admin
      .patch(`/api/v1/projects/${concludedId}`)
      .send({ description: 'Descricao revisada pela lideranca', justificativa: 'Atualizacao de escopo' });
    expect(res.status).toBe(200);
    expect(res.body.description).toBe('Descricao revisada pela lideranca');

    const row = await pool.query<{ meta: Record<string, unknown> }>(
      `SELECT meta FROM audit_logs
       WHERE action = 'project_updated' AND entity = 'project' AND entity_id = $1
       ORDER BY id DESC LIMIT 1`,
      [concludedId],
    );
    const meta = row.rows[0]?.meta as {
      changes?: Record<string, { from?: string; to?: string }>;
      fields?: string[];
      details?: string;
    };
    expect(meta.changes?.description).toEqual({
      from: '(texto anterior)',
      to: '(novo texto)',
    });
    expect(meta.fields).toContain('description');
    expect(meta.details).toContain('teve alteração de: descrição');
    expect(meta.details).toContain('Justificativa: Atualizacao de escopo');
  });

  it('exige justificativa na conclusao e na reabertura', async () => {
    const admin = await loginAdmin();

    const semJustificativa = await admin
      .post(`/api/v1/projects/${concludedId}/conclude`)
      .send({});
    expect(semJustificativa.status).toBe(400);
    expect(semJustificativa.body.error.message).toBe('Informe a justificativa da alteração');

    const curta = await admin
      .post(`/api/v1/projects/${concludedId}/conclude`)
      .send({ justificativa: 'ab' });
    expect(curta.status).toBe(400);
    expect(curta.body.error.message).toBe('Informe a justificativa da alteração');

    const reabrirSemJustificativa = await admin
      .post(`/api/v1/projects/${concludedId}/reopen`)
      .send({});
    expect(reabrirSemJustificativa.status).toBe(400);
    expect(reabrirSemJustificativa.body.error.message).toBe(
      'Informe a justificativa da alteração',
    );
  });

  it('conclui o projeto, audita e registra o escopo', async () => {
    const admin = await loginAdmin();
    const res = await admin
      .post(`/api/v1/projects/${concludedId}/conclude`)
      .send({ justificativa: 'Escopo entregue e aprovado' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Concluído');

    const row = await pool.query<{ meta: Record<string, unknown> }>(
      `SELECT meta FROM audit_logs
       WHERE action = 'project_completed' AND entity = 'project' AND entity_id = $1
       ORDER BY id DESC LIMIT 1`,
      [concludedId],
    );
    const meta = row.rows[0]?.meta as {
      details?: string;
      justificativa?: string;
      previous_status?: string;
      scope_required?: boolean;
      scope_validated?: boolean;
    };
    expect(meta.details).toContain('foi marcado como CONCLUÍDO pelo usuário');
    expect(meta.details).toContain('Justificativa: Escopo entregue e aprovado');
    expect(meta.justificativa).toBe('Escopo entregue e aprovado');
    expect(meta.previous_status).toBe(previousStatus);
    expect(meta.scope_required).toBe(false);
    expect(meta.scope_validated).toBe(false);
  });

  it('rejeita conclusao duplicada', async () => {
    const admin = await loginAdmin();
    const res = await admin
      .post(`/api/v1/projects/${concludedId}/conclude`)
      .send({ justificativa: 'Tentativa duplicada' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('Projeto já está concluído');
  });

  it('bloqueia edicao direta, membros, kanban e marcos com projeto concluido', async () => {
    const admin = await loginAdmin();

    const patch = await admin
      .patch(`/api/v1/projects/${concludedId}`)
      .send({ description: 'Tentativa de edicao', justificativa: 'Nao deveria passar' });
    expect(patch.status).toBe(409);
    expect(patch.body.error.message).toBe('Projeto concluído — reabra para editar');

    const member = await admin
      .post(`/api/v1/projects/${concludedId}/members`)
      .send({ user_id: memberId });
    expect(member.status).toBe(409);

    const card = await admin
      .post(`/api/v1/projects/${concludedId}/cards`)
      .send({ title: 'Card bloqueado' });
    expect(card.status).toBe(409);

    const milestone = await admin
      .post(`/api/v1/projects/${concludedId}/milestones`)
      .send({ name: 'Marco bloqueado', due_date: '2026-12-31' });
    expect(milestone.status).toBe(409);

    const columns = await admin.get(`/api/v1/projects/${concludedId}/columns`);
    expect(columns.status).toBe(200);
  });

  it('reabre restaurando o status anterior e audita', async () => {
    const admin = await loginAdmin();
    const res = await admin
      .post(`/api/v1/projects/${concludedId}/reopen`)
      .send({ justificativa: 'Retomada a pedido do cliente' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe(previousStatus);

    const row = await pool.query<{ meta: Record<string, unknown> }>(
      `SELECT meta FROM audit_logs
       WHERE action = 'project_reopened' AND entity = 'project' AND entity_id = $1
       ORDER BY id DESC LIMIT 1`,
      [concludedId],
    );
    const meta = row.rows[0]?.meta as {
      details?: string;
      justificativa?: string;
      restored_status?: string;
    };
    expect(meta.details).toContain('foi reaberto pelo usuário');
    expect(meta.details).toContain('Justificativa: Retomada a pedido do cliente');
    expect(meta.justificativa).toBe('Retomada a pedido do cliente');
    expect(meta.restored_status).toBe(previousStatus);

    const again = await admin
      .post(`/api/v1/projects/${concludedId}/reopen`)
      .send({ justificativa: 'Tentativa repetida' });
    expect(again.status).toBe(409);
    expect(again.body.error.message).toBe('Projeto não está concluído');
  });

  it('libera edicao novamente apos reabertura', async () => {
    const admin = await loginAdmin();
    const res = await admin
      .patch(`/api/v1/projects/${concludedId}`)
      .send({ description: 'Edicao liberada apos reabertura', justificativa: 'Reaberto pela lideranca' });
    expect(res.status).toBe(200);
    expect(res.body.description).toBe('Edicao liberada apos reabertura');
  });

  it('exclui projeto concluido com justificativa e audita', async () => {
    const admin = await loginAdmin();
    const created = await admin.post('/api/v1/projects').send({
      name: `Projeto Exclusao Concluido ${Date.now()}`,
      status: 'Em andamento',
    });
    expect(created.status).toBe(201);
    const tempId = created.body.id as string;
    const tempDb = created.body.db_name as string;

    const concluded = await admin
      .post(`/api/v1/projects/${tempId}/conclude`)
      .send({ justificativa: 'Encerrado para validacao de exclusao' });
    expect(concluded.status).toBe(200);
    expect(concluded.body.status).toBe('Concluído');

    const removed = await admin
      .delete(`/api/v1/projects/${tempId}`)
      .send({ justificativa: 'Excluido apos conclusao' });
    expect(removed.status).toBe(204);

    const row = await pool.query('SELECT 1 FROM projects WHERE id = $1', [tempId]);
    expect(row.rowCount).toBe(0);

    const databases = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [tempDb]);
    expect(databases.rowCount).toBe(0);

    const auditRow = await pool.query<{ meta: Record<string, unknown> }>(
      `SELECT meta FROM audit_logs
        WHERE action = 'project_deleted' AND entity = 'project' AND entity_id = $1
        ORDER BY id DESC LIMIT 1`,
      [tempId],
    );
    expect(auditRow.rowCount).toBe(1);
    const meta = auditRow.rows[0].meta as { justificativa?: string; details?: string };
    expect(meta.justificativa).toBe('Excluido apos conclusao');
    expect(meta.details).toContain('Justificativa: Excluido apos conclusao');
  });
});
