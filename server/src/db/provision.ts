import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { databaseUrlFor, pool } from './pool.js';
import { dropProjectPool } from './projectPool.js';
import { slugify } from '../services/tokens.js';

const templatePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../database/migrations/project/001_project_template.sql',
);

export async function provisionProject(projectName: string): Promise<{ id: string; dbName: string }> {
  const slug = slugify(projectName);
  if (!slug) {
    throw new Error('Nome de projeto inválido para gerar o banco dedicado');
  }
  const dbName = `trilho_proj_${slug}`;

  const created = await pool.query(
    `INSERT INTO projects (name, db_name) VALUES ($1, $2)
     ON CONFLICT (db_name) DO NOTHING
     RETURNING id, db_name`,
    [projectName.trim(), dbName],
  );

  if (created.rowCount === 0) {
    throw new Error(`Ja existe um projeto com o identificador ${dbName}`);
  }
  const row = created.rows[0];
  if (!row) throw new Error('Falha ao registrar projeto');

  const admin = new pg.Client({ connectionString: configAdminUrl() });
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } catch (error) {
    await pool.query('DELETE FROM projects WHERE id = $1', [row.id]);
    if (error instanceof Error && /already exists/i.test(error.message)) {
      throw new Error(`Banco "${dbName}" ja existe sem registro no sistema`);
    }
    throw error;
  } finally {
    await admin.end();
  }

  const projectClient = new pg.Client({
    connectionString: databaseUrlFor(dbName),
  });
  try {
    await projectClient.connect();
    const template = await readFile(templatePath, 'utf8');
    await projectClient.query(template);
  } catch (error) {
    const drop = new pg.Client({ connectionString: configAdminUrl() });
    try {
      await drop.connect();
      await drop.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    } finally {
      await drop.end();
    }
    await pool.query('DELETE FROM projects WHERE id = $1', [row.id]);
    throw error;
  } finally {
    await projectClient.end();
  }

  return { id: row.id as string, dbName };
}

function configAdminUrl(): string {
  return (
    process.env.DATABASE_URL ??
    'postgres://trilho:trilho_local@localhost:5432/trilho_system'
  );
}

export async function deprovisionProject(projectId: string, dbName: string): Promise<void> {
  await dropProjectPool(dbName);
  await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);

  const admin = new pg.Client({ connectionString: configAdminUrl() });
  try {
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;

if (invokedDirectly) {
  const name = process.argv[2];
  if (!name) {
    console.error('Uso: npm run provision -- "Nome do Projeto"');
    process.exit(1);
  }
  provisionProject(name)
    .then(async (result) => {
      console.log(`Projeto provisionado: ${result.id} (${result.dbName})`);
      await pool.end();
    })
    .catch(async (error) => {
      console.error('Falha no provisionamento:', error);
      await pool.end();
      process.exit(1);
    });
}
