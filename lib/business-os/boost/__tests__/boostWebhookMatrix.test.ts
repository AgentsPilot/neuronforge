/**
 * The boost webhook handler against a fake repository that follows the 2b SQL
 * rules (credits boost slice 4a QA follow-ups R-1 to R-3; QA4a-D1, I-3).
 *
 *   R-1  ordering: a late `completed(unpaid)` after the purchase was credited is
 *        stale (no alert, no owner entry); failed / expired after paid still alert.
 *   R-2  the pinned matrix: event × payment_status × row state → complete or
 *        throw, whether credit is called, alert, audit reasons, final status.
 *   R-3  SQLSTATE classes through the handler, for credit and the lookup.
 */

import type Stripe from 'stripe';

import { createBoostWebhookHandler, BoostWebhookTransientError } from '@/lib/business-os/boost/boostWebhookHandler';
import { BoostRepositoryFailure, isDeterministicSqlState } from '@/lib/repositories/BusinessOsBoostPurchaseRepository';
import { ACCOUNT, INTENT, LOT, SESSION, boostEvent, purchaseRow } from '@/lib/business-os/boost/__fixtures__/boostWebhookFixtures';

type Status = 'pending' | 'awaiting_payment' | 'expired' | 'paid' | 'abandoned' | 'failed' | 'flagged_mismatch' | 'refunded' | 'disputed';
type Row = ReturnType<typeof purchaseRow>;

/** A fake repository following 20261031's creditable statuses and transition table. */
function fakeRepo(state: { row: Row; errors?: Partial<Record<'findBySession' | 'credit' | 'transition', Error>> }) {
  const calls: string[] = [];
  const err = (key: 'findBySession' | 'credit' | 'transition') => state.errors?.[key];
  const repo = {
    findBySessionIdForWebhook: jest.fn(async (id: string) => {
      if (err('findBySession')) return { data: null, error: err('findBySession')! };
      return { data: state.row.stripeCheckoutSessionId === id ? state.row : null, error: null };
    }),
    findByIdForWebhook: jest.fn(async (id: string) => ({ data: state.row.id === id ? state.row : null, error: null })),
    credit: jest.fn(async (input: { sessionId: string }) => {
      calls.push('credit');
      if (err('credit')) return { data: null, error: err('credit')! };
      const r = state.row;
      if (r.lotId) return { data: { outcome: 'already_credited' as const, accountId: r.accountId, lotId: r.lotId }, error: null };
      if (!['pending', 'awaiting_payment', 'expired'].includes(r.status)) return { data: { outcome: 'not_creditable' as const, accountId: r.accountId }, error: null };
      if (r.stripeCheckoutSessionId === null || r.stripeCheckoutSessionId !== input.sessionId) {
        const flagReason = r.stripeCheckoutSessionId === null ? ('no_session' as const) : ('session_mismatch' as const);
        state.row = { ...r, status: 'flagged_mismatch', flagReason };
        return { data: { outcome: 'mismatch' as const, accountId: r.accountId, flagReason }, error: null };
      }
      state.row = { ...r, status: 'paid', lotId: LOT };
      return { data: { outcome: 'credited' as const, accountId: r.accountId, lotId: LOT }, error: null };
    }),
    transition: jest.fn(async (input: { toStatus: string; flagReason?: string | null }) => {
      calls.push(`transition:${input.toStatus}`);
      if (err('transition')) return { data: null, error: err('transition')! };
      const r = state.row;
      const from = r.status;
      const allowed: Record<string, string[]> = {
        awaiting_payment: ['pending'],
        failed: ['pending', 'awaiting_payment'],
        expired: ['pending', 'awaiting_payment'],
        flagged_mismatch: ['pending', 'awaiting_payment'],
      };
      if (from === input.toStatus) return { data: { status: 'already' as const, accountId: r.accountId, fromStatus: from }, error: null };
      if (!(allowed[input.toStatus] ?? []).includes(from)) return { data: { status: 'not_allowed' as const, accountId: r.accountId, fromStatus: from }, error: null };
      state.row = { ...r, status: input.toStatus as Row['status'] };
      return { data: { status: 'transitioned' as const, accountId: r.accountId, fromStatus: from }, error: null };
    }),
  };
  return { repo, calls };
}

