import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, dropProject, setup, uniqueEmail } from './helpers.js';

const app = createApp();
const SECURITY_HEADER = 'x-security-password';
const SECURITY_PASSWORD = 'senha-quadro-123';
const SEM_MEMBRO = '00000000-0000-4000-8000-000000000099';

let agent: ReturnType<typeof request.agent>;
let projectId = '';
let adminId = '';
let sectorId = '';
let departmentId = '';
let novaSolicitacaoId = '';
let concluidoId = '';
let customColumnId = '';
let firstCardId = '';

beforeAll(async () => {
  await setup();
  agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const me = await agent.get('/api/v1/auth/me');
  adminId = me.body.id;

  const created = await agent
    .post('/api/v1/projects')
    .send({ name: `Quadro Teste ${Date.now()}`, description: 'Projeto criado nos testes' });
  expect(created.status).toBe(201);
  projectId = created.body.id;

  await agent
    .put(`/api/v1/settings/security-password`)
    .send({ password: SECURITY_PASSWORD });

  const sector = await agent
    .post(`/api/v1/projects/${projectId}/sectors`)
    .set(SECURITY_HEADER, SECURITY_PASSWORD)
    .send({ name: 'Comercial' });
  sectorId = sector.body.id;

  const department = await agent
    .post(`/api/v1/projects/${projectId}/departments`)
    .set(SECURITY_HEADER, SECURITY_PASSWORD)
    .send({ sector_id: sectorId, name: 'Prospeccao' });
  departmentId = department.body.id;

  const columns = await agent.get(`/api/v1/projects/${projectId}/columns`);
  novaSolicitacaoId = columns.body.find(
    (column: { name: string }) => column.name === 'Nova Solicitacao',
  ).id;
  concluidoId = columns.body.find((column: { name: string }) => column.name === 'Concluido').id;
});

afterAll(async () => {
  if (projectId) await dropProject(projectId);
  await pool.end();
});

