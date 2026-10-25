/**
 * Recover client money that a missed or stuck webhook left unattached.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A RECONCILE PASS, AND NOT ANOTHER FALLBACK ON THE HAPPY PATH
 *
 * A booking exists only once the client has paid, so every money row is written
 * before there is a booking to name. Three separate things then have to go right
 * for the join to happen at all: the checkout has to put the attempt in Stripe's
 * metadata, the webhook has to run its binding branch, and the browser has to
 * come back so `finalize` can link them.
 *
 * None of those is a guarantee. A webhook can arrive twice and be deduped, a
 * delivery can be dropped or delayed past the redirect, a process can die
 * between claiming an event and finishing it, and a client can close the tab.
 * Each one leaves a client charged with nothing on screen, silently.
 *
 * Bolting a fallback onto `finalize` only moves the single point of failure. The
 * answer every mature payment integration lands on is a reconciler: Stripe is
 * the source of truth, the local rows are a projection, and a scheduled pass
 * repairs the projection. `boostReconcilePass` is the same idea for the
 * platform's own billing; this is it for clients' money.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT REPAIRS
 *
 * Attempts that converted — so a booking certainly exists — whose money is not
 * attached to it. Each is handed to `linkPaymentsToBooking`, the same function
 * the happy path uses, so there is one definition of what linking means and the
 * retry cannot drift from the original.
 *
 * IDEMPOTENT. Every write is `.is('booking_id', null)`, so a row already linked
 * is never moved and a second pass changes nothing. Two overlapping runs — the
 * cron and a manual trigger — cannot corrupt each other.
 *
 * BOUNDED. Oldest first, a fixed batch, so one bad day cannot turn into a run
 * that never finishes.
 *
 * NEVER THROWS per attempt: one unrepairable row must not stop the rest.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { linkPaymentsToBooking } from './linkPaymentsToBooking';

const logger = createLogger({ module: 'ReconcileBookingMoney' });

/** How many attempts one pass will look at. */
const BATCH = 50;

/**
 * How long to let the ordinary path finish before calling a row stuck.
 *
 * Long enough that a slow webhook or a client who took a minute to land on the
 * success page is not reported as a failure, short enough that an owner is not
 * looking at a blank card for an afternoon.
 */
const GRACE_MINUTES = 10;

/** Stop looking after this; anything older is a backlog, not an incident. */
const WINDOW_HOURS = 72;

export interface ReconcileBookingMoneyResult {
  examined: number;
  repaired: number;
  /** Converted, past the grace period, and still with nothing attached. */
  unresolved: string[];
}

export async function reconcileBookingMoney(): Promise<ReconcileBookingMoneyResult> {
  const now = Date.now();
  const until = new Date(now - GRACE_MINUTES * 60_000).toISOString();
  const from = new Date(now - WINDOW_HOURS * 3_600_000).toISOString();

  const { data: attempts, error } = await supabaseServer
    .from('abandoned_bookings')
    .select('id, user_id, booking_id, updated_at')
    .eq('status', 'converted')
    .not('booking_id', 'is', null)
    .gte('updated_at', from)
    .lte('updated_at', until)
    .order('updated_at', { ascending: true })
    .limit(BATCH);

  if (error) {
    logger.error({ err: error }, 'Could not read the attempts to reconcile');
    return { examined: 0, repaired: 0, unresolved: [] };
  }

  const result: ReconcileBookingMoneyResult = { examined: 0, repaired: 0, unresolved: [] };

  for (const attempt of attempts ?? []) {
    const bookingId = attempt.booking_id as string;
    const userId = attempt.user_id as string;

    try {
      /*
       * Is anything actually loose? A booking whose money is already attached is
       * the overwhelming majority, and must cost one cheap read, not a repair.
       */
      const { count: attached } = await supabaseServer
        .from('payment_plan_installments')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('booking_id', bookingId);

      const { count: charges } = await supabaseServer
        .from('payment_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('booking_id', bookingId);

      if ((attached ?? 0) > 0 || (charges ?? 0) > 0) continue;

      result.examined += 1;

      /* The contact to stamp alongside, read off the booking it belongs to. */
      const { data: booking } = await supabaseServer
        .from('scheduling_bookings')
        .select('contact_id, payment_status')
        .eq('id', bookingId)
        .eq('user_id', userId)
        .maybeSingle();

      /*
       * Nothing was ever owed on this booking, so nothing can be loose. A free
       * service converts through the same attempt flow and must not be reported
       * as a failed join for ever.
       */
      if (!booking || booking.payment_status === 'free') continue;

      const linked = await linkPaymentsToBooking({
        attemptId: attempt.id as string,
        bookingId,
        contactId: (booking.contact_id as string | null) ?? null,
        userId,
      });

      const total = linked.transactions + linked.subscriptions + linked.installments;

      if (total > 0) {
        result.repaired += 1;
        logger.info(
          { attemptId: attempt.id, bookingId, ...linked },
          'Reconciled money that the webhook left unattached'
        );
        continue;
      }

      /*
       * Stripe has nothing naming this attempt. Either the money genuinely
       * never arrived — which `payment_status` would contradict — or it was
       * taken before the attempt was ever put in its metadata, which no amount
       * of searching can undo. Reported, never guessed at.
       */
      result.unresolved.push(String(attempt.id));
      logger.warn(
        { attemptId: attempt.id, bookingId, paymentStatus: booking.payment_status },
        'A converted booking has no money attached and Stripe has nothing naming its attempt'
      );
    } catch (err) {
      result.unresolved.push(String(attempt.id));
      logger.error({ err, attemptId: attempt.id, bookingId }, 'Reconciling this attempt threw');
    }
  }

  if (result.examined > 0) {
    logger.info(result, 'Booking money reconcile pass finished');
  }

  return result;
}
