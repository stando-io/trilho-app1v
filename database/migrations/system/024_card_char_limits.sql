-- 024_card_char_limits.sql
-- Limites configuraveis de caracteres para titulo e descricao dos cards.
ALTER TABLE system_settings
  ADD COLUMN IF NOT EXISTS title_max_chars integer NOT NULL DEFAULT 200
  CHECK (title_max_chars BETWEEN 10 AND 1000);

ALTER TABLE system_settings
  ADD COLUMN IF NOT EXISTS description_max_chars integer NOT NULL DEFAULT 4000
  CHECK (description_max_chars BETWEEN 100 AND 50000);
