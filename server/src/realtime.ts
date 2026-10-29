import type { IncomingMessage, Server as HttpServer } from 'http';
import { parseCookie } from 'cookie';
import signature from 'cookie-signature';
import { WebSocket, WebSocketServer } from 'ws';
import { config } from './config.js';
import { queryOne } from './db/pool.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RealtimeClient {
  socket: WebSocket;
  userId: string;
  projects: Set<string>;
  alive: boolean;
}

const clients = new Set<RealtimeClient>();

function readSessionId(rawCookie: string | undefined): string | null {
  if (!rawCookie) return null;
  const cookies = parseCookie(rawCookie);
  const sid = cookies['trilho.sid'];
  if (!sid || !sid.startsWith('s:')) return null;
  return signature.unsign(sid.slice(2), config.sessionSecret) || null;
}

async function userIdFromSession(sid: string): Promise<string | null> {
  const row = await queryOne<{ sess: string | { userId?: unknown } }>(
    'SELECT sess FROM sessions WHERE sid = $1 AND expire > now()',
    [sid],
  );
  if (!row) return null;
  try {
    const parsed: unknown =
      typeof row.sess === 'string' ? JSON.parse(row.sess) : row.sess;
    const userId = (parsed as { userId?: unknown }).userId;
    return typeof userId === 'string' ? userId : null;
  } catch {
    return null;
  }
}

async function isProjectMember(userId: string, projectId: string): Promise<boolean> {
  const member = await queryOne(
    'SELECT 1 AS ok FROM project_members WHERE project_id = $1 AND user_id = $2',
    [projectId, userId],
  );
  return member !== null;
}

export function broadcastProject(projectId: string, type: string): void {
  const message = JSON.stringify({ type, project_id: projectId, at: new Date().toISOString() });
  for (const client of clients) {
    if (client.projects.has(projectId) && client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(message);
    }
  }
}

export function sendToUser(
  userId: string,
  type: string,
  payload: Record<string, unknown> = {},
): void {
  const message = JSON.stringify({ type, at: new Date().toISOString(), ...payload });
  for (const client of clients) {
    if (client.userId === userId && client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(message);
    }
  }
}

async function handleMessage(client: RealtimeClient, raw: string): Promise<void> {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    client.socket.close(4002, 'mensagem invalida');
    return;
  }
  const message = payload as { type?: unknown; project_id?: unknown };
  if (message.type !== 'subscribe' || typeof message.project_id !== 'string') return;
  if (!UUID_PATTERN.test(message.project_id)) return;
  if (await isProjectMember(client.userId, message.project_id)) {
    client.projects.add(message.project_id);
  }
}

export function startRealtime(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (socket: WebSocket, request: IncomingMessage) => {
    let client: RealtimeClient | null = null;
    const queued: string[] = [];

    socket.on('message', (data) => {
      const raw = data.toString();
      if (client) void handleMessage(client, raw);
      else queued.push(raw);
    });
    socket.on('close', () => {
      if (client) clients.delete(client);
    });
    socket.on('error', () => {
      socket.terminate();
      if (client) clients.delete(client);
    });

    void (async () => {
      const sid = readSessionId(request.headers.cookie);
      const userId = sid ? await userIdFromSession(sid) : null;
      if (!userId || socket.readyState !== WebSocket.OPEN) {
        socket.close(4001, 'nao autenticado');
        return;
      }

      const authenticated: RealtimeClient = {
        socket,
        userId,
        projects: new Set(),
        alive: true,
      };
      client = authenticated;
      clients.add(authenticated);
      socket.on('pong', () => {
        authenticated.alive = true;
      });
      for (const raw of queued.splice(0)) void handleMessage(authenticated, raw);
    })();
  });

  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.alive) {
        client.socket.terminate();
        clients.delete(client);
        continue;
      }
      client.alive = false;
      client.socket.ping();
    }
  }, 30000);

  wss.on('close', () => clearInterval(heartbeat));
  return wss;
}
