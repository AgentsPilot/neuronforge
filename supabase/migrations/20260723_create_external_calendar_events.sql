-- Migration: Create external_calendar_events table
-- Description: Stores events from external calendars (Google/Outlook) to block availability

CREATE TABLE IF NOT EXISTS external_calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  external_event_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  title TEXT, -- Optional, for display purposes only (may be null for privacy)
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  is_all_day BOOLEAN DEFAULT FALSE,
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  CONSTRAINT valid_external_event_provider CHECK (provider IN ('google_calendar', 'outlook')),
  CONSTRAINT unique_external_event UNIQUE (user_id, external_event_id, provider)
);

-- Index for querying events by user and time range (most common query)
CREATE INDEX IF NOT EXISTS idx_external_calendar_events_user_time
ON external_calendar_events(user_id, start_time, end_time);

-- Index for cleanup of old events
CREATE INDEX IF NOT EXISTS idx_external_calendar_events_end_time
ON external_calendar_events(end_time);

-- Index for finding users that need sync refresh
CREATE INDEX IF NOT EXISTS idx_external_calendar_events_last_synced
ON external_calendar_events(user_id, last_synced_at);

-- Enable RLS
ALTER TABLE external_calendar_events ENABLE ROW LEVEL SECURITY;

-- RLS policy: Users can only see their own external events
CREATE POLICY "Users can view own external calendar events"
ON external_calendar_events FOR SELECT
USING (auth.uid() = user_id);

-- RLS policy: Users can insert their own external events
CREATE POLICY "Users can insert own external calendar events"
ON external_calendar_events FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- RLS policy: Users can update their own external events
CREATE POLICY "Users can update own external calendar events"
ON external_calendar_events FOR UPDATE
USING (auth.uid() = user_id);

-- RLS policy: Users can delete their own external events
CREATE POLICY "Users can delete own external calendar events"
ON external_calendar_events FOR DELETE
USING (auth.uid() = user_id);

-- Service role policy for cron job (needs to access all users)
CREATE POLICY "Service role can manage all external calendar events"
ON external_calendar_events FOR ALL
USING (auth.jwt()->>'role' = 'service_role');

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_external_calendar_events_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updated_at
DROP TRIGGER IF EXISTS trigger_external_calendar_events_updated_at ON external_calendar_events;
CREATE TRIGGER trigger_external_calendar_events_updated_at
BEFORE UPDATE ON external_calendar_events
FOR EACH ROW
EXECUTE FUNCTION update_external_calendar_events_updated_at();

-- Comment on table
COMMENT ON TABLE external_calendar_events IS 'Stores events from external calendars (Google/Outlook) to block scheduling availability';
COMMENT ON COLUMN external_calendar_events.external_event_id IS 'Event ID from the external calendar provider';
COMMENT ON COLUMN external_calendar_events.provider IS 'Calendar provider: google_calendar or outlook';
COMMENT ON COLUMN external_calendar_events.is_all_day IS 'Whether this is an all-day event (may be treated differently)';
COMMENT ON COLUMN external_calendar_events.last_synced_at IS 'When this event was last synced from the external calendar';
