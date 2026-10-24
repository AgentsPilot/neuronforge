/**
 * Did the money for this attempt actually arrive?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE BROWSER CANNOT ANSWER IT
 *
 * `website/booking/finalize` decided whether to create a booking by reading
 * `payment_status` out of the request body — a field the browser sends. A POST
 * carrying a valid attempt uuid and `payment_status: 'paid'` created a contact
 * and a `confirmed` / `paid` booking, with no money anywhere. The uuid being
 * server-generated was the only thing standing in the way.
 *
 * The route's own comment forty lines below already said it: "this route
 * finalises from the client, so nothing it sends is evidence". That was
 * written about which Stripe account a charge lives on, and it is just as true
 * of whether the charge happened.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO WITNESSES, BECAUSE THERE ARE TWO JOURNEYS
 *
 *   · embedded Elements  → the browser has a PaymentIntent id
 *   · hosted Checkout    → it has none; the session id is on the attempt
 *
 * Either is proof as long as Stripe is the one asked. Neither is accepted on
 * the client's word.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHICH ACCOUNT
 *
 * These are direct charges, so an object lives on the connected account, not
 * the platform. Both are tried, exactly as `locatePaymentIntentAccount` does —
 * that helper is not reused because it answers "which account" and throws the
 * object away, and what is needed here is the object itself.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import Stripe from 'stripe';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { resolveUserConnectAccounts } from '@/lib/payments/stripeAccountContext';
import type { AttemptRow } from '@/lib/scheduling/materialiseAttempt';

const logger = createLogger({ module: 'verifyAttemptPayment' });

export type PaymentVerdict =
  | { paid: true; via: 'payment_intent' | 'checkout_session' }
  | { paid: false; reason: 'no_evidence' | 'not_succeeded' | 'wrong_attempt' | 'lookup_failed' };

/** The platform first, then every connected account this owner has. */
async function accountsToTry(userId: string): Promise<Array<string | undefined>> {
  try {
    const candidates = await resolveUserConnectAccounts(supabaseServer, userId);
    return [undefined, ...candidates.map(c => c.accountId)];
  } catch (err) {
    logger.warn({ err, userId }, 'Could not list the connected accounts; trying the platform only');
    return [undefined];
  }
}

export async function verifyAttemptPayment(
  attempt: AttemptRow,
  paymentIntentId?: string | null
): Promise<PaymentVerdict> {
  if (!paymentIntentId && !attempt.checkout_session_id) {
    return { paid: false, reason: 'no_evidence' };
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const accounts = await accountsToTry(attempt.user_id);

  if (paymentIntentId) {
    for (const stripeAccount of accounts) {
      try {
        const intent = await stripe.paymentIntents.retrieve(
          paymentIntentId,
          stripeAccount ? { stripeAccount } : undefined
        );

        if (intent.status !== 'succeeded') {
          return { paid: false, reason: 'not_succeeded' };
        }

        /*
         * The charge must belong to THIS attempt.
         *
         * Without it, any succeeded PaymentIntent id for this business would
         * finalise any attempt — one real payment reused to mint bookings.
         *
         * Only enforced when the metadata carries an attempt, because a charge
         * started before `payment-intent` forwarded it has none. Those are
         * accepted on their status alone and logged, rather than refused: they
         * are real payments by real clients, and the window closes on its own.
         */
        const stamped = intent.metadata?.attempt_id;
        if (stamped && stamped !== attempt.id) {
          logger.error(
            { attemptId: attempt.id, paymentIntentId, stamped },
            'A payment was offered for an attempt it does not belong to'
          );
          return { paid: false, reason: 'wrong_attempt' };
        }
        if (!stamped) {
          logger.warn(
            { attemptId: attempt.id, paymentIntentId },
            'Payment carries no attempt in its metadata; accepted on status alone'
          );
        }

        return { paid: true, via: 'payment_intent' };
      } catch {
        // Not on this account. Expected for all but one of them.
      }
    }
  }

  if (attempt.checkout_session_id) {
    for (const stripeAccount of accounts) {
      try {
        const session = await stripe.checkout.sessions.retrieve(
          attempt.checkout_session_id,
          stripeAccount ? { stripeAccount } : undefined
        );

        /* `paid` is the only value that means money moved. `no_payment_required`
           is a zero-value session, which this journey never creates. */
        if (session.payment_status !== 'paid') {
          return { paid: false, reason: 'not_succeeded' };
        }

        return { paid: true, via: 'checkout_session' };
      } catch {
        // Not on this account either.
      }
    }
  }

  logger.error(
    { attemptId: attempt.id, paymentIntentId, sessionId: attempt.checkout_session_id },
    'Could not find the payment for this attempt on any account'
  );
  return { paid: false, reason: 'lookup_failed' };
}
