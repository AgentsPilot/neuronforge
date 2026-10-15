/**
 * planPaymentApply (plan payments P-3b.2, workplan §3.2, §3.3, §8; SA rulings
 * Q-2, Q-3, Q-4; conditions C-2, C-6).
 *
 * Jest cannot run `business_os_apply_plan_payment`, so the billing-event port
 * here is a FAKE THAT MODELS THE FUNCTION'S RULES (§3.2 steps 2 to 11: billing
 * row by account and mode, customer check, idempotency by invoice then by
 * event, subscription identity and replacement, plan row, "newest" by the
 * billing row's Stripe facts, the anchor on the first plan-writing invoice of a
 * subscription, plan_version grandfathering). The same C-6 cases are pinned in
 * SQL by `scripts/probe-bos-apply-plan-payment.sql` (P01 to P15), which ran on
 * PGlite in P-3b.1 and runs on production at G-2.
 *
 * Tier names are read from the plan lookup keys, never written as literals (FR-12).
 */

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import fs from 'fs';
import path from 'path';
import type Stripe from 'stripe';

import {
  applyPaidPlanInvoice,
  PlanPaymentRetryError,
  recordActionRequiredPlanInvoice,
  recordFailedPlanInvoice,
  type PlanPaymentDeps,
} from '@/lib/business-os/billing/planPaymentApply';
import { BOS_PLAN_LOOKUP_KEYS, planTierForLookupKey } from '@/lib/business-os/billing/planPriceCatalog';
import {
  decideRenewalCure,
  decideRenewalFailure,
  type BusinessOsBillingAccount,
  type RenewalCureResult,
  type RenewalFailureInput,
  type RenewalFailureWriteResult,
} from '@/lib/repositories/BusinessOsBillingAccountRepository';
import type {
  BusinessOsApplyPlanPaymentInput,
  BusinessOsApplyPlanPaymentResult,
  BusinessOsBillingEventInput,
} from '@/lib/repositories/BusinessOsBillingEventRepository';
import type { RecordPlanChangeInput } from '@/lib/business-os/entitlements/recordPlanChange';
import type { Logger } from '@/lib/logger';

// ── Fixtures, with Stripe-shaped ids ─────────────────────────────────────────

const FIXTURES = path.join(__dirname, 'fixtures', 'stripe');
const [KEY_A, KEY_B] = BOS_PLAN_LOOKUP_KEYS;
const TIER_A = planTierForLookupKey(KEY_A) as string;
const TIER_B = planTierForLookupKey(KEY_B) as string;
const PRICE_A = 'price_probe_a_handbuilt';
const PRICE_B = 'price_probe_b_handbuilt';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const OTHER_ACCOUNT = '22222222-2222-4222-8222-222222222222';
const CUSTOMER = 'cus_A1';
const SUB_1 = 'sub_S1';
const SUB_2 = 'sub_S2';
const PERIOD_1_END = new Date(1792592000 * 1000).toISOString(); // the fixture line's period end
const ANCHOR = 1_790_000_000;
const ANCHOR_ISO = new Date(ANCHOR * 1000).toISOString();

let eventSeq = 0;

/** A fixture event with Stripe-shaped ids, edited by `change`. */
function invoiceEvent(
  name: string,
  opts: { invoiceId: string; subscriptionId?: string; customerId?: string; livemode?: boolean },
  change: (invoice: Stripe.Invoice) => void = () => undefined
): Stripe.Event {
  const event = JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8')) as Stripe.Event;
  eventSeq += 1;
  event.id = `evt_T${eventSeq}`;
  event.livemode = opts.livemode ?? false;
  const invoice = event.data.object as Stripe.Invoice;
  invoice.id = opts.invoiceId;
  invoice.customer = opts.customerId ?? CUSTOMER;
  invoice.parent!.subscription_details!.subscription = opts.subscriptionId ?? SUB_1;
  change(invoice);
  return event;
}

const paidCreate = (invoiceId = 'in_C1', subscriptionId = SUB_1) =>
  invoiceEvent('invoice-paid-subscription-create.json', { invoiceId, subscriptionId });

// ── A fake of the apply function (§3.2) and its tables ──────────────────────

interface PlanRow {
  tier: string | null;
  planVersion: number;
  tierExpiresAt: string | null;
  periodAnchor: string;
  cohort: string | null;
}

interface EventRow {
  id: string;
  userId: string | null;
  kind: string;
  stripeEventId: string | null;
  invoiceId: string | null;
  subscriptionId: string | null;
  planWritten: boolean;
  refusalReason: string | null;
  input: unknown;
}

