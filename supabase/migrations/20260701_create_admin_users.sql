-- Migration: Create admin_users table
-- Purpose: Single, non-user-writable source of truth for "who is a platform admin/operator".
-- Date: 2026-07-01
--
-- Why a dedicated table (not profiles.role):
--   profiles.role is user-writable (the profile settings UI offers "Administrator"
--   and /api/user/profile PUT writes role straight from the request body), and it
--   is overloaded with onboarding personas (business_owner, manager, sales, ...).
--   It therefore cannot be a security boundary. admin_users is written only via the
--   service role (see RLS below) and is the authoritative admin signal used by the
--   AdminAccessService / admin authz gate.
--
-- Email as the stable seed key:
--   Admins are bootstrapped from the ADMIN_EMAILS env allow-list. An admin's email
--   is known before (or independently of) their auth.users id, so `email` is NOT
--   NULL / UNIQUE and is the natural key. `user_id` is nullable until the admin has
--   an account, then bound (self-heals on first isAdmin check that carries the email).

CREATE TABLE IF NOT EXISTS admin_users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Bound to the auth user once known. Nullable so an admin can be seeded by email
  -- before they have signed up. UNIQUE so one auth user maps to at most one row.
  user_id     UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Stable seed key. Store lowercased. One row per admin email.
  email       TEXT NOT NULL UNIQUE,

  -- Who granted admin (NULL for env-seeded/bootstrap rows). Not cascade-deleted:
  -- if the granting admin is removed we keep the audit pointer.
  granted_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  notes       TEXT,

  -- Soft on/off switch so an admin can be revoked without losing the audit row.
  is_active   BOOLEAN NOT NULL DEFAULT true,

  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Fast path for the authz gate: isAdmin(userId) filters on user_id + is_active.
CREATE INDEX IF NOT EXISTS idx_admin_users_user_active
  ON admin_users(user_id)
  WHERE is_active = true;

-- Bootstrap / bind path: lookup by lowercased email.
CREATE INDEX IF NOT EXISTS idx_admin_users_email_active
  ON admin_users(email)
  WHERE is_active = true;

-- Row Level Security: admin_users is service-role only. There is intentionally
-- NO permissive policy for anon/authenticated — the repository accesses it via the
-- service-role client (supabaseServer), so RLS here is a hard backstop that blocks
-- any client-side/RLS-scoped access to the admin allow-list.
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON admin_users;
CREATE POLICY "Service role full access" ON admin_users
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Keep updated_at fresh on writes.
CREATE OR REPLACE FUNCTION set_admin_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_admin_users_updated_at ON admin_users;
CREATE TRIGGER trg_admin_users_updated_at
BEFORE UPDATE ON admin_users
FOR EACH ROW EXECUTE FUNCTION set_admin_users_updated_at();

COMMENT ON TABLE admin_users IS
  'Authoritative allow-list of platform admins/operators. Service-role write only; seeded from the ADMIN_EMAILS env var. Do NOT use profiles.role for admin authz — it is user-writable.';
COMMENT ON COLUMN admin_users.user_id IS 'auth.users id; nullable until the admin has an account, then bound on first admin check that carries the email.';
COMMENT ON COLUMN admin_users.email IS 'Lowercased admin email; the stable bootstrap/seed key.';
COMMENT ON COLUMN admin_users.is_active IS 'Soft revoke switch — false disables admin access without deleting the audit row.';
