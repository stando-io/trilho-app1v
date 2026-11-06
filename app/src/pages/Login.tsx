import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { homePathFor, useAuth } from '../auth';
import PublicHeader from '../components/PublicHeader';

type View = 'login' | 'signup' | 'pending';

export default function Login() {
  const { user, loading, refresh } = useAuth();
  const navigate = useNavigate();

  const [view, setView] = useState<View>('login');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [message, setMessage] = useState('');

  if (!loading && user) return <Navigate to={homePathFor(user)} replace />;

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api<unknown>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      const me = await refresh();
      if (me) navigate(homePathFor(me), { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'pending_approval') {
        setView('pending');
      } else {
        setError(err instanceof ApiError ? err.message : 'Erro ao entrar.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignup(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api<void>('/auth/request-access', {
        method: 'POST',
        body: JSON.stringify({
          name,
          email,
          company: company || undefined,
          message: message || undefined,
          password,
        }),
      });
      setView('pending');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao criar conta.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="pub-page login-page">
      <PublicHeader page="login" />
      <div className="landing-split">
      <div className="landing-left">
        <div className="landing-brand">
          <span className="landing-brand-name">Trilho</span>
          <span className="landing-brand-sub">Gestão de Implantações</span>
        </div>
      </div>

      <div className="landing-right">
        <div className="auth-card">
          {view !== 'pending' && (
            <div className="landing-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={view === 'login'}
                className={view === 'login' ? 'landing-tab landing-tab-active' : 'landing-tab'}
                onClick={() => { setView('login'); setError(null); }}
              >
                Entrar
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'signup'}
                className={view === 'signup' ? 'landing-tab landing-tab-active' : 'landing-tab'}
                onClick={() => { setView('signup'); setError(null); }}
              >
                Criar conta
              </button>
            </div>
          )}

          {error && <div className="error-box" role="alert">{error}</div>}

          {view === 'login' && (
            <form onSubmit={handleLogin} noValidate>
              <div className="field">
                <span>E-mail</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>
              <div className="field">
                <span>Senha</span>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <button className="btn" type="submit" disabled={submitting}>
                {submitting ? 'Entrando...' : 'Entrar'}
              </button>
              <div className="link-row">
                <Link to="/esqueci-minha-senha">Esqueci minha senha</Link>
              </div>
            </form>
          )}

          {view === 'signup' && (
            <form onSubmit={handleSignup} noValidate>
              <div className="field">
                <span>Nome</span>
                <input
                  type="text"
                  required
                  minLength={2}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                />
              </div>
              <div className="field">
                <span>E-mail</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>
              <div className="field">
                <span>Empresa/Órgão</span>
                <input
                  type="text"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                />
              </div>
              <div className="field">
                <span>Mensagem (opcional)</span>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </div>
              <div className="field">
                <span>Senha</span>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <button className="btn" type="submit" disabled={submitting}>
                {submitting ? 'Criando...' : 'Criar conta'}
              </button>
              <div className="link-row">
                <Link to="/login">Já tem conta? Entrar</Link>
              </div>
            </form>
          )}

          {view === 'pending' && (
            <div className="landing-pending">
              <div className="stepper">
                <div className="stepper-step stepper-done">
                  <span className="stepper-icon">✓</span>
                  <span>Cadastrado enviado</span>
                </div>
                <div className="stepper-step stepper-active">
                  <span className="stepper-icon stepper-dot">🟠</span>
                  <span>Em análise</span>
                </div>
                <div className="stepper-step">
                  <span className="stepper-icon stepper-circle">◯</span>
                  <span>Acesso liberado</span>
                </div>
              </div>
              <p className="muted">Estamos avaliando seu cadastro. Assim que aprovado seu acesso sera liberado.</p>
              <button className="btn" type="button" onClick={() => setView('login')}>
                Voltar ao login
              </button>
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
