import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

pg.types.setTypeParser(1082, (value: string) => value);

function parseConnectionString(connStr: string) {
  const sslModeMatch = connStr.match(/[?&]sslmode=([^&]+)/);
  const sslRejectUnauthorizedMatch = connStr.match(/[?&]sslrejectunauthorized=([^&]+)/);

  const sslMode = sslModeMatch ? sslModeMatch[1] : 'require';
  const sslRejectUnauthorized = sslRejectUnauthorizedMatch ? sslRejectUnauthorizedMatch[1] !== 'false' : true;

  let cleanStr = connStr
    .replace(/[?&]sslmode=[^&]+/g, '')
    .replace(/[?&]sslrejectunauthorized=[^&]+/g, '')
    .replace(/[?&]channel_binding=[^&]+/g, '')
    .replace(/\?&/g, '?')
    .replace(/&&+/g, '&')
    .replace(/&$/g, '')
    .replace(/\?$/g, '');

  const url = new URL(cleanStr);
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const database = url.pathname.replace(/^\//, '') || 'postgres';

  return {
    user,
    password,
    host: url.hostname,
    port: parseInt(url.port || '5432'),
    database,
    ssl: sslMode === 'disable' ? false : { rejectUnauthorized: sslRejectUnauthorized },
  };
}

function getPoolConfig() {
  const poolConfig = parseConnectionString(config.databaseUrl);
  console.log('[pool] Config (masked):', { ...poolConfig, password: '****' });
  return poolConfig;
}

export const pool = new Pool(getPoolConfig());

pool.on('error', (error: Error) => {
  console.error(`[db] cliente ocioso falhou: ${error.message}`);
});

export function databaseUrlFor(dbName: string): string {
  const parsed = new URL(config.databaseUrl);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}