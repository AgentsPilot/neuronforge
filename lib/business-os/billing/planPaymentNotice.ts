/**
 * What the owner is told about a plan payment that did not go through: the
 * ONE predicate behind the Business OS banner and the Settings → Plan state,
 * so the two can never disagree (plan payments P-6a.2; workplan §5.6, §5.7;
 * SA C-1 ruling, Q-5, C-13; the `heldPaymentOffer` pattern).
 *
 * Pure: no I/O, no clock, NO IMPORT. The callers (`readPaymentNotice.ts` for
 * the banner, `planPurchaseView.ts` for Settings) pass plain facts read from
 * our billing record and the entitlements snapshot, so this file reaches into
 * neither the repository nor the entitlements module.
 *
 * | Rule | Answer |
 * |------|--------|
 * | no row, or a row of the other Stripe mode (PF-15) | `null` |
 * | `ended_at` set | `ended` only while the lifecycle reads `grace` or `paused` (a Founding Partner whose free access resumed lost nothing: AC-F6.5); else `null` |
 * | failure open = `subscription_status` in {past_due, unpaid} OR `failed_attempts > 0` | the column branch is the marker the cure clears, never a comparison of `last_payment_failed_at` with a Stripe timestamp (C-1). Both branches are U-10-safe: an upgrade never leaves `active` (E-1b, E-2, E-4) and the columns are written for renewals only |
 * | open AND a Stripe-hosted confirm URL (re-checked here, C-13) | `action_required` |
 * | open AND lifecycle `paused` AND enforcing | `paused`. Before S-5 nothing is paused, so the banner never says so (Q-5) |
 * | open | `payment_failed`; `pauseBy` = the lifecycle's own `graceEndsAt`, only while it reads `grace` |
 *
 * `failedAt` is DISPLAY ONLY (`event.created`, or the due date when no
 * failure was counted yet). The tier is returned as an id; the caller turns it
 * into the configured label.
 *
 * @module lib/business-os/billing/planPaymentNotice
 */

/** What the billing record says, as plain facts. */
export interface PaymentNoticeBillingFacts {
  livemode: boolean;
  subscriptionStatus: string | null;
  failedAttempts: number;
  lastPaymentFailedAt: string | null;
  actionRequiredInvoiceUrl: string | null;
  endedAt: string | null;
  currentPeriodEnd: string | null;
  boughtTier: string | null;
}

/** What the entitlements lifecycle says now (`resolution.lifecycle`). `unknown` when it could not be read. */
export interface PaymentNoticeLifecycleFacts {
  state: string;
  graceEndsAt: string | null;
}

export interface PaymentNoticeContext {
  /** The mode of the server's Stripe key. */
  serverLivemode: boolean;
  /** The EFFECTIVE entitlements mode is `enforce` (server-resolved, never a client value). */
  enforcing: boolean;
}

export type PlanPaymentNotice =
  | { kind: 'payment_failed'; tier: string | null; failedAt: string | null; attempts: number; pauseBy: string | null }
  | { kind: 'action_required'; tier: string | null; failedAt: string | null; dueOn: string | null; confirmUrl: string }
  | { kind: 'paused'; tier: string | null; failedAt: string | null; attempts: number }
  | { kind: 'ended'; tier: string | null; endedAt: string };

/**
 * What the banner is sent (`readPaymentNotice` → the layout → `PlanPaymentBanner`):
 * only what it renders. `planLabel` null means "use the product name". The
 * confirm URL travels for `action_required` only, to this owner's page only.
 */
export type PaymentNoticeWire =
  | { kind: 'payment_failed'; planLabel: string | null; pauseBy: string | null }
  | { kind: 'paused'; planLabel: string | null }
  | { kind: 'action_required'; planLabel: string | null; confirmUrl: string }
  | { kind: 'ended'; planLabel: string | null };

/**
 * Stripe's hosted invoice page. The same prefix the billing repository
 * stores by (`HOSTED_INVOICE_URL_PREFIX`; a test pins that they agree),
 * repeated here so this file keeps no import.
 */
export const CONFIRM_URL_PREFIX = 'https://invoice.stripe.com/';

/** The statuses in which Stripe says a renewal payment is outstanding. */
const FAILURE_STATUSES: readonly string[] = ['past_due', 'unpaid'];

function isConfirmUrl(value: string | null): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(CONFIRM_URL_PREFIX) &&
    value.length > CONFIRM_URL_PREFIX.length &&
    value.length <= 2048 &&
    !/\s/.test(value)
  );
}

export function planPaymentNotice(
  row: PaymentNoticeBillingFacts | null,
  lifecycle: PaymentNoticeLifecycleFacts,
  context: PaymentNoticeContext
): PlanPaymentNotice | null {
  if (!row || row.livemode !== context.serverLivemode) return null;
  const tier = row.boughtTier;

  if (row.endedAt !== null) {
    return lifecycle.state === 'grace' || lifecycle.state === 'paused' ? { kind: 'ended', tier, endedAt: row.endedAt } : null;
  }

  const failureOpen =
    (row.subscriptionStatus !== null && FAILURE_STATUSES.includes(row.subscriptionStatus)) || row.failedAttempts > 0;
  if (!failureOpen) return null;

  const failedAt = row.lastPaymentFailedAt ?? row.currentPeriodEnd;
  // A status that moved before our failure event landed is still one attempt.
  const attempts = Math.max(row.failedAttempts, 1);

  if (isConfirmUrl(row.actionRequiredInvoiceUrl)) {
    return { kind: 'action_required', tier, failedAt, dueOn: row.currentPeriodEnd, confirmUrl: row.actionRequiredInvoiceUrl };
  }
  if (lifecycle.state === 'paused' && context.enforcing) {
    return { kind: 'paused', tier, failedAt, attempts };
  }
  return { kind: 'payment_failed', tier, failedAt, attempts, pauseBy: lifecycle.state === 'grace' ? lifecycle.graceEndsAt : null };
}
