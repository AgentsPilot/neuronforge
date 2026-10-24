/*
 * Link the emails that predate `email_sends.booking_id`, from the timeline.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS MISSING
 *
 * `20261077` added the link forward-only, so every email before it has
 * `booking_id` and `meeting_id` NULL and appears under no attempt at all. On
 * booking ab48357a the 13:00 attempt shows a bare "לא הגיע" while two emails
 * about it sit unattached:
 *
 *   01:49:07  "הפגישה שלך אושרה"   the original confirmation
 *   02:00:04  "התגעגענו אליך"      sent because 13:00 was missed
 *
 * Three consequences, all visible on the card:
 *
 *   - the first attempt looks like nothing was ever sent about it;
 *   - the LAST attempt looks odd for having two emails, when in fact every
 *     attempt has an announcement and an outcome and only the first was
 *     missing its pair;
 *   - the 05:14 confirmation cannot be recognised as a RESEND, because the
 *     original it repeats is not linked to the same booking, so
 *     `20261079`'s "second confirmation per booking" rule never fires.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MATCH IS THE TIMELINE, NOT PROXIMITY TO A BOOKING
 *
 * `crm_activities` names the booking in `source_entity_id` and is written at
 * the moment of the event that SENDS the mail — a confirmation four seconds
 * after `booking`, a "we missed you" four seconds after `booking_no_show`.
 *
 * So an email is linked to the booking named by an activity that fired just
 * before it, for the same contact. That is a recorded cause, not the
 * `(created_at + service_name)` guess the journey used to make — and it is
 * refused outright where it would be ambiguous.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE IT REFUSES
 *
 * `MATCH_WINDOW` is 120 seconds: long enough for a send that queued behind
 * other work, far short of a second unrelated event.
 *
 * And the link is only written where exactly ONE booking has an activity in
 * that window. A contact with two bookings touched seconds apart has no
 * knowable answer, and a wrong `meeting_id` is worse than a missing one — it
 * would file a client's mail under an appointment it was never about.
 *
 * Read-only first: run section 1 and read what it proposes.
 * ─────────────────────────────────────────────────────────────────────────────
 */

CREATE TEMPORARY VIEW email_cause AS
WITH candidates AS (
  SELECT
    e.id            AS email_id,
    e.contact_id,
    coalesce(e.sent_at, e.created_at) AS went_out,
    a.source_entity_id AS booking_id,
    a.activity_type,
    a.created_at    AS caused_at,
    /* How long after the activity the mail went out. */
    extract(epoch FROM coalesce(e.sent_at, e.created_at) - a.created_at) AS gap_seconds
  FROM public.email_sends e
  JOIN public.crm_activities a
    ON a.contact_id = e.contact_id
   AND a.source_entity_id IS NOT NULL
   /* The activity fires first and the send follows it. */
   AND a.created_at <= coalesce(e.sent_at, e.created_at)
   AND a.created_at > coalesce(e.sent_at, e.created_at) - interval '120 seconds'
  /*
   * `source_entity_id` is GENERIC — it names whatever entity the activity was
   * about, which for other rows is a proposal or an invoice. Joining to
   * `scheduling_bookings` is what makes it a booking id rather than an id.
   *
   * Without this the update failed on a foreign key, which was the one good
   * outcome available — but the filter belongs here.
   */
  JOIN public.scheduling_bookings sb ON sb.id = a.source_entity_id
  WHERE e.booking_id IS NULL
    /* Only activities that actually cause a client email. A `booking` row is
       the creation that sends the confirmation. */
    AND a.activity_type IN (
      'booking', 'booking_confirmation_sent', 'booking_no_show',
      'booking_rescheduled', 'booking_cancelled'
    )
),
/*
 * ─────────────────────────────────────────────────────────────────────────────
 * NEAREST WINS, AND ONLY A TIE REFUSES.
 *
 * The first version refused whenever two bookings had activity in the window,
 * and that was too blunt: it rejected the original confirmation of ab48357a
 * because a DIFFERENT booking for the same contact had an activity 108 seconds
 * earlier. The cause of that mail was zero seconds away.
 *
 * A send follows its cause immediately — four seconds in every case measured
 * here — so the nearest activity is the cause. Two bookings at the SAME gap is
 * the only genuinely unanswerable case, and that still refuses.
 * ─────────────────────────────────────────────────────────────────────────────
 */
nearest AS (
  SELECT
    email_id,
    contact_id,
    went_out,
    min(gap_seconds) AS best_gap
  FROM candidates
  GROUP BY email_id, contact_id, went_out
)
SELECT
  n.email_id,
  n.contact_id,
  n.went_out,
  n.best_gap,
  min(c.booking_id::text)::uuid        AS booking_id,
  count(DISTINCT c.booking_id)         AS bookings_at_best_gap
FROM nearest n
JOIN candidates c
  ON c.email_id = n.email_id
 AND c.gap_seconds = n.best_gap
GROUP BY n.email_id, n.contact_id, n.went_out, n.best_gap;


-- ── 1. What would be linked, and what is refused ───────────────────────────
SELECT
  left(e.subject, 44)       AS subject,
  c.went_out,
  c.booking_id,
  c.best_gap,
  c.bookings_at_best_gap,
  CASE WHEN c.bookings_at_best_gap = 1 THEN 'link' ELSE 'REFUSED: tie' END AS verdict
FROM email_cause c
JOIN public.email_sends e ON e.id = c.email_id
ORDER BY c.went_out DESC
LIMIT 50;


-- ── 2. The link ─────────────────────────────────────────────────────────────
BEGIN;

UPDATE public.email_sends e
   SET booking_id = c.booking_id
  FROM email_cause c
 WHERE c.email_id = e.id
   AND c.bookings_at_best_gap = 1
   AND e.booking_id IS NULL;

/*
 * WHICH ATTEMPT is deliberately NOT decided here.
 *
 * `fix-email-attempt-attribution.sql` already works it out, and correctly: the
 * attempt current at send time, from the activity chain of `from` → `to` moves.
 * A second implementation of that in this file would be a near-copy that can
 * drift — and a first draft of it here was already wrong, picking the lowest
 * `occurrence_number` rather than the one that was current.
 *
 * So: run that script again after this one. It skips nothing and will now see
 * the newly linked rows.
 */

COMMIT;


-- ── 3. Confirm ──────────────────────────────────────────────────────────────
/* Nothing linked across bookings. Expect 0. */
SELECT count(*) AS cross_booking
  FROM public.email_sends e
  JOIN public.scheduling_meetings m ON m.id = e.meeting_id
 WHERE m.booking_id IS DISTINCT FROM e.booking_id;

/* What is still unlinked, and why — these had no causing activity at all. */
SELECT count(*) AS still_unlinked
  FROM public.email_sends
 WHERE booking_id IS NULL;

DROP VIEW email_cause;
