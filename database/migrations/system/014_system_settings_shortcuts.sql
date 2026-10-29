-- 014_system_settings_shortcuts.sql
-- Atalhos globais do Inicio: lista de telas e acoes exibidas no Acesso rapido.
-- NULL = sem configuracao (o Inicio usa o fallback de telas do perfil).

ALTER TABLE system_settings
  ADD COLUMN IF NOT EXISTS shortcuts jsonb;

-- Perfis que ja possuem a acao de temas ganham a nova acao Atalhos.
UPDATE profiles
SET permissions = permissions || '["settings.atalhos"]'::jsonb
WHERE permissions ? 'settings.temas'
  AND NOT (permissions ? 'settings.atalhos');
