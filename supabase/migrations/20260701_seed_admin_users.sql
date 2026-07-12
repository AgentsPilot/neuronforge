-- Data migration: Bootstrap the initial platform admin(s) into admin_users.
-- Date: 2026-07-01
-- Depends on: 20260701_create_admin_users.sql
--
-- HOW THIS WORKS
--   Admins are keyed by EMAIL (not user id). This migration inserts one row per
--   admin email and binds `user_id` via an auth.users subquery IF that email already
--   has an account. If it doesn't yet, the row is still inserted (user_id = NULL) and
--   AdminAccessService binds the user_id automatically on the admin's first login.
--   => You never need to hand-copy user IDs.
--
-- IMPORTANT: DO NOT seed admins from profiles.role — that column is user-writable and
--   would import self-promoted users. List real admin emails explicitly below.
--
-- TO ADD/CHANGE ADMINS: edit the VALUES list in the CTE below, then re-run. It is
--   idempotent on `email` and re-activates a soft-revoked row.

WITH desired_admins(email) AS (
  VALUES
    (lower('meiribarak@gmail.com')),
    (lower('offir.omer@gmail.com'))
)
INSERT INTO admin_users (user_id, email, notes)
SELECT
  (SELECT u.id FROM auth.users u WHERE lower(u.email) = d.email LIMIT 1) AS user_id,
  d.email,
  'Bootstrap admin (20260701_seed_admin_users.sql)'
FROM desired_admins d
ON CONFLICT (email) DO UPDATE SET
  is_active = true,
  -- Keep an already-bound user_id; only fill it in if we now found a match.
  user_id   = COALESCE(EXCLUDED.user_id, admin_users.user_id),
  updated_at = now();
