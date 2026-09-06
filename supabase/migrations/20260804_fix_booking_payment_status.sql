-- Fix booking payment status that was incorrectly marked as refunded
-- Run this to revert the payment_status back to 'paid'

-- Reset the specific payment transaction
UPDATE payment_transactions
SET
  status = 'succeeded',
  refunded_amount = 0,
  refund_reason = NULL,
  updated_at = NOW()
WHERE id = '17a08538-37f4-40c6-9d41-769a2323369d';

-- Reset any bookings linked to this payment
UPDATE scheduling_bookings
SET
  payment_status = 'paid',
  updated_at = NOW()
WHERE payment_id = '17a08538-37f4-40c6-9d41-769a2323369d';

-- Also reset bookings with this in metadata (recently updated)
UPDATE scheduling_bookings
SET
  payment_status = 'paid',
  updated_at = NOW()
WHERE payment_status = 'refunded'
  AND updated_at > NOW() - INTERVAL '1 hour';
