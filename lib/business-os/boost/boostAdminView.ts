/**
 * The admin view of one account's credit top-ups: words, links and the
 * payload builder (credits boost slice 6a; requirement FR-38, R-12; SA N-3,
 * C-4; workplan §3.1, §3.2).
 *
 * Pure: no I/O, no server-only import (repository TYPES only), so the route and
 * the client block share one source for every word and every link.
 *
 * @module lib/business-os/boost/boostAdminView
 */

import type {
  BusinessOsBoostCapOverride,
  BusinessOsBoostCapOverrideHistoryRow,
  BusinessOsBoostPurchase,
} from '@/lib/repositories/BusinessOsBoostPurchaseRepository';
import type { AdminBoostCapChange, AdminBoostPurchaseRow } from '@/lib/business-os/boost/boostAdminViewTypes';

// ── Status words ─────────────────────────────────────────────────────────────

/** What an admin reads for each purchase status. The raw status is shown on hover. */
export const ADMIN_BOOST_STATUS_WORDS: Readonly<Record<string, string>> = {
  pending: 'Checkout not finished',
  abandoned: 'Checkout never started',
  awaiting_payment: 'Waiting for a delayed payment',
  paid: 'Paid, credits added',
  failed: 'Payment failed',
  expired: 'Checkout expired',
  flagged_mismatch: 'Needs review',
  partially_refunded: 'Partly refunded',
  refunded: 'Refunded',
  disputed: 'Chargeback open',
  dispute_lost: 'Chargeback lost (payment reversed)',
};

/** The chip colour family of a status: money in, money out or contested, a person needed, or nothing paid. */
export type AdminBoostStatusTone = 'paid' | 'reversed' | 'review' | 'waiting' | 'closed';

export function adminBoostStatusTone(status: string): AdminBoostStatusTone {
  switch (status) {
    case 'paid':
      return 'paid';
    case 'partially_refunded':
    case 'refunded':
    case 'disputed':
    case 'dispute_lost':
      return 'reversed';
    case 'flagged_mismatch':
      return 'review';
    case 'pending':
    case 'awaiting_payment':
      return 'waiting';
    default:
      return 'closed';
  }
}

export function adminBoostStatusWords(status: string): string {
  return ADMIN_BOOST_STATUS_WORDS[status] ?? status;
}

// ── Flag reasons (SA N-3: an admin must be able to find and refund these) ────

/**
 * Every reason the boost code can write on a flagged purchase (2b's credit
 * function, 4a's webhook, 4b.2's reconcile pass), in plain words. A source test
 * pins that each written code has words here. An unknown code is shown raw.
 */
export const ADMIN_BOOST_FLAG_REASON_WORDS: Readonly<Record<string, string>> = {
  // 2b: the credit function
  no_session: 'paid, but the purchase never got its checkout session (refund it)',
  session_mismatch: 'the payment belongs to a different checkout session',
  payment_intent_mismatch: 'the payment does not match the one recorded',
  livemode_mismatch: 'test and live mode do not match',
  currency_mismatch: 'the payment currency does not match',
  amount_mismatch: 'the amount paid does not match the package price',
  total_mismatch: 'the payment total does not add up',
  payment_intent_reused: 'the same payment was used for another purchase',
  account_deleted: 'the account was deleted before crediting',
  lot_key_conflict: 'credits for this payment already exist elsewhere',
  // 4a: the webhook
  session_unreadable: 'Stripe sent a checkout session that could not be read',
  metadata_mismatch: 'the payment says it is for a different product',
  no_payment_intent: 'Stripe reported no payment for a completed checkout',
  no_payment_required: 'the checkout needed no payment (a free session)',
  session_amounts_missing: 'Stripe reported no amounts for the checkout',
  // 4b.2: the nightly reconcile pass
  reconcile_session_missing: 'the nightly check could not find the checkout session in Stripe',
  reconcile_session_refused: 'Stripe refused the nightly check’s request for the checkout session',
  reconcile_session_unreadable: 'the nightly check could not read the checkout session',
  reconcile_unexpected: 'the nightly check got an unexpected answer',
  'transition_not_allowed:expired': 'Stripe says the checkout expired, but the purchase could not be closed',
  'transition_not_allowed:failed': 'Stripe says the payment failed, but the purchase could not be closed',
  paid_not_creditable: 'Stripe says paid, but the purchase can no longer be credited',
};

