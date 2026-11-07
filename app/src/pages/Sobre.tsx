import { useEffect } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import PublicHeader from '../components/PublicHeader';

const MARKETS = [
  { name: 'Consultoria', icon: 'chat' },
  { name: 'Projetos', icon: 'folder' },
  { name: 'T.I', icon: 'server' },
  { name: 'Desenv. de Software', icon: 'code' },
  { name: 'Construção Civil', icon: 'helmet' },
  { name: 'Marketing', icon: 'megaphone' },
  { name: 'Operações & Logística', icon: 'truck' },
];

const IMPACTS = [
  {
    icon: 'eye',
    title: 'Informações em um só lugar e em tempo real',
    desc: 'Visibilidade imediata sem a necessidade de solicitar relatórios manuais',
  },
    {
    icon: 'layers',
    title: 'Centralize todas as informações em uma única ferramenta',
    desc: 'Elimine planilhas, ruídos de comunicação entre setores, retrabalhos e perdas de tarefas em mensagens de WhatsApp',
  },
  {
    icon: 'trophy',
    title: 'Feito para transformar seus planos em conquistas',
    desc: 'Metodologia orientada a prazos, metas e absorção de conhecimento',
  },

];

const PILLARS = [
  {
    icon: 'bulb',
    name: 'Ideia',
    role: 'Demanda Inicial',
    desc: 'A necessidade nasce com código, prioridade e setor responsável vinculado',
  },
  {
    icon: 'target',
    name: 'Desafio',
    role: 'Mapeamento de Gargalos',
    desc: 'Diagnóstico das lacunas operacionais e definição clara de escopo',
  },
  {
    icon: 'calendar',
    name: 'Planejamento',
    role: 'Estruturação no Trilho',
    desc: 'Definição de prazos, atribuição de tarefas e organização no Kanban',
  },
  {
    icon: 'play',
    name: 'Solução',
    role: 'Execução & Acompanhamento',
    desc: 'Registro contínuo das ações pelos times com atualização em tempo real',
  },
  {
    icon: 'flag',
    name: 'Entrega',
    role: 'Encerramento & Aprendizado',
    desc: 'Conclusão da demanda com avaliação de nota (0 a 10), dados no Dashboard e Relatórios',
  },
];

const STATIONS = [
  { name: 'Solicitação', desc: 'O pedido nasce com código e prioridade', state: 'open' },
  { name: 'Análise', desc: 'A equipe define responsável e prazo', state: 'open' },
  { name: 'Andamento', desc: 'O técnico assume e registra o trabalho', state: 'open' },
  { name: 'Observação', desc: 'Nota de 0 a 10 sobre a absorção do setor', state: 'filled' },
  { name: 'Concluído', desc: 'A demanda fecha e entra nos relatórios', state: 'muted' },
];

const WAGONS = [
  { name: 'Início', hint: 'Fase de concepção onde o projeto ganha forma e justificativa' },
  { name: 'Planejamento', hint: 'O desenho do roteiro detalhado para alcançar o objetivo' },
  { name: 'Execução', hint: 'A colocação do plano em prática e a realização das entregas' },
  { name: 'Monitoramento', hint: 'O acompanhamento contínuo que corre em paralelo à execução' },
  { name: 'Encerramento', hint: 'A finalização formal de todas as atividades do projeto.' },
];

const ROLES = [
  {
    role: 'Gestão (Diretores, Gerentes e Coordenadores)',
    desc: 'Abre projetos, monte a equipe e acompanha prazos e progresso no Dashboard ou gerar relatórios',
  },
  {
    role: 'Líderes de Setors',
    desc: 'Abre tarefas para departamentos e setores, distribui o trabalho entre os times',
  },
  {
    role: 'Times & Squads (Executores)',
    desc: 'Assume tarefas, registra o atendimento e avalia o aprendizado/nível do setor',
  },
  {
    role: 'Visitante (Cliente/Fornecedor)',
    desc: 'Acompanha o andamento das tarefas e recebe notificações de prazo e atraso em projetos que participa',
  },
];

