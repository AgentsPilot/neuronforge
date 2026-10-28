/**
 * Plan payments P-6a.2 (workplan §10 "Captured fixtures", T10; SA C-1 ruling,
 * C-3, C-4, U-10): the REAL webhook code over the events Stripe actually sent.
 *
 *   - X-1 to X-5 (P-6a.1, T4, standard sandbox on test clocks): a renewal paid,
 *     a renewal failed (`past_due`), recovered by a paid retry, Stripe giving
 *     up (`customer.subscription.deleted`), and a 3-D Secure renewal
 *     (`payment_action_required` AND `payment_failed`, both `attempt_count: 0`).
 *     Every event's `created` is REAL time while every invoice and subscription
 *     date is the CLOCK's (months later): the C-1 finding. These tests pass only
 *     because nothing compares the two.
 *   - E-1b, E-2, E-4 (P-7b.1): UPGRADE failures and 3-D Secure. U-10's
 *     negatives: a history row, no billing write, no audit, and the captured
 *     subscription stays `active`, so the owner is told nothing.
 *
 * The ports around the real code are fakes of OUR tables (Jest cannot run SQL):
 * the billing repository's renewal writes go through its REAL pure decisions
 * (`decideRenewalFailure`, `decideRenewalCure`), and the apply function's
 * "newest invoice" rule is modelled as in `planPaymentApply.test.ts`.
 *
 * The hosted invoice URLs in the captures were scrubbed to
 * `https://example.invalid/scrubbed`; the 3-D Secure scenario puts a
 * Stripe-shaped one back, as the live event carries.
 */

import fs from 'fs';
import path from 'path';
import type Stripe from 'stripe';

import {
  applyPaidPlanInvoice,
  recordActionRequiredPlanInvoice,
  recordFailedPlanInvoice,
  type PlanPaymentDeps,
} from '@/lib/business-os/billing/planPaymentApply';
import { mirrorPlanSubscription, type PlanSubscriptionMirrorDeps } from '@/lib/business-os/billing/planSubscriptionMirror';
import { createPlanResolver } from '@/lib/business-os/billing/planInvoiceResolver';
import { planPaymentNotice } from '@/lib/business-os/billing/planPaymentNotice';
import { planTierForLookupKey } from '@/lib/business-os/billing/planPriceCatalog';
import {
  decideRenewalCure,
  decideRenewalFailure,
  type BusinessOsBillingAccount,
  type RenewalFailureInput,
} from '@/lib/repositories/BusinessOsBillingAccountRepository';
import type { BusinessOsApplyPlanPaymentInput, BusinessOsBillingEventInput } from '@/lib/repositories/BusinessOsBillingEventRepository';
import type { RecordPlanChangeInput } from '@/lib/business-os/entitlements/recordPlanChange';
import type { ResolverContext } from '@/lib/business-os/billing/webhookDispatcher';
import type { Logger } from '@/lib/logger';

const FIXTURES = path.join(__dirname, 'fixtures', 'stripe');
const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const HOSTED = 'https://invoice.stripe.com/i/acct_probe/test_renewal_capture?s=ap';

/** A captured payload, without our `_fixture_*` notes, as a fresh copy. */
function cap<T = Stripe.Event>(name: string): T {
  const file = fs.readdirSync(FIXTURES).find((f) => f.startsWith(`captured-${name}`) && f.endsWith('.json'));
  if (!file) throw new Error(`no captured fixture ${name}`);
  const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES, file), 'utf8')) as Record<string, unknown>;
  for (const key of Object.keys(raw)) if (key.startsWith('_fixture_')) delete raw[key];
  return raw as T;
}

// The two plan prices exactly as Stripe sent them; their lookup keys name the tiers (no literal).
type CapturedPrice = { id: string; lookup_key: string };
const BASIC_PRICE = cap<{ items: { data: Array<{ price: CapturedPrice }> } }>('p7b1-e4-10-subscription-after-expiry').items.data[0].price;
const PRO_PRICE = cap<{ items: { data: Array<{ price: CapturedPrice }> } }>('p7b1-e1a-02-update-response').items.data[0].price;
const BASIC = planTierForLookupKey(BASIC_PRICE.lookup_key) as string;
const PRO = planTierForLookupKey(PRO_PRICE.lookup_key) as string;
const CATALOG = {
  load: jest.fn(async () => ({
    byPriceId: new Map([
      [BASIC_PRICE.id, BASIC_PRICE.lookup_key],
      [PRO_PRICE.id, PRO_PRICE.lookup_key],
    ]),
    fromCache: false,
  })),
};

