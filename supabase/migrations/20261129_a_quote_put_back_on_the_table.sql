/*
 * An extended quote remembers that it was extended.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE SCHEMA COULD NOT SAY
 *
 * Extending a lapsed quote moves `valid_until` forward and flips `status` back
 * to `sent`. Both are correct, and between them they leave no trace of the act:
 * afterwards the row is indistinguishable from one that was simply sent with a
 * later date. `updated_at` moves, but every edit moves it, so it cannot answer
 * "was this extended" either.
 *
 * Reported on a live account on 2026-11-16. An owner cleared a "quote expired"
 * card by extending the offer from the 13th to the 17th. The write was correct
 * — `PROPOSAL_EXTENDED` is in the audit trail, the expiry state was cleared,
 * and the expired card stopped firing. But every surface still described the
 * quote by `sent_at`, three days earlier, so the owner read it as the same
 * untouched alert and concluded the extension had not worked.
 *
 * The audit trail knows. It is the wrong place to ask: it is an append-only
 * record for answering "who did what", not a column the journey can render, and
 * a UI that reads the audit log to decide what to draw has the dependency
 * backwards.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO COLUMNS, BECAUSE THE STORY NEEDS BOTH HALVES
 *
 *   extended_at    WHEN the owner put the offer back on the table. This is what
 *                  the waiting clock should restart from: an extended quote has
 *                  been waiting since the extension, not since the first send.
 *
 *   extended_from  The date it had previously been due to lapse. Without it the
 *                  row can say "extended" but not "it was the 13th, now it is
 *                  the 17th" — and the second is the sentence that tells an
 *                  owner their action registered.
 *
 * Both NULL for every quote that has never been extended, which is the honest
 * default and needs no backfill: the act was not recorded before this, so no
 * past value exists to write. A quote extended before today simply reads as
 * never extended, which is what we actually know about it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TIMING: BEFORE THE DEPLOY THAT READS THEM
 *
 * Additive, so the currently deployed code keeps working untouched — it does
 * not know these columns exist. The reverse is NOT true: PostgREST rejects an
 * entire query for one unknown column name, so the gap definition and the
 * journey that name `extended_at` in a `.select()` would fail completely
 * against the old schema. Apply this before that build goes to Production.
 */

BEGIN;

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS extended_at timestamptz,
  ADD COLUMN IF NOT EXISTS extended_from date;

COMMENT ON COLUMN public.proposals.extended_at IS
  'When a lapsed quote was last put back on the table by its owner, or NULL if '
  'it never was. Written only by POST /api/business-os/proposals/[id]/extend, '
  'which also clears the expired status and moves valid_until. Surfaces read '
  'this rather than sent_at when deciding how long a quote has been waiting: an '
  'extended quote has been waiting since the extension. Never backfilled — the '
  'act was not recorded before 20261129, so NULL means "not known to have been '
  'extended", not "never extended".';

COMMENT ON COLUMN public.proposals.extended_from IS
  'The valid_until this quote carried immediately BEFORE its most recent '
  'extension, or NULL if it has never been extended. Kept so a surface can say '
  'what changed ("was due the 13th, now the 17th") rather than only that '
  'something did. A date, matching valid_until, which has no time of day.';

/*
 * ONE DIRECTION ONLY, AND NOT THE OTHER.
 *
 * `extended_from` without `extended_at` is nonsense: a previous date with no
 * record of when it changed. The reverse is legitimate and had to be allowed —
 * this was first written as `(extended_at IS NULL) = (extended_from IS NULL)`,
 * which would have rejected the extension of a quote that carried no
 * `valid_until` at all, turning a working button into a 500 at the moment an
 * owner pressed it. The timestamp is the fact; the old date is context that can
 * be genuinely unknown.
 */
ALTER TABLE public.proposals
  DROP CONSTRAINT IF EXISTS proposals_extension_is_dated;

ALTER TABLE public.proposals
  ADD CONSTRAINT proposals_extension_is_dated
  CHECK (extended_from IS NULL OR extended_at IS NOT NULL);

COMMIT;
