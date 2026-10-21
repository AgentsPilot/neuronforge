/*
 * An email says whether it was a REPEAT of one already sent.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE JOURNEY COULD NOT SAY
 *
 * The meeting rail lists the mail sent about each attempt. Under the 14:00
 * attempt it showed:
 *
 *   הפגישה נקבעה מחדש …  · נשלח
 *   הפגישה שלך אושרה …  · נשלח
 *
 * The second was the owner pressing "send again" on the confirmation, and it
 * read identically to an original. So the card said a confirmation went out
 * during that attempt, when what happened was the owner re-sending one the
 * client had already been given.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT HAS TO BE RECORDED RATHER THAN DERIVED
 *
 * The obvious derivation — "this subject appeared earlier, so it is a repeat" —
 * is wrong, and wrong in a way that would have shipped looking right. Every
 * reschedule notice carries the SAME subject (`הפגישה נקבעה מחדש - {service}`),
 * one per move. Dedupe by subject and the second genuine notice is labelled a
 * resend of the first.
 *
 * Narrowing it to one attempt does not save it either: the confirmation resend
 * above is the only confirmation on that attempt, because the original predates
 * `email_sends.booking_id` and carries no link at all.
 *
 * The resend route knows. Nothing else does.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BACKFILL IS LIMITED TO CONFIRMATIONS, AND THAT IS THE ONLY SOUND CASE
 *
 * A booking has exactly one ORIGINAL confirmation — it is sent once, when the
 * booking is made. So for confirmation subjects only, the second and later
 * occurrences per booking are resends. That is a property of the email, not a
 * guess about proximity.
 *
 * Reschedule notices, reminders and missed-appointment invitations are
 * deliberately NOT backfilled: each is its own event and repeats legitimately.
 * They carry `false` until the route marks one, which is the honest default —
 * "nobody recorded this as a repeat".
 *
 * Plan: docs/workplans/BOOKING_MEETINGS_TABLE_PLAN.md (Phase 4c, emails)
 * ─────────────────────────────────────────────────────────────────────────────
 */

BEGIN;

/*
 * NOT NULL DEFAULT false: the question "was this a repeat" always has an
 * answer, and for everything written before this it is "not recorded as one".
 * A nullable column would invite readers to treat unknown as true.
 */
ALTER TABLE public.email_sends
  ADD COLUMN IF NOT EXISTS is_resend boolean NOT NULL DEFAULT false;

/*
 * Confirmations only. The subject match covers the three locales:
 *
 *   en  "Your appointment is confirmed - {service}"
 *   es  "Tu cita está confirmada - {service}"
 *   he  "הפגישה שלך אושרה - {service}"
 *
 * Deliberately NOT matched on the service name, which every booking email
 * carries — that is what once made the journey show a reschedule notice under
 * a node titled "confirmation sent".
 */
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
   /* The first is the original. Everything after it is a repeat. */
   AND c.nth > 1
   AND e.is_resend = false;

COMMENT ON COLUMN public.email_sends.is_resend IS
  'True when this was a REPEAT of mail the client had already been given — the owner pressing "send again". Set by the resend routes. Backfilled for confirmations only, where the second and later per booking are necessarily repeats; a reschedule notice shares its subject across moves and repeats legitimately, so those are left false rather than guessed at.';

COMMIT;