describe('Kanban: colunas', () => {
  it('possui cinco colunas padrao bloqueadas', async () => {
    const res = await agent.get(`/api/v1/projects/${projectId}/columns`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(5);
    expect(res.body.every((column: { locked: boolean }) => column.locked)).toBe(true);
    const done = res.body.find((column: { id: string }) => column.id === concluidoId);
    expect(done.is_done).toBe(true);
  });

  it('criar coluna exige senha de segurança', async () => {
    const semSenha = await agent
      .post(`/api/v1/projects/${projectId}/columns`)
      .send({ name: 'Aguardando Cliente', is_done: false });
    expect(semSenha.status).toBe(400);

    const comSenha = await agent
      .post(`/api/v1/projects/${projectId}/columns`)
      .set(SECURITY_HEADER, SECURITY_PASSWORD)
      .send({ name: 'Aguardando Cliente', is_done: false });
    expect(comSenha.status).toBe(201);
    expect(comSenha.body.locked).toBe(false);
    customColumnId = comSenha.body.id;
  });

  it('renomeia coluna propria com senha', async () => {
    const res = await agent
      .patch(`/api/v1/projects/${projectId}/columns/${customColumnId}`)
      .set(SECURITY_HEADER, SECURITY_PASSWORD)
      .send({ name: 'Em Aprovacao' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Em Aprovacao');
  });

  it('impede excluir coluna padrao', async () => {
    const res = await agent
      .delete(`/api/v1/projects/${projectId}/columns/${novaSolicitacaoId}`)
      .set(SECURITY_HEADER, SECURITY_PASSWORD);
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/padrão/i);
  });

  it('move coluna para a primeira posicao', async () => {
    const res = await agent
      .patch(`/api/v1/projects/${projectId}/columns/${customColumnId}`)
      .set(SECURITY_HEADER, SECURITY_PASSWORD)
      .send({ position: 0 });
    expect(res.status).toBe(200);

    const columns = await agent.get(`/api/v1/projects/${projectId}/columns`);
    expect(columns.body[0].id).toBe(customColumnId);
    expect(columns.body.map((column: { position: number }) => column.position)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });
});

describe('Kanban: cards', () => {
  it('cria card vinculado ao departamento e ao responsavel', async () => {
    const res = await agent
      .post(`/api/v1/projects/${projectId}/cards`)
      .send({
        title: 'Levantar requisitos do cliente',
        description: 'Reuniao inicial',
        priority: 'alta',
        department_id: departmentId,
        responsible_id: adminId,
        due_date: '2026-10-30',
        origin: 'kickoff',
        column_id: novaSolicitacaoId,
      });
    expect(res.status).toBe(201);
    firstCardId = res.body.id;

    const list = await agent.get(`/api/v1/projects/${projectId}/cards`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    const card = list.body[0];
    expect(card.id).toBe(firstCardId);
    expect(card.department_name).toBe('Prospeccao');
    expect(card.responsible_name).toBe('Admin Teste');
    expect(card.completed_at).toBeNull();
  });

  it('rejeita departamento inexistente', async () => {
    const res = await agent.post(`/api/v1/projects/${projectId}/cards`).send({
      title: 'Card sem departamento valido',
      department_id: SEM_MEMBRO,
      column_id: novaSolicitacaoId,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/departamento/i);
  });

  it('rejeita responsavel que nao e membro', async () => {
    const res = await agent.post(`/api/v1/projects/${projectId}/cards`).send({
      title: 'Card com responsavel invalido',
      responsible_id: SEM_MEMBRO,
      column_id: novaSolicitacaoId,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/membro/i);
  });

  it('edita card sem precisar de senha de segurança', async () => {
    const res = await agent
      .patch(`/api/v1/projects/${projectId}/cards/${firstCardId}`)
      .send({ title: 'Levantar requisitos (editado)', priority: 'media' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Levantar requisitos (editado)');
    expect(res.body.priority).toBe('media');
  });

  it('filtra cards por texto, departamento e situacao', async () => {
    const outro = await agent.post(`/api/v1/projects/${projectId}/cards`).send({
      title: 'Complementar proposta comercial',
      column_id: novaSolicitacaoId,
    });
    expect(outro.status).toBe(201);

    const porTexto = await agent.get(
      `/api/v1/projects/${projectId}/cards?q=${encodeURIComponent('Complementar')}`,
    );
    expect(porTexto.body).toHaveLength(1);
    expect(porTexto.body[0].title).toBe('Complementar proposta comercial');

    const porDepartamento = await agent.get(
      `/api/v1/projects/${projectId}/cards?department_id=${departmentId}`,
    );
    expect(porDepartamento.body).toHaveLength(1);
    expect(porDepartamento.body[0].id).toBe(firstCardId);

    const pendentes = await agent.get(`/api/v1/projects/${projectId}/cards?status=pending`);
    expect(pendentes.body).toHaveLength(2);

    const concluidos = await agent.get(`/api/v1/projects/${projectId}/cards?status=done`);
    expect(concluidos.body).toHaveLength(0);
  });

  it('marca completed_at ao entrar na coluna de conclusao e recalcula o progresso', async () => {
    const mover = await agent
      .patch(`/api/v1/projects/${projectId}/cards/${firstCardId}`)
      .send({ column_id: concluidoId });
    expect(mover.status).toBe(200);
    expect(mover.body.completed_at).not.toBeNull();

    const concluidos = await agent.get(`/api/v1/projects/${projectId}/cards?status=done`);
    expect(concluidos.body).toHaveLength(1);
    expect(concluidos.body[0].id).toBe(firstCardId);

    const progresso = await agent.get(`/api/v1/projects/${projectId}/progress`);
    const departamento = progresso.body.departments.find(
      (row: { department_id: string }) => row.department_id === departmentId,
    );
    expect(Number(departamento.total_cards)).toBe(1);
    expect(Number(departamento.completed_cards)).toBe(1);
    expect(Number(departamento.percent)).toBe(100);
  });

  it('limpa completed_at ao sair da coluna de conclusao', async () => {
    const voltar = await agent
      .patch(`/api/v1/projects/${projectId}/cards/${firstCardId}`)
      .send({ column_id: novaSolicitacaoId, position: 1 });
    expect(voltar.status).toBe(200);
    expect(voltar.body.completed_at).toBeNull();

    const progresso = await agent.get(`/api/v1/projects/${projectId}/progress`);
    const departamento = progresso.body.departments.find(
      (row: { department_id: string }) => row.department_id === departmentId,
    );
    expect(Number(departamento.completed_cards)).toBe(0);
    expect(Number(departamento.percent)).toBe(0);
  });

  it('reordena cards dentro da coluna', async () => {
    const antes = await agent.get(
      `/api/v1/projects/${projectId}/cards?department_id=${departmentId}`,
    );
    expect(antes.body[0].id).toBe(firstCardId);

    const mover = await agent
      .patch(`/api/v1/projects/${projectId}/cards/${firstCardId}`)
      .send({ position: 1 });
    expect(mover.status).toBe(200);

    const naColuna = await agent.get(
      `/api/v1/projects/${projectId}/cards?q=${encodeURIComponent('Complementar')}`,
    );
    expect(naColuna.body).toHaveLength(1);
    const ordem = await agent.get(`/api/v1/projects/${projectId}/cards`);
    const naPrimeiraColuna = ordem.body.filter(
      (card: { column_id: string }) => card.column_id === novaSolicitacaoId,
    );
    expect(naPrimeiraColuna[naPrimeiraColuna.length - 1].id).toBe(firstCardId);
  });

  it('exclui card apenas com senha de segurança', async () => {
    const semSenha = await agent.delete(
      `/api/v1/projects/${projectId}/cards/${firstCardId}`,
    );
    expect(semSenha.status).toBe(400);

    const comSenha = await agent
      .delete(`/api/v1/projects/${projectId}/cards/${firstCardId}`)
      .set(SECURITY_HEADER, SECURITY_PASSWORD);
    expect(comSenha.status).toBe(204);
  });

  it('impede excluir coluna com cards', async () => {
    const cards = await agent.get(
      `/api/v1/projects/${projectId}/cards?q=${encodeURIComponent('Complementar')}`,
    );
    const mover = await agent
      .patch(`/api/v1/projects/${projectId}/cards/${cards.body[0].id}`)
      .send({ column_id: customColumnId });
    expect(mover.status).toBe(200);

    const res = await agent
      .delete(`/api/v1/projects/${projectId}/columns/${customColumnId}`)
      .set(SECURITY_HEADER, SECURITY_PASSWORD);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/cards/i);
  });

  it('retorna 404 para card inexistente', async () => {
    const res = await agent
      .delete(`/api/v1/projects/${projectId}/cards/${SEM_MEMBRO}`)
      .set(SECURITY_HEADER, SECURITY_PASSWORD);
    expect(res.status).toBe(404);
  });
});

describe('Kanban: cor e limpeza de coluna', () => {
  it('define, valida e limpa a cor de uma coluna', async () => {
    const set = await agent
      .patch(`/api/v1/projects/${projectId}/columns/${customColumnId}`)
      .set(SECURITY_HEADER, SECURITY_PASSWORD)
      .send({ color: '#112233' });
    expect(set.status).toBe(200);
    expect(set.body.color).toBe('#112233');

    const columns = await agent.get(`/api/v1/projects/${projectId}/columns`);
    const saved = columns.body.find((column: { id: string }) => column.id === customColumnId);
    expect(saved.color).toBe('#112233');
    const padrao = columns.body.find((column: { id: string }) => column.id === novaSolicitacaoId);
    expect(padrao.color).toBeNull();

    const invalida = await agent
      .patch(`/api/v1/projects/${projectId}/columns/${customColumnId}`)
      .set(SECURITY_HEADER, SECURITY_PASSWORD)
      .send({ color: 'azul' });
    expect(invalida.status).toBe(400);

    const reset = await agent
      .patch(`/api/v1/projects/${projectId}/columns/${customColumnId}`)
      .set(SECURITY_HEADER, SECURITY_PASSWORD)
      .send({ color: null });
    expect(reset.status).toBe(200);
    expect(reset.body.color).toBeNull();
  });

  it('limpa as tarefas de uma coluna com senha e permite exclui-la', async () => {
    const semSenha = await agent.delete(
      `/api/v1/projects/${projectId}/columns/${customColumnId}/cards`,
    );
    expect(semSenha.status).toBe(400);

    const comSenha = await agent
      .delete(`/api/v1/projects/${projectId}/columns/${customColumnId}/cards`)
      .set(SECURITY_HEADER, SECURITY_PASSWORD);
    expect(comSenha.status).toBe(200);
    expect(comSenha.body.deleted).toBe(1);

    const cards = await agent.get(`/api/v1/projects/${projectId}/cards`);
    expect(
      cards.body.filter((card: { column_id: string }) => card.column_id === customColumnId),
    ).toHaveLength(0);

    const excluir = await agent
      .delete(`/api/v1/projects/${projectId}/columns/${customColumnId}`)
      .set(SECURITY_HEADER, SECURITY_PASSWORD);
    expect(excluir.status).toBe(204);
  });
});

describe('Kanban: codigo do card (ST-XXXX)', () => {
  let cardAId = '';
  let cardACode = '';

  it('gera codigo ST-XXXX unico no momento da criacao', async () => {
    const a = await agent
      .post(`/api/v1/projects/${projectId}/cards`)
      .send({ title: 'Card com codigo identificador', column_id: novaSolicitacaoId });
    expect(a.status).toBe(201);
    expect(a.body.task_code).toMatch(/^ST-\d{4}$/);
    cardAId = a.body.id;
    cardACode = a.body.task_code;

    const b = await agent
      .post(`/api/v1/projects/${projectId}/cards`)
      .send({ title: 'Segundo card com codigo', column_id: novaSolicitacaoId });
    expect(b.status).toBe(201);
    expect(b.body.task_code).toMatch(/^ST-\d{4}$/);
    expect(b.body.task_code).not.toBe(cardACode);
  });

  it('busca por codigo com e sem prefixo ST-', async () => {
    const comPrefixo = await agent.get(
      `/api/v1/projects/${projectId}/cards?q=${encodeURIComponent(cardACode)}`,
    );
    expect(comPrefixo.body).toHaveLength(1);
    expect(comPrefixo.body[0].id).toBe(cardAId);
    expect(comPrefixo.body[0].task_code).toBe(cardACode);

    const soDigitos = await agent.get(
      `/api/v1/projects/${projectId}/cards?q=${encodeURIComponent(cardACode.slice(3))}`,
    );
    expect(soDigitos.body.some((card: { id: string }) => card.id === cardAId)).toBe(true);
  });

  it('task_code e imutavel: PATCH nao altera o codigo', async () => {
    const comOutroCampo = await agent
      .patch(`/api/v1/projects/${projectId}/cards/${cardAId}`)
      .send({ title: 'Titulo alterado (imutabilidade)', task_code: 'ST-9999' });
    expect(comOutroCampo.status).toBe(200);
    expect(comOutroCampo.body.task_code).toBe(cardACode);

    const soCodigo = await agent
      .patch(`/api/v1/projects/${projectId}/cards/${cardAId}`)
      .send({ task_code: 'ST-9999' });
    expect(soCodigo.status).toBe(400);

    const list = await agent.get(
      `/api/v1/projects/${projectId}/cards?q=${encodeURIComponent(cardACode)}`,
    );
    expect(list.body[0].task_code).toBe(cardACode);
  });
});

describe('Kanban: sub-tarefas', () => {
  let cardA = '';
  let cardB = '';
  let cardC = '';

  beforeAll(async () => {
    const a = await agent
      .post(`/api/v1/projects/${projectId}/cards`)
      .send({ title: 'Card pai sub-tarefas', column_id: novaSolicitacaoId });
    cardA = a.body.id;
    const b = await agent
      .post(`/api/v1/projects/${projectId}/cards`)
      .send({ title: 'Card filho um', column_id: novaSolicitacaoId });
    cardB = b.body.id;
    const c = await agent
      .post(`/api/v1/projects/${projectId}/cards`)
      .send({ title: 'Card filho dois', column_id: novaSolicitacaoId });
    cardC = c.body.id;
  });

  it('vincula sub-tarefa e lista com titulo e coluna', async () => {
    const res = await agent
      .post(`/api/v1/projects/${projectId}/cards/${cardA}/subtasks`)
      .send({ subtask_id: cardB });
    expect(res.status).toBe(201);

    const list = await agent.get(`/api/v1/projects/${projectId}/cards/${cardA}/subtasks`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].title).toBe('Card filho um');
    expect(list.body[0].column_name).toBeTruthy();
  });

  it('rejeita vinculo duplicado e self-reference', async () => {
    const duplicado = await agent
      .post(`/api/v1/projects/${projectId}/cards/${cardA}/subtasks`)
      .send({ subtask_id: cardB });
    expect(duplicado.status).toBe(409);

    const self = await agent
      .post(`/api/v1/projects/${projectId}/cards/${cardA}/subtasks`)
      .send({ subtask_id: cardA });
    expect(self.status).toBe(400);
    expect(self.body.error.message).toMatch(/si mesmo/i);
  });

  it('rejeita ciclo A para B quando B ja contem A', async () => {
    const bContemC = await agent
      .post(`/api/v1/projects/${projectId}/cards/${cardB}/subtasks`)
      .send({ subtask_id: cardC });
    expect(bContemC.status).toBe(201);

    const ciclo = await agent
      .post(`/api/v1/projects/${projectId}/cards/${cardC}/subtasks`)
      .send({ subtask_id: cardB });
    expect(ciclo.status).toBe(400);
    expect(ciclo.body.error.message).toMatch(/ciclo/i);
  });

  it('desvincula sub-tarefa', async () => {
    const res = await agent.delete(
      `/api/v1/projects/${projectId}/cards/${cardA}/subtasks/${cardB}`,
    );
    expect(res.status).toBe(204);

    const list = await agent.get(`/api/v1/projects/${projectId}/cards/${cardA}/subtasks`);
    expect(list.body).toHaveLength(0);
  });
});

describe('Kanban: vinculo reverso (parents)', () => {
  let parentX = '';
  let parentY = '';
  let childZ = '';

  beforeAll(async () => {
    const x = await agent
      .post(`/api/v1/projects/${projectId}/cards`)
      .send({ title: 'Card pai X', column_id: novaSolicitacaoId });
    parentX = x.body.id;
    const y = await agent
      .post(`/api/v1/projects/${projectId}/cards`)
      .send({ title: 'Card pai Y', column_id: novaSolicitacaoId });
    parentY = y.body.id;
    const z = await agent
      .post(`/api/v1/projects/${projectId}/cards`)
      .send({ title: 'Card filho Z', column_id: novaSolicitacaoId });
    childZ = z.body.id;
  });

  it('devolve lista vazia quando o card nao tem pai', async () => {
    const res = await agent.get(`/api/v1/projects/${projectId}/cards/${parentX}/parents`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('lista multiplos pais com titulo, codigo e coluna', async () => {
    await agent
      .post(`/api/v1/projects/${projectId}/cards/${parentX}/subtasks`)
      .send({ subtask_id: childZ });
    await agent
      .post(`/api/v1/projects/${projectId}/cards/${parentY}/subtasks`)
      .send({ subtask_id: childZ });

    const res = await agent.get(`/api/v1/projects/${projectId}/cards/${childZ}/parents`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const codes = res.body.map((row: { task_code: string }) => row.task_code).sort();
    const expected = [parentX, parentY]
      .map((id) => res.body.find((row: { card_id: string }) => row.card_id === id)?.task_code)
      .sort();
    expect(codes).toEqual(expected);
    for (const row of res.body) {
      expect(row.title).toBeTruthy();
      expect(row.task_code).toMatch(/^ST-/);
      expect(row.column_name).toBeTruthy();
    }
  });
});

describe('Kanban: limites dinamicos de caracteres', () => {
  async function setLimits(titleMax: number, descriptionMax: number): Promise<void> {
    await pool.query(
      'UPDATE system_settings SET title_max_chars = $1, description_max_chars = $2 WHERE id = 1',
      [titleMax, descriptionMax],
    );
  }

  afterAll(async () => {
    await setLimits(200, 4000);
  });

  it('rejeita titulo acima do limite configurado', async () => {
    await setLimits(30, 4000);
    try {
      const res = await agent
        .post(`/api/v1/projects/${projectId}/cards`)
        .send({ title: 'Titulo bem longo para estourar o limite', column_id: novaSolicitacaoId });
      expect(res.status).toBe(400);
    } finally {
      await setLimits(200, 4000);
    }
  });

  it('rejeita descricao acima do limite configurado e aceita dentro', async () => {
    await setLimits(200, 100);
    try {
      const longa = 'x'.repeat(150);
      const rejeitada = await agent
        .post(`/api/v1/projects/${projectId}/cards`)
        .send({ title: 'Card limites', description: longa, column_id: novaSolicitacaoId });
      expect(rejeitada.status).toBe(400);
      expect(rejeitada.body.error.message).toMatch(/limite/i);

      const ok = await agent
        .post(`/api/v1/projects/${projectId}/cards`)
        .send({ title: 'Card limites ok', description: 'y'.repeat(90), column_id: novaSolicitacaoId });
      expect(ok.status).toBe(201);
    } finally {
      await setLimits(200, 4000);
    }
  });

  it('PATCH tambem respeita o limite vigente', async () => {
    const card = await agent
      .post(`/api/v1/projects/${projectId}/cards`)
      .send({ title: 'Card patch limites', column_id: novaSolicitacaoId });
    await setLimits(200, 100);
    try {
      const res = await agent
        .patch(`/api/v1/projects/${projectId}/cards/${card.body.id}`)
        .send({ description: 'z'.repeat(150) });
      expect(res.status).toBe(400);
    } finally {
      await setLimits(200, 4000);
    }
  });
});

describe('Kanban: atividade e comentarios', () => {
  let activityCardId = '';

  beforeAll(async () => {
    const res = await agent
      .post(`/api/v1/projects/${projectId}/cards`)
      .send({ title: 'Card para atividade', column_id: novaSolicitacaoId });
    activityCardId = res.body.id;
  });

  it('registra evento de criacao na atividade', async () => {
    const res = await agent.get(
      `/api/v1/projects/${projectId}/cards/${activityCardId}/activity`,
    );
    expect(res.status).toBe(200);
    const created = res.body.find((item: { action: string }) => item.action === 'card_created');
    expect(created).toBeTruthy();
    expect(created.kind).toBe('event');
    expect(created.user_name).toBe('Admin Teste');
  });

  it('registra mudancas com from e to no audit do PATCH', async () => {
    await agent
      .patch(`/api/v1/projects/${projectId}/cards/${activityCardId}`)
      .send({ title: 'Card para atividade (editado)', priority: 'alta' });

    const res = await agent.get(
      `/api/v1/projects/${projectId}/cards/${activityCardId}/activity`,
    );
    const updated = res.body.find((item: { action: string }) => item.action === 'card_updated');
    expect(updated).toBeTruthy();
    expect(updated.meta.changes.title).toEqual({
      from: 'Card para atividade',
      to: 'Card para atividade (editado)',
    });
    expect(updated.meta.changes.priority).toEqual({ from: 'media', to: 'alta' });
  });

  it('adiciona comentario e ele aparece na atividade', async () => {
    const res = await agent
      .post(`/api/v1/projects/${projectId}/cards/${activityCardId}/comments`)
      .send({ body: 'Cliente aguarda retorno do juridico' });
    expect(res.status).toBe(201);

    const activity = await agent.get(
      `/api/v1/projects/${projectId}/cards/${activityCardId}/activity`,
    );
    const comment = activity.body.find((item: { kind: string }) => item.kind === 'comment');
    expect(comment).toBeTruthy();
    expect(comment.body).toBe('Cliente aguarda retorno do juridico');
    expect(comment.user_name).toBe('Admin Teste');
  });

  it('rejeita comentario vazio', async () => {
    const res = await agent
      .post(`/api/v1/projects/${projectId}/cards/${activityCardId}/comments`)
      .send({ body: '   ' });
    expect(res.status).toBe(400);
  });

  it('ordena atividade do mais recente para o mais antigo', async () => {
    const res = await agent.get(
      `/api/v1/projects/${projectId}/cards/${activityCardId}/activity`,
    );
    const timestamps = res.body.map((item: { created_at: string }) =>
      new Date(item.created_at).getTime(),
    );
    const sorted = [...timestamps].sort((a, b) => b - a);
    expect(timestamps).toEqual(sorted);
  });
});

describe('Kanban: sanitizacao de descricao', () => {
  it('rejeita script no POST e no PATCH', async () => {
    const post = await agent.post(`/api/v1/projects/${projectId}/cards`).send({
      title: 'Card com script',
      description: '<script>alert(1)</script>',
      column_id: novaSolicitacaoId,
    });
    expect(post.status).toBe(400);
    expect(post.body.error.message).toMatch(/não permitido/i);

    const created = await agent
      .post(`/api/v1/projects/${projectId}/cards`)
      .send({ title: 'Card limpo', column_id: novaSolicitacaoId });
    const patch = await agent
      .patch(`/api/v1/projects/${projectId}/cards/${created.body.id}`)
      .send({ description: '<img src=x onerror=alert(1)>' });
    expect(patch.status).toBe(400);
  });
});

describe('Kanban: uploads de imagem', () => {
  const PNG_1PX =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  it('aceita PNG valido e retorna url com uuid', async () => {
    const res = await agent
      .post(`/api/v1/projects/${projectId}/uploads`)
      .send({ filename: 'pixel.png', data_base64: PNG_1PX });
    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/^\/uploads\/[0-9a-f-]{36}\.png$/);
  });

  it('rejeita arquivo maior que 2 MB', async () => {
    const grande = 'A'.repeat(3 * 1024 * 1024);
    const res = await agent
      .post(`/api/v1/projects/${projectId}/uploads`)
      .send({ filename: 'grande.png', data_base64: grande });
    expect(res.status).toBe(400);
  });

  it('rejeita formato que nao e imagem', async () => {
    const res = await agent
      .post(`/api/v1/projects/${projectId}/uploads`)
      .send({ filename: 'nota.txt', data_base64: Buffer.from('apenas texto').toString('base64') });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/formato/i);
  });
});

describe('Kanban: rich card — responsaveis N:N', () => {
  let memberAgent: ReturnType<typeof request.agent>;
  let memberId = '';
  let richCardId = '';

  beforeAll(async () => {
    const me = await agent.get('/api/v1/auth/me');
    const adminProfileId = me.body.profile.id;

    const email = uniqueEmail('rich-member');
    const password = 'senha-rich-123456';
    const invite = await agent.post('/api/v1/auth/invite').send({
      email,
      profile_id: adminProfileId,
      project_ids: [projectId],
    });
    expect(invite.status).toBe(201);
    const token = String(invite.body.invite_url).split('/convite/')[1];
    const accepted = await request(app).post('/api/v1/auth/accept-invite').send({
      token,
      name: 'Membro Rich',
      password,
    });
    expect(accepted.status).toBe(201);

    memberAgent = request.agent(app);
    const login = await memberAgent.post('/api/v1/auth/login').send({ email, password });
    expect(login.status).toBe(200);

    const memberRow = await pool.query<{ id: string }>(
      'SELECT id FROM users WHERE email = $1',
      [email],
    );
    memberId = memberRow.rows[0]!.id;
  });

  it('cria card com multiplos responsaveis via responsible_ids', async () => {
    const res = await agent.post(`/api/v1/projects/${projectId}/cards`).send({
      title: 'Card rich N:N',
      responsible_ids: [adminId, memberId],
      column_id: novaSolicitacaoId,
    });
    expect(res.status).toBe(201);
    richCardId = res.body.id;

    const list = await agent.get(`/api/v1/projects/${projectId}/cards`);
    const card = list.body.find((c: { id: string }) => c.id === richCardId);
    expect(card.responsibles).toHaveLength(2);
    expect(card.responsibles.map((r: { id: string }) => r.id).sort()).toEqual(
      [adminId, memberId].sort(),
    );
    expect(card.responsible_id).toBe(adminId);
    expect(card.responsible_name).toBe('Admin Teste');
  });

  it('rejeita responsible_ids com nao-membro', async () => {
    const res = await agent.post(`/api/v1/projects/${projectId}/cards`).send({
      title: 'Card responsavel invalido',
      responsible_ids: [SEM_MEMBRO],
      column_id: novaSolicitacaoId,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/membro/i);
  });

  it('atualiza responsaveis via PATCH responsible_ids', async () => {
    const res = await agent
      .patch(`/api/v1/projects/${projectId}/cards/${richCardId}`)
      .send({ responsible_ids: [] });
    expect(res.status).toBe(200);

    const list = await agent.get(`/api/v1/projects/${projectId}/cards`);
    const card = list.body.find((c: { id: string }) => c.id === richCardId);
    expect(card.responsibles).toHaveLength(0);
    expect(card.responsible_id).toBeNull();
  });

  it('assumir adiciona usuario logado preservando outros', async () => {
    const res = await memberAgent.post(
      `/api/v1/projects/${projectId}/cards/${richCardId}/assumir`,
    );
    expect(res.status).toBe(200);
    expect(res.body.assigned).toBe(true);
    expect(res.body.responsibles).toHaveLength(1);
    expect(res.body.responsibles[0].id).toBe(memberId);
  });

  it('assumir de novo remove apenas o proprio usuario', async () => {
    const res = await memberAgent.post(
      `/api/v1/projects/${projectId}/cards/${richCardId}/assumir`,
    );
    expect(res.status).toBe(200);
    expect(res.body.assigned).toBe(false);
    expect(res.body.responsibles).toHaveLength(0);
    expect(res.body.responsible_id).toBeNull();
  });

  it('filtro responsible_id encontra card via card_responsibles', async () => {
    await agent
      .patch(`/api/v1/projects/${projectId}/cards/${richCardId}`)
      .send({ responsible_ids: [adminId, memberId] });

    const byAdmin = await agent.get(
      `/api/v1/projects/${projectId}/cards?responsible_id=${adminId}`,
    );
    expect(byAdmin.body.some((c: { id: string }) => c.id === richCardId)).toBe(true);

    const byMember = await agent.get(
      `/api/v1/projects/${projectId}/cards?responsible_id=${memberId}`,
    );
    expect(byMember.body.some((c: { id: string }) => c.id === richCardId)).toBe(true);
  });

  it('compat: POST com responsible_id single ainda funciona', async () => {
    const res = await agent.post(`/api/v1/projects/${projectId}/cards`).send({
      title: 'Card compat single',
      responsible_id: adminId,
      column_id: novaSolicitacaoId,
    });
    expect(res.status).toBe(201);

    const list = await agent.get(`/api/v1/projects/${projectId}/cards`);
    const card = list.body.find((c: { id: string }) => c.id === res.body.id);
    expect(card.responsibles).toHaveLength(1);
    expect(card.responsibles[0].id).toBe(adminId);
    expect(card.responsible_id).toBe(adminId);
  });
});

describe('Kanban: rich card — contadores', () => {
  let countCardId = '';
  let subtaskA = '';
  let subtaskB = '';

  beforeAll(async () => {
    const created = await agent.post(`/api/v1/projects/${projectId}/cards`).send({
      title: 'Card contadores',
      column_id: novaSolicitacaoId,
    });
    expect(created.status).toBe(201);
    countCardId = created.body.id;

    const a = await agent.post(`/api/v1/projects/${projectId}/cards`).send({
      title: 'Subtarefa A',
      column_id: novaSolicitacaoId,
    });
    subtaskA = a.body.id;
    const b = await agent.post(`/api/v1/projects/${projectId}/cards`).send({
      title: 'Subtarefa B',
      column_id: novaSolicitacaoId,
    });
    subtaskB = b.body.id;

    await agent
      .post(`/api/v1/projects/${projectId}/cards/${countCardId}/subtasks`)
      .send({ subtask_id: subtaskA });
    await agent
      .post(`/api/v1/projects/${projectId}/cards/${countCardId}/subtasks`)
      .send({ subtask_id: subtaskB });
    await agent
      .patch(`/api/v1/projects/${projectId}/cards/${subtaskA}`)
      .send({ column_id: concluidoId });
  });

  it('GET /cards retorna subtasks_done e subtasks_total', async () => {
    const list = await agent.get(`/api/v1/projects/${projectId}/cards`);
    const card = list.body.find((c: { id: string }) => c.id === countCardId);
    expect(card.subtasks_total).toBe(2);
    expect(card.subtasks_done).toBe(1);
  });

  it('GET /cards retorna comments_count apos criar comentarios', async () => {
    await agent
      .post(`/api/v1/projects/${projectId}/cards/${countCardId}/comments`)
      .send({ body: 'Primeiro comentario' });
    await agent
      .post(`/api/v1/projects/${projectId}/cards/${countCardId}/comments`)
      .send({ body: 'Segundo comentario' });

    const list = await agent.get(`/api/v1/projects/${projectId}/cards`);
    const card = list.body.find((c: { id: string }) => c.id === countCardId);
    expect(card.comments_count).toBe(2);
  });

  it('upload com card_id cria registro e attachments_count', async () => {
    const PNG_1PX =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const res = await agent
      .post(`/api/v1/projects/${projectId}/uploads`)
      .send({ filename: 'anexo.png', data_base64: PNG_1PX, card_id: countCardId });
    expect(res.status).toBe(201);
    expect(res.body.attachment_id).toBeTruthy();

    const list = await agent.get(`/api/v1/projects/${projectId}/cards`);
    const card = list.body.find((c: { id: string }) => c.id === countCardId);
    expect(card.attachments_count).toBe(1);
  });

  it('upload sem card_id nao cria attachment', async () => {
    const PNG_1PX =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const res = await agent
      .post(`/api/v1/projects/${projectId}/uploads`)
      .send({ filename: 'solto.png', data_base64: PNG_1PX });
    expect(res.status).toBe(201);
    expect(res.body.attachment_id).toBeNull();
  });

  it('upload com card_id inexistente retorna 404', async () => {
    const PNG_1PX =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const res = await agent
      .post(`/api/v1/projects/${projectId}/uploads`)
      .send({ filename: 'errado.png', data_base64: PNG_1PX, card_id: SEM_MEMBRO });
    expect(res.status).toBe(404);
  });
});

describe('Kanban: anexos do card (galeria)', () => {
  const PNG_1PX =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  let galleryCardId = '';
  let attachmentA = '';
  let attachmentB = '';
  let attachmentC = '';

  beforeAll(async () => {
    const created = await agent.post(`/api/v1/projects/${projectId}/cards`).send({
      title: 'Card galeria de anexos',
      column_id: novaSolicitacaoId,
    });
    expect(created.status).toBe(201);
    galleryCardId = created.body.id;

    for (const filename of ['primeira.png', 'segunda.png', 'terceira.png']) {
      const res = await agent
        .post(`/api/v1/projects/${projectId}/uploads`)
        .send({ filename, data_base64: PNG_1PX, card_id: galleryCardId });
      expect(res.status).toBe(201);
      if (filename === 'primeira.png') attachmentA = res.body.attachment_id;
      if (filename === 'segunda.png') attachmentB = res.body.attachment_id;
      if (filename === 'terceira.png') attachmentC = res.body.attachment_id;
    }
  });

  it('lista anexos em ordem de insercao com position sequencial', async () => {
    const res = await agent.get(`/api/v1/projects/${projectId}/cards/${galleryCardId}/attachments`);
    expect(res.status).toBe(200);
    expect(res.body.map((row: { filename: string }) => row.filename)).toEqual([
      'primeira.png',
      'segunda.png',
      'terceira.png',
    ]);
    expect(res.body.map((row: { position: number }) => row.position)).toEqual([0, 1, 2]);
  });

  it('renomeia anexo e reflete no contador de lista', async () => {
    const res = await agent
      .patch(`/api/v1/projects/${projectId}/cards/${galleryCardId}/attachments/${attachmentA}`)
      .send({ filename: 'primeira-renomeada.png' });
    expect(res.status).toBe(200);
    expect(res.body.filename).toBe('primeira-renomeada.png');

    const list = await agent.get(
      `/api/v1/projects/${projectId}/cards/${galleryCardId}/attachments`,
    );
    expect(list.body[0].filename).toBe('primeira-renomeada.png');
  });

  it('reordena anexos preservando posicoes sem buracos', async () => {
    const res = await agent
      .patch(`/api/v1/projects/${projectId}/cards/${galleryCardId}/attachments`)
      .send({ order: [attachmentC, attachmentA, attachmentB] });
    expect(res.status).toBe(200);

    const list = await agent.get(
      `/api/v1/projects/${projectId}/cards/${galleryCardId}/attachments`,
    );
    expect(list.body.map((row: { id: string }) => row.id)).toEqual([
      attachmentC,
      attachmentA,
      attachmentB,
    ]);
    expect(list.body.map((row: { position: number }) => row.position)).toEqual([0, 1, 2]);
  });

  it('rejeita order que nao corresponde aos anexos do card', async () => {
    const res = await agent
      .patch(`/api/v1/projects/${projectId}/cards/${galleryCardId}/attachments`)
      .send({ order: [attachmentA] });
    expect(res.status).toBe(400);
  });

  it('remove anexo, apaga do disco e reduz attachments_count', async () => {
    const res = await agent.delete(
      `/api/v1/projects/${projectId}/cards/${galleryCardId}/attachments/${attachmentB}`,
    );
    expect(res.status).toBe(204);

    const list = await agent.get(
      `/api/v1/projects/${projectId}/cards/${galleryCardId}/attachments`,
    );
    expect(list.body.map((row: { id: string }) => row.id)).toEqual([attachmentC, attachmentA]);

    const cards = await agent.get(`/api/v1/projects/${projectId}/cards`);
    const card = cards.body.find((row: { id: string }) => row.id === galleryCardId);
    expect(card.attachments_count).toBe(2);
  });

  it('retorna 404 para anexo inexistente em rename e delete', async () => {
    const rename = await agent
      .patch(`/api/v1/projects/${projectId}/cards/${galleryCardId}/attachments/${SEM_MEMBRO}`)
      .send({ filename: 'fantasma.png' });
    expect(rename.status).toBe(404);

    const remove = await agent.delete(
      `/api/v1/projects/${projectId}/cards/${galleryCardId}/attachments/${SEM_MEMBRO}`,
    );
    expect(remove.status).toBe(404);
  });

  it('retorna 404 para card inexistente em GET de anexos', async () => {
    const res = await agent.get(`/api/v1/projects/${projectId}/cards/${SEM_MEMBRO}/attachments`);
    expect(res.status).toBe(404);
  });
});

describe('Kanban: auto-marca coluna de conclusao pelo nome', () => {
  let healColumnId = '';
  let preExistingCardId = '';
  let movingCardId = '';

  beforeAll(async () => {
    const column = await agent
      .post(`/api/v1/projects/${projectId}/columns`)
      .set(SECURITY_HEADER, SECURITY_PASSWORD)
      .send({ name: 'Concluído', is_done: false });
    expect(column.status).toBe(201);
    expect(column.body.is_done).toBe(false);
    healColumnId = column.body.id;

    const pre = await agent.post(`/api/v1/projects/${projectId}/cards`).send({
      title: 'Ja estava na coluna de conclusao',
      column_id: healColumnId,
    });
    expect(pre.status).toBe(201);
    preExistingCardId = pre.body.id;

    const mover = await agent.post(`/api/v1/projects/${projectId}/cards`).send({
      title: 'Card a concluir via auto-marca',
      column_id: novaSolicitacaoId,
    });
    expect(mover.status).toBe(201);
    movingCardId = mover.body.id;
  });

  it('mover para coluna "Concluido" sem is_done marca coluna, conclui o card e faz backfill', async () => {
    const res = await agent
      .patch(`/api/v1/projects/${projectId}/cards/${movingCardId}`)
      .send({ column_id: healColumnId });
    expect(res.status).toBe(200);
    expect(res.body.completed_at).not.toBeNull();

    const columns = await agent.get(`/api/v1/projects/${projectId}/columns`);
    const healed = columns.body.find((column: { id: string }) => column.id === healColumnId);
    expect(healed.is_done).toBe(true);

    const list = await agent.get(`/api/v1/projects/${projectId}/cards`);
    const preCard = list.body.find((card: { id: string }) => card.id === preExistingCardId);
    expect(preCard.completed_at).not.toBeNull();
  });
});
