-- Update profiles table role constraint to support new onboarding role values
-- This migration updates the role check constraint to accept the new role context values
-- (business_owner, manager, consultant, operations, sales, marketing, finance, other)
-- instead of the old access-level values (admin, user, viewer)

-- Drop the old constraint
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

-- Add new constraint with updated role values
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('business_owner', 'manager', 'consultant', 'operations', 'sales', 'marketing', 'finance', 'other', 'admin', 'user', 'viewer'));

-- Note: We're keeping the old values (admin, user, viewer) for backward compatibility
-- with existing users. New users will use the new role context values.
