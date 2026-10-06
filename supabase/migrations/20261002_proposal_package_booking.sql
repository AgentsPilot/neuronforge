-- The agreement points at the package it created
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THIS IS NEEDED
--
-- Accepting a package quote creates a container booking and its N meetings
-- (20261001_package_sessions). For the up-front scenario those meetings are
-- `pending` until the payment lands, and the payment is what confirms them.
--
-- But a settled invoice could not FIND them. The chain runs invoice →
-- `proposals.created_invoice_id` → proposal, and there the trail stopped: the
-- proposal knew what money it had raised and nothing about the meetings. The
-- container carries no proposal id either — `scheduling_bookings` has no such
-- column, and adding one would point the wrong way, since a proposal has at
-- most one package and a booking has no opinion about quotes.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY A COLUMN RATHER THAN A QUERY
--
-- The alternative was to re-find the container by shape: same contact, same
-- service, no start time, `booking_source = 'proposal'`. That is a guess, and
-- it is wrong the second time a client buys the same package — which is the
-- normal case for the businesses this feature is for. A client on their third
-- block of six sessions would have three containers matching, and the newest is
-- not reliably the right one.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY NOT `proposals.booking_id`, WHICH ALREADY EXISTS
--
-- That column is the booking this quote came OUT of — the consultation where
-- the work was discussed. It points BACKWARDS, at a meeting that happened
-- before the quote existed. This one points FORWARDS, at what accepting it
-- produced, which is why it joins `created_invoice_id` and `created_plan_id`
-- rather than sitting beside `booking_id`. Naming it `created_booking_id` would
-- have been consistent with that family and one character away from a column
-- meaning the opposite thing, so it says `package` instead.
--
-- Full design: docs/workplans/packages-recurring-sessions.md
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS package_booking_id UUID
  REFERENCES scheduling_bookings(id) ON DELETE SET NULL;

COMMENT ON COLUMN proposals.package_booking_id IS
  'The container booking this accepted quote created, for a package. NULL on every quote that is not a package and on every package not yet accepted. Written by recordAcceptance alongside created_invoice_id and created_plan_id. ON DELETE SET NULL: if the purchase is removed the quote remains as the record of what was agreed, simply no longer pointing at a package — the reverse (losing the proposal) would destroy the agreement itself.';

/*
 * One partial index, for the one question asked of it: given a package, which
 * proposal sold it. Partial because the rows that have it are the minority and
 * will stay so.
 */
CREATE INDEX IF NOT EXISTS idx_proposals_package_booking
  ON proposals (package_booking_id)
  WHERE package_booking_id IS NOT NULL;
