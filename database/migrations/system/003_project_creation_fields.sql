-- 003_project_creation_fields.sql
-- Campos do modal de criacao em 2 etapas: contrato, cliente, datas, status, gerente e equipe.
-- Todos opcionais na base: a regra de obrigatoriedade e validada na aplicacao.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS contract_number text,
  ADD COLUMN IF NOT EXISTS client_name text,
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS manager_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS project_team (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, role, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_team_user ON project_team (user_id);
