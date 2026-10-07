import 'server-only';

/**
 * The Business OS server Stripe client (credits boost slice 3, SA Q-1, C-7).
 *
 * `StripeService` keeps its own client private, and the credits boost
 * requirement (§17) keeps `lib/stripe/StripeService.ts` unchanged. Business OS
 * code that calls Stripe directly — the boost checkout now, plan payments P-3a
 * later — takes this lazily created singleton instead. It is pinned to the SAME
 * API version as `StripeService`: a guard test reads both files and fails if
 * they drift, so the platform never speaks two Stripe API versions by accident.
 *
 * Server-only: the secret key must never reach a client bundle. A missing key
 * throws `stripe_key_missing` on first use (never at import), and callers map
 * that to a refusal.
 *
 * @module lib/business-os/billing/stripeClient
 */

import Stripe from 'stripe';

/** Must equal the `apiVersion` in `lib/stripe/StripeService.ts` (guard test). */
export const STRIPE_API_VERSION = '2025-10-29.clover' as const;

let client: Stripe | null = null;

/** The shared Business OS Stripe client. Throws `stripe_key_missing` when the key is unset. */
export function getBusinessOsStripeClient(): Stripe {
  if (client === null) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('stripe_key_missing');
    client = new Stripe(key, { apiVersion: STRIPE_API_VERSION });
  }
  return client;
}
