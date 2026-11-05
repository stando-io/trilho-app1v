import type { MouseEvent } from 'react';
import { Link } from 'react-router-dom';

interface PublicHeaderProps {
  page: 'sobre' | 'login';
}

function handleComoFuncionaClick(event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault();
  const target = document.getElementById('como-funciona');
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export default function PublicHeader({ page }: PublicHeaderProps) {
  return (
    <header className="pub-header">
      <Link to="/" className="pub-logo" aria-label="Trilho - ir para o início">
        <img src="/logo.png" alt="Trilho" />
      </Link>
      <nav className="pub-nav" aria-label="Navegação principal">
        <Link
          to="/"
          className={page === 'sobre' ? 'pub-link pub-link-active' : 'pub-link'}
          aria-current={page === 'sobre' ? 'page' : undefined}
        >
          Sobre
        </Link>
        {page === 'sobre' ? (
          <a href="#como-funciona" className="pub-link" onClick={handleComoFuncionaClick}>
            Como funciona
          </a>
        ) : (
          <Link to="/#como-funciona" className="pub-link">
            Como funciona
          </Link>
        )}
        {page === 'sobre' ? (
          <Link to="/login" className="pub-btn">
            Entrar
          </Link>
        ) : (
          <Link to="/" className="pub-btn">
            Voltar ao início
          </Link>
        )}
      </nav>
    </header>
  );
}
