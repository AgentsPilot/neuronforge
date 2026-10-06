-- One slot, one booking — enforced by the database
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT IS WRONG TODAY
--
-- Every double-booking check in the platform is SELECT-then-INSERT with nothing
-- holding a lock in between: `checkOverlap` reads the bookings that would clash,
-- the caller decides, and then writes. Two requests arriving together both read
-- an empty answer and both write, so the same hour is sold twice. The public
-- booking page, the owner's dialog, the reschedule route and the chat all share
-- that shape.
--
-- There are currently ZERO exclusion constraints in this tree, so nothing has
-- ever caught it. This is the one check that cannot be raced: Postgres refuses
-- the second write itself, whoever is asking and however many of them there are.
--
-- The application checks stay exactly as they are. They produce the good error
-- message and the alternative slots; this is the backstop underneath them, and
-- callers should treat a `23P01` as "somebody just took it" rather than a bug.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHICH ROWS IT APPLIES TO, AND WHY EACH CLAUSE IS THERE
--
-- `status IN ('confirmed','pending','completed')` — `SLOT_HOLDING_STATUSES` in
--   lib/business-os/bookingStatus.ts, kept identical on purpose. `pending` holds
--   its time because a payment or a quote is outstanding and the client is still
--   expecting that hour; `completed` holds it so the calendar cannot be
--   double-booked retrospectively. Cancelled and no-show release it.
--
-- `start_time IS NOT NULL AND end_time IS NOT NULL` — a service sold WITHOUT a
--   time (a course, a product) has no times at all, and `tstzrange(NULL, NULL)`
--   is an UNBOUNDED range that overlaps everything. Without this clause the
--   first product sale would block every appointment the business ever takes.
--   Four such rows exist on the account this was written against.
--
-- `end_time > start_time` — `tstzrange` throws on an inverted range rather than
--   returning something false, which would make the constraint impossible to
--   add and every later write fail. No such row exists today; this keeps one
--   from being able to take the table down.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- PACKAGES NEED NOTHING HERE — settled 2026-10-01, after this shipped
--
-- This comment used to say the constraint would have to be dropped and
-- recreated when packages landed, because a package's parent booking would span
-- the whole engagement and overlap every one of its children.
--
-- It does not. A package's container is a booking with NO TIME — the same shape
-- a course or a product already has — so the `start_time IS NOT NULL` clause
-- above skips it, and the six meetings underneath it are ordinary bookings this
-- constraint protects exactly as it protects any other.
--
-- The design question that comment raised ("how do you tell a parent from a
-- single booking?") turned out not to need answering either: nothing has to,
-- because nothing excludes a container anywhere.
--
-- See docs/workplans/packages-recurring-sessions.md § The rule.
-- ─────────────────────────────────────────────────────────────────────────────

-- `uuid WITH =` inside a gist exclusion needs btree_gist. Supabase permits it.
CREATE EXTENSION IF NOT EXISTS btree_gist;

/*
 * Constraints have no IF NOT EXISTS, so the guard is explicit — this migration
 * has to be safe to run twice.
 */
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'scheduling_bookings_no_overlap'
      AND conrelid = 'public.scheduling_bookings'::regclass
  ) THEN
    ALTER TABLE scheduling_bookings
      ADD CONSTRAINT scheduling_bookings_no_overlap
      EXCLUDE USING gist (
        user_id WITH =,
        tstzrange(start_time, end_time) WITH &&
      )
      WHERE (
        status IN ('confirmed', 'pending', 'completed')
        AND start_time IS NOT NULL
        AND end_time IS NOT NULL
        AND end_time > start_time
      );
  END IF;
END $$;

COMMENT ON CONSTRAINT scheduling_bookings_no_overlap ON scheduling_bookings IS
  'One slot, one booking, per business. Covers SLOT_HOLDING_STATUSES only; skips bookings with no times (products) and any inverted range. A 23P01 from this means the slot was taken between the check and the write — tell the client it has gone, do not report a fault.';
