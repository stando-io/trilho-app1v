-- 002_audit_project_index.sql
-- Indice de expressao para a tela de auditoria filtrar registros por projeto.

CREATE INDEX IF NOT EXISTS idx_audit_logs_project ON audit_logs ((meta->>'project_id'));
