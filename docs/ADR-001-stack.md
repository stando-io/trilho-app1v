# ADR 001: Stack tecnica

Data: 2026-09-24
Status: Aprovada (CEO), proposta na Reuniao de Lideres

## Contexto

RNF01 exige frontend, backend e banco desacoplados e hospedaveis independentemente.
RNF05 exige banco de dados isolado por projeto. RNF06 exige tempo real via WebSocket.
RNF03 exige respostas em ate 2 segundos. Uso interno, escala pequena (dezenas de usuarios).

## Decisao

- Frontend: React + TypeScript, build com Vite, roteamento com React Router, estilos em CSS
  variavel (tema menu escuro com telas claras, menu em abas sem barra lateral).
- Backend: Node.js + TypeScript, API REST versionada em /api/v1 (Express), validacao com Zod.
  Tempo real via WebSocket em salas por projeto (Socket.IO, a partir da F2).
- Banco: PostgreSQL. Banco de sistema (identidade, perfis, projetos, convites, auditoria,
  chaves de API) mais um banco dedicado por projeto criado por provisionamento automatico.
- Autenticacao: sessao em cookie httpOnly com armazenamento em Postgres; senha com Argon2.
- Seguranca: helmet, CORS restrito, rate limit em rotas publicas, tokens com hash SHA-256.
- Integracao externa: webhook do Discord (F5).

## Alternativas descartadas

- Framework fullstack unico (ex.: Next.js fullstack): violaria RNF01 de camadas desacopladas.
- Banco unico com coluna project_id: violaria RNF05 de isolamento por projeto.
- JWT stateless: mais complexo para revogacao imediata em ferramenta interna com sessao curta.

## Consequencias

- Cada projeto novo exige provisionamento de banco (script versionado em database/).
- Migracoes de schema de projeto precisam ser reaplicadas em todos os bancos de projeto.
- WebSocket por salas mantem o trafego isolado por projeto.
