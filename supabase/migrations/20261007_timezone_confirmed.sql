-- Record WHETHER the timezone was answered, separately from what it says.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE PROBLEM THE PREVIOUS MIGRATION ONLY HALF-SOLVED
--
-- 20261006 dropped the `DEFAULT 'UTC'` so new rows are NULL, which makes "not
-- asked" expressible going forward. It could do nothing for the rows already
-- written: 9 of 12 accounts sit on a literal 'UTC' that arrived from the old
-- default, and 3 carry a real zone.
--
-- So the readiness gate that was just built protects NOBODY. A stored 'UTC'
-- counts as a deliberate answer — correctly, because for some business it is
-- one — and there is no way to tell those apart from the value alone.
--
-- Guessing is not available either. 'UTC' from a default and 'UTC' from a
-- person are the same five characters, and no audit trail distinguishes them.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- SO STOP INFERRING IT, AND STORE IT
--
-- `timezone_confirmed_at` is set whenever a human answers the question — in
-- Settings, in onboarding, or through the profile API. NULL means nobody has,
-- whatever the timezone column happens to say.
--
-- This is the same lesson as the default itself: a field doing two jobs cannot
-- be read reliably for either. "What is the zone" and "has anyone said" are two
-- questions, so they get two columns.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE BACKFILL, AND WHY IT ONLY TOUCHES THREE ROWS
--
-- A zone that is neither NULL nor 'UTC' could not have come from the default.
-- Somebody chose `Asia/Jerusalem`; nothing sets that on their behalf. Those are
-- marked confirmed, using `updated_at` as the honest best estimate of when.
--
-- Rows on 'UTC' are left NULL — including any business that genuinely works to
-- UTC. They are asked once, on the dashboard, and one click settles it for
-- good. Marking them confirmed would silently answer for them, which is the
-- mistake being corrected here.
--
-- Nobody's clients are affected: gaps gate OWNER actions — publishing a page,
-- minting a link, booking from the dashboard — and the public booking path does
-- not consult them.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS timezone_confirmed_at TIMESTAMPTZ;

UPDATE user_preferences
   SET timezone_confirmed_at = COALESCE(updated_at, now())
 WHERE timezone_confirmed_at IS NULL
   AND timezone IS NOT NULL
   AND btrim(timezone) <> ''
   AND timezone <> 'UTC';

COMMENT ON COLUMN user_preferences.timezone_confirmed_at IS
  'When a human last answered the timezone question — Settings, onboarding, or the profile API. '
  'NULL means nobody has, regardless of what `timezone` says. Exists because a stored ''UTC'' is '
  'indistinguishable from the DEFAULT ''UTC'' this column''s sibling carried until 20261006, which '
  'left the readiness gate unable to tell it needed to ask. Backfilled only for zones that could '
  'not have come from that default.';
