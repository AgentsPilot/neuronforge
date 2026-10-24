/*
 * Somebody who tried to book and did not finish.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The public booking route wrote the `scheduling_bookings` row when the client
 * SUBMITTED THEIR DETAILS, before they had paid. A client who opened the card
 * dialog and closed it left a booking behind — and because `pending` is in
 * `SLOT_HOLDING_STATUSES` and `scheduling_bookings_no_overlap` covers it, that
 * slot was locked against every other client. Permanently: no cron touches
 * `scheduling_bookings`, and `checkout.session.expired` is handled only for the
 * platform's own billing.
 *
 * The rule now is: a booking exists only when the client finishes, end to end.
 * So the details they typed on the way need somewhere else to live, and this is
 * it. It gives the owner the one thing they could not have before — the list of
 * people who nearly booked.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT HOLDS NOTHING
 *
 * No slot, no contact, no money. `start_time` is recorded so the owner can say
 * "you were looking at Tuesday at ten", and for no other reason: nothing reads
 * this table when deciding whether a slot is free.
 *
 * There is deliberately no exclusion constraint and no unique index on the
 * time range. Several people may be attempting the same slot at once; at most
 * one of them will finish, and `scheduling_bookings_no_overlap` is what makes
 * that true.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NOT AN EXISTING TABLE
 *
 *   `scheduling_bookings` — then it IS a booking, which is the bug. And 132
 *   read sites across 57 files select from it: the calendar, the CRM drawer,
 *   dashboard counts, the orders page, reports, exports, insight detectors,
 *   chasers. A new status there needs every one of them to learn to ignore it.
 *   The same shape failed at four call sites on 2026-10-15; at 57 files it is
 *   not a risk, it is a certainty.
 *
 *   `crm_contacts` — where the public contact form writes today, and the reason
 *   a bot submitting the form becomes a row in the owner's pipeline. An
 *   abandoned attempt must not reach the CRM at all.
 *
 * Nothing reads this table except the owner's abandoned list, so nothing else
 * has to know it exists. Dropping it would lose the list and break nothing.
 * ─────────────────────────────────────────────────────────────────────────────
 */

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.abandoned_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  /* The business. Every read is scoped by this. */
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  service_id uuid REFERENCES public.scheduling_services(id) ON DELETE SET NULL,

  /*
   * What the client typed — NOT a `crm_contacts` row.
   *
   * The contact is created when they finish, so an abandoned attempt, or a bot
   * submitting the form a thousand times, never reaches the CRM, the pipeline,
   * the counts or any email sequence. The owner can promote one deliberately
   * from the abandoned list.
   */
  first_name text,
  last_name text,
  email text,
  phone text,

  /* What they were looking at. Recorded to show, never to block. Null for a
     product or any service with no slot. */
  start_time timestamptz,
  end_time timestamptz,
  timezone text,

  /*
   * WHERE THEY CAME FROM.
   *
   * A booking carries `booking_source`, and a smart link or landing page is
   * told apart from an ordinary visit by the `session_id` that travels with the
   * click — the same id `markConversion` matches a conversion on.
   *
   * Carried here because an abandoned attempt is the half of that story the
   * platform has never seen: conversions only count the people who finished, so
   * a campaign that drives traffic which does not convert looks identical to
   * one that drives no traffic at all.
   */
  source text,
  session_id text,

  /*
   * started   — details given, sent to pay, outcome not yet known
   * converted — they finished; `booking_id` is what resulted
   * abandoned — the payment window closed with no booking
   *
   * `started` and `abandoned` differ only in whether anything is still expected
   * to happen. Both appear in the list; only `abandoned` is worth chasing.
   */
  status text NOT NULL DEFAULT 'started'
    CHECK (status IN ('started', 'converted', 'abandoned')),

  booking_id uuid REFERENCES public.scheduling_bookings(id) ON DELETE SET NULL,

  /* The Stripe checkout session, so the outcome can be matched to the attempt
     without trusting anything the browser says. */
  checkout_session_id text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

/* The owner's list: their rows, newest first. */
CREATE INDEX IF NOT EXISTS abandoned_bookings_user_created_idx
  ON public.abandoned_bookings (user_id, created_at DESC);

/* Matching a Stripe session back to its attempt. Partial, because most rows
   have no session id and only those are ever looked up this way. */
CREATE INDEX IF NOT EXISTS abandoned_bookings_session_idx
  ON public.abandoned_bookings (checkout_session_id)
  WHERE checkout_session_id IS NOT NULL;

/* Sweeping the ones whose window has closed. */
CREATE INDEX IF NOT EXISTS abandoned_bookings_open_idx
  ON public.abandoned_bookings (status, created_at)
  WHERE status = 'started';

ALTER TABLE public.abandoned_bookings ENABLE ROW LEVEL SECURITY;

/*
 * Owners read their own. Nobody writes through RLS.
 *
 * The writes come from the public booking route, which runs as the service role
 * because the client is anonymous — there is no session to scope by. So there
 * is deliberately no INSERT or UPDATE policy: a client holding the anon key
 * cannot write rows here, and the route's own `user_id` scoping is what keeps
 * one business's attempts out of another's.
 */
DROP POLICY IF EXISTS abandoned_bookings_owner_select ON public.abandoned_bookings;
CREATE POLICY abandoned_bookings_owner_select
  ON public.abandoned_bookings
  FOR SELECT
  USING (auth.uid() = user_id);

COMMENT ON TABLE public.abandoned_bookings IS
  'Somebody who gave their details on a booking page and did not finish. NOT a booking and NOT a slot hold: nothing here blocks availability, and no contact is created unless the attempt converts. The owner''s abandoned-booking list reads this, and only this.';

COMMIT;