export function adminBoostFlagReasonWords(code: string | null): string | null {
  if (code === null) return null;
  return ADMIN_BOOST_FLAG_REASON_WORDS[code] ?? code;
}

// ── Stripe dashboard links (SA C-4) ──────────────────────────────────────────

export type StripeDashboardKind = 'payment' | 'dispute';

const STRIPE_ID: Readonly<Record<StripeDashboardKind, RegExp>> = {
  payment: /^pi_[A-Za-z0-9]{1,250}$/,
  dispute: /^(dp|du)_[A-Za-z0-9]{1,250}$/,
};

const STRIPE_PATH: Readonly<Record<StripeDashboardKind, string>> = {
  payment: 'payments',
  dispute: 'disputes',
};

/**
 * The Stripe dashboard page of one object, or null (render the id as text).
 * `livemode` is the ROW's own mode, never the server key's: a test purchase
 * read on a live key still links to the test dashboard (SA C-4). The id must
 * match its anchored pattern, so nothing but a Stripe id reaches the URL.
 */
export function stripeDashboardUrl(kind: StripeDashboardKind, id: string | null, livemode: boolean): string | null {
  if (typeof id !== 'string' || !STRIPE_ID[kind].test(id)) return null;
  return `https://dashboard.stripe.com/${livemode ? '' : 'test/'}${STRIPE_PATH[kind]}/${id}`;
}

// Money is formatted by `formatMinorAmount` in `lib/business-os/currency.ts`
// (the shared minor-unit rule, never a typed `/ 100`; SA CR-1 on 6a).

// ── The payload builder (field by field: an allow-list) ──────────────────────

export function toAdminBoostPurchaseRow(row: BusinessOsBoostPurchase): AdminBoostPurchaseRow {
  return {
    id: row.id,
    livemode: row.livemode,
    status: row.status,
    packageId: row.packageId,
    packageVersion: row.packageVersion,
    priceMinor: row.priceMinor,
    currency: row.currency,
    creditsTotal: row.creditsTotal,
    amountTotalMinor: row.amountTotalMinor,
    amountTaxMinor: row.amountTaxMinor,
    amountRefundedMinor: row.amountRefundedMinor,
    flagReason: row.flagReason,
    lotId: row.lotId,
    stripe: {
      paymentIntentId: row.stripePaymentIntentId,
      chargeId: row.stripeChargeId,
      disputeId: row.stripeDisputeId,
      checkoutSessionId: row.stripeCheckoutSessionId,
    },
    createdAt: row.createdAt,
    paidAt: row.paidAt,
    statusChangedAt: row.statusChangedAt,
    checkoutExpiresAt: row.checkoutExpiresAt,
  };
}

/** Both modes' rows, newest first (ties keep the input order). */
export function mergeNewestFirst(...lists: ReadonlyArray<readonly BusinessOsBoostPurchase[]>): AdminBoostPurchaseRow[] {
  return lists
    .flat()
    .map((row, index) => ({ row, index }))
    .sort((a, b) => Date.parse(b.row.createdAt) - Date.parse(a.row.createdAt) || a.index - b.index)
    .map(({ row }) => toAdminBoostPurchaseRow(row));
}

export function toAdminActiveCap(override: BusinessOsBoostCapOverride) {
  return {
    id: override.id,
    amountMinor: override.capMinor,
    currency: override.currency,
    reason: override.reason,
    actorAdminId: override.actorAdminId,
    createdAt: override.createdAt,
  };
}

export function toAdminCapChange(row: BusinessOsBoostCapOverrideHistoryRow): AdminBoostCapChange {
  return {
    id: row.id,
    amountMinor: row.capMinor,
    currency: row.currency,
    reason: row.reason,
    actorAdminId: row.actorAdminId,
    createdAt: row.createdAt,
    endedAt: row.endedAt,
    endedByAdminId: row.endedByAdminId,
    endedReason: row.endedReason,
  };
}
