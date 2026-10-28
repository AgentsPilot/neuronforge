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
 *   9a U-4          `subscription_update` invoices only (P-7b.1a, SA U-4, V-5):
 *                   a pending update waiting on THIS invoice → retry (throw);
 *                   Stripe not billing one of the invoice's deciding prices
 *                   (or more than one item) → recorded WITHOUT the plan
 *                   (`assignsPlan` false), alerted and audited on a new row only
 *   10 apply        `business_os_apply_plan_payment`, then `recordPlanChange`
 *   10a late pay    FU-P7a4-1 (SA R-1 to R-6): AFTER the apply returned, the
 *                   pure `paidAfterEnd` reads the step-9 subscription facts
 *                   (no new call, no new read). When Stripe says the
 *                   subscription ended before the invoice's period end AND the
 *                   money came after that end, one `error` + `alert: true`
 *                   line `bos_billing_paid_after_end`, on a NEW money row only
 *                   (`applied` / `recorded`, or `subscription_conflict` with a
 *                   new refusal row). Alert only: the outcome is unchanged and
 *                   an operator decides honour vs refund
 *   failed / action required (P-6a.2, workplan §5.3, §5.4; SA C-1 to C-3, U-10):
 *   8  record       one `invoice_payment_failed` / `payment_action_required`
 *                   history row for EVERY plan invoice (SA Q-2, Q-8)
 *   9  renewal only `billing_reason === 'subscription_cycle'` (a whitelist: an
 *                   upgrade, or any future reason, never counts, U-10): on a NEW
 *                   row, one `info` audit; then, whether the row is new or a
 *                   replay (C-3, heals a crash), the billing record counts the
 *                   attempt (`recordRenewalFailure` / `recordActionRequired`),
 *                   decided by billing PERIODS, never by `event.created` (C-1)
 *   paid, after the apply (`applied`, `recorded`, `already_applied`):
 *   11 cure         `clearRenewalFailure`: the failure marker is cleared when the
 *                   paid invoice is the newest. Never throws (logged)
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
 * FIRST PAYMENT (P-5a.1, S5-3 to S5-5, P5-C3, W-5). The apply function stamps
 * the account's first payment on its lineage row itself (20261028) and says so
 * in `firstPaymentStamped`. Only that flag drives the side effects here, and
 * only on `applied` / `recorded`: one `BOS_BILLING_FIRST_PAYMENT_STAMPED`
 * entry, ALWAYS written when the flag is true, logged with the invoice-paid
 * entry under the same bounded flush. Its lineage `source` comes from one
 * post-commit read that never throws (`source: null` and a warn when the port
 * is missing or the read fails). Nothing after the apply may throw: the money
 * is already committed and a retry would only replay.
 *
 * N-2, "YOUR FRIEND SUBSCRIBED" (P-5b.1; SA S5-5, P5-C3, P5-C8, O-4, C-3 to
 * C-6). Driven by the same flag, on the same two statuses, AFTER the stamp
 * entry and the invoice-paid entry are flushed:
 *   - the lineage read above runs under N-2's clock (`deadlineMs`, 4 s, read
 *     from the port so this file imports nothing from `lib/business-os/invites/`);
 *   - a friend's first payment (`source = 'account_invite'`), or one whose
 *     source could not be read, is handed to `firstPaymentNotifier` with what
 *     is left of the clock. It finds the champion from OUR records only (the
 *     lineage `invite_id`, then the invite's issuer) and audits every outcome;
 *     an unread source is audited "not notified" with no email (C-6);
 *   - an ADMIN invitee's first payment (`source = 'admin_invite'`) is handed
 *     over too (plan payments P-9.2, T10, BQ-P11, SA Q-10): the notifier tells
 *     the ONE admin who issued it when it was a Paid (tier) invite, found
 *     from the invite named by the payer's OWN lineage row, never from
 *     webhook metadata; a champion's own (cohort) first payment owes nobody
 *     and audits nothing;
 *   - `organic` first payments send nothing and audit nothing (nothing was
 *     owed);
 *   - the call sits behind a backstop and never throws. A replay never gets
 *     here (`already_applied`), so the email goes once; a send lost to a crash
 *     is not retried (D5-6).
 * Worst case after the commit: 4 s (lineage + N-2) + 2 s (stamp flush) + 2 s
 * (N-2's own audit flush) + 0.5 s slack = 8.5 s; `postCommitMs` on the
 * `bos_billing_invoice_post_commit` line shows the real figure. P-3b's
 * `bos_billing_invoice_applied` line is still written at the commit, before
 * this chain starts (SA F-1).
 *
 * @module lib/business-os/billing/planPaymentApply
 */

import type Stripe from 'stripe';

import { AUDIT_FLUSH_TIMEOUT_MS } from '@/lib/audit/auditTimeouts';
import type { Logger } from '@/lib/logger';
import type { BusinessOsCancellationReason, StripeService } from '@/lib/stripe/StripeService';
import {
  isHostedInvoiceUrl,
  type BusinessOsBillingAccount,
  type BusinessOsBillingAccountRepository,
  type BusinessOsSubscriptionStatus,
} from '@/lib/repositories/BusinessOsBillingAccountRepository';
import type {
  BusinessOsApplyPlanPaymentResult,
  BusinessOsBillingEventRepository,
} from '@/lib/repositories/BusinessOsBillingEventRepository';
import type { BusinessOsAccountLineageRepository } from '@/lib/repositories/BusinessOsAccountLineageRepository';
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
  billingAccounts: Pick<
    BusinessOsBillingAccountRepository,
    'findByStripeSubscription' | 'findByStripeCustomer' | 'recordRenewalFailure' | 'recordActionRequired' | 'clearRenewalFailure'
  >;
  billingEvents: Pick<BusinessOsBillingEventRepository, 'applyPlanPayment' | 'recordEvent'>;
  stripe: () => PlanPaymentStripeReads;
  catalog: PlanPriceCatalog;
  entitlementConfig: () => Pick<EntitlementConfig, 'tierOrder' | 'matrix'>;
  recordPlanChange: (input: RecordPlanChangeInput) => Promise<void>;
  /**
   * P-5a.1: read once, only after the function stamped the first payment, to
   * name the lineage `source` in the stamp audit entry. Optional on purpose
   * (SA W-5): a caller that does not wire it still gets the entry, with
   * `source: null`.
   */
  lineage?: Pick<BusinessOsAccountLineageRepository, 'findHoldFactsForAccount'>;
  /**
   * P-5b.1 (N-2): the champion's "your friend subscribed" email. Optional so
   * existing deps stay valid (SA Q-4); a stamped payment that may be a
   * friend's and finds it unwired is logged at `error` with `alert: true`, and
   * a source guard requires every caller of `applyPaidPlanInvoice` to name it
   * (C-5). Built only in `planBillingHandler.ts`.
   */
  firstPaymentNotifier?: FirstPaymentNotifier;
  /** P-6a.2: the clock for `updated_at` on the billing record. Default: the wall clock. */
  now?: () => Date;
}

/** How the stamp's lineage read went (P-5b.1, O-4). */
export type StampLineageRead = 'ok' | 'failed' | 'timed_out' | 'no_row' | 'no_port';

/** What the N-2 notifier is told about one stamped first payment. Ids only. */
export interface FirstPaymentNotifyInput {
  /** The paying account, resolved from OUR billing record (SR-8). */
  accountId: string;
  /** The `invite_id` of that account's lineage row; null when it was not read or is absent. */
  inviteId: string | null;
  /**
   * P-9.2 (T10): the lineage row's `source`, as read; null when it was not
   * read. The notifier checks the invite against it. Absent is read as a
   * friend's (`account_invite`), P-5b.1's only case.
   */
  lineageSource?: 'account_invite' | 'admin_invite' | null;
  lineageRead: StampLineageRead;
  /** What is left of `deadlineMs` after the lineage read (the stamp flush is not counted). */
  remainingMs: number;
  livemode: boolean;
  stripeEventId: string;
  /** The delivery's logger (correlation id and Stripe event id attached). */
  log: Logger;
}

/** The N-2 port (P-5b.1). Its production implementation is `championSubscribedNotification.ts`. */
export interface FirstPaymentNotifier {
  /** The whole budget for the lineage read plus the notification (N-1's 4 s). */
  readonly deadlineMs: number;
  /** Never rejects by contract; the caller guards it anyway. Writes its own audit. */
  notifyChampion(input: FirstPaymentNotifyInput): Promise<void>;
}

/** The lineage read's bound when no notifier is wired (the same 4 s as N-1, O-4). */
const STAMP_LINEAGE_DEADLINE_MS = 4_000;

/** Past the notifier's own bounds (its clock plus its audit flush): abandon it. */
const N2_BACKSTOP_SLACK_MS = 500;

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

/**
 * U-10 (P-6a.2, workplan §4): the billing reasons that count as a RENEWAL. A
 * whitelist, so it fails closed: an upgrade (`subscription_update`), or any
 * reason Stripe adds later, never sets the banner or the attempt count. A
 * Founding Partner's first charge at `trial_end` (P-11) is `subscription_cycle`.
 */
export const RENEWAL_BILLING_REASONS: readonly string[] = ['subscription_cycle'];

export function isRenewalInvoice(billingReason: string | null): boolean {
  return billingReason !== null && RENEWAL_BILLING_REASONS.includes(billingReason);
}

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

// ── FU-P7a4-1: a plan invoice paid after its subscription ended ─────────────

/** What `paidAfterEnd` found: Stripe's facts only (SA R-1). */
export interface PaidAfterEndFacts {
  /** Stripe's `ended_at`, as ISO. */
  subscriptionEndedAt: string;
  subscriptionStatus: string;
  cancellationReason: BusinessOsCancellationReason | null;
}

/**
 * FU-P7a4-1 (SA ruling 1 on P-7a.4 deviation 1; R-1 to R-6). Pure: no I/O, no
 * `await`, never throws (anything unreadable answers `null`). Fires when, by
 * Stripe's FRESH read alone (R-1), the subscription ended before the period
 * the invoice pays for was over AND the money came after that end (R-3):
 *   1  `endedAt` set (a positive, finite unix time)
 *   2  `periodEnd > endedAt`: a period-end cancel's last invoice (period end
 *      at or before `ended_at`) never fires
 *   3  `paidAt > endedAt`: a late delivery of a payment made while the
 *      subscription was live never fires
 * The answer feeds ONE log line; it never reaches `applyPlanPayment`, the
 * U-4 guard or the held-subscription logic (R-6).
 */
export function paidAfterEnd(
  facts: { periodEnd: string; paidAt: string | null },
  subscription: { endedAt: number | null; status: string; cancellationReason?: BusinessOsCancellationReason | null }
): PaidAfterEndFacts | null {
  try {
    const endedAt = subscription.endedAt;
    if (typeof endedAt !== 'number' || !Number.isFinite(endedAt) || endedAt <= 0) return null;
    const endedMs = endedAt * 1000;
    const periodEndMs = typeof facts.periodEnd === 'string' ? Date.parse(facts.periodEnd) : NaN;
    const paidMs = typeof facts.paidAt === 'string' ? Date.parse(facts.paidAt) : NaN;
    if (!Number.isFinite(periodEndMs) || !Number.isFinite(paidMs)) return null;
    if (!(periodEndMs > endedMs) || !(paidMs > endedMs)) return null;
    return {
      subscriptionEndedAt: new Date(endedMs).toISOString(),
      subscriptionStatus: String(subscription.status),
      cancellationReason: subscription.cancellationReason ?? null,
    };
  } catch {
    // A time `toISOString` cannot hold, or a hostile getter: no alert, never a throw.
    return null;
  }
}

/** The alert's context: the helper's facts plus our row's, which decide nothing (R-1). */
interface PaidAfterEndAlert extends PaidAfterEndFacts {
  billingRowId: string;
  /** Our row's `ended_at`, only when it holds this invoice's subscription; else null. */
  recordEndedAt: string | null;
}

/** The one `bos_billing_paid_after_end` line. Ids, amounts and dates only: no owner text, no PII, no metadata values. */
function logPaidAfterEnd(
  log: Logger,
  alert: PaidAfterEndAlert,
  ids: { accountId: string; invoiceId: string; subscriptionId: string; livemode: boolean; stripeEventId: string },
  facts: PlanInvoiceFacts,
  outcome: { status: string; eventRowId: string; planWritten: boolean; tierBefore: string | null; tierAfter: string | null }
): void {
  log.error(
    {
      event: 'bos_billing_paid_after_end',
      alert: true,
      ...ids,
      billingRowId: alert.billingRowId,
      ...outcome,
      tier: facts.tier,
      billingReason: facts.billingReason,
      amountMinor: facts.amountMinor,
      currency: 'usd',
      periodEnd: facts.periodEnd,
      paidAt: facts.paidAt,
      subscriptionEndedAt: alert.subscriptionEndedAt,
      subscriptionStatus: alert.subscriptionStatus,
      cancellationReason: alert.cancellationReason,
      recordEndedAt: alert.recordEndedAt,
    },
    'Business OS plan invoice paid after its subscription ended; outcome unchanged, operator to decide honour or refund'
  );
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

  // 9a. U-4 (P-7b.1a): a paid upgrade invoice writes the plan only when Stripe
  // applied the upgrade. Other invoice kinds never take this branch (SA V-6).
  const u4 = upgradeGuard(facts, subscription);
  if (u4 === 'retry') {
    ctx.log.warn(
      { event: 'bos_billing_upgrade_pending_at_stripe', accountId, invoiceId: facts.invoiceId, subscriptionId: facts.subscriptionId, livemode: ctx.livemode, stripeEventId: event.id },
      'Paid upgrade invoice while Stripe still holds its pending update; releasing for retry'
    );
    throw new PlanPaymentRetryError('upgrade_pending_at_stripe');
  }
  const upgradeNotApplied = u4 === 'not_applied';

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
    assignsPlan: upgradeNotApplied ? false : facts.assignsPlan,
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

  // FU-P7a4-1 (R-6): read only AFTER the apply returned, so nothing it
  // answers can reach the apply. Stripe's step-9 facts alone decide (R-1).
  const lateEnd = paidAfterEnd(facts, subscription);

  await afterApply(deps, ctx, accountId, facts, applied.data, {
    billingCycleAnchor: isoFromUnix(subscription.billingCycleAnchor),
    secondSubscription: held !== null && held !== facts.subscriptionId && replacesSubscriptionId === null,
    upgradeNotApplied,
    paidAfterEnd:
      lateEnd === null
        ? null
        : {
            ...lateEnd,
            billingRowId: account.id,
            recordEndedAt: account.stripeSubscriptionId === facts.subscriptionId ? account.endedAt : null,
          },
  });
}

/**
 * U-4 (P-7b.1a, SA U-4, V-5, V-6). Only a `subscription_update` invoice is
 * judged; every other kind answers `proceed` whatever the subscription holds.
 *
 * - `retry`: Stripe holds a pending update that waits on THIS invoice
 *   (`latestInvoiceId === invoiceId`), so the upgrade may still be applied:
 *   "could not tell". A pending update for a different invoice does not hold
 *   this one (V-5), so a replay of an old upgrade invoice is never parked.
 * - `not_applied`: the invoice would write the plan, but Stripe does not bill
 *   one of its deciding prices on a single item: the money is recorded, the
 *   plan row is not touched.
 */
type UpgradeGuard = 'proceed' | 'retry' | 'not_applied';

function upgradeGuard(
  facts: PlanInvoiceFacts,
  subscription: Awaited<ReturnType<PlanPaymentStripeReads['retrieveBusinessOsSubscription']>>
): UpgradeGuard {
  if (facts.billingReason !== 'subscription_update') return 'proceed';
  if (subscription.pendingUpdate !== null && subscription.latestInvoiceId === facts.invoiceId) return 'retry';
  if (!facts.assignsPlan) return 'proceed';
  const items = subscription.items;
  const onDecidingPrice =
    items.length === 1 && items[0].priceId !== null && facts.decidingPriceIds.includes(items[0].priceId);
  return onDecidingPrice ? 'proceed' : 'not_applied';
}

/** What the stamp's lineage read found (P-5a.1 W-5; P-5b.1 O-4). */
interface StampLineage {
  source: string | null;
  inviteId: string | null;
  outcome: StampLineageRead;
  /** Time the read took, counted against N-2's clock. */
  elapsedMs: number;
}

/**
 * P-5a.1 (SA Q-2, W-5): the lineage `source` of an account whose first
 * payment was just stamped, for the audit entry; P-5b.1 also takes its
 * `invite_id` for N-2. One read by primary key, keyed on the account resolved
 * from our billing record (SR-8), BOUNDED by N-2's clock (O-4). It NEVER
 * throws and never decides anything: a missing port, a failed read, a missing
 * row, a throw or a timeout all give `null` and a warn, and the stamp entry is
 * still written.
 */
async function readStampLineage(deps: PlanPaymentDeps, accountId: string, log: Logger, deadlineMs: number): Promise<StampLineage> {
  const startedAt = Date.now();
  const unread = (outcome: StampLineageRead, reason: string, err?: unknown): StampLineage => {
    // The event name is P-5a.1's, so existing dashboards keep finding it.
    log.warn(
      { event: 'bos_billing_first_payment_source_unread', accountId, reason, outcome, ...(err === undefined ? {} : { err }) },
      'Lineage source of the first payment could not be read; audited without it'
    );
    return { source: null, inviteId: null, outcome, elapsedMs: Date.now() - startedAt };
  };
  if (!deps.lineage) return unread('no_port', 'no_lineage_port');

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timedOut = new Promise<'timed_out'>((resolve) => {
      timer = setTimeout(() => resolve('timed_out'), deadlineMs);
    });
    const reading = deps.lineage.findHoldFactsForAccount(accountId);
    // A late rejection after the timeout must not become an unhandled one.
    reading.catch(() => undefined);
    const read = await Promise.race([reading, timedOut]);
    if (read === 'timed_out') return unread('timed_out', 'read_timed_out');
    if (read.error) return unread('failed', 'read_failed', read.error);
    if (!read.data) return unread('no_row', 'no_lineage_row');
    return { source: read.data.source ?? null, inviteId: read.data.invite_id ?? null, outcome: 'ok', elapsedMs: Date.now() - startedAt };
  } catch (err) {
    return unread('failed', 'read_threw', err);
  } finally {
    clearTimeout(timer);
  }
}

