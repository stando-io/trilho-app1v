-- 025_notification_prefs.sql
-- Preferencias globais de notificacao do sino (habilitar/desabilitar por tipo).
ALTER TABLE system_settings
  ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL DEFAULT '{
    "card_created": true,
    "card_moved": true,
    "card_assigned": true,
    "card_mention": true,
    "card_comment": true,
    "card_deadline": true,
    "card_learning_index": true,
    "permissions_updated": true,
    "project_member_added": true,
    "scope_password_changed": true
  }'::jsonb;
