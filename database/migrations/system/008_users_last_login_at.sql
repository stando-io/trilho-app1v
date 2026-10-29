-- 008_users_last_login_at.sql
-- Ultimo acesso do usuario, exibido na tabela de usuarios de Configuracoes.

ALTER TABLE users ADD COLUMN last_login_at timestamptz;
