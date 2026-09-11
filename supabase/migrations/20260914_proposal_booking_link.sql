-- The booking a quote answers.
--
-- Proposals were matched to bookings by SERVICE, because that was the only
-- thing the two rows shared. That works exactly once: the moment a client asks
-- twice for the same service, every booking inherits every quote ever sent for
-- it — a brand new request opens showing the previous job already accepted.
--
-- Nullable and ON DELETE SET NULL: a quote outlives the appointment that
-- prompted it. Deleting a consultation must not delete the money agreed at it.

ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS booking_id UUID
  REFERENCES scheduling_bookings(id) ON DELETE SET NULL;

-- The drawer's lookup: every quote for one booking.
CREATE INDEX IF NOT EXISTS idx_proposals_booking
  ON proposals (booking_id)
  WHERE booking_id IS NOT NULL;

COMMENT ON COLUMN proposals.booking_id IS
  'The request this quote answers. Null for quotes created before this column existed, and for any raised outside a booking.';
