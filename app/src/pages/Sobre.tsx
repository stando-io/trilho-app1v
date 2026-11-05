import { useEffect } from 'react';
import type { MouseEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import PublicHeader from '../components/PublicHeader';

const MARKETS = [
  'Serviço e Consultoria',
  'Projetos',
  'T.I',
  'Desenv. de Software',
  'Construção Civil',
  'Marketing',
  'Operações & Logística',
];

const STATIONS = [
  { name: 'Solicitação', desc: 'O pedido nasce com código e prioridade.', state: 'open' },
  { name: 'Análise', desc: 'A equipe define responsável e prazo.', state: 'open' },
  { name: 'Andamento', desc: 'O técnico assume e registra o trabalho.', state: 'open' },
  { name: 'Observação', desc: 'Nota de 0 a 10 sobre a absorção do setor.', state: 'filled' },
  { name: 'Concluído', desc: 'A demanda fecha e entra nos relatórios.', state: 'muted' },
];

const WAGONS = [
  { name: 'Início', hint: 'Ponto de partida do seu dia' },
  { name: 'Dashboard', hint: 'Prazos e progresso em um olhar' },
  { name: 'Base', hint: 'Departamentos e setores com suas demandas' },
  { name: 'Kanban', hint: 'O quadro de cada projeto em movimento' },
  { name: 'Relatórios', hint: 'Números prontos para apresentar' },
];

const ROLES = [
  {
    role: 'Gestor',
    desc: 'Abre projetos, monta a equipe e acompanha prazos e progresso no Dashboard.',
  },
  {
    role: 'Líderes',
    desc: 'Abre tarefas pelos departamentos e setores e distribui o trabalho entre os times.',
  },
  {
    role: 'Times & Squads',
    desc: 'Assume demandas, registra o atendimento e avalia o aprendizado/nível do setor.',
  },
  {
    role: 'Visitante',
    desc: 'Acompanha o andamento de projetos vinculados a ele.',
  },
];

const DIFFERENTIALS = [
  {
    title: 'Índice de aprendizado',
    desc: 'Cada atendimento recebe uma nota e o Dashboard mostra a média de cada setor.',
  },
  {
    title: 'Demanda direto da Base',
    desc: 'Cada departamento cadastrado abre uma demanda no quadro com um clique.',
  },
];

function handleHeroComoFunciona(event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault();
  document.getElementById('como-funciona')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function RailPreview() {
  return (
    <div className="sobre-rail">
      <div className="sobre-rail-track" aria-hidden="true" />
      <div className="sobre-rail-train">
        <span className="sobre-loco" aria-hidden="true" />
        {WAGONS.map((wagon) => (
          <div key={wagon.name} className="sobre-wagon">
            <span className="sobre-wagon-name">{wagon.name}</span>
            <span className="sobre-wagon-hint">{wagon.hint}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Sobre() {
  const location = useLocation();

  useEffect(() => {
    if (location.hash === '#como-funciona') {
      document.getElementById('como-funciona')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [location.hash]);

  return (
    <div className="pub-page sobre-page">
      <PublicHeader page="sobre" />

      <main>
        <section className="sobre-hero">
          <div className="sobre-hero-cols">
            <div className="sobre-hero-text">
              <p className="sobre-eyebrow">
                <span className="sobre-dash" aria-hidden="true" />
                Gestão de implantações
              </p>
              <h1>
                Cada demanda
                <br />
                no seu trilho
              </h1>
              <p className="sobre-subtitle">
                Gerencie-Visualize-Acompanhe equipes, tarefas e projetos do planejamento até a
                entrega final.
              </p>
              <div className="sobre-actions">
                <Link to="/login" className="sobre-cta">
                  Entrar
                </Link>
                <a href="#como-funciona" className="sobre-ghost" onClick={handleHeroComoFunciona}>
                  ver como funciona
                </a>
              </div>
            </div>

            <div className="sobre-hero-preview">
              <RailPreview />
            </div>
          </div>

          <div className="sobre-markets">
            <p className="sobre-markets-title">
              Para todo time e mercado. Em qual ramo você atua?
            </p>
            <ul className="sobre-market-cards">
              {MARKETS.map((market) => (
                <li key={market} className="sobre-market-card">
                  <span>{market}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="sobre-block" id="como-funciona" aria-labelledby="sobre-como-titulo">
          <h2 className="sobre-label" id="sobre-como-titulo">
            Como funciona
          </h2>
          <div className="sobre-flow-wrap">
            <span className="sobre-flow-line" aria-hidden="true">
              <span className="sobre-flow-line-orange" />
              <span className="sobre-flow-line-gray" />
            </span>
            <ol className="sobre-flow">
              {STATIONS.map((station) => (
                <li key={station.name} className="sobre-station">
                  <span
                    className={`sobre-dot sobre-dot-${station.state}`}
                    aria-hidden="true"
                  />
                  <span className="sobre-station-name">{station.name}</span>
                  <span className="sobre-station-desc">{station.desc}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="sobre-block" id="para-quem-e" aria-labelledby="sobre-quem-titulo">
          <h2 className="sobre-label" id="sobre-quem-titulo">
            Para quem é
          </h2>
          <ul className="sobre-roles">
            {ROLES.map((item) => (
              <li key={item.role} className="sobre-role">
                <span className="sobre-role-name">{item.role}</span>
                <span className="sobre-role-desc">{item.desc}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="sobre-block" id="diferenciais" aria-labelledby="sobre-dif-titulo">
          <h2 className="sobre-label" id="sobre-dif-titulo">
            Diferenciais
          </h2>
          <ul className="sobre-differentials">
            {DIFFERENTIALS.map((item) => (
              <li key={item.title} className="sobre-differential">
                <span className="sobre-differential-title">{item.title}</span>
                <span className="sobre-differential-desc">{item.desc}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="pub-footer">
        <span>Projetado e desenvolvido por Stando</span>
        <span>© 2026 Trilho • Todos os direitos reservados</span>
      </footer>
    </div>
  );
}