function harness(row: Row, errors?: Partial<Record<'findBySession' | 'credit' | 'transition', Error>>) {
  const state = { row, errors };
  const { repo, calls } = fakeRepo(state);
  const audits: Array<{ action: string; userId?: string | null; details?: Record<string, unknown> }> = [];
  const logs: Array<{ level: string; obj: Record<string, unknown>; msg: string }> = [];
  const at = (level: string) => (obj: Record<string, unknown>, msg: string) => logs.push({ level, obj, msg });
  const log = { info: at('info'), warn: at('warn'), error: at('error') };
  const handler = createBoostWebhookHandler({
    purchases: repo as never,
    audit: async (entry) => {
      audits.push(entry as never);
    },
    receipt: async () => 'recorded',
  });
  const run = async (event: Stripe.Event): Promise<'complete' | 'throw'> => {
    try {
      await handler(event, log);
      return 'complete';
    } catch (error) {
      if (error instanceof BoostWebhookTransientError) return 'throw';
      throw error;
    }
  };
  const alerted = () => logs.some((l) => l.obj.alert === true);
  const reasons = () => audits.map((a) => (a.details?.reason ? `${a.action}:${a.details.reason}` : a.action));
  return { run, calls, audits, logs, state, alerted, reasons };
}

const rowIn = (status: Status) =>
  purchaseRow({
    status: status as Row['status'],
    lotId: ['paid', 'refunded', 'disputed'].includes(status) ? LOT : null,
    // An abandoned reservation never got a session (slice 3).
    stripeCheckoutSessionId: status === 'abandoned' ? null : SESSION,
  });

describe('R-1 (QA4a-D1): Stripe does not order events', () => {
  it('async_succeeded credits; a late completed(unpaid) is stale: no alert, no FLAGGED, no write', async () => {
    const h = harness(purchaseRow({ status: 'awaiting_payment', stripePaymentIntentId: INTENT }));
    expect(await h.run(boostEvent('checkout.session.async_payment_succeeded'))).toBe('complete');
    expect(h.state.row.status).toBe('paid');
    const auditsBefore = h.audits.length;
    expect(await h.run(boostEvent('checkout.session.completed', { payment_status: 'unpaid' }))).toBe('complete');
    expect(h.audits.length).toBe(auditsBefore);
    expect(h.reasons()).toEqual(['BOS_BOOST_CREDITED']);
    expect(h.logs.filter((l) => l.obj.alert === true)).toEqual([]);
    expect(h.logs.some((l) => l.msg.startsWith('bos_boost_stale_event'))).toBe(true);
    expect(h.state.row.status).toBe('paid');
  });

  it.each(['paid', 'refunded', 'disputed'] as const)('a late completed(unpaid) on a %s purchase is stale (no alert)', async (status) => {
    const h = harness(rowIn(status));
    await h.run(boostEvent('checkout.session.completed', { payment_status: 'unpaid' }));
    expect(h.alerted()).toBe(false);
    expect(h.audits).toEqual([]);
  });

  it('completed(unpaid) on a FAILED or FLAGGED purchase still alerts and audits (a real disagreement)', async () => {
    for (const status of ['failed', 'flagged_mismatch'] as const) {
      const h = harness(rowIn(status));
      await h.run(boostEvent('checkout.session.completed', { payment_status: 'unpaid' }));
      expect(h.alerted()).toBe(true);
      expect(h.reasons()).toEqual(['BOS_BOOST_FLAGGED:transition_not_allowed:awaiting_payment']);
    }
  });

  it('failed or expired against a PAID purchase still alerts and audits (SA Q-7)', async () => {
    for (const type of ['checkout.session.async_payment_failed', 'checkout.session.expired']) {
      const h = harness(rowIn('paid'));
      await h.run(boostEvent(type, { payment_status: 'unpaid', payment_intent: null }));
      expect(h.alerted()).toBe(true);
      expect(h.reasons()[0]).toMatch(/^BOS_BOOST_FLAGGED:transition_not_allowed:/);
    }
  });

  it('the usual order: completed(unpaid) → awaiting, then async_succeeded → credited, with no alert', async () => {
    const h = harness(purchaseRow());
    await h.run(boostEvent('checkout.session.completed', { payment_status: 'unpaid' }));
    expect(h.state.row.status).toBe('awaiting_payment');
    await h.run(boostEvent('checkout.session.async_payment_succeeded'));
    expect(h.state.row.status).toBe('paid');
    expect(h.alerted()).toBe(false);
  });

  it('QA I-3: no_payment_required on a row that cannot be flagged logs accurately ("could not be flagged"), alert and audit kept', async () => {
    const h = harness(rowIn('paid'));
    await h.run(boostEvent('checkout.session.completed', { payment_status: 'no_payment_required' }));
    const line = h.logs.find((l) => l.obj.alert === true);
    expect(line?.msg).toMatch(/^bos_boost_mismatch_unflagged/);
    expect(h.audits[0].details).toMatchObject({ reason: 'no_payment_required', flag_applied: false });
  });
});

