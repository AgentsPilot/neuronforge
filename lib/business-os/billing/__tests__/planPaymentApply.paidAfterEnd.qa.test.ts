/** QA (FU-P7a4-1): independent edge tests. Harness copied from planPaymentApply.test.ts. */
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
  paidAfterEnd,
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
/* The instant `deps.now` hands the implementation. The world fake shares it
   so the two never disagree about whether a plan is still in force. */
const FROZEN_NOW_MS = Date.parse('2026-10-15T09:00:00.000Z');
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
    /*
     * THE SAME CLOCK THE IMPLEMENTATION IS GIVEN, not the wall clock.
     *
     * `deps.now` is pinned to 2026-10-15 for every test here, but this fake read
     * `Date.now()`. The first period ends 2026-10-21T14:13:20Z, so once real
     * time passed that the plan read as expired, `inForce` went false, and a
     * RENEWAL stopped being grandfathered: C6-2b failed on a `plan_version` the
     * clause exists to keep. Nothing in the code changed — the date did, which
     * is why it passed on main until 2026-10-20 and fails for everyone after.
     */
    const inForce =
      plan.tier !== null &&
      (plan.tierExpiresAt === null || Date.parse(plan.tierExpiresAt) > FROZEN_NOW_MS);
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

// ── QA: FU-P7a4-1 edges ───────────────────────────────────────────────────────

const ALERT = 'bos_billing_paid_after_end';
const PERIOD_END_S = 1792592000;
const PAID_S = 1790000070;
const iso = (s: number) => new Date(s * 1000).toISOString();
const F = { periodEnd: iso(PERIOD_END_S), paidAt: iso(PAID_S) };
const S = (endedAt: unknown, extra: Record<string, unknown> = {}) =>
  ({ endedAt, status: 'canceled', ...extra }) as unknown as Parameters<typeof paidAfterEnd>[1];

describe('QA FU-P7a4-1: paidAfterEnd strict boundaries', () => {
  it('endedAt exactly equal to paidAt: null (strict >)', () => {
    expect(paidAfterEnd(F, S(PAID_S))).toBeNull();
  });
  it('endedAt one second before paidAt: fires', () => {
    expect(paidAfterEnd(F, S(PAID_S - 1))).not.toBeNull();
  });
  it('endedAt exactly equal to periodEnd (and paidAt after it): null', () => {
    expect(paidAfterEnd({ periodEnd: iso(PERIOD_END_S), paidAt: iso(PERIOD_END_S + 10) }, S(PERIOD_END_S))).toBeNull();
  });
  it('endedAt one second before periodEnd, paid after: fires', () => {
    expect(paidAfterEnd({ periodEnd: iso(PERIOD_END_S), paidAt: iso(PERIOD_END_S + 10) }, S(PERIOD_END_S - 1))).not.toBeNull();
  });
  it('sub-second: paidAt 1 ms after endedAt fires; same ms does not', () => {
    const ended = PAID_S - 100;
    expect(paidAfterEnd({ periodEnd: F.periodEnd, paidAt: new Date(ended * 1000 + 1).toISOString() }, S(ended))).not.toBeNull();
    expect(paidAfterEnd({ periodEnd: F.periodEnd, paidAt: new Date(ended * 1000).toISOString() }, S(ended))).toBeNull();
  });
});

describe('QA FU-P7a4-1: units and unreadable inputs', () => {
  it('endedAt in seconds is interpreted as seconds (ISO echo matches)', () => {
    expect(paidAfterEnd(F, S(PAID_S - 20))?.subscriptionEndedAt).toBe(iso(PAID_S - 20));
  });
  it('endedAt mistakenly in milliseconds: far future, so never fires, never throws', () => {
    expect(() => paidAfterEnd(F, S((PAID_S - 20) * 1000))).not.toThrow();
    expect(paidAfterEnd(F, S((PAID_S - 20) * 1000))).toBeNull();
  });
  it.each([[0], [-1], [-1790000000], [null], [undefined], [Number.NaN], [Number.NEGATIVE_INFINITY], ['1790000050'], [true], [{}]])(
    'endedAt %p: null',
    (v) => {
      expect(paidAfterEnd(F, S(v))).toBeNull();
    }
  );
  it.each([[null], [undefined], [''], ['not a date'], ['2026-13-45T99:00:00Z'], [1790000070 as unknown as string]])('paidAt %p: null', (v) => {
    expect(paidAfterEnd({ periodEnd: F.periodEnd, paidAt: v as string | null }, S(PAID_S - 20))).toBeNull();
  });
  it.each([[''], ['garbage'], [null], [PERIOD_END_S as unknown as string]])('periodEnd %p: null', (v) => {
    expect(paidAfterEnd({ periodEnd: v as string, paidAt: F.paidAt }, S(PAID_S - 20))).toBeNull();
  });
  it('null facts object: no throw', () => {
    expect(() => paidAfterEnd(null as unknown as typeof F, S(PAID_S - 20))).not.toThrow();
    expect(paidAfterEnd(null as unknown as typeof F, S(PAID_S - 20))).toBeNull();
  });
});

