import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import WebSocket from 'ws';
import type { WebSocketServer } from 'ws';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { startRealtime } from '../src/realtime.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, dropProject, setup } from './helpers.js';

const app = createApp();

let server: Server;
let wss: WebSocketServer;
let cookie = '';
let projectId = '';
let columnId = '';
const sockets: WebSocket[] = [];

function connect(headers: Record<string, string> = {}): WebSocket {
  const port = (server.address() as AddressInfo).port;
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
  sockets.push(socket);
  return socket;
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout ao abrir websocket')), 4000);
    socket.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function waitForClose(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    socket.once('close', (code) => resolve(code));
  });
}

function nextMessage(socket: WebSocket, timeoutMs = 4000): Promise<{ type?: string; project_id?: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout aguardando mensagem')), timeoutMs);
    socket.once('message', (raw) => {
      clearTimeout(timer);
      resolve(JSON.parse(raw.toString()));
    });
  });
}

function expectSilence(socket: WebSocket, ms = 700): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      resolve();
    }, ms);
    const onMessage = (raw: Buffer) => {
      clearTimeout(timer);
      reject(new Error(`mensagem inesperada: ${raw.toString()}`));
    };
    socket.on('message', onMessage);
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeAll(async () => {
  await setup();

  server = app.listen(0);
  wss = startRealtime(server);

  const login = await request(server)
    .post('/api/v1/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  expect(login.status).toBe(200);
  cookie = (login.headers['set-cookie'] as string[])
    .map((entry) => entry.split(';')[0])
    .join('; ');

  const created = await request(server)
    .post('/api/v1/projects')
    .set('Cookie', cookie)
    .send({ name: `Realtime Teste ${Date.now()}`, description: 'Projeto criado nos testes' });
  expect(created.status).toBe(201);
  projectId = created.body.id;

  const columns = await request(server)
    .get(`/api/v1/projects/${projectId}/columns`)
    .set('Cookie', cookie);
  const nova = columns.body.find((column: { name: string }) => column.name === 'Nova Solicitacao');
  expect(nova).toBeTruthy();
  columnId = nova.id;
});

afterAll(async () => {
  for (const socket of sockets) {
    try {
      socket.terminate();
    } catch {
      socket.close();
    }
  }
  wss.close();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
  if (projectId) await dropProject(projectId);
  await pool.end();
});

describe('Realtime: autenticacao', () => {
  it('recusa conexao sem cookie de sessao', async () => {
    const socket = connect();
    const code = await waitForClose(socket);
    expect(code).toBe(4001);
  });

  it('recusa conexao com cookie invalido', async () => {
    const socket = connect({ Cookie: 'trilho.sid=s%3Aassinatura-falsa.outro' });
    const code = await waitForClose(socket);
    expect(code).toBe(4001);
  });
});

describe('Realtime: salas de projeto', () => {
  it('entrega cards_changed para cliente inscrito', async () => {
    const socket = connect({ Cookie: cookie });
    await waitForOpen(socket);
    socket.send(JSON.stringify({ type: 'subscribe', project_id: projectId }));
    await wait(300);

    const messagePromise = nextMessage(socket);
    const created = await request(server)
      .post(`/api/v1/projects/${projectId}/cards`)
      .set('Cookie', cookie)
      .send({ title: 'Card realtime', column_id: columnId });
    expect(created.status).toBe(201);

    const message = await messagePromise;
    expect(message.type).toBe('cards_changed');
    expect(message.project_id).toBe(projectId);
    socket.close();
  });

  it('nao envia evento para cliente fora da sala', async () => {
    const outsider = connect({ Cookie: cookie });
    await waitForOpen(outsider);
    outsider.send(
      JSON.stringify({
        type: 'subscribe',
        project_id: '00000000-0000-4000-8000-000000000099',
      }),
    );
    await wait(300);

    const silence = expectSilence(outsider);
    const created = await request(server)
      .post(`/api/v1/projects/${projectId}/cards`)
      .set('Cookie', cookie)
      .send({ title: 'Card sem ouvintes', column_id: columnId });
    expect(created.status).toBe(201);
    await silence;
    outsider.close();
  });

  it('emite structure_changed apos alteracao de setor', async () => {
    await request(server)
      .put(`/api/v1/settings/security-password`)
      .set('Cookie', cookie)
      .send({ password: 'senha-realtime-123' });

    const socket = connect({ Cookie: cookie });
    await waitForOpen(socket);
    socket.send(JSON.stringify({ type: 'subscribe', project_id: projectId }));
    await wait(300);

    const messagePromise = nextMessage(socket);
    const created = await request(server)
      .post(`/api/v1/projects/${projectId}/sectors`)
      .set('Cookie', cookie)
      .set('x-security-password', 'senha-realtime-123')
      .send({ name: 'Realtime Setor' });
    expect(created.status).toBe(201);

    const message = await messagePromise;
    expect(message.type).toBe('structure_changed');
    socket.close();
  });
});
