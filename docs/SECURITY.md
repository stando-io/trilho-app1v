# Diretrizes de Seguranca

Responsavel: Brownie (CyberSecurity Squad). Aplicavel desde a F1.

## Autenticacao e sessao

- Senhas com hash Argon2 (@node-rs/argon2). Nunca armazenar senha em texto puro.
- Sessao por cookie `trilho.sid`: httpOnly, sameSite=lax, secure=true em producao (apos TLS).
- Secao expira em 7 dias; logout destrói a sessao no servidor.
- `SESSION_SECRET` obrigatorio em producao, fora do repositorio (variavel de ambiente).
- Tentativas de login limitadas: 30 por IP em 15 minutos nas rotas publicas.

## Convite e redefinicao de senha

- Sem SMTP nesta versao: o link e gerado pela API e copiado pelo administrador.
- Token: 32 bytes aleatorios (base64url). No banco guarda-se apenas o hash SHA-256 do token.
- Convite vale 7 dias, uso unico (accepted_at).
- Link de redefinicao vale 24 horas, uso unico (used_at).
- Consumo do token e atomico: depois de usado, nova tentativa retorna 400.
- Resposta de redefinicao nunca revela se o e-mail existe.

## Autorizacao (RBAC)

- Toda rota autenticada passa por `requireAuth` (usuario ativo + perfil vigente).
- Rotas administrativas exigem `requireScreen('settings')` no servidor, nao apenas no menu.
- Telas validadas contra a lista oficial: home, dashboard, base, kanban, reports, settings.
- Perfis nao podem conter telas desconhecidas (validacao no servidor).
- Usuario nao pode desativar a propria conta.

## Dados e infraestrutura

- TLS 1.3 na terminacao (proxy reverso) em producao; HSTS no proxy.
- Banco de sistema separado dos bancos de projeto (isolamento por projeto, RNF05).
- Nenhum segredo, token ou senha em log. Auditoria grava acao, usuario, IP e metadados.
- Helmet ativo na API. CORS restrito a origem do frontend.
- Variaveis sensiveis apenas em `.env` (ignorado pelo Git).
- Senha de seguranca (F4): armazenada como hash Argon2 no proprio banco do projeto.

## Antes de producao (F5)

- Pentest: autenticacao, RBAC, SQL injection, rate limit, tokens de convite/reset.
- Revisao de dependencias vulneraveis.
- Confirmar cookie secure, TLS 1.3 e HSTS no ambiente real.
