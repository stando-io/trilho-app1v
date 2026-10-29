import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';

export default function ResetPassword() {
  const { token = '' } = useParams();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api<void>('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro inesperado. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="center-page">
      <form className="auth-card" onSubmit={(event) => void handleSubmit(event)}>
        <h1>Redefinir senha</h1>
        <p className="subtitle">Escolha uma nova senha para a sua conta.</p>

        {done && <div className="info-box">Senha redefinida com sucesso. Já pode entrar.</div>}
        {error && <div className="error-box">{error}</div>}

        {!done && (
          <>
            <label className="field">
              <span>Nova senha (mínimo 8 caracteres)</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>

            <button type="submit" className="btn" disabled={submitting}>
              {submitting ? 'Salvando' : 'Salvar nova senha'}
            </button>
          </>
        )}

        <div className="link-row">
          <Link to="/login">Ir para o login</Link>
        </div>
      </form>
    </div>
  );
}