/** The port's clock, or N-1's 4 s when it is missing or malformed. */
function n2DeadlineMs(deps: PlanPaymentDeps): number {
  const value = deps.firstPaymentNotifier?.deadlineMs;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : STAMP_LINEAGE_DEADLINE_MS;
}

/**
 * N-2 (P-5b.1, S5-5, P5-C8): decide whether the champion is owed an email and
 * hand it to the port. Runs after the stamp and invoice-paid entries were
 * flushed. Never throws.
 */
async function notifyFirstPayment(deps: PlanPaymentDeps, ctx: InvoiceContext, accountId: string, lineage: StampLineage, deadlineMs: number): Promise<void> {
  const { log, livemode, event } = ctx;
  const ids = { accountId, livemode, stripeEventId: event.id };

  // An organic first payment: nobody invited them, so nothing was owed and
  // nothing is audited. An `admin_invite` one goes on (P-9.2, T10): only the
  // notifier, reading the invite, can tell an admin Paid invitee (the issuing
  // admin is told) from a champion paying for themself (nobody is).
  if (lineage.source !== null && lineage.source !== 'account_invite' && lineage.source !== 'admin_invite') {
    log.info({ event: 'bos_invite_subscribed_not_applicable', source: lineage.source, ...ids }, 'First payment is not from an invite; no N-2 email');
    return;
  }

  const notifier = deps.firstPaymentNotifier;
  if (!notifier) {
    log.error(
      { event: 'bos_invite_subscribed_notifier_unwired', source: lineage.source, lineageRead: lineage.outcome, ...ids, alert: true },
      'A first payment that may be owed an N-2 email found no notifier wired; nobody was emailed'
    );
    return;
  }

  const input: FirstPaymentNotifyInput = {
    accountId,
    inviteId: lineage.inviteId,
    lineageSource: lineage.source === 'account_invite' || lineage.source === 'admin_invite' ? lineage.source : null,
    lineageRead: lineage.outcome,
    remainingMs: Math.max(0, deadlineMs - lineage.elapsedMs),
    livemode,
    stripeEventId: event.id,
    log,
  };
  // The notifier's own bounds are its clock plus one bounded audit flush.
  const backstopMs = input.remainingMs + AUDIT_FLUSH_TIMEOUT_MS + N2_BACKSTOP_SLACK_MS;

  let backstop: ReturnType<typeof setTimeout> | undefined;
  try {
    const abandoned = new Promise<'abandoned'>((resolve) => {
      backstop = setTimeout(() => resolve('abandoned'), backstopMs);
    });
    // `then` turns a synchronous throw into a rejection, caught below.
    const notifying = Promise.resolve().then(() => notifier.notifyChampion(input));
    // A late rejection after the backstop must not become an unhandled one.
    notifying.catch(() => undefined);
    const first = await Promise.race([notifying.then(() => 'done' as const), abandoned]);
    if (first === 'abandoned') {
      log.warn({ event: 'bos_invite_subscribed_notifier_abandoned', backstopMs, ...ids }, 'N-2 notifier abandoned at its backstop; the payment is unaffected');
    }
  } catch (err) {
    // By error class only: the text could carry an address.
    log.warn(
      { event: 'bos_invite_subscribed_notifier_failed', errName: err instanceof Error ? err.name : typeof err, ...ids },
      'N-2 notifier failed; the payment is unaffected'
    );
  } finally {
    clearTimeout(backstop);
  }
}