const QUOTES = [
  {
    text: 'Em 1 semana o time parou de perguntar "onde está isso ou qual era proxima tarefa?". Tudo está no Trilho.',
    name: 'Mariana Alves',
    role: 'Gerente de Operações · EMI7 Solutions',
  },
  {
    text: 'O índice de aprendizado mostrou quais setores precisavam de apoio. Mudou nossa forma de treinar as equipes.',
    name: 'Debora Oliveira',
    role: 'Coordenadora Administrativa · Posto Marítimo',
  },
];

const MARQUEE_ITEMS = [
  'Índice de aprendizado por setor (nota 0 a 10)',
  'Demanda direto da Base com um clique',
  'Kanban por projeto em tempo real',
  'Dashboard de prazos e progresso',
  'Relatórios prontos para apresentar',
  'Histórico rastreável de cada demanda',
  'Aprovação de acesso no painel admin',
  'Departamentos e setores cadastrados',
  'Acesso por perfis (Gestor, Líder, Times, Visitante)',
  'Webhooks e integrações',
  'Filtros por status, prioridade e responsável',
  'Alertas de prazo e atraso',
  'Histórico auditável de alterações',
  'Visão por departamento e setor',
  'Prioridade e código em cada demanda',
];

const ICONS: Record<string, ReactNode> = {
  chat: (
    <>
      <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l2.3-2.3A8.5 8.5 0 1 1 21 11.5z" />
      <path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  server: (
    <>
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </>
  ),
  code: <path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />,
  helmet: (
    <>
      <path d="M5 14a7 7 0 0 1 14 0z" />
      <path d="M10 7.5V6a2 2 0 0 1 4 0v1.5" />
      <path d="M3 14h18v3H3z" />
    </>
  ),
  megaphone: (
    <>
      <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18 6a8 8 0 0 1 0 12" />
    </>
  ),
  truck: (
    <>
      <path d="M3 7h11v9H3z" />
      <path d="M14 10h4l3 3v3h-7z" />
      <circle cx="7" cy="18" r="1.6" />
      <circle cx="17" cy="18" r="1.6" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  trophy: (
    <>
      <path d="M8 4h8v5a4 4 0 0 1-8 0z" />
      <path d="M8 5H5a3 3 0 0 0 3 3M16 5h3a3 3 0 0 1-3 3" />
      <path d="M12 13v3M9 20h6M10 16h4v4h-4z" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5z" />
      <path d="m3 13 9 5 9-5" />
    </>
  ),
  bulb: (
    <>
      <path d="M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.5 1 2.5h6c0-1 .4-1.9 1-2.5A6 6 0 0 0 12 3z" />
      <path d="M10 19h4M10.5 21.5h3" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M4 10h16" />
      <path d="M9 14h2v4H9zM14 14h2v4h-2z" />
    </>
  ),
  play: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="m10 9 5 3-5 3z" />
    </>
  ),
  flag: (
    <>
      <path d="M6 21V4" />
      <path d="M6 4h12l-3 4 3 4H6" />
      <path d="m10 16 2 2 4-4" />
    </>
  ),
};

function Glyph({ name }: { name: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

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
                Software para Gestão de Projetos
              </p>
              <h1>
                Cada demanda
                <br />
                no seu trilho
              </h1>
              <p className="sobre-subtitle">
                Gerencie, visualize e acompanhe equipes, tarefas e projetos do planejamento até a
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
        </section>

        <section
          className="sobre-block sobre-institucional"
          id="sobre-trilho"
          aria-labelledby="sobre-trilho-titulo"
        >
          <h2 className="sobre-title" id="sobre-trilho-titulo">
            A plataforma definitiva para colocar sua operação no trilho certo
          </h2>
          <p className="sobre-inst-text">
            A Trilho foi concebido para eliminar a fragmentação de processos e garantir
            rastreabilidade total em todas as etapas da sua operação. Da primeira solicitação ao
            relatório de entrega, centralizamos tarefas, equipes e indicadores em um fluxo visual
            simples, seguro e transparente.
          </p>
          <ul className="sobre-impacts">
            {IMPACTS.map((item) => (
              <li key={item.title} className="sobre-impact">
                <span className="sobre-impact-icon">
                  <Glyph name={item.icon} />
                </span>
                <span className="sobre-impact-body">
                  <span className="sobre-impact-title">{item.title}</span>
                  <span className="sobre-impact-desc">{item.desc}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="sobre-block sobre-ramos" id="ramos" aria-labelledby="sobre-ramos-titulo">
          <h2 className="sobre-markets-title" id="sobre-ramos-titulo">
            Para todo time e mercado. Em qual ramo você atua?
          </h2>
          <ul className="sobre-market-cards">
            {MARKETS.map((market) => (
              <li key={market.name} className="sobre-market-card">
                <span className="sobre-market-icon">
                  <Glyph name={market.icon} />
                </span>
                <span>{market.name}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="sobre-block" id="pilares" aria-labelledby="sobre-pilares-titulo">
          <h2 className="sobre-label" id="sobre-pilares-titulo">
            Os 5 pilares da metodologia Trilho
          </h2>
          <ol className="sobre-pillars">
            {PILLARS.map((pillar, index) => (
              <li key={pillar.name} className="sobre-pillar">
                <span className="sobre-pillar-num">{String(index + 1).padStart(2, '0')}</span>
                <span className="sobre-pillar-icon">
                  <Glyph name={pillar.icon} />
                </span>
                <span className="sobre-pillar-name">{pillar.name}</span>
                <span className="sobre-pillar-role">{pillar.role}</span>
                <span className="sobre-pillar-desc">{pillar.desc}</span>
              </li>
            ))}
          </ol>
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

        <section id="diferenciais" className="sobre-dif" aria-labelledby="sobre-dif-titulo">
          <h2 className="sobre-label sobre-dif-label" id="sobre-dif-titulo">
            Diferenciais
          </h2>

          <div className="sobre-marquee" aria-label="Diferenciais em destaque">
            <div className="sobre-marquee-track">
              {[...MARQUEE_ITEMS, ...MARQUEE_ITEMS].map((item, index) => (
                <span key={`a-${item}-${index}`} className="sobre-marquee-item">
                  {item}
                  <span className="sobre-marquee-sep" aria-hidden="true">
                    •
                  </span>
                </span>
              ))}
            </div>
          </div>

          <ul className="sobre-quotes">
            {QUOTES.map((quote) => (
              <li key={quote.name} className="sobre-quote">
                <span className="sobre-quote-mark" aria-hidden="true">
                  “
                </span>
                <p className="sobre-quote-text">{quote.text}</p>
                <span className="sobre-quote-author">{quote.name}</span>
                <span className="sobre-quote-role">{quote.role}</span>
              </li>
            ))}
          </ul>

          <div className="sobre-marquee sobre-marquee--rev" aria-label="Diferenciais em destaque (direção oposta)">
            <div className="sobre-marquee-track">
              {[...MARQUEE_ITEMS, ...MARQUEE_ITEMS].map((item, index) => (
                <span key={`b-${item}-${index}`} className="sobre-marquee-item">
                  {item}
                  <span className="sobre-marquee-sep" aria-hidden="true">
                    •
                  </span>
                </span>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="pub-footer">
        <span>Projetado e desenvolvido por Stando</span>
        <nav className="pub-footer-links" aria-label="Links legais">
          <a href="#">Política de Privacidade</a>
          <a href="#">Termos de Uso</a>
          <a href="#">Política de Cookies</a>
        </nav>
        <span>© 2026 Trilho • Todos os direitos reservados</span>
      </footer>
    </div>
  );
}
