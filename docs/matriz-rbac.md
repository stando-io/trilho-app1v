# Matriz RBAC — Configurações

Documento:
MATRIZ_RBAC

Versão:
1.0

Status:
OFICIAL

Depende de:
README.md (Convenções)

Utilizado por:
Todos que alterarem funcionalidades de Configurações (app e server)

Última atualização:
2026-10-05

---

## Regra de ouro

**Toda funcionalidade nova em Configurações só pode existir se entrar na regra de
níveis de acesso.** Nenhuma seção, botão, tela ou rota nasce fora dessa regra.

Checklist obrigatório (os 6 passos) — nada é considerado entregue sem todos:

1. **Leaf no server** — adicionar a chave em `server/src/services/permissions.ts`
   (`PERMISSION_LEAVES`), no formato `settings.<secao>.<acao>`.
2. **Item na árvore do app** — adicionar a ação em `app/src/permissions.ts`
   (`PERMISSION_TREE`, módulo `settings`), com rótulo legível.
3. **Seção mapeada** — se for nova seção: entrada em `ALL_SECTIONS`, em
   `SECTION_PERMISSIONS` e no menu (`ACCOUNT_GROUP`/`TRAILING_SECTIONS`) de
   `app/src/pages/Settings.tsx`.
4. **Gate na API** — toda rota da funcionalidade (inclusive GET de leitura) usa
   `requirePermission(...)` com o leaf. `requirePermission` aceita vários leaves e
   aprova se o usuário tiver **qualquer um** deles.
5. **Gate na UI** — botões e blocos usam `can(currentUser, '<leaf>')`; a seção só
   aparece se o usuário tiver algum leaf dela (`SECTION_PERMISSIONS`).
6. **Teste** — cobrir 403 sem permissão e 200 com permissão. O guard automático
   (`server/tests/settings-rbac.guard.test.ts`) falha o build se os passos 1–5
   forem esquecidos.

---

## Mapeamento atual

| Seção | Leaves | Rotas (leitura + ações) | Gate UI |
| --- | --- | --- | --- |
| Minha Conta | `settings.minha_conta` | `GET/PATCH /auth/me`, `POST /auth/change-password` | `SECTION_PERMISSIONS.conta` |
| Usuários | `settings.usuarios.novo/editar/excluir` | `GET /users` (leitura), `POST /auth/invite`, `POST /auth/users/:id/reset-link`, `PATCH/DELETE /users/:id` | `SECTION_PERMISSIONS.usuarios` + `can()` por ação |
| Cargos | `settings.cargos.novo/editar/excluir` | `GET /roles` (leitura), `POST/PUT/DELETE /roles/:id` | `SECTION_PERMISSIONS.cargos` + `can()` por ação |
| Níveis de Acesso | `settings.niveis.novo/editar/excluir` | `GET /profiles` (leitura), `POST/PUT/DELETE /profiles/:id` | `SECTION_PERMISSIONS.perfis` + `can()` por ação |
| Temas | `settings.temas` | `PUT /settings/board-background` | `SECTION_PERMISSIONS.layout` |
| Senha de Segurança | `settings.seguranca` | `GET/PUT/DELETE /settings/security-password` | `SECTION_PERMISSIONS.seguranca` |
| Integrações | `settings.integracoes` | `GET /api-keys` (leitura), `POST/DELETE /api-keys` | `SECTION_PERMISSIONS.chaves` |
| Auditoria | `settings.auditoria` | `GET /audit` | `SECTION_PERMISSIONS.auditoria` |

---

## Leitura de listas (GET)

A leitura também é regra de níveis de acesso: exige pelo menos **um** leaf da
seção correspondente. Quem tem a tela `settings` mas nenhum leaf da seção recebe
`403` na listagem.

Exceção funcional documentada: `GET /users` também é usado pelos modais de criar
e editar projeto (seleção de membros). Por isso o gate é qualquer um destes:

- `settings.usuarios.novo` | `settings.usuarios.editar` | `settings.usuarios.excluir`
  (tela de Usuários), **ou**
- `home.novo_projeto` (modal de novo projeto na Home), **ou**
- `dashboard.projetos_recentes.editar` (modal de editar projeto no Dashboard).

Essa exceção é uma permissão da própria funcionalidade que consome a lista, não
uma brecha: continua sendo regra de níveis de acesso.

---

## Guard automático

`server/tests/settings-rbac.guard.test.ts` valida estaticamente:

1. Toda mutação (`POST/PUT/PATCH/DELETE`) dos routers de Configurações
   (`profiles`, `roles`, `users`, `settings`, `apiKeys`) declara
   `requirePermission`.
2. Todo leaf `settings.*` de `PERMISSION_LEAVES` é usado em alguma rota.
3. Paridade total entre `PERMISSION_TREE` (app) e `PERMISSION_LEAVES` (server).
4. Toda seção de `ALL_SECTIONS` possui entrada em `SECTION_PERMISSIONS`.

Violação = teste falha = entrega bloqueada (Quality Gate).

---

## Exemplo de nova funcionalidade

Funcionalidade: "Exportar CSV de usuários" (botão na seção Usuários).

1. Leaf: `settings.usuarios.exportar` em `permissions.ts` (server).
2. Árvore: ação "Exportar" no grupo Usuários em `permissions.ts` (app).
3. `SECTION_PERMISSIONS.usuarios` já cobre a seção (nenhuma mudança).
4. Rota: `GET /users/export` com `requirePermission('settings.usuarios.exportar')`.
5. Botão: renderizado só com `can(currentUser, 'settings.usuarios.exportar')`.
6. Teste: 403 sem a leaf, 200 com ela.

Sem os 6 passos, a funcionalidade não entra em Configurações.
