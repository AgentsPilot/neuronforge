/**
 * The boost reconcile pass (credits boost slice 4b.2; FR-43; workplan §3.4;
 * SA C-2, C-3, C-4, C-8, C-9; 2b N-2; 4a C-1, C-3).
 *
 * The pass runs against a fake table that follows 20261031's credit and
 * transition rules (the same rules the 4a and 4b.1 suites use), and a fake
 * Stripe whose every read moves a fake clock, so each case is checked on the
 * rows it leaves behind, the audit entries it writes and the counts it reports.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type Stripe from 'stripe';

import { createBoostReconcilePass, runBoostReconcile, BOOST_RECONCILE_COUNT_KEYS, BOOST_RECONCILE_LIMITS, classifyStripeFailure } from '@/lib/business-os/boost/boostReconcilePass';
import type { BoostReconcileDeps } from '@/lib/business-os/boost/boostReconcilePass';
import { createBoostWebhookHandler } from '@/lib/business-os/boost/boostWebhookHandler';
import { createBoostChargeHandler } from '@/lib/business-os/boost/boostChargeHandler';
import { BoostRepositoryFailure, type BusinessOsBoostPurchase } from '@/lib/repositories/BusinessOsBoostPurchaseRepository';
import type { AuditLogInput } from '@/lib/audit/types';
import { findBosCronJob } from '@/lib/cron/bosCronJobs';
import { flattenedCountKey } from '@/lib/business-os/billing/reconcilePassRunner';
import { ACCOUNT, OTHER_ACCOUNT, boostSession } from '@/lib/business-os/boost/__fixtures__/boostWebhookFixtures';

type Row = BusinessOsBoostPurchase;

const NOW = Date.parse('2026-10-09T05:41:00.000Z');
const HOUR = 60 * 60 * 1000;
const LONG_AGO = new Date(NOW - 20 * HOUR).toISOString();
const RECEIPT = 'https://pay.stripe.com/receipts/payment/test_1';

const idOf = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sessionOf = (n: number) => `cs_test_reconcile_${n}`;
const intentOf = (n: number) => `pi_test_reconcile_${n}`;
const chargeOf = (n: number) => `ch_test_reconcile_${n}`;
const lotOf = (n: number) => `77777777-7777-4777-8777-${String(n).padStart(12, '0')}`;
const numberOf = (id: string) => Number(id.slice(-12));

function row(n: number, patch: Partial<Row> = {}): Row {
  return {
    id: idOf(n),
    accountId: n % 2 === 0 ? ACCOUNT : OTHER_ACCOUNT,
    livemode: false,
    status: 'pending',
    packageId: 'plus',
    packageVersion: 1,
    retailVersion: 1,
    creditValueVersion: 1,
    priceMinor: 2500,
    currency: 'USD',
    taxExclusive: true,
    creditsBase: 12500,
    creditsBonus: 1250,
    creditsTotal: 13750,
    // Expired well past the 30 min grace (20 h ago), but inside the 48 h no-session window.
    checkoutExpiresAt: new Date(NOW - 20 * HOUR + n * 1000).toISOString(),
    stripeCheckoutSessionId: sessionOf(n),
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
    statusChangedAt: LONG_AGO,
    createdAt: LONG_AGO,
    updatedAt: LONG_AGO,
    ...patch,
  };
}

/** A paid, credited purchase (as the webhook leaves it). */
function paidRow(n: number, patch: Partial<Row> = {}): Row {
  return row(n, {
    status: 'paid',
    stripePaymentIntentId: intentOf(n),
    amountSubtotalMinor: 2500,
    amountTaxMinor: 0,
    amountTotalMinor: 2500,
    lotId: lotOf(n),
    paidAt: LONG_AGO,
    receiptUrl: RECEIPT,
    ...patch,
  });
}

// ── The fake table (20261031's rules) ───────────────────────────────────────

