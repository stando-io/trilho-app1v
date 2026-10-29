import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { homePathFor, useAuth } from '../auth';
import type { MeUser } from '../types';

export default function AcceptInvite() {
  const { token = '' } = useParams();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const me = await api<MeUser>('/auth/accept-invite', {
        method: 'POST',
        body: JSON.stringify({ token, name, password }),
      });
      await refresh();
      navigate(homePathFor(me), { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro inesperado. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="center-page">
      <form className="auth-card" onSubmit={(event) => void handleSubmit(event)}>
        <h1>Aceitar convite</h1>
        <p className="subtitle">Defina seu nome e sua senha para criar a conta.</p>

        {error && <div className="error-box">{error}</div>}

        <label className="field">
          <span>Seu nome</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            minLength={2}
            required
          />
        </label>

        <label className="field">
          <span>Senha (mínimo 8 caracteres)</span>
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
          {submitting ? 'Criando conta' : 'Criar conta e entrar'}
        </button>

        <div className="link-row">
          <Link to="/login">Já tenho conta</Link>
        </div>
      </form>
    </div>
  );
}
