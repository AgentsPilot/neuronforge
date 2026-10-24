/*
 * Mark confirmations that repeat one already sent.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS SEPARATELY FROM THE MIGRATION
 *
 * `20261079` adds `is_resend` and backfills it with this same rule. But the
 * rule is "the second and later confirmation PER BOOKING", and it can only see
 * confirmations that carry a `booking_id`.
 *
 * When that migration ran, the original confirmation of booking ab48357a was
 * still unlinked — it predates `20261077` — so the booking had exactly one
 * linked confirmation, the resend was its first, and nothing was marked. The
 * rail went on showing "נשלח" for a mail the owner had pressed "send again" on.
 *
 * `backfill-email-links-from-timeline.sql` links those older rows. This
 * re-applies the rule afterwards, without re-running a migration.
 *
 * Idempotent, and safe to run whenever more old mail gets linked.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONLY CONFIRMATIONS, STILL
 *
 * A booking has exactly one ORIGINAL confirmation, so a later one is
 * necessarily a repeat. Reschedule notices share a subject across moves and
 * repeat legitimately — marking those by subject would label the second
 * genuine notice a resend of the first, which is the derivation this column
 * exists to avoid. They are marked at send time or not at all.
 * ─────────────────────────────────────────────────────────────────────────────
 */

-- ── 1. What would be marked ─────────────────────────────────────────────────
WITH confirmations AS (
  SELECT
    e.id,
    e.booking_id,
    e.subject,
    coalesce(e.sent_at, e.created_at) AS went_out,
    row_number() OVER (
      PARTITION BY e.booking_id
      ORDER BY coalesce(e.sent_at, e.created_at)
    ) AS nth
  FROM public.email_sends e
  WHERE e.booking_id IS NOT NULL
    AND (
      e.subject ILIKE '%confirmed%'
      OR e.subject ILIKE '%confirmada%'
      OR e.subject LIKE '%אושרה%'
    )
)
SELECT booking_id, went_out, nth, left(subject, 40) AS subject,
       CASE WHEN nth > 1 THEN 'mark as resend' ELSE 'original' END AS verdict
  FROM confirmations
 ORDER BY booking_id, nth;


-- ── 2. Apply ────────────────────────────────────────────────────────────────
BEGIN;

WITH confirmations AS (
  SELECT
    e.id,
    row_number() OVER (
      PARTITION BY e.booking_id
      ORDER BY coalesce(e.sent_at, e.created_at)
    ) AS nth
  FROM public.email_sends e
  WHERE e.booking_id IS NOT NULL
    AND (
      e.subject ILIKE '%confirmed%'
      OR e.subject ILIKE '%confirmada%'
      OR e.subject LIKE '%אושרה%'
    )
)
UPDATE public.email_sends e
   SET is_resend = true
  FROM confirmations c
 WHERE c.id = e.id
   AND c.nth > 1
   AND e.is_resend = false;

COMMIT;


-- ── 3. Confirm ──────────────────────────────────────────────────────────────
/* Every booking with more than one confirmation has exactly one original. */
SELECT
  count(*) FILTER (WHERE is_resend) AS marked_as_resend,
  count(*)                          AS confirmations_total
FROM public.email_sends
WHERE booking_id IS NOT NULL
  AND (subject ILIKE '%confirmed%' OR subject ILIKE '%confirmada%' OR subject LIKE '%אושרה%');
