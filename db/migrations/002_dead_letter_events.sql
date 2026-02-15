-- Migration: Add dead_letter_events table for failed events

CREATE TABLE IF NOT EXISTS dead_letter_events (
  event_id UUID PRIMARY KEY,
  event_type TEXT,
  aggregate_id UUID,
  payload JSONB,
  failed_at TIMESTAMPTZ DEFAULT now(),
  reason TEXT
);

-- Add index for querying by failed_at
CREATE INDEX IF NOT EXISTS idx_dead_letter_failed_at ON dead_letter_events(failed_at DESC);