function billingRow(overrides: Partial<BusinessOsBillingAccount> = {}): BusinessOsBillingAccount {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    accountId: ACCOUNT,
    livemode: false,
    stripeCustomerId: CUSTOMER,
    stripeSubscriptionId: null,
    subscriptionStatus: null,
    boughtTier: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    pendingTier: null,
    openCheckoutSessionId: null,
    openCheckoutExpiresAt: null,
    lastInvoiceId: null,
    lastPaidAt: null,
    lastPaymentFailedAt: null,
    failedAttempts: 0,
    actionRequiredInvoiceUrl: null,
    founderDiscountAppliedAt: null,
    endedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

class FakeWorld {
  billing: BusinessOsBillingAccount | null = billingRow();
  plan: PlanRow | null = { tier: null, planVersion: 0, tierExpiresAt: null, periodAnchor: '2026-09-01T00:00:00.000Z', cohort: 'trial' };
  events: EventRow[] = [];
  applyCalls: BusinessOsApplyPlanPaymentInput[] = [];
  /** Another account's row holding a subscription (UNIQUE), for `subscription_held_elsewhere`. */
  heldElsewhere = new Set<string>();
  private seq = 0;

  private rowId(): string {
    this.seq += 1;
    return `44444444-4444-4444-8444-${String(this.seq).padStart(12, '0')}`;
  }

  /** §3.2, steps 2 to 11. */
  apply(input: BusinessOsApplyPlanPaymentInput): BusinessOsApplyPlanPaymentResult {
    this.applyCalls.push(input);
    const row = this.billing;
    if (!row || row.accountId !== input.accountId || row.livemode !== input.livemode) return { status: 'billing_row_missing' };
    if (row.stripeCustomerId !== input.stripeCustomerId) return { status: 'customer_mismatch' };
    const paid = this.events.find((e) => e.kind === 'invoice_paid' && e.invoiceId === input.stripeInvoiceId);
    if (paid) return { status: 'already_applied', eventRowId: paid.id };
    const byEvent = this.events.find((e) => input.stripeEventId !== null && e.stripeEventId === input.stripeEventId);
    if (byEvent) return { status: 'already_recorded', eventRowId: byEvent.id };

    let replacement = false;
    let refusal: string | null = null;
    if (row.stripeSubscriptionId === null || row.stripeSubscriptionId === input.stripeSubscriptionId) replacement = false;
    else if (input.replacesSubscriptionId !== null && row.stripeSubscriptionId === input.replacesSubscriptionId) replacement = true;
    else refusal = 'second_subscription';
    if (!refusal && row.stripeSubscriptionId !== input.stripeSubscriptionId && this.heldElsewhere.has(input.stripeSubscriptionId)) {
      refusal = 'subscription_held_elsewhere';
    }
    if (refusal) {
      const id = this.rowId();
      this.events.push({ id, userId: input.accountId, kind: 'mismatch_refused', stripeEventId: input.stripeEventId, invoiceId: input.stripeInvoiceId, subscriptionId: input.stripeSubscriptionId, planWritten: false, refusalReason: refusal, input });
      return { status: 'subscription_conflict', eventRowId: id };
    }
    const plan = this.plan;
    if (!plan) return { status: 'plan_row_missing' };

    const tierBefore = plan.tier;
    const inForce = plan.tier !== null && (plan.tierExpiresAt === null || Date.parse(plan.tierExpiresAt) > Date.now());
    const newest =
      replacement ||
      row.currentPeriodEnd === null ||
      Date.parse(input.periodEnd) > Date.parse(row.currentPeriodEnd) ||
      (Date.parse(input.periodEnd) === Date.parse(row.currentPeriodEnd) &&
        (row.lastPaidAt === null || Date.parse(input.paidAt) >= Date.parse(row.lastPaidAt)));
    const planWritten = input.assignsPlan && newest;
    const anchorSet =
      planWritten &&
      !this.events.some((e) => e.userId === input.accountId && e.kind === 'invoice_paid' && e.subscriptionId === input.stripeSubscriptionId && e.planWritten);
    const id = this.rowId();
    this.events.push({ id, userId: input.accountId, kind: 'invoice_paid', stripeEventId: input.stripeEventId, invoiceId: input.stripeInvoiceId, subscriptionId: input.stripeSubscriptionId, planWritten, refusalReason: null, input });
    if (planWritten) {
      plan.planVersion = tierBefore !== input.tier || !inForce ? input.planVersion : plan.planVersion;
      plan.tier = input.tier;
      plan.tierExpiresAt = input.periodEnd;
      if (anchorSet) plan.periodAnchor = input.billingCycleAnchor;
    }
    this.billing = {
      ...row,
      stripeSubscriptionId: input.stripeSubscriptionId,
      subscriptionStatus: input.subscriptionStatus,
      endedAt: replacement ? null : row.endedAt,
      cancelAtPeriodEnd: replacement ? false : row.cancelAtPeriodEnd,
      boughtTier: planWritten ? input.tier : row.boughtTier,
      currentPeriodEnd: newest ? input.periodEnd : row.currentPeriodEnd,
      lastInvoiceId: newest ? input.stripeInvoiceId : row.lastInvoiceId,
      lastPaidAt: newest ? input.paidAt : row.lastPaidAt,
    };
    return {
      status: planWritten ? 'applied' : 'recorded',
      eventRowId: id,
      tierBefore,
      tierAfter: planWritten ? input.tier : tierBefore,
      planWritten,
      anchorSet,
      // P-5a.1: this fake has no lineage table; the stamp is modelled in planPaymentApply.firstPayment.test.ts.
      firstPaymentStamped: false,
    };
  }

  /**
   * P-6a.2: the billing repository's renewal-failure write, through the REAL
   * pure decision (`decideRenewalFailure`), on the row of this account and mode.
   */
  renewalFailure(input: RenewalFailureInput, actionRequired: boolean): RenewalFailureWriteResult {
    const row = this.billing && this.billing.accountId === input.userId && this.billing.livemode === input.livemode ? this.billing : null;
    const decision = decideRenewalFailure(row, {
      stripeSubscriptionId: input.stripeSubscriptionId,
      invoiceId: input.invoiceId,
      periodEndIso: input.periodEndIso,
      attemptCount: input.attemptCount,
      failedAtIso: input.failedAtIso,
      hostedInvoiceUrl: input.hostedInvoiceUrl,
      actionRequired,
    });
    if (decision.kind === 'moot') return { outcome: 'moot', reason: decision.reason };
    if (decision.kind === 'unchanged' || !row) return { outcome: 'unchanged' };
    this.billing = {
      ...row,
      failedAttempts: decision.failedAttempts,
      lastPaymentFailedAt: decision.lastPaymentFailedAt,
      actionRequiredInvoiceUrl: decision.actionRequiredInvoiceUrl,
    };
    return { outcome: 'recorded', failedAttempts: decision.failedAttempts, actionRequiredUrlStored: decision.actionRequiredInvoiceUrl !== null };
  }

  /** P-6a.2: the cure, through the REAL pure decision (`decideRenewalCure`). */
  cure(input: { userId: string; livemode: boolean; stripeSubscriptionId: string; paidPeriodEndIso: string }): RenewalCureResult {
    const row = this.billing && this.billing.accountId === input.userId && this.billing.livemode === input.livemode ? this.billing : null;
    const decision = decideRenewalCure(row, input);
    if (decision.kind === 'nothing' || !row) return { outcome: 'nothing', reason: decision.kind === 'nothing' ? decision.reason : 'no_row' };
    this.billing = { ...row, failedAttempts: 0, actionRequiredInvoiceUrl: null };
    return { outcome: 'cleared' };
  }

  record(input: BusinessOsBillingEventInput): { outcome: 'recorded'; eventRowId: string } | { outcome: 'duplicate' } {
    if (input.stripeEventId !== null && this.events.some((e) => e.stripeEventId === input.stripeEventId)) return { outcome: 'duplicate' };
    const id = this.rowId();
    this.events.push({
      id,
      userId: input.accountId,
      kind: input.kind,
      stripeEventId: input.stripeEventId,
      invoiceId: input.stripeInvoiceId ?? null,
      subscriptionId: input.stripeSubscriptionId ?? null,
      planWritten: false,
      refusalReason: input.refusalReason ?? null,
      input,
    });
    return { outcome: 'recorded', eventRowId: id };
  }
}

// ── Harness ─────────────────────────────────────────────────────────────────

interface StripeSubscription {
  id: string;
  status: string;
  customerId: string | null;
  billingCycleAnchor: number;
  cancelAtPeriodEnd: boolean;
  endedAt: number | null;
  livemode: boolean;
  metadata: Record<string, string>;
  priceIds: string[];
  // P-7b.1a (§3.3 a): the additive fields the U-4 guard reads.
  items: Array<{ id: string; priceId: string | null; currentPeriodStart: number | null; currentPeriodEnd: number | null }>;
  pendingUpdate: { expiresAt: number; priceIds: string[] } | null;
  latestInvoiceId: string | null;
}

/** One item per price unless `items` is given, so a fake that says `priceIds` stays coherent. */
function subscriptionAt(id: string, overrides: Partial<StripeSubscription> = {}): StripeSubscription {
  const priceIds = overrides.priceIds ?? [PRICE_A];
  return {
    id,
    status: 'active',
    customerId: CUSTOMER,
    billingCycleAnchor: ANCHOR,
    cancelAtPeriodEnd: false,
    endedAt: null,
    livemode: false,
    metadata: {},
    priceIds,
    items: priceIds.map((priceId, index) => ({ id: `si_${index + 1}`, priceId, currentPeriodStart: ANCHOR, currentPeriodEnd: null })),
    pendingUpdate: null,
    latestInvoiceId: null,
    ...overrides,
  };
}

function setup(world = new FakeWorld()) {
  const subscriptions = new Map<string, StripeSubscription | Error>([[SUB_1, subscriptionAt(SUB_1)], [SUB_2, subscriptionAt(SUB_2, { billingCycleAnchor: ANCHOR + 86400 * 90 })]]);
  const audits: RecordPlanChangeInput[] = [];
  const order: string[] = [];
  const lines = jest.fn();
  const findBySub = jest.fn(async (id: string, livemode: boolean) => ({
    data: world.billing && world.billing.stripeSubscriptionId === id && world.billing.livemode === livemode ? world.billing : null,
    error: null,
  }));
  const findByCustomer = jest.fn(async (id: string, livemode: boolean) => ({
    data: world.billing && world.billing.stripeCustomerId === id && world.billing.livemode === livemode ? world.billing : null,
    error: null,
  }));
  const recordRenewalFailure = jest.fn(async (input: RenewalFailureInput) => ({ data: world.renewalFailure(input, false), error: null }));
  const recordActionRequired = jest.fn(async (input: RenewalFailureInput) => ({ data: world.renewalFailure(input, true), error: null }));
  const clearRenewalFailure = jest.fn(async (input: { userId: string; livemode: boolean; stripeSubscriptionId: string; paidPeriodEndIso: string }) => {
    order.push('cure');
    return { data: world.cure(input), error: null };
  });
  const deps: PlanPaymentDeps = {
    billingAccounts: {
      findByStripeSubscription: findBySub,
      findByStripeCustomer: findByCustomer,
      recordRenewalFailure,
      recordActionRequired,
      clearRenewalFailure,
    } as unknown as PlanPaymentDeps['billingAccounts'],
    now: () => new Date('2026-10-15T09:00:00.000Z'),
    billingEvents: {
      applyPlanPayment: jest.fn(async (input: BusinessOsApplyPlanPaymentInput) => {
        order.push('apply');
        return { data: world.apply(input), error: null };
      }),
      recordEvent: jest.fn(async (input: BusinessOsBillingEventInput) => ({ data: world.record(input), error: null })),
    } as unknown as PlanPaymentDeps['billingEvents'],
    stripe: () =>
      ({
        listInvoiceLinesAll: lines,
        retrieveBusinessOsSubscription: jest.fn(async (id: string) => {
          const found = subscriptions.get(id);
          if (found instanceof Error) throw found;
          if (!found) throw Object.assign(new Error('No such subscription'), { code: 'resource_missing' });
          return found;
        }),
      }) as unknown as ReturnType<PlanPaymentDeps['stripe']>,
    catalog: { load: jest.fn(async () => ({ byPriceId: new Map([[PRICE_A, KEY_A], [PRICE_B, KEY_B]]), fromCache: false })) },
    entitlementConfig: () => ({ tierOrder: [TIER_A, TIER_B], matrix: { version: 7 } }) as unknown as ReturnType<PlanPaymentDeps['entitlementConfig']>,
    recordPlanChange: jest.fn(async (input: RecordPlanChangeInput) => {
      order.push(`audit:${input.action}`);
      audits.push(input);
    }),
  };
  const logLines: Array<{ level: string; ctx: Record<string, unknown> }> = [];
  const at = (level: string) => (ctx: Record<string, unknown>) => {
    logLines.push({ level, ctx });
  };
  const log = { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug') } as unknown as Logger;
  const logged = (event: string) => logLines.filter((l) => l.ctx.event === event);
  return {
    world,
    deps,
    audits,
    order,
    subscriptions,
    lines,
    log,
    logged,
    logLines,
    findBySub,
    findByCustomer,
    recordRenewalFailure,
    recordActionRequired,
    clearRenewalFailure,
  };
}

const paid = (h: ReturnType<typeof setup>, event: Stripe.Event) => applyPaidPlanInvoice(event, h.log, h.deps);
const historyKinds = (world: FakeWorld) => world.events.map((e) => `${e.kind}${e.refusalReason ? `:${e.refusalReason}` : ''}`);

// ── U-4 (P-7b.1a) ───────────────────────────────────────────────────────────

const UPGRADE_INVOICE = 'in_U1';
const upgradeEvent = (change: (invoice: Stripe.Invoice) => void = () => undefined) =>
  invoiceEvent('invoice-paid-proration.json', { invoiceId: UPGRADE_INVOICE }, change);

/** A first invoice paid on PRICE_A, so the account pays for TIER_A on SUB_1. */
async function payingOnTierA(h: ReturnType<typeof setup>) {
  await paid(h, paidCreate());
  expect(h.world.plan?.tier).toBe(TIER_A);
  h.audits.length = 0;
}

describe('U-4 (P-7b.1a, SA U-4, V-5, V-6): a paid upgrade invoice writes the plan only when Stripe applied it', () => {
  it('Stripe bills the upgraded price on its one item: applied as before, billingReason in the audit details (U-9)', async () => {
    const h = setup();
    await payingOnTierA(h);
    h.subscriptions.set(SUB_1, subscriptionAt(SUB_1, { priceIds: [PRICE_B] }));
    await paid(h, upgradeEvent());
    expect(h.world.plan?.tier).toBe(TIER_B);
    expect(h.world.applyCalls[1].assignsPlan).toBe(true);
    expect(h.audits).toEqual([
      expect.objectContaining({
        action: 'BOS_BILLING_INVOICE_PAID',
        severity: 'info',
        details: expect.objectContaining({ billingReason: 'subscription_update', planWritten: true }),
      }),
    ]);
    expect((h.audits[0].details as Record<string, unknown>).upgradeNotApplied).toBeUndefined();
    expect(h.logged('bos_billing_upgrade_paid_not_applied')).toEqual([]);
  });

  it('a pending update waiting on THIS invoice: released for retry, nothing written (branch 1)', async () => {
    const h = setup();
    await payingOnTierA(h);
    h.subscriptions.set(
      SUB_1,
      subscriptionAt(SUB_1, { pendingUpdate: { expiresAt: ANCHOR + 86400, priceIds: [PRICE_B] }, latestInvoiceId: UPGRADE_INVOICE })
    );
    await expect(paid(h, upgradeEvent())).rejects.toMatchObject({ name: 'PlanPaymentRetryError', reason: 'upgrade_pending_at_stripe' });
    expect(h.world.applyCalls).toHaveLength(1);
    expect(h.world.plan?.tier).toBe(TIER_A);
    expect(h.audits).toEqual([]);
    expect(h.logged('bos_billing_upgrade_pending_at_stripe')[0]).toMatchObject({ level: 'warn' });
  });

  it('V-5: a pending update for a DIFFERENT invoice does not hold this one; it goes on to the item test', async () => {
    const h = setup();
    await payingOnTierA(h);
    h.subscriptions.set(
      SUB_1,
      subscriptionAt(SUB_1, { priceIds: [PRICE_B], pendingUpdate: { expiresAt: ANCHOR + 86400, priceIds: [PRICE_A] }, latestInvoiceId: 'in_OTHER' })
    );
    await paid(h, upgradeEvent());
    expect(h.world.plan?.tier).toBe(TIER_B);
    expect(h.logged('bos_billing_upgrade_pending_at_stripe')).toEqual([]);

    // And with the item NOT on the deciding price, the same invoice is recorded without the plan.
    const h2 = setup();
    await payingOnTierA(h2);
    h2.subscriptions.set(
      SUB_1,
      subscriptionAt(SUB_1, { priceIds: [PRICE_A], pendingUpdate: { expiresAt: ANCHOR + 86400, priceIds: [PRICE_B] }, latestInvoiceId: 'in_OTHER' })
    );
    await paid(h2, upgradeEvent());
    expect(h2.world.applyCalls[1].assignsPlan).toBe(false);
    expect(h2.world.plan?.tier).toBe(TIER_A);
  });

  it('item on another price: recorded with assignsPlan false, plan untouched, alerted and audited ONCE (branch 2, Q-3)', async () => {
    const h = setup();
    await payingOnTierA(h);
    // Stripe still bills the old price: the upgrade was paid but not applied.
    await paid(h, upgradeEvent());
    expect(h.world.applyCalls[1].assignsPlan).toBe(false);
    expect(h.world.plan?.tier).toBe(TIER_A);
    expect(historyKinds(h.world)).toEqual(['invoice_paid', 'invoice_paid']);
    expect(h.logged('bos_billing_upgrade_paid_not_applied')).toEqual([
      expect.objectContaining({ level: 'error', ctx: expect.objectContaining({ alert: true, invoiceId: UPGRADE_INVOICE }) }),
    ]);
    expect(h.audits).toEqual([
      expect.objectContaining({
        action: 'BOS_BILLING_INVOICE_PAID',
        severity: 'warning',
        invalidatesEntitlements: false,
        details: expect.objectContaining({ upgradeNotApplied: true, billingReason: 'subscription_update', planWritten: false }),
      }),
    ]);

    // Replay (already_applied): no alert, no audit.
    await paid(h, upgradeEvent());
    expect(h.logged('bos_billing_upgrade_paid_not_applied')).toHaveLength(1);
    expect(h.audits).toHaveLength(1);
    expect(h.logged('bos_billing_invoice_replayed')).toHaveLength(1);
  });

  it('two items: treated as not applied', async () => {
    const h = setup();
    await payingOnTierA(h);
    h.subscriptions.set(SUB_1, subscriptionAt(SUB_1, { priceIds: [PRICE_B, PRICE_A] }));
    await paid(h, upgradeEvent());
    expect(h.world.applyCalls[1].assignsPlan).toBe(false);
    expect(h.world.plan?.tier).toBe(TIER_A);
    expect(h.logged('bos_billing_upgrade_paid_not_applied')).toHaveLength(1);
  });

  it('an upgrade invoice that would not assign anyway (total 0, trial swap) is not alerted', async () => {
    const h = setup();
    await payingOnTierA(h);
    await paid(
      h,
      upgradeEvent((invoice) => {
        invoice.amount_paid = 0;
        invoice.total = 0;
        invoice.lines.data = [invoice.lines.data[1]];
        invoice.lines.data[0].amount = 0;
      })
    );
    expect(h.world.applyCalls[1].assignsPlan).toBe(false);
    expect(h.logged('bos_billing_upgrade_paid_not_applied')).toEqual([]);
  });

  it.each([
    ['subscription_cycle', 'invoice-paid-renewal.json'],
    ['subscription_create', 'invoice-paid-subscription-create.json'],
  ])('V-6: a %s invoice takes no U-4 branch, even with a pending update for it and the item elsewhere', async (_reason, fixture) => {
    const h = setup();
    h.subscriptions.set(
      SUB_1,
      subscriptionAt(SUB_1, { priceIds: [PRICE_B], pendingUpdate: { expiresAt: ANCHOR + 86400, priceIds: [PRICE_B] }, latestInvoiceId: 'in_V6' })
    );
    await paid(h, invoiceEvent(fixture, { invoiceId: 'in_V6' }));
    expect(h.world.applyCalls[0].assignsPlan).toBe(true);
    expect(h.logged('bos_billing_upgrade_pending_at_stripe')).toEqual([]);
    expect(h.logged('bos_billing_upgrade_paid_not_applied')).toEqual([]);
  });

  it('CF-6 end to end: an upgrade paid from the credit balance (amount_paid 0, total > 0) is applied', async () => {
    const h = setup();
    await payingOnTierA(h);
    h.subscriptions.set(SUB_1, subscriptionAt(SUB_1, { priceIds: [PRICE_B] }));
    await paid(
      h,
      upgradeEvent((invoice) => {
        invoice.amount_paid = 0;
      })
    );
    expect(h.world.applyCalls[1]).toMatchObject({ assignsPlan: true, amountMinor: 0 });
    expect(h.world.plan?.tier).toBe(TIER_B);
  });
});

// ── C-6: the required cases ─────────────────────────────────────────────────

describe('C-6 (SA-P2, SA-P16): the plan row moves only on the newest paid invoice', () => {
  it('C6-7 first buy from trial: tier written, cohort untouched, anchor = billing_cycle_anchor, expiry = line period end, audit after apply', async () => {
    const h = setup();
    await paid(h, paidCreate());
    expect(h.world.plan).toEqual({ tier: TIER_A, planVersion: 7, tierExpiresAt: PERIOD_1_END, periodAnchor: ANCHOR_ISO, cohort: 'trial' });
    expect(h.world.billing).toMatchObject({ stripeSubscriptionId: SUB_1, subscriptionStatus: 'active', boughtTier: TIER_A, currentPeriodEnd: PERIOD_1_END });
    // P-6a.2: the renewal-failure cure runs last, after the audit flush (never before it).
    expect(h.order).toEqual(['apply', 'audit:BOS_BILLING_INVOICE_PAID', 'cure']);
    expect(h.audits[0]).toMatchObject({
      accountId: ACCOUNT,
      actor: { kind: 'system', source: 'stripe_webhook' },
      entityType: 'business_os_account_plan',
      entityId: ACCOUNT,
      severity: 'info',
      invalidatesEntitlements: true,
      changes: { before: { tier: null }, after: { tier: TIER_A, tierExpiresAt: PERIOD_1_END, periodAnchor: ANCHOR_ISO } },
      details: { invoiceId: 'in_C1', subscriptionId: SUB_1, tier: TIER_A, amountMinor: 2000, planWritten: true, anchorSet: true, livemode: false },
    });
    expect(h.logged('bos_billing_invoice_applied')).toHaveLength(1);
  });

  it('C6-1 replay: the same invoice twice, then under another event id: one history row, plan and audit written once', async () => {
    const h = setup();
    const first = paidCreate();
    await paid(h, first);
    await paid(h, first);
    await paid(h, paidCreate()); // same invoice id, new event id
    expect(h.world.events.filter((e) => e.kind === 'invoice_paid')).toHaveLength(1);
    expect(h.audits).toHaveLength(1);
    expect(h.logged('bos_billing_invoice_replayed').map((l) => l.ctx.status)).toEqual(['already_applied', 'already_applied']);
  });

  it('C6-2 out-of-order renewal: N+1 applied, N delivered late is recorded with plan_written false; expiry and anchor stay', async () => {
    const h = setup();
    await paid(h, paidCreate());
    const renewal = invoiceEvent('invoice-paid-renewal.json', { invoiceId: 'in_R2' });
    await paid(h, renewal);
    const after = { ...h.world.plan };
    // A late, OLDER renewal for the first period (new invoice id).
    await paid(h, invoiceEvent('invoice-paid-renewal.json', { invoiceId: 'in_R1' }, (i) => {
      i.lines.data[0].period = { start: 1790000000, end: 1792592000 };
      i.status_transitions.paid_at = 1792592999;
    }));
    expect(h.world.plan).toEqual(after);
    expect(h.world.plan?.tierExpiresAt).toBe(new Date(1795184000 * 1000).toISOString());
    expect(h.world.events.map((e) => e.planWritten)).toEqual([true, true, false]);
    expect(h.audits.map((a) => (a.details as { planWritten: boolean }).planWritten)).toEqual([true, true, false]);
    expect(h.audits[2].invalidatesEntitlements).toBe(false);
  });

  it('C6-2b a renewal never moves the anchor and keeps plan_version (grandfathering, Q-8)', async () => {
    const h = setup();
    await paid(h, paidCreate());
    h.world.plan!.planVersion = 3; // sold at an older matrix version
    await paid(h, invoiceEvent('invoice-paid-renewal.json', { invoiceId: 'in_R2' }));
    expect(h.world.plan).toMatchObject({ periodAnchor: ANCHOR_ISO, planVersion: 3, tier: TIER_A });
    expect(h.audits[1].changes).toEqual({ before: { tier: TIER_A }, after: { tier: TIER_A, tierExpiresAt: new Date(1795184000 * 1000).toISOString() } });
  });

  it('C6-3 upgrade: proration with the old tier credited; tier changes, expiry and anchor unchanged, plan_version current; a late replay of the first invoice never downgrades', async () => {
    const h = setup();
    const create = paidCreate();
    await paid(h, create);
    h.world.plan!.planVersion = 3;
    // P-7b.1a (U-4): Stripe now bills the upgraded price on the one item.
    h.subscriptions.set(SUB_1, subscriptionAt(SUB_1, { priceIds: [PRICE_B] }));
    const upgrade = invoiceEvent('invoice-paid-proration.json', { invoiceId: 'in_U1' });
    await paid(h, upgrade);
    expect(h.world.plan).toMatchObject({ tier: TIER_B, tierExpiresAt: PERIOD_1_END, periodAnchor: ANCHOR_ISO, planVersion: 7 });
    await paid(h, create);
    expect(h.world.plan?.tier).toBe(TIER_B);
    expect(h.logged('bos_billing_invoice_replayed')).toHaveLength(1);
  });

  it('C6-4 re-buy after the old subscription ended at Stripe: replacement, new anchor, subscription replaced', async () => {
    const h = setup();
    h.world.billing = billingRow({ stripeSubscriptionId: SUB_1, subscriptionStatus: 'canceled', endedAt: '2026-09-15T00:00:00.000Z', currentPeriodEnd: '2027-01-01T00:00:00.000Z' });
    h.subscriptions.set(SUB_1, subscriptionAt(SUB_1, { status: 'canceled' }));
    // The new subscription's invoice is found by its customer (the row still names the old one).
    await paid(h, paidCreate('in_N1', SUB_2));
    expect((h.deps.billingEvents.applyPlanPayment as jest.Mock).mock.calls[0][0]).toMatchObject({ stripeSubscriptionId: SUB_2, replacesSubscriptionId: SUB_1 });
    expect(h.world.billing).toMatchObject({ stripeSubscriptionId: SUB_2, endedAt: null });
    expect(h.world.plan).toMatchObject({ tier: TIER_A, periodAnchor: new Date((ANCHOR + 86400 * 90) * 1000).toISOString() });
  });

  it('C6-4b re-buy while the old subscription is LIVE at Stripe: refused (second_subscription), alerted and audited, no plan write', async () => {
    const h = setup();
    h.world.billing = billingRow({ stripeSubscriptionId: SUB_1, subscriptionStatus: 'active' });
    await paid(h, paidCreate('in_N1', SUB_2));
    expect((h.deps.billingEvents.applyPlanPayment as jest.Mock).mock.calls[0][0].replacesSubscriptionId).toBeNull();
    expect(historyKinds(h.world)).toEqual(['mismatch_refused:second_subscription']);
    expect(h.world.plan?.tier).toBeNull();
    expect(h.logged('bos_billing_payment_refused')).toEqual([
      expect.objectContaining({ level: 'error', ctx: expect.objectContaining({ reason: 'second_subscription', alert: true }) }),
    ]);
    expect(h.audits).toEqual([expect.objectContaining({ action: 'BOS_BILLING_PAYMENT_REFUSED', severity: 'warning', invalidatesEntitlements: false })]);
  });

  it('a held subscription Stripe does not know is not PROVEN ended: refused as a second subscription', async () => {
    const h = setup();
    h.world.billing = billingRow({ stripeSubscriptionId: 'sub_Gone' });
    await paid(h, paidCreate('in_N1', SUB_2));
    expect(historyKinds(h.world)).toEqual(['mismatch_refused:second_subscription']);
    expect(h.logged('bos_billing_held_subscription_missing')).toHaveLength(1);
  });

  it('subscription held elsewhere (another account holds it): refused, no plan write', async () => {
    const h = setup();
    h.world.heldElsewhere.add(SUB_1);
    await paid(h, paidCreate());
    expect(historyKinds(h.world)).toEqual(['mismatch_refused:subscription_held_elsewhere']);
    expect(h.logged('bos_billing_payment_refused')[0].ctx.reason).toBe('subscription_held_elsewhere');
  });

  it('C6-5 $0 trial invoice: history row, no tier, no anchor; the next non-zero invoice writes the tier AND sets the anchor', async () => {
    const h = setup();
    await paid(h, invoiceEvent('invoice-paid-trial-zero.json', { invoiceId: 'in_T0' }));
    expect(h.world.plan).toMatchObject({ tier: null, periodAnchor: '2026-09-01T00:00:00.000Z' });
    expect(h.world.events[0]).toMatchObject({ kind: 'invoice_paid', planWritten: false });
    expect(h.audits[0]).toMatchObject({ invalidatesEntitlements: false, details: expect.objectContaining({ planWritten: false, anchorSet: false }) });
    await paid(h, invoiceEvent('invoice-paid-renewal.json', { invoiceId: 'in_R1' }));
    expect(h.world.plan).toMatchObject({ tier: TIER_A, periodAnchor: ANCHOR_ISO });
  });
});

// ── Refusals and "could not tell" ───────────────────────────────────────────

describe('refusals are recorded, alerted and final; "could not tell" throws', () => {
  it('unknown customer: a refusal row with NO account, the money recorded, alert, no audit, nothing applied', async () => {
    const h = setup();
    h.world.billing = null;
    await paid(h, paidCreate());
    expect(h.world.events).toEqual([expect.objectContaining({ userId: null, kind: 'mismatch_refused', refusalReason: 'unknown_customer' })]);
    expect((h.world.events[0].input as BusinessOsBillingEventInput)).toMatchObject({ amountMinor: 2000, currency: 'usd', stripeCustomerId: CUSTOMER });
    expect(h.deps.billingEvents.applyPlanPayment).not.toHaveBeenCalled();
    expect(h.audits).toEqual([]);
    expect(h.logged('bos_billing_payment_refused')[0].ctx.alert).toBe(true);
  });

  it('a detached billing row (account deleted) is an unknown customer', async () => {
    const h = setup();
    h.world.billing = billingRow({ accountId: null });
    await paid(h, paidCreate());
    expect(historyKinds(h.world)).toEqual(['mismatch_refused:unknown_customer']);
  });

  it('the account comes from the billing row by SUBSCRIPTION first; metadata never chooses it', async () => {
    const h = setup();
    h.world.billing = billingRow({ stripeSubscriptionId: SUB_1 });
    await paid(h, paidCreate());
    expect(h.findBySub).toHaveBeenCalledWith(SUB_1, false);
    expect(h.findByCustomer).not.toHaveBeenCalled();
  });

  it('metadata naming another account: refused (metadata_account_mismatch), no apply', async () => {
    const h = setup();
    const event = invoiceEvent('invoice-paid-subscription-create.json', { invoiceId: 'in_C1' }, (i) => {
      i.parent!.subscription_details!.metadata = { bos_user_id: OTHER_ACCOUNT };
    });
    await paid(h, event);
    expect(historyKinds(h.world)).toEqual(['mismatch_refused:metadata_account_mismatch']);
    expect(h.world.events[0].userId).toBe(ACCOUNT);
    expect(h.deps.billingEvents.applyPlanPayment).not.toHaveBeenCalled();
    expect(h.audits[0]).toMatchObject({ action: 'BOS_BILLING_PAYMENT_REFUSED', accountId: ACCOUNT });
  });

  it('metadata naming THIS account is fine', async () => {
    const h = setup();
    await paid(h, invoiceEvent('invoice-paid-subscription-create.json', { invoiceId: 'in_C1' }, (i) => {
      i.parent!.subscription_details!.metadata = { bos_user_id: ACCOUNT, product: 'business_os_plan' };
    }));
    expect(h.world.plan?.tier).toBe(TIER_A);
  });

  it('non-USD (SA-P15 backstop): refused, the currency recorded as NULL', async () => {
    const h = setup();
    await paid(h, invoiceEvent('invoice-paid-subscription-create.json', { invoiceId: 'in_C1' }, (i) => { i.currency = 'eur'; }));
    expect(historyKinds(h.world)).toEqual(['mismatch_refused:currency_not_usd']);
    expect((h.world.events[0].input as BusinessOsBillingEventInput).currency).toBeNull();
  });

  it('a subscription row with another customer: refused (customer_mismatch)', async () => {
    const h = setup();
    h.world.billing = billingRow({ stripeSubscriptionId: SUB_1, stripeCustomerId: 'cus_Other' });
    await paid(h, paidCreate());
    expect(historyKinds(h.world)).toEqual(['mismatch_refused:customer_mismatch']);
  });

  it('Stripe says the subscription belongs to another customer: refused (customer_mismatch)', async () => {
    const h = setup();
    h.subscriptions.set(SUB_1, subscriptionAt(SUB_1, { customerId: 'cus_Other' }));
    await paid(h, paidCreate());
    expect(historyKinds(h.world)).toEqual(['mismatch_refused:customer_mismatch']);
  });

  it('a tier the config does not define: refused (tier_not_configured)', async () => {
    const h = setup();
    h.deps.entitlementConfig = () => ({ tierOrder: [TIER_B], matrix: { version: 7 } }) as unknown as ReturnType<PlanPaymentDeps['entitlementConfig']>;
    await paid(h, paidCreate());
    expect(historyKinds(h.world)).toEqual(['mismatch_refused:tier_not_configured']);
  });

  it('mixed positive tiers: refused (mixed_tiers)', async () => {
    const h = setup();
    await paid(h, invoiceEvent('invoice-paid-proration.json', { invoiceId: 'in_U1' }, (i) => { i.lines.data[0].amount = 50; }));
    expect(historyKinds(h.world)).toEqual(['mismatch_refused:mixed_tiers']);
  });

  it('a resent refused event is a replay: no second row, no second audit (C-2)', async () => {
    const h = setup();
    const event = invoiceEvent('invoice-paid-subscription-create.json', { invoiceId: 'in_C1' }, (i) => { i.currency = 'eur'; });
    await paid(h, event);
    await paid(h, event);
    expect(h.world.events).toHaveLength(1);
    expect(h.audits).toHaveLength(1);
    expect(h.logged('bos_billing_payment_refusal_replayed')).toHaveLength(1);
  });

  it('Q-3: no plan row → throws (claim released, Stripe retries), error + alert, NOTHING written, no audit', async () => {
    const h = setup();
    h.world.plan = null;
    await expect(paid(h, paidCreate())).rejects.toBeInstanceOf(PlanPaymentRetryError);
    expect(h.world.events).toEqual([]);
    expect(h.audits).toEqual([]);
    expect(h.logged('bos_billing_plan_row_missing')[0]).toMatchObject({ level: 'error', ctx: expect.objectContaining({ alert: true }) });
  });

  it('the billing row vanishing before the apply throws (retried)', async () => {
    const h = setup();
    const original = h.deps.billingEvents.applyPlanPayment;
    h.deps.billingEvents.applyPlanPayment = jest.fn(async () => ({ data: { status: 'billing_row_missing' as const }, error: null }));
    await expect(paid(h, paidCreate())).rejects.toThrow('billing_row_missing');
    h.deps.billingEvents.applyPlanPayment = original;
  });

  it('a customer change between read and lock (function says customer_mismatch): refused and recorded', async () => {
    const h = setup();
    h.deps.billingEvents.applyPlanPayment = jest.fn(async () => ({ data: { status: 'customer_mismatch' as const }, error: null }));
    await paid(h, paidCreate());
    expect(historyKinds(h.world)).toEqual(['mismatch_refused:customer_mismatch']);
  });

  it.each([
    ['the Stripe subscription read', (h: ReturnType<typeof setup>) => h.subscriptions.set(SUB_1, new Error('stripe down'))],
    ['the billing row read', (h: ReturnType<typeof setup>) => h.findByCustomer.mockResolvedValueOnce({ data: null, error: new Error('db down') } as never)],
    ['the catalog', (h: ReturnType<typeof setup>) => (h.deps.catalog.load as jest.Mock).mockRejectedValueOnce(new Error('catalog down'))],
    ['the apply call', (h: ReturnType<typeof setup>) => { h.deps.billingEvents.applyPlanPayment = jest.fn(async () => ({ data: null, error: new Error('rpc down') })); }],
    ['the refusal insert', (h: ReturnType<typeof setup>) => { h.world.billing = null; h.deps.billingEvents.recordEvent = jest.fn(async () => ({ data: null, error: new Error('insert down') })); }],
  ])('a failure of %s throws (could not tell), never a final answer', async (_label, breakIt) => {
    const h = setup();
    breakIt(h);
    await expect(paid(h, paidCreate())).rejects.toThrow();
    expect(h.audits).toEqual([]);
  });

  it('a truncated invoice is read in full (CF-2) before the facts', async () => {
    const h = setup();
    const event = invoiceEvent('invoice-paid-subscription-create.json', { invoiceId: 'in_C1' }, (i) => { i.lines.has_more = true; });
    h.lines.mockResolvedValue((event.data.object as Stripe.Invoice).lines.data);
    await paid(h, event);
    expect(h.lines).toHaveBeenCalledWith('in_C1');
    expect(h.world.plan?.tier).toBe(TIER_A);
  });

  it('logs and audit details carry ids only: no email, no metadata value', async () => {
    const h = setup();
    await paid(h, invoiceEvent('invoice-paid-subscription-create.json', { invoiceId: 'in_C1' }, (i) => {
      i.parent!.subscription_details!.metadata = { bos_user_id: ACCOUNT, product: 'business_os_plan' };
    }));
    const text = JSON.stringify(h.audits);
    expect(text).not.toContain('fixture@example.invalid');
    expect(text).not.toContain('business_os_plan');
  });
});

// ── QA hardening: metadata can never choose the account (SR-8) ──────────────

describe('metadata never chooses the account (SR-8, QA hardening)', () => {
  /** Every account id the run touched: lookups, apply, history rows, audits. */
  function accountsTouched(h: ReturnType<typeof setup>): string[] {
    const ids = new Set<string>();
    for (const call of (h.deps.billingEvents.applyPlanPayment as jest.Mock).mock.calls) ids.add(call[0].accountId);
    for (const row of h.world.events) if (row.userId) ids.add(row.userId);
    for (const audit of h.audits) ids.add(audit.accountId);
    return [...ids];
  }
  const naming = (account: string) =>
    invoiceEvent('invoice-paid-subscription-create.json', { invoiceId: 'in_M1' }, (i) => {
      i.parent!.subscription_details!.metadata = { bos_user_id: account, product: 'business_os_plan' };
      i.metadata = { bos_user_id: account };
    });

  it('metadata names account B, the billing row (by subscription) is account A: refused under A, B is never touched', async () => {
    const h = setup();
    h.world.billing = billingRow({ stripeSubscriptionId: SUB_1 });
    await paid(h, naming(OTHER_ACCOUNT));
    expect(historyKinds(h.world)).toEqual(['mismatch_refused:metadata_account_mismatch']);
    expect(accountsTouched(h)).toEqual([ACCOUNT]);
    expect(h.findBySub).toHaveBeenCalledWith(SUB_1, false);
    // The lookups are by Stripe ids only: no lookup ever took the metadata value.
    for (const call of [...h.findBySub.mock.calls, ...h.findByCustomer.mock.calls]) expect(call).not.toContain(OTHER_ACCOUNT);
    expect(h.world.plan?.tier).toBeNull();
  });

  it('metadata names account B, the billing row (by customer) is account A: refused under A, never B', async () => {
    const h = setup();
    await paid(h, naming(OTHER_ACCOUNT));
    expect(h.findByCustomer).toHaveBeenCalledWith(CUSTOMER, false);
    expect(accountsTouched(h)).toEqual([ACCOUNT]);
    expect(h.deps.billingEvents.applyPlanPayment).not.toHaveBeenCalled();
  });

  it('metadata only, no billing row for the invoice (B has a record for ANOTHER customer): unknown_customer with no account, B never touched', async () => {
    const h = setup();
    h.world.billing = billingRow({ accountId: OTHER_ACCOUNT, stripeCustomerId: 'cus_B1', stripeSubscriptionId: 'sub_B1' });
    await paid(h, naming(OTHER_ACCOUNT));
    expect(h.world.events).toEqual([expect.objectContaining({ userId: null, kind: 'mismatch_refused', refusalReason: 'unknown_customer' })]);
    expect(accountsTouched(h)).toEqual([]);
    expect(h.deps.billingEvents.applyPlanPayment).not.toHaveBeenCalled();
    expect(h.audits).toEqual([]);
  });

  it('the same holds for a failed payment: metadata only → unknown_customer, never B', async () => {
    const h = setup();
    h.world.billing = null;
    const event = invoiceEvent('invoice-payment-failed.json', { invoiceId: 'in_MF1' }, (i) => {
      i.parent!.subscription_details!.metadata = { bos_user_id: OTHER_ACCOUNT };
    });
    await recordFailedPlanInvoice(event, h.log, h.deps);
    expect(historyKinds(h.world)).toEqual(['mismatch_refused:unknown_customer']);
    expect(accountsTouched(h)).toEqual([]);
  });
});

// ── invoice.payment_failed (SA Q-2) ─────────────────────────────────────────

describe('invoice.payment_failed (SA Q-2; P-6a.2): one history row, never a plan write', () => {
  const failed = (invoiceId = 'in_F1') => invoiceEvent('invoice-payment-failed.json', { invoiceId });
  const run = (h: ReturnType<typeof setup>, event: Stripe.Event) => recordFailedPlanInvoice(event, h.log, h.deps);

  // P-6a.2 changed what a RENEWAL failure does (this fixture is `subscription_cycle`):
  // one info audit on a new row, and the billing record is asked to count it.
  // Here the row holds no subscription yet, so the count is moot.
  it('records invoice_payment_failed with the amount due, warns, applies nothing; a renewal is audited once (P-6a.2)', async () => {
    const h = setup();
    await run(h, failed());
    expect(historyKinds(h.world)).toEqual(['invoice_payment_failed']);
    expect(h.world.events[0]).toMatchObject({ userId: ACCOUNT, invoiceId: 'in_F1', subscriptionId: SUB_1 });
    expect(h.world.events[0].input).toMatchObject({ amountMinor: 5000, tier: TIER_B, paidAt: null, currency: 'usd' });
    expect(h.deps.billingEvents.applyPlanPayment).not.toHaveBeenCalled();
    expect(h.audits.map((a) => a.action)).toEqual(['BOS_BILLING_PAYMENT_FAILED']);
    expect(h.world.plan?.tier).toBeNull();
    expect(h.world.billing).toMatchObject({ failedAttempts: 0, lastPaymentFailedAt: null });
    expect(h.logged('bos_billing_payment_failed')[0].level).toBe('warn');
    expect(h.logged('bos_billing_renewal_failure_counted')[0].ctx).toMatchObject({ outcome: 'moot', reason: 'other_subscription' });
  });

  it('a redelivery is a replay (event-id duplicate counts as done): no second audit', async () => {
    const h = setup();
    const event = failed();
    await run(h, event);
    await run(h, event);
    expect(h.world.events).toHaveLength(1);
    expect(h.logged('bos_billing_payment_failed_replayed')).toHaveLength(1);
    expect(h.audits).toHaveLength(1);
  });

  it('the same account and metadata checks as paid apply first', async () => {
    const unknown = setup();
    unknown.world.billing = null;
    await run(unknown, failed());
    expect(historyKinds(unknown.world)).toEqual(['mismatch_refused:unknown_customer']);

    const mismatch = setup();
    await run(mismatch, invoiceEvent('invoice-payment-failed.json', { invoiceId: 'in_F1' }, (i) => {
      i.parent!.subscription_details!.metadata = { bos_user_id: OTHER_ACCOUNT };
    }));
    expect(historyKinds(mismatch.world)).toEqual(['mismatch_refused:metadata_account_mismatch']);
  });

  it('a record failure throws', async () => {
    const h = setup();
    h.deps.billingEvents.recordEvent = jest.fn(async () => ({ data: null, error: new Error('down') }));
    await expect(run(h, failed())).rejects.toThrow('down');
  });
});

// ── P-6a.2: renewal failures, 3-D Secure and the cure (§5.3, §5.4; SA C-1 to C-3, C-10, U-10) ──

/** The renewal period after the first one: the fixture line's next month. */
const P1_UNIX = 1_792_592_000;
const P2_UNIX = 1_795_184_000;
const P2_ISO = new Date(P2_UNIX * 1000).toISOString();
const RENEWAL_INVOICE = 'in_R1';
const HOSTED = 'https://invoice.stripe.com/i/acct_probe/test_renewal_one?s=ap';

interface UnpaidOptions {
  invoiceId?: string;
  attemptCount?: number;
  billingReason?: string | null;
  hostedInvoiceUrl?: string | null;
  periodEnd?: number;
  actionRequired?: boolean;
  created?: number;
}

/** A failed (or 3-D Secure) invoice on SUB_1 for the period ending at `periodEnd` (P). */
function unpaidEvent(opts: UnpaidOptions = {}): Stripe.Event {
  const event = invoiceEvent('invoice-payment-failed.json', { invoiceId: opts.invoiceId ?? RENEWAL_INVOICE }, (invoice) => {
    const raw = invoice as unknown as Record<string, unknown>;
    raw.billing_reason = opts.billingReason === undefined ? 'subscription_cycle' : opts.billingReason;
    raw.attempt_count = opts.attemptCount ?? 1;
    raw.hosted_invoice_url = opts.hostedInvoiceUrl ?? null;
    invoice.lines.data[0].period = { start: P1_UNIX, end: opts.periodEnd ?? P2_UNIX };
  });
  if (opts.actionRequired) event.type = 'invoice.payment_action_required' as Stripe.Event['type'];
  if (opts.created !== undefined) event.created = opts.created;
  return event;
}

const renewalPaid = (invoiceId = RENEWAL_INVOICE) => invoiceEvent('invoice-paid-renewal.json', { invoiceId });

/** A world whose account bought SUB_1 (paid through the first period). */
async function subscribedHarness() {
  const h = setup();
  await paid(h, paidCreate());
  expect(h.world.billing).toMatchObject({ stripeSubscriptionId: SUB_1, failedAttempts: 0 });
  h.audits.length = 0;
  h.order.length = 0;
  return h;
}

const failedRun = (h: ReturnType<typeof setup>, event: Stripe.Event) => recordFailedPlanInvoice(event, h.log, h.deps);
const actionRun = (h: ReturnType<typeof setup>, event: Stripe.Event) => recordActionRequiredPlanInvoice(event, h.log, h.deps);

describe('P-6a.2: a RENEWAL failure is counted on the billing record and audited once (§5.3)', () => {
  it('counts the attempt (Stripe count, the event date as display), one info audit with ids only', async () => {
    const h = await subscribedHarness();
    const event = unpaidEvent({ attemptCount: 1 });
    await failedRun(h, event);
    expect(h.world.billing).toMatchObject({ failedAttempts: 1, lastPaymentFailedAt: new Date(event.created * 1000).toISOString(), actionRequiredInvoiceUrl: null });
    expect(h.audits).toEqual([
      expect.objectContaining({
        action: 'BOS_BILLING_PAYMENT_FAILED',
        actor: { kind: 'system', source: 'stripe_webhook' },
        entityType: 'business_os_account_plan',
        entityId: ACCOUNT,
        severity: 'info',
        invalidatesEntitlements: false,
        details: expect.objectContaining({ invoiceId: RENEWAL_INVOICE, subscriptionId: SUB_1, attemptCount: 1, billingReason: 'subscription_cycle', livemode: false }),
      }),
    ]);
    // Never a plan write: the lifecycle derives grace from the paid-through date (SA-P8).
    expect(h.deps.billingEvents.applyPlanPayment).toHaveBeenCalledTimes(1);
  });

  it('the next attempt raises the count; a replay and a late older delivery change nothing and audit nothing more', async () => {
    const h = await subscribedHarness();
    const first = unpaidEvent({ attemptCount: 1 });
    const second = unpaidEvent({ attemptCount: 2, created: first.created + 60 });
    await failedRun(h, first);
    await failedRun(h, second);
    expect(h.world.billing?.failedAttempts).toBe(2);
    await failedRun(h, second);
    await failedRun(h, first);
    expect(h.world.billing).toMatchObject({ failedAttempts: 2, lastPaymentFailedAt: new Date(second.created * 1000).toISOString() });
    expect(h.audits.map((a) => a.action)).toEqual(['BOS_BILLING_PAYMENT_FAILED', 'BOS_BILLING_PAYMENT_FAILED']);
  });

  it('C-3: a billing write that fails throws (claim released), the audit is not lost, and the retry heals the count', async () => {
    const h = await subscribedHarness();
    const event = unpaidEvent();
    h.recordRenewalFailure.mockResolvedValueOnce({ data: null, error: Object.assign(new Error('db down'), { name: 'BillingAccountRepositoryError' }) } as never);
    await expect(failedRun(h, event)).rejects.toThrow('db down');
    expect(h.audits.map((a) => a.action)).toEqual(['BOS_BILLING_PAYMENT_FAILED']);
    expect(h.world.billing?.failedAttempts).toBe(0);
    // Stripe's retry: the history row is a duplicate, the count is written now, no second audit.
    await failedRun(h, event);
    expect(h.world.billing?.failedAttempts).toBe(1);
    expect(h.audits).toHaveLength(1);
    expect(h.world.events.filter((e) => e.kind === 'invoice_payment_failed')).toHaveLength(1);
  });

  it('C-2: two lost compare-and-set rounds release the claim (PlanPaymentRetryError)', async () => {
    const h = await subscribedHarness();
    h.recordRenewalFailure.mockResolvedValueOnce({ data: null, error: Object.assign(new Error('concurrent_change'), { name: 'BillingAccountRepositoryError' }) } as never);
    await expect(failedRun(h, unpaidEvent())).rejects.toMatchObject({ name: 'PlanPaymentRetryError', reason: 'renewal_failure_concurrent_change' });
  });

  it('C-1: a failure delivered after its cure (the row already paid through P) writes nothing to the billing record', async () => {
    const h = await subscribedHarness();
    await paid(h, renewalPaid());
    expect(h.world.billing?.currentPeriodEnd).toBe(P2_ISO);
    await failedRun(h, unpaidEvent({ invoiceId: 'in_R0_late' }));
    expect(h.world.billing).toMatchObject({ failedAttempts: 0, lastPaymentFailedAt: null });
    expect(h.logged('bos_billing_renewal_failure_counted')[0].ctx).toMatchObject({ outcome: 'moot', reason: 'period_already_paid' });
  });

  it('C-1: event.created in REAL time, far before the clock-time period (a test clock), still counts', async () => {
    const h = await subscribedHarness();
    await failedRun(h, unpaidEvent({ created: 1_600_000_000 }));
    expect(h.world.billing?.failedAttempts).toBe(1);
  });
});

describe('P-6a.2 U-10: an UPGRADE failure, or any non-renewal reason, never counts and is never audited', () => {
  it.each([['subscription_update'], ['subscription_create'], ['manual'], [null]])('billing_reason %s: one history row, no billing write, no audit', async (reason) => {
    const h = await subscribedHarness();
    await failedRun(h, unpaidEvent({ billingReason: reason }));
    expect(h.world.events.filter((e) => e.kind === 'invoice_payment_failed')).toHaveLength(1);
    expect(h.recordRenewalFailure).not.toHaveBeenCalled();
    expect(h.audits).toEqual([]);
    expect(h.world.billing?.failedAttempts).toBe(0);
    expect(h.logged('bos_billing_payment_failure_not_renewal')).toHaveLength(1);
  });

  it('an upgrade 3-D Secure: one payment_action_required history row, no URL stored, no audit', async () => {
    const h = await subscribedHarness();
    await actionRun(h, unpaidEvent({ billingReason: 'subscription_update', actionRequired: true, attemptCount: 0, hostedInvoiceUrl: HOSTED }));
    expect(historyKinds(h.world).filter((k) => k === 'payment_action_required')).toHaveLength(1);
    expect(h.recordActionRequired).not.toHaveBeenCalled();
    expect(h.world.billing?.actionRequiredInvoiceUrl).toBeNull();
    expect(h.audits).toEqual([]);
  });
});

describe('P-6a.2: a RENEWAL 3-D Secure request (§5.4)', () => {
  it('stores the Stripe-hosted URL, counts one attempt from attempt_count 0 (X-5), one info audit; the URL is in no log line and no audit', async () => {
    const h = await subscribedHarness();
    await actionRun(h, unpaidEvent({ actionRequired: true, attemptCount: 0, hostedInvoiceUrl: HOSTED }));
    expect(historyKinds(h.world)).toContain('payment_action_required');
    expect(h.world.billing).toMatchObject({ failedAttempts: 1, actionRequiredInvoiceUrl: HOSTED });
    expect(h.audits.map((a) => [a.action, a.severity])).toEqual([['BOS_BILLING_PAYMENT_ACTION_REQUIRED', 'info']]);
    const seen = JSON.stringify({ logs: h.logLines, audits: h.audits });
    expect(seen).not.toContain('invoice.stripe.com');
    expect(seen).not.toContain('test_renewal_one');
  });

  it('X-5 order: the plain failure of the SAME invoice (same hosted URL) after it keeps the URL', async () => {
    const h = await subscribedHarness();
    await actionRun(h, unpaidEvent({ actionRequired: true, attemptCount: 0, hostedInvoiceUrl: HOSTED }));
    await failedRun(h, unpaidEvent({ attemptCount: 0, hostedInvoiceUrl: HOSTED }));
    expect(h.world.billing).toMatchObject({ failedAttempts: 1, actionRequiredInvoiceUrl: HOSTED });
  });

  it('a URL that is not a Stripe page is never stored, and the warn carries no value', async () => {
    const h = await subscribedHarness();
    await actionRun(h, unpaidEvent({ actionRequired: true, hostedInvoiceUrl: 'https://example.invalid/scrubbed' }));
    expect(h.world.billing).toMatchObject({ failedAttempts: 1, actionRequiredInvoiceUrl: null });
    expect(h.logged('bos_billing_action_required_url_unusable')[0].ctx).toMatchObject({ hasUrl: true });
    expect(JSON.stringify(h.logLines)).not.toContain('example.invalid');
  });
});

describe('P-6a.2: the cure after a paid invoice (SA C-1 ruling, rule 5)', () => {
  it('a paid renewal (the newest invoice) clears the count and the URL, keeps the date', async () => {
    const h = await subscribedHarness();
    const failure = unpaidEvent({ actionRequired: true, attemptCount: 0, hostedInvoiceUrl: HOSTED });
    await actionRun(h, failure);
    await paid(h, renewalPaid());
    expect(h.world.billing).toMatchObject({
      currentPeriodEnd: P2_ISO,
      failedAttempts: 0,
      actionRequiredInvoiceUrl: null,
      lastPaymentFailedAt: new Date(failure.created * 1000).toISOString(),
    });
    expect(h.logged('bos_billing_renewal_failure_cleared')).toHaveLength(1);
  });

  it('heals on already_applied: a crash after the commit is cured by Stripe redelivering the paid event', async () => {
    const h = await subscribedHarness();
    await failedRun(h, unpaidEvent());
    h.clearRenewalFailure.mockResolvedValueOnce({ data: null, error: new Error('db down') } as never);
    const paidEvent = renewalPaid();
    await paid(h, paidEvent);
    expect(h.world.billing?.failedAttempts).toBe(1);
    expect(h.logged('bos_billing_renewal_failure_clear_failed')[0].level).toBe('warn');
    await paid(h, paidEvent);
    expect(h.world.billing?.failedAttempts).toBe(0);
  });

  it('a late replay of an OLDER paid invoice clears nothing', async () => {
    const h = await subscribedHarness();
    await paid(h, renewalPaid());
    // A failure on the NEXT period, then the first period's paid invoice delivered again.
    await failedRun(h, unpaidEvent({ invoiceId: 'in_R2', periodEnd: P2_UNIX + 30 * 86_400 }));
    expect(h.world.billing?.failedAttempts).toBe(1);
    await paid(h, paidCreate());
    expect(h.world.billing?.failedAttempts).toBe(1);
  });

  it('never throws, even when the port itself throws: the money is committed', async () => {
    const h = await subscribedHarness();
    h.clearRenewalFailure.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await expect(paid(h, renewalPaid())).resolves.toBeUndefined();
    expect(h.logged('bos_billing_renewal_failure_clear_failed')).toHaveLength(1);
  });

  it('a replayed REFUSAL (already_recorded) cures nothing', async () => {
    const h = await subscribedHarness();
    h.deps.billingEvents.applyPlanPayment = jest.fn(async () => ({ data: { status: 'already_recorded' as const, eventRowId: '44444444-4444-4444-8444-000000000099' }, error: null }));
    h.clearRenewalFailure.mockClear();
    await paid(h, renewalPaid());
    expect(h.clearRenewalFailure).not.toHaveBeenCalled();
  });
});
