-- 010_users_avatar_color.sql
-- Cor escolhida pelo usuario para o avatar no header (inicial mantida).

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_color text;
