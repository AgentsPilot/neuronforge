/**
 * The first payment stamp's side effects in the webhook apply (plan payments
 * P-5a.1, workplan BUSINESS_OS_PLAN_PAYMENTS_P5A_WORKPLAN.md §3.2, §8 "Exactly
 * once"; SA rulings S5-3 to S5-5, Q-1, Q-2; conditions P5-C3, P5-C7, W-5, W-6).
 *
 * What matters:
 *   - only the function's own flag drives anything, and only on applied /
 *     recorded: one BOS_BILLING_FIRST_PAYMENT_STAMPED entry next to the
 *     invoice-paid entry, both under ONE flush (the real recordPlanChange and
 *     the real bounded flush run here, over a recording audit sink);
 *   - the entry is ALWAYS written when the flag is true: a missing lineage
 *     port, a read error, a missing row or a throw give `source: null`;
 *   - replays, refusals and a false flag read no lineage and write no entry;
 *   - nothing after the apply throws, so the claim is never released for a
 *     payment that is already committed;
 *   - through the real handler, the same invoice twice is stamped and audited
 *     once.
 *
 * The SQL side (the flag is true exactly once) is the probe's job:
 * scripts/probe-bos-first-payment-stamp.sql, F01 to F10.
 */

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const auditCalls: string[] = [];
const auditEntries: Array<Record<string, unknown>> = [];
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: {
    getInstance: () => ({
      log: async (entry: Record<string, unknown>) => {
        auditCalls.push(`log:${String(entry.action)}`);
        auditEntries.push(entry);
      },
      flush: async () => {
        auditCalls.push('flush');
      },
    }),
  },
  AuditTrail: {
    log: async () => {
      auditCalls.push('DEFAULT SINK');
    },
    flush: async () => {
      auditCalls.push('DEFAULT SINK');
    },
  },
}));
jest.mock('@/lib/business-os/entitlements/EntitlementService', () => ({
  getEntitlementService: () => ({ invalidate: () => undefined }),
}));
const PLATFORM = '00000000-0000-4000-8000-0000000000aa';
jest.mock('@/lib/business-os/llm/aiActionAudit', () => ({
  platformActorId: () => PLATFORM,
}));

import fs from 'fs';
import path from 'path';
import type Stripe from 'stripe';

import {
  applyPaidPlanInvoice,
  PlanPaymentRetryError,
  type PlanPaymentDeps,
} from '@/lib/business-os/billing/planPaymentApply';
import { createPlanBillingHandler, type PlanBillingHandlerDeps } from '@/lib/business-os/billing/planBillingHandler';
import { BOS_PLAN_LOOKUP_KEYS } from '@/lib/business-os/billing/planPriceCatalog';
import { planTierForLookupKey } from '@/lib/business-os/billing/planPriceCatalog';
import { __resetAuditFlushChainForTests } from '@/lib/audit/boundedAuditFlush';
import { recordPlanChange, type RecordPlanChangeInput } from '@/lib/business-os/entitlements/recordPlanChange';
import type { BusinessOsBillingAccount } from '@/lib/repositories/BusinessOsBillingAccountRepository';
import type {
  BusinessOsApplyPlanPaymentInput,
  BusinessOsApplyPlanPaymentResult,
} from '@/lib/repositories/BusinessOsBillingEventRepository';
import type { BusinessOsAccountHoldFacts } from '@/lib/repositories/types';
import type { Logger } from '@/lib/logger';

const FIXTURES = path.join(__dirname, 'fixtures', 'stripe');
const [KEY_A] = BOS_PLAN_LOOKUP_KEYS;
const TIER_A = planTierForLookupKey(KEY_A) as string;
const PRICE_A = 'price_probe_a_handbuilt';
const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const CUSTOMER = 'cus_A1';
const SUB_1 = 'sub_S1';
const ROW_ID = '44444444-4444-4444-8444-000000000001';

let eventSeq = 0;
function paidEvent(invoiceId = 'in_C1'): Stripe.Event {
  const event = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'invoice-paid-subscription-create.json'), 'utf8')) as Stripe.Event;
  eventSeq += 1;
  event.id = `evt_F${eventSeq}`;
  event.livemode = false;
  const invoice = event.data.object as Stripe.Invoice;
  invoice.id = invoiceId;
  invoice.customer = CUSTOMER;
  invoice.parent!.subscription_details!.subscription = SUB_1;
  return event;
}

function billingRow(): BusinessOsBillingAccount {
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
  };
}

