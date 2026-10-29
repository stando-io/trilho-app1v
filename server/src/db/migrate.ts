import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { pool } from './pool.js';

const migrationsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../database/migrations/system',
);

export async function migrate(): Promise<string[]> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const applied: string[] = [];

  for (const file of files) {
    const exists = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE version = $1',
      [file],
    );
    if (exists.rowCount) continue;

    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
      await client.query('COMMIT');
      applied.push(file);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  return applied;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;

if (invokedDirectly) {
  migrate()
    .then(async (applied) => {
      if (applied.length === 0) {
        console.log('Migracoes: nada pendente.');
      } else {
        console.log(`Migracoes aplicadas: ${applied.join(', ')}`);
      }
      await pool.end();
    })
    .catch(async (error) => {
      console.error('Falha nas migracoes:', error);
      await pool.end();
      process.exit(1);
    });
}
