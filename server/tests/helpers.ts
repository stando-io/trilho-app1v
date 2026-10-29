import { hash } from '@node-rs/argon2';
import pg from 'pg';
import { pool, queryOne } from '../src/db/pool.js';
import { dropProjectPool } from '../src/db/projectPool.js';
import { migrate } from '../src/db/migrate.js';
import { SCREENS } from '../src/services/screens.js';
import { PERMISSION_LEAVES } from '../src/services/permissions.js';

export const ADMIN_EMAIL = 'admin-test@trilho.local';
export const ADMIN_PASSWORD = 'admin-test-pass-123';

let counter = 0;

export function uniqueEmail(prefix = 'user'): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}@test.local`;
}

export async function setup(): Promise<void> {
  await migrate();
  await pool.query('DELETE FROM system_settings');

  const profile = await queryOne<{ id: string }>(
    `INSERT INTO profiles (name, description, screens, permissions)
     VALUES ('Admin Teste', 'Perfil de teste com todas as telas', $1::jsonb, $2::jsonb)
     ON CONFLICT (name) DO UPDATE SET screens = EXCLUDED.screens,
                                      permissions = EXCLUDED.permissions
     RETURNING id`,
    [JSON.stringify(SCREENS), JSON.stringify(PERMISSION_LEAVES)],
  );
  if (!profile) throw new Error('Falha ao criar perfil de teste');

  const passwordHash = await hash(ADMIN_PASSWORD);
  await pool.query(
    `INSERT INTO users (name, email, password_hash, profile_id, is_active)
     VALUES ('Admin Teste', $1, $2, $3, true)
     ON CONFLICT (email)
     DO UPDATE SET password_hash = EXCLUDED.password_hash,
                   profile_id = EXCLUDED.profile_id,
                   is_active = true`,
    [ADMIN_EMAIL, passwordHash, profile.id],
  );
}

export async function dropProject(projectId: string): Promise<void> {
  const project = await queryOne<{ db_name: string }>(
    'SELECT db_name FROM projects WHERE id = $1',
    [projectId],
  );
  if (!project) return;

  await dropProjectPool(project.db_name);
  await pool.query('DELETE FROM project_members WHERE project_id = $1', [projectId]);
  await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);

  const admin = new pg.Client({
    connectionString:
      process.env.DATABASE_URL ?? 'postgres://trilho:trilho_local@localhost:5432/trilho_system',
  });
  try {
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${project.db_name}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}
