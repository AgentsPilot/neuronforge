/**
 * The Stripe checkout session for one boost purchase (credits boost slice 3,
 * workplan §3.3; SA T-3d, T-4, T-8, T-14, T-15, R-9, C-3, C-5).
 *
 * `buildBoostCheckoutSessionParams` is pure: it turns a catalogue package and a
 * reservation into the exact parameters Stripe receives, and the tests pin
 * them. What it guarantees:
 *   - one-off payment, embedded checkout, USD, inline price in integer minor
 *     units straight from the catalogue (never a multiplication, NFR-9);
 *   - priced tax-exclusive with automatic tax off (T-14), Adaptive Pricing off
 *     so a buyer is always charged USD (T-15 / F-7), promotion codes off;
 *   - NO Stripe customer (R-9): the receipt goes to `customer_email` /
 *     `receipt_email`, which are omitted when the account has no email (C-5);
 *   - the Business OS boost marker on the session and the payment intent, and
 *     `client_reference_id` = our purchase id: the webhook's routing identity;
 *   - an expiry 31 minutes out (C-3: Stripe wants at least 30 minutes after ITS
 *     creation time, so 1,800 s computed beforehand can fall short).
 *
 * The product name is the package's English name; no credit figure or bonus is
 * typed here (slice 5 shows them, computed from the catalogue).
 *
 * The create and expire calls take an injected client, so nothing in this file
 * needs a real Stripe account to test.
 *
 * @module lib/business-os/boost/boostCheckoutSession
 */

import type Stripe from 'stripe';

import {
  BOS_BOOST_PRODUCT_MARKER,
  BOS_PRODUCT_METADATA_KEY,
} from '@/lib/business-os/billing/stripeMetadataKeys';

/** C-3: 31 minutes. Also the reservation's `checkoutTtlSeconds`, so both expire together. */
export const BOOST_CHECKOUT_TTL_SECONDS = 1860;

/** The Stripe idempotency key prefix; one session per purchase id (T-4). */
export const BOOST_CHECKOUT_IDEMPOTENCY_PREFIX = 'bos-boost-checkout:';

/** The parts of the Stripe client the boost checkout uses (injected in tests). */
export type BoostStripeClient = Pick<Stripe, 'checkout'>;

/** What the session needs from a catalogue package (a `BoostPackage` satisfies it). */
export interface BoostSessionPackage {
  id: string;
  version: number;
  priceMinor: number;
  currency: 'USD';
  labels: { name: { en: string } };
}

export interface BoostSessionInput {
  pkg: BoostSessionPackage;
  purchaseId: string;
  /** The account's email, or null when the sign-in method has none (C-5). */
  email: string | null;
  /** Where embedded checkout returns; must contain `{CHECKOUT_SESSION_ID}` (Q-3). */
  returnUrl: string;
  now: Date;
}

/** The metadata carried on the session and its payment intent (the dispatcher's cross-check marker). */
export function boostCheckoutMetadata(pkg: BoostSessionPackage, purchaseId: string): Record<string, string> {
  return {
    [BOS_PRODUCT_METADATA_KEY]: BOS_BOOST_PRODUCT_MARKER,
    purchase_id: purchaseId,
    package_id: pkg.id,
    package_version: String(pkg.version),
  };
}

/** The exact Stripe parameters for one boost purchase. Pure. */
export function buildBoostCheckoutSessionParams(input: BoostSessionInput): Stripe.Checkout.SessionCreateParams {
  const { pkg, purchaseId, email, returnUrl, now } = input;
  const metadata = boostCheckoutMetadata(pkg, purchaseId);
  const paymentIntentData: Stripe.Checkout.SessionCreateParams.PaymentIntentData = { metadata };
  if (email) paymentIntentData.receipt_email = email;

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: 'payment',
    ui_mode: 'embedded',
    client_reference_id: purchaseId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: pkg.currency.toLowerCase(),
          unit_amount: pkg.priceMinor,
          tax_behavior: 'exclusive',
          product_data: { name: pkg.labels.name.en },
        },
      },
    ],
    metadata,
    payment_intent_data: paymentIntentData,
    adaptive_pricing: { enabled: false },
    automatic_tax: { enabled: false },
    allow_promotion_codes: false,
    expires_at: Math.floor(now.getTime() / 1000) + BOOST_CHECKOUT_TTL_SECONDS,
    return_url: returnUrl,
  };
  if (email) params.customer_email = email;
  return params;
}

/** Create the session; one per purchase id, whatever a retry does (T-4). */
export function createBoostCheckoutSession(
  client: BoostStripeClient,
  params: Stripe.Checkout.SessionCreateParams,
  purchaseId: string
): Promise<Stripe.Checkout.Session> {
  return client.checkout.sessions.create(params, { idempotencyKey: `${BOOST_CHECKOUT_IDEMPOTENCY_PREFIX}${purchaseId}` });
}

/** Expire a session so it can no longer be paid. */
export function expireBoostCheckoutSession(client: BoostStripeClient, sessionId: string): Promise<Stripe.Checkout.Session> {
  return client.checkout.sessions.expire(sessionId);
}
