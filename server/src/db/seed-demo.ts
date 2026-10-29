import pg from 'pg';
import { databaseUrlFor, pool, queryOne } from './pool.js';

const PROJECT_NAME = process.env.DEMO_PROJECT_NAME ?? 'PM Teste';

function dateIn(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function seedDemo(): Promise<void> {
  const project = await queryOne<{ id: string; db_name: string }>(
    'SELECT id, db_name FROM projects WHERE name = $1 AND is_active = true',
    [PROJECT_NAME],
  );
  if (!project) {
    throw new Error(
      `Projeto "${PROJECT_NAME}" nao encontrado. Crie o projeto antes de rodar o seed demo.`,
    );
  }

  const member = await queryOne<{ user_id: string }>(
    'SELECT user_id FROM project_members WHERE project_id = $1 LIMIT 1',
    [project.id],
  );
  const actorId = member?.user_id ?? null;

  const db = new pg.Pool({ connectionString: databaseUrlFor(project.db_name), max: 1 });
  try {
    const sector = await db.query<{ id: string }>(
      'SELECT id FROM sectors WHERE name = $1',
      ['Comercial'],
    );
    const sectorId =
      sector.rows[0]?.id ??
      (
        await db.query<{ id: string }>(
          `INSERT INTO sectors (name, position) VALUES ('Comercial', 1) RETURNING id`,
        )
      ).rows[0]?.id;
    console.log('Seed demo: setor "Comercial" ok.');

    const dept = await db.query<{ id: string }>(
      'SELECT id FROM departments WHERE name = $1',
      ['Vendas'],
    );
    const deptId =
      dept.rows[0]?.id ??
      (
        await db.query<{ id: string }>(
          `INSERT INTO departments (sector_id, name, position)
           VALUES ($1, 'Vendas', 1) RETURNING id`,
          [sectorId],
        )
      ).rows[0]?.id;
    console.log('Seed demo: departamento "Vendas" ok.');

    const demoTitle = 'Solicitacao de orcamento inicial';
    const demoDescription = 'Card de exemplo criado pelo seed demo.';
    const existingCard = await db.query<{ id: string; title: string }>(
      'SELECT id, title FROM cards ORDER BY created_at LIMIT 1',
    );
    const card = existingCard.rows[0];
    if (!card) {
      const firstColumn = await db.query<{ id: string }>(
        'SELECT id FROM kanban_columns ORDER BY position LIMIT 1',
      );
      const columnId = firstColumn.rows[0]?.id;
      if (!columnId) throw new Error('Nenhuma coluna de kanban encontrada no projeto');
      await db.query(
        `INSERT INTO cards (department_id, column_id, title, description, priority, due_date, responsible_id, position, created_by)
         VALUES ($1, $2, $3, $4, 'media', $5, $6, 0, $6)`,
        [deptId, columnId, demoTitle, demoDescription, dateIn(3), actorId],
      );
      console.log('Seed demo: card criado.');
    } else {
      const title = /^WS debug card/.test(card.title) ? demoTitle : card.title;
      await db.query(
        `UPDATE cards
         SET title = $1,
             description = CASE WHEN description = '' THEN $2 ELSE description END,
             department_id = $3,
             due_date = COALESCE(due_date, $4),
             responsible_id = COALESCE(responsible_id, $5)
         WHERE id = $6`,
        [title, demoDescription, deptId, dateIn(3), actorId, card.id],
      );
      console.log('Seed demo: card atualizado.');
    }

    const milestone = await db.query(
      'SELECT id FROM milestones WHERE name = $1',
      ['Apresentacao da proposta'],
    );
    if (milestone.rowCount === 0) {
      await db.query(
        `INSERT INTO milestones (name, due_date) VALUES ($1, $2)`,
        ['Apresentacao da proposta', dateIn(7)],
      );
      console.log('Seed demo: marco criado.');
    } else {
      console.log('Seed demo: marco ja existe.');
    }
  } finally {
    await db.end();
  }
}

seedDemo()
  .then(async () => pool.end())
  .catch(async (error) => {
    console.error('Falha no seed demo:', error);
    await pool.end();
    process.exit(1);
  });
