-- 006_roles.sql
-- Cargos (papéis profissionais) com herança de nível de acesso (perfil).

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  profile_id uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES roles(id);

CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);

-- A convite historico nao impede excluir o cargo; o nivel ja foi materializado no aceite.
ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES roles(id) ON DELETE SET NULL;
