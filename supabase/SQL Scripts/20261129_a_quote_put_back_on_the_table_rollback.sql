/*
 * Rollback for 20261129_a_quote_put_back_on_the_table.sql
 *
 * Drops the two columns and the constraint that records a quote extension.
 *
 * ── WHAT IS LOST ────────────────────────────────────────────────────────────
 * Every extension recorded since the migration was applied. The audit trail
 * keeps `PROPOSAL_EXTENDED` with its timestamp, so WHO extended WHAT and WHEN
 * survives; what goes is the previous `valid_until` (`extended_from`), which is
 * written nowhere else. Re-applying the migration gives empty columns again.
 *
 * Safe to run while the old code is deployed, since nothing deployed before
 * 20261129 reads these columns. NOT safe while a build that selects them is
 * live: PostgREST rejects a whole query for one unknown column, so the gap
 * definition and the quote journey would both fail outright. Roll the deploy
 * back first, then this.
 */

BEGIN;

ALTER TABLE public.proposals
  DROP CONSTRAINT IF EXISTS proposals_extension_is_dated;

ALTER TABLE public.proposals
  DROP COLUMN IF EXISTS extended_from,
  DROP COLUMN IF EXISTS extended_at;

COMMIT;
