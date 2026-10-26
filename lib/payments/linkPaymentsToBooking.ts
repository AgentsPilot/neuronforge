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
  /**
   * The payment intent the client's browser returned with, when the caller has
   * one. A second LOCAL key for the sale — see `findLocalByPaymentIntent`.
   * Optional: the booking widget sends only an attempt, and a plan's later
   * periods have no browser behind them at all.
   */
  paymentIntentId?: string | null;
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

/**
 * The plan this attempt sold, from our own rows.
 *
 * Returns the same shape `findInStripe` does, so the caller cannot tell which
 * source answered and the subscription branch below is reached either way.
 *
 * Scoped by `user_id` as well as the attempt: the service role bypasses RLS,
 * and an attempt id arriving from the wrong tenant must find nothing rather
 * than another business's plan.
 */
async function findLocalSubscription(
  attemptId: string,
  userId: string
): Promise<{ kind: 'subscription'; id: string } | null> {
  const { data } = await supabaseServer
    .from('payment_plan_subscriptions')
    .select('stripe_subscription_id')
    .eq('user_id', userId)
    .eq('metadata->>attempt_id', attemptId)
    .not('stripe_subscription_id', 'is', null)
    .limit(1);

  const id = data?.[0]?.stripe_subscription_id as string | undefined;
  return id ? { kind: 'subscription', id } : null;
}