async function afterApply(
  deps: PlanPaymentDeps,
  ctx: InvoiceContext,
  accountId: string,
  facts: PlanInvoiceFacts,
  result: BusinessOsApplyPlanPaymentResult,
  extra: { billingCycleAnchor: string; secondSubscription: boolean; upgradeNotApplied: boolean; paidAfterEnd?: PaidAfterEndAlert | null }
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
      // P-3b's line, written the moment the money committed (SA F-1): a
      // function cut off mid-chain still leaves the commit-time evidence.
      log.info(
        { event: 'bos_billing_invoice_applied', status: result.status, planWritten: result.planWritten, anchorSet: result.anchorSet, tier: facts.tier, ...ids },
        'Business OS plan invoice applied'
      );
      // FU-P7a4-1: at the commit, beside the line above, before the post-commit chain.
      if (extra.paidAfterEnd) {
        logPaidAfterEnd(log, extra.paidAfterEnd, ids, facts, {
          status: result.status,
          eventRowId: result.eventRowId,
          planWritten: result.planWritten,
          tierBefore: result.tierBefore,
          tierAfter: result.tierAfter,
        });
      }
      // C-4 (as amended by SA F-1): the post-commit chain is timed on its own
      // line, written once that chain has settled.
      const committedAt = Date.now();
      try {
        await afterCommit(deps, ctx, accountId, facts, result, extra);
      } finally {
        log.info(
          { event: 'bos_billing_invoice_post_commit', status: result.status, ...ids, postCommitMs: Date.now() - committedAt },
          'Business OS plan invoice post-commit chain settled'
        );
      }
      // P-6a.2: after N-2's clock, so its budget is unchanged. Never throws.
      await cureRenewalFailure(deps, ctx, accountId, facts);
      return;
    }

    case 'already_applied':
      // A replay: nothing written, nothing audited (as the admin replay branch).
      log.info({ event: 'bos_billing_invoice_replayed', status: result.status, eventRowId: result.eventRowId, ...ids }, 'Business OS plan invoice already handled');
      // P-6a.2: the cure is idempotent, so a crash between the commit and the
      // cure heals on Stripe's retry.
      await cureRenewalFailure(deps, ctx, accountId, facts);
      return;

    case 'already_recorded':
      // A replayed refusal: its money was never applied, so nothing is cured.
      log.info({ event: 'bos_billing_invoice_replayed', status: result.status, eventRowId: result.eventRowId, ...ids }, 'Business OS plan invoice already handled');
      return;

    case 'subscription_conflict': {
      // The function wrote the refusal row itself (C-1), or found the event already recorded.
      const refusalReason = extra.secondSubscription ? 'second_subscription' : 'subscription_held_elsewhere';
      log.error(
        { event: 'bos_billing_payment_refused', reason: refusalReason, eventRowId: result.eventRowId, ...ids, alert: true },
        'Business OS plan payment refused: subscription conflict'
      );
      // FU-P7a4-1 (SA R-4): on a NEW refusal row only, so it fires once (e.g.
      // the owner re-subscribed, then paid the ended subscription's invoice).
      if (extra.paidAfterEnd && result.eventRowId !== null) {
        logPaidAfterEnd(log, extra.paidAfterEnd, ids, facts, {
          status: result.status,
          eventRowId: result.eventRowId,
          planWritten: false,
          tierBefore: null,
          tierAfter: null,
        });
      }
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

/**
 * `applied` / `recorded`: everything after the money committed. Nothing in
 * here may throw (S5-5 b): the audit is guarded and N-2 is behind a backstop.
 */
async function afterCommit(
  deps: PlanPaymentDeps,
  ctx: InvoiceContext,
  accountId: string,
  facts: PlanInvoiceFacts,
  result: Extract<BusinessOsApplyPlanPaymentResult, { status: 'applied' | 'recorded' }>,
  extra: { billingCycleAnchor: string; secondSubscription: boolean; upgradeNotApplied: boolean }
): Promise<void> {
  const { event, livemode, log } = ctx;
  const ids = {
    accountId,
    invoiceId: facts.invoiceId,
    subscriptionId: facts.subscriptionId,
    livemode,
    stripeEventId: event.id,
  };
  // U-4 case 2 (SA Q-3): only here, on a NEW money history row, so a
  // replay (`already_*`) alerts nothing. The alert is this error line.
  if (extra.upgradeNotApplied) {
    log.error(
      { event: 'bos_billing_upgrade_paid_not_applied', tier: facts.tier, eventRowId: result.eventRowId, ...ids, alert: true },
      'Upgrade paid but not applied at Stripe: money recorded, plan row untouched'
    );
  }

  // P-5a.1: the stamp entry, built only from the function's own flag and
  // always written when it is true (W-5), whatever the lineage read says.
  // P-5b.1 (O-4): the read runs under N-2's clock, which starts here.
  const stamped = result.firstPaymentStamped === true;
  const deadlineMs = n2DeadlineMs(deps);
  const lineage = stamped ? await readStampLineage(deps, accountId, log, deadlineMs) : null;
  const companionEntries =
    lineage !== null
      ? [
          {
            action: 'BOS_BILLING_FIRST_PAYMENT_STAMPED',
            entityType: 'business_os_account_lineage' as const,
            entityId: accountId,
            details: {
              invoiceId: facts.invoiceId,
              eventRowId: result.eventRowId,
              source: lineage.source,
              livemode,
              stripeEventId: event.id,
            },
            severity: 'info' as const,
          },
        ]
      : [];
  if (companionEntries.length > 0) {
    log.info(
      { event: 'bos_billing_first_payment_stamped', eventRowId: result.eventRowId, source: companionEntries[0].details.source, ...ids },
      'Business OS first payment stamped'
    );
  }

  try {
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
        // U-9 (P-7b.1a): an upgrade's tier change is visible as such.
        billingReason: facts.billingReason,
        planWritten: result.planWritten,
        anchorSet: result.anchorSet,
        livemode,
        stripeEventId: event.id,
        eventRowId: result.eventRowId,
        ...(extra.upgradeNotApplied ? { upgradeNotApplied: true } : {}),
      },
      severity: extra.upgradeNotApplied ? 'warning' : 'info',
      // Only a written plan row changes what the account is entitled to.
      invalidatesEntitlements: result.planWritten,
      log,
      ...(companionEntries.length > 0 ? { companionEntries } : {}),
    });
  } catch (err) {
    // S5-5 b: `recordPlanChange` never rejects by contract; if it ever did,
    // the payment is committed and a retry would only replay, so this is
    // logged and the event completes.
    log.error({ err, event: 'bos_billing_invoice_audit_failed', ...ids, alert: true }, 'Business OS plan invoice audit failed after the apply');
  }

  // P-5b.1 (N-2, S5-5): only after the stamp and invoice-paid entries were
  // flushed, and only for a stamped first payment. Never throws.
  if (lineage !== null) await notifyFirstPayment(deps, ctx, accountId, lineage, deadlineMs);
}

