/**
 * N-2 in the webhook apply: the champion's "your friend subscribed" email
 * (plan payments P-5b.1; workplan BUSINESS_OS_PLAN_PAYMENTS_P5B_WORKPLAN.md
 * §3.1, §7 "Exactly once", "Never throws", "Order", "Budget"; SA S5-5, P5-C3,
 * P5-C8, O-4, Q-2, Q-4, C-2, C-4, C-6).
 *
 * What matters:
 *   - only the function's own stamp flag, on applied / recorded, reaches the
 *     notifier; replays, refusals, conflicts and a false flag never do, so the
 *     email goes once (also with a replay arriving MID-SEND);
 *   - organic first payments send and audit nothing; admin_invite ones reach
 *     the notifier (P-9.2, T10), which tells the issuing admin of a PAID invite;
 *   - an unread lineage still reaches the notifier, which audits "not notified";
 *   - the notifier runs AFTER the stamp and invoice-paid entries were flushed;
 *   - one 4 s clock covers the lineage read and the notification; the stamp
 *     flush is not counted; a backstop abandons a hung notifier;
 *   - with every leg hanging, the apply resolves within 8.5 s of the commit and
 *     throws nothing; `postCommitMs` is on its own post-commit line, and the
 *     applied line is still written once, at the commit (SA F-1).
 *
 * The real recordPlanChange, the real bounded flush, the real N-2 notifier and
 * the real N-1 template run here, over a recording audit sink and fake N-1
 * lookups. No database, no Stripe, no email leaves the test.
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
const sink: { hangFlush: boolean } = { hangFlush: false };
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: {
    getInstance: () => ({
      log: async (entry: Record<string, unknown>) => {
        auditCalls.push(`log:${String(entry.action)}`);
        auditEntries.push(entry);
      },
      flush: async () => {
        auditCalls.push('flush');
        if (sink.hangFlush) await new Promise(() => undefined);
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
  type FirstPaymentNotifier,
  type FirstPaymentNotifyInput,
  type PlanPaymentDeps,
} from '@/lib/business-os/billing/planPaymentApply';
import { createPlanBillingHandler, type PlanBillingHandlerDeps } from '@/lib/business-os/billing/planBillingHandler';
import { BOS_PLAN_LOOKUP_KEYS, planTierForLookupKey } from '@/lib/business-os/billing/planPriceCatalog';
import { __resetAuditFlushChainForTests } from '@/lib/audit/boundedAuditFlush';
import { recordPlanChange, type RecordPlanChangeInput } from '@/lib/business-os/entitlements/recordPlanChange';
import {
  createFirstPaymentNotifier,
  writeChampionNotificationAudit,
  type ChampionSubscribedNotifierDeps,
} from '@/lib/business-os/invites/championSubscribedNotification';
import type { InviterNotificationDeps } from '@/lib/business-os/invites/inviterNotification';
import type { Logger } from '@/lib/logger';
import type { SendEmailParams, SendEmailResult } from '@/lib/notifications/emailTransport';
import type { BusinessOsBillingAccount } from '@/lib/repositories/BusinessOsBillingAccountRepository';
import type {
  BusinessOsApplyPlanPaymentInput,
  BusinessOsApplyPlanPaymentResult,
} from '@/lib/repositories/BusinessOsBillingEventRepository';
import type { BusinessOsAccountHoldFacts, BusinessOsInviteNotificationFacts } from '@/lib/repositories/types';

const FIXTURES = path.join(__dirname, 'fixtures', 'stripe');
const [KEY_A] = BOS_PLAN_LOOKUP_KEYS;
const TIER_A = planTierForLookupKey(KEY_A) as string;
const PRICE_A = 'price_probe_a_handbuilt';
const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const CHAMPION = '44444444-4444-4444-8444-444444444444';
const INVITE = '55555555-5555-4555-8555-555555555555';
const CUSTOMER = 'cus_A1';
const SUB_1 = 'sub_S1';
const ROW_ID = '44444444-4444-4444-8444-000000000001';
const INVITEE = 'friend@example.com';
const CHAMPION_EMAIL = 'champion@example.org';

let eventSeq = 0;
function paidEvent(invoiceId = 'in_N1'): Stripe.Event {
  const event = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'invoice-paid-subscription-create.json'), 'utf8')) as Stripe.Event;
  eventSeq += 1;
  event.id = `evt_N${eventSeq}`;
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
const facts = (source: BusinessOsAccountHoldFacts['source'], inviteId: string | null = INVITE): BusinessOsAccountHoldFacts => ({
  invite_id: inviteId,
  source,
  first_paid_at: null,
});

const never = <T,>() => new Promise<T>(() => undefined);

interface SetupOptions {
  answers?: BusinessOsApplyPlanPaymentResult[];
  apply?: (input: BusinessOsApplyPlanPaymentInput) => BusinessOsApplyPlanPaymentResult;
  lineage?: LineagePort | null;
  /** `undefined` → a recording fake port; `null` → not wired. */
  notifier?: FirstPaymentNotifier | null;
  recordPlanChange?: (input: RecordPlanChangeInput) => Promise<void>;
  noAccount?: boolean;
}

