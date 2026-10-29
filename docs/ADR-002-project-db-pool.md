# ADR 002: Pool de banco por projeto e guards de seguranca

Data: 2026-09-25
Status: Aprovada (plano F2)

## Contexto

RNF05 exige um banco de dados dedicado por projeto. A API precisa ler e escrever no banco do
projeto correto a cada requisicao, sem que cada rota lide com conexoes manualmente. Alem disso,
o F2 definiria quais operacoes exigem a senha de seguranca e quem pode acessar cada rota.

## Decisao

- Pool por projeto: `db/projectPool.ts` mantem um cache de pools (`Map<dbName, Pool>`) com
  chave por nome de banco. `getProjectPool(projectId)` resolve o banco pela tabela `projects`,
  cria o pool sob demanda e recusa projetos inativos (404). Remocao de pool via
  `dropProjectPool(dbName)` (usado nos testes para liberar conexoes antes do DROP DATABASE).
- Acesso: `databaseUrlFor(dbName)` reescreve o pathname do `DATABASE_URL` do sistema. O mesmo
  usuario (`trilho`, com CREATEDB) acessa o banco de sistema e os bancos de projeto.
- Cadeia de guards das rotas de projeto:
  `requireAuth` (sessao) -> `requireProjectMember` (uuid valido + pertencimento, 403) ->
  `requireScreen` / `requireAnyScreen` (RBAC de tela). `GET /projects/:id/sectors` aceita
  base, kanban e dashboard; escrita estrutural exige a tela correspondente.
- Sub-recursos ficam montados em `router.use('/:projectId', ..., baseRouter|kanbanRouter)`
  com `mergeParams: true`, garantindo que todo acesso a dados de projeto passe pelos guards.
- Senha de seguranca: verificacao server-side em `services/securityPassword.ts` (Argon2, header
  `x-security-password`). O frontend guarda a senha em memoria da sessao (`securityPassword.ts`),
  nunca em localStorage/cookie; erro 400 de senha abre o prompt novamente.
- Membros no F2: sem papéis. O criador do projeto entra como unico membro
  (`project_members` sem coluna role); gestao de membros fica para a F4.

## Alternativas descartadas

- Pool unico com `SET search_path` por requisicao: uma falha de isolamento mistura schemas de
  projetos diferentes e conexoes ficam presas a um search_path.
- Um pool novo por requisicao: custo de conectado alto e sem reaproveitamento.
- Senha de seguranca em localStorage: exposta a qualquer script da pagina e persiste apos logout.

## Consequencias

- Pools ficam em memoria por processo; reinicio da API reconecta sob demanda.
- Migracoes de schema de projeto precisam ser reaplicadas em todos os bancos existentes.
- Quem tem a senha de seguranca no frontend pode executar operacoes estruturais ate fechar a aba.
