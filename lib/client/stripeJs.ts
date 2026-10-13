'use client';

/**
 * The ONE Stripe.js loader for Business OS billing in the browser (plan
 * payments P-5a.2, workplan §3.4, SA P5-3; widened by P-4.1, M-4).
 *
 * Extracted from the /test-business-os `PlanCheckoutPanel`, which had its own.
 * The shared `PlanEmbeddedCheckout` uses it (the harness, the holding screen
 * and P-4's Settings button), and since P-4.1 so does `BoostPackagesPanel`,
 * whose own copy this replaced. One Stripe.js instance per page.
 * `components/website/blocks/StripePaymentForm.tsx` is NOT on it: that is
 * Stripe Connect money for a business's clients (SR-10, SA O-3).
 *
 * `null` when `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is not set OR is not shaped
 * like a publishable key (`pk_test_` / `pk_live_`, adopted from the boost
 * panel, M-4), so the caller shows a "not configured" line instead of a broken
 * frame. `PlanEmbeddedCheckout` asks BEFORE it calls the checkout route (M-2).
 * The publishable key is public by design; the secret key never reaches the
 * browser.
 */

import { loadStripe, type Stripe } from '@stripe/stripe-js';

let stripePromise: Promise<Stripe | null> | null = null;

/** A publishable key's shape. Anything else (a secret key pasted by mistake, a typo) is "not configured". */
const PUBLISHABLE_KEY_SHAPE = /^pk_(test|live)_/;

/** One Stripe.js instance per page; `null` when no usable publishable key is configured. */
export function getStripePromise(): Promise<Stripe | null> | null {
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!key || !PUBLISHABLE_KEY_SHAPE.test(key)) return null;
  if (!stripePromise) stripePromise = loadStripe(key);
  return stripePromise;
}
