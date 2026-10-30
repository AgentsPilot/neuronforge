/**
 * The record of somebody who tried to book and has not finished.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS FOR
 *
 * A booking exists only once the client completes the journey end to end.
 * Until then the details they typed live here, and here only — not as a
 * `pending` booking (which would lock the slot against everybody else, as it
 * did) and not as a `crm_contacts` row (which is how a bot submitting a form
 * becomes a row in the owner's pipeline).
 *
 * The row blocks nothing. No availability check reads this table. Several
 * people may be attempting the same slot; at most one will finish, and the
 * `scheduling_bookings_no_overlap` constraint is what makes that true.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A MODULE RATHER THAN THREE INLINE QUERIES
 *
 * `create` opens the attempt, `finalize` closes it, and a sweeper abandons the
 * ones that were never closed. Three callers writing the same three columns by
 * hand is how `status` and `booking_id` come to disagree about one attempt —
 * the shape of most of the bugs the booking routes have already learned from.
 *
 * Every function here fails SOFT. An attempt record is a convenience for the
 * owner; it is never a reason to refuse a client a booking or to fail a payment
 * that has already succeeded. Callers get `null` and carry on.
 *
 * @module lib/scheduling/abandonedBookings
 */

import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'AbandonedBookings' });

/** `started` until the client finishes or the window closes. */
export type AbandonedBookingStatus = 'started' | 'converted' | 'abandoned';

export interface OpenAttemptInput {
  userId: string;
  serviceId: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  /** Null for a product or any service with no slot. */
  startTime?: string | null;
  endTime?: string | null;
  timezone?: string | null;
  /** `booking_source`: website, chat, landing page, smart link. */
  source?: string | null;
  /** The click this came from, matched against smart-link conversions. */
  sessionId?: string | null;
  checkoutSessionId?: string | null;
  /**
   * The page they were on, for the rebook button in the recovery email.
   *
   * Stored rather than rebuilt from the service: a booking page can be reached
   * by subdomain, custom domain, landing page or smart link, and a
   * reconstructed link drops whichever of those brought them.
   */
  pageUrl?: string | null;
  /** The language the page was rendering in, so the email is written in it. */
  locale?: string | null;
}

/**
 * Record that somebody gave their details and was sent to pay.
 *
 * Returns the attempt id, or `null` if it could not be written. A null is not
 * an error the caller should act on: the client is mid-journey and a missing
 * record costs the owner one line in a list, where refusing the booking would
 * cost them the sale.
 */
export async function openAttempt(input: OpenAttemptInput): Promise<string | null> {
  try {
    const { data, error } = await supabaseServer
      .from('abandoned_bookings')
      .insert({
        user_id: input.userId,
        service_id: input.serviceId,
        first_name: input.firstName ?? null,
        last_name: input.lastName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        start_time: input.startTime ?? null,
        end_time: input.endTime ?? null,
        timezone: input.timezone ?? null,
        source: input.source ?? null,
        session_id: input.sessionId ?? null,
        checkout_session_id: input.checkoutSessionId ?? null,
        page_url: input.pageUrl ?? null,
        locale: input.locale ?? null,
        status: 'started',
      })
      .select('id')
      .single();

    if (error) throw error;

    return data?.id ?? null;
  } catch (err) {
    logger.warn({ err, userId: input.userId }, 'Could not record the booking attempt');
    return null;
  }
}

/**
 * The client finished. Point the attempt at the booking it became.
 *
 * Called AFTER the booking row exists, so a failure here leaves an attempt
 * reading `started` beside a real booking — a stale line in the owner's list,
 * which the sweeper then mislabels `abandoned`. That is the worst case and it
 * is cosmetic; the booking and the money are untouched.
 *
 * `attemptId` is optional so the caller does not have to branch: a journey that
 * never opened an attempt (the attempt insert failed, or this is a path that
 * does not use them) passes null and nothing happens.
 */
