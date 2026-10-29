-- 019_scope_password_enabled.sql
-- Flag que permite ativar/desativar a exigência da senha de escopo sem remove-la.

ALTER TABLE system_settings
  ADD COLUMN IF NOT EXISTS scope_password_enabled boolean NOT NULL DEFAULT true;