describe('QA FU-P7a4-1: cancellationReason mapping', () => {
  it.each([['payment_failed'], ['cancellation_requested'], ['payment_disputed']])('%s passes through', (r) => {
    expect(paidAfterEnd(F, S(PAID_S - 20, { cancellationReason: r }))?.cancellationReason).toBe(r);
  });
  it.each([[undefined], [null]])('%p maps to null', (r) => {
    expect(paidAfterEnd(F, S(PAID_S - 20, { cancellationReason: r }))?.cancellationReason).toBeNull();
  });
  // QA note (edge case E-1 in the workplan report): values outside the three
  // ('other', '', 'something_new') are mapped to null by the StripeService read
  // (cancellationReasonOf), the only producer. `paidAfterEnd` itself passes a
  // runtime value through unchecked; not pinned here either way.
});

describe('QA FU-P7a4-1: the webhook, outcome by outcome', () => {
  const ENDED = PAID_S - 20;
  const endedSub = (h: ReturnType<typeof setup>, extra: Record<string, unknown> = {}) =>
    h.subscriptions.set(SUB_1, { ...subscriptionAt(SUB_1, { status: 'canceled', endedAt: ENDED }), cancellationReason: 'payment_failed', ...extra } as StripeSubscription);
  const forceResult = (h: ReturnType<typeof setup>, data: unknown) => {
    h.deps.billingEvents.applyPlanPayment = jest.fn(async () => ({ data, error: null })) as unknown as PlanPaymentDeps['billingEvents']['applyPlanPayment'];
  };

  it('recorded (planWritten false) fires once with status recorded', async () => {
    const h = setup();
    endedSub(h);
    forceResult(h, { status: 'recorded', eventRowId: 'row-1', tierBefore: TIER_B, tierAfter: TIER_B, planWritten: false, anchorSet: false, firstPaymentStamped: false });
    await paid(h, paidCreate());
    const lines = h.logged(ALERT);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 'error', ctx: { alert: true, status: 'recorded', planWritten: false, eventRowId: 'row-1', cancellationReason: 'payment_failed' } });
  });

  it.each([
    [{ status: 'already_applied', eventRowId: 'row-x' }],
    [{ status: 'already_recorded', eventRowId: 'row-x' }],
    [{ status: 'customer_mismatch' }],
    [{ status: 'plan_row_missing' }],
    [{ status: 'billing_row_missing' }],
    [{ status: 'subscription_conflict', eventRowId: null }],
  ])('%p: silent', async (data) => {
    const h = setup();
    endedSub(h);
    forceResult(h, data);
    await paid(h, paidCreate()).catch(() => undefined);
    expect(h.logged(ALERT)).toHaveLength(0);
  });

  it('subscription_conflict with a row fires once', async () => {
    const h = setup();
    endedSub(h);
    forceResult(h, { status: 'subscription_conflict', eventRowId: 'row-c' });
    await paid(h, paidCreate());
    expect(h.logged(ALERT)).toHaveLength(1);
    expect(h.logged(ALERT)[0].ctx).toMatchObject({ status: 'subscription_conflict', eventRowId: 'row-c', planWritten: false, tierBefore: null, tierAfter: null });
  });

  it('a read that filtered the reason to null logs null', async () => {
    const h = setup();
    endedSub(h, { cancellationReason: null });
    await paid(h, paidCreate());
    expect(h.logged(ALERT)[0].ctx.cancellationReason).toBeNull();
  });

  it('endedAt equal to paid_at at the webhook: silent, applied as usual', async () => {
    const h = setup();
    endedSub(h, { endedAt: PAID_S });
    await paid(h, paidCreate());
    expect(h.logged('bos_billing_invoice_applied')).toHaveLength(1);
    expect(h.logged(ALERT)).toHaveLength(0);
  });

  it('endedAt 0 / negative at the webhook: silent, applied as usual', async () => {
    for (const endedAt of [0, -5]) {
      const h = setup();
      endedSub(h, { endedAt });
      await expect(paid(h, paidCreate())).resolves.toBeUndefined();
      expect(h.world.plan?.tier).toBe(TIER_A);
      expect(h.logged(ALERT)).toHaveLength(0);
    }
  });

  it('PII: no email, name, customer id, metadata or owner text anywhere in the alert', async () => {
    const h = setup();
    endedSub(h, { metadata: { bos_user_id: ACCOUNT, owner_name: 'Jane Owner', email: 'jane@owner.test' } });
    const event = invoiceEvent('invoice-paid-subscription-create.json', { invoiceId: 'in_PII' }, (invoice) => {
      invoice.metadata = { note: 'secret owner note' };
      (invoice as unknown as Record<string, unknown>).customer_email = 'jane@owner.test';
      (invoice as unknown as Record<string, unknown>).customer_name = 'Jane Owner';
    });
    await paid(h, event);
    const ctx = h.logged(ALERT)[0].ctx;
    const text = JSON.stringify(ctx);
    for (const bad of ['jane@owner.test', 'Jane Owner', 'secret owner note', CUSTOMER, '@']) expect(text).not.toContain(bad);
    for (const key of ['customerId', 'customer', 'email', 'name', 'metadata', 'customerEmail']) expect(ctx).not.toHaveProperty(key);
  });
});
