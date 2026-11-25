/*
 * An activity can name the CONVERSATION it came from.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS MISSING TODAY
 *
 * The receptionist files `reply_drafted` and `reply_needs_owner` rows describing
 * a mail thread, and nothing on the row can identify that thread. `title` holds
 * the subject, `description` holds the client's words and the agent's note, and
 * that is the whole record. So the "needs you" card can describe a conversation
 * it has no way to open.
 *
 * `source_entity_id` is NOT the column for it, and that is worth stating because
 * it is the obvious candidate and it fails: it is `uuid`, and a Gmail thread id
 * is a hex string like `1a1c3171ac4e0b61`. Exposing it for this purpose was
 * tried on 2026-11-10 and the catalog generator rejected it outright —
 * "declared 'string' but 'crm_activities.source_entity_id' is 'uuid'".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS WORTH A COLUMN
 *
 * Two things the card cannot do without it, and only one of them is cosmetic.
 *
 *   · "Open the email" — a link straight to the conversation rather than the
 *     contact's record, which is where the button lands today.
 *
 *   · ANSWERING FROM THE CARD. This is the real one. A reply sent without a
 *     thread id is not a reply; it is a NEW conversation that happens to share
 *     a subject line. The client sees two threads about the thing they asked
 *     once, and the failure is invisible on our side — the send succeeds, the
 *     card clears, and only the client can tell something went wrong.
 *
 * `text`, not `uuid`, because the id belongs to the mail provider and its shape
 * is theirs: Gmail returns hex, Microsoft Graph returns a long base64url string.
 * Neither is ours to reformat, and a column that cannot hold both would push a
 * second column onto the Outlook plan for no reason.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING IS BACKFILLED
 *
 * The rows already written never captured a thread id and it cannot be inferred:
 * matching an old row back to a message by subject and date would be a guess,
 * and a guess here opens the WRONG conversation or replies into it. Existing
 * rows read as "no thread recorded", which is true, and the card falls back to
 * opening the contact exactly as it does now.
 *
 * REVERSIBLE by dropping the column. Nothing reads it until the card does.
 * ─────────────────────────────────────────────────────────────────────────────
 */

BEGIN;

ALTER TABLE public.crm_activities
  ADD COLUMN IF NOT EXISTS source_thread_id text;

COMMENT ON COLUMN public.crm_activities.source_thread_id IS
  'The mail thread this activity is about, in the provider''s own id format (Gmail hex, Graph base64url). Distinct from source_entity_id, which is uuid and cannot hold either. NULL on every row written before 20261110 and never inferred: matching an old activity to a message by subject would open or reply into the wrong conversation. Written by the receptionist agent; read by the needs-you card to open the thread and to reply inside it rather than starting a new one.';

CREATE INDEX IF NOT EXISTS crm_activities_source_thread_id_idx
  ON public.crm_activities (user_id, source_thread_id)
  WHERE source_thread_id IS NOT NULL;

COMMIT;