const PAID_FAMILY = ['paid', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost'];

function fakeTable(rows: Row[]) {
  const table = new Map(rows.map((r) => [r.id, r]));
  const calls: string[] = [];
  const failures = {
    credit: new Map<string, Error>(),
    transition: new Map<string, Error>(),
    reread: new Map<string, Error | 'throw'>(),
    list: null as Error | null,
  };
  const hooks: { beforeCredit?: (id: string) => void; beforeTransition?: (id: string, target: string) => void } = {};
  const reply = <T>(data: T) => ({ data, error: null });
  const failed = (error: Error) => ({ data: null, error });

  const repo = {
    listForReconcile: jest.fn(async (input: { kind: string; livemode: boolean; before: string; limit: number }) => {
      calls.push(`list:${input.kind}`);
      if (failures.list) return failed(failures.list);
      const before = Date.parse(input.before);
      const all = [...table.values()].filter((r) => r.livemode === input.livemode);
      const pick =
        input.kind === 'stuck'
          ? all.filter((r) => ['pending', 'awaiting_payment'].includes(r.status) && Date.parse(r.checkoutExpiresAt) < before).sort((a, b) => a.checkoutExpiresAt.localeCompare(b.checkoutExpiresAt))
          : input.kind === 'receipt_missing'
            ? all.filter((r) => r.status === 'paid' && r.receiptUrl === null && r.paidAt !== null && Date.parse(r.paidAt) < before).sort((a, b) => (a.paidAt ?? '').localeCompare(b.paidAt ?? ''))
            : all.filter((r) => r.status === 'disputed' && Date.parse(r.statusChangedAt) < before).sort((a, b) => a.statusChangedAt.localeCompare(b.statusChangedAt));
      return reply(pick.slice(0, Math.min(input.limit, 50)));
    }),
    reread: jest.fn(async (id: string) => {
      calls.push(`reread:${numberOf(id)}`);
      const failure = failures.reread.get(id);
      if (failure === 'throw') throw new Error('defect');
      if (failure) return failed(failure);
      return reply(table.get(id) ?? null);
    }),
    findBySessionIdForWebhook: jest.fn(async (sessionId: string) => reply([...table.values()].find((r) => r.stripeCheckoutSessionId === sessionId) ?? null)),
    findByIdForWebhook: jest.fn(async (id: string) => reply(table.get(id) ?? null)),
    findByPaymentIntentIdForWebhook: jest.fn(async (pi: string) => reply([...table.values()].find((r) => r.stripePaymentIntentId === pi) ?? null)),
    credit: jest.fn(async (input: { purchaseId: string; sessionId: string; paymentIntentId: string; amountSubtotalMinor: number; amountTaxMinor: number; amountTotalMinor: number }) => {
      calls.push(`credit:${numberOf(input.purchaseId)}`);
      hooks.beforeCredit?.(input.purchaseId);
      const failure = failures.credit.get(input.purchaseId);
      if (failure) return failed(failure);
      const r = table.get(input.purchaseId);
      if (!r) return reply({ outcome: 'not_found' as const });
      if (r.lotId) return reply({ outcome: 'already_credited' as const, accountId: r.accountId, lotId: r.lotId });
      if (!['pending', 'awaiting_payment', 'expired'].includes(r.status)) return reply({ outcome: 'not_creditable' as const, accountId: r.accountId });
      if (r.stripeCheckoutSessionId === null || r.stripeCheckoutSessionId !== input.sessionId) {
        const flagReason = r.stripeCheckoutSessionId === null ? ('no_session' as const) : ('session_mismatch' as const);
        table.set(r.id, { ...r, status: 'flagged_mismatch', flagReason });
        return reply({ outcome: 'mismatch' as const, accountId: r.accountId, flagReason });
      }
      const lotId = lotOf(numberOf(r.id));
      table.set(r.id, {
        ...r,
        status: 'paid',
        lotId,
        stripePaymentIntentId: input.paymentIntentId,
        amountSubtotalMinor: input.amountSubtotalMinor,
        amountTaxMinor: input.amountTaxMinor,
        amountTotalMinor: input.amountTotalMinor,
        paidAt: new Date(NOW).toISOString(),
      });
      return reply({ outcome: 'credited' as const, accountId: r.accountId, lotId });
    }),
    transition: jest.fn(async (input: { purchaseId: string; toStatus: string; paymentIntentId?: string | null; amountRefundedMinor?: number | null; disputeId?: string | null; flagReason?: string | null }) => {
      calls.push(`transition:${numberOf(input.purchaseId)}:${input.toStatus}`);
      hooks.beforeTransition?.(input.purchaseId, input.toStatus);
      const failure = failures.transition.get(input.purchaseId);
      if (failure) return failed(failure);
      const r = table.get(input.purchaseId);
      if (!r) return reply({ status: 'not_found' as const, accountId: null, fromStatus: null });
      const from = r.status;
      const done = (status: string, patch: Partial<Row> = {}) => {
        table.set(r.id, { ...r, ...patch });
        return reply({ status: status as never, accountId: r.accountId, fromStatus: from });
      };
      const stuckTable: Record<string, string[]> = {
        awaiting_payment: ['pending'],
        failed: ['pending', 'awaiting_payment'],
        expired: ['pending', 'awaiting_payment'],
        flagged_mismatch: ['pending', 'awaiting_payment'],
      };
      if (input.toStatus in stuckTable) {
        if (from === input.toStatus) return done('already');
        if (!stuckTable[input.toStatus].includes(from)) return done('not_allowed');
        return done('transitioned', {
          status: input.toStatus as Row['status'],
          stripePaymentIntentId: input.paymentIntentId ?? r.stripePaymentIntentId,
          flagReason: input.toStatus === 'flagged_mismatch' ? (input.flagReason ?? null) : r.flagReason,
        });
      }
      const refunded = r.amountRefundedMinor;
      const total = r.amountTotalMinor;
      if (input.toStatus === 'partially_refunded' || input.toStatus === 'refunded') {
        const amount = input.amountRefundedMinor ?? 0;
        if (!['paid', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost', 'flagged_mismatch'].includes(from)) return done('not_allowed');
        if (amount < refunded) return done('stale');
        if (total !== null && amount > total) return done('not_allowed');
        if (['disputed', 'dispute_lost', 'flagged_mismatch'].includes(from)) return amount === refunded ? done('already') : done('recorded', { amountRefundedMinor: amount });
        const target = amount === total ? 'refunded' : amount > 0 ? 'partially_refunded' : null;
        if (target === null || target !== input.toStatus) return done('not_allowed');
        if (from === target && amount === refunded) return done('already');
        if (from === 'refunded') return done('not_allowed');
        return done('transitioned', { status: target as Row['status'], amountRefundedMinor: amount });
      }
      if (input.toStatus === 'disputed') {
        if (from === 'disputed' && r.stripeDisputeId === input.disputeId) return done('already');
        if (!['paid', 'partially_refunded', 'refunded'].includes(from)) return done('not_allowed');
        return done('transitioned', { status: 'disputed', stripeDisputeId: input.disputeId ?? null, statusChangedAt: new Date(NOW).toISOString() });
      }
      if (r.stripeDisputeId !== (input.disputeId ?? null)) return done('not_allowed');
      if (input.toStatus === 'dispute_lost') {
        if (from === 'dispute_lost') return done('already');
        if (from !== 'disputed') return done('not_allowed');
        return done('transitioned', { status: 'dispute_lost' });
      }
      const back = refunded === 0 ? 'paid' : total !== null && refunded >= total ? 'refunded' : 'partially_refunded';
      if (from === back) return done('already');
      if (from !== 'disputed') return done('not_allowed');
      return done('transitioned', { status: back as Row['status'] });
    }),
    recordReceipt: jest.fn(async (input: { purchaseId: string; chargeId: string; receiptUrl: string }) => {
      calls.push(`receipt:${numberOf(input.purchaseId)}`);
      const r = table.get(input.purchaseId);
      if (!r) return reply({ status: 'not_found' as const, accountId: null });
      if (!PAID_FAMILY.includes(r.status)) return reply({ status: 'not_paid' as const, accountId: r.accountId });
      if (r.receiptUrl !== null) return reply({ status: 'already_recorded' as const, accountId: r.accountId });
      table.set(r.id, { ...r, receiptUrl: input.receiptUrl, stripeChargeId: input.chargeId });
      return reply({ status: 'recorded' as const, accountId: r.accountId });
    }),
  };
  return { table, repo, calls, failures, hooks };
}

// ── The fake Stripe (every read moves the clock) ────────────────────────────

function stripeError(type: string, statusCode: number, code: string | null = null) {
  // The message echoes a customer value on purpose: it must never reach a log.
  return Object.assign(new Error('No such checkout session for owner@example.com'), { type, statusCode, code, requestId: 'req_1' });
}

function fakeStripe(clock: { now: number }) {
  const sessions = new Map<string, unknown>();
  const disputes = new Map<string, unknown>();
  const disputeLists = new Map<string, unknown>();
  const calls: string[] = [];
  const cost: { ms: number; per?: (call: string) => number } = { ms: 100 };
  const answer = (value: unknown, missing: () => Error) => {
    clock.now += cost.per ? cost.per(calls[calls.length - 1]) : cost.ms;
    if (value instanceof Error) throw value;
    if (value === undefined) throw missing();
    return value;
  };
  const port = {
    checkout: {
      sessions: {
        retrieve: jest.fn(async (id: string, params: { expand: string[] }, options: { timeout: number; maxNetworkRetries: number }) => {
          calls.push(`session:${id}`);
          expect(params).toEqual({ expand: ['payment_intent.latest_charge'] });
          expect(options).toEqual({ timeout: 5000, maxNetworkRetries: 0 });
          return answer(sessions.get(id), () => stripeError('StripeInvalidRequestError', 404, 'resource_missing'));
        }),
      },
    },
    disputes: {
      retrieve: jest.fn(async (id: string, _params: unknown, options: { timeout: number; maxNetworkRetries: number }) => {
        calls.push(`dispute:${id}`);
        expect(options).toEqual({ timeout: 5000, maxNetworkRetries: 0 });
        return answer(disputes.get(id), () => stripeError('StripeInvalidRequestError', 404, 'resource_missing'));
      }),
      list: jest.fn(async (params: { payment_intent: string; limit: number }, options: { timeout: number; maxNetworkRetries: number }) => {
        calls.push(`disputes:${params.payment_intent}`);
        expect(options).toEqual({ timeout: 5000, maxNetworkRetries: 0 });
        return answer(disputeLists.get(params.payment_intent) ?? { object: 'list', data: [] }, () => new Error('unreachable'));
      }),
    },
  };
  return { port, sessions, disputes, disputeLists, calls, cost };
}

function charge(n: number, patch: Record<string, unknown> = {}) {
  return { id: chargeOf(n), object: 'charge', amount_refunded: 0, currency: 'usd', refunded: false, disputed: false, receipt_url: RECEIPT, ...patch };
}

/** A Checkout Session as `retrieve(…, { expand: ['payment_intent.latest_charge'] })` returns it. */
function session(n: number, patch: Record<string, unknown> = {}, intent: Record<string, unknown> | null = {}) {
  return boostSession({
    id: sessionOf(n),
    client_reference_id: idOf(n),
    expires_at: Math.floor((NOW - 20 * HOUR) / 1000),
    payment_intent: intent === null ? null : { id: intentOf(n), object: 'payment_intent', status: 'succeeded', latest_charge: charge(n), ...intent },
    ...patch,
  });
}

function dispute(n: number, status: string, patch: Record<string, unknown> = {}) {
  return { id: `dp_test_reconcile_${n}`, object: 'dispute', status, currency: 'usd', payment_intent: intentOf(n), ...patch };
}

function harness(rows: Row[], options: { keyLivemode?: boolean | null; stripe?: 'none'; auditLookup?: 'fails' } = {}) {
  const clock = { now: NOW };
  const db = fakeTable(rows);
  const stripe = fakeStripe(clock);
  const audits: AuditLogInput[] = [];
  const logs: Array<{ level: string; obj: Record<string, unknown>; msg: string }> = [];
  const at = (level: string) => (obj: Record<string, unknown>, msg: string) => logs.push({ level, obj, msg });
  const log = { info: at('info'), warn: at('warn'), error: at('error') };
  const receipt = jest.fn(async () => 'recorded' as const);
  const deps: BoostReconcileDeps = {
    purchases: db.repo as never,
    stripe: () => (options.stripe === 'none' ? null : (stripe.port as never)),
    keyLivemode: () => (options.keyLivemode === undefined ? false : options.keyLivemode),
    audit: async (entry) => void audits.push(entry),
    receipt: receipt as never,
    clock: () => clock.now,
    // As the audit trail answers it: an earlier FLAGGED with this reason on this purchase and account.
    findingRecorded: jest.fn(async (input: { accountId: string; purchaseId: string; reason: string }) =>
      options.auditLookup === 'fails'
        ? null
        : audits.some(
            (a) => a.action === 'BOS_BOOST_FLAGGED' && a.entityId === input.purchaseId && a.userId === input.accountId && a.details?.reason === input.reason
          )
    ),
  };
  const context = () => ({ deadlineAt: NOW + 45 * 1000, now: new Date(NOW), log, trigger: 'nightly' as const });
  const run = () => runBoostReconcile(deps, context());
  const status = (n: number) => db.table.get(idOf(n))?.status;
  const alerts = () => logs.filter((l) => l.obj.alert === true).map((l) => l.msg.split(':')[0]);
  const actions = () => audits.map((a) => (a.details?.reason ? `${a.action}:${a.details.reason}` : a.action));
  return { db, stripe, clock, audits, logs, log, receipt, deps, run, status, alerts, actions, context };
}

// ── 1. Stuck purchases ──────────────────────────────────────────────────────

describe('stuck purchases: Stripe decides', () => {
  it('a paid session credits the purchase, audits CREDITED on the row account, and fills the receipt from the charge in hand', async () => {
    const h = harness([row(2)]);
    h.stripe.sessions.set(sessionOf(2), session(2));
    const counts = await h.run();
    expect(h.status(2)).toBe('paid');
    expect(h.db.table.get(idOf(2))?.receiptUrl).toBe(RECEIPT);
    expect(counts).toMatchObject({ examined: 1, credited: 1, receiptsFilled: 1, flagged: 0, deferred: 0 });
    expect(h.actions()).toEqual(['BOS_BOOST_CREDITED']);
    expect(h.audits[0]).toMatchObject({ entityType: 'business_os_boost_purchase', entityId: idOf(2), userId: ACCOUNT });
    expect(h.audits[0].details).toMatchObject({ source: 'reconcile', lot_id: lotOf(2), stripe_payment_intent_id: intentOf(2) });
    expect(h.alerts()).toEqual([]);
    // One Stripe read: the receipt came from the expanded charge.
    expect(h.stripe.calls).toEqual([`session:${sessionOf(2)}`]);
    expect(h.receipt).not.toHaveBeenCalled();
  });

  it('the account is always the row\'s: another account\'s purchase is audited against that account', async () => {
    const h = harness([row(3)]);
    h.stripe.sessions.set(sessionOf(3), session(3));
    await h.run();
    expect(h.audits.map((a) => a.userId)).toEqual([OTHER_ACCOUNT]);
  });

  it.each([
    ['an expired session', { status: 'expired', payment_status: 'unpaid' }, null],
    ['an open session past its expiry', { status: 'open', payment_status: 'unpaid' }, null],
  ])('%s → expired, no alert, no audit', async (_name, patch, intent) => {
    const h = harness([row(2)]);
    h.stripe.sessions.set(sessionOf(2), session(2, patch, intent));
    const counts = await h.run();
    expect(h.status(2)).toBe('expired');
    expect(counts).toMatchObject({ examined: 1, expired: 1 });
    expect(h.audits).toEqual([]);
    expect(h.alerts()).toEqual([]);
  });

  it('an open session not yet expired is left (still open)', async () => {
    const h = harness([row(2)]);
    h.stripe.sessions.set(sessionOf(2), session(2, { status: 'open', payment_status: 'unpaid', expires_at: Math.floor((NOW + HOUR) / 1000) }, null));
    const counts = await h.run();
    expect(h.status(2)).toBe('pending');
    expect(counts).toMatchObject({ stillOpen: 1 });
    expect(h.db.repo.transition).not.toHaveBeenCalled();
  });

  it.each(['requires_payment_method', 'canceled'])('a delayed payment whose intent is %s → failed, with PAYMENT_FAILED on the row', async (intentStatus) => {
    const h = harness([row(2, { status: 'awaiting_payment', stripePaymentIntentId: intentOf(2) })]);
    h.stripe.sessions.set(sessionOf(2), session(2, { status: 'complete', payment_status: 'unpaid' }, { status: intentStatus, latest_charge: null }));
    const counts = await h.run();
    expect(h.status(2)).toBe('failed');
    expect(counts).toMatchObject({ failed: 1 });
    expect(h.actions()).toEqual(['BOS_BOOST_PAYMENT_FAILED']);
  });

  it('a delayed payment still processing is left alone and counted', async () => {
    const h = harness([row(2, { status: 'awaiting_payment', stripePaymentIntentId: intentOf(2) })]);
    h.stripe.sessions.set(sessionOf(2), session(2, { status: 'complete', payment_status: 'unpaid' }, { status: 'processing', latest_charge: null }));
    const counts = await h.run();
    expect(h.status(2)).toBe('awaiting_payment');
    expect(counts).toMatchObject({ stillProcessing: 1 });
    expect(h.db.repo.transition).not.toHaveBeenCalled();
    expect(h.db.repo.credit).not.toHaveBeenCalled();
  });

  it.each([
    ['a session Stripe does not know (404)', () => undefined, 'reconcile_session_missing'],
    ['an unreadable session', () => ({ id: sessionOf(2), mode: 'subscription' }), 'reconcile_session_unreadable'],
    ['a live session for a test row', () => session(2, { livemode: true }), 'livemode_mismatch'],
    ['another product\'s marker', () => session(2, { metadata: { product: 'business_os_plan' } }), 'metadata_mismatch'],
    ['a free session (no payment required)', () => session(2, { payment_status: 'no_payment_required' }), 'no_payment_required'],
  ])('%s → a finding: the stuck row is flagged once (SA CR-1), alert + one FLAGGED, no credit', async (_name, make, reason) => {
    const h = harness([row(2)]);
    const value = make();
    if (value !== undefined) h.stripe.sessions.set(sessionOf(2), value);
    const counts = await h.run();
    expect(h.status(2)).toBe('flagged_mismatch');
    expect(h.db.table.get(idOf(2))?.flagReason).toBe(reason);
    expect(counts).toMatchObject({ flagged: 1, credited: 0 });
    expect(h.actions()).toEqual([`BOS_BOOST_FLAGGED:${reason}`]);
    expect(h.audits[0].details).toMatchObject({ flag_applied: true, source: 'reconcile' });
    expect(h.alerts()).toEqual(['bos_boost_reconcile_finding']);
    expect(h.db.repo.credit).not.toHaveBeenCalled();
    expect(h.db.repo.transition.mock.calls.map(([input]) => [input.toStatus, input.flagReason])).toEqual([['flagged_mismatch', reason]]);
  });

  it.each([
    ['404', () => undefined, 'reconcile_session_missing'],
    ['400', () => stripeError('StripeInvalidRequestError', 400, 'parameter_invalid'), 'reconcile_session_refused'],
    ['unreadable', () => ({ id: sessionOf(2), mode: 'subscription' }), 'reconcile_session_unreadable'],
    ['livemode', () => session(2, { livemode: true }), 'livemode_mismatch'],
    ['marker', () => session(2, { metadata: { product: 'business_os_plan' } }), 'metadata_mismatch'],
    ['free', () => session(2, { payment_status: 'no_payment_required' }), 'no_payment_required'],
  ])('QA R-1 (CR-1), stuck %s: two runs → exactly one FLAGGED, and run 2 no longer reads the row', async (_name, make, reason) => {
    const h = harness([row(2)]);
    const value = make();
    if (value !== undefined) h.stripe.sessions.set(sessionOf(2), value);
    await h.run();
    const second = await h.run();
    expect(h.actions()).toEqual([`BOS_BOOST_FLAGGED:${reason}`]);
    expect(second).toMatchObject({ examined: 0, flagged: 0 });
    expect(h.stripe.calls).toEqual([`session:${sessionOf(2)}`]);
  });

  it('CR-1: a stuck row that moved before the flag (the webhook won) falls back to "audit once"', async () => {
    const h = harness([row(2)]);
    h.stripe.sessions.set(sessionOf(2), session(2, { livemode: true }));
    h.db.hooks.beforeTransition = (id, target) => {
      if (target === 'flagged_mismatch') h.db.table.set(id, { ...h.db.table.get(id)!, status: 'failed' });
    };
    await h.run();
    expect(h.status(2)).toBe('failed');
    expect(h.actions()).toEqual(['BOS_BOOST_FLAGGED:livemode_mismatch']);
    expect(h.logs.some((l) => l.msg === 'bos_boost_reconcile_flag_not_applied')).toBe(true);
  });

  it('a credit the SQL flags (an amount that disagrees) is a finding with the SQL reason', async () => {
    const h = harness([row(2)]);
    h.db.repo.credit.mockImplementationOnce(async () => ({ data: { outcome: 'mismatch', accountId: ACCOUNT, flagReason: 'amount_mismatch' }, error: null }) as never);
    h.stripe.sessions.set(sessionOf(2), session(2));
    const counts = await h.run();
    expect(counts.flagged).toBe(1);
    expect(h.actions()).toEqual(['BOS_BOOST_FLAGGED:amount_mismatch']);
  });

  it('other-mode rows are never read: the list asks for the key mode only', async () => {
    const h = harness([row(2, { livemode: true }), row(4)]);
    h.stripe.sessions.set(sessionOf(4), session(4));
    await h.run();
    expect(h.db.repo.listForReconcile.mock.calls.map(([input]) => input.livemode)).toEqual([false, false, false]);
    expect(h.stripe.calls).toEqual([`session:${sessionOf(4)}`]);
    expect(h.status(2)).toBe('pending');
  });

  it('the cut-offs: stuck 30 min after expiry, disputed 30 min after the move, receipts 10 min after payment', async () => {
    const h = harness([]);
    await h.run();
    const cutoffs = Object.fromEntries(h.db.repo.listForReconcile.mock.calls.map(([input]) => [input.kind, NOW - Date.parse(input.before)]));
    expect(cutoffs).toEqual({ stuck: 30 * 60 * 1000, disputed: 30 * 60 * 1000, receipt_missing: 10 * 60 * 1000 });
    expect(h.db.repo.listForReconcile.mock.calls.every(([input]) => input.limit === 50)).toBe(true);
  });
});

// ── C-3: a purchase with no session ─────────────────────────────────────────

describe('SA C-3: a purchase with no session is never credited', () => {
  it('past expiry + 48 h → expired (warn), with no Stripe read and no credit', async () => {
    const h = harness([row(2, { stripeCheckoutSessionId: null, checkoutExpiresAt: new Date(NOW - 49 * HOUR).toISOString() })]);
    const counts = await h.run();
    expect(h.status(2)).toBe('expired');
    expect(counts).toMatchObject({ examined: 1, expired: 1 });
    expect(h.stripe.calls).toEqual([]);
    expect(h.db.repo.credit).not.toHaveBeenCalled();
    expect(h.logs.some((l) => l.level === 'warn' && l.msg === 'bos_boost_reconcile_no_session_expired')).toBe(true);
  });

  it('within 48 h it is left (it still holds its cap reservation)', async () => {
    const h = harness([row(2, { stripeCheckoutSessionId: null, checkoutExpiresAt: new Date(NOW - 47 * HOUR).toISOString() })]);
    const counts = await h.run();
    expect(h.status(2)).toBe('pending');
    expect(counts).toMatchObject({ stillOpen: 1 });
    expect(h.db.repo.transition).not.toHaveBeenCalled();
  });

  it('an expired no-session purchase + a late paid session event → mismatch no_session, alerted, no lot', async () => {
    const h = harness([row(2, { stripeCheckoutSessionId: null, checkoutExpiresAt: new Date(NOW - 49 * HOUR).toISOString() })]);
    await h.run();
    expect(h.status(2)).toBe('expired');

    const handler = createBoostWebhookHandler({ purchases: h.db.repo as never, audit: async (entry) => void h.audits.push(entry), receipt: async () => 'recorded' });
    const event = {
      id: 'evt_late',
      type: 'checkout.session.completed',
      livemode: false,
      data: { object: session(2, { id: 'cs_test_late_orphan', client_reference_id: idOf(2) }, null) },
    } as unknown as Stripe.Event;
    (event.data.object as unknown as Record<string, unknown>).payment_intent = intentOf(2);
    await handler(event, h.log);

    const after = h.db.table.get(idOf(2));
    expect(after?.status).toBe('flagged_mismatch');
    expect(after?.flagReason).toBe('no_session');
    expect(after?.lotId).toBeNull();
    expect(h.actions()).toContain('BOS_BOOST_FLAGGED:no_session');
    expect(h.alerts()).toContain('bos_boost_mismatch');
  });
});

// ── C-2: racing the webhook ─────────────────────────────────────────────────

describe('SA C-2: a pass racing the webhook', () => {
  it('credited by the webhook between the batch read and the credit → raced: info, no alert, no audit, one lot', async () => {
    const h = harness([row(2)]);
    h.stripe.sessions.set(sessionOf(2), session(2));
    h.db.hooks.beforeCredit = (id) => {
      const r = h.db.table.get(id)!;
      h.db.table.set(id, { ...r, status: 'paid', lotId: lotOf(2), stripePaymentIntentId: intentOf(2), amountTotalMinor: 2500, receiptUrl: RECEIPT });
    };
    const counts = await h.run();
    expect(counts).toMatchObject({ raced: 1, credited: 0, flagged: 0 });
    expect(h.audits).toEqual([]);
    expect(h.alerts()).toEqual([]);
    expect(h.logs.some((l) => l.level === 'info' && l.msg === 'bos_boost_reconcile_raced')).toBe(true);
  });

  it('expired in Stripe but credited by the webhook meanwhile → the expire is refused, the re-read shows paid → raced', async () => {
    const h = harness([row(2)]);
    h.stripe.sessions.set(sessionOf(2), session(2, { status: 'expired', payment_status: 'unpaid' }, null));
    h.db.hooks.beforeTransition = (id) => {
      const r = h.db.table.get(id)!;
      h.db.table.set(id, { ...r, status: 'paid', lotId: lotOf(2) });
    };
    const counts = await h.run();
    expect(counts).toMatchObject({ raced: 1, expired: 0, flagged: 0 });
    expect(h.db.calls).toContain('reread:2');
    expect(h.audits).toEqual([]);
    expect(h.alerts()).toEqual([]);
  });

  it('a genuine disagreement after the re-read is a finding: Stripe paid, the row failed meanwhile', async () => {
    const h = harness([row(2, { status: 'awaiting_payment' })]);
    h.stripe.sessions.set(sessionOf(2), session(2));
    h.db.hooks.beforeCredit = (id) => {
      const r = h.db.table.get(id)!;
      h.db.table.set(id, { ...r, status: 'failed' });
    };
    const counts = await h.run();
    expect(counts).toMatchObject({ flagged: 1, raced: 0 });
    expect(h.actions()).toEqual(['BOS_BOOST_FLAGGED:paid_not_creditable']);
    expect(h.alerts()).toEqual(['bos_boost_reconcile_finding']);
  });

  it('two overlapping runs (the cron and the admin trigger) converge: one credit, one CREDITED audit, one raced', async () => {
    const h = harness([row(2)]);
    h.stripe.sessions.set(sessionOf(2), session(2));
    const [first, second] = await Promise.all([h.run(), h.run()]);
    expect(first.credited + second.credited).toBe(1);
    expect(first.raced + second.raced).toBe(1);
    expect(h.actions().filter((a) => a === 'BOS_BOOST_CREDITED')).toHaveLength(1);
    expect(h.status(2)).toBe('paid');
  });
});

// ── Idempotency ─────────────────────────────────────────────────────────────

describe('idempotency: run twice', () => {
  it('a second run finds nothing left and changes nothing: same rows, same audits', async () => {
    const rows = [row(2), row(4), row(6, { stripeCheckoutSessionId: null, checkoutExpiresAt: new Date(NOW - 49 * HOUR).toISOString() }), paidRow(8, { receiptUrl: null })];
    const h = harness(rows);
    h.stripe.sessions.set(sessionOf(2), session(2));
    h.stripe.sessions.set(sessionOf(4), session(4, { status: 'expired', payment_status: 'unpaid' }, null));
    await h.run();
    const afterFirst = JSON.stringify([...h.db.table.values()]);
    const auditsAfterFirst = h.actions();

    const second = await h.run();
    expect(JSON.stringify([...h.db.table.values()])).toBe(afterFirst);
    expect(h.actions()).toEqual(auditsAfterFirst);
    expect(second).toMatchObject({ examined: 0, credited: 0, expired: 0, flagged: 0 });
  });
});

// ── C-4 and the batch bound ─────────────────────────────────────────────────

describe('SA C-4: the deadline, and the batch bound', () => {
  it('no row is started with less than 15 s left (SA CR-3); the counts report the deadline and the rows left', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => row(100 + i));
    const h = harness(rows);
    for (const r of rows) h.stripe.sessions.set(r.stripeCheckoutSessionId!, session(numberOf(r.id), { status: 'expired', payment_status: 'unpaid' }, null));
    h.stripe.cost.ms = 4000;
    const counts = await h.run();
    // 45 s budget, 15 s margin: rows start at 0, 4, … 28 s → 8 rows; the 9th would start at 32 s (13 s left).
    expect(counts.examined).toBe(8);
    expect(counts.deadlineHit).toBe(1);
    expect(counts.rowsLeft).toBe(12);
    expect(h.stripe.calls).toHaveLength(8);
    // The later reads are not even started.
    expect(h.db.calls.filter((c) => c.startsWith('list:'))).toEqual(['list:stuck']);
  });

  it.each([
    // 8 one-read rows at 4.25 s → the two-read row would start at 34 s with 11 s left: not started.
    [8, false],
    // 7 one-read rows → it starts at 29.75 s with 15.25 s left, and still ends before the deadline.
    [7, true],
  ])('QA R-3 (CR-3): a row making two Stripe reads at their 6 s bound never runs past the deadline (%i rows before it)', async (before, started) => {
    const quick = Array.from({ length: before }, (_, i) => row(300 + i));
    const heavy = row(399);
    const h = harness([...quick, heavy]);
    for (const r of quick) h.stripe.sessions.set(r.stripeCheckoutSessionId!, session(numberOf(r.id), { status: 'expired', payment_status: 'unpaid' }, null));
    h.stripe.sessions.set(sessionOf(399), session(399, {}, { latest_charge: charge(399, { disputed: true }) }));
    h.stripe.disputeLists.set(intentOf(399), { object: 'list', data: [dispute(399, 'needs_response')] });
    h.stripe.cost.per = (call) => (call.startsWith(`session:${sessionOf(399)}`) || call.startsWith('disputes:') ? 6000 : 4250);
    const counts = await h.run();
    expect(h.clock.now - NOW).toBeLessThanOrEqual(45 * 1000);
    expect(h.stripe.calls.includes(`disputes:${intentOf(399)}`)).toBe(started);
    expect(counts.examined).toBe(before + (started ? 1 : 0));
    if (!started) expect(counts).toMatchObject({ deadlineHit: 1, rowsLeft: 1 });
  });

  it('at most 50 rows per read, oldest first; a full batch is reported', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => row(200 + i));
    const h = harness(rows);
    for (const r of rows) h.stripe.sessions.set(r.stripeCheckoutSessionId!, session(numberOf(r.id), { status: 'open', payment_status: 'unpaid', expires_at: Math.floor((NOW + HOUR) / 1000) }, null));
    h.stripe.cost.ms = 1;
    const counts = await h.run();
    expect(counts.examined).toBe(50);
    expect(counts.batchFull).toBe(1);
    expect(h.stripe.calls[0]).toBe(`session:${sessionOf(200)}`);
    expect(h.stripe.calls).not.toContain(`session:${sessionOf(259)}`);
  });
});

