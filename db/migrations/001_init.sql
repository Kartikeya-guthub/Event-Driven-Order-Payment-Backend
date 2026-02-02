-- =========================
-- ORDERS (domain state)
-- =========================
CREATE TABLE orders (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  state TEXT NOT NULL,
  version BIGINT NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================
-- OUTBOX (guaranteed delivery)
-- =========================
CREATE TABLE outbox (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL UNIQUE,

  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  event_type TEXT NOT NULL,

  payload JSONB NOT NULL,

  published BOOLEAN NOT NULL DEFAULT false,
  published_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================
-- PROCESSED EVENTS (idempotency)
-- =========================
CREATE TABLE processed_events (
  event_id UUID PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  worker_id TEXT
);

-- =========================
-- INDEXES (performance + correctness)
-- =========================
CREATE INDEX idx_outbox_unpublished
  ON outbox (published, created_at);

CREATE INDEX idx_orders_state
  ON orders (state);