const RESOLVER_CTX: ResolverContext = { log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as Logger };

const invoiceOf = (event: Stripe.Event) => event.data.object as Stripe.Invoice;
const subscriptionIdOf = (event: Stripe.Event) => invoiceOf(event).parent!.subscription_details!.subscription as string;
const lineEnd = (event: Stripe.Event) => new Date(invoiceOf(event).lines.data[0].period.end * 1000).toISOString();
const iso = (unix: number) => new Date(unix * 1000).toISOString();

/** Our two tables around the real code. */
class World {
  billing: BusinessOsBillingAccount;
  history: BusinessOsBillingEventInput[] = [];
  paid: BusinessOsApplyPlanPaymentInput[] = [];
  audits: RecordPlanChangeInput[] = [];
  logLines: Array<{ level: string; ctx: Record<string, unknown> }> = [];
  private seq = 0;

  constructor(subscriptionId: string, customerId: string, currentPeriodEnd: string, boughtTier: string = BASIC) {
    this.billing = {
      id: '33333333-3333-4333-8333-333333333333',
      accountId: ACCOUNT,
      livemode: false,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      subscriptionStatus: 'active',
      boughtTier,
      currentPeriodEnd,
      cancelAtPeriodEnd: false,
      pendingTier: null,
      openCheckoutSessionId: null,
      openCheckoutExpiresAt: null,
      lastInvoiceId: 'in_before_capture',
      lastPaidAt: currentPeriodEnd,
      lastPaymentFailedAt: null,
      failedAttempts: 0,
      actionRequiredInvoiceUrl: null,
      founderDiscountAppliedAt: null,
      endedAt: null,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    };
  }

  private rowId(): string {
    this.seq += 1;
    return `44444444-4444-4444-8444-${String(this.seq).padStart(12, '0')}`;
  }

