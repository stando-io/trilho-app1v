import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool, queryOne } from '../src/db/pool.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, setup } from './helpers.js';

const app = createApp();
const admin = request.agent(app);

let keyId = '';
let keyToken = '';

beforeAll(async () => {
  await setup();
  const login = await admin
    .post('/api/v1/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  expect(login.status).toBe(200);
});

afterAll(async () => {
  await pool.query('DELETE FROM api_keys WHERE name LIKE $1', ['Chave teste %']);
  await pool.end();
});

describe('chaves de API', () => {
  it('exige sessao para listar e criar', async () => {
    const list = await request(app).get('/api/v1/keys');
    expect(list.status).toBe(401);

    const create = await request(app).post('/api/v1/keys').send({ name: 'Sem sessao' });
    expect(create.status).toBe(401);
  });

  it('cria chave com sessao e devolve o token uma unica vez', async () => {
    const res = await admin.post('/api/v1/keys').send({ name: 'Chave teste criacao' });
    expect(res.status).toBe(201);
    expect(res.body.key).toMatch(/^trl_/);
    expect(res.body.key_prefix).toBe(res.body.key.slice(0, 11));
    expect(res.body.name).toBe('Chave teste criacao');

    keyId = res.body.id;
    keyToken = res.body.key;

    const row = await queryOne<{ key_hash: string }>(
      'SELECT key_hash FROM api_keys WHERE id = $1',
      [keyId],
    );
    expect(row?.key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.key_hash).not.toContain(keyToken);
  });

  it('lista chaves com prefixo e status', async () => {
    const res = await admin.get('/api/v1/keys');
    expect(res.status).toBe(200);
    const row = res.body.find((item: { id: string }) => item.id === keyId);
    expect(row).toBeTruthy();
    expect(row.key_prefix).toBe(keyToken.slice(0, 11));
    expect(row.revoked_at).toBeNull();
    expect(row.created_by_name).toBeTruthy();
  });

  it('valida o nome da chave', async () => {
    const res = await admin.post('/api/v1/keys').send({ name: 'a' });
    expect(res.status).toBe(400);
  });

  it('autentica leitura sem cookie de sessao', async () => {
    const projects = await request(app)
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${keyToken}`);
    expect(projects.status).toBe(200);
    expect(Array.isArray(projects.body)).toBe(true);

    const keys = await request(app)
      .get('/api/v1/keys')
      .set('Authorization', `Bearer ${keyToken}`);
    expect(keys.status).toBe(200);
  });

  it('registra o ultimo uso da chave', async () => {
    const row = await queryOne<{ last_used_at: string | null }>(
      'SELECT last_used_at FROM api_keys WHERE id = $1',
      [keyId],
    );
    expect(row?.last_used_at).toBeTruthy();
  });

  it('bloqueia escrita autenticada por chave', async () => {
    const create = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${keyToken}`)
      .send({ name: 'Nao Pode Criar' });
    expect(create.status).toBe(403);
    expect(create.body.error.message).toBe('Chave de API somente leitura');

    const createKey = await request(app)
      .post('/api/v1/keys')
      .set('Authorization', `Bearer ${keyToken}`)
      .send({ name: 'Chave teste pirata' });
    expect(createKey.status).toBe(403);

    const revoke = await request(app)
      .delete(`/api/v1/keys/${keyId}`)
      .set('Authorization', `Bearer ${keyToken}`);
    expect(revoke.status).toBe(403);
  });

  it('rejeita token invalido', async () => {
    const res = await request(app)
      .get('/api/v1/projects')
      .set('Authorization', 'Bearer trl_token-que-nao-existe');
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Chave de API inválida ou revogada');
  });

  it('audita a criacao da chave', async () => {
    const row = await queryOne<{ action: string; entity: string }>(
      `SELECT action, entity FROM audit_logs
       WHERE action = 'api_key_created' AND entity_id = $1`,
      [keyId],
    );
    expect(row?.action).toBe('api_key_created');
    expect(row?.entity).toBe('api_key');
  });

  it('revoga a chave com sessao e passa a recusar o uso', async () => {
    const res = await admin.delete(`/api/v1/keys/${keyId}`);
    expect(res.status).toBe(204);

    const use = await request(app)
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${keyToken}`);
    expect(use.status).toBe(401);
    expect(use.body.error.message).toBe('Chave de API inválida ou revogada');

    const list = await admin.get('/api/v1/keys');
    const row = list.body.find((item: { id: string }) => item.id === keyId);
    expect(row.revoked_at).toBeTruthy();
  });

  it('exclui permanentemente chave ja revogada e recusa inexistente', async () => {
    const again = await admin.delete(`/api/v1/keys/${keyId}`);
    expect(again.status).toBe(204);

    const row = await queryOne('SELECT id FROM api_keys WHERE id = $1', [keyId]);
    expect(row).toBeNull();

    const missing = await admin.delete('/api/v1/keys/00000000-0000-4000-8000-000000000000');
    expect(missing.status).toBe(404);
  });

  it('audita a revogacao e a exclusao da chave', async () => {
    const revoked = await queryOne<{ action: string; entity: string }>(
      `SELECT action, entity FROM audit_logs
       WHERE action = 'api_key_revoked' AND entity_id = $1`,
      [keyId],
    );
    expect(revoked?.action).toBe('api_key_revoked');
    expect(revoked?.entity).toBe('api_key');

    const deleted = await queryOne<{ action: string; entity: string; meta: Record<string, unknown> }>(
      `SELECT action, entity, meta FROM audit_logs
       WHERE action = 'api_key_deleted' AND entity_id = $1`,
      [keyId],
    );
    expect(deleted?.action).toBe('api_key_deleted');
    expect(deleted?.entity).toBe('api_key');
    expect(deleted?.meta.name).toBe('Chave teste criacao');
    expect(deleted?.meta.key_prefix).toBeTruthy();
  });
});
