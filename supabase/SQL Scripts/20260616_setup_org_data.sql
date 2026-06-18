-- Safe script to ensure organization data exists for current user
-- Run this in Supabase SQL Editor
-- Date: 2026-06-16

-- Step 1: Create organization for existing users who don't have one
-- This uses the existing get_or_create_user_organization function
DO $$
DECLARE
  r RECORD;
  v_org_id UUID;
BEGIN
  -- For each user in profiles that doesn't have an org
  FOR r IN
    SELECT DISTINCT p.id as user_id
    FROM profiles p
    LEFT JOIN organizations o ON o.owner_user_id = p.id
    WHERE o.id IS NULL
  LOOP
    -- Create organization for this user
    v_org_id := get_or_create_user_organization(r.user_id);
    RAISE NOTICE 'Created organization % for user %', v_org_id, r.user_id;
  END LOOP;
END;
$$;

-- Step 2: Add org_id column to profiles if not exists
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);

-- Step 3: Create index if not exists
CREATE INDEX IF NOT EXISTS idx_profiles_org_id ON profiles(org_id);

-- Step 4: Backfill profiles.org_id from their owned organization
UPDATE profiles p
SET org_id = o.id
FROM organizations o
WHERE o.owner_user_id = p.id
  AND p.org_id IS NULL;

-- Step 5: Add hourly_rate_usd to agents if not exists
ALTER TABLE agents ADD COLUMN IF NOT EXISTS hourly_rate_usd NUMERIC;

-- Step 6: Create index for hourly_rate if not exists
CREATE INDEX IF NOT EXISTS idx_agents_hourly_rate ON agents(hourly_rate_usd) WHERE hourly_rate_usd IS NOT NULL;

-- Step 7: Verify data
SELECT
  'Organizations' as table_name,
  COUNT(*) as count
FROM organizations
UNION ALL
SELECT
  'Profiles with org_id' as table_name,
  COUNT(*) as count
FROM profiles WHERE org_id IS NOT NULL
UNION ALL
SELECT
  'Agents with org_id' as table_name,
  COUNT(*) as count
FROM agents WHERE org_id IS NOT NULL;
