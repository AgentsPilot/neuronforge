-- Stop `user_preferences.timezone` defaulting to 'UTC'.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY A DEFAULT IS THE WRONG SHAPE FOR THIS COLUMN
--
-- 'UTC' has been doing two incompatible jobs: it is a legitimate answer, and it
-- is what the column says when nobody has been asked. The platform cannot tell
-- those apart, and the two halves of the codebase resolved the ambiguity in
-- opposite directions:
--
--   `scripts/backfill-timezone-preferences.ts` treats a stored 'UTC' as an
--   unanswered question and overwrites it — "only the default gives way".
--
--   `DailyBriefingDispatchService` treats it as a decision and emails on it, so
--   an account that has never chosen is mailed at 07:00 UTC. Its own comment
--   says "no timezone means no morning" — and that check cannot fire, because
--   the column never returns nothing.
--
-- Both readings are defensible. Only one can be right, and a column that
-- answers a question nobody asked is what makes the disagreement possible.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS CHANGES, AND WHAT IT DELIBERATELY DOES NOT
--
-- Forward-looking only. Dropping the DEFAULT changes nothing about any row that
-- already exists: an account sitting on 'UTC' keeps it and is never nagged,
-- because this migration cannot tell whether that business chose it either.
--
-- New accounts get NULL. The trigger on `auth.users` inserts `(user_id)` and
-- nothing else, so the row is created with the question genuinely open — which
-- is what the readiness card needs in order to ask, and what lets the briefing's
-- "no timezone means no morning" check finally mean something.
--
-- NO BACKFILL of existing 'UTC' rows to NULL. It would gate businesses that may
-- well have chosen it, over a value this migration cannot interpret. The cost of
-- being wrong there is refusing to publish a working booking page; the cost of
-- leaving it is that those accounts are asked later, by a person, in Settings.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- SAFE FOR EVERY READER
--
-- Checked across lib/, app/ and components/: every consumer already handles an
-- absent zone. `safeTimezone()` maps null to 'UTC' for display,
-- `resolveBusinessTimezone()` reports `source: 'default'`, and no call site
-- dereferences the column without a guard. NULL is a state the code already
-- knows how to be in — it simply never occurred.
--
-- The column stays nullable; only the DEFAULT goes.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE user_preferences
  ALTER COLUMN timezone DROP DEFAULT;

COMMENT ON COLUMN user_preferences.timezone IS
  'IANA timezone for this business. NULL means NOT ASKED — deliberately distinct from a stored '
  '''UTC'', which is a real choice. Had a DEFAULT of ''UTC'' until 20261006, which made the two '
  'indistinguishable: the readiness gate could not tell it needed to ask, and the daily briefing '
  'mailed never-configured accounts at 07:00 UTC. Rows predating that change keep their ''UTC'' '
  'and are asked in Settings rather than backfilled.';
