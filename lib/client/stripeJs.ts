'use client';

/**
 * The ONE Stripe.js loader for the Business OS plan checkout (plan payments
 * P-5a.2; workplan §3.4; SA P5-3 "it does not write a second Stripe.js
 * loader").
 *
 * Extracted from the /test-business-os `PlanCheckoutPanel`, which had its own.
 * The shared `PlanEmbeddedCheckout` uses it, so the harness, the holding screen
 * and P-4's Settings button all share one Stripe.js instance per page.
 * `BoostPackagesPanel` still has its own copy (out of scope; noted for P-4).
 *
 * `null` when `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is not set, so the caller
 * shows a "not configured" line instead of a broken frame. The publishable key
 * is public by design; the secret key never reaches the browser.
 */

import { loadStripe, type Stripe } from '@stripe/stripe-js';

let stripePromise: Promise<Stripe | null> | null = null;

/** One Stripe.js instance per page; `null` when no publishable key is configured. */
export function getStripePromise(): Promise<Stripe | null> | null {
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!key) return null;
  if (!stripePromise) stripePromise = loadStripe(key);
  return stripePromise;
}
