-- 020_scope_gates.sql
-- Substitui a flag global por 4 flags por area: base, users, settings, integrations.

ALTER TABLE system_settings DROP COLUMN IF EXISTS scope_password_enabled;

ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS scope_gate_base boolean NOT NULL DEFAULT true;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS scope_gate_users boolean NOT NULL DEFAULT true;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS scope_gate_settings boolean NOT NULL DEFAULT true;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS scope_gate_integrations boolean NOT NULL DEFAULT true;
