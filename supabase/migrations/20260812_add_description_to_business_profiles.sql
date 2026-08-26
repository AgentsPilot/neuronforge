-- Add description column to business_profiles
-- Purpose: Store business description extracted during onboarding for use in website generation and AI context
-- Last Updated: 2026-08-12

ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS description TEXT;

COMMENT ON COLUMN business_profiles.description IS 'Business description extracted during onboarding for website generation';
