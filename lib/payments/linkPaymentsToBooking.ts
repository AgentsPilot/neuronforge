/**
 * Join the money to the booking, once the booking finally exists.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A SEPARATE STEP AT ALL
 *
 * A booking is written only after the client has paid — see
 * `noBookingUntilTheClientFinishes.guard.test.ts` for why — so the charge, the
 * subscription and every instalment are created a minute earlier, when there is
 * genuinely no booking id to store. They are correct rows; nothing joins them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE JOIN IS STRIPE'S METADATA, AND ONLY THAT
 *
 * `payment-intent` and `checkout` put the attempt id in the Stripe object's
 * metadata when they create it, and Stripe's Search API matches on exactly
 * that. So "what did this attempt pay for" has a deterministic answer, from the
 * system that actually took the money.
 *
 * Mirroring the attempt onto our own rows as well was built and then removed.
 * It only works if the WEBHOOK copies it across, and the webhook is the part
 * that can be late, deduped or dropped — the very failure this exists to
 * survive. A second mechanism that breaks exactly when the first one does is
 * not redundancy, it is more code to maintain.
 *
 * NOTHING IS INFERRED. The query is an equality match on this attempt's own id,
 * so a hit IS this client's money. No time windows, no amount matching: a guess
 * here attaches one client's payment to another's booking.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO CALLERS, AND BOTH ARE REQUIRED
 *
 *   `website/booking/finalize`  the client came back from Stripe
 *   `materialiseAttempt`        the client closed the tab and the webhook
 *                               created the booking instead
 *
 * Which one wins is a race. Linking from only one would orphan the other's
 * bookings, and the one skipped would be the closed-tab case nobody watches.
 *
 * IDEMPOTENT: every write is `.is('booking_id', null)`, so a row already linked
 * is never moved and a second call changes nothing. NEVER THROWS: the client
 * has paid and the booking is real, so a missing join is a reporting problem,
 * not a reason to fail the caller. `booking-money-reconcile` retries it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { resolveUserConnectAccounts } from './stripeAccountContext';

const logger = createLogger({ module: 'LinkPaymentsToBooking' });

export interface LinkPaymentsInput {
  /** The attempt, which is what Stripe's metadata names. */
  attemptId: string;
  bookingId: string;
  /** Stamped alongside, because the insight layer groups money by client. */
  contactId: string | null;
  userId: string;
}

export interface LinkPaymentsResult {
  transactions: number;
  subscriptions: number;
  installments: number;
  /** The plan the booking now belongs to, when the sale was an instalment one. */
  planId: string | null;
}

const NOTHING: LinkPaymentsResult = {
  transactions: 0,
  subscriptions: 0,
  installments: 0,
  planId: null,
};

/** What Stripe holds for this attempt, if anything. */
async function findInStripe(
  attemptId: string,
  userId: string
): Promise<{ kind: 'subscription' | 'payment_intent'; id: string } | null> {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return null;

  const accounts = await resolveUserConnectAccounts(supabaseServer, userId);
  if (!accounts.length) return null;

  const query = encodeURIComponent(`metadata['attempt_id']:'${attemptId}'`);

  for (const account of accounts) {
    for (const resource of ['subscriptions', 'payment_intents'] as const) {
      try {
        const response = await fetch(
          `https://api.stripe.com/v1/${resource}/search?query=${query}`,
          { headers: { Authorization: `Bearer ${secret}`, 'Stripe-Account': account.accountId } }
        );

        const body = (await response.json()) as { data?: Array<{ id: string }> };
        const id = body.data?.[0]?.id;

        if (id) {
          return { kind: resource === 'subscriptions' ? 'subscription' : 'payment_intent', id };
        }
      } catch (err) {
        /* One account or resource failing must not stop the others. */
        logger.warn({ err, attemptId, resource }, 'Stripe search failed; trying the next source');
      }
    }
  }

  return null;
}

