/**
 * The checkout return marker (plan payments P-5a.2; workplan §3.3; SA S5-6,
 * P5-C6).
 *
 * Stripe appends the checkout session id to the `awaiting_payment` return
 * path (`?checkout={CHECKOUT_SESSION_ID}`). The holding screen accepts it only
 * when it is ONE well-formed session id, and uses it for the display only
 * ("Payment processing"). It never releases anyone: the server re-read of the
 * hold does that.
 *
 * Its own file with no import, so the page and its render test use the real
 * check without loading the server-only screen model.
 *
 * @module lib/business-os/billing/checkoutReturnMarker
 */

/** A Stripe checkout session id, test or live. Anything else is ignored. */
export const CHECKOUT_RETURN_MARKER = /^cs_(test|live)_[A-Za-z0-9]{1,250}$/;

/** True when `value` is one well-formed checkout session id. Display only. */
export function isCheckoutReturnMarker(value: unknown): boolean {
  return typeof value === 'string' && CHECKOUT_RETURN_MARKER.test(value);
}
