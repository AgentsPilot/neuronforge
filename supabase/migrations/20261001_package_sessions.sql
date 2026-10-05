-- One purchase, several meetings
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS IS FOR
--
-- An owner agrees a block of meetings with one client — six coaching sessions,
-- four treatments, ten lessons — and sells it as a single purchase in the quote
-- dialog. Today an accepted quote can own at most ONE meeting. These three
-- nullable columns are what let it own several.
--
-- Full design: docs/workplans/packages-recurring-sessions.md
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE SHAPE, AND THE TWO ASSUMPTIONS THAT TURNED OUT TO BE STALE
--
-- The plan described a PARENT booking whose `start_time`/`end_time` span the
-- whole engagement, carrying the money, with the meetings as children — and it
-- said the parent must then be excluded from availability, `checkOverlap`,
-- calendar sync and the overlap constraint, because a six-week range would
-- otherwise block six weeks of diary. Both halves of that rest on assumptions
-- this migration does not have to carry:
--
--   1. "The parent must have a range." It did when the plan was written:
--      `start_time` and `end_time` were NOT NULL. `20260803_allow_null_booking_times`
--      dropped both, for courses and products — so a container can simply have
--      NO time, and every diary path already skips a booking without one. The
--      exclusion constraint added in 20261001_bookings_no_overlap skips them
--      too, by an explicit clause that was tested against live data.
--
--   2. "Money must move onto the parent." It does not have to move at all.
--      `proposals.booking_id` and `payment_plan_installments.booking_id` already
--      point where they point — at the consultation the quote came out of, or at
--      nothing for a quote sent cold — and acceptance already raises the invoice
--      and the stages against them. A package changes how many MEETINGS a
--      purchase owns; it does not change where its money lives.
--
-- So the container is a booking with no time, like a product sale, and nothing
-- needs excluding anywhere. `purchases → parent_booking_id IS NULL` then works
-- for every reader the Stage 1 audit classified: containers and ordinary
-- bookings have it null, and the meetings of a package have it set.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY NO NEW TABLE
--
-- Three owners of "what was agreed" already exist — the proposal, the payment
-- plan, and the booking. A `booking_series` table would be a fourth, and every
-- query would then have to pick one. The proposal is the agreement, the plan is
-- the money, and these columns make one booking the container for others.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── The agreement: which dates were sold ─────────────────────────────────────

ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS sessions JSONB;

COMMENT ON COLUMN proposals.sessions IS
  'A package: { "dates": ["2026-10-07T10:00:00Z", …], "duration_minutes": 60 }. NULL means this quote is not a package, which is every quote written before this column existed. Dates are EXPLICIT, never a cadence rule — a repeat rule would need clash detection, time-off reading, DST-correct stepping and a preview screen, and the owner picking six dates costs six date pickers.';

-- ── The meetings: which purchase they belong to, and their order ─────────────

ALTER TABLE scheduling_bookings
  ADD COLUMN IF NOT EXISTS parent_booking_id UUID
  REFERENCES scheduling_bookings(id) ON DELETE CASCADE;

ALTER TABLE scheduling_bookings
  ADD COLUMN IF NOT EXISTS occurrence_number INT;

COMMENT ON COLUMN scheduling_bookings.parent_booking_id IS
  'The purchase this meeting belongs to, for a package. NULL on every ordinary booking and on the container itself, which is what makes "purchases → parent_booking_id IS NULL" correct for every reader. ON DELETE CASCADE: removing the purchase removes the meetings it bought, which is the only honest reading of deleting it.';

COMMENT ON COLUMN scheduling_bookings.occurrence_number IS
  'Which meeting of the package this is, 1..N, in the order the owner chose. NULL on ordinary bookings and on the container. Never a count of payments — reusing installment_count for sessions is the mistake RetPackageEndingDetector was deleted for, because it counted a payment split as a package.';

-- ── Indexes ──────────────────────────────────────────────────────────────────

/*
 * The children of one purchase, in order: what the CRM drawer, the calendar and
 * the acceptance wire all ask for. `occurrence_number` is in the index so the
 * order comes from it rather than from a sort.
 */
CREATE INDEX IF NOT EXISTS idx_scheduling_bookings_parent
  ON scheduling_bookings (parent_booking_id, occurrence_number)
  WHERE parent_booking_id IS NOT NULL;

/*
 * And the other direction: every reader that counts PURCHASES has to exclude the
 * meetings of a package, and most of them are already filtering by user and by
 * time. Partial, because the rows it describes are the minority and the index
 * exists to make the exclusion cheap rather than to serve a scan.
 */
CREATE INDEX IF NOT EXISTS idx_scheduling_bookings_purchases
  ON scheduling_bookings (user_id, start_time)
  WHERE parent_booking_id IS NULL;
