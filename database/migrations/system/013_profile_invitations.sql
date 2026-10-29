-- 013_profile_invitations.sql
-- Exclusao de niveis de acesso: convites historicos viram NULL em vez de bloquear.
-- (mesmo padrao da 007_user_deletion.sql)

ALTER TABLE invitations ALTER COLUMN profile_id DROP NOT NULL;

ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_profile_id_fkey;
ALTER TABLE invitations ADD CONSTRAINT invitations_profile_id_fkey
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL;
