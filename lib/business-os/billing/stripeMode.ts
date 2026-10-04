/**
 * Which Stripe mode a secret key belongs to (plan payments P-2a, workplan §3.6;
 * PF-15: test-mode and live-mode billing rows share one database).
 *
 * The key prefix is the only signal we hold before talking to Stripe. P-2a
 * uses it to read and write the billing row of the current mode; P-3b's
 * livemode check on webhook objects reuses it.
 *
 * Fails closed: anything that is not a known secret or restricted key prefix
 * throws, so a missing or malformed key can never be read as a mode.
 *
 * @module lib/business-os/billing/stripeMode
 */

export type StripeMode = 'test' | 'live';

/** The mode of a Stripe secret (`sk_`) or restricted (`rk_`) key. Throws on anything else. */
export function stripeModeFromKey(key: string | undefined | null): StripeMode {
  if (typeof key === 'string') {
    if (key.startsWith('sk_test_') || key.startsWith('rk_test_')) return 'test';
    if (key.startsWith('sk_live_') || key.startsWith('rk_live_')) return 'live';
  }
  // Never echo the key, not even a prefix of it.
  throw new Error('stripe_key_mode_unknown');
}

/** The mode of the server's `STRIPE_SECRET_KEY`. Throws when it is missing or unrecognised. */
export function currentStripeMode(): StripeMode {
  return stripeModeFromKey(process.env.STRIPE_SECRET_KEY);
}

/** `livemode` as Stripe and the billing row spell it. */
export function isLiveMode(mode: StripeMode): boolean {
  return mode === 'live';
}