// ── P-6a.2: the cure after a paid invoice ───────────────────────────────────

/**
 * SA C-1 ruling, rule 5: clear the renewal-failure marker when the paid
 * invoice is the newest (`P >= current_period_end`, decided by the
 * repository). Runs after the money committed, so it NEVER throws: a failure
 * is a `warn` with ids, and the next delivery of the paid event heals it.
 */
async function cureRenewalFailure(deps: PlanPaymentDeps, ctx: InvoiceContext, accountId: string, facts: PlanInvoiceFacts): Promise<void> {
  const { event, livemode, log } = ctx;
  const ids = { accountId, invoiceId: facts.invoiceId, subscriptionId: facts.subscriptionId, livemode, stripeEventId: event.id };
  try {
    const cured = await deps.billingAccounts.clearRenewalFailure({
      userId: accountId,
      livemode,
      stripeSubscriptionId: facts.subscriptionId,
      paidPeriodEndIso: facts.periodEnd,
      nowIso: (deps.now ?? (() => new Date()))().toISOString(),
    });
    if (cured.error || !cured.data) {
      log.warn(
        { event: 'bos_billing_renewal_failure_clear_failed', errName: cured.error?.name ?? 'no_data', errMessage: cured.error?.message, ...ids },
        'Renewal failure marker not cleared after a paid invoice; the next delivery retries it'
      );
      return;
    }
    if (cured.data.outcome === 'cleared') {
      log.info({ event: 'bos_billing_renewal_failure_cleared', ...ids }, 'Renewal failure marker cleared by a paid invoice');
    }
  } catch (err) {
    log.warn(
      { event: 'bos_billing_renewal_failure_clear_failed', errName: err instanceof Error ? err.name : typeof err, ...ids },
      'Renewal failure marker not cleared after a paid invoice; the next delivery retries it'
    );
  }
}

