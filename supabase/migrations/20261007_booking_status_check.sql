-- The five states a booking can actually be in, enforced by the database.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY A COLUMN WITH NO CONSTRAINT WENT WRONG QUIETLY
--
-- `scheduling_bookings.status` was created as:
--
--     status TEXT NOT NULL DEFAULT 'confirmed'  -- 'confirmed', 'cancelled', 'completed', 'no_show'
--
-- A comment, and nothing else. Eleven TypeScript declarations repeated those
-- four values, and both API schemas accepted only those four — while
-- `app/api/website/booking/create/route.ts` wrote a FIFTH, `pending`, for a
-- service awaiting payment or awaiting a quote.
--
-- Nothing objected. The column is TEXT, so Postgres stored it; the types were
-- simply wrong about the data they described. What that cost:
--
--   * a FREE booking displayed "Awaiting payment", because the one place that
--     handled `pending` assumed it could only mean unpaid;
--   * the availability check listed `('confirmed','completed','no_show')` on
--     the stated reasoning that the enum was exhaustive — so a `pending`
--     booking did NOT block its slot and the time could be sold twice;
--   * `PATCH /bookings/[id]` rejected `pending`, so a booking in that state
--     could not be moved out of it through the app.
--
-- A constraint would have made the first write fail loudly instead.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- `pending` MEANS NOT CONFIRMED YET — NOT "UNPAID"
--
-- It is written for two unrelated reasons, and conflating them is what produced
-- the bad label: a payment is genuinely outstanding, OR the service is quoted
-- and nobody has said what the work costs yet. Whether money is owed is
-- answered by `payment_status`, which is 'paid' whenever the price is zero or
-- there is nothing to collect.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  stray TEXT;
BEGIN
  /*
   * Refuse to add a constraint that would silently exclude live rows.
   *
   * If any booking holds a status outside the five, adding the CHECK would
   * fail with Postgres's own message, which names the constraint but not the
   * offending values. This names them, so whoever runs the migration can decide
   * what those rows should become rather than guessing.
   */
  SELECT string_agg(DISTINCT status, ', ')
    INTO stray
    FROM scheduling_bookings
   WHERE status NOT IN ('confirmed', 'pending', 'cancelled', 'completed', 'no_show');

  IF stray IS NOT NULL THEN
    RAISE EXCEPTION
      'scheduling_bookings.status holds unexpected value(s): %. Decide what these rows should be before constraining the column.',
      stray;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scheduling_bookings_status_check'
  ) THEN
    ALTER TABLE scheduling_bookings
      ADD CONSTRAINT scheduling_bookings_status_check
      CHECK (status IN ('confirmed', 'pending', 'cancelled', 'completed', 'no_show'));
  END IF;
END $$;

COMMENT ON COLUMN scheduling_bookings.status IS
  'One of: confirmed, pending, cancelled, completed, no_show. PENDING MEANS NOT CONFIRMED YET — '
  'either a payment is outstanding or the service is quoted and has no price yet. It is NOT a '
  'statement that money is owed: read payment_status for that, which is ''paid'' whenever the '
  'price is zero or there is nothing to collect. The roster lives in lib/business-os/bookingStatus.ts.';
