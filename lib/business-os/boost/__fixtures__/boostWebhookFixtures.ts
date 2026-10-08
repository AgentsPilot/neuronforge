/**
 * Event and row fixtures for the boost webhook tests (credits boost slice 4a).
 * Shapes follow Stripe API `2025-10-29.clover` Checkout Session objects for an
 * embedded, payment-mode boost session created by slice 3.
 */

import type Stripe from 'stripe';

import type { BusinessOsBoostPurchase } from '@/lib/repositories/BusinessOsBoostPurchaseRepository';

export const ACCOUNT = '11111111-1111-4111-8111-111111111111';
export const OTHER_ACCOUNT = '99999999-9999-4999-8999-999999999999';
export const PURCHASE = '44444444-4444-4444-8444-444444444444';
export const SESSION = 'cs_test_boost_1';
export const OTHER_SESSION = 'cs_test_boost_other';
export const INTENT = 'pi_test_boost_1';
export const LOT = '77777777-7777-4777-8777-777777777777';

export function purchaseRow(patch: Partial<BusinessOsBoostPurchase> = {}): BusinessOsBoostPurchase {
  return {
    id: PURCHASE,
    accountId: ACCOUNT,
    livemode: false,
    status: 'pending',
    packageId: 'plus',
    packageVersion: 1,
    retailVersion: 1,
    creditValueVersion: 1,
    priceMinor: 2500,
    currency: 'usd',
    taxExclusive: true,
    creditsBase: 12500,
    creditsBonus: 1250,
    creditsTotal: 13750,
    checkoutExpiresAt: '2026-10-07T12:31:00.000Z',
    stripeCheckoutSessionId: SESSION,
    stripePaymentIntentId: null,
    stripeChargeId: null,
    receiptUrl: null,
    amountSubtotalMinor: null,
    amountTaxMinor: null,
    amountTotalMinor: null,
    amountRefundedMinor: 0,
    stripeDisputeId: null,
    flagReason: null,
    lotId: null,
    paidAt: null,
    statusChangedAt: '2026-10-07T12:00:00.000Z',
    createdAt: '2026-10-07T12:00:00.000Z',
    updatedAt: '2026-10-07T12:00:00.000Z',
    ...patch,
  };
}

export function boostSession(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SESSION,
    object: 'checkout.session',
    mode: 'payment',
    ui_mode: 'embedded',
    status: 'complete',
    payment_status: 'paid',
    payment_intent: INTENT,
    amount_subtotal: 2500,
    amount_total: 2500,
    total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 },
    currency: 'usd',
    client_reference_id: PURCHASE,
    customer: null,
    customer_email: 'owner@example.com',
    livemode: false,
    metadata: { product: 'business_os_boost', purchase_id: PURCHASE, package_id: 'plus', package_version: '1' },
    ...patch,
  };
}

export function boostEvent(
  type: string,
  sessionPatch: Record<string, unknown> = {},
  eventPatch: Record<string, unknown> = {}
): Stripe.Event {
  return {
    id: `evt_${type.replace(/\W/g, '_')}`,
    object: 'event',
    type,
    livemode: false,
    created: 1_791_000_000,
    api_version: '2025-10-29.clover',
    data: { object: boostSession(sessionPatch) },
    ...eventPatch,
  } as unknown as Stripe.Event;
}
