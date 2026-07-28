-- Add scheduling_availability column to business_profiles
-- This stores the business owner's weekly working hours for client bookings

ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS scheduling_availability JSONB DEFAULT '{}'::jsonb;

-- Add comment for documentation
COMMENT ON COLUMN business_profiles.scheduling_availability IS 'Weekly availability for scheduling (e.g., {"monday": [{"start": "09:00", "end": "17:00"}], ...})';

-- Create index for faster queries if needed
CREATE INDEX IF NOT EXISTS idx_business_profiles_scheduling_availability
ON business_profiles USING gin (scheduling_availability);