// ── Per-row isolation ───────────────────────────────────────────────────────

describe('per-row isolation: one bad row never stops the batch', () => {
  it('transient → deferred; deterministic → a finding; a defect → deferred with an alert; the other rows are processed', async () => {
    const rows = [row(10), row(12), row(14), row(16), row(18), row(20)];
    const h = harness(rows);
    for (const r of rows) h.stripe.sessions.set(r.stripeCheckoutSessionId!, session(numberOf(r.id)));
    h.stripe.sessions.set(sessionOf(10), stripeError('StripeAPIError', 500));
    h.stripe.sessions.set(sessionOf(12), stripeError('StripeConnectionError', 0));
    h.db.failures.credit.set(idOf(14), new BoostRepositoryFailure('check violated', '23514', true));
    h.db.failures.credit.set(idOf(16), new BoostRepositoryFailure('could not serialize', '40001', false));
    h.db.failures.reread.set(idOf(18), 'throw');
    const counts = await h.run();

    expect(h.status(10)).toBe('pending');
    expect(h.status(12)).toBe('pending');
    expect(h.status(14)).toBe('pending');
    expect(h.status(16)).toBe('pending');
    // 18 was credited before the follow-up re-read threw; 20 is untouched by the others.
    expect(h.status(18)).toBe('paid');
    expect(h.status(20)).toBe('paid');
    expect(counts).toMatchObject({ examined: 6, credited: 2, deferred: 4, flagged: 1 });
    expect(h.actions()).toEqual(['BOS_BOOST_FLAGGED:deterministic_failure', 'BOS_BOOST_CREDITED', 'BOS_BOOST_CREDITED']);
    expect(h.alerts()).toContain('bos_boost_reconcile_row_failed');
  });

  it('XX000 is deferred AND alerted (4a C-1)', async () => {
    const h = harness([row(2)]);
    h.stripe.sessions.set(sessionOf(2), session(2));
    h.db.failures.credit.set(idOf(2), new BoostRepositoryFailure('no lot back', 'XX000', false));
    const counts = await h.run();
    expect(counts.deferred).toBe(1);
    expect(h.alerts()).toEqual(['bos_boost_reconcile_internal_error']);
  });

  it('a Stripe key refusal stops the pass: no other row is read, the rest are reported as left', async () => {
    const h = harness([row(2), row(4), row(6)]);
    h.stripe.sessions.set(sessionOf(2), stripeError('StripeAuthenticationError', 401));
    const counts = await h.run();
    expect(counts).toMatchObject({ stripeUnavailable: 1, rowsLeft: 3, examined: 1 });
    expect(h.stripe.calls).toEqual([`session:${sessionOf(2)}`]);
    expect(h.alerts()).toEqual(['bos_boost_reconcile_unavailable']);
  });

  it('no Stripe client → stopped before any read; no key mode → nothing is even listed', async () => {
    const noClient = harness([row(2)], { stripe: 'none' });
    expect(await noClient.run()).toMatchObject({ stripeUnavailable: 1, rowsLeft: 1 });

    const noMode = harness([row(2)], { keyLivemode: null });
    expect(await noMode.run()).toMatchObject({ stripeUnavailable: 1, examined: 0 });
    expect(noMode.db.repo.listForReconcile).not.toHaveBeenCalled();
  });

  it('a list that fails is counted and the next read still runs', async () => {
    const h = harness([]);
    h.db.failures.list = new BoostRepositoryFailure('timeout', '57014', false);
    const counts = await h.run();
    expect(counts.listFailed).toBe(3);
    expect(h.alerts()).toEqual(['bos_boost_reconcile_list_failed', 'bos_boost_reconcile_list_failed', 'bos_boost_reconcile_list_failed']);
  });

  it('no log line carries a Stripe error message (it can echo customer values)', async () => {
    const h = harness([row(2)]);
    h.stripe.sessions.set(sessionOf(2), stripeError('StripeAPIError', 500));
    await h.run();
    expect(JSON.stringify(h.logs)).not.toContain('owner@example.com');
  });

  it.each([
    [{ type: 'StripeAuthenticationError' }, 'key'],
    [{ type: 'StripePermissionError' }, 'key'],
    [{ type: 'StripeInvalidRequestError', statusCode: 404 }, 'missing'],
    [{ type: 'StripeInvalidRequestError', code: 'resource_missing', statusCode: 400 }, 'missing'],
    [{ type: 'StripeInvalidRequestError', statusCode: 400 }, 'invalid'],
    [{ type: 'StripeRateLimitError', statusCode: 429 }, 'transient'],
    [{ type: 'StripeAPIError', statusCode: 500 }, 'transient'],
    [new Error('socket hang up'), 'transient'],
  ])('classifyStripeFailure(%p) → %s', (error, kind) => {
    expect(classifyStripeFailure(error)).toBe(kind);
  });
});

