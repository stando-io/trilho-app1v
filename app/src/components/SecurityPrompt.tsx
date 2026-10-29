import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { SecurityGate } from '../useSecurityGate';

export default function SecurityPrompt({ gate }: { gate: SecurityGate }) {
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (gate.asking) setPassword('');
  }, [gate.asking]);

  if (!gate.asking) return null;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void gate.confirm(password);
  }

  return (
    <div className="modal-backdrop scope-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-label="Senha de Segurança">
        <h3>Senha de Segurança</h3>
        <p>{gate.message}</p>
        <form onSubmit={handleSubmit}>
          <label className="field">
            <span>Digite a senha de segurança para confirmar</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoFocus
            />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn btn-plain" onClick={gate.cancel}>
              Cancelar
            </button>
            <button type="submit" className="btn" disabled={password.length === 0}>
              Confirmar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
