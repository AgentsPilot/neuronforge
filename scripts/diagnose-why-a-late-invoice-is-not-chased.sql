/*
 * Why is this late invoice not reaching the client?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ-ONLY. Writes nothing.
 *
 * The Money page and the chaser ask DIFFERENT questions, which is why one shows
 * a debt and the other sends nothing:
 *
 *   Money   (`isLateEntry`)        — outstanding, and past its due date. For
 *                                    ever. Nothing ages out of this list.
 *   Chaser  (`processOverdueItems`) — eight conditions, all of which must hold
 *                                    TODAY, and one of which can never hold
 *                                    again once it has passed.
 *
 * So "late on the Money page" is not a promise that anything is being sent.
 * This reproduces all eight gates in the order the service applies them and
 * reports the FIRST one each row fails, so a backlog becomes a handful of
 * reasons instead of a list of invoices.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE GATES, in `PaymentReminderService.processOverdueItems` order
 *
 *   1. status IN ('sent','overdue')   — a DRAFT is never scanned. Correct in
 *                                       itself (nobody has been asked to pay)
 *                                       but it sits in the same Money list.
 *   2. not paid, not refunded         — `paid_at`, `refunded_at`, `refund_status`
 *   3. due_date < tomorrow            — the scan window
 *   4. the session has happened        — service-date invoices only
 *   5. days late > 0 on the business's own calendar
 *   6. the business's send window       — hourly cron, so this is a delay, never
 *                                        a permanent block
 *   7. chase_invoices_enabled          — the owner's consent. Absent = NO.
 *   8. days_late IS EXACTLY a milestone — not "past", EQUAL. This is the one
 *                                        that never comes back.
 *
 * Gate 8 is the structural one: `chaserCanStillReach` says it plainly — "an
 * invoice already past the last milestone can never be chased again, not today,
 * not ever". With the usual `{1,3,7}`, anything 8+ days late is finished with,
 * and a backlog is made almost entirely of those.
 * ─────────────────────────────────────────────────────────────────────────────
 */

WITH prof AS (
  SELECT
    user_id,
    COALESCE(chase_invoices_enabled, false) AS chasing_on,
    /* `payment_overdue_reminder_days` where set, else the service default. An
       empty array counts as unset, exactly as `overdueMilestones` has it. */
    CASE
      WHEN payment_overdue_reminder_days IS NULL
        OR array_length(payment_overdue_reminder_days, 1) IS NULL
      THEN ARRAY[3, 7, 14]
      ELSE payment_overdue_reminder_days
    END AS milestones
  FROM public.business_profiles
),
zone AS (
  /* `user_preferences` is the authority; `business_profiles.timezone` does not
     exist (CLAUDE.md § Currency & Timezone). */
  SELECT user_id, COALESCE(timezone, 'UTC') AS tz
  FROM public.user_preferences
),
late AS (
  SELECT
    i.id,
    i.invoice_number,
    i.user_id,
    i.status,
    i.amount,
    i.currency,
    i.due_date,
    i.contact_id,
    i.booking_id,
    i.payment_terms,
    p.chasing_on,
    p.milestones,
    /* Whole days past due on the business's OWN calendar — the same arithmetic
       as `overdueCalendarDays`, which exists because a date-only column
       compared against a UTC instant chases a day early west of UTC. */
    (date(timezone(COALESCE(z.tz, 'UTC'), now())) - i.due_date) AS days_late,
    /* Gate 4: an invoice due on the service date, whose session is still ahead,
       is deliberately left alone — the bill does not move when the client
       reschedules, so chasing it would be for a session that has not happened. */
    (
      i.booking_id IS NOT NULL
      AND i.payment_terms = 'Due on service date'
      AND EXISTS (
        SELECT 1 FROM public.scheduling_meetings AS m
         WHERE m.booking_id = i.booking_id
           AND m.start_time > now()
           AND (m.meeting_status IS NULL OR m.meeting_status IN ('held', 'no_show'))
      )
    ) AS waits_for_its_session,
    (SELECT COUNT(*) FROM public.payment_reminders AS r WHERE r.invoice_id = i.id) AS reminders_ever,
    (SELECT MAX(r.sent_at) FROM public.payment_reminders AS r WHERE r.invoice_id = i.id) AS last_sent_at
  FROM public.payment_invoices AS i
  LEFT JOIN prof AS p ON p.user_id = i.user_id
  LEFT JOIN zone AS z ON z.user_id = i.user_id
  WHERE i.due_date IS NOT NULL
    /* Outstanding, by the money module's rule rather than the status alone. */
    AND i.paid_at IS NULL
    AND i.refunded_at IS NULL
    AND (i.refund_status IS NULL OR i.refund_status = 'none')
    AND i.status NOT IN ('paid', 'cancelled', 'void', 'written_off')
    AND i.due_date < date(timezone(COALESCE(z.tz, 'UTC'), now()))
),
verdict AS (
  SELECT
    late.*,
    CASE
      WHEN status NOT IN ('sent', 'overdue')
        THEN '1. never scanned — status is ' || status
      WHEN contact_id IS NULL
        THEN '2. no client on the invoice, nobody to write to'
      WHEN waits_for_its_session
        THEN '3. held back: its session has not happened yet'
      WHEN NOT chasing_on
        THEN '4. chasing is SWITCHED OFF for this business'
      WHEN days_late > milestones[array_length(milestones, 1)]
        THEN '5. past the last milestone (day '
             || milestones[array_length(milestones, 1)]
             || ') — the chaser can never reach it again'
      WHEN days_late = ANY (milestones)
        THEN '6. due a reminder TODAY — if nothing arrives, the send is failing'
      ELSE '7. between milestones, waiting for day '
           || (SELECT MIN(m) FROM unnest(milestones) AS m WHERE m > days_late)
    END AS why_the_client_hears_nothing
  FROM late
)

