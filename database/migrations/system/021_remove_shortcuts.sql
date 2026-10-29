-- 021_remove_shortcuts.sql
-- Remove a acao Atalhos: o bloco Acesso rapido foi retirado do Inicio
-- e os endpoints /settings/shortcuts foram removidos.

UPDATE profiles
SET permissions = permissions - 'settings.atalhos'
WHERE permissions ? 'settings.atalhos';
