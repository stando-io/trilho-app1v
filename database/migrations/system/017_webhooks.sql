CREATE TABLE webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  url text NOT NULL,
  event text NOT NULL CHECK (event IN ('card.created', 'card.updated', 'card.moved', 'card.deleted')),
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_webhooks_event_active ON webhooks (event) WHERE active = true;
