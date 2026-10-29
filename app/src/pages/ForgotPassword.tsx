import { Link } from 'react-router-dom';

export default function ForgotPassword() {
  return (
    <div className="center-page">
      <div className="auth-card">
        <h1>Esqueci minha senha</h1>
        <p className="subtitle">Como o acesso usa link direto, a redefinição é feita pelo administrador.</p>

        <div className="info-box">
          Peça ao administrador do sistema um link de redefinição. O link é pessoal, vale por 24 horas
          e pode ser usado uma única vez.
        </div>

        <div className="link-row">
          <Link to="/login">Voltar para o login</Link>
        </div>
      </div>
    </div>
  );
}