// ── Late reversals (N-2, C-8) ───────────────────────────────────────────────

describe('late reversals: what the charge already carries is applied after crediting (2b N-2)', () => {
  it('a partial refund before crediting → credited, then partially_refunded with the cumulative amount, alerted, REVERSED audit', async () => {
    const h = harness([row(2)]);
    h.stripe.sessions.set(sessionOf(2), session(2, {}, { latest_charge: charge(2, { amount_refunded: 1000 }) }));
    const counts = await h.run();
    expect(h.status(2)).toBe('partially_refunded');
    expect(h.db.table.get(idOf(2))?.amountRefundedMinor).toBe(1000);
    expect(h.db.table.get(idOf(2))?.lotId).toBe(lotOf(2));
    expect(counts).toMatchObject({ credited: 1, reversalsApplied: 1 });
    expect(h.actions()).toEqual(['BOS_BOOST_CREDITED', 'BOS_BOOST_PAYMENT_REVERSED']);
    expect(h.audits[1].details).toMatchObject({ kind: 'refund', phase: 'reconcile', to_status: 'partially_refunded', amount_refunded_minor: 1000 });
    expect(h.alerts()).toEqual(['bos_boost_payment_reversed']);
  });

  it('a full refund → refunded', async () => {
    const h = harness([row(2)]);
    h.stripe.sessions.set(sessionOf(2), session(2, {}, { latest_charge: charge(2, { amount_refunded: 2500, refunded: true }) }));
    await h.run();
    expect(h.status(2)).toBe('refunded');
  });

  it.each([
    ['needs_response', 'disputed', 0, 1],
    ['won', 'paid', 1, 0],
    ['lost', 'dispute_lost', 1, 0],
  ])('C-8: a dispute (%s) found by the payment intent → %s', async (disputeStatus, finalStatus, concluded, stillOpen) => {
    const h = harness([row(2)]);
    h.stripe.sessions.set(sessionOf(2), session(2, {}, { latest_charge: charge(2, { disputed: true }) }));
    h.stripe.disputeLists.set(intentOf(2), { object: 'list', data: [dispute(2, disputeStatus)] });
    const counts = await h.run();
    expect(h.status(2)).toBe(finalStatus);
    expect(h.db.table.get(idOf(2))?.stripeDisputeId).toBe('dp_test_reconcile_2');
    expect(counts).toMatchObject({ disputesConcluded: concluded, disputesStillOpen: stillOpen });
    expect(h.stripe.calls).toEqual([`session:${sessionOf(2)}`, `disputes:${intentOf(2)}`]);
  });

  it('C-8: a charge showing disputed with no readable dispute is a finding, not a guess', async () => {
    const h = harness([row(2)]);
    h.stripe.sessions.set(sessionOf(2), session(2, {}, { latest_charge: charge(2, { disputed: true }) }));
    const counts = await h.run();
    expect(h.status(2)).toBe('paid');
    expect(counts.flagged).toBe(1);
    expect(h.actions()).toEqual(['BOS_BOOST_CREDITED', 'BOS_BOOST_FLAGGED:dispute_id_unreadable']);
  });

  it('a refund in another currency is a finding (SA C-1 compares case-insensitively)', async () => {
    const h = harness([row(2)]);
    h.stripe.sessions.set(sessionOf(2), session(2, {}, { latest_charge: charge(2, { currency: 'eur', amount_refunded: 1000 }) }));
    await h.run();
    expect(h.status(2)).toBe('paid');
    expect(h.actions()).toEqual(['BOS_BOOST_CREDITED', 'BOS_BOOST_FLAGGED:currency_mismatch']);
  });

  it('an unexpanded charge is not a finding: the credit stands, the receipt is left to the backfill', async () => {
    const h = harness([row(2)]);
    h.stripe.sessions.set(sessionOf(2), session(2, {}, { latest_charge: chargeOf(2) }));
    const counts = await h.run();
    expect(h.status(2)).toBe('paid');
    expect(counts).toMatchObject({ credited: 1, flagged: 0, receiptsFilled: 0 });
  });
});

