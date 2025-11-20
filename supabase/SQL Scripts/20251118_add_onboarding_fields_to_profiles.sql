-- Add all onboarding fields to profiles table
-- This migration adds both individual columns and a JSON column for complete onboarding data

-- Add individual columns for key onboarding fields
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS company TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS job_title TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_goal TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_mode TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS domain TEXT;

-- Add check constraint for onboarding_mode (drop first if exists to avoid errors)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_onboarding_mode_check'
  ) THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_onboarding_mode_check
      CHECK (onboarding_mode IN ('on_demand', 'scheduled', 'monitor', 'guided') OR onboarding_mode IS NULL);
  END IF;
END $$;

-- Add check constraint for domain (drop first if exists to avoid errors)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_domain_check'
  ) THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_domain_check
      CHECK (domain IN ('sales', 'marketing', 'operations', 'engineering', 'executive', 'other') OR domain IS NULL);
  END IF;
END $$;

-- Add JSON column to store complete onboarding data as backup
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_data JSONB;

-- Add onboarding completed boolean flag
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding BOOLEAN DEFAULT false;

-- Add comments to document the columns
COMMENT ON COLUMN profiles.company IS 'User''s company name (collected during onboarding)';
COMMENT ON COLUMN profiles.job_title IS 'User''s job title (collected during onboarding)';
COMMENT ON COLUMN profiles.onboarding_goal IS 'User''s primary goal for using the platform (collected during onboarding)';
COMMENT ON COLUMN profiles.onboarding_mode IS 'User''s preferred agent trigger mode: on_demand, scheduled, monitor, or guided (collected during onboarding)';
COMMENT ON COLUMN profiles.domain IS 'User''s work domain/area (collected during onboarding)';
COMMENT ON COLUMN profiles.onboarding_data IS 'Complete onboarding data stored as JSONB for backup and future reference';
COMMENT ON COLUMN profiles.onboarding IS 'Flag indicating whether the user has completed onboarding';

-- Create index on onboarding status for faster queries
CREATE INDEX IF NOT EXISTS idx_profiles_onboarding ON profiles(onboarding);
