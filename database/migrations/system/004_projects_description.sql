-- 004_projects_description.sql
-- Descricao do projeto: campo do modal de edicao de projetos.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