-- ─── A. The answer, in a few rows ────────────────────────────────────────────

SELECT
  why_the_client_hears_nothing,
  COUNT(*)                        AS invoices,
  COUNT(DISTINCT user_id)         AS businesses,
  SUM(amount)                     AS total,
  /* Never sum across currencies — CLAUDE.md. Grouped, so each row is one. */
  string_agg(DISTINCT currency, ', ') AS currencies,
  MIN(days_late)                  AS least_late,
  MAX(days_late)                  AS most_late,
  SUM(CASE WHEN reminders_ever = 0 THEN 1 ELSE 0 END) AS never_reminded_once
FROM verdict
GROUP BY 1
ORDER BY invoices DESC;

-- ─── B. The rows themselves, worst first ─────────────────────────────────────

SELECT
  invoice_number,
  status,
  amount,
  currency,
  due_date,
  days_late,
  chasing_on,
  milestones,
  reminders_ever,
  last_sent_at,
  why_the_client_hears_nothing,
  id
FROM verdict
ORDER BY days_late DESC, amount DESC
LIMIT 200;

-- ─── C. Money the chaser cannot see AT ALL ───────────────────────────────────

/*
 * The Money page reads five tables; the chaser reads two. These are the rows on
 * that page with no payable document behind them, so there is nothing to chase
 * even in principle — a different problem from the gates above, and the one
 * worth knowing about if the list looks longer than section A explains.
 */

SELECT
  'booking with no invoice raised' AS kind,
  COUNT(*)                        AS rows_found,
  COUNT(DISTINCT b.user_id)       AS businesses
FROM public.scheduling_bookings AS b
WHERE b.payment_status IS DISTINCT FROM 'paid'
  AND b.status IN ('confirmed', 'pending', 'completed')
  AND NOT EXISTS (
    SELECT 1 FROM public.payment_invoices AS i WHERE i.booking_id = b.id
  )

UNION ALL

SELECT
  'invoice never raised at Stripe (card impossible)' AS kind,
  COUNT(*),
  COUNT(DISTINCT user_id)
FROM public.payment_invoices
WHERE status IN ('sent', 'overdue')
  AND paid_at IS NULL
  AND stripe_invoice_id IS NULL;