/**
 * The sale, found from the payment intent the browser came back with.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A SECOND LOCAL KEY, on purpose.
 *
 * `findLocalSubscription` above reads an attempt this platform records as it
 * writes the subscription. On a run measured 2026-10-25 that attempt did NOT
 * arrive — subscription 25f1cf19 was written with `metadata: {}` even though
 * Stripe's own copy carried `attempt_id: 7c8ed344…` and the compiled route
 * contained the plumbing. Why it was empty is not yet established, so it is not
 * the only thing standing between a client's money and their booking.
 *
 * This key uses rows that were verified present on that same booking: the
 * webhook writes the first period's charge with
 * `metadata.subscription_id` naming the Stripe subscription, and the
 * subscription row carries that id in a column. Two local reads, both equality
 * matches on ids this platform wrote itself.
 *
 * STILL NOT INFERENCE. The payment intent is the one the client's browser was
 * returned with, and `stripe_payment_intent_id` is unique — so this resolves to
 * that client's own money or to nothing.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function findLocalByPaymentIntent(
  paymentIntentId: string,
  userId: string
): Promise<{ kind: 'subscription' | 'payment_intent'; id: string } | null> {
  const { data } = await supabaseServer
    .from('payment_transactions')
    .select('metadata')
    .eq('user_id', userId)
    .eq('stripe_payment_intent_id', paymentIntentId)
    .limit(1);

  if (!data?.length) return null;

  const subscriptionId = (data[0].metadata as { subscription_id?: string } | null)?.subscription_id;

  /* A plan's charge names its subscription; a one-off names nothing, and the
     payment intent is then the whole sale. */
  return subscriptionId
    ? { kind: 'subscription', id: subscriptionId }
    : { kind: 'payment_intent', id: paymentIntentId };
}

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
/**
 * Wait for the webhook's transaction row before trying to stamp it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MEASURED, from a client who paid on a smart link and was refunded minutes
 * later. The two writes land within a sixth of a second of each other and in
 * the wrong order:
 *
 *   15:36:56.474   the booking row, written here
 *   15:36:56.591   the transaction row, written by the Stripe webhook
 *
 * The stamp below is `.is('booking_id', null)` against a row that did not
 * exist yet, so it updated nothing and returned quietly. The payment stayed
 * unlinked, and everything downstream that finds a booking's money by
 * `booking_id` found none: the refund left the booking reading "paid", and the
 * client was never emailed, because `notifyRefund` resolves the recipient
 * through exactly that link.
 *
 * The subscription path already waited like this. The one-off charge path,
 * which is what a single appointment uses, did not.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function waitForLocalTransaction(
  stripePaymentIntentId: string,
  userId: string
): Promise<boolean> {
  const ATTEMPTS = 6;
  const GAP_MS = 500;

  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const { data } = await supabaseServer
      .from('payment_transactions')
      .select('id')
      .eq('user_id', userId)
      .eq('stripe_payment_intent_id', stripePaymentIntentId)
      .limit(1);

    if (data?.length) return true;

    if (attempt < ATTEMPTS - 1) {
      await new Promise(resolve => setTimeout(resolve, GAP_MS));
    }
  }

  /* Not fatal. A payment that never produces a local row is a different fault
     from this one, and `reconcileBookingMoney` — behind the
     `booking-money-reconcile` cron, every fifteen minutes — is what catches it.
     It calls this same function, so the wait applies there too. */
  return false;
}

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
  const { attemptId, bookingId, contactId, userId, paymentIntentId } = input;

  if (!attemptId || !bookingId) return NOTHING;

  try {
    /*
     * ── OUR OWN ROWS FIRST, THEN STRIPE ───────────────────────────────────────
     *
     * `findInStripe` asks Stripe's SEARCH API, and Stripe documents that search
     * as eventually consistent. Measured 2026-10-25: a plan subscription
     * created 0.51 seconds before its booking was invisible to
     * `metadata['attempt_id']:'…'` at link time and returned by the identical
     * query minutes later. The sale was therefore never attached — the booking
     * read `paid` with no payment against it, the Manage-payment dialog listed
     * no money, and a refund offered ₪0 over ₪250 the client had paid.
     *
     * The same account's other plan survived only by luck: it reached the
     * booking 8.93 seconds later, which was enough for the index.
     *
     * `bindPlanSubscription` now records the attempt on the subscription row as
     * it writes it, so the sale can be found by an equality match on data this
     * platform owns, with no index to wait for. Stripe stays the fallback for
     * the case this cannot answer — a row the webhook has not written yet.
     *
     * STILL NOT INFERENCE. `metadata.attempt_id` is this attempt's own id,
     * written by the route that created the subscription; it is the same
     * identity the Stripe search matches on, read from a faster place.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const found =
      (await findLocalSubscription(attemptId, userId))
      ?? (paymentIntentId ? await findLocalByPaymentIntent(paymentIntentId, userId) : null)
      ?? (await findInStripe(attemptId, userId));
    if (!found) return NOTHING;

    const stamp = { booking_id: bookingId, contact_id: contactId };

    /* A one-off card payment: one charge, nothing else to attach. */
    if (found.kind === 'payment_intent') {
      /* The webhook writes that row, and on a smart link it can land AFTER
         this booking does. See `waitForLocalTransaction`. */
      const arrived = await waitForLocalTransaction(found.id, userId);
      if (!arrived) {
        logger.warn(
          { attemptId, bookingId, paymentIntentId: found.id },
          'Paid booking has no local transaction yet; leaving it for reconciliation'
        );
        return NOTHING;
      }

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

        /*
         * AND BRING THE BOOKING UP TO DATE WITH IT.
         *
         * Linking alone is not enough once anything has already happened to
         * that money. A payment refunded BEFORE it was linked left its booking
         * reading "paid" for ever, because the sync that would have corrected
         * it runs at refund time and had no booking to find. Settling the
         * state here closes that window.
         */
        const { syncBookingPaymentState } = await import('@/lib/payments/syncBookingPaymentState');
        await syncBookingPaymentState(bookingId, userId).catch(err =>
          logger.error({ err, bookingId }, 'Linked the payment but could not settle the booking state')
        );
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

      /*
       * SETTLE HERE TOO, for exactly the reason the charge path does.
       *
       * The one-off path above gained this when a client paid on a smart link
       * and was refunded before the link existed: the booking read "paid" for
       * ever, because the sync that corrects it runs at REFUND time and had no
       * booking to find then.
       *
       * An instalment sale has the same window and a wider one — the
       * subscription row can be later than a charge row, and the reconcile pass
       * may link it fifteen minutes after the refund. Settling only the charge
       * path would have left that half of the catalogue still lying.
       */
      const { syncBookingPaymentState } = await import('@/lib/payments/syncBookingPaymentState');
      await syncBookingPaymentState(bookingId, userId).catch(err =>
        logger.error({ err, bookingId }, 'Linked the money but could not settle the booking state')
      );
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

/**
 * Link an attempt's money once the attempt is known to have converted.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS LIVES HERE AND NOT IN THE WEBHOOK
 *
 * The Stripe route called `linkPaymentsToBooking` directly and did its own two
 * reads first — the attempt, then the booking's contact. That put queries in a
 * `route.ts`, which CLAUDE.md rule 1 forbids and `routerPlacement.guard`
 * enforces: the route is a router, and the moment it holds a query of its own
 * the next reader has two places to look for how the money is joined.
 *
 * Same two reads, one call, and `reconcileBookingMoney` can use the identical
 * entry point rather than repeating them.
 *
 * NEVER THROWS. The client has paid and the booking exists; a failed join is a
 * reporting problem, and the reconcile pass retries it.
 */
export async function linkPaymentsForConvertedAttempt(
  attemptId: string
): Promise<LinkPaymentsResult> {
  if (!attemptId) return NOTHING;

  try {
    const { data: attempt } = await supabaseServer
      .from('abandoned_bookings')
      .select('id, user_id, booking_id')
      .eq('id', attemptId)
      /* Before the booking exists there is nothing to link to; the reconcile
         pass is the backstop for anything both sides miss. */
      .not('booking_id', 'is', null)
      .maybeSingle();

    if (!attempt?.booking_id) return NOTHING;

    const { data: booking } = await supabaseServer
      .from('scheduling_bookings')
      .select('contact_id')
      .eq('id', attempt.booking_id as string)
      .maybeSingle();

    return await linkPaymentsToBooking({
      attemptId: attempt.id as string,
      bookingId: attempt.booking_id as string,
      contactId: (booking?.contact_id as string | null) ?? null,
      userId: attempt.user_id as string,
    });
  } catch (err) {
    logger.error({ err, attemptId }, 'Linking a converted attempt threw; the reconcile pass will retry');
    return NOTHING;
  }
}
