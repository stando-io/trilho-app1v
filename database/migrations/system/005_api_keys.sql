-- 005_api_keys.sql
-- Completa a tabela api_keys criada no 001 para o uso de chaves em F5.1.

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS api_keys_key_hash_key ON api_keys (key_hash);

CREATE INDEX IF NOT EXISTS idx_api_keys_created_by ON api_keys (created_by);