// ── C-9: disputes still open ────────────────────────────────────────────────

describe('SA C-9: disputed purchases are re-read by the stored dispute id', () => {
  const disputed = (n: number, patch: Partial<Row> = {}) => paidRow(n, { status: 'disputed', stripeDisputeId: `dp_test_reconcile_${n}`, ...patch });

  it.each([
    ['won', 'paid', 1, 0],
    ['lost', 'dispute_lost', 1, 0],
    ['needs_response', 'disputed', 0, 1],
    ['under_review', 'disputed', 0, 1],
  ])('Stripe says %s → %s', async (stripeStatus, finalStatus, concluded, stillOpen) => {
    const h = harness([disputed(2)]);
    h.stripe.disputes.set('dp_test_reconcile_2', dispute(2, stripeStatus));
    const counts = await h.run();
    expect(h.status(2)).toBe(finalStatus);
    expect(counts).toMatchObject({ disputesExamined: 1, disputesConcluded: concluded, disputesStillOpen: stillOpen });
    expect(h.stripe.calls).toEqual(['dispute:dp_test_reconcile_2']);
    if (concluded) expect(h.actions()).toEqual(['BOS_BOOST_PAYMENT_REVERSED']);
    else expect(h.audits).toEqual([]);
  });

  it('heals the out-of-order case: closed(won) before created leaves the purchase disputed; the pass concludes it', async () => {
    const h = harness([paidRow(2)]);
    const chargeHandler = createBoostChargeHandler({ purchases: h.db.repo as never, audit: async (entry) => void h.audits.push(entry) });
    const event = (type: string, status: string) =>
      ({ id: `evt_${type}`, type, livemode: false, data: { object: dispute(2, status) } }) as unknown as Stripe.Event;
    await chargeHandler(event('charge.dispute.closed', 'won'), h.log);
    await chargeHandler(event('charge.dispute.created', 'needs_response'), h.log);
    expect(h.status(2)).toBe('disputed');

    // The webhook moved it a moment ago; the pass re-reads it once the grace has passed.
    h.db.table.set(idOf(2), { ...h.db.table.get(idOf(2))!, statusChangedAt: LONG_AGO });
    h.stripe.disputes.set('dp_test_reconcile_2', dispute(2, 'won'));
    const counts = await h.run();
    expect(h.status(2)).toBe('paid');
    expect(counts.disputesConcluded).toBe(1);
  });

  it('SA CR-2 (QA R-2): warning_closed (an inquiry, no funds taken) concludes as won → paid', async () => {
    const h = harness([disputed(2)]);
    h.stripe.disputes.set('dp_test_reconcile_2', dispute(2, 'warning_closed'));
    const counts = await h.run();
    expect(h.status(2)).toBe('paid');
    expect(counts).toMatchObject({ disputesConcluded: 1, flagged: 0 });
    expect(h.actions()).toEqual(['BOS_BOOST_PAYMENT_REVERSED']);
  });

  it.each([
    ['a status Stripe adds later', () => dispute(2, 'prevented'), 'reconcile_dispute_status'],
    ['a dispute Stripe does not know', () => undefined, 'reconcile_dispute_missing'],
    ['a dispute on another payment', () => dispute(2, 'won', { payment_intent: 'pi_test_other' }), 'reconcile_dispute_mismatch'],
    ['an unreadable dispute', () => ({ id: 'dp_test_reconcile_2' }), 'dispute_unreadable'],
  ])('%s → a finding, no write', async (_name, make, reason) => {
    const h = harness([disputed(2)]);
    const value = make();
    if (value !== undefined) h.stripe.disputes.set('dp_test_reconcile_2', value);
    const counts = await h.run();
    expect(h.status(2)).toBe('disputed');
    expect(counts.flagged).toBe(1);
    expect(h.actions()).toEqual([`BOS_BOOST_FLAGGED:${reason}`]);
  });

  it.each([
    ['an unknown status', () => dispute(2, 'prevented'), 'reconcile_dispute_status'],
    ['404', () => undefined, 'reconcile_dispute_missing'],
    ['another payment', () => dispute(2, 'won', { payment_intent: 'pi_test_other' }), 'reconcile_dispute_mismatch'],
    ['another currency', () => dispute(2, 'won', { currency: 'eur' }), 'currency_mismatch'],
    ['unreadable', () => ({ id: 'dp_test_reconcile_2' }), 'dispute_unreadable'],
  ])('QA R-1 (CR-1), disputed %s: alerted on both runs, ONE FLAGGED (first occurrence only), row unchanged', async (_name, make, reason) => {
    const h = harness([disputed(2)]);
    const value = make();
    if (value !== undefined) h.stripe.disputes.set('dp_test_reconcile_2', value);
    await h.run();
    await h.run();
    expect(h.status(2)).toBe('disputed');
    expect(h.actions()).toEqual([`BOS_BOOST_FLAGGED:${reason}`]);
    expect(h.alerts()).toEqual(['bos_boost_reconcile_finding', 'bos_boost_reconcile_finding']);
    expect(h.logs.filter((l) => l.msg === 'bos_boost_reconcile_finding').map((l) => l.obj.repeat)).toEqual([false, true]);
    expect(h.db.repo.transition).not.toHaveBeenCalled();
    expect(h.deps.findingRecorded).toHaveBeenCalledWith({ accountId: ACCOUNT, purchaseId: idOf(2), reason });
  });

  it('CR-1: when the earlier record cannot be checked, the audit is skipped (never a nightly duplicate); the alert still fires', async () => {
    const h = harness([disputed(2)], { auditLookup: 'fails' });
    h.stripe.disputes.set('dp_test_reconcile_2', dispute(2, 'prevented'));
    await h.run();
    expect(h.audits).toEqual([]);
    expect(h.alerts()).toEqual(['bos_boost_reconcile_finding']);
    expect(h.logs.some((l) => l.msg.startsWith('bos_boost_reconcile_finding_audit_skipped'))).toBe(true);
  });

  it('a disputed purchase with no stored dispute id is a finding (nothing to read it by)', async () => {
    const h = harness([disputed(2, { stripeDisputeId: null })]);
    await h.run();
    expect(h.actions()).toEqual(['BOS_BOOST_FLAGGED:reconcile_dispute_id_missing']);
    expect(h.stripe.calls).toEqual([]);
  });

  it('a Stripe timeout on the dispute read is deferred, not a finding', async () => {
    const h = harness([disputed(2)]);
    h.stripe.disputes.set('dp_test_reconcile_2', stripeError('StripeConnectionError', 0));
    const counts = await h.run();
    expect(counts).toMatchObject({ deferred: 1, flagged: 0 });
    expect(h.status(2)).toBe('disputed');
  });
});