function setup(opts: SetupOptions = {}) {
  const answers = [...(opts.answers ?? [applied()])];
  const order: string[] = [];
  const timeline: { committedAt: number | null } = { committedAt: null };
  const lineageRead = jest.fn(async (): Promise<LineageRead> => ({ data: facts('account_invite'), error: null }));
  const lineage: LineagePort | undefined = opts.lineage === null ? undefined : opts.lineage ?? { findHoldFactsForAccount: lineageRead };
  const notified: FirstPaymentNotifyInput[] = [];
  const fakeNotifier: FirstPaymentNotifier = {
    deadlineMs: 4_000,
    notifyChampion: jest.fn(async (input: FirstPaymentNotifyInput) => {
      order.push('notify');
      notified.push(input);
    }),
  };
  const notifier = opts.notifier === null ? undefined : opts.notifier ?? fakeNotifier;
  const realRecord = async (input: RecordPlanChangeInput) => {
    order.push('record:start');
    await recordPlanChange(input);
    order.push('record:end');
  };
  const deps: PlanPaymentDeps = {
    billingAccounts: {
      findByStripeSubscription: jest.fn(async () => ({ data: null, error: null })),
      findByStripeCustomer: jest.fn(async () => ({ data: opts.noAccount ? null : billingRow(), error: null })),
    } as unknown as PlanPaymentDeps['billingAccounts'],
    billingEvents: {
      applyPlanPayment: jest.fn(async (input: BusinessOsApplyPlanPaymentInput) => {
        const data = opts.apply ? opts.apply(input) : (answers.shift() as BusinessOsApplyPlanPaymentResult);
        timeline.committedAt = Date.now();
        return { data, error: null };
      }),
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
          items: [],
          pendingUpdate: null,
          latestInvoiceId: null,
        })),
      }) as unknown as ReturnType<PlanPaymentDeps['stripe']>,
    catalog: { load: jest.fn(async () => ({ byPriceId: new Map([[PRICE_A, KEY_A]]), fromCache: false })) },
    entitlementConfig: () => ({ tierOrder: [TIER_A], matrix: { version: 7 } }) as unknown as ReturnType<PlanPaymentDeps['entitlementConfig']>,
    recordPlanChange: opts.recordPlanChange ?? realRecord,
    ...(lineage ? { lineage } : {}),
    ...(notifier ? { firstPaymentNotifier: notifier } : {}),
  };
  const logLines: Array<{ level: string; ctx: Record<string, unknown> }> = [];
  // SA F-1: the applied and post-commit lines also land in `order`, so their
  // place relative to the audit and the notifier is pinned.
  const ORDERED_LINES = new Set(['bos_billing_invoice_applied', 'bos_billing_invoice_post_commit']);
  const at = (level: string) => (ctx: Record<string, unknown>) => {
    logLines.push({ level, ctx });
    if (ORDERED_LINES.has(String(ctx.event))) order.push(`line:${String(ctx.event)}`);
  };
  const log: Record<string, unknown> = { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug') };
  log.child = () => log;
  const logged = (event: string) => logLines.filter((line) => line.ctx.event === event);
  return { deps, lineageRead, fakeNotifier, notified, order, timeline, log: log as unknown as Logger, logged, logLines };
}

/** The real N-2 notifier over fake N-1 lookups and a controllable invite read and send. */
function realNotifier(options: { invite?: 'ok' | 'hang'; send?: 'ok' | 'hang' | (() => Promise<SendEmailResult>) } = {}) {
  const sent: SendEmailParams[] = [];
  const invite: BusinessOsInviteNotificationFacts = {
    issuer_kind: 'account',
    issuer_account_id: CHAMPION,
    issuer_admin_id: null, // P-9.2 (T10): read too; a friend invite has none.
    grant_kind: 'tier',
    email: INVITEE,
    redeemed_account_id: ACCOUNT,
  };
  const deps: ChampionSubscribedNotifierDeps = {
    invites: {
      findInviterNotificationFactsById: (async () =>
        options.invite === 'hang' ? never() : { data: invite, error: null }) as unknown as ChampionSubscribedNotifierDeps['invites']['findInviterNotificationFactsById'],
    },
    inviterDeps: ({ logger, audit }): InviterNotificationDeps => ({
      findUserIdentity: async () => ({ data: { email: CHAMPION_EMAIL }, error: null }),
      isActiveAdmin: async () => false,
      findProfileLanguage: async () => ({ data: 'he', error: null }),
      findPreferredLanguage: async () => ({ data: null, error: null }),
      senderAddress: () => 'notifications@agentspilot.ai',
      sendEmail: async (params: SendEmailParams): Promise<SendEmailResult> => {
        sent.push(params);
        if (options.send === 'hang') return never();
        if (typeof options.send === 'function') return options.send();
        return { sent: true, provider: 'resend', providerMessageId: 'msg_1' };
      },
      platformUrl: (p) => `https://app.example.test${p}`,
      audit,
      logger,
    }),
    // The production writer: one entry, one bounded flush, through the recording sink.
    writeAudit: writeChampionNotificationAudit,
  };
  const real = createFirstPaymentNotifier(deps);
  const notifyChampion = jest.fn((input: FirstPaymentNotifyInput) => real.notifyChampion(input));
  const notifier: FirstPaymentNotifier = { deadlineMs: real.deadlineMs, notifyChampion };
  return { notifier, notifyChampion, sent };
}