// ── invoice.payment_failed / invoice.payment_action_required ────────────────

type UnpaidKind = 'failed' | 'action_required';

const UNPAID = {
  failed: {
    historyKind: 'invoice_payment_failed',
    audit: 'BOS_BILLING_PAYMENT_FAILED',
    recordedEvent: 'bos_billing_payment_failed',
    replayedEvent: 'bos_billing_payment_failed_replayed',
    recordedMessage: 'Business OS plan payment failed and recorded',
    replayedMessage: 'Business OS failed plan payment already recorded',
  },
  action_required: {
    historyKind: 'payment_action_required',
    audit: 'BOS_BILLING_PAYMENT_ACTION_REQUIRED',
    recordedEvent: 'bos_billing_payment_action_required',
    replayedEvent: 'bos_billing_payment_action_required_replayed',
    recordedMessage: 'Business OS plan payment needs authentication and was recorded',
    replayedMessage: 'Business OS plan payment authentication request already recorded',
  },
} as const;

/** Stripe's `attempt_count`, or 0 when it is missing or unreadable (the decision floors it at 1). */
function attemptCountOf(invoice: Stripe.Invoice): number {
  const value = (invoice as unknown as { attempt_count?: unknown }).attempt_count;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/** The invoice's hosted URL as Stripe sent it. A bearer link: never logged, never audited. */
function hostedInvoiceUrlOf(invoice: Stripe.Invoice): string | null {
  const value = (invoice as unknown as { hosted_invoice_url?: unknown }).hosted_invoice_url;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** SA Q-2, P-6a.2: one money-history row for a failed plan payment; a renewal also counts on the billing record. */
export async function recordFailedPlanInvoice(event: Stripe.Event, log: Logger, deps: PlanPaymentDeps): Promise<void> {
  return recordUnpaidPlanInvoice(event, log, deps, 'failed');
}

/** P-6a.2 (§5.4): a plan invoice that needs 3-D Secure; a renewal also stores the hosted URL for the owner's banner. */
export async function recordActionRequiredPlanInvoice(event: Stripe.Event, log: Logger, deps: PlanPaymentDeps): Promise<void> {
  return recordUnpaidPlanInvoice(event, log, deps, 'action_required');
}

async function recordUnpaidPlanInvoice(event: Stripe.Event, log: Logger, deps: PlanPaymentDeps, kind: UnpaidKind): Promise<void> {
  const checked = await checkInvoice(deps, event, 'failed', log);
  if (!checked) return;
  const { ctx, accountId, facts } = checked;
  const words = UNPAID[kind];
  const invoice = event.data.object as Stripe.Invoice;

  const recorded = await deps.billingEvents.recordEvent({
    accountId,
    livemode: ctx.livemode,
    kind: words.historyKind,
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
  const eventRowId = recorded.data.outcome === 'recorded' ? recorded.data.eventRowId : null;
  const isNew = eventRowId !== null;
  if (isNew) {
    log.warn({ event: words.recordedEvent, amountMinor: facts.amountMinor, billingReason: facts.billingReason, eventRowId, ...ids }, words.recordedMessage);
  } else {
    log.info({ event: words.replayedEvent, ...ids }, words.replayedMessage);
  }

  // U-10: only a renewal counts. An upgrade's failure (or 3-D Secure) is the
  // owner's in-session answer, already audited as BOS_BILLING_UPGRADE_REQUESTED;
  // its history row above is the record of what Stripe sent, nothing more.
  if (!isRenewalInvoice(facts.billingReason)) {
    log.info(
      { event: 'bos_billing_payment_failure_not_renewal', billingReason: facts.billingReason, eventType: event.type, ...ids },
      'Failed or unconfirmed plan payment is not a renewal: no billing record write, no audit (U-10)'
    );
    return;
  }

  const attemptCount = attemptCountOf(invoice);
  const hostedInvoiceUrl = hostedInvoiceUrlOf(invoice);
  if (kind === 'action_required' && !isHostedInvoiceUrl(hostedInvoiceUrl)) {
    // Never the value: it is a bearer link (or junk). The owner still sees
    // "payment failed" from the attempt count and Stripe's status.
    log.warn(
      { event: 'bos_billing_action_required_url_unusable', hasUrl: hostedInvoiceUrl !== null, ...ids },
      'Renewal needs authentication but its hosted invoice URL is not a Stripe page; not stored'
    );
  }

  // Audited BEFORE the billing write, on a new row only: a write that throws
  // releases the claim, and the retry finds a duplicate row, so writing the
  // audit after it would lose it for good.
  if (isNew) {
    await deps.recordPlanChange({
      accountId,
      action: words.audit,
      actor: { kind: 'system', source: 'stripe_webhook' },
      entityType: 'business_os_account_plan',
      entityId: accountId,
      changes: {},
      details: {
        invoiceId: facts.invoiceId,
        subscriptionId: facts.subscriptionId,
        attemptCount,
        billingReason: facts.billingReason,
        livemode: ctx.livemode,
        stripeEventId: event.id,
        eventRowId,
      },
      severity: 'info',
      invalidatesEntitlements: false,
      log,
    });
  }

  // C-3: whether the history row is new or a replay (idempotent, order-safe).
  const input = {
    userId: accountId,
    livemode: ctx.livemode,
    stripeSubscriptionId: facts.subscriptionId,
    invoiceId: facts.invoiceId,
    periodEndIso: facts.periodEnd,
    attemptCount,
    // Display only (C-1, rule 6): never compared with a Stripe timestamp.
    failedAtIso: new Date(event.created * 1000).toISOString(),
    hostedInvoiceUrl,
    nowIso: (deps.now ?? (() => new Date()))().toISOString(),
  };
  const written =
    kind === 'action_required'
      ? await deps.billingAccounts.recordActionRequired(input)
      : await deps.billingAccounts.recordRenewalFailure(input);
  if (written.error || !written.data) {
    if (written.error?.message === 'concurrent_change') throw new PlanPaymentRetryError('renewal_failure_concurrent_change');
    throw written.error ?? new PlanPaymentRetryError('renewal_failure_not_recorded');
  }
  log.info(
    {
      event: 'bos_billing_renewal_failure_counted',
      outcome: written.data.outcome,
      ...(written.data.outcome === 'moot' ? { reason: written.data.reason } : {}),
      ...(written.data.outcome === 'recorded'
        ? { failedAttempts: written.data.failedAttempts, actionRequiredUrlStored: written.data.actionRequiredUrlStored }
        : {}),
      attemptCount,
      ...ids,
    },
    'Business OS renewal failure counted on the billing record'
  );
}
