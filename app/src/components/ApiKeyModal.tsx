import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api';
import { useToast } from './Toast';
import type { SecurityGate } from '../useSecurityGate';

interface ApiKeyModalProps {
  gate: SecurityGate;
  onClose: () => void;
  onSaved: () => void;
}

export function ApiKeyModal({ gate, onClose, onSaved }: ApiKeyModalProps) {
  const toast = useToast();

  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revealedKey, setRevealedKey] = useState('');

  const nameTrimmed = name.trim();
  const canSave = nameTrimmed.length >= 2;

  async function handleSave(formEvent: FormEvent) {
    formEvent.preventDefault();
    if (!canSave || busy) return;
    setBusy(true);
    setError('');
    const result = await gate.guarded(async () => {
      const created = await api<{ id: string; key: string }>('/keys', {
        method: 'POST',
        body: JSON.stringify({ name: nameTrimmed }),
      });
      return created;
    });
    if (result.ok && result.value) {
      setRevealedKey(result.value.key);
      onSaved();
    }
    setBusy(false);
  }

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(revealedKey);
      toast.success('Chave copiada.');
    } catch {
      toast.error('Não foi possível copiar automaticamente. Selecione o texto e copie manualmente.');
    }
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
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
            </svg>
          </div>
          <div className="webhook-modal-identity">
            <span className="webhook-modal-name">
              {revealedKey ? 'Chave gerada' : nameTrimmed || 'Nova chave'}
            </span>
            <span className="webhook-modal-label">
              {revealedKey ? 'Copie e guarde agora' : 'Nova chave de API'}
            </span>
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

        {revealedKey ? (
          <div className="webhook-modal-body">
            <div className="info-box key-reveal">
              <strong>Nova chave gerada.</strong>
              <code className="key-value">{revealedKey}</code>
              <p className="muted small">
                Esta chave aparece apenas uma vez. Copie e guarde agora; depois só o prefixo fica
                visível.
              </p>
              <button type="button" className="btn btn-plain" onClick={() => void copyKey()}>
                Copiar chave
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={(event) => void handleSave(event)}>
            <div className="webhook-modal-body">
              <label className="field">
                <span>Nome</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Ex.: Power BI"
                  required
                  minLength={2}
                  maxLength={80}
                />
              </label>
            </div>

            <div className="webhook-modal-foot">
              <div className="webhook-modal-foot-left" />
              <div className="webhook-modal-foot-right">
                <button type="button" className="btn btn-secondary" onClick={onClose}>
                  Cancelar
                </button>
                <button type="submit" className="btn" disabled={!canSave || busy}>
                  {busy ? 'Gerando...' : 'Gerar chave'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