const n2Entries = () => auditEntries.filter((entry) => String(entry.action).startsWith('BOS_INVITE_INVITER_'));

/** Advance fake time in small steps until the promise settles (or the cap is hit). */
async function runFake<T>(promise: Promise<T>, capMs = 20_000): Promise<{ value: T; elapsedMs: number }> {
  const startedAt = Date.now();
  let settled = false;
  let value: T | undefined;
  let error: unknown;
  promise.then(
    (v) => {
      settled = true;
      value = v;
    },
    (err) => {
      settled = true;
      error = err;
    }
  );
  while (!settled && Date.now() - startedAt < capMs) {
    await jest.advanceTimersByTimeAsync(50);
  }
  if (!settled) throw new Error(`did not settle within ${capMs} ms of fake time`);
  if (error !== undefined) throw error;
  return { value: value as T, elapsedMs: Date.now() - startedAt };
}

beforeEach(() => {
  auditCalls.length = 0;
  auditEntries.length = 0;
  sink.hangFlush = false;
  __resetAuditFlushChainForTests();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('exactly once: only a stamped first payment, on applied / recorded, reaches the notifier', () => {
  it.each([['applied'], ['recorded']] as const)('%s with the flag true: called once, with the lineage invite id, ids only', async (status) => {
    const h = setup({ answers: [applied({ status, planWritten: status === 'applied', anchorSet: status === 'applied' })] });
    const event = paidEvent();
    await applyPaidPlanInvoice(event, h.log, h.deps);
    expect(h.fakeNotifier.notifyChampion).toHaveBeenCalledTimes(1);
    expect(h.notified[0]).toMatchObject({ accountId: ACCOUNT, inviteId: INVITE, lineageRead: 'ok', livemode: false, stripeEventId: event.id });
    expect(h.notified[0].remainingMs).toBeGreaterThan(0);
    expect(h.notified[0].remainingMs).toBeLessThanOrEqual(4_000);
  });

  it.each([
    ['applied, flag false', [applied({ firstPaymentStamped: false })]],
    ['recorded, flag false', [applied({ status: 'recorded', planWritten: false, anchorSet: false, firstPaymentStamped: false })]],
    ['already_applied', [{ status: 'already_applied', eventRowId: ROW_ID }]],
    ['already_recorded', [{ status: 'already_recorded', eventRowId: ROW_ID }]],
    ['subscription_conflict', [{ status: 'subscription_conflict', eventRowId: ROW_ID }]],
  ] as Array<[string, BusinessOsApplyPlanPaymentResult[]]>)('%s: never called, no lineage read', async (_name, answers) => {
    const h = setup({ answers });
    await applyPaidPlanInvoice(paidEvent(), h.log, h.deps);
    expect(h.fakeNotifier.notifyChampion).not.toHaveBeenCalled();
    expect(h.lineageRead).not.toHaveBeenCalled();
  });

  it.each([
    ['plan_row_missing', { status: 'plan_row_missing' }],
    ['billing_row_missing', { status: 'billing_row_missing' }],
  ] as Array<[string, BusinessOsApplyPlanPaymentResult]>)('%s: released for retry (as before), never called', async (_name, answer) => {
    const h = setup({ answers: [answer] });
    await expect(applyPaidPlanInvoice(paidEvent(), h.log, h.deps)).rejects.toBeInstanceOf(PlanPaymentRetryError);
    expect(h.fakeNotifier.notifyChampion).not.toHaveBeenCalled();
  });

  it('a refusal (unknown customer) never reaches the apply or the notifier', async () => {
    const h = setup({ noAccount: true });
    await applyPaidPlanInvoice(paidEvent(), h.log, h.deps);
    expect(h.deps.billingEvents.applyPlanPayment).not.toHaveBeenCalled();
    expect(h.fakeNotifier.notifyChampion).not.toHaveBeenCalled();
  });

  // P-9.2 (T10, BQ-P11): `admin_invite` now reaches the notifier (see the T10 block below); organic still never does.
  it.each(['organic'] as const)('a %s first payment: not called, no N-2 audit, an info line', async (source) => {
    const h = setup({ lineage: { findHoldFactsForAccount: async () => ({ data: facts(source, source === 'organic' ? null : INVITE), error: null }) } });
    await applyPaidPlanInvoice(paidEvent(), h.log, h.deps);
    expect(h.fakeNotifier.notifyChampion).not.toHaveBeenCalled();
    expect(n2Entries()).toEqual([]);
    expect(h.logged('bos_invite_subscribed_not_applicable')).toEqual([expect.objectContaining({ level: 'info', ctx: expect.objectContaining({ source }) })]);
  });

  it('through the real handler, the same invoice twice: one notification', async () => {
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
    const handler = createPlanBillingHandler({ ...h.deps, stripeMode: () => 'test', now: () => new Date() } as unknown as PlanBillingHandlerDeps);
    await handler(paidEvent('in_TWICE'), h.log);
    await handler(paidEvent('in_TWICE'), h.log);
    expect(h.fakeNotifier.notifyChampion).toHaveBeenCalledTimes(1);
  });

  it('C-4: a replay arriving WHILE the first delivery is still sending gets already_applied and sends nothing (one email in total)', async () => {
    let releaseSend: (result: SendEmailResult) => void = () => undefined;
    const sendGate = new Promise<SendEmailResult>((resolve) => {
      releaseSend = resolve;
    });
    const real = realNotifier({ send: () => sendGate });
    const paidInvoices = new Map<string, string>();
    const h = setup({
      notifier: real.notifier,
      apply: (input) => {
        const known = paidInvoices.get(input.stripeInvoiceId);
        if (known) return { status: 'already_applied', eventRowId: known };
        paidInvoices.set(input.stripeInvoiceId, ROW_ID);
        return applied({ firstPaymentStamped: true });
      },
    });
    const handler = createPlanBillingHandler({ ...h.deps, stripeMode: () => 'test', now: () => new Date() } as unknown as PlanBillingHandlerDeps);

    const first = handler(paidEvent('in_MID'), h.log);
    // Wait until the first delivery is inside the send.
    for (let i = 0; i < 200 && real.sent.length === 0; i += 1) await new Promise((resolve) => setImmediate(resolve));
    expect(real.sent).toHaveLength(1);

    await handler(paidEvent('in_MID'), h.log);
    expect(h.logged('bos_billing_invoice_replayed').map((line) => line.ctx.status)).toEqual(['already_applied']);
    expect(real.notifyChampion).toHaveBeenCalledTimes(1);

    releaseSend({ sent: true, provider: 'resend', providerMessageId: 'msg_1' });
    await first;
    expect(real.sent).toHaveLength(1);
    expect(n2Entries().map((entry) => entry.action)).toEqual(['BOS_INVITE_INVITER_NOTIFIED']);
  });
});

describe('C-6: an unread lineage still reaches the notifier, which audits "not notified" with no email', () => {
  it.each([
    ['not wired', null, 'no_port'],
    ['an error', { findHoldFactsForAccount: async (): Promise<LineageRead> => ({ data: null, error: new Error('db down') }) }, 'failed'],
    ['no row', { findHoldFactsForAccount: async (): Promise<LineageRead> => ({ data: null, error: null }) }, 'no_row'],
    [
      'a throw',
      {
        findHoldFactsForAccount: async (): Promise<LineageRead> => {
          throw new Error('boom');
        },
      },
      'failed',
    ],
  ] as Array<[string, LineagePort | null, string]>)('lineage read %s → notifier called with inviteId null and lineageRead %s', async (_name, lineage, lineageRead) => {
    const real = realNotifier();
    const h = setup({ lineage, notifier: real.notifier });
    await expect(applyPaidPlanInvoice(paidEvent(), h.log, h.deps)).resolves.toBeUndefined();
    expect(real.notifyChampion).toHaveBeenCalledWith(expect.objectContaining({ inviteId: null, lineageRead }));
    expect(real.sent).toEqual([]);
    expect(n2Entries()).toEqual([
      expect.objectContaining({
        action: 'BOS_INVITE_INVITER_NOT_NOTIFIED',
        entityType: 'business_os_invite',
        entityId: null,
        userId: null,
        actorId: null,
        details: expect.objectContaining({ reason: 'recipient_lookup_failed', lineageRead, accountId: ACCOUNT }),
      }),
    ]);
    // The stamp entry is still written, with source null (W-5).
    const stamp = auditEntries.find((entry) => entry.action === 'BOS_BILLING_FIRST_PAYMENT_STAMPED');
    expect((stamp?.details as Record<string, unknown>).source).toBeNull();
  });

  it('a friend payment with NO notifier wired is alerted (Q-4), and the payment completes', async () => {
    const h = setup({ notifier: null });
    await expect(applyPaidPlanInvoice(paidEvent(), h.log, h.deps)).resolves.toBeUndefined();
    expect(h.logged('bos_invite_subscribed_notifier_unwired')).toEqual([
      expect.objectContaining({ level: 'error', ctx: expect.objectContaining({ alert: true, source: 'account_invite', lineageRead: 'ok' }) }),
    ]);
  });
});

describe('order (S5-5): the notifier runs after the stamp and invoice-paid entries were flushed', () => {
  it('applied line → record:start → record:end → notify → post-commit line, and the flush happened before the notifier', async () => {
    const h = setup();
    await applyPaidPlanInvoice(paidEvent(), h.log, h.deps);
    expect(h.order).toEqual([
      'line:bos_billing_invoice_applied',
      'record:start',
      'record:end',
      'notify',
      'line:bos_billing_invoice_post_commit',
    ]);
    expect(auditCalls).toEqual(['log:BOS_BILLING_INVOICE_PAID', 'log:BOS_BILLING_FIRST_PAYMENT_STAMPED', 'flush']);
  });

  it('SA F-1: the applied line is written exactly once, before record:start, with P-3b\'s fields and no postCommitMs', async () => {
    const h = setup();
    const event = paidEvent();
    await applyPaidPlanInvoice(event, h.log, h.deps);
    const appliedLines = h.logged('bos_billing_invoice_applied');
    expect(appliedLines).toHaveLength(1);
    expect(appliedLines[0].level).toBe('info');
    expect(appliedLines[0].ctx).toEqual({
      event: 'bos_billing_invoice_applied',
      status: 'applied',
      planWritten: true,
      anchorSet: true,
      tier: TIER_A,
      accountId: ACCOUNT,
      invoiceId: 'in_N1',
      subscriptionId: SUB_1,
      livemode: false,
      stripeEventId: event.id,
    });
    expect(h.order.indexOf('line:bos_billing_invoice_applied')).toBeLessThan(h.order.indexOf('record:start'));
  });

  it('SA F-1: a post-commit chain that never settles still leaves the applied line', async () => {
    const h = setup({ recordPlanChange: () => never() });
    void applyPaidPlanInvoice(paidEvent(), h.log, h.deps);
    for (let i = 0; i < 50 && !h.order.includes('line:bos_billing_invoice_applied'); i += 1) await new Promise((resolve) => setImmediate(resolve));
    expect(h.logged('bos_billing_invoice_applied')).toHaveLength(1);
    expect(h.logged('bos_billing_invoice_post_commit')).toEqual([]);
  });

  it('with the real notifier: its own entry is flushed separately, after the first flush (Q-3), and never through the default sink', async () => {
    const real = realNotifier();
    const h = setup({ notifier: real.notifier });
    await applyPaidPlanInvoice(paidEvent(), h.log, h.deps);
    expect(auditCalls).toEqual(['log:BOS_BILLING_INVOICE_PAID', 'log:BOS_BILLING_FIRST_PAYMENT_STAMPED', 'flush', 'log:BOS_INVITE_INVITER_NOTIFIED', 'flush']);
    expect(real.sent).toHaveLength(1);
    expect(real.sent[0].to).toEqual([CHAMPION_EMAIL]);
    // C-2: no owner, the invite entity, never the lineage entity; no address anywhere.
    expect(n2Entries()).toEqual([
      expect.objectContaining({
        entityType: 'business_os_invite',
        entityId: INVITE,
        userId: null,
        actorId: null,
        details: expect.objectContaining({ event: 'subscribed', status: 'subscribed', recipientAccountId: CHAMPION, accountId: ACCOUNT }),
      }),
    ]);
    expect(JSON.stringify(n2Entries())).not.toContain('@');
    expect(JSON.stringify(h.logLines)).not.toContain('@');
  });
});

describe('S5-5 b: nothing after the apply throws', () => {
  it.each([
    [
      'rejects',
      async () => {
        throw new Error(`exploded for ${INVITEE}`);
      },
    ],
    [
      'throws synchronously',
      () => {
        throw new Error('sync boom');
      },
    ],
  ] as Array<[string, (input: FirstPaymentNotifyInput) => Promise<void>]>)('a notifier that %s: resolved, warned by error class, stamp entry written', async (_name, notifyChampion) => {
    const h = setup({ notifier: { deadlineMs: 4_000, notifyChampion } });
    await expect(applyPaidPlanInvoice(paidEvent(), h.log, h.deps)).resolves.toBeUndefined();
    expect(h.logged('bos_invite_subscribed_notifier_failed')).toEqual([expect.objectContaining({ level: 'warn', ctx: expect.objectContaining({ errName: 'Error' }) })]);
    expect(JSON.stringify(h.logLines)).not.toContain('@');
    expect(auditEntries.filter((entry) => entry.action === 'BOS_BILLING_FIRST_PAYMENT_STAMPED')).toHaveLength(1);
  });

  it('a recordPlanChange that rejects still lets the notifier run, and the apply resolves', async () => {
    const h = setup({
      recordPlanChange: async () => {
        throw new Error('audit exploded');
      },
    });
    const outcome = await applyPaidPlanInvoice(paidEvent(), h.log, h.deps).then(
      () => 'resolved',
      (err: unknown) => (err instanceof PlanPaymentRetryError ? 'retry' : 'rejected')
    );
    expect(outcome).toBe('resolved');
    expect(h.fakeNotifier.notifyChampion).toHaveBeenCalledTimes(1);
  });

  it('a hung notifier is abandoned at its backstop (remaining + 2 s audit + 0.5 s) and the apply resolves', async () => {
    jest.useFakeTimers();
    const h = setup({ notifier: { deadlineMs: 4_000, notifyChampion: () => never() } });
    const { elapsedMs } = await runFake(applyPaidPlanInvoice(paidEvent(), h.log, h.deps));
    expect(h.logged('bos_invite_subscribed_notifier_abandoned')).toEqual([expect.objectContaining({ ctx: expect.objectContaining({ backstopMs: 6_500 }) })]);
    expect(elapsedMs).toBeGreaterThanOrEqual(6_500);
    expect(elapsedMs).toBeLessThanOrEqual(6_600);
  });
});

describe('O-4: one clock over the lineage read and the notification', () => {
  it('a 1.5 s lineage read leaves 2.5 s; a 2 s stamp flush is NOT counted against it', async () => {
    jest.useFakeTimers();
    const h = setup({
      lineage: {
        findHoldFactsForAccount: () =>
          new Promise<LineageRead>((resolve) => {
            setTimeout(() => resolve({ data: facts('account_invite'), error: null }), 1_500);
          }),
      },
    });
    sink.hangFlush = true;
    await runFake(applyPaidPlanInvoice(paidEvent(), h.log, h.deps));
    expect(h.notified[0].remainingMs).toBe(2_500);
  });

  it('a lineage read that hangs times out at the 4 s clock: the notifier gets 0 ms and no invite id', async () => {
    jest.useFakeTimers();
    const h = setup({ lineage: { findHoldFactsForAccount: () => never() } });
    await runFake(applyPaidPlanInvoice(paidEvent(), h.log, h.deps));
    expect(h.notified[0]).toMatchObject({ inviteId: null, lineageRead: 'timed_out', remainingMs: 0 });
    expect(h.logged('bos_billing_first_payment_source_unread')).toEqual([expect.objectContaining({ ctx: expect.objectContaining({ outcome: 'timed_out' }) })]);
  });

  it('the clock is the port\'s own deadline', async () => {
    jest.useFakeTimers();
    const notified: FirstPaymentNotifyInput[] = [];
    const h = setup({
      notifier: { deadlineMs: 1_000, notifyChampion: async (input) => void notified.push(input) },
      lineage: { findHoldFactsForAccount: () => never() },
    });
    const { elapsedMs } = await runFake(applyPaidPlanInvoice(paidEvent(), h.log, h.deps));
    expect(notified[0]).toMatchObject({ lineageRead: 'timed_out', remainingMs: 0 });
    expect(elapsedMs).toBeLessThan(1_100);
  });
});

describe('C-4: every leg hanging, the apply resolves within 8.5 s of the commit and throws nothing', () => {
  const scenarios: Array<[string, { lineage: 'hang' | 'ok'; invite: 'ok' | 'hang'; send: 'ok' | 'hang' }]> = [
    ['the lineage read, then both flushes', { lineage: 'hang', invite: 'ok', send: 'ok' }],
    ['the invite read, then both flushes', { lineage: 'ok', invite: 'hang', send: 'ok' }],
    ['Resend, then both flushes', { lineage: 'ok', invite: 'ok', send: 'hang' }],
  ];
  it.each(scenarios)('%s', async (_name, legs) => {
    jest.useFakeTimers();
    sink.hangFlush = true;
    const real = realNotifier({ invite: legs.invite, send: legs.send });
    const h = setup({
      notifier: real.notifier,
      lineage: legs.lineage === 'hang' ? { findHoldFactsForAccount: () => never() } : undefined,
    });
    await runFake(applyPaidPlanInvoice(paidEvent(), h.log, h.deps));
    const postCommitMs = Date.now() - (h.timeline.committedAt as number);
    expect(postCommitMs).toBeLessThanOrEqual(8_500);
    // The figure is on its own post-commit line (C-4 as amended by SA F-1).
    const postCommitLine = h.logged('bos_billing_invoice_post_commit');
    expect(postCommitLine).toHaveLength(1);
    expect(postCommitLine[0].ctx.postCommitMs).toBe(postCommitMs);
    // The applied line was written once, at the commit, without the figure.
    const appliedLine = h.logged('bos_billing_invoice_applied');
    expect(appliedLine).toHaveLength(1);
    expect(appliedLine[0].ctx).not.toHaveProperty('postCommitMs');
    expect(postCommitMs).toBeGreaterThanOrEqual(4_000);
    // The notifier was never abandoned: its own bounds held.
    expect(h.logged('bos_invite_subscribed_notifier_abandoned')).toEqual([]);
  });
});

describe('postCommitMs on the post-commit line (SA F-1)', () => {
  it('is present on every applied / recorded delivery, stamped or not, with status and the ids', async () => {
    const h = setup({ answers: [applied({ firstPaymentStamped: false })] });
    const event = paidEvent();
    await applyPaidPlanInvoice(event, h.log, h.deps);
    const line = h.logged('bos_billing_invoice_post_commit');
    expect(line).toHaveLength(1);
    expect(line[0].level).toBe('info');
    expect(line[0].ctx).toMatchObject({ status: 'applied', accountId: ACCOUNT, invoiceId: 'in_N1', subscriptionId: SUB_1, livemode: false, stripeEventId: event.id });
    expect(typeof line[0].ctx.postCommitMs).toBe('number');
    expect(h.logged('bos_billing_invoice_applied')[0].ctx).not.toHaveProperty('postCommitMs');
  });
});

// ── P-9.2 T10 (BQ-P11, SA Q-10): N-2 to the ISSUING ADMIN of an admin Paid invite ──

const ADMIN = '77777777-7777-4777-8777-777777777777';
const ADMIN_EMAIL = 'admin@example.org';

/** The real N-2 notifier, over an ADMIN Paid invite redeemed by the payer, and an active admin. */
function realAdminNotifier(options: { grantKind?: 'tier' | 'cohort'; send?: () => Promise<SendEmailResult> } = {}) {
  const sent: SendEmailParams[] = [];
  const identityLookups: string[] = [];
  const invite: BusinessOsInviteNotificationFacts = {
    issuer_kind: 'admin',
    issuer_account_id: null,
    issuer_admin_id: ADMIN,
    grant_kind: options.grantKind ?? 'tier',
    email: INVITEE,
    redeemed_account_id: ACCOUNT,
  };
  const real = createFirstPaymentNotifier({
    invites: {
      findInviterNotificationFactsById: (async () => ({ data: invite, error: null })) as unknown as ChampionSubscribedNotifierDeps['invites']['findInviterNotificationFactsById'],
    },
    inviterDeps: ({ logger, audit }): InviterNotificationDeps => ({
      findUserIdentity: async (id) => {
        identityLookups.push(id);
        return { data: { email: id === ADMIN ? ADMIN_EMAIL : null }, error: null };
      },
      isActiveAdmin: async (id) => id === ADMIN,
      findProfileLanguage: async () => ({ data: 'en', error: null }),
      findPreferredLanguage: async () => ({ data: null, error: null }),
      senderAddress: () => 'notifications@agentspilot.ai',
      sendEmail: async (params: SendEmailParams): Promise<SendEmailResult> => {
        sent.push(params);
        if (options.send) return options.send();
        return { sent: true, provider: 'resend', providerMessageId: 'msg_admin' };
      },
      platformUrl: (p) => `https://app.example.test${p}`,
      audit,
      logger,
    }),
    writeAudit: writeChampionNotificationAudit,
  });
  const notifyChampion = jest.fn((input: FirstPaymentNotifyInput) => real.notifyChampion(input));
  const notifier: FirstPaymentNotifier = { deadlineMs: real.deadlineMs, notifyChampion };
  return { notifier, notifyChampion, sent, identityLookups };
}

const adminLineage = (): LineagePort => ({ findHoldFactsForAccount: async (): Promise<LineageRead> => ({ data: facts('admin_invite'), error: null }) });

describe('P-9.2 T10: an admin Paid invitee\'s first payment tells the issuing admin, exactly once', () => {
  it('a stamped admin_invite first payment reaches the notifier with the lineage source and invite id (never Stripe metadata)', async () => {
    const h = setup({ lineage: adminLineage() });
    const event = paidEvent();
    await applyPaidPlanInvoice(event, h.log, h.deps);
    expect(h.fakeNotifier.notifyChampion).toHaveBeenCalledTimes(1);
    expect(h.notified[0]).toMatchObject({ accountId: ACCOUNT, inviteId: INVITE, lineageSource: 'admin_invite', lineageRead: 'ok', stripeEventId: event.id });
    expect(h.logged('bos_invite_subscribed_not_applicable')).toEqual([]);
  });

  it('a friend payment carries lineageSource account_invite (P-5b.1 unchanged)', async () => {
    const h = setup();
    await applyPaidPlanInvoice(paidEvent(), h.log, h.deps);
    expect(h.notified[0]).toMatchObject({ lineageSource: 'account_invite' });
  });

  it.each([
    ['applied, flag false', [applied({ firstPaymentStamped: false })]],
    ['already_applied', [{ status: 'already_applied', eventRowId: ROW_ID }]],
  ] as Array<[string, BusinessOsApplyPlanPaymentResult[]]>)('%s: an admin invitee\'s payment never reaches the notifier', async (_name, answers) => {
    const h = setup({ answers, lineage: adminLineage() });
    await applyPaidPlanInvoice(paidEvent(), h.log, h.deps);
    expect(h.fakeNotifier.notifyChampion).not.toHaveBeenCalled();
  });

  it('with the real notifier: ONE email to the admin, N-2\'s audit shape with recipientKind admin, flushed after the stamp entries', async () => {
    const real = realAdminNotifier();
    const h = setup({ lineage: adminLineage(), notifier: real.notifier });
    await applyPaidPlanInvoice(paidEvent(), h.log, h.deps);
    expect(real.sent).toHaveLength(1);
    expect(real.sent[0].to).toEqual([ADMIN_EMAIL]);
    expect(real.identityLookups).toEqual([ADMIN]);
    expect(auditCalls).toEqual(['log:BOS_BILLING_INVOICE_PAID', 'log:BOS_BILLING_FIRST_PAYMENT_STAMPED', 'flush', 'log:BOS_INVITE_INVITER_NOTIFIED', 'flush']);
    expect(n2Entries()).toEqual([
      expect.objectContaining({
        entityType: 'business_os_invite',
        entityId: INVITE,
        userId: null,
        actorId: null,
        details: expect.objectContaining({ event: 'subscribed', status: 'subscribed', recipientKind: 'admin', recipientAccountId: ADMIN, accountId: ACCOUNT }),
      }),
    ]);
    expect(JSON.stringify(n2Entries())).not.toContain('@');
    expect(JSON.stringify(h.logLines)).not.toContain('@');
  });

  it('a champion\'s own first payment (admin COHORT invite): no email, no N-2 audit', async () => {
    const real = realAdminNotifier({ grantKind: 'cohort' });
    const h = setup({ lineage: adminLineage(), notifier: real.notifier });
    await applyPaidPlanInvoice(paidEvent(), h.log, h.deps);
    expect(real.notifyChampion).toHaveBeenCalledTimes(1);
    expect(real.sent).toEqual([]);
    expect(n2Entries()).toEqual([]);
  });

  it('through the real handler, the same invoice twice: one admin email', async () => {
    const real = realAdminNotifier();
    const paidInvoices = new Map<string, string>();
    let stamped = false;
    const h = setup({
      lineage: adminLineage(),
      notifier: real.notifier,
      apply: (input) => {
        const known = paidInvoices.get(input.stripeInvoiceId);
        if (known) return { status: 'already_applied', eventRowId: known };
        paidInvoices.set(input.stripeInvoiceId, ROW_ID);
        const stampsNow = input.amountMinor > 0 && !stamped;
        stamped = stamped || stampsNow;
        return applied({ firstPaymentStamped: stampsNow });
      },
    });
    const handler = createPlanBillingHandler({ ...h.deps, stripeMode: () => 'test', now: () => new Date() } as unknown as PlanBillingHandlerDeps);
    await handler(paidEvent('in_ADMIN_TWICE'), h.log);
    await handler(paidEvent('in_ADMIN_TWICE'), h.log);
    expect(real.notifyChampion).toHaveBeenCalledTimes(1);
    expect(real.sent).toHaveLength(1);
    expect(n2Entries().map((entry) => entry.action)).toEqual(['BOS_INVITE_INVITER_NOTIFIED']);
  });

  it('a replay arriving WHILE the admin email is still sending gets already_applied and sends nothing (one email in total)', async () => {
    let releaseSend: (result: SendEmailResult) => void = () => undefined;
    const sendGate = new Promise<SendEmailResult>((resolve) => {
      releaseSend = resolve;
    });
    const real = realAdminNotifier({ send: () => sendGate });
    const paidInvoices = new Map<string, string>();
    const h = setup({
      lineage: adminLineage(),
      notifier: real.notifier,
      apply: (input) => {
        const known = paidInvoices.get(input.stripeInvoiceId);
        if (known) return { status: 'already_applied', eventRowId: known };
        paidInvoices.set(input.stripeInvoiceId, ROW_ID);
        return applied({ firstPaymentStamped: true });
      },
    });
    const handler = createPlanBillingHandler({ ...h.deps, stripeMode: () => 'test', now: () => new Date() } as unknown as PlanBillingHandlerDeps);

    const first = handler(paidEvent('in_ADMIN_MID'), h.log);
    for (let i = 0; i < 200 && real.sent.length === 0; i += 1) await new Promise((resolve) => setImmediate(resolve));
    expect(real.sent).toHaveLength(1);

    await handler(paidEvent('in_ADMIN_MID'), h.log);
    expect(h.logged('bos_billing_invoice_replayed').map((line) => line.ctx.status)).toEqual(['already_applied']);
    expect(real.notifyChampion).toHaveBeenCalledTimes(1);

    releaseSend({ sent: true, provider: 'resend', providerMessageId: 'msg_admin' });
    await first;
    expect(real.sent).toHaveLength(1);
    expect(n2Entries().map((entry) => entry.action)).toEqual(['BOS_INVITE_INVITER_NOTIFIED']);
  });

  it('one 4 s clock: a 1.5 s lineage read leaves 2.5 s for the admin notification', async () => {
    jest.useFakeTimers();
    const h = setup({
      lineage: {
        findHoldFactsForAccount: () =>
          new Promise<LineageRead>((resolve) => {
            setTimeout(() => resolve({ data: facts('admin_invite'), error: null }), 1_500);
          }),
      },
    });
    await runFake(applyPaidPlanInvoice(paidEvent(), h.log, h.deps));
    expect(h.notified[0]).toMatchObject({ lineageSource: 'admin_invite', remainingMs: 2_500 });
  });
});
