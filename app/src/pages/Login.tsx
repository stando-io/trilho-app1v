import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { homePathFor, useAuth } from '../auth';
import type { MeUser } from '../types';

export default function Login() {
  const { user, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) return <Navigate to={homePathFor(user)} replace />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const me = await api<MeUser>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
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
        <h1>Entrar no Trilho</h1>
        <p className="subtitle">Acesse sua conta para acompanhar os projetos.</p>

        {error && <div className="error-box">{error}</div>}

        <label className="field">
          <span>E-mail</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
        </label>

        <label className="field">
          <span>Senha</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        <button type="submit" className="btn" disabled={submitting}>
          {submitting ? 'Entrando' : 'Entrar'}
        </button>

        <div className="link-row">
          <Link to="/esqueci-minha-senha">Esqueci minha senha</Link>
        </div>
      </form>
    </div>
  );
}
