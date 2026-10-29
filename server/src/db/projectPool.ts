import pg from 'pg';
import { ApiError } from '../middleware/errors.js';
import { databaseUrlFor, queryOne } from './pool.js';

const { Pool } = pg;

const projectPools = new Map<string, pg.Pool>();

export async function getProjectPool(
  projectId: string,
): Promise<{ projectPool: pg.Pool; dbName: string }> {
  const project = await queryOne<{ db_name: string; is_active: boolean }>(
    'SELECT db_name, is_active FROM projects WHERE id = $1',
    [projectId],
  );
  if (!project || !project.is_active) {
    throw new ApiError(404, 'Projeto não encontrado');
  }

  let projectPool = projectPools.get(project.db_name);
  if (!projectPool) {
    projectPool = new Pool({ connectionString: databaseUrlFor(project.db_name), max: 5 });
    projectPool.on('error', (error: Error) => {
      console.error(`[projectPool] cliente ocioso falhou em ${project.db_name}: ${error.message}`);
    });
    projectPools.set(project.db_name, projectPool);
    try {
      await projectPool.query(
        'ALTER TABLE kanban_columns ADD COLUMN IF NOT EXISTS color text',
      );
      await projectPool.query('ALTER TABLE cards ADD COLUMN IF NOT EXISTS task_code text');
      await projectPool.query(
        'ALTER TABLE milestones ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT \'\'',
      );
      await projectPool.query('CREATE SEQUENCE IF NOT EXISTS seq_card_task_code');
      await projectPool.query(
        `UPDATE cards
         SET task_code = 'ST-' || LPAD(nextval('seq_card_task_code')::text, 4, '0')
         WHERE task_code IS NULL`,
      );
      await projectPool.query(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_task_code ON cards(task_code)',
      );
      await projectPool.query(
        `CREATE TABLE IF NOT EXISTS card_subtasks (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
          subtask_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (card_id, subtask_id),
          CHECK (card_id <> subtask_id)
        )`,
      );
      await projectPool.query(
        `CREATE TABLE IF NOT EXISTS card_comments (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
          user_id uuid,
          body text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )`,
      );
      await projectPool.query(
        'ALTER TABLE cards ADD COLUMN IF NOT EXISTS learning_index_active boolean NOT NULL DEFAULT false',
      );
      await projectPool.query(
        'ALTER TABLE cards ADD COLUMN IF NOT EXISTS learning_index_score integer',
      );
      await projectPool.query(
        "ALTER TABLE cards ADD COLUMN IF NOT EXISTS learning_index_note text NOT NULL DEFAULT ''",
      );
      await projectPool.query(
        `DO $$ BEGIN
           IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cards_learning_index_score_check') THEN
             ALTER TABLE cards ADD CONSTRAINT cards_learning_index_score_check
               CHECK (learning_index_score >= 0 AND learning_index_score <= 10);
           END IF;
         END $$`,
      );
      await projectPool.query(
        `CREATE TABLE IF NOT EXISTS card_responsibles (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
          user_id uuid NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (card_id, user_id)
        )`,
      );
      await projectPool.query(
        'CREATE INDEX IF NOT EXISTS idx_card_responsibles_card ON card_responsibles(card_id)',
      );
      await projectPool.query(
        'CREATE INDEX IF NOT EXISTS idx_card_responsibles_user ON card_responsibles(user_id)',
      );
      await projectPool.query(
        `CREATE TABLE IF NOT EXISTS card_attachments (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
          filename text NOT NULL,
          url text NOT NULL,
          size_bytes integer,
          uploaded_by uuid,
          created_at timestamptz NOT NULL DEFAULT now()
        )`,
      );
      await projectPool.query(
        'CREATE INDEX IF NOT EXISTS idx_card_attachments_card ON card_attachments(card_id)',
      );
      await projectPool.query(
        'ALTER TABLE card_attachments ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0',
      );
      await projectPool.query(
        `UPDATE card_attachments ca
         SET position = ranked.rn
         FROM (
           SELECT id, row_number() OVER (PARTITION BY card_id ORDER BY created_at, id) - 1 AS rn
           FROM card_attachments
         ) ranked
         WHERE ca.id = ranked.id AND ca.position <> ranked.rn`,
      );
      await projectPool.query(
        `INSERT INTO card_responsibles (card_id, user_id)
         SELECT id, responsible_id FROM cards WHERE responsible_id IS NOT NULL
         ON CONFLICT DO NOTHING`,
      );
      await projectPool.query(
        `UPDATE cards SET description = REPLACE(description, '@Imagem ', '#Imagem ')
         WHERE description LIKE '%@Imagem %'`,
      );
      await projectPool.query(
        `UPDATE card_comments SET body = REPLACE(body, '@Imagem ', '#Imagem ')
         WHERE body LIKE '%@Imagem %'`,
      );
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === '42701')) {
        projectPools.delete(project.db_name);
        await projectPool.end();
        throw error;
      }
    }
  }
  return { projectPool, dbName: project.db_name };
}

export async function dropProjectPool(dbName: string): Promise<void> {
  const projectPool = projectPools.get(dbName);
  if (projectPool) {
    projectPools.delete(dbName);
    await projectPool.end();
  }
}
