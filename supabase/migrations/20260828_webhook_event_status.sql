-- Two-phase processing for webhook events.
--
-- WHY
--
-- `processed_webhook_events` records an event id BEFORE the handler runs, so two
-- concurrent deliveries of the same event cannot both process it. That part is
-- right. What was missing is any notion of the handler having FAILED: the row
-- was never removed on error, so every subsequent Stripe retry of that event was
-- skipped as a duplicate.
--
-- The effect was a one-way valve on money. A handler that threw — and the
-- Business OS invoice handler threw on every delivery, because it inserted a
-- column that does not exist — permanently consumed its own event. Stripe
-- retried, the retry was discarded as "already processed", and the payment was
-- never recorded.
--
-- A status turns the row from "seen" into "seen, and here is what happened",
-- which is what makes a retry meaningful.
--
-- The default is 'completed' rather than 'processing': the 128 rows already in
-- this table were all processed to whatever conclusion they reached, and
-- marking them 'processing' would invite a replay of months-old events.

ALTER TABLE processed_webhook_events
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'processed_webhook_events_status_check'
  ) THEN
    ALTER TABLE processed_webhook_events
      ADD CONSTRAINT processed_webhook_events_status_check
      CHECK (status IN ('processing', 'completed', 'failed'));
  END IF;
END $$;

-- Records why a handler failed, so a stuck event can be diagnosed without
-- reading application logs that may have rotated away.
ALTER TABLE processed_webhook_events
  ADD COLUMN IF NOT EXISTS failure_message TEXT;

ALTER TABLE processed_webhook_events
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- The retry queue: anything not completed is work that still needs to happen.
CREATE INDEX IF NOT EXISTS idx_processed_webhook_events_unfinished
  ON processed_webhook_events(processed_at DESC)
  WHERE status <> 'completed';

COMMENT ON COLUMN processed_webhook_events.status IS
  'processing = handler in flight; completed = do not reprocess; failed = a Stripe retry may reprocess it';
