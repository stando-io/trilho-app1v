import 'dotenv/config';

const nodeEnv = process.env.NODE_ENV ?? 'development';

function requiredInProduction(name: string, value: string | undefined): string {
  if (!value && nodeEnv === 'production') {
    throw new Error(`Variável obrigatória em produção ausente: ${name}`);
  }
  return value ?? '';
}

export const config = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  port: Number(process.env.PORT ?? 4000),
  databaseUrl:
    process.env.DATABASE_URL ??
    'postgres://trilho:trilho_local@localhost:5432/trilho_system',
  sessionSecret: requiredInProduction('SESSION_SECRET', process.env.SESSION_SECRET) || 'dev-secret-nao-usar-em-producao',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  baseUrl: process.env.BASE_URL ?? 'http://localhost:5173',
} as const;