/** The `applied` / `recorded` member of the result union. */
type AppliedResult = Extract<BusinessOsApplyPlanPaymentResult, { planWritten: boolean }>;

const applied = (overrides: Partial<AppliedResult> = {}): BusinessOsApplyPlanPaymentResult => ({
  status: 'applied',
  eventRowId: ROW_ID,
  tierBefore: null,
  tierAfter: TIER_A,
  planWritten: true,
  anchorSet: true,
  firstPaymentStamped: true,
  ...overrides,
});

type LineagePort = NonNullable<PlanPaymentDeps['lineage']>;
type LineageRead = Awaited<ReturnType<LineagePort['findHoldFactsForAccount']>>;
const friendFacts: BusinessOsAccountHoldFacts = { invite_id: '55555555-5555-4555-8555-555555555555', source: 'account_invite', first_paid_at: null };

interface SetupOptions {
  answers?: BusinessOsApplyPlanPaymentResult[];
  apply?: (input: BusinessOsApplyPlanPaymentInput) => BusinessOsApplyPlanPaymentResult;
  lineage?: LineagePort | null;
  recordPlanChange?: (input: RecordPlanChangeInput) => Promise<void>;
}

function setup(opts: SetupOptions = {}) {
  const answers = [...(opts.answers ?? [applied()])];
  const lineageRead = jest.fn(async (): Promise<LineageRead> => ({ data: friendFacts, error: null }));
  const lineage: LineagePort | undefined = opts.lineage === null ? undefined : opts.lineage ?? { findHoldFactsForAccount: lineageRead };
  const planChanges: RecordPlanChangeInput[] = [];
  const realRecord = async (input: RecordPlanChangeInput) => {
    planChanges.push(input);
    await recordPlanChange(input);
  };
  const deps: PlanPaymentDeps = {
    billingAccounts: {
      findByStripeSubscription: jest.fn(async () => ({ data: null, error: null })),
      findByStripeCustomer: jest.fn(async () => ({ data: billingRow(), error: null })),
    } as unknown as PlanPaymentDeps['billingAccounts'],
    billingEvents: {
      applyPlanPayment: jest.fn(async (input: BusinessOsApplyPlanPaymentInput) => ({
        data: opts.apply ? opts.apply(input) : (answers.shift() as BusinessOsApplyPlanPaymentResult),
        error: null,
      })),
      recordEvent: jest.fn(async () => ({ data: { outcome: 'recorded', eventRowId: ROW_ID }, error: null })),
    } as unknown as PlanPaymentDeps['billingEvents'],
    stripe: () =>
      ({
        listInvoiceLinesAll: jest.fn(),
        retrieveBusinessOsSubscription: jest.fn(async (id: string) => ({
          id,
          status: 'active',
          customerId: CUSTOMER,
          billingCycleAnchor: 1_790_000_000,
          cancelAtPeriodEnd: false,
          endedAt: null,
          livemode: false,
          metadata: {},
          priceIds: [PRICE_A],
        })),
      }) as unknown as ReturnType<PlanPaymentDeps['stripe']>,
    catalog: { load: jest.fn(async () => ({ byPriceId: new Map([[PRICE_A, KEY_A]]), fromCache: false })) },
    entitlementConfig: () => ({ tierOrder: [TIER_A], matrix: { version: 7 } }) as unknown as ReturnType<PlanPaymentDeps['entitlementConfig']>,
    recordPlanChange: opts.recordPlanChange ?? realRecord,
    ...(lineage ? { lineage } : {}),
  };
  const logLines: Array<{ level: string; ctx: Record<string, unknown> }> = [];
  const at = (level: string) => (ctx: Record<string, unknown>) => {
    logLines.push({ level, ctx });
  };
  const log: Record<string, unknown> = { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug') };
  log.child = () => log;
  const logged = (event: string) => logLines.filter((line) => line.ctx.event === event);
  return { deps, lineageRead, planChanges, log: log as unknown as Logger, logged, logLines };
}

const stampEntries = () => auditEntries.filter((entry) => entry.action === 'BOS_BILLING_FIRST_PAYMENT_STAMPED');

beforeEach(() => {
  auditCalls.length = 0;
  auditEntries.length = 0;
  __resetAuditFlushChainForTests();
});

describe('stamped: one stamp entry with the invoice-paid entry, under ONE flush (S5-4, Q-1, P5-C7)', () => {
  it.each([['applied'], ['recorded']] as const)('%s with the flag true writes both entries and flushes once', async (status) => {
    const h = setup({ answers: [applied({ status, planWritten: status === 'applied', anchorSet: status === 'applied' })] });
    await applyPaidPlanInvoice(paidEvent(), h.log, h.deps);
    expect(auditCalls).toEqual(['log:BOS_BILLING_INVOICE_PAID', 'log:BOS_BILLING_FIRST_PAYMENT_STAMPED', 'flush']);
    expect(h.planChanges).toHaveLength(1);
    expect(h.lineageRead).toHaveBeenCalledTimes(1);
    expect(h.lineageRead).toHaveBeenCalledWith(ACCOUNT);
  });

  it('the stamp entry: lineage entity and account, platform actor, ids only, the source read from lineage', async () => {
    const h = setup();
    const event = paidEvent('in_STAMP1');
    await applyPaidPlanInvoice(event, h.log, h.deps);
    expect(stampEntries()).toEqual([
      {
        action: 'BOS_BILLING_FIRST_PAYMENT_STAMPED',
        entityType: 'business_os_account_lineage',
        entityId: ACCOUNT,
        userId: ACCOUNT,
        actorId: PLATFORM,
        details: { invoiceId: 'in_STAMP1', eventRowId: ROW_ID, source: 'account_invite', livemode: false, stripeEventId: event.id, actor: 'stripe_webhook' },
        severity: 'info',
      },
    ]);
    expect(JSON.stringify(stampEntries())).not.toMatch(/@|email/i);
    expect(h.logged('bos_billing_first_payment_stamped')).toEqual([
      expect.objectContaining({ level: 'info', ctx: expect.objectContaining({ accountId: ACCOUNT, eventRowId: ROW_ID, source: 'account_invite', invoiceId: 'in_STAMP1' }) }),
    ]);
  });

  it('the invoice-paid entry is unchanged by the stamp (same fields as P-3b.2), and comes first', async () => {
    const h = setup();
    await applyPaidPlanInvoice(paidEvent(), h.log, h.deps);
    expect(auditEntries[0]).toMatchObject({ action: 'BOS_BILLING_INVOICE_PAID', entityType: 'business_os_account_plan', entityId: ACCOUNT, actorId: PLATFORM });
    expect(Object.keys(auditEntries[0].details as Record<string, unknown>).sort()).toEqual(
      ['actor', 'amountMinor', 'anchorSet', 'eventRowId', 'invoiceId', 'livemode', 'planWritten', 'stripeEventId', 'subscriptionId', 'tier'].sort()
    );
  });
});

describe('W-5: when the flag is true the entry is ALWAYS written, with source null when it cannot be read', () => {
  it.each([
    ['the port is not wired', null],
    ['the read returns an error', { findHoldFactsForAccount: async (): Promise<LineageRead> => ({ data: null, error: new Error('db down') }) }],
    ['the read finds no row', { findHoldFactsForAccount: async (): Promise<LineageRead> => ({ data: null, error: null }) }],
    [
      'the read throws',
      {
        findHoldFactsForAccount: async (): Promise<LineageRead> => {
          throw new Error('boom');
        },
      },
    ],
  ] as Array<[string, LineagePort | null]>)('%s: written with source null, a warn, and the apply resolves', async (_name, lineage) => {
    const h = setup({ lineage });
    await expect(applyPaidPlanInvoice(paidEvent(), h.log, h.deps)).resolves.toBeUndefined();
    expect(stampEntries()).toHaveLength(1);
    expect((stampEntries()[0].details as Record<string, unknown>).source).toBeNull();
    expect(h.logged('bos_billing_first_payment_source_unread')).toEqual([expect.objectContaining({ level: 'warn' })]);
    expect(auditCalls.filter((call) => call === 'flush')).toHaveLength(1);
  });
});

describe('not stamped: no lineage read and no stamp entry', () => {
  it.each([
    ['applied, flag false', applied({ firstPaymentStamped: false })],
    ['recorded, flag false', applied({ status: 'recorded', planWritten: false, anchorSet: false, firstPaymentStamped: false })],
  ])('%s: only the invoice-paid entry, one flush', async (_name, answer) => {
    const h = setup({ answers: [answer] });
    await applyPaidPlanInvoice(paidEvent(), h.log, h.deps);
    expect(auditCalls).toEqual(['log:BOS_BILLING_INVOICE_PAID', 'flush']);
    expect(h.lineageRead).not.toHaveBeenCalled();
    expect(h.planChanges[0]).not.toHaveProperty('companionEntries');
  });

  it.each([
    ['already_applied', { status: 'already_applied', eventRowId: ROW_ID }],
    ['already_recorded', { status: 'already_recorded', eventRowId: ROW_ID }],
  ] as Array<[string, BusinessOsApplyPlanPaymentResult]>)('a replay (%s) writes no audit and reads no lineage', async (_name, answer) => {
    const h = setup({ answers: [answer] });
    await applyPaidPlanInvoice(paidEvent(), h.log, h.deps);
    expect(auditCalls).toEqual([]);
    expect(h.lineageRead).not.toHaveBeenCalled();
  });

  it('a subscription conflict audits the refusal only, with no stamp and no lineage read', async () => {
    const h = setup({ answers: [{ status: 'subscription_conflict', eventRowId: ROW_ID }] });
    await applyPaidPlanInvoice(paidEvent(), h.log, h.deps);
    expect(auditEntries.map((entry) => entry.action)).toEqual(['BOS_BILLING_PAYMENT_REFUSED']);
    expect(h.lineageRead).not.toHaveBeenCalled();
  });

  it('a malformed flag on a 20261027-shaped answer (no flag) is treated as not stamped', async () => {
    const legacy = applied();
    delete (legacy as Partial<AppliedResult>).firstPaymentStamped;
    const h = setup({ answers: [legacy] });
    await applyPaidPlanInvoice(paidEvent(), h.log, h.deps);
    expect(stampEntries()).toEqual([]);
    expect(h.lineageRead).not.toHaveBeenCalled();
  });
});

describe('S5-5 b: nothing after the apply throws', () => {
  it('a recordPlanChange that rejects is logged with an alert and the apply resolves (no PlanPaymentRetryError)', async () => {
    const h = setup({
      recordPlanChange: async () => {
        throw new Error('audit exploded');
      },
    });
    await expect(applyPaidPlanInvoice(paidEvent(), h.log, h.deps)).resolves.toBeUndefined();
    expect(h.logged('bos_billing_invoice_audit_failed')).toEqual([expect.objectContaining({ level: 'error', ctx: expect.objectContaining({ alert: true }) })]);
  });

  it('a lineage read that throws together with a rejecting recordPlanChange still resolves', async () => {
    const h = setup({
      lineage: {
        findHoldFactsForAccount: async () => {
          throw new Error('boom');
        },
      },
      recordPlanChange: async () => {
        throw new Error('audit exploded');
      },
    });
    const outcome = await applyPaidPlanInvoice(paidEvent(), h.log, h.deps).then(
      () => 'resolved',
      (err: unknown) => (err instanceof PlanPaymentRetryError ? 'retry' : 'rejected')
    );
    expect(outcome).toBe('resolved');
  });
});

describe('end to end through the real plan handler: the same invoice twice is stamped and audited once', () => {
  it('first delivery: applied and stamped; second (a new event id, same invoice): already_applied, nothing written', async () => {
    // A small model of the function's idempotency and the once-only stamp:
    // a paid invoice id is applied once, and the lineage row is stamped once.
    const paidInvoices = new Map<string, string>();
    let stamped = false;
    const h = setup({
      apply: (input) => {
        const known = paidInvoices.get(input.stripeInvoiceId);
        if (known) return { status: 'already_applied', eventRowId: known };
        paidInvoices.set(input.stripeInvoiceId, ROW_ID);
        const stampsNow = input.amountMinor > 0 && !stamped;
        stamped = stamped || stampsNow;
        return applied({ firstPaymentStamped: stampsNow });
      },
    });
    const handlerDeps = { ...h.deps, stripeMode: () => 'test', now: () => new Date() } as unknown as PlanBillingHandlerDeps;
    const handler = createPlanBillingHandler(handlerDeps);

    await handler(paidEvent('in_TWICE'), h.log);
    await handler(paidEvent('in_TWICE'), h.log);

    expect(stampEntries()).toHaveLength(1);
    expect(auditEntries.filter((entry) => entry.action === 'BOS_BILLING_INVOICE_PAID')).toHaveLength(1);
    expect(auditCalls.filter((call) => call === 'flush')).toHaveLength(1);
    expect(h.lineageRead).toHaveBeenCalledTimes(1);
    expect(h.logged('bos_billing_invoice_replayed').map((line) => line.ctx.status)).toEqual(['already_applied']);
  });
});