// ── Receipts ────────────────────────────────────────────────────────────────

describe('receipt backfill', () => {
  it('a paid purchase with no receipt link 10 min after payment gets the 4a receipt fill', async () => {
    const h = harness([paidRow(2, { receiptUrl: null })]);
    const counts = await h.run();
    expect(h.receipt).toHaveBeenCalledWith({ purchaseId: idOf(2), paymentIntentId: intentOf(2), eventLivemode: false }, h.log);
    expect(counts).toMatchObject({ receiptsExamined: 1, receiptsFilled: 1 });
  });

  it('a receipt that cannot be filled is counted, never a finding (the next run tries again)', async () => {
    const h = harness([paidRow(2, { receiptUrl: null })]);
    h.receipt.mockResolvedValueOnce('unavailable' as never);
    const counts = await h.run();
    expect(counts).toMatchObject({ receiptsNotFilled: 1, flagged: 0 });
    expect(h.alerts()).toEqual([]);
  });

  it('a purchase paid less than 10 min ago is not read yet', async () => {
    const h = harness([paidRow(2, { receiptUrl: null, paidAt: new Date(NOW - 5 * 60 * 1000).toISOString() })]);
    const counts = await h.run();
    expect(counts.receiptsExamined).toBe(0);
  });
});

// ── The pass contract ───────────────────────────────────────────────────────

