-- Add dismissed_setup_steps column to business_profiles
-- Purpose: Allow users to dismiss individual setup steps they don't need
-- Last Updated: 2026-08-02

-- Add column for dismissed setup steps (array of step IDs)
ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS dismissed_setup_steps TEXT[] DEFAULT '{}';

-- Comment for documentation
COMMENT ON COLUMN business_profiles.dismissed_setup_steps IS 'Array of setup step IDs that the user has dismissed (services, availability, payments, calendar, website)';

-- RPC function to safely dismiss a setup step
CREATE OR REPLACE FUNCTION dismiss_setup_step(p_user_id UUID, p_step_id TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE business_profiles
  SET dismissed_setup_steps = array_append(
    COALESCE(dismissed_setup_steps, '{}'),
    p_step_id
  )
  WHERE user_id = p_user_id
    AND NOT (COALESCE(dismissed_setup_steps, '{}') @> ARRAY[p_step_id]);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
