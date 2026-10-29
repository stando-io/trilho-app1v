-- 026_scope_gate_areas.sql
-- Areas de exigencia de senha de escopo: Inicio (agenda), Dashboard e Quadro.

ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS scope_gate_home boolean NOT NULL DEFAULT true;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS scope_gate_dashboard boolean NOT NULL DEFAULT true;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS scope_gate_board boolean NOT NULL DEFAULT true;