describe('the pass contract', () => {
  it('is named boost, always reports every counter, and every counter is in the run record registry', async () => {
    const h = harness([]);
    const pass = createBoostReconcilePass(h.deps);
    expect(pass.name).toBe('boost');
    const counts = await pass.run(h.context());
    expect(Object.keys(counts).sort()).toEqual([...BOOST_RECONCILE_COUNT_KEYS].sort());
    const registered = findBosCronJob('bos-billing-reconcile')!.counts.map((c) => c.key);
    for (const key of BOOST_RECONCILE_COUNT_KEYS) expect(registered).toContain(flattenedCountKey('boost', key));
  });

  it('the limits are the approved ones (SA Q-8, C-4)', () => {
    expect(BOOST_RECONCILE_LIMITS).toEqual({
      BATCH: 50,
      STUCK_GRACE_MS: 30 * 60 * 1000,
      NO_SESSION_EXPIRE_MS: 48 * 60 * 60 * 1000,
      DISPUTE_GRACE_MS: 30 * 60 * 1000,
      RECEIPT_GRACE_MS: 10 * 60 * 1000,
      ROW_MARGIN_MS: 15 * 1000,
    });
  });

  it('every audit entry is on a purchase and its own account (never a system entity, never another account)', async () => {
    const h = harness([row(2), row(3)]);
    h.stripe.sessions.set(sessionOf(2), session(2, {}, { latest_charge: charge(2, { amount_refunded: 500 }) }));
    h.stripe.sessions.set(sessionOf(3), session(3, { livemode: true }));
    await h.run();
    expect(h.audits.length).toBeGreaterThan(2);
    for (const entry of h.audits) {
      expect(entry.entityType).toBe('business_os_boost_purchase');
      expect(entry.userId).toBe(numberOf(entry.entityId as string) % 2 === 0 ? ACCOUNT : OTHER_ACCOUNT);
    }
  });
});

describe('lots are never touched (T-9, FR-37) and no lot function is reachable', () => {
  it.each([
    'lib/business-os/boost/boostReconcilePass.ts',
    'lib/business-os/boost/boostReconcileDeps.ts',
    'lib/business-os/billing/reconcilePassRunner.ts',
    'lib/business-os/billing/reconcilePasses.ts',
    'app/api/cron/bos-billing-reconcile/route.ts',
    'app/api/admin/business-os/credits/boost/reconcile/route.ts',
  ])('%s names no lot table, lot repository, lot function or take-back', (file) => {
    const code = readFileSync(join(process.cwd(), file), 'utf8');
    for (const word of ['credit_lots', 'lot_draws', 'CreditLotRepository', 'record_credit_lot', 'confirmPaidCredits', 'adjust_credit', 'reduceCredits']) {
      expect({ file, word, found: code.includes(word) }).toEqual({ file, word, found: false });
    }
  });

  it('the pass imports nothing from the entitlements module', () => {
    for (const file of ['lib/business-os/boost/boostReconcilePass.ts', 'lib/business-os/boost/boostReconcileDeps.ts']) {
      expect(readFileSync(join(process.cwd(), file), 'utf8')).not.toMatch(/business-os\/entitlements/);
    }
  });
});
