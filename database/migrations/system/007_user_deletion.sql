-- 007_user_deletion.sql
-- Exclusao de usuarios: referencias historicas viram NULL em vez de bloquear.

ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_user_id_fkey;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_invited_by_fkey;
ALTER TABLE invitations ALTER COLUMN invited_by DROP NOT NULL;
ALTER TABLE invitations ADD CONSTRAINT invitations_invited_by_fkey
  FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_created_by_fkey;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
