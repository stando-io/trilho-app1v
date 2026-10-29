import { useEffect, useState } from 'react';

const SHOW_DELAY_MS = 350;

export default function LoadingOverlay() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div className="loading-overlay" role="status">
      <div className="loading-box">
        <div className="loading-track">
          <img className="loading-track-img" src="/trilho-circulo.png" alt="" />
          <img className="loading-train" src="/trem-loader.png" alt="" />
        </div>
        <p className="loading-title">Carregando</p>
        <p className="loading-sub">Seguindo viagem...</p>
      </div>
    </div>
  );
}
