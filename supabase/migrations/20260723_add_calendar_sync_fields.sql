-- Migration: Add calendar sync fields to scheduling_bookings and business_profiles
-- Description: Enables two-way calendar sync between AgentPilot and Google Calendar/Outlook

-- Add calendar sync fields to scheduling_bookings
ALTER TABLE scheduling_bookings
ADD COLUMN IF NOT EXISTS external_calendar_event_id TEXT,
ADD COLUMN IF NOT EXISTS calendar_sync_provider TEXT,
ADD COLUMN IF NOT EXISTS calendar_synced_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS calendar_sync_error TEXT;

-- Add constraint for valid providers
ALTER TABLE scheduling_bookings
ADD CONSTRAINT valid_booking_calendar_sync_provider
CHECK (calendar_sync_provider IS NULL OR calendar_sync_provider IN ('google_calendar', 'outlook'));

-- Index for finding bookings that need sync retry
CREATE INDEX IF NOT EXISTS idx_scheduling_bookings_sync_error
ON scheduling_bookings(calendar_sync_error)
WHERE calendar_sync_error IS NOT NULL;

-- Index for finding bookings by external calendar event ID
CREATE INDEX IF NOT EXISTS idx_scheduling_bookings_external_event
ON scheduling_bookings(external_calendar_event_id)
WHERE external_calendar_event_id IS NOT NULL;

-- Add calendar sync preference fields to business_profiles
ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS calendar_sync_enabled BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS calendar_sync_provider TEXT,
ADD COLUMN IF NOT EXISTS calendar_last_synced_at TIMESTAMPTZ;

-- Add constraint for valid providers in business_profiles
ALTER TABLE business_profiles
ADD CONSTRAINT valid_profile_calendar_sync_provider
CHECK (calendar_sync_provider IS NULL OR calendar_sync_provider IN ('google_calendar', 'outlook'));

-- Comment on columns for documentation
COMMENT ON COLUMN scheduling_bookings.external_calendar_event_id IS 'Event ID from external calendar (Google/Outlook)';
COMMENT ON COLUMN scheduling_bookings.calendar_sync_provider IS 'Provider used for sync: google_calendar or outlook';
COMMENT ON COLUMN scheduling_bookings.calendar_synced_at IS 'Timestamp of last successful sync to external calendar';
COMMENT ON COLUMN scheduling_bookings.calendar_sync_error IS 'Error message if last sync failed';

COMMENT ON COLUMN business_profiles.calendar_sync_enabled IS 'Whether calendar sync is enabled for this user';
COMMENT ON COLUMN business_profiles.calendar_sync_provider IS 'Preferred calendar provider: google_calendar or outlook';
COMMENT ON COLUMN business_profiles.calendar_last_synced_at IS 'Timestamp of last successful external events sync';