  get log(): Logger {
    const at = (level: string) => (ctx: Record<string, unknown>) => {
      this.logLines.push({ level, ctx });
    };
    return { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug') } as unknown as Logger;
  }

  record(input: BusinessOsBillingEventInput) {
    if (this.history.some((h) => h.stripeEventId === input.stripeEventId)) return { outcome: 'duplicate' as const };
    this.history.push(input);
    return { outcome: 'recorded' as const, eventRowId: this.rowId() };
  }

  /** The apply function's billing-row rules (20261028): newest by period end, then paid time. */
  apply(input: BusinessOsApplyPlanPaymentInput) {
    if (this.paid.some((p) => p.stripeInvoiceId === input.stripeInvoiceId)) return { status: 'already_applied' as const, eventRowId: this.rowId() };
    this.paid.push(input);
    const row = this.billing;
    const newest = row.currentPeriodEnd === null || Date.parse(input.periodEnd) >= Date.parse(row.currentPeriodEnd);
    this.billing = {
      ...row,
      subscriptionStatus: input.subscriptionStatus,
      currentPeriodEnd: newest ? input.periodEnd : row.currentPeriodEnd,
      lastInvoiceId: newest ? input.stripeInvoiceId : row.lastInvoiceId,
      lastPaidAt: newest ? input.paidAt : row.lastPaidAt,
    };
    return { status: 'applied' as const, eventRowId: this.rowId(), tierBefore: input.tier, tierAfter: input.tier, planWritten: newest, anchorSet: false, firstPaymentStamped: false };
  }

  renewal(input: RenewalFailureInput, actionRequired: boolean) {
    const row = this.billing.accountId === input.userId && this.billing.livemode === input.livemode ? this.billing : null;
    const decision = decideRenewalFailure(row, { ...input, actionRequired });
    if (decision.kind === 'moot') return { outcome: 'moot' as const, reason: decision.reason };
    if (decision.kind === 'unchanged') return { outcome: 'unchanged' as const };
    this.billing = { ...this.billing, failedAttempts: decision.failedAttempts, lastPaymentFailedAt: decision.lastPaymentFailedAt, actionRequiredInvoiceUrl: decision.actionRequiredInvoiceUrl };
    return { outcome: 'recorded' as const, failedAttempts: decision.failedAttempts, actionRequiredUrlStored: decision.actionRequiredInvoiceUrl !== null };
  }

  cure(input: { userId: string; livemode: boolean; stripeSubscriptionId: string; paidPeriodEndIso: string }) {
    const decision = decideRenewalCure(this.billing.accountId === input.userId ? this.billing : null, input);
    if (decision.kind === 'nothing') return { outcome: 'nothing' as const, reason: decision.reason };
    this.billing = { ...this.billing, failedAttempts: 0, actionRequiredInvoiceUrl: null };
    return { outcome: 'cleared' as const };
  }
}

/** Stripe's subscription, as the fresh read maps it, from a captured subscription object. */
function freshFrom(subscription: Stripe.Subscription) {
  return {
    id: subscription.id,
    status: subscription.status,
    customerId: subscription.customer as string,
    billingCycleAnchor: subscription.billing_cycle_anchor,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    endedAt: subscription.ended_at ?? null,
    livemode: subscription.livemode,
    metadata: {},
    priceIds: subscription.items.data.map((i) => i.price.id),
    items: subscription.items.data.map((i) => ({ id: i.id, priceId: i.price.id, currentPeriodStart: null, currentPeriodEnd: null })),
    pendingUpdate: null,
    latestInvoiceId: null,
  };
}

function harness(world: World, subscriptionNow: () => Stripe.Subscription | null = () => null) {
  const ports = {
    recordRenewalFailure: jest.fn(async (input: RenewalFailureInput) => ({ data: world.renewal(input, false), error: null })),
    recordActionRequired: jest.fn(async (input: RenewalFailureInput) => ({ data: world.renewal(input, true), error: null })),
    clearRenewalFailure: jest.fn(async (input: { userId: string; livemode: boolean; stripeSubscriptionId: string; paidPeriodEndIso: string }) => ({ data: world.cure(input), error: null })),
  };
  const find = (match: (row: BusinessOsBillingAccount) => boolean) => async () => ({ data: match(world.billing) ? world.billing : null, error: null });
  const retrieve = jest.fn(async () => {
    const sub = subscriptionNow();
    if (!sub) throw new Error('no fresh subscription in this scenario');
    return freshFrom(sub);
  });
  const deps: PlanPaymentDeps & PlanSubscriptionMirrorDeps = {
    billingAccounts: {
      findByStripeSubscription: jest.fn(async (id: string) => find((r) => r.stripeSubscriptionId === id)()),
      findByStripeCustomer: jest.fn(async (id: string) => find((r) => r.stripeCustomerId === id)()),
      mirrorSubscriptionState: jest.fn(async (input: { status: BusinessOsBillingAccount['subscriptionStatus']; cancelAtPeriodEnd: boolean; endedAtIso: string | null; stripeSubscriptionId: string }) => {
        if (world.billing.stripeSubscriptionId !== input.stripeSubscriptionId) return { data: { mirrored: false }, error: null };
        world.billing = { ...world.billing, subscriptionStatus: input.status, cancelAtPeriodEnd: input.cancelAtPeriodEnd, endedAt: input.endedAtIso };
        return { data: { mirrored: true }, error: null };
      }),
      ...ports,
    } as unknown as PlanPaymentDeps['billingAccounts'] & PlanSubscriptionMirrorDeps['billingAccounts'],
    billingEvents: {
      applyPlanPayment: jest.fn(async (input: BusinessOsApplyPlanPaymentInput) => ({ data: world.apply(input), error: null })),
      recordEvent: jest.fn(async (input: BusinessOsBillingEventInput) => ({ data: world.record(input), error: null })),
    } as unknown as PlanPaymentDeps['billingEvents'],
    stripe: () => ({ listInvoiceLinesAll: jest.fn(), retrieveBusinessOsSubscription: retrieve }) as unknown as ReturnType<PlanPaymentDeps['stripe']>,
    catalog: CATALOG,
    entitlementConfig: () => ({ tierOrder: [BASIC, PRO], matrix: { version: 1 } }) as unknown as ReturnType<PlanPaymentDeps['entitlementConfig']>,
    recordPlanChange: jest.fn(async (input: RecordPlanChangeInput) => {
      world.audits.push(input);
    }),
    // D3.1 (SX-2b): the after-plan move port, a stub (its own suite is afterPlanMove.test.ts).
    afterPlanMove: jest.fn(async () => undefined),
    now: () => new Date('2026-10-15T09:00:00.000Z'),
  };
  return { deps, ports, retrieve };
}

/** The banner and Settings answer for the row now, in test mode. */
const noticeFor = (world: World, state = 'active', graceEndsAt: string | null = null, enforcing = false) =>
  planPaymentNotice(world.billing, { state, graceEndsAt }, { serverLivemode: false, enforcing });

describe('X-1 to X-4: a renewal paid, failed, recovered, then given up by Stripe (C-1: decided by periods)', () => {
  const x1Paid = cap('p6a-x1-event-invoice-paid');
  const x2Updated = cap('p6a-x2-event-customer-subscription-updated');
  const x2Failed = cap('p6a-x2-event-invoice-payment_failed');
  const x3Paid = cap('p6a-x3-event-invoice-paid');
  const x3Updated = cap('p6a-x3-event-customer-subscription-updated');
  const x4Failed = cap('p6a-x4-event-invoice-payment_failed');
  const x4Deleted = cap('p6a-x4-event-customer-subscription-deleted');
  const SUB = subscriptionIdOf(x1Paid);
  const CUSTOMER = invoiceOf(x1Paid).customer as string;

  it('the captures carry the C-1 finding: event.created is real time, months BEFORE the clock-time periods', () => {
    for (const event of [x2Failed, x3Paid, x4Failed]) {
      expect(event.created * 1000).toBeLessThan(Date.parse(lineEnd(event)) - 30 * 86_400_000);
    }
    // X-1: the invoice's own period_end names the PREVIOUS period; the line's is the new paid-through date.
    expect(Date.parse(lineEnd(x1Paid))).toBeGreaterThan(invoiceOf(x1Paid).period_end * 1000);
  });

  it('walks the whole story through the real code', async () => {
    const world = new World(SUB, CUSTOMER, iso(invoiceOf(x1Paid).period_end));
    let current: Stripe.Subscription = x2Updated.data.object as Stripe.Subscription;
    const { deps, ports } = harness(world, () => current);

    // X-1: the renewal is paid. The paid-through date is the LINE's period end (P), not invoice.period_end.
    current = { ...(x2Updated.data.object as Stripe.Subscription), status: 'active' };
    await applyPaidPlanInvoice(x1Paid, world.log, deps);
    expect(world.billing.currentPeriodEnd).toBe(lineEnd(x1Paid));
    expect(noticeFor(world)).toBeNull();

    // X-2: past_due first (same second, delivered first), then the failure, attempt 1.
    current = x2Updated.data.object as Stripe.Subscription;
    await mirrorPlanSubscription(x2Updated, world.log, deps);
    expect(world.billing.subscriptionStatus).toBe('past_due');
    expect(noticeFor(world)).toMatchObject({ kind: 'payment_failed', attempts: 1 });
    await recordFailedPlanInvoice(x2Failed, world.log, deps);
    expect(world.billing).toMatchObject({ failedAttempts: 1, lastPaymentFailedAt: iso(x2Failed.created) });
    expect(world.audits.map((a) => a.action)).toEqual(['BOS_BILLING_INVOICE_PAID', 'BOS_BILLING_PAYMENT_FAILED']);
    // The banner while in grace names the lifecycle's own pause date.
    expect(noticeFor(world, 'grace', '2027-01-21T07:05:22.000Z')).toEqual({
      kind: 'payment_failed',
      tier: BASIC,
      failedAt: iso(x2Failed.created),
      attempts: 1,
      pauseBy: '2027-01-21T07:05:22.000Z',
    });

    // X-3: the retry is paid (attempt 2): the newest invoice clears the marker; then status active.
    current = x3Updated.data.object as Stripe.Subscription;
    await applyPaidPlanInvoice(x3Paid, world.log, deps);
    expect(world.billing).toMatchObject({ currentPeriodEnd: lineEnd(x3Paid), failedAttempts: 0, lastPaymentFailedAt: iso(x2Failed.created) });
    await mirrorPlanSubscription(x3Updated, world.log, deps);
    expect(noticeFor(world)).toBeNull();

    // A late redelivery of X-2's failure after its cure writes nothing (P <= current_period_end).
    ports.recordRenewalFailure.mockClear();
    await recordFailedPlanInvoice(x2Failed, world.log, deps);
    expect(world.billing.failedAttempts).toBe(0);
    expect(world.audits.filter((a) => a.action === 'BOS_BILLING_PAYMENT_FAILED')).toHaveLength(1);

    // X-4: the next period's invoice fails 9 times; the last capture is attempt 9.
    current = { ...(x4Deleted.data.object as Stripe.Subscription), status: 'past_due', ended_at: null };
    await recordFailedPlanInvoice(x4Failed, world.log, deps);
    expect(world.billing.failedAttempts).toBe(9);

    // Stripe gives up: canceled, ended_at, one subscription_ended row and one audit.
    current = x4Deleted.data.object as Stripe.Subscription;
    await mirrorPlanSubscription(x4Deleted, world.log, deps);
    expect(world.billing).toMatchObject({ subscriptionStatus: 'canceled', endedAt: iso((x4Deleted.data.object as Stripe.Subscription).ended_at as number) });
    expect(world.history.filter((h) => h.kind === 'subscription_ended')).toEqual([
      expect.objectContaining({ stripeSubscriptionId: SUB, stripeCustomerId: CUSTOMER, tier: BASIC, stripeEventId: x4Deleted.id }),
    ]);
    expect(world.audits.filter((a) => a.action === 'BOS_BILLING_SUBSCRIPTION_ENDED')).toEqual([
      expect.objectContaining({ severity: 'info', details: expect.objectContaining({ cancellationReason: 'payment_failed' }) }),
    ]);
    // D3.1: the captured Stripe give-up hands the after-plan port `payment_failed`, which never moves (today's path).
    expect(deps.afterPlanMove).toHaveBeenCalledWith(expect.objectContaining({ cancellationReason: 'payment_failed', stripeEventId: x4Deleted.id }), expect.anything());
    // The owner reads "ended" while paused; a Founding Partner whose free access resumed reads nothing (AC-F6.5).
    expect(noticeFor(world, 'paused')).toEqual({ kind: 'ended', tier: BASIC, endedAt: world.billing.endedAt });
    expect(noticeFor(world, 'champion')).toBeNull();

    // Only the paid apply path ever moved current_period_end (C-1 rule 3).
    expect(world.billing.currentPeriodEnd).toBe(lineEnd(x3Paid));
  });
});

describe('X-5: a 3-D Secure renewal (action required AND failed, attempt_count 0), then paid', () => {
  const x5Action = cap('p6a-x5-event-invoice-payment_action_required');
  const x5Failed = cap('p6a-x5-event-invoice-payment_failed');
  const x5Updated = cap('p6a-x5-event-customer-subscription-updated');
  const x5bPaid = cap('p6a-x5b-event-invoice-paid');
  const SUB = subscriptionIdOf(x5Action);
  const CUSTOMER = invoiceOf(x5Action).customer as string;
  const withHosted = (event: Stripe.Event) => {
    (invoiceOf(event) as unknown as { hosted_invoice_url: string }).hosted_invoice_url = HOSTED;
    return event;
  };

  it.each([
    ['action required first', true],
    ['failure first', false],
  ])('%s: one attempt, the URL stored, "Confirm payment"; the paid invoice clears both', async (_label, actionFirst) => {
    const world = new World(SUB, CUSTOMER, iso(invoiceOf(x5Action).period_end));
    const current = x5Updated.data.object as Stripe.Subscription;
    const { deps } = harness(world, () => current);
    expect([invoiceOf(x5Action).attempt_count, invoiceOf(x5Failed).attempt_count]).toEqual([0, 0]);

    await mirrorPlanSubscription(x5Updated, world.log, deps);
    const action = withHosted(cap('p6a-x5-event-invoice-payment_action_required'));
    const failed = withHosted(cap('p6a-x5-event-invoice-payment_failed'));
    if (actionFirst) {
      await recordActionRequiredPlanInvoice(action, world.log, deps);
      await recordFailedPlanInvoice(failed, world.log, deps);
    } else {
      await recordFailedPlanInvoice(failed, world.log, deps);
      await recordActionRequiredPlanInvoice(action, world.log, deps);
    }
    expect(world.billing).toMatchObject({ subscriptionStatus: 'past_due', failedAttempts: 1, actionRequiredInvoiceUrl: HOSTED });
    expect(noticeFor(world)).toEqual({ kind: 'action_required', tier: BASIC, failedAt: iso(x5Action.created), dueOn: world.billing.currentPeriodEnd, confirmUrl: HOSTED });
    expect(world.audits.map((a) => a.action).sort()).toEqual(['BOS_BILLING_PAYMENT_ACTION_REQUIRED', 'BOS_BILLING_PAYMENT_FAILED']);
    expect(JSON.stringify({ logs: world.logLines, audits: world.audits })).not.toContain('invoice.stripe.com');

    await applyPaidPlanInvoice(x5bPaid, world.log, harness(world, () => ({ ...current, status: 'active' })).deps);
    expect(world.billing).toMatchObject({ failedAttempts: 0, actionRequiredInvoiceUrl: null, currentPeriodEnd: lineEnd(x5bPaid) });
  });

  it('the resolver routes the captured action-required renewal only while the price switch is on, with no read when off', async () => {
    const stripe = { listInvoiceLinesAll: jest.fn(), listCheckoutSessionPriceIds: jest.fn(), retrieveBusinessOsSubscription: jest.fn() };
    CATALOG.load.mockClear();
    const off = createPlanResolver({ catalog: CATALOG, stripe: () => stripe, recognitionEnabled: () => false });
    await expect(off.resolve(x5Action, RESOLVER_CTX)).resolves.toEqual({ kind: 'not_business_os' });
    expect(CATALOG.load).not.toHaveBeenCalled();
    expect(stripe.listInvoiceLinesAll).not.toHaveBeenCalled();
    const on = createPlanResolver({ catalog: CATALOG, stripe: () => stripe, recognitionEnabled: () => true });
    await expect(on.resolve(x5Action, RESOLVER_CTX)).resolves.toMatchObject({ kind: 'flow', flow: 'plan' });
  });
});

describe('U-10 negatives over the P-7b.1 captures: an UPGRADE that fails or asks for 3-D Secure tells the owner nothing', () => {
  it.each([
    ['E-1b payment_failed', 'p7b1-e1b-event-invoice-payment_failed', 'p7b1-e1b-event-customer-subscription-updated-nRvRUW', 'failed'],
    ['E-1b payment_action_required', 'p7b1-e1b-event-invoice-payment_action_required', 'p7b1-e1b-event-customer-subscription-updated-Em1Qcy', 'action'],
    ['E-2 payment_failed (declined)', 'p7b1-e2-event-invoice-payment_failed', 'p7b1-e2-event-customer-subscription-updated', 'failed'],
    ['E-4 payment_action_required (never completed)', 'p7b1-e4-event-invoice-payment_action_required', 'p7b1-e4-event-customer-subscription-updated', 'action'],
  ])('%s: a history row only; no billing write, no audit; status stays active; no banner', async (_label, invoiceName, updatedName, kind) => {
    const event = cap(invoiceName);
    const updated = cap(updatedName);
    expect(invoiceOf(event).billing_reason).toBe('subscription_update');
    expect((updated.data.object as Stripe.Subscription).status).toBe('active');

    const world = new World(subscriptionIdOf(event), invoiceOf(event).customer as string, '2026-11-13T00:00:00.000Z');
    // Even a Stripe-hosted URL on an upgrade's event is never stored.
    (invoiceOf(event) as unknown as { hosted_invoice_url: string }).hosted_invoice_url = HOSTED;
    const { deps, ports } = harness(world, () => updated.data.object as Stripe.Subscription);
    if (kind === 'action') await recordActionRequiredPlanInvoice(event, world.log, deps);
    else await recordFailedPlanInvoice(event, world.log, deps);
    await mirrorPlanSubscription(updated, world.log, deps);

    expect(world.history.map((h) => h.kind)).toEqual([kind === 'action' ? 'payment_action_required' : 'invoice_payment_failed']);
    expect(ports.recordRenewalFailure).not.toHaveBeenCalled();
    expect(ports.recordActionRequired).not.toHaveBeenCalled();
    expect(world.audits).toEqual([]);
    expect(world.billing).toMatchObject({ subscriptionStatus: 'active', failedAttempts: 0, actionRequiredInvoiceUrl: null, lastPaymentFailedAt: null });
    expect(noticeFor(world)).toBeNull();
    expect(noticeFor(world, 'grace', '2026-12-01T00:00:00.000Z')).toBeNull();
  });
});
