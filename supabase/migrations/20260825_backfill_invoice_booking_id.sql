-- Migration: Backfill booking_id on payment_invoices
-- This connects existing invoices to their bookings for proper payment status syncing

-- Update invoices that don't have a booking_id but can be matched to a booking
-- Match by: same user_id, same contact_id, similar amount (within 0.01),
-- and invoice created within 1 hour of booking creation
UPDATE payment_invoices pi
SET booking_id = matched_booking.id
FROM (
  SELECT DISTINCT ON (pi2.id)
    pi2.id as invoice_id,
    sb.id as booking_id
  FROM payment_invoices pi2
  JOIN scheduling_bookings sb ON (
    sb.user_id = pi2.user_id
    AND sb.contact_id = pi2.contact_id
    -- Invoice was created within 1 hour of booking (typically immediate)
    AND pi2.created_at BETWEEN sb.created_at - INTERVAL '1 hour' AND sb.created_at + INTERVAL '1 hour'
  )
  JOIN scheduling_services ss ON ss.id = sb.service_id
  WHERE
    pi2.booking_id IS NULL  -- Only update invoices without booking_id
    AND ABS(ss.price - pi2.amount) < 0.01  -- Amount must match (within rounding)
  ORDER BY pi2.id, ABS(EXTRACT(EPOCH FROM (pi2.created_at - sb.created_at)))  -- Pick closest match
) matched_booking
WHERE pi.id = matched_booking.invoice_id
  AND pi.booking_id IS NULL;

-- Also sync payment_status on bookings from paid invoices
-- This ensures bookings show 'paid' if their linked invoice is paid
UPDATE scheduling_bookings sb
SET
  payment_status = 'paid',
  updated_at = NOW()
FROM payment_invoices pi
WHERE
  pi.booking_id = sb.id
  AND pi.status = 'paid'
  AND (sb.payment_status IS NULL OR sb.payment_status != 'paid');

-- Log how many records were updated
DO $$
DECLARE
  invoices_updated INTEGER;
  bookings_updated INTEGER;
BEGIN
  GET DIAGNOSTICS invoices_updated = ROW_COUNT;
  RAISE NOTICE 'Backfill complete. Updated invoices with booking_id.';
END $$;
