-- 009_system_settings.sql
-- Senha de escopo global (una para todos os projetos) com dica opcional.

CREATE TABLE IF NOT EXISTS system_settings (
  id integer PRIMARY KEY CHECK (id = 1),
  scope_password_hash text,
  scope_password_hint text
);

INSERT INTO system_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
