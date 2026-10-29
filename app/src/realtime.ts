import { useEffect } from 'react';

export interface ProjectEvent {
  type: string;
  project_id: string;
  at: string;
}

export interface UserNotificationPayload {
  id: string;
  actor_id: string | null;
  type: string;
  title: string;
  body: string;
  project_id: string | null;
  card_id: string | null;
  screen: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface UserEvent {
  type: string;
  notification?: UserNotificationPayload;
}

const RECONNECT_MS = 2000;

function getWsUrl(): string {
  const envWsUrl = import.meta.env.VITE_WS_URL;
  if (envWsUrl) return envWsUrl;
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}/ws`;
}

export function useProjectEvents(projectId: string, onEvent: (event: ProjectEvent) => void): void {
  useEffect(() => {
    if (!projectId) return;

    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    function connect() {
      const wsUrl = getWsUrl();
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        socket?.send(JSON.stringify({ type: 'subscribe', project_id: projectId }));
      };

      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data) as ProjectEvent;
          if (event.project_id === projectId) onEvent(event);
        } catch {
          return;
        }
      };

      socket.onclose = () => {
        if (disposed) return;
        retryTimer = setTimeout(connect, RECONNECT_MS);
      };
    }

    connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
  }, [projectId, onEvent]);
}

export function useUserEvents(onEvent: (event: UserEvent) => void): void {
  useEffect(() => {
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    function connect() {
      const wsUrl = getWsUrl();
      socket = new WebSocket(wsUrl);

      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data) as UserEvent;
          if (event.type === 'notification' && event.notification) onEvent(event);
        } catch {
          return;
        }
      };

      socket.onclose = () => {
        if (disposed) return;
        retryTimer = setTimeout(connect, RECONNECT_MS);
      };
    }

    connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
  }, [onEvent]);
}
