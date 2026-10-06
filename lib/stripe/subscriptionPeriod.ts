// lib/stripe/subscriptionPeriod.ts
//
// Since API version 2025-03-31.basil, Stripe no longer puts the billing period on
// the Subscription object: `current_period_start` / `current_period_end` live on
// each subscription item. The client is pinned to 2025-10-29.clover, so the
// subscription-level field is gone from both the type and the API response.

import type Stripe from 'stripe';

/**
 * The end of the subscription's current billing period, in Unix seconds, read
 * from its first item. `null` when the subscription has no items (or the item
 * carries no period), so callers never read past an empty list.
 *
 * The first item is the subscription's only item for every subscription this
 * platform creates (one price per subscription).
 */
export function subscriptionPeriodEnd(subscription: Stripe.Subscription): number | null {
  const firstItem = subscription.items?.data?.[0];
  return typeof firstItem?.current_period_end === 'number' ? firstItem.current_period_end : null;
}

/**
 * `subscriptionPeriodEnd` as an ISO 8601 string, or `null` when there is no
 * period. Never throws: `new Date(undefined * 1000).toISOString()` is a
 * RangeError, which once made a successful Stripe write report failure.
 */
export function subscriptionPeriodEndIso(subscription: Stripe.Subscription): string | null {
  const end = subscriptionPeriodEnd(subscription);
  return end === null ? null : new Date(end * 1000).toISOString();
}
