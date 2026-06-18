-- Migration: Add org_id to profiles table
-- Purpose: Link profiles to organizations for proper organization management
-- Date: 2026-06-16

-- Step 1: Add org_id column to profiles with FK to organizations
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);

-- Step 2: Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_profiles_org_id ON profiles(org_id);

-- Step 3: Backfill ALL existing profiles to a single organization
-- For now, all users belong to the same org (the first/primary organization)
-- This assigns everyone to the organization owned by the primary user
UPDATE profiles p
SET org_id = (
  SELECT id FROM organizations
  ORDER BY created_at ASC
  LIMIT 1
)
WHERE p.org_id IS NULL;

-- Also add all users as members of that organization (with 'viewer' role by default)
INSERT INTO organization_members (org_id, user_id, role)
SELECT
  (SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1),
  p.id,
  CASE
    WHEN p.id = (SELECT owner_user_id FROM organizations ORDER BY created_at ASC LIMIT 1)
    THEN 'owner'
    ELSE 'viewer'
  END
FROM profiles p
WHERE NOT EXISTS (
  SELECT 1 FROM organization_members om
  WHERE om.user_id = p.id
    AND om.org_id = (SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1)
);

-- Step 4: Create trigger function to auto-set profile.org_id when organization is created
CREATE OR REPLACE FUNCTION set_profile_org_id()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE profiles SET org_id = NEW.id WHERE id = NEW.owner_user_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 5: Create trigger (drop first if exists to avoid duplicates)
DROP TRIGGER IF EXISTS auto_set_profile_org_id ON organizations;

CREATE TRIGGER auto_set_profile_org_id
AFTER INSERT ON organizations
FOR EACH ROW EXECUTE FUNCTION set_profile_org_id();

-- Add comment for documentation
COMMENT ON COLUMN profiles.org_id IS 'Foreign key to organizations table. Links user profile to their organization.';
