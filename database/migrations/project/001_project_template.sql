-- 002_project_template.sql
-- Template aplicado em cada banco dedicado de projeto (RNF05).

CREATE TABLE sectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sector_id uuid NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kanban_columns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  position integer NOT NULL,
  is_done boolean NOT NULL DEFAULT false,
  locked boolean NOT NULL DEFAULT false,
  color text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_code text,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  column_id uuid NOT NULL REFERENCES kanban_columns(id),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  priority text NOT NULL DEFAULT 'media',
  responsible_id uuid,
  origin text NOT NULL DEFAULT '',
  due_date date,
  position integer NOT NULL DEFAULT 0,
  learning_index_active boolean NOT NULL DEFAULT false,
  learning_index_score integer CHECK (learning_index_score >= 0 AND learning_index_score <= 10),
  learning_index_note text NOT NULL DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE card_subtasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  subtask_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (card_id, subtask_id),
  CHECK (card_id <> subtask_id)
);

CREATE TABLE card_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id uuid,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE card_responsibles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (card_id, user_id)
);

CREATE TABLE card_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  filename text NOT NULL,
  url text NOT NULL,
  size_bytes integer,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  due_date date NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE project_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  security_password_hash text,
  board_background text NOT NULL DEFAULT ''
);

INSERT INTO project_settings (id) VALUES (1);

INSERT INTO kanban_columns (name, position, is_done, locked) VALUES
  ('Nova Solicitacao', 1, false, true),
  ('Em Analise', 2, false, true),
  ('Em Andamento', 3, false, true),
  ('Em Observacao', 4, false, true),
  ('Concluido', 5, true, true);

CREATE INDEX idx_departments_sector ON departments(sector_id);
CREATE INDEX idx_cards_column ON cards(column_id);
CREATE INDEX idx_cards_department ON cards(department_id);
CREATE INDEX idx_cards_responsible ON cards(responsible_id);
CREATE INDEX idx_cards_due_date ON cards(due_date);
CREATE UNIQUE INDEX idx_cards_task_code ON cards(task_code);
CREATE SEQUENCE IF NOT EXISTS seq_card_task_code;
CREATE INDEX idx_card_responsibles_card ON card_responsibles(card_id);
CREATE INDEX idx_card_responsibles_user ON card_responsibles(user_id);
CREATE INDEX idx_card_attachments_card ON card_attachments(card_id);

-- Progresso: cada demanda pesa igual; departamento sem demanda fica neutro (NULL).
CREATE VIEW department_progress AS
SELECT
  d.id AS department_id,
  d.sector_id,
  COUNT(c.id) AS total_cards,
  COUNT(c.id) FILTER (WHERE c.completed_at IS NOT NULL) AS completed_cards,
  CASE
    WHEN COUNT(c.id) = 0 THEN NULL
    ELSE ROUND(100.0 * COUNT(c.id) FILTER (WHERE c.completed_at IS NOT NULL) / COUNT(c.id))
  END AS percent
FROM departments d
LEFT JOIN cards c ON c.department_id = d.id
GROUP BY d.id, d.sector_id;

CREATE VIEW sector_progress AS
SELECT
  s.id AS sector_id,
  COUNT(c.id) AS total_cards,
  COUNT(c.id) FILTER (WHERE c.completed_at IS NOT NULL) AS completed_cards,
  CASE
    WHEN COUNT(c.id) = 0 THEN NULL
    ELSE ROUND(100.0 * COUNT(c.id) FILTER (WHERE c.completed_at IS NOT NULL) / COUNT(c.id))
  END AS percent
FROM sectors s
LEFT JOIN departments d ON d.sector_id = s.id
LEFT JOIN cards c ON c.department_id = d.id
GROUP BY s.id;
