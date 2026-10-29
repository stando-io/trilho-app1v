import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useUserEvents, type UserNotificationPayload } from '../realtime';
import { useToast } from './Toast';

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface NotificationListResponse {
  items: UserNotificationPayload[];
  unread: number;
}

export default function NotificationBell() {
  const navigate = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<UserNotificationPayload[]>([]);
  const [unread, setUnread] = useState(0);
  const [pulse, setPulse] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const openRef = useRef(false);

  openRef.current = open;

  const load = useCallback(async () => {
    try {
      const data = await api<NotificationListResponse>('/notifications');
      setItems(data.items);
      setUnread(data.unread);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onUserEvent = useCallback((event: { notification?: UserNotificationPayload }) => {
    const notification = event.notification;
    if (!notification) return;
    setItems((previous) => [notification, ...previous].slice(0, 30));
    setUnread((count) => count + 1);
    if (!openRef.current) {
      setPulse(true);
      window.setTimeout(() => setPulse(false), 1200);
    }
  }, []);

  useUserEvents(onUserEvent);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function markRead(id: string) {
    try {
      await api(`/notifications/${id}/read`, { method: 'POST' });
    } catch (err) {
      if (err instanceof ApiError && err.status !== 401) {
        toast.error(err.message);
      }
    }
  }

  async function markAllRead() {
    try {
      await api('/notifications/read-all', { method: 'POST' });
      setUnread(0);
      setItems((previous) =>
        previous.map((item) => (item.read_at ? item : { ...item, read_at: new Date().toISOString() })),
      );
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message);
    }
  }

  function openItem(item: UserNotificationPayload) {
    if (!item.read_at) {
      setUnread((count) => Math.max(0, count - 1));
      setItems((previous) =>
        previous.map((row) =>
          row.id === item.id ? { ...row, read_at: new Date().toISOString() } : row,
        ),
      );
      void markRead(item.id);
    }
    setOpen(false);
    if (item.link) navigate(item.link);
  }

  return (
    <div className="bell-root" ref={rootRef}>
      <button
        type="button"
        className={`bell-btn${pulse ? ' bell-pulse' : ''}`}
        aria-label={unread > 0 ? `Notificações, ${unread} não lidas` : 'Notificações'}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && <span className="bell-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-popover" role="dialog" aria-label="Notificações">
          <div className="bell-popover-head">
            <span className="bell-popover-title">Notificações</span>
            {unread > 0 && (
              <button type="button" className="bell-read-all" onClick={() => void markAllRead()}>
                Marcar todas como lidas
              </button>
            )}
          </div>
          <ul className="bell-list">
            {items.length === 0 && <li className="bell-empty">Nenhuma notificação.</li>}
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`bell-item${item.read_at ? '' : ' bell-item-unread'}`}
                  onClick={() => openItem(item)}
                >
                  <span className="bell-item-title">{item.title}</span>
                  {item.body && <span className="bell-item-body">{item.body}</span>}
                  <span className="bell-item-time">{formatWhen(item.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