export async function convertAttempt(
  attemptId: string | null | undefined,
  bookingId: string
): Promise<void> {
  if (!attemptId) return;

  try {
    const { error } = await supabaseServer
      .from('abandoned_bookings')
      .update({
        status: 'converted',
        booking_id: bookingId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', attemptId);

    if (error) throw error;
  } catch (err) {
    logger.warn({ err, attemptId, bookingId }, 'Could not mark the booking attempt converted');
  }
}

/**
 * How long an attempt stays `started` before it counts as abandoned.
 *
 * Thirty minutes because that is Stripe's minimum checkout session expiry: once
 * the session is gone the client cannot complete, so anything still open past
 * it will never convert. Longer would leave the owner looking at a list of
 * people who might still be typing their card number.
 */
/**
 * Tie a Stripe Checkout session to the attempt that created it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONLY SIGNAL THAT SURVIVES A CLOSED TAB
 *
 * `checkout_session_id` has been on this table since 20261070 and nothing ever
 * wrote it, so the index over it was dead. It matters because the browser
 * coming back is not a reliable event: a client who pays and closes the tab
 * has been charged, and without this there is no way to find the attempt that
 * charge belongs to.
 *
 * The webhook carries the session id. With this written, it can find the
 * attempt and finish the booking the client walked away from.
 *
 * Fails soft, like the rest of this module: the client is mid-payment and a
 * missing cross-reference must not take the journey down with it.
 */
export async function attachCheckoutSession(
  attemptId: string,
  checkoutSessionId: string
): Promise<void> {
  try {
    const { error } = await supabaseServer
      .from('abandoned_bookings')
      .update({ checkout_session_id: checkoutSessionId, updated_at: new Date().toISOString() })
      .eq('id', attemptId)
      /* Never reopen a finished attempt. `converted` is terminal. */
      .eq('status', 'started');

    if (error) throw error;
  } catch (err) {
    logger.warn({ err, attemptId, checkoutSessionId }, 'Could not attach the checkout session to the attempt');
  }
}

export const ATTEMPT_WINDOW_MINUTES = 30;

/**
 * Close the attempts whose window has passed.
 *
 * Only `started` rows, and only those older than the window — a `converted` row
 * is finished and must never be rewritten, which is what the status filter is
 * for rather than a date test alone.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND IT CHECKS WHETHER THE BOOKING HAPPENED BEFORE CALLING IT ABANDONED.
 *
 * This used to be the `update` alone: anything still `started` past the window
 * became `abandoned`, on the reasoning that the Stripe session has expired by
 * then so the client cannot finish. That reasoning only covers the journey the
 * attempt belongs to. It does not cover the client finishing ANOTHER way.
 *
 * `convertAttempt` has two callers, both inside `materialiseAttempt` — the card
 * finalise and the webhook. A client who opens a card journey, gives up on it,
 * and then books the same slot through `website/booking/create` (pay later, an
 * invoice, a free service) completes through a path that never saw an attempt
 * id and so cannot convert one. The row stays `started`, and this function then
 * labelled it abandoned.
 *
 * Measured 2026-10-29: of 14 rows reading `abandoned`, EIGHT had a booking for
 * the same service and slot created inside the attempt's own 30-minute window —
 * the same journey finishing. Four more were booked later, which is a genuine
 * abandonment followed by a rebooking, and two never booked at all. So the
 * state was wrong for 8 of 14, every recovery email to those people chased
 * somebody who had already bought, and any count built on it reports lost
 * business that was never lost.
 *
 * Checked here rather than in each completion path because the paths are the
 * thing that keeps changing. A new way to finish a booking inherits this
 * automatically; it would have to remember to call `convertAttempt`.
 *
 * The ones that did complete are marked `converted` and pointed at their
 * booking, not merely skipped — a row left `started` for ever is the dead state
 * `theAttemptReachesAnEnding.guard` exists to prevent.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Returns how many were closed as abandoned, for the caller's log.
 */
export async function sweepAbandoned(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - ATTEMPT_WINDOW_MINUTES * 60 * 1000).toISOString();

  try {
    const { data: candidates, error: readError } = await supabaseServer
      .from('abandoned_bookings')
      .select('id, user_id, service_id, start_time, created_at')
      .eq('status', 'started')
      .lt('created_at', cutoff);

    if (readError) throw readError;
    if (!candidates?.length) return 0;

    const completed = await bookingsThatFinished(candidates);

    const abandonedIds = candidates.map(c => c.id).filter(id => !completed.has(id));

    if (completed.size > 0) {
      /*
       * Worth saying out loud: each one is a client who finished and would
       * otherwise have been chased by a recovery email for a booking they had
       * already made.
       */
      logger.warn(
        { count: completed.size },
        'Attempts completed through a path that never converted them; closing as converted'
      );

      for (const [attemptId, bookingId] of completed) {
        await convertAttempt(attemptId, bookingId);
      }
    }

    if (abandonedIds.length === 0) return 0;

    const { data, error } = await supabaseServer
      .from('abandoned_bookings')
      .update({ status: 'abandoned', updated_at: now.toISOString() })
      .in('id', abandonedIds)
      /* Still filtered, so a row converted between the read and here is safe. */
      .eq('status', 'started')
      .select('id');

    if (error) throw error;

    return data?.length ?? 0;
  } catch (err) {
    logger.error({ err }, 'Could not sweep abandoned booking attempts');
    return 0;
  }
}

/** One attempt as the sweeper reads it. */
interface SweepCandidate {
  id: string;
  user_id: string;
  service_id: string | null;
  start_time: string | null;
  created_at: string;
}

/**
 * Which of these attempts already have the booking they were trying to make.
 *
 * Matched on business, service and slot, and only when the booking was created
 * inside the attempt's own window. The window is what separates the two cases
 * that otherwise look identical: a booking in it is this journey finishing by
 * another route, while one an hour later is a client who gave up and came back
 * — genuinely abandoned, and correctly swept.
 *
 * One read per business rather than one per attempt: a sweep handles every
 * tenant's rows at once, and this is a cron.
 */
async function bookingsThatFinished(
  candidates: SweepCandidate[]
): Promise<Map<string, string>> {
  const finished = new Map<string, string>();
  const byOwner = new Map<string, SweepCandidate[]>();

  for (const candidate of candidates) {
    if (!candidate.service_id) continue;
    const held = byOwner.get(candidate.user_id);
    if (held) held.push(candidate);
    else byOwner.set(candidate.user_id, [candidate]);
  }

  for (const [userId, owned] of byOwner) {
    const earliest = owned.reduce(
      (oldest, c) => (c.created_at < oldest ? c.created_at : oldest),
      owned[0].created_at
    );

    const { data: bookings, error } = await supabaseServer
      .from('scheduling_bookings')
      .select('id, service_id, start_time, created_at')
      .eq('user_id', userId)
      .gte('created_at', earliest);

    if (error) {
      /* Soft: an unreadable half means these are swept as before, which is the
         behaviour this replaced rather than something worse. */
      logger.error({ err: error, userId }, 'Could not check whether attempts completed');
      continue;
    }

    for (const candidate of owned) {
      const opened = new Date(candidate.created_at).getTime();
      const closes = opened + ATTEMPT_WINDOW_MINUTES * 60 * 1000;

      const match = (bookings ?? []).find(booking => {
        if (booking.service_id !== candidate.service_id) return false;
        /* A slotless service is sold rather than booked; the slot cannot
           disambiguate, so the service and the window have to. */
        if (candidate.start_time && booking.start_time !== candidate.start_time) return false;
        const made = new Date(booking.created_at as string).getTime();
        return made >= opened - 60_000 && made <= closes;
      });

      if (match) finished.set(candidate.id, match.id as string);
    }
  }

  return finished;
}