/**
 * The local row for a subscription Stripe has already confirmed, waiting a
 * moment for the webhook to write it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY WAIT AT ALL
 *
 * Both halves of this race land within the same second. Observed live: the
 * booking was created at 16:30:18 and the subscription row written at 16:30:18
 * — so `finalize` looked for a row that did not exist yet, the webhook looked
 * for a booking that did not exist yet, and each correctly did nothing. No
 * ordering fixes that; one of them has to wait.
 *
 * It waits only when STRIPE HAS ALREADY CONFIRMED the subscription, so this is
 * never a hopeful poll for something that may not be coming — it is a short
 * pause for a write we know is in flight. Three seconds at the outside, on a
 * request that has just spent longer than that talking to Stripe.
 *
 * Giving up is not a failure: the webhook links from its own side once the
 * booking exists, and `booking-money-reconcile` is behind both.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function waitForLocalSubscription(
  stripeSubscriptionId: string,
  userId: string
): Promise<{ id: string } | null> {
  const ATTEMPTS = 6;
  const GAP_MS = 500;

  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const { data } = await supabaseServer
      .from('payment_plan_subscriptions')
      .select('id')
      .eq('user_id', userId)
      .eq('stripe_subscription_id', stripeSubscriptionId)
      .maybeSingle();

    if (data?.id) return data as { id: string };

    if (attempt < ATTEMPTS - 1) {
      await new Promise(resolve => setTimeout(resolve, GAP_MS));
    }
  }

  return null;
}

export async function linkPaymentsToBooking(
  input: LinkPaymentsInput
): Promise<LinkPaymentsResult> {
  const { attemptId, bookingId, contactId, userId } = input;

  if (!attemptId || !bookingId) return NOTHING;

  try {
    const found = await findInStripe(attemptId, userId);
    if (!found) return NOTHING;

    const stamp = { booking_id: bookingId, contact_id: contactId };

    /* A one-off card payment: one charge, nothing else to attach. */
    if (found.kind === 'payment_intent') {
      const charge = await supabaseServer
        .from('payment_transactions')
        .update(stamp)
        .eq('user_id', userId)
        .eq('stripe_payment_intent_id', found.id)
        .is('booking_id', null)
        .select('id');

      const result = { ...NOTHING, transactions: charge.data?.length ?? 0 };

      if (result.transactions) {
        logger.info({ attemptId, bookingId, ...result }, 'Linked the payment to its booking');
      }

      return result;
    }

    /*
     * An instalment sale. The local subscription row is found by the Stripe id
     * the webhook recorded, and everything else hangs off it.
     */
    const subscription = await waitForLocalSubscription(found.id, userId);

    if (!subscription?.id) return NOTHING;

    const [subs, stages] = await Promise.all([
      supabaseServer
        .from('payment_plan_subscriptions')
        .update(stamp)
        .eq('user_id', userId)
        .eq('id', subscription.id)
        .is('booking_id', null)
        .select('id'),
      supabaseServer
        .from('payment_plan_installments')
        .update(stamp)
        .eq('user_id', userId)
        .eq('subscription_id', subscription.id)
        .is('booking_id', null)
        .select('id, payment_plan_id, transaction_id'),
    ]);

    /*
     * ── AND THE BOOKING LEARNS IT HAS A PLAN ────────────────────────────────
     *
     * `scheduling_bookings.payment_plan_id` is what the card reads to know this
     * is an instalment sale rather than a single payment. Without it a booking
     * whose periods are perfectly linked still renders as one payment, and the
     * second period is invisible.
     */
    const planId =
      (stages.data ?? []).map(row => row.payment_plan_id as string | null).find(Boolean) ?? null;

    if (planId) {
      await supabaseServer
        .from('scheduling_bookings')
        .update({ payment_plan_id: planId })
        .eq('id', bookingId)
        .eq('user_id', userId)
        .is('payment_plan_id', null);
    }

    /* The charges those periods recorded, so the money list agrees too. */
    const chargeIds = (stages.data ?? [])
      .map(row => row.transaction_id as string | null)
      .filter((id): id is string => Boolean(id));

    const charges = chargeIds.length
      ? await supabaseServer
          .from('payment_transactions')
          .update(stamp)
          .eq('user_id', userId)
          .in('id', chargeIds)
          .is('booking_id', null)
          .select('id')
      : { data: [] as Array<{ id: string }> };

    const result: LinkPaymentsResult = {
      transactions: charges.data?.length ?? 0,
      subscriptions: subs.data?.length ?? 0,
      installments: stages.data?.length ?? 0,
      planId,
    };

    if (result.subscriptions + result.installments + result.transactions > 0) {
      logger.info({ attemptId, bookingId, ...result }, 'Linked the money to its booking');
    }

    return result;
  } catch (err) {
    logger.error(
      { err, attemptId, bookingId },
      'Linking the money to its booking threw; the reconcile pass will retry'
    );
    return NOTHING;
  }
}
