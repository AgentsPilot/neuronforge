/*
 * PRECHECK — read-only. Run this BEFORE 20261111_a_no_show_keeps_its_hour.sql.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT COULD REFUSE THE MIGRATION
 *
 * A no-show hour has been readable as FREE for as long as the column has
 * existed. So an hour could legitimately have been sold twice: the client
 * missed it, the hour went back on sale, and somebody else took it. Both rows
 * are real and both are correct under the rule in force when they were written.
 *
 * Widening the two exclusion constraints to cover `no_show` makes those pairs
 * illegal. Postgres validates an EXCLUDE constraint against existing rows, so
 * one such pair refuses the whole migration with 23P01 — inside a transaction,
 * so nothing is half-applied, but nothing is applied either.
 *
 * This script finds them first. It writes nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW TO READ THE RESULT
 *
 *   · every count zero  → apply the migration, it will be accepted.
 *
 *   · section 1 or 2 returns rows → each is one business, one hour, and two
 *     meetings that both claim it. Decide per pair BEFORE applying, and expect
 *     the honest answer to be the same one nearly every time: the no-show is
 *     history and the live appointment owns the hour, so the pair is resolved
 *     by nudging the historical row's span, never by deleting it — the money
 *     hangs on that row (`makeUpSession.ts`). Do not resolve it by marking
 *     the live meeting anything: that would free an hour a client is expecting.
 *
 * Section 3 is context, not a blocker: how many hours change hands at all.
 * ─────────────────────────────────────────────────────────────────────────────
 */

-- ─── 0. THE SHAPE OF THE CONFLICTS — read this one first ─────────────────────

/*
 * 33 meeting pairs and 2 booking pairs refused the migration on the live
 * database. Thirty-three rows tell you nothing; their SHAPE tells you
 * everything, and there are only a few shapes it can be.
 *
 * What each column answers:
 *
 *   relationship      SAME BOOKING means two attempts at one job sharing an
 *                     hour — a reschedule or a make-up that landed back on the
 *                     time it replaced. Our own write path produced it, and the
 *                     resolution is a code question, not a client one.
 *                     DIFFERENT BOOKINGS means two jobs: either the hour was
 *                     honestly resold after the no-show, or two clients were
 *                     given the same time.
 *
 *   lineage           Whether one row says it REPLACES the other
 *                     (`replaces_meeting_id`). A make-up pointing at the hour
 *                     it stands in for is the designed shape, and a make-up
 *                     booked AT that same hour is the bug it hides.
 *
 *   span              IDENTICAL spans are almost always one appointment
 *                     recorded twice. A PARTIAL overlap is two real
 *                     appointments that collide.
 *
 *   whenever          PAST changes nothing anybody can book; it is a question
 *                     about the record. FUTURE is a live double-booking and
 *                     somebody is going to turn up to it.
 *
 * Pairs are counted in both directions where both rows are no-shows, so a
 * no_show/no_show pair appears twice here and in section 1. That is why the
 * migration's count can exceed the number of distinct clashes.
 */

SELECT
  CASE WHEN a.booking_id = b.booking_id
       THEN 'same booking' ELSE 'different bookings' END          AS relationship,
  CASE WHEN b.replaces_meeting_id = a.id THEN 'b replaces a'
       WHEN a.replaces_meeting_id = b.id THEN 'a replaces b'
       ELSE 'no lineage' END                                      AS lineage,
  CASE WHEN a.start_time = b.start_time AND a.end_time = b.end_time
       THEN 'identical' ELSE 'partial' END                        AS span,
  COALESCE(b.meeting_status, 'unmarked')                          AS the_other_row,
  CASE WHEN a.end_time < now() THEN 'past' ELSE 'future' END      AS whenever,
  COUNT(*)                                                        AS pairs,
  COUNT(DISTINCT a.user_id)                                       AS businesses,
  MIN(a.start_time)                                               AS earliest,
  MAX(a.start_time)                                               AS latest
FROM public.scheduling_meetings AS a
JOIN public.scheduling_meetings AS b
  ON b.user_id = a.user_id
 AND b.id <> a.id
 AND tstzrange(b.start_time, b.end_time) && tstzrange(a.start_time, a.end_time)
WHERE a.meeting_status = 'no_show'
  AND (b.meeting_status IS NULL OR b.meeting_status IN ('held', 'no_show'))
GROUP BY 1, 2, 3, 4, 5
ORDER BY pairs DESC;

-- ─── 1. Meetings: a no-show sharing an hour with a meeting that holds it ─────

SELECT
  'meetings' AS table_name,
  a.user_id,
  a.id            AS no_show_meeting_id,
  a.booking_id    AS no_show_booking_id,
  a.start_time    AS no_show_start,
  a.end_time      AS no_show_end,
  b.id            AS other_meeting_id,
  b.booking_id    AS other_booking_id,
  b.meeting_status AS other_status,
  b.start_time    AS other_start,
  b.end_time      AS other_end
FROM public.scheduling_meetings AS a
JOIN public.scheduling_meetings AS b
  ON b.user_id = a.user_id
 AND b.id <> a.id
 AND tstzrange(b.start_time, b.end_time) && tstzrange(a.start_time, a.end_time)
WHERE a.meeting_status = 'no_show'
  /* What the constraint will hold, once this lands. `a` is the new member of
     that set, so a pair of two no-shows counts too. */
  AND (b.meeting_status IS NULL OR b.meeting_status IN ('held', 'no_show'))
ORDER BY a.user_id, a.start_time;

-- ─── 2. Bookings: the same question on the mirror ────────────────────────────

SELECT
  'bookings' AS table_name,
  a.user_id,
  a.id         AS no_show_booking_id,
  a.start_time AS no_show_start,
  a.end_time   AS no_show_end,
  b.id         AS other_booking_id,
  b.status     AS other_job_status,
  b.meeting_status AS other_meeting_status,
  b.start_time AS other_start,
  b.end_time   AS other_end
FROM public.scheduling_bookings AS a
JOIN public.scheduling_bookings AS b
  ON b.user_id = a.user_id
 AND b.id <> a.id
 AND tstzrange(b.start_time, b.end_time) && tstzrange(a.start_time, a.end_time)
WHERE a.meeting_status = 'no_show'
  AND a.status IN ('confirmed', 'pending', 'completed')
  AND a.start_time IS NOT NULL
  AND a.end_time IS NOT NULL
  AND a.end_time > a.start_time
  AND b.status IN ('confirmed', 'pending', 'completed')
  AND (b.meeting_status IS NULL OR b.meeting_status IN ('held', 'no_show'))
  AND b.start_time IS NOT NULL
  AND b.end_time IS NOT NULL
  AND b.end_time > b.start_time
ORDER BY a.user_id, a.start_time;

-- ─── 3. Scale: how many hours stop being offered ─────────────────────────────

/*
 * Split by past and future, because they mean different things. A PAST no-show
 * changes nothing anybody can book — the hour has gone either way — and is
 * only about what the calendar and the reports say happened. A FUTURE one is a
 * real hour withdrawn from sale, and is the case `syncMeeting` warns about:
 * until now it read as free and could be sold to a second client.
 */
SELECT
  COUNT(*) FILTER (WHERE end_time < now())  AS no_show_hours_in_the_past,
  COUNT(*) FILTER (WHERE end_time >= now()) AS no_show_hours_still_to_come,
  COUNT(DISTINCT user_id)                   AS businesses_affected
FROM public.scheduling_meetings
WHERE meeting_status = 'no_show';
