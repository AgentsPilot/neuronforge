-- Migration: Add business settings to organizations table
-- Date: 2026-06-15
-- Purpose: Enable configurable hourly rate for accurate ROI calculations

-- Document the expected schema for organizations.settings JSONB column
-- Settings already exists as JSONB, we just document the expected structure
COMMENT ON COLUMN organizations.settings IS 'Business settings JSON: {hourly_rate_usd: number, currency: string, work_hours_per_day: number}';

-- Add default business settings for existing orgs that don't have them
UPDATE organizations
SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object(
  'hourly_rate_usd', COALESCE(
    (settings->>'hourly_rate_usd')::numeric,
    (SELECT hourly_rate_usd FROM profiles WHERE profiles.id = organizations.owner_user_id),
    50
  ),
  'currency', COALESCE(settings->>'currency', 'USD'),
  'work_hours_per_day', COALESCE((settings->>'work_hours_per_day')::numeric, 8)
)
WHERE settings IS NULL
   OR settings = '{}'::jsonb
   OR NOT (settings ? 'hourly_rate_usd');

-- Create index for faster settings lookups
CREATE INDEX IF NOT EXISTS idx_organizations_owner_user_id ON organizations(owner_user_id);
