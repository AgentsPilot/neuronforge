/*
 * An activity can carry the DRAFT the agent wrote, and name it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS UNBLOCKS
 *
 * The "needs you" card is being given the two things it has never had: the
 * client's message, and a box to answer in. For the `needs_owner` half that box
 * starts empty. For the `reply_drafted` half it must start FULL — the agent has
 * already written a reply, and the whole value of that outcome is that the
 * owner reads three sentences and presses send.
 *
 * Today that draft exists only inside Gmail. The activity row records that a
 * draft was written and nothing about what it says, so the card cannot show it,
 * cannot let the owner fix a word, and cannot tidy it up afterwards.
 *
 *   draft_body       what the agent wrote, so the card can show and edit it
 *   source_draft_id  which Gmail draft it is, so sending can delete it
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE BODY IS STORED RATHER THAN FETCHED
 *
 * Gmail has no "get the draft on this thread" call. Finding it means listing
 * drafts and matching on thread, which is a second round trip on every card
 * render, and it is fragile in the one case that matters: an owner who opened
 * Gmail and edited or deleted the draft by hand.
 *
 * The stored copy is what the AGENT proposed, which is the honest thing for the
 * card to show — it is labelled as the agent's draft, not as the live contents
 * of a Gmail object. The id is kept beside it so the real draft can be removed
 * once a reply actually goes, instead of being left behind to be sent twice.
 *
 * `source_draft_id` is `text`, like `source_thread_id` and for the same reason:
 * the id belongs to the mail provider and its shape is theirs.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING IS BACKFILLED
 *
 * Rows written before this have a draft sitting in Gmail that this column
 * cannot name. They render with an empty box, which is correct and not a lie:
 * the card does not claim to have a draft it cannot produce, and the owner can
 * still open the thread and use the one in their mailbox.
 *
 * REVERSIBLE by dropping both columns.
 * ─────────────────────────────────────────────────────────────────────────────
 */

BEGIN;

ALTER TABLE public.crm_activities
  ADD COLUMN IF NOT EXISTS draft_body      text,
  ADD COLUMN IF NOT EXISTS source_draft_id text;

COMMENT ON COLUMN public.crm_activities.draft_body IS
  'The reply the AGENT proposed, stored so the needs-you card can show and edit it without a Gmail round trip. A snapshot of what was proposed, not a mirror of the live Gmail draft: an owner who edits the draft in their mailbox will not change this. NULL on reply_needs_owner rows (nothing was drafted) and on every row written before 20261110.';

COMMENT ON COLUMN public.crm_activities.source_draft_id IS
  'The Gmail/Graph draft this activity created, in the provider''s own id format. Kept so that sending a reply from the card can delete the draft behind it — without this the draft is left in the mailbox and can be sent a second time by hand. NULL where no draft was created.';

COMMIT;
