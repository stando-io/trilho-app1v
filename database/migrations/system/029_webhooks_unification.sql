-- 029_webhooks_unification.sql
-- Unifica conexoes em webhooks: cada conexao Discord vira um webhook com
-- system='discord' inscrito nos 4 eventos de card que ja recebia.
-- Troca a coluna unica event pela selecao multi-evento events text[].

ALTER TABLE webhooks
  ADD COLUMN system text NOT NULL DEFAULT 'generico'
    CHECK (system IN ('discord', 'slack', 'n8n', 'crm', 'generico'));

ALTER TABLE webhooks ADD COLUMN events text[] NOT NULL DEFAULT '{}';

UPDATE webhooks SET events = ARRAY[event];

INSERT INTO webhooks (name, url, system, events, active, created_by, created_at)
SELECT name,
       webhook_url,
       'discord',
       ARRAY['card.created', 'card.updated', 'card.moved', 'card.deleted'],
       active,
       created_by,
       created_at
FROM connections;

ALTER TABLE webhooks DROP COLUMN event;

DROP TABLE connections;

CREATE INDEX idx_webhooks_events_active
  ON webhooks USING gin (events)
  WHERE active = true;
