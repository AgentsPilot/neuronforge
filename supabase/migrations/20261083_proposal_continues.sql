/*
 * The owner's answer to "is the quote still a go?", kept.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT CANNOT BE DERIVED
 *
 * When a meeting is called off on a quoted job, the client has to be told
 * whether a quote is still coming — and "no proposal row exists" is the same
 * data whether one is being written or none ever will be. The two cases need
 * opposite sentences, so the cancel dialog asks.
 *
 * That answer shaped the email and was then thrown away, which left the worse
 * half of the problem untouched: an owner who says no quote is coming has a
 * booking still sitting open as live work. Nothing reminded them, because
 * nothing remembered.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THREE STATES, AND NULL IS ONE OF THEM
 *
 *   NULL   nobody has been asked — every booking before this, and every one
 *          whose meeting was never cancelled
 *   true   the quote is still coming
 *   false  it is not, and the booking probably wants closing — which is what
 *          the journey now says
 *
 * NULL and `true` are deliberately distinguishable, the same rule the timezone
 * column follows: "not asked" is not "answered yes", and a card that cannot
 * tell them apart cannot know whether it still needs to ask.
 *
 * Plan: docs/workplans/BOOKING_MEETINGS_TABLE_PLAN.md (Phase 4f)
 * ─────────────────────────────────────────────────────────────────────────────
 */

BEGIN;

ALTER TABLE public.scheduling_bookings
  ADD COLUMN IF NOT EXISTS proposal_continues boolean;

COMMENT ON COLUMN public.scheduling_bookings.proposal_continues IS
  'The owner''s answer when a meeting was cancelled on a quoted job: is the quote still coming? NULL means nobody was asked, which is every row predating 20261083 and every booking whose meeting was never cancelled. Distinct from true on purpose. false makes the journey ask whether the booking should be closed, since work nobody will quote for should not sit open.';

COMMIT;
