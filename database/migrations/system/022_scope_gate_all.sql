-- 022_scope_gate_all.sql
-- Toggle global: exigir a senha de escopo para qualquer edicao no sistema.
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS scope_gate_all boolean NOT NULL DEFAULT false;

-- Backfill: perfis que ja possuem settings.escopo ganham settings.parametros.
UPDATE profiles
   SET permissions = permissions || '["settings.parametros"]'::jsonb
 WHERE permissions ? 'settings.escopo'
   AND NOT (permissions ? 'settings.parametros');
