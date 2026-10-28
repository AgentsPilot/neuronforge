-- ═════════════════════════════════════════════════════════════════════════════
-- A SESSION KNOWS WHICH SESSION IT REPLACED
--
-- Calling off or missing a session of a package offers the owner a replacement
-- on the same dialog. The replacement is created as an ordinary session and the
-- link between the two was never written down, so nothing could afterwards
-- answer: has THIS session already been made up?
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY A COLUMN, AND NOT A COUNT
--
-- The first attempt inferred it: a block back at its agreed size must have had
-- its gap filled. That holds while there is exactly one gap and fails as soon
-- as there is more than one. Measured on a live package (agreed 3):
--
--   4 Nov   cancelled
--   11 Nov  cancelled
--   18 Nov  cancelled
--   25 Nov  no_show    ← a make-up WAS booked for this one
--   2 Dec   cancelled
--   9 Dec   no_show    ← the client was invited to pick a time instead
--   16 Dec  upcoming
--   23 Dec  upcoming
--
-- standing = 2, agreed = 3, so the block reads as SHORT and every row keeps its
-- Reschedule action — including 25 Nov, which already has its replacement. The
-- two no-shows are the proof that no aggregate can work: identical status,
-- opposite answers.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT IT COSTS AND WHAT IT BUYS
--
-- The add-session route is ALREADY told which session is being replaced — it
-- uses it so the "block is full" count can ignore the hour being called off —
-- and then throws it away. This gives that fact somewhere to live.
--
-- It also works where the count never could: a package billed per session has
-- no agreed ceiling, so "full" is meaningless there, and the link is the only
-- thing that can answer the question at all.
--
-- ON DELETE SET NULL, not CASCADE: deleting the missed session must not delete
-- the hour that replaced it. That replacement is a real appointment the client
-- is expecting, and it outlives the record of what it was for.
--
-- Nullable, and null on every existing row. Nothing is backfilled: the link was
-- never captured, and guessing it from dates would invent history.
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE scheduling_meetings
  ADD COLUMN IF NOT EXISTS replaces_meeting_id uuid
    REFERENCES scheduling_meetings(id) ON DELETE SET NULL;

COMMENT ON COLUMN scheduling_meetings.replaces_meeting_id IS
  'The session this one was booked IN PLACE of, set when it came from the replacement toggle on the cancel or no-show dialog. Null for an ordinary session. Read to decide whether a called-off or missed session has already been made up: a session something points at is not offered Reschedule, because moving an hour that has already been replaced leaves the client holding two. ON DELETE SET NULL — removing the original must not remove the hour the client is now expecting.';

-- The question is always asked in one direction: "does anything replace this
-- session?". Partial, because the column is null on nearly every row and only
-- the populated ones are ever searched.
CREATE INDEX IF NOT EXISTS scheduling_meetings_replaces_idx
  ON scheduling_meetings (replaces_meeting_id)
  WHERE replaces_meeting_id IS NOT NULL;
