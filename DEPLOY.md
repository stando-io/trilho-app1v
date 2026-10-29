# Deploy Trilho-app: Vercel + Render + Supabase

## Arquitetura
- **Frontend (Vercel)**: `app/` - Vite + React
- **Backend (Render)**: `server/` - Express + WebSocket
- **Database (Supabase)**: `database/migrations/system/` - PostgreSQL

## 1. Supabase Setup

1. Crie projeto no [Supabase](https://supabase.com)
2. No SQL Editor, execute as migrations em ordem:
   ```bash
   # Localmente, para testar:
   cd server && DATABASE_URL="postgresql://postgres:password@db.xxx.supabase.co:5432/postgres?pgbouncer=true" npm run migrate
   ```
3. Anote: `Project URL`, `anon public key`, `service_role key`
4. Em **Authentication > URL Configuration**:
   - Site URL: `https://seu-app.vercel.app`
   - Redirect URLs: `https://seu-app.vercel.app/**`

## 2. Render Backend Deploy

1. Conecte repo GitHub no [Render](https://render.com)
2. New > Web Service > Connect repo
3. Configuração automática via `render.yaml` (já incluído)
4. Variáveis de ambiente obrigatórias no painel Render:
   - `DATABASE_URL` = Connection string do Supabase (com `?pgbouncer=true`)
   - `SESSION_SECRET` = (auto-gerado pelo Render)
   - `BASE_URL` = URL do frontend Vercel (ex: `https://trilho-app.vercel.app`)
   - `EXTRA_CORS_ORIGINS` = URLs extras separadas por vírgula (opcional, para preview deployments)
   - `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` = para seed inicial

## 3. Vercel Frontend Deploy

1. Importe repo no [Vercel](https://vercel.com)
2. Configure:
   - **Framework Preset**: Vite
   - **Root Directory**: `app`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
3. Environment Variables:
   - `VITE_API_URL` = URL do Render (ex: `https://trilho-api.onrender.com`)
   - `VITE_WS_URL` = WebSocket URL do Render (ex: `wss://trilho-api.onrender.com`)

## 4. Variáveis de Ambiente Resumo

### Render (Backend)
| Variável | Valor |
|----------|-------|
| `NODE_ENV` | `production` |
| `PORT` | `4000` |
| `DATABASE_URL` | `postgresql://postgres:xxx@db.xxx.supabase.co:5432/postgres?pgbouncer=true` |
| `SESSION_SECRET` | (gerado automaticamente) |
| `COOKIE_SECURE` | `true` |
| `BASE_URL` | `https://seu-app.vercel.app` |
| `EXTRA_CORS_ORIGINS` | `https://seu-app-git-main.vercel.app,https://seu-app-git-dev.vercel.app` |
| `ADMIN_EMAIL` | `admin@seu-dominio.com` |
| `ADMIN_NAME` | `Administrador` |
| `ADMIN_PASSWORD` | (senha forte) |

### Vercel (Frontend)
| Variável | Valor |
|----------|-------|
| `VITE_API_URL` | `https://trilho-api.onrender.com` |
| `VITE_WS_URL` | `wss://trilho-api.onrender.com` |

## 5. Testes Pós-Deploy

```bash
# Health check backend
curl https://trilho-api.onrender.com/health

# Frontend
# Acesse https://seu-app.vercel.app
```

## 6. Render Free Tier - Keep Alive

O free tier dorme após 15min sem tráfego. Para evitar:
- Configure [cron-job.org](https://cron-job.org) para ping `https://trilho-api.onrender.com/health` a cada 10min
- Ou migre para plano pago quando necessário

## 7. Atualizações

- Push na `main` → Deploy automático no Vercel e Render
- Preview deployments no Vercel para PRs
- Para migrations de DB: rodar manualmente via `npm run migrate` apontando para Supabase

## Estrutura de Arquivos de Deploy

```
trilho-app/
├── vercel.json          # Config Vercel (monorepo)
├── render.yaml          # Config Render (backend)
├── app/
│   ├── .env.example     # Variáveis frontend
│   └── ...
└── server/
    ├── .env.example     # Variáveis backend
    └── ...
```