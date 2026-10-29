# Trilho-app

Plataforma de gestão de equipes e projetos: múltiplos projetos independentes com escopo hierárquico (Setor, Departamento), Kanban, progresso em tempo real e controle de acesso por perfil.

## Estrutura

```
trilho-app/
  00-PROJECT/    contratos e snapshots oficiais (Discovery, Challenge, Planning, Leaders Meeting)
  app/           frontend (React + TypeScript, Vite)
  server/        backend (Node.js + TypeScript, REST /api/v1, WebSocket)
  database/      migrations SQL, template de schema por projeto, seeds
  docs/          OpenAPI, manual do usuário, matriz RBAC, ADRs, runbook
```

## Arquitetura

- Frontend, Backend e Banco de Dados desacoplados (RNF01).
- Banco de sistema (identidade, perfis, projetos, convites, auditoria, chaves de API) mais um banco dedicado por projeto (RNF05).
- API REST versionada em `/api/v1` com sessão autenticada e WebSocket por salas de projeto (RNF06).
- Menu em abas (sem barra lateral), tema de menu escuro com telas claras.

## Ambiente local

```bash
docker compose up -d          # postgres
cd server && npm install && npm run migrate && npm run dev
cd app && npm install && npm run dev
```

## Convenções

- Commits convencionais (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`).
- Semantic Versioning.
- Sem credenciais no repositório: use `.env` (veja `server/.env.example`).
