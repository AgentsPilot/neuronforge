/**
 * A Business OS plan invoice from the webhook: `invoice.paid` applies it,
 * `invoice.payment_failed` records it (plan payments P-3b.2, workplan §3.2,
 * §3.3; SA rulings Q-2, Q-3, Q-4; SR-8, PF-15, SA-P14 layer 2, SA-P15).
 *
 * Runs inside the `plan` flow handler, after the router recognised the price
 * and after the handler checked the event's mode (PF-15). The account is NEVER
 * taken from Stripe metadata: it is the billing row found by the invoice's
 * subscription id (else its customer id) in this mode (SR-8).
 *
 *   1  lines        the invoice's full line list (fetched when the event's was truncated, CF-2)
 *   2  facts        `planInvoiceFacts` (pure): tier, period, amounts, paid_at, assigns-plan
 *   3  account      billing row by subscription, else by customer, + livemode
 *                   none (or detached) → refusal row with NO account (`unknown_customer`)
 *   4  facts refused (malformed, mixed tiers, no plan line) → refusal row
 *   5  currency     not USD → refusal row (SA-P15 backstop)
 *   6  metadata     `bos_user_id` present and not the row's account → refusal row
 *   7  customer     the row's customer is not the invoice's → refusal row
 *   paid only:
 *   8  tier         not configured → refusal row (RC-1)
 *   9  Stripe       the subscription, fresh: anchor, status; the row's OTHER
 *                   subscription, to prove it ended (re-buy) or not (SA-P14 layer 2)
 *   10 apply        `business_os_apply_plan_payment`, then `recordPlanChange`
 *   failed only:
 *   8  record       one `invoice_payment_failed` history row (SA Q-2); no plan or
 *                   billing write (attempts, banner: P-6a)
 *
 * OUTCOMES. A refusal is final: it is recorded in the money history, logged at
 * `error` with `alert: true` (the v1 alert channel, AM-9) and audited when an
 * account is known, and the handler returns, so the claim is completed. "Could
 * not tell" THROWS, so the claim is released and Stripe retries: a Stripe or
 * database read failure, a plan row that does not exist (SA Q-3), or a billing
 * row that vanished between the read and the apply. A replay (same invoice, or
 * an event already recorded) writes nothing and audits nothing.
 *
 * Audit (SA Q-4): the system actor through `recordPlanChange`, never a null
 * actor. No email and no metadata value in any log line or audit entry.
 *
 * @module lib/business-os/billing/planPaymentApply
 */

import type Stripe from 'stripe';

import type { Logger } from '@/lib/logger';
import type { StripeService } from '@/lib/stripe/StripeService';
import type {
  BusinessOsBillingAccount,
  BusinessOsBillingAccountRepository,
  BusinessOsSubscriptionStatus,
} from '@/lib/repositories/BusinessOsBillingAccountRepository';
import type {
  BusinessOsApplyPlanPaymentResult,
  BusinessOsBillingEventRepository,
} from '@/lib/repositories/BusinessOsBillingEventRepository';
import { resolveAccountId } from '@/lib/business-os/entitlements/account';
import type { RecordPlanChangeInput } from '@/lib/business-os/entitlements/recordPlanChange';
import type { EntitlementConfig } from '@/lib/business-os/entitlements/source';
import { tierIsConfigured } from '@/lib/business-os/entitlements/planWriteChecks';
import { planTierForLookupKey, type PlanPriceCatalog } from '@/lib/business-os/billing/planPriceCatalog';
import { priceIdOfLine } from '@/lib/payments/invoiceLinePrices';
import {
  planInvoiceFacts,
  type PlanInvoiceFacts,
  type PlanInvoiceIdentity,
  type PlanInvoiceKind,
} from '@/lib/business-os/billing/planInvoiceFacts';

// ── Ports ───────────────────────────────────────────────────────────────────

export type PlanPaymentStripeReads = Pick<StripeService, 'listInvoiceLinesAll' | 'retrieveBusinessOsSubscription'>;

export interface PlanPaymentDeps {
  billingAccounts: Pick<BusinessOsBillingAccountRepository, 'findByStripeSubscription' | 'findByStripeCustomer'>;
  billingEvents: Pick<BusinessOsBillingEventRepository, 'applyPlanPayment' | 'recordEvent'>;
  stripe: () => PlanPaymentStripeReads;
  catalog: PlanPriceCatalog;
  entitlementConfig: () => Pick<EntitlementConfig, 'tierOrder' | 'matrix'>;
  recordPlanChange: (input: RecordPlanChangeInput) => Promise<void>;
}

