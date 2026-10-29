import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool, queryOne } from '../src/db/pool.js';
import {
  extractMentionUserIds,
  extractMentionUserIdsByText,
  runDeadlineScan,
} from '../src/services/notifications.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, dropProject, setup, uniqueEmail } from './helpers.js';

const app = createApp();

interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string;
  card_id: string | null;
  link: string | null;
  read_at: string | null;
}

let agent: ReturnType<typeof request.agent>;
let memberAgent: ReturnType<typeof request.agent>;
let memberId = '';
let memberName = '';
let projectId = '';
let columnId = '';

function localDate(daysFromNow: number): string {
  const date = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

beforeAll(async () => {
  await setup();
  agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const me = await agent.get('/api/v1/auth/me');

  const created = await agent
    .post('/api/v1/projects')
    .send({ name: `Notif Teste ${Date.now()}`, description: 'Projeto criado nos testes' });
  expect(created.status).toBe(201);
  projectId = created.body.id;

  const columns = await agent.get(`/api/v1/projects/${projectId}/columns`);
  columnId = columns.body[0].id;

  const email = uniqueEmail('notif-member');
  const password = 'senha-notif-123456';
  const invite = await agent.post('/api/v1/auth/invite').send({
    email,
    profile_id: me.body.profile.id,
    project_ids: [projectId],
  });
  expect(invite.status).toBe(201);
  const token = String(invite.body.invite_url).split('/convite/')[1];
  const accepted = await request(app).post('/api/v1/auth/accept-invite').send({
    token,
    name: 'Membro Notif',
    password,
  });
  expect(accepted.status).toBe(201);

  memberAgent = request.agent(app);
  const login = await memberAgent.post('/api/v1/auth/login').send({ email, password });
  expect(login.status).toBe(200);

  const memberRow = await queryOne<{ id: string; name: string }>(
    'SELECT id, name FROM users WHERE email = $1',
    [email],
  );
  memberId = memberRow!.id;
  memberName = memberRow!.name;

  await pool.query('DELETE FROM notifications');
});

afterAll(async () => {
  if (projectId) await dropProject(projectId);
  await pool.end();
});

async function memberNotifications(): Promise<NotificationDto[]> {
  const res = await memberAgent.get('/api/v1/notifications');
  expect(res.status).toBe(200);
  return res.body.items as NotificationDto[];
}

describe('Notificacoes: extracao de mencoes', () => {
  it('extrai usuarios a partir de data-user no HTML', () => {
    const html = `<span class="mention-pill mention-pill-user" data-user="${memberId}">@${memberName}</span> texto`;
    expect(extractMentionUserIds(html)).toEqual([memberId]);
    expect(extractMentionUserIds('sem mencoes')).toEqual([]);
  });

  it('extrai usuarios a partir do nome no texto plano', () => {
    const members = [
      { id: memberId, name: memberName },
      { id: '11111111-1111-4111-8111-111111111111', name: 'Outro Colega' },
    ];
    const mentioned = extractMentionUserIdsByText(`Oi @${memberName}, consegue revisar?`, members);
    expect(mentioned).toEqual([memberId]);

    const none = extractMentionUserIdsByText('sem mencao aqui', members);
    expect(none).toEqual([]);
  });
});

describe('Notificacoes: rotas', () => {
  it('exige autenticacao', async () => {
    const list = await request(app).get('/api/v1/notifications');
    expect(list.status).toBe(401);

    const readAll = await request(app).post('/api/v1/notifications/read-all');
    expect(readAll.status).toBe(401);
  });

  it('nao notifica o proprio autor da acao', async () => {
    await pool.query('DELETE FROM notifications');
    const created = await agent.post(`/api/v1/projects/${projectId}/cards`).send({
      title: 'Card sem notificacao propria',
      column_id: columnId,
    });
    expect(created.status).toBe(201);

    const adminList = await agent.get('/api/v1/notifications');
    expect(adminList.status).toBe(200);
    const own = (adminList.body.items as NotificationDto[]).filter(
      (item) => item.card_id === created.body.id,
    );
    expect(own).toHaveLength(0);
  });

  it('notifica responsavel ao criar card', async () => {
    await pool.query('DELETE FROM notifications');
    const created = await agent.post(`/api/v1/projects/${projectId}/cards`).send({
      title: 'Card com responsavel',
      column_id: columnId,
      responsible_ids: [memberId],
    });
    expect(created.status).toBe(201);

    const items = await memberNotifications();
    const notification = items.find((item) => item.type === 'card_created');
    expect(notification).toBeTruthy();
    expect(notification!.title).toContain(created.body.task_code);
    expect(notification!.card_id).toBe(created.body.id);
    expect(notification!.link).toContain(`card=${created.body.id}`);
  });

  it('notifica mencao de usuario na descricao', async () => {
    await pool.query('DELETE FROM notifications');
    const created = await agent.post(`/api/v1/projects/${projectId}/cards`).send({
      title: 'Card com mencao',
      column_id: columnId,
    });
    expect(created.status).toBe(201);

    const patched = await agent
      .patch(`/api/v1/projects/${projectId}/cards/${created.body.id}`)
      .send({
        description: `<span class="mention-pill mention-pill-user" data-user="${memberId}">@${memberName}</span> precisa destinar a tarefa.`,
      });
    expect(patched.status).toBe(200);

    const items = await memberNotifications();
    const notification = items.find((item) => item.type === 'card_mention');
    expect(notification).toBeTruthy();
    expect(notification!.title).toContain(created.body.task_code);
    expect(notification!.body).toContain('precisa destinar');
  });

  it('notifica responsavel em comentario com mencao por nome', async () => {
    await pool.query('DELETE FROM notifications');
    const created = await agent.post(`/api/v1/projects/${projectId}/cards`).send({
      title: 'Card com comentario',
      column_id: columnId,
    });
    expect(created.status).toBe(201);

    const comment = await agent
      .post(`/api/v1/projects/${projectId}/cards/${created.body.id}/comments`)
      .send({ body: `@${memberName} consegue validar o card?` });
    expect(comment.status).toBe(201);

    const items = await memberNotifications();
    const notification = items.find((item) => item.type === 'card_comment');
    expect(notification).toBeTruthy();
    expect(notification!.title).toContain('Novo comentário');
    expect(notification!.body).toContain('consegue validar');
  });

  it('marca como lida e limpa a lista de nao lidas', async () => {
    await pool.query('DELETE FROM notifications');
    const created = await agent.post(`/api/v1/projects/${projectId}/cards`).send({
      title: 'Card para marcar lida',
      column_id: columnId,
      responsible_ids: [memberId],
    });
    expect(created.status).toBe(201);

    const before = await memberNotifications();
    const target = before.find((item) => item.type === 'card_created');
    expect(target).toBeTruthy();

    const unreadBefore = await memberAgent.get('/api/v1/notifications/unread-count');
    expect(unreadBefore.body.count).toBeGreaterThan(0);

    const read = await memberAgent.post(`/api/v1/notifications/${target!.id}/read`);
    expect(read.status).toBe(200);
    expect(read.body).toEqual({ id: target!.id, read: true });

    const after = await memberNotifications();
    const stillUnread = after.find((item) => item.id === target!.id);
    expect(stillUnread!.read_at).toBeTruthy();

    const readAll = await memberAgent.post('/api/v1/notifications/read-all');
    expect(readAll.status).toBe(200);

    const unreadAfter = await memberAgent.get('/api/v1/notifications/unread-count');
    expect(unreadAfter.body.count).toBe(0);
  });

  it('nao aceita id de notificacao de outro usuario', async () => {
    await pool.query('DELETE FROM notifications');
    const created = await agent.post(`/api/v1/projects/${projectId}/cards`).send({
      title: 'Card notificacao alheia',
      column_id: columnId,
      responsible_ids: [memberId],
    });
    expect(created.status).toBe(201);

    const items = await memberNotifications();
    const target = items.find((item) => item.type === 'card_created');
    expect(target).toBeTruthy();

    const stolen = await agent.post(`/api/v1/notifications/${target!.id}/read`);
    expect(stolen.status).toBe(404);
  });
});

describe('Notificacoes: varredura de prazos', () => {
  it('notifica vencimento de hoje com dedupe', async () => {
    await pool.query('DELETE FROM notifications');
    const created = await agent.post(`/api/v1/projects/${projectId}/cards`).send({
      title: 'Card com prazo hoje',
      column_id: columnId,
      responsible_ids: [memberId],
      due_date: localDate(0),
    });
    expect(created.status).toBe(201);

    const first = await runDeadlineScan(new Date(), projectId);
    expect(first).toBeGreaterThan(0);

    const items = await memberNotifications();
    const deadline = items.filter((item) => item.type === 'card_deadline');
    expect(deadline).toHaveLength(1);
    expect(deadline[0]!.title).toContain('hoje');
    expect(deadline[0]!.card_id).toBe(created.body.id);

    const sentSecond = await runDeadlineScan(new Date(), projectId);
    expect(sentSecond).toBe(0);
    const afterSecond = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM notifications
       WHERE user_id = $1 AND type = 'card_deadline' AND card_id = $2`,
      [memberId, created.body.id],
    );
    expect(Number(afterSecond.rows[0]!.count)).toBe(1);
  });

  it('ignora cards concluidos', async () => {
    await pool.query('DELETE FROM notifications WHERE type = $1', ['card_deadline']);
    const created = await agent.post(`/api/v1/projects/${projectId}/cards`).send({
      title: 'Card concluido com prazo',
      column_id: columnId,
      responsible_ids: [memberId],
      due_date: localDate(0),
    });
    expect(created.status).toBe(201);

    const columns = await agent.get(`/api/v1/projects/${projectId}/columns`);
    const doneColumn = columns.body.find(
      (column: { is_done: boolean }) => column.is_done,
    );
    expect(doneColumn).toBeTruthy();

    const moved = await agent
      .patch(`/api/v1/projects/${projectId}/cards/${created.body.id}`)
      .send({ column_id: doneColumn.id });
    expect(moved.status).toBe(200);

    await pool.query('DELETE FROM notifications WHERE type = $1', ['card_deadline']);
    await runDeadlineScan(new Date(), projectId);

    const deadlineRows = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM notifications
       WHERE user_id = $1 AND type = 'card_deadline' AND card_id = $2`,
      [memberId, created.body.id],
    );
    expect(Number(deadlineRows.rows[0]!.count)).toBe(0);
  });
});
