import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api';
import { useToast } from './Toast';
import type { SecurityGate } from '../useSecurityGate';
import {
  WEBHOOK_EVENTS,
  WEBHOOK_EVENT_GROUPS,
  WEBHOOK_SYSTEMS,
  WEBHOOK_SYSTEM_LABELS,
  detectWebhookSystem,
} from '../webhookEvents';
import type { WebhookEvent, WebhookSystem } from '../webhookEvents';

export interface WebhookRow {
  id: string;
  name: string;
  url: string;
  system: WebhookSystem;
  events: WebhookEvent[];
  active: boolean;
  created_by_name: string;
  created_at: string;
}

interface WebhookModalProps {
  mode: 'edit' | 'create';
  webhook: WebhookRow | null;
  gate: SecurityGate;
  onClose: () => void;
  onSaved: () => void;
}

const ALL_EVENT_VALUES = WEBHOOK_EVENTS.map((entry) => entry.value);

export function WebhookModal({ mode, webhook, gate, onClose, onSaved }: WebhookModalProps) {
  const toast = useToast();
  const isEdit = mode === 'edit' && webhook !== null;

  const [name, setName] = useState(webhook?.name ?? '');
  const [url, setUrl] = useState(webhook?.url ?? '');
  const [system, setSystem] = useState<WebhookSystem>(webhook?.system ?? 'generico');
  const [events, setEvents] = useState<WebhookEvent[]>(webhook?.events ?? []);
  const [active, setActive] = useState(webhook?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const systemTouched = useRef(false);

  const nameTrimmed = name.trim();
  const urlTrimmed = url.trim();
  const allSelected = events.length === ALL_EVENT_VALUES.length;
  const canSave = nameTrimmed.length >= 2 && urlTrimmed.length > 0 && events.length >= 1;

  function handleUrlChange(value: string) {
    setUrl(value);
    systemTouched.current = false;
  }

  function handleUrlBlur() {
    if (!systemTouched.current) setSystem(detectWebhookSystem(url));
  }

  function handleSystemChange(value: WebhookSystem) {
    systemTouched.current = true;
    setSystem(value);
  }

  function toggleEvent(value: WebhookEvent) {
    setEvents((prev) =>
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value],
    );
  }

  function toggleGroup(groupValues: WebhookEvent[], checked: boolean) {
    setEvents((prev) => {
      const withoutGroup = prev.filter((item) => !groupValues.includes(item));
      return checked ? [...withoutGroup, ...groupValues] : withoutGroup;
    });
  }

  function toggleAll(checked: boolean) {
    setEvents(checked ? [...ALL_EVENT_VALUES] : []);
  }

  async function handleSave(formEvent: FormEvent) {
    formEvent.preventDefault();
    if (!canSave || busy) return;
    setBusy(true);
    setError('');
    const body = JSON.stringify({ name: nameTrimmed, url: urlTrimmed, system, events });
    const result = await gate.guarded(async () => {
      if (isEdit && webhook) {
        return api<WebhookRow>(`/webhooks/${webhook.id}`, { method: 'PUT', body });
      }
      return api<WebhookRow>('/webhooks', { method: 'POST', body });
    });
    if (result.ok) {
      toast.success('Webhook salvo.');
      onSaved();
      onClose();
    }
    setBusy(false);
  }

  async function handleDelete() {
    if (!webhook || busy) return;
    setBusy(true);
    setError('');
    const result = await gate.guarded(async () => {
      await api(`/webhooks/${webhook.id}`, { method: 'DELETE' });
    });
    if (result.ok) {
      toast.success('Webhook excluído.');
      onSaved();
      onClose();
    }
    setBusy(false);
  }

  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal webhook-modal" role="dialog" aria-modal="true">
        <header className="webhook-modal-head">
          <div className="webhook-modal-icon" aria-hidden="true">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2" />
              <path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06" />
              <path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8" />
            </svg>
          </div>
          <div className="webhook-modal-identity">
            <span className="webhook-modal-name">
              {nameTrimmed || (isEdit ? webhook?.name : 'Novo webhook')}
            </span>
            <span className="webhook-modal-label">{isEdit ? 'Editar webhook' : 'Novo webhook'}</span>
          </div>
          <div className="webhook-modal-head-actions">
            <button
              type="button"
              className="icon-btn"
              aria-label="Fechar"
              title="Fechar"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </header>

        {error && <div className="error-box">{error}</div>}

        <form onSubmit={(event) => void handleSave(event)}>
          <div className="webhook-modal-body">
            <label className="field">
              <span>Nome</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ex.: Notificação de tarefa criada"
                required
                minLength={2}
                maxLength={80}
              />
            </label>
            <label className="field">
              <span>URL de destino</span>
              <input
                type="url"
                value={url}
                onChange={(event) => handleUrlChange(event.target.value)}
                onBlur={handleUrlBlur}
                placeholder="https://exemplo.com/webhook"
                required
                maxLength={2048}
              />
            </label>
            <label className="field">
              <span>Sistema Destino</span>
              <select
                value={system}
                onChange={(event) => handleSystemChange(event.target.value as WebhookSystem)}
              >
                {WEBHOOK_SYSTEMS.map((option) => (
                  <option key={option} value={option}>
                    {WEBHOOK_SYSTEM_LABELS[option]}
                  </option>
                ))}
              </select>
            </label>

            <div className="webhook-events">
              <div className="webhook-events-head">
                <span>Eventos</span>
                <label className="webhook-events-master">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(event) => toggleAll(event.target.checked)}
                  />
                  Todos os Eventos
                </label>
              </div>
              {events.length === 0 && (
                <p className="webhook-events-hint">Selecione ao menos um evento.</p>
              )}
              {WEBHOOK_EVENT_GROUPS.map((group) => {
                const groupEntries = WEBHOOK_EVENTS.filter((entry) => entry.group === group.id);
                const groupValues = groupEntries.map((entry) => entry.value) as WebhookEvent[];
                const groupSelected = groupValues.every((value) => events.includes(value));
                return (
                  <div key={group.id} className="webhook-events-group">
                    <label className="webhook-events-group-title">
                      <input
                        type="checkbox"
                        checked={groupSelected}
                        onChange={(event) => toggleGroup(groupValues, event.target.checked)}
                      />
                      {group.label}
                    </label>
                    {groupEntries.map((entry) => (
                      <label key={entry.value} className="webhook-event-row">
                        <input
                          type="checkbox"
                          checked={events.includes(entry.value)}
                          onChange={() => toggleEvent(entry.value)}
                        />
                        <span className="webhook-event-label">{entry.label}</span>
                        <code className="webhook-event-code">{entry.value}</code>
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>

            <label className="webhook-active-row">
              <input
                type="checkbox"
                checked={active}
                onChange={(event) => setActive(event.target.checked)}
              />
              Ativo
            </label>
          </div>

          <div className="webhook-modal-foot">
            <div className="webhook-modal-foot-left">
              {isEdit && (
                <button
                  type="button"
                  className="btn btn-danger-ghost"
                  disabled={busy}
                  onClick={() => setConfirmingDelete(true)}
                >
                  Excluir webhook
                </button>
              )}
            </div>
            <div className="webhook-modal-foot-right">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Cancelar
              </button>
              <button type="submit" className="btn" disabled={!canSave || busy}>
                {busy ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </form>

        {confirmingDelete && webhook && (
          <div className="modal-backdrop">
            <div className="modal confirm-dialog" role="dialog" aria-modal="true">
              <h3>Excluir webhook</h3>
              <p>
                Excluir o webhook "{webhook.name}"? Ele deixará de receber eventos imediatamente.
              </p>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setConfirmingDelete(false)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => void handleDelete()}
                >
                  {busy ? 'Excluindo...' : 'Excluir'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