/** Why a plan payment was refused: the `refusal_reason` of its money history row. */
export type PlanPaymentRefusalReason =
  | 'unknown_customer'
  | 'malformed_invoice'
  | 'mixed_tiers'
  | 'no_plan_line'
  | 'currency_not_usd'
  | 'metadata_account_mismatch'
  | 'customer_mismatch'
  | 'tier_not_configured';

/** Thrown for "could not tell": the route releases the claim and Stripe retries. */
export class PlanPaymentRetryError extends Error {
  constructor(readonly reason: string) {
    super(`Business OS plan payment could not be decided: ${reason}`);
    this.name = 'PlanPaymentRetryError';
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const SUBSCRIPTION_STATUSES: readonly BusinessOsSubscriptionStatus[] = [
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused',
];

/** A subscription in one of these has ended at Stripe, so a new one may replace it (C6-4). */
const ENDED_STATUSES: readonly string[] = ['canceled', 'incomplete_expired'];

/** Stripe ids as the money history's CHECKs admit them; anything else is recorded as NULL, never sent. */
const SHAPES = {
  customer: /^cus_[A-Za-z0-9]{1,251}$/,
  subscription: /^sub_[A-Za-z0-9]{1,251}$/,
  invoice: /^in_[A-Za-z0-9]{1,252}$/,
} as const;

function shaped(value: string | null, pattern: RegExp): string | null {
  return value !== null && pattern.test(value) ? value : null;
}

function isoFromUnix(value: number): string {
  return new Date(value * 1000).toISOString();
}

function isStripeMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'resource_missing';
}

/** The tier each price sells, from the catalog (reloaded once if a cached map misses a line's price, SA P1-C3). */
async function tierLookup(
  catalog: PlanPriceCatalog,
  lines: readonly Stripe.InvoiceLineItem[]
): Promise<(priceId: string) => string | null> {
  const priceIds = lines.map((line) => priceIdOfLine(line)).filter((id): id is string => id !== null);
  let known = await catalog.load();
  if (known.fromCache && priceIds.some((id) => !known.byPriceId.has(id))) {
    known = await catalog.load({ bypassCache: true });
  }
  const map = known.byPriceId;
  return (priceId) => {
    const lookupKey = map.get(priceId);
    return lookupKey ? planTierForLookupKey(lookupKey) : null;
  };
}

interface InvoiceContext {
  event: Stripe.Event;
  livemode: boolean;
  identity: PlanInvoiceIdentity;
  /** Null when the invoice was refused before the facts could be read. */
  facts: PlanInvoiceFacts | null;
  log: Logger;
}

/**
 * Record a refused plan payment: one `mismatch_refused` row, an alert, and an
 * audit entry when the account is known. NULL account only for an unknown
 * customer (QA P-3b.1 edge case 1): every other refusal has one.
 */
async function refuse(
  deps: PlanPaymentDeps,
  ctx: InvoiceContext,
  reason: PlanPaymentRefusalReason,
  accountId: string | null
): Promise<void> {
  const { identity, facts, livemode, event, log } = ctx;
  if (accountId === null && reason !== 'unknown_customer') {
    throw new PlanPaymentRetryError('refusal_without_account');
  }

  const recorded = await deps.billingEvents.recordEvent({
    accountId,
    livemode,
    kind: 'mismatch_refused',
    stripeEventId: event.id,
    stripeInvoiceId: shaped(identity.invoiceId, SHAPES.invoice),
    stripeSubscriptionId: shaped(identity.subscriptionId, SHAPES.subscription),
    stripeCustomerId: shaped(identity.customerId, SHAPES.customer),
    tier: facts?.tier ?? null,
    refusalReason: reason,
    amountMinor: identity.amountMinor,
    amountTaxMinor: identity.amountTaxMinor,
    // The table admits USD or nothing (SA-P5), so a non-USD amount keeps its currency NULL.
    currency: identity.currency === 'usd' ? 'usd' : null,
    periodStart: facts?.periodStart ?? null,
    periodEnd: facts?.periodEnd ?? null,
    paidAt: identity.paidAt,
  });
  if (recorded.error || !recorded.data) throw recorded.error ?? new PlanPaymentRetryError('refusal_not_recorded');

  const ids = {
    invoiceId: identity.invoiceId,
    subscriptionId: identity.subscriptionId,
    customerId: identity.customerId,
    livemode,
    stripeEventId: event.id,
  };
  if (recorded.data.outcome === 'duplicate') {
    log.info({ event: 'bos_billing_payment_refusal_replayed', reason, accountId, ...ids }, 'Business OS plan payment refusal already recorded');
    return;
  }

  log.error(
    { event: 'bos_billing_payment_refused', reason, accountId, eventType: event.type, ...ids, alert: true },
    'Business OS plan payment refused and recorded'
  );
  if (accountId !== null) {
    await deps.recordPlanChange({
      accountId,
      action: 'BOS_BILLING_PAYMENT_REFUSED',
      actor: { kind: 'system', source: 'stripe_webhook' },
      entityType: 'business_os_account_plan',
      entityId: accountId,
      changes: {},
      details: { refusalReason: reason, eventType: event.type, ...ids, eventRowId: recorded.data.eventRowId },
      severity: 'warning',
      invalidatesEntitlements: false,
      log,
    });
  }
}

/** The billing row this invoice belongs to, by subscription then customer, in this mode. Throws on a read error. */
async function findAccount(
  deps: PlanPaymentDeps,
  identity: PlanInvoiceIdentity,
  livemode: boolean
): Promise<BusinessOsBillingAccount | null> {
  const subscriptionId = shaped(identity.subscriptionId, SHAPES.subscription);
  if (subscriptionId) {
    const bySubscription = await deps.billingAccounts.findByStripeSubscription(subscriptionId, livemode);
    if (bySubscription.error) throw bySubscription.error;
    if (bySubscription.data) return bySubscription.data;
  }
  const customerId = shaped(identity.customerId, SHAPES.customer);
  if (customerId) {
    const byCustomer = await deps.billingAccounts.findByStripeCustomer(customerId, livemode);
    if (byCustomer.error) throw byCustomer.error;
    if (byCustomer.data) return byCustomer.data;
  }
  return null;
}

/**
 * Steps 1 to 7, shared by paid and failed (SA Q-2: the same mode, account and
 * metadata checks). Returns the account and the facts, or `null` when the
 * payment was refused (already recorded).
 */
async function checkInvoice(
  deps: PlanPaymentDeps,
  event: Stripe.Event,
  kind: PlanInvoiceKind,
  log: Logger
): Promise<{ ctx: InvoiceContext; account: BusinessOsBillingAccount; accountId: string; facts: PlanInvoiceFacts } | null> {
  const invoice = event.data.object as Stripe.Invoice;
  const livemode = event.livemode;

  // CF-2: the router read a truncated invoice in full to recognise it; the
  // facts need every line too, so they are read again here.
  const lines =
    invoice.lines?.has_more === true && invoice.id
      ? await deps.stripe().listInvoiceLinesAll(invoice.id)
      : invoice.lines?.data ?? [];

  const parsed = planInvoiceFacts(invoice, lines, await tierLookup(deps.catalog, lines), kind);
  const identity: PlanInvoiceIdentity = parsed.ok
    ? {
        invoiceId: parsed.facts.invoiceId,
        customerId: parsed.facts.customerId,
        subscriptionId: parsed.facts.subscriptionId,
        bosUserIdClaim: parsed.facts.bosUserIdClaim,
        currency: parsed.facts.currency,
        amountMinor: parsed.facts.amountMinor,
        amountTaxMinor: parsed.facts.amountTaxMinor,
        paidAt: parsed.facts.paidAt,
      }
    : parsed.identity;
  const ctx: InvoiceContext = { event, livemode, identity, facts: parsed.ok ? parsed.facts : null, log };

  const account = await findAccount(deps, identity, livemode);
  if (!account || account.accountId === null) {
    // The money is recorded even though no account is found (§3.3 row 3).
    await refuse(deps, ctx, 'unknown_customer', null);
    return null;
  }
  const accountId = resolveAccountId(account.accountId);

  if (!parsed.ok) {
    await refuse(deps, ctx, parsed.reason, accountId);
    return null;
  }
  const { facts } = parsed;

  if (facts.currency !== 'usd') {
    await refuse(deps, ctx, 'currency_not_usd', accountId);
    return null;
  }
  // Metadata is a cross-check only: it never chose the account above.
  if (facts.bosUserIdClaim !== null && facts.bosUserIdClaim !== account.accountId) {
    await refuse(deps, ctx, 'metadata_account_mismatch', accountId);
    return null;
  }
  if (account.stripeCustomerId !== facts.customerId) {
    await refuse(deps, ctx, 'customer_mismatch', accountId);
    return null;
  }
  return { ctx, account, accountId, facts };
}

// ── invoice.paid ────────────────────────────────────────────────────────────

/** Apply one paid plan invoice. Returns when it is done (applied, recorded, replayed or refused); throws to retry. */
export async function applyPaidPlanInvoice(event: Stripe.Event, log: Logger, deps: PlanPaymentDeps): Promise<void> {
  const checked = await checkInvoice(deps, event, 'paid', log);
  if (!checked) return;
  const { ctx, account, accountId, facts } = checked;

  const config = deps.entitlementConfig();
  if (!tierIsConfigured(config, facts.tier)) {
    await refuse(deps, ctx, 'tier_not_configured', accountId);
    return;
  }

  // One fresh read: the anchor and status are Stripe's now; the period stays
  // the invoice's own, so a late replay carries its own period (§3.2).
  const subscription = await deps.stripe().retrieveBusinessOsSubscription(facts.subscriptionId);
  if (subscription.customerId !== facts.customerId) {
    await refuse(deps, ctx, 'customer_mismatch', accountId);
    return;
  }
  const subscriptionStatus = SUBSCRIPTION_STATUSES.find((s) => s === subscription.status);
  if (!subscriptionStatus) throw new PlanPaymentRetryError('unknown_subscription_status');

  // SA-P14 layer 2: a different subscription on the row is replaced only when
  // Stripe says it ended. Otherwise NULL is passed and the function refuses.
  let replacesSubscriptionId: string | null = null;
  const held = account.stripeSubscriptionId;
  if (held !== null && held !== facts.subscriptionId) {
    try {
      const old = await deps.stripe().retrieveBusinessOsSubscription(held);
      if (ENDED_STATUSES.includes(old.status)) replacesSubscriptionId = held;
    } catch (err) {
      // A subscription Stripe does not know cannot be PROVEN ended: refused by
      // the function as a second subscription, and alerted. Anything else is
      // "could not tell".
      if (!isStripeMissing(err)) throw err;
      log.warn({ event: 'bos_billing_held_subscription_missing', accountId, heldSubscriptionId: held }, 'Held subscription is unknown to Stripe');
    }
  }

  const applied = await deps.billingEvents.applyPlanPayment({
    accountId,
    livemode: ctx.livemode,
    stripeCustomerId: facts.customerId,
    stripeSubscriptionId: facts.subscriptionId,
    replacesSubscriptionId,
    stripeEventId: event.id,
    stripeInvoiceId: facts.invoiceId,
    tier: facts.tier,
    planVersion: config.matrix.version,
    assignsPlan: facts.assignsPlan,
    amountMinor: facts.amountMinor,
    amountTaxMinor: facts.amountTaxMinor,
    currency: 'usd',
    periodStart: facts.periodStart,
    periodEnd: facts.periodEnd,
    // `checkInvoice` refuses a paid invoice without one.
    paidAt: facts.paidAt as string,
    billingCycleAnchor: isoFromUnix(subscription.billingCycleAnchor),
    subscriptionStatus,
  });
  if (applied.error || !applied.data) throw applied.error ?? new PlanPaymentRetryError('apply_failed');

  await afterApply(deps, ctx, accountId, facts, applied.data, {
    billingCycleAnchor: isoFromUnix(subscription.billingCycleAnchor),
    secondSubscription: held !== null && held !== facts.subscriptionId && replacesSubscriptionId === null,
  });
}

async function afterApply(
  deps: PlanPaymentDeps,
  ctx: InvoiceContext,
  accountId: string,
  facts: PlanInvoiceFacts,
  result: BusinessOsApplyPlanPaymentResult,
  extra: { billingCycleAnchor: string; secondSubscription: boolean }
): Promise<void> {
  const { event, livemode, log } = ctx;
  const ids = {
    accountId,
    invoiceId: facts.invoiceId,
    subscriptionId: facts.subscriptionId,
    livemode,
    stripeEventId: event.id,
  };

  switch (result.status) {
    case 'applied':
    case 'recorded': {
      log.info(
        { event: 'bos_billing_invoice_applied', status: result.status, planWritten: result.planWritten, anchorSet: result.anchorSet, tier: facts.tier, ...ids },
        'Business OS plan invoice applied'
      );
      await deps.recordPlanChange({
        accountId,
        action: 'BOS_BILLING_INVOICE_PAID',
        actor: { kind: 'system', source: 'stripe_webhook' },
        entityType: 'business_os_account_plan',
        entityId: accountId,
        changes: {
          before: { tier: result.tierBefore },
          after: {
            tier: result.tierAfter,
            ...(result.planWritten ? { tierExpiresAt: facts.periodEnd } : {}),
            ...(result.anchorSet ? { periodAnchor: extra.billingCycleAnchor } : {}),
          },
        },
        details: {
          invoiceId: facts.invoiceId,
          subscriptionId: facts.subscriptionId,
          tier: facts.tier,
          amountMinor: facts.amountMinor,
          planWritten: result.planWritten,
          anchorSet: result.anchorSet,
          livemode,
          stripeEventId: event.id,
          eventRowId: result.eventRowId,
        },
        severity: 'info',
        // Only a written plan row changes what the account is entitled to.
        invalidatesEntitlements: result.planWritten,
        log,
      });
      return;
    }

    case 'already_applied':
    case 'already_recorded':
      // A replay: nothing written, nothing audited (as the admin replay branch).
      log.info({ event: 'bos_billing_invoice_replayed', status: result.status, eventRowId: result.eventRowId, ...ids }, 'Business OS plan invoice already handled');
      return;

    case 'subscription_conflict': {
      // The function wrote the refusal row itself (C-1), or found the event already recorded.
      const refusalReason = extra.secondSubscription ? 'second_subscription' : 'subscription_held_elsewhere';
      log.error(
        { event: 'bos_billing_payment_refused', reason: refusalReason, eventRowId: result.eventRowId, ...ids, alert: true },
        'Business OS plan payment refused: subscription conflict'
      );
      if (result.eventRowId !== null) {
        await deps.recordPlanChange({
          accountId,
          action: 'BOS_BILLING_PAYMENT_REFUSED',
          actor: { kind: 'system', source: 'stripe_webhook' },
          entityType: 'business_os_account_plan',
          entityId: accountId,
          changes: {},
          details: { refusalReason, eventType: event.type, ...ids, eventRowId: result.eventRowId },
          severity: 'warning',
          invalidatesEntitlements: false,
          log,
        });
      }
      return;
    }

    case 'customer_mismatch':
      // The customer changed between the read and the lock: refuse and record.
      await refuse(deps, ctx, 'customer_mismatch', accountId);
      return;

    case 'plan_row_missing':
      // SA Q-3: nothing was written. An admin can ensure the plan row within
      // Stripe's retry window, and P-8b re-applies later.
      log.error({ event: 'bos_billing_plan_row_missing', ...ids, alert: true }, 'Paid Business OS plan invoice has no plan row to apply to; releasing for retry');
      throw new PlanPaymentRetryError('plan_row_missing');

    case 'billing_row_missing':
      log.error({ event: 'bos_billing_row_vanished', ...ids, alert: true }, 'Business OS billing row vanished before the apply; releasing for retry');
      throw new PlanPaymentRetryError('billing_row_missing');

    default: {
      const unreachable: never = result;
      throw new PlanPaymentRetryError(`unknown_apply_status:${String(unreachable)}`);
    }
  }
}

// ── invoice.payment_failed ──────────────────────────────────────────────────

/** SA Q-2: one money-history row for a failed plan payment; no plan or billing write. */
export async function recordFailedPlanInvoice(event: Stripe.Event, log: Logger, deps: PlanPaymentDeps): Promise<void> {
  const checked = await checkInvoice(deps, event, 'failed', log);
  if (!checked) return;
  const { ctx, accountId, facts } = checked;

  const recorded = await deps.billingEvents.recordEvent({
    accountId,
    livemode: ctx.livemode,
    kind: 'invoice_payment_failed',
    stripeEventId: event.id,
    stripeInvoiceId: facts.invoiceId,
    stripeSubscriptionId: facts.subscriptionId,
    stripeCustomerId: facts.customerId,
    tier: facts.tier,
    amountMinor: facts.amountMinor,
    amountTaxMinor: facts.amountTaxMinor,
    currency: 'usd',
    periodStart: facts.periodStart,
    periodEnd: facts.periodEnd,
    paidAt: null,
  });
  if (recorded.error || !recorded.data) throw recorded.error ?? new PlanPaymentRetryError('failure_not_recorded');

  const ids = { accountId, invoiceId: facts.invoiceId, subscriptionId: facts.subscriptionId, livemode: ctx.livemode, stripeEventId: event.id };
  if (recorded.data.outcome === 'duplicate') {
    log.info({ event: 'bos_billing_payment_failed_replayed', ...ids }, 'Business OS failed plan payment already recorded');
    return;
  }
  log.warn(
    { event: 'bos_billing_payment_failed', amountMinor: facts.amountMinor, eventRowId: recorded.data.eventRowId, ...ids },
    'Business OS plan payment failed and recorded'
  );
}
