-- 011_users_avatar_text_color.sql
-- Cor da inicial do avatar do usuário (Minha Conta).
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_text_color text;
