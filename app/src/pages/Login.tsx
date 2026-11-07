import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { homePathFor, useAuth } from '../auth';
import PublicHeader from '../components/PublicHeader';
import TrainIllustration from '../components/TrainIllustration';

type View = 'login' | 'signup' | 'pending';

interface LoginResponse {
  id: string;
  name: string;
  email: string;
}

export default function Login() {
  const { user, loading, refresh } = useAuth();
  const navigate = useNavigate();

  const [view, setView] = useState<View>('login');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingHint, setPendingHint] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [message, setMessage] = useState('');

  if (!loading && user) return <Navigate to={homePathFor(user)} replace />;

  function goTo(next: View) {
    setView(next);
    setError(null);
    setPendingHint(false);
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPendingHint(false);
    setSubmitting(true);
    try {
      await api<LoginResponse>('/auth/login', {
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
    setPendingHint(false);
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
      if (err instanceof ApiError && err.code === 'email_pending') setPendingHint(true);
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
          <div className="landing-intro">
            <h1 className="landing-title">
              Implantação com
              <br />
              destino certo
            </h1>
            <p className="landing-sub">
              Demandas, equipes e prazos de cada projeto no mesmo trilho, do primeiro pedido à entrega
            </p>
            <TrainIllustration />
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
                  onClick={() => goTo('login')}
                >
                  Entrar
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === 'signup'}
                  className={view === 'signup' ? 'landing-tab landing-tab-active' : 'landing-tab'}
                  onClick={() => goTo('signup')}
                >
                  Criar conta
                </button>
              </div>
            )}

            <div className="login-view" key={view}>
              {error && (
                <div className="error-box" role="alert">
                  {error}
                  {pendingHint && (
                    <button
                      type="button"
                      className="login-hint-btn"
                      onClick={() => goTo('pending')}
                    >
                      Ver status do pedido
                    </button>
                  )}
                </div>
              )}

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
                    <button type="button" className="login-link-btn" onClick={() => goTo('login')}>
                      Já tem conta? Entrar
                    </button>
                  </div>
                </form>
              )}

              {view === 'pending' && (
                <div className="landing-pending">
                  <div className="stepper">
                    <div className="stepper-step stepper-done">
                      <span className="stepper-icon">✓</span>
                      <span>Cadastro enviado</span>
                    </div>
                    <div className="stepper-step stepper-active">
                      <span className="stepper-icon stepper-dot" aria-hidden="true" />
                      <span>Em análise</span>
                    </div>
                    <div className="stepper-step">
                      <span className="stepper-icon stepper-circle" aria-hidden="true" />
                      <span>Acesso liberado</span>
                    </div>
                  </div>
                  <p className="muted">
                    Estamos avaliando seu cadastro. Assim que aprovado seu acesso sera liberado.
                  </p>
                  <button className="btn" type="button" onClick={() => goTo('login')}>
                    Voltar ao login
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
