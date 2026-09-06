-- Backfill booking_id on payment_invoices.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Invoices raised before `payment_invoices.booking_id` existed have no link to
-- the appointment they were for, so the money list cannot nest them under it.
-- There is no stored relationship to recover, only evidence: same business, same
-- contact, the service's price, and created around the same time.
--
-- That is a GUESS, and this file treats it as one.
--
-- ONLY UNAMBIGUOUS MATCHES ARE LINKED. The original version took, for each
-- invoice, whichever booking was closest in time — which on real data attached
-- four separate invoices to one booking, because four sequential invoices for
-- the same client at the same price all "matched" it equally well. A booking
-- showing ₪800 it never charged is worse than a booking showing nothing.
--
-- So a pair is linked only when the invoice matches exactly ONE booking, that
-- booking matches exactly ONE invoice, and the booking has no invoice already.
-- Everything else is left alone and shows as "not linked to a booking", which is
-- the honest answer when the link genuinely is not knowable.
-- ─────────────────────────────────────────────────────────────────────────────

WITH candidates AS (
  SELECT
    inv.id  AS invoice_id,
    bk.id   AS booking_id
  FROM payment_invoices inv
  JOIN scheduling_bookings bk
    ON bk.user_id = inv.user_id
   AND bk.contact_id = inv.contact_id
   -- Invoices for a booking are raised as part of creating it, so anything
   -- outside an hour is a different event.
   AND inv.created_at BETWEEN bk.created_at - INTERVAL '1 hour'
                          AND bk.created_at + INTERVAL '1 hour'
  JOIN scheduling_services svc ON svc.id = bk.service_id
  WHERE inv.booking_id IS NULL
    AND ABS(svc.price - inv.amount) < 0.01
),

-- Both directions must be unique. One-to-one is the only shape that can be
-- inferred safely; anything else is a coin toss with someone's money.
unambiguous AS (
  SELECT invoice_id, booking_id
  FROM candidates
  WHERE invoice_id IN (SELECT invoice_id FROM candidates GROUP BY invoice_id HAVING COUNT(*) = 1)
    AND booking_id IN (SELECT booking_id FROM candidates GROUP BY booking_id HAVING COUNT(*) = 1)
    -- And the booking must not already have an invoice of its own.
    AND booking_id NOT IN (
      SELECT booking_id FROM payment_invoices WHERE booking_id IS NOT NULL
    )
)

UPDATE payment_invoices inv
SET booking_id = unambiguous.booking_id,
    updated_at = NOW()
FROM unambiguous
WHERE inv.id = unambiguous.invoice_id
  AND inv.booking_id IS NULL;

-- A booking whose invoice is paid is a paid booking. Safe regardless of the
-- linking above, because it only reads links that already exist.
UPDATE scheduling_bookings bk
SET payment_status = 'paid',
    updated_at = NOW()
FROM payment_invoices inv
WHERE inv.booking_id = bk.id
  AND inv.status IN ('paid', 'refunded', 'partially_refunded')
  AND (bk.payment_status IS NULL OR bk.payment_status <> 'paid');

-- What is left, and why. `GET DIAGNOSTICS` in a separate DO block reports the
-- row count of the last statement INSIDE that block — which is none — so the
-- original version always printed nothing useful. This counts instead.
DO $$
DECLARE
  still_unlinked INTEGER;
BEGIN
  SELECT COUNT(*) INTO still_unlinked
  FROM payment_invoices
  WHERE booking_id IS NULL;

  RAISE NOTICE 'Backfill complete. % invoice(s) remain unlinked — either genuinely ad-hoc, or too ambiguous to attach safely.', still_unlinked;
END $$;
