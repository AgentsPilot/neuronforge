/**
 * Stripe metadata names shared by the Business OS billing router (P-1) and the
 * code that creates Business OS checkouts (P-3a).
 *
 * Defined once so P-3a writes exactly what P-1 checks (SA ruling Q-7).
 *
 * Metadata is a CROSS-CHECK only. It never routes an event and is never read to
 * choose an account (SR-2, SR-8, tenant-isolation ruling): who a payment
 * belongs to is decided from our own billing record. A Business OS object must
 * never carry the legacy names below (C-3), because `handleSubscriptionUpdated`
 * and `sync-subscription` still act on them.
 *
 * @module lib/business-os/billing/stripeMetadataKeys
 */

/** Metadata key naming which product an object belongs to. */
export const BOS_PRODUCT_METADATA_KEY = 'product';

/** `product` value on Business OS plan subscriptions, invoices and sessions. */
export const BOS_PLAN_PRODUCT_MARKER = 'business_os_plan';

/** `product` value the Credits Boost flow writes (boost 4a). */
export const BOS_BOOST_PRODUCT_MARKER = 'business_os_boost';

/** Business OS user id key (C-3). Compared, never used to select an account. */
export const BOS_USER_ID_METADATA_KEY = 'bos_user_id';

/**
 * Agent-platform Pilot-Credit keys. Their presence on an object whose price is a
 * Business OS plan price is a tamper signal.
 */
export const LEGACY_PILOT_CREDIT_METADATA_KEYS: readonly string[] = ['user_id', 'credits', 'pilot_credits'];
