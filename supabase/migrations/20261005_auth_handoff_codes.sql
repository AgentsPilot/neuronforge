-- A single-use code that carries a sign-in across the origin boundary.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS REPLACES, AND WHY IT HAD TO GO
--
-- Sign-in happens on the marketing site; the app lives on another origin.
-- Browser storage is per-origin, so the session created there does not exist
-- here, and the two apps bridged that by putting the Supabase tokens in the URL:
--
--   {app}/onboarding-chat#access_token=…&refresh_token=…
--
-- Three things are wrong with that, and the third is the one that bit.
--
--   1. The REFRESH token is a long-lived credential. A fragment is not sent to
--      the server, but it is written into browser history, and from there into
--      anything that syncs or reads history.
--   2. `SessionHandler` — which consumes the fragment — was mounted in
--      `PlatformShell`, so it ran on EVERY page and would adopt an
--      `access_token` found in any URL, not just the one landing route.
--   3. Together: returning to that history entry re-establishes the session.
--      Someone who had just signed out could be signed back in by a Back
--      button, which is exactly what was reported.
--
-- A code is not a credential. It names a pending sign-in for sixty seconds, it
-- works once, and it is worthless afterwards — so the same URL replayed from
-- history does nothing at all.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS auth_handoff_codes (
  code        TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);

-- For the expiry sweep, and small enough that it costs nothing.
CREATE INDEX IF NOT EXISTS idx_auth_handoff_codes_expires_at
  ON auth_handoff_codes (expires_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- NO POLICIES, DELIBERATELY.
--
-- RLS is enabled and nothing is granted, so no browser session can read or
-- write this table by any path. Only the service role touches it, from the two
-- routes that mint and redeem a code. A row here names a pending sign-in; a
-- reader who could list them could hijack one.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE auth_handoff_codes ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- SINGLE USE, ENFORCED BY THE DATABASE RATHER THAN BY THE CALLER.
--
-- One statement: the UPDATE matches only an unused, unexpired row, and the row
-- lock it takes means a second concurrent redemption of the same code finds
-- `used_at` already set and returns nothing. A read-then-write in application
-- code could not promise that — two requests arriving together would both see
-- an unused row and both succeed.
--
-- Returns zero rows for a code that is unknown, already used, or expired. The
-- caller cannot tell those apart, and should not: each one means "no session
-- for you", and distinguishing them tells a prober which codes exist.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION claim_auth_handoff_code(p_code TEXT)
RETURNS TABLE (claimed_user_id UUID)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE auth_handoff_codes
     SET used_at = now()
   WHERE code = p_code
     AND used_at IS NULL
     AND expires_at > now()
  RETURNING user_id;
$$;

REVOKE ALL ON FUNCTION claim_auth_handoff_code(TEXT) FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE auth_handoff_codes IS
  'Single-use, 60-second codes that carry a completed sign-in from the marketing origin to '
  'the app origin. Replaces passing Supabase access and refresh tokens in a URL fragment, '
  'which persisted in browser history and could be replayed to re-authenticate after logout.';

COMMENT ON FUNCTION claim_auth_handoff_code(TEXT) IS
  'Atomically consumes a handoff code and returns its user. Returns no rows if the code is '
  'unknown, already used, or expired — the caller must not be able to tell which.';
