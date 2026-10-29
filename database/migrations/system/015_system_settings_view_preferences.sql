-- 015_system_settings_view_preferences.sql
-- Preferencias globais de visualizacao do quadro de tarefas.
-- NULL = sem configuracao (as telas usam os padroes do sistema).

ALTER TABLE system_settings
  ADD COLUMN IF NOT EXISTS view_preferences jsonb;