describe('R-2: the pinned matrix (event × payment_status × row state)', () => {
  const STATES: Status[] = ['pending', 'awaiting_payment', 'expired', 'paid', 'abandoned', 'failed', 'flagged_mismatch', 'refunded'];
  const CASES: Array<[string, string]> = [
    ['checkout.session.completed', 'paid'],
    ['checkout.session.completed', 'unpaid'],
    ['checkout.session.completed', 'no_payment_required'],
    ['checkout.session.async_payment_succeeded', 'paid'],
    ['checkout.session.async_payment_succeeded', 'unpaid'],
    ['checkout.session.async_payment_failed', 'unpaid'],
    ['checkout.session.expired', 'unpaid'],
  ];

  /** What each cell must produce: [credit called, alert, audit reasons, final status]. */
  const EXPECTED: Record<string, [boolean, boolean, string[], string]> = {
    'completed/paid/pending': [true, false, ['BOS_BOOST_CREDITED'], 'paid'],
    'completed/paid/awaiting_payment': [true, false, ['BOS_BOOST_CREDITED'], 'paid'],
    'completed/paid/expired': [true, false, ['BOS_BOOST_CREDITED'], 'paid'],
    'completed/paid/paid': [true, false, [], 'paid'],
    'completed/paid/abandoned': [true, true, ['BOS_BOOST_FLAGGED:paid_not_creditable'], 'abandoned'],
    'completed/paid/failed': [true, true, ['BOS_BOOST_FLAGGED:paid_not_creditable'], 'failed'],
    'completed/paid/flagged_mismatch': [true, true, ['BOS_BOOST_FLAGGED:paid_not_creditable'], 'flagged_mismatch'],
    'completed/paid/refunded': [true, false, [], 'refunded'],
    'completed/unpaid/pending': [false, false, [], 'awaiting_payment'],
    'completed/unpaid/awaiting_payment': [false, false, [], 'awaiting_payment'],
    'completed/unpaid/expired': [false, true, ['BOS_BOOST_FLAGGED:transition_not_allowed:awaiting_payment'], 'expired'],
    'completed/unpaid/paid': [false, false, [], 'paid'],
    'completed/unpaid/abandoned': [false, false, [], 'abandoned'],
    'completed/unpaid/failed': [false, true, ['BOS_BOOST_FLAGGED:transition_not_allowed:awaiting_payment'], 'failed'],
    'completed/unpaid/flagged_mismatch': [false, true, ['BOS_BOOST_FLAGGED:transition_not_allowed:awaiting_payment'], 'flagged_mismatch'],
    'completed/unpaid/refunded': [false, false, [], 'refunded'],
    'completed/no_payment_required/pending': [false, true, ['BOS_BOOST_FLAGGED:no_payment_required'], 'flagged_mismatch'],
    'completed/no_payment_required/awaiting_payment': [false, true, ['BOS_BOOST_FLAGGED:no_payment_required'], 'flagged_mismatch'],
    'completed/no_payment_required/expired': [false, true, ['BOS_BOOST_FLAGGED:no_payment_required'], 'expired'],
    'completed/no_payment_required/paid': [false, true, ['BOS_BOOST_FLAGGED:no_payment_required'], 'paid'],
    'completed/no_payment_required/abandoned': [false, false, [], 'abandoned'],
    'completed/no_payment_required/failed': [false, true, ['BOS_BOOST_FLAGGED:no_payment_required'], 'failed'],
    'completed/no_payment_required/flagged_mismatch': [false, true, ['BOS_BOOST_FLAGGED:no_payment_required'], 'flagged_mismatch'],
    'completed/no_payment_required/refunded': [false, true, ['BOS_BOOST_FLAGGED:no_payment_required'], 'refunded'],
    'async_payment_succeeded/paid/pending': [true, false, ['BOS_BOOST_CREDITED'], 'paid'],
    'async_payment_succeeded/paid/awaiting_payment': [true, false, ['BOS_BOOST_CREDITED'], 'paid'],
    'async_payment_succeeded/paid/expired': [true, false, ['BOS_BOOST_CREDITED'], 'paid'],
    'async_payment_succeeded/paid/paid': [true, false, [], 'paid'],
    'async_payment_succeeded/paid/abandoned': [true, true, ['BOS_BOOST_FLAGGED:paid_not_creditable'], 'abandoned'],
    'async_payment_succeeded/paid/failed': [true, true, ['BOS_BOOST_FLAGGED:paid_not_creditable'], 'failed'],
    'async_payment_succeeded/paid/flagged_mismatch': [true, true, ['BOS_BOOST_FLAGGED:paid_not_creditable'], 'flagged_mismatch'],
    'async_payment_succeeded/paid/refunded': [true, false, [], 'refunded'],
    'async_payment_failed/unpaid/pending': [false, false, ['BOS_BOOST_PAYMENT_FAILED'], 'failed'],
    'async_payment_failed/unpaid/awaiting_payment': [false, false, ['BOS_BOOST_PAYMENT_FAILED'], 'failed'],
    'async_payment_failed/unpaid/expired': [false, true, ['BOS_BOOST_FLAGGED:transition_not_allowed:failed'], 'expired'],
    'async_payment_failed/unpaid/paid': [false, true, ['BOS_BOOST_FLAGGED:transition_not_allowed:failed'], 'paid'],
    'async_payment_failed/unpaid/abandoned': [false, false, [], 'abandoned'],
    'async_payment_failed/unpaid/failed': [false, false, [], 'failed'],
    'async_payment_failed/unpaid/flagged_mismatch': [false, true, ['BOS_BOOST_FLAGGED:transition_not_allowed:failed'], 'flagged_mismatch'],
    'async_payment_failed/unpaid/refunded': [false, true, ['BOS_BOOST_FLAGGED:transition_not_allowed:failed'], 'refunded'],
    'expired/unpaid/pending': [false, false, [], 'expired'],
    'expired/unpaid/awaiting_payment': [false, false, [], 'expired'],
    'expired/unpaid/expired': [false, false, [], 'expired'],
    'expired/unpaid/paid': [false, true, ['BOS_BOOST_FLAGGED:transition_not_allowed:expired'], 'paid'],
    'expired/unpaid/abandoned': [false, false, [], 'abandoned'],
    'expired/unpaid/failed': [false, true, ['BOS_BOOST_FLAGGED:transition_not_allowed:expired'], 'failed'],
    'expired/unpaid/flagged_mismatch': [false, true, ['BOS_BOOST_FLAGGED:transition_not_allowed:expired'], 'flagged_mismatch'],
    'expired/unpaid/refunded': [false, true, ['BOS_BOOST_FLAGGED:transition_not_allowed:expired'], 'refunded'],
  };

  for (const [type, paymentStatus] of CASES) {
    for (const status of STATES) {
      // async_succeeded / unpaid is the same in every state: an alert and an audit, no write.
      const key = `${type.replace('checkout.session.', '')}/${paymentStatus}/${status}`;
      it(key, async () => {
        const h = harness(rowIn(status));
        const event = boostEvent(type, { payment_status: paymentStatus, ...(type === 'checkout.session.expired' ? { payment_intent: null } : {}) });
        expect(await h.run(event)).toBe('complete');
        for (const audit of h.audits) expect(audit.userId).toBe(ACCOUNT);
        if (paymentStatus !== 'paid') expect(h.calls).not.toContain('credit');

        if (key.startsWith('async_payment_succeeded/unpaid/')) {
          const abandoned = status === 'abandoned';
          expect(h.calls).toEqual([]);
          expect(h.alerted()).toBe(!abandoned);
          expect(h.reasons()).toEqual(abandoned ? [] : ['BOS_BOOST_FLAGGED:async_succeeded_not_paid']);
          return;
        }
        const [credit, alert, reasons, finalStatus] = EXPECTED[key];
        expect(h.calls.includes('credit')).toBe(credit);
        expect(h.alerted()).toBe(alert);
        expect(h.reasons()).toEqual(reasons);
        expect(h.state.row.status).toBe(finalStatus);
      });
    }
  }
});

describe('R-3: SQLSTATE classes through the handler (SA C-1)', () => {
  const COMPLETE = ['22004', '22023', '22003', '22P02', '23514', '23502', '23503', '42883', '42501', '42P01'];
  const THROW = ['23505', '40001', '40P01', '08006', '53300', '57014', 'XX000', null, 'PGRST301'];

  it.each(COMPLETE)('%s → deterministic: the event completes, alerted', async (code) => {
    expect(isDeterministicSqlState(code)).toBe(true);
    for (const step of ['credit', 'findBySession'] as const) {
      const h = harness(purchaseRow(), { [step]: new BoostRepositoryFailure('refused', code, true) });
      expect(await h.run(boostEvent('checkout.session.completed'))).toBe('complete');
      expect(h.alerted()).toBe(true);
    }
  });

  it.each(THROW)('%p → transient: the handler throws so the claim is released', async (code) => {
    expect(isDeterministicSqlState(code)).toBe(false);
    for (const step of ['credit', 'findBySession'] as const) {
      const h = harness(purchaseRow(), { [step]: new BoostRepositoryFailure('unavailable', code, false) });
      expect(await h.run(boostEvent('checkout.session.completed'))).toBe('throw');
    }
  });
});
