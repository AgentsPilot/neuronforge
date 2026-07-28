-- Add setup_checklist_dismissed column to business_profiles
-- This tracks whether the user has dismissed the setup checklist on the dashboard

ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS setup_checklist_dismissed BOOLEAN DEFAULT false;

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_business_profiles_setup_dismissed
ON business_profiles(user_id, setup_checklist_dismissed);

COMMENT ON COLUMN business_profiles.setup_checklist_dismissed IS 'Whether the user has dismissed the setup checklist card on the dashboard';
