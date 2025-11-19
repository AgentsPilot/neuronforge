-- Add company and job_title columns to profiles table
-- These fields are collected during onboarding to better understand the user's context

-- Add company column (optional)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS company TEXT;

-- Add job_title column (optional)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS job_title TEXT;

-- Add comment to document the columns
COMMENT ON COLUMN profiles.company IS 'User''s company name (optional, collected during onboarding)';
COMMENT ON COLUMN profiles.job_title IS 'User''s job title (optional, collected during onboarding)';
