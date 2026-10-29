import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool, queryOne } from '../src/db/pool.js';
import { setSecurityPassword } from '../src/services/securityPassword.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, setup } from './helpers.js';

const app = createApp();
const admin = request.agent(app);

let webhookId = '';

beforeAll(async () => {
  await setup();
  const login = await admin
    .post('/api/v1/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  expect(login.status).toBe(200);
});

afterAll(async () => {
  await pool.query('DELETE FROM webhooks WHERE name LIKE $1', ['Webhook teste %']);
  await pool.end();
});

describe('webhooks', () => {
  it('exige sessao para listar e criar', async () => {
    const list = await request(app).get('/api/v1/webhooks');
    expect(list.status).toBe(401);

    const create = await request(app)
      .post('/api/v1/webhooks')
      .send({ name: 'Sem sessao', url: 'https://example.com', events: ['card.created'] });
    expect(create.status).toBe(401);
  });

  it('cria webhook valido com multiplos eventos', async () => {
    const res = await admin.post('/api/v1/webhooks').send({
      name: 'Webhook teste criacao',
      url: 'https://example.com/hook',
      system: 'slack',
      events: ['card.created', 'comment.created'],
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.system).toBe('slack');
    expect(res.body.events).toEqual(['card.created', 'comment.created']);
    expect(res.body.active).toBe(true);

    webhookId = res.body.id;
  });

  it('usa sistema generico por padrao', async () => {
    const res = await admin.post('/api/v1/webhooks').send({
      name: 'Webhook teste padrao',
      url: 'https://example.com/hook',
      events: ['project.created'],
    });
    expect(res.status).toBe(201);
    expect(res.body.system).toBe('generico');
  });

  it('valida URL, sistema e eventos', async () => {
    const badUrl = await admin.post('/api/v1/webhooks').send({
      name: 'Bad URL',
      url: 'not-a-url',
      events: ['card.created'],
    });
    expect(badUrl.status).toBe(400);

    const badSystem = await admin.post('/api/v1/webhooks').send({
      name: 'Bad System',
      url: 'https://example.com',
      system: 'telegram',
      events: ['card.created'],
    });
    expect(badSystem.status).toBe(400);

    const badEvent = await admin.post('/api/v1/webhooks').send({
      name: 'Bad Event',
      url: 'https://example.com',
      events: ['invalid.event'],
    });
    expect(badEvent.status).toBe(400);

    const noEvents = await admin.post('/api/v1/webhooks').send({
      name: 'Sem eventos',
      url: 'https://example.com',
      events: [],
    });
    expect(noEvents.status).toBe(400);

    const badName = await admin.post('/api/v1/webhooks').send({
      name: 'a',
      url: 'https://example.com',
      events: ['card.created'],
    });
    expect(badName.status).toBe(400);
  });

  it('lista webhooks com criador', async () => {
    const res = await admin.get('/api/v1/webhooks');
    expect(res.status).toBe(200);
    const row = res.body.find((item: { id: string }) => item.id === webhookId);
    expect(row).toBeTruthy();
    expect(row.created_by_name).toBeTruthy();
    expect(row.url).toBe('https://example.com/hook');
    expect(row.events).toEqual(['card.created', 'comment.created']);
  });

  it('atualiza webhook', async () => {
    const res = await admin
      .put(`/api/v1/webhooks/${webhookId}`)
      .send({
        name: 'Webhook teste atualizado',
        active: false,
        events: ['project.completed'],
      });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Webhook teste atualizado');
    expect(res.body.active).toBe(false);
    expect(res.body.events).toEqual(['project.completed']);
  });

  it('rejeita webhook inexistente no update e delete', async () => {
    const missingUpdate = await admin
      .put('/api/v1/webhooks/00000000-0000-4000-8000-000000000000')
      .send({ name: 'Nao Existe' });
    expect(missingUpdate.status).toBe(404);

    const missingDelete = await admin.delete('/api/v1/webhooks/00000000-0000-4000-8000-000000000000');
    expect(missingDelete.status).toBe(404);
  });

  it('exige senha de segurança para criar quando definida', async () => {
    await setSecurityPassword('senha-teste-123');
    try {
      const noPass = await admin.post('/api/v1/webhooks').send({
        name: 'Webhook teste sem senha',
        url: 'https://example.com',
        events: ['card.created'],
      });
      expect(noPass.status).toBe(400);
      expect(noPass.body.error.message).toBe('Senha de segurança necessária para esta operação');

      const badPass = await admin
        .post('/api/v1/webhooks')
        .set('x-security-password', 'errada')
        .send({
          name: 'Webhook teste senha errada',
          url: 'https://example.com',
          events: ['card.created'],
        });
      expect(badPass.status).toBe(400);
      expect(badPass.body.error.message).toBe('Senha de segurança inválida');

      const goodPass = await admin
        .post('/api/v1/webhooks')
        .set('x-security-password', 'senha-teste-123')
        .send({
          name: 'Webhook teste com senha',
          url: 'https://example.com',
          events: ['card.deleted'],
        });
      expect(goodPass.status).toBe(201);

      const deleteNoPass = await admin.delete(`/api/v1/webhooks/${webhookId}`);
      expect(deleteNoPass.status).toBe(400);

      const deleteGoodPass = await admin
        .delete(`/api/v1/webhooks/${webhookId}`)
        .set('x-security-password', 'senha-teste-123');
      expect(deleteGoodPass.status).toBe(204);

      const list = await admin.get('/api/v1/webhooks');
      const row = list.body.find((item: { id: string }) => item.id === webhookId);
      expect(row).toBeFalsy();
    } finally {
      await pool.query('DELETE FROM system_settings');
    }
  });

  it('audita criacao e exclusao', async () => {
    const created = await queryOne<{ action: string; entity: string }>(
      `SELECT action, entity FROM audit_logs
       WHERE action = 'webhook_created' AND entity_id = $1`,
      [webhookId],
    );
    expect(created?.action).toBe('webhook_created');
    expect(created?.entity).toBe('webhook');
  });
});
