/**
 * Refunds and disputes on a boost payment (credits boost slice 4b.1; FR-35,
 * FR-36, FR-37, T-9; SA C-1, C-8, Q-2, Q-3, Q-4; 2b N-2, I-1; 4a C-1).
 *
 * The handler runs against a fake repository that follows 20261031's refund
 * and dispute rules, so every event × purchase state is checked on the row it
 * leaves behind. Contract with the route: RETURN = complete, THROW = release.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type Stripe from 'stripe';

import { createBoostChargeHandler, plan } from '@/lib/business-os/boost/boostChargeHandler';
import { BoostWebhookTransientError } from '@/lib/business-os/boost/boostWebhookHandler';
import { BoostRepositoryFailure } from '@/lib/repositories/BusinessOsBoostPurchaseRepository';
import type { AuditLogInput } from '@/lib/audit/types';
import { presentOwnerAuditRow } from '@/lib/audit/ownerEventPresentation';
import { ACCOUNT, OTHER_ACCOUNT, PURCHASE, purchaseRow } from '@/lib/business-os/boost/__fixtures__/boostWebhookFixtures';

type Row = ReturnType<typeof purchaseRow>;
const PI = 'pi_test_boost_1';
const DISPUTE = 'dp_test_1';

/** A fake repository following 20261031's refund / dispute transition table. */
function fakeRepo(state: { row: Row | null; error?: Error; lookupError?: Error }) {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    repo: {
      findByPaymentIntentIdForWebhook: jest.fn(async (pi: string) => {
        if (state.lookupError) return { data: null, error: state.lookupError };
        return { data: state.row && state.row.stripePaymentIntentId === pi ? state.row : null, error: null };
      }),
      transition: jest.fn(async (input: { toStatus: string; amountRefundedMinor?: number | null; disputeId?: string | null }) => {
        calls.push(input);
        if (state.error) return { data: null, error: state.error };
        const r = state.row!;
        const from = r.status;
        const done = (status: string, patch: Partial<Row> = {}) => {
          state.row = { ...r, ...patch };
          return { data: { status: status as never, accountId: r.accountId, fromStatus: from }, error: null };
        };
        const refunded = r.amountRefundedMinor ?? 0;
        const total = r.amountTotalMinor;
        if (input.toStatus === 'partially_refunded' || input.toStatus === 'refunded') {
          const amount = input.amountRefundedMinor ?? 0;
          if (!['paid', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost', 'flagged_mismatch'].includes(from)) return done('not_allowed');
          if (amount < refunded) return done('stale');
          if (from === 'refunded' && input.toStatus === 'partially_refunded') return done('not_allowed');
          if (total !== null && amount > total) return done('not_allowed');
          if (['disputed', 'dispute_lost', 'flagged_mismatch'].includes(from)) {
            return amount === refunded ? done('already') : done('recorded', { amountRefundedMinor: amount });
          }
          const target = amount === total ? 'refunded' : amount > 0 ? 'partially_refunded' : null;
          if (target === null || target !== input.toStatus) return done('not_allowed');
          if (from === target && amount === refunded) return done('already');
          if (from === 'refunded') return done('not_allowed');
          return done('transitioned', { status: target as Row['status'], amountRefundedMinor: amount });
        }
        if (input.toStatus === 'disputed') {
          if (from === 'disputed' && r.stripeDisputeId === input.disputeId) return done('already');
          if (from === 'flagged_mismatch') return r.stripeDisputeId ? done(r.stripeDisputeId === input.disputeId ? 'already' : 'not_allowed') : done('recorded', { stripeDisputeId: input.disputeId ?? null });
          if (!['paid', 'partially_refunded', 'refunded'].includes(from)) return done('not_allowed');
          return done('transitioned', { status: 'disputed', stripeDisputeId: input.disputeId ?? null });
        }
        if (r.stripeDisputeId !== (input.disputeId ?? null)) return done('not_allowed');
        if (from === 'flagged_mismatch') return done('already');
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
    },
  };
}

function harness(row: Row | null, extra: { error?: Error; lookupError?: Error } = {}) {
  const state = { row, ...extra };
  const { repo, calls } = fakeRepo(state);
  const audits: AuditLogInput[] = [];
  const logs: Array<{ level: string; obj: Record<string, unknown>; msg: string }> = [];
  const at = (level: string) => (obj: Record<string, unknown>, msg: string) => logs.push({ level, obj, msg });
  const log = { info: at('info'), warn: at('warn'), error: at('error') };
  const handle = createBoostChargeHandler({ purchases: repo as never, audit: async (entry) => void audits.push(entry) });
  const run = async (event: Stripe.Event): Promise<'complete' | 'throw'> => {
    try {
      await handle(event, log);
      return 'complete';
    } catch (error) {
      if (error instanceof BoostWebhookTransientError) return 'throw';
      throw error;
    }
  };
  const alerted = (name?: string) => logs.some((l) => l.obj.alert === true && (!name || l.msg.startsWith(name)));
  const reasons = () => audits.map((a) => (a.details?.reason ? `${a.action}:${a.details.reason}` : a.action));
  return { run, state, calls, audits, logs, alerted, reasons, repo };
}

const paidRow = (patch: Partial<Row> = {}) =>
  purchaseRow({ status: 'paid', stripePaymentIntentId: PI, amountTotalMinor: 2500, amountSubtotalMinor: 2500, amountTaxMinor: 0, currency: 'USD', lotId: '77777777-7777-4777-8777-777777777777', ...patch });

const refund = (amount: number, over: Record<string, unknown> = {}, livemode = false) =>
  ({ id: 'evt_r', type: 'charge.refunded', livemode, data: { object: { id: 'ch_test_1', payment_intent: PI, amount_refunded: amount, currency: 'usd', refunded: amount >= 2500, ...over } } }) as unknown as Stripe.Event;
const dispute = (type: string, status = 'needs_response', over: Record<string, unknown> = {}) =>
  ({ id: 'evt_d', type, livemode: false, data: { object: { id: DISPUTE, payment_intent: PI, status, currency: 'usd', ...over } } }) as unknown as Stripe.Event;

describe('refunds', () => {
  it('SA C-1: a partial refund in lower-case "usd" on a USD purchase → partially_refunded with the cumulative amount; alert + REVERSED audit', async () => {
    const h = harness(paidRow());
    expect(await h.run(refund(1000))).toBe('complete');
    expect(h.calls).toEqual([{ purchaseId: PURCHASE, toStatus: 'partially_refunded', paymentIntentId: PI, amountRefundedMinor: 1000 }]);
    expect(h.state.row?.status).toBe('partially_refunded');
    expect(h.alerted('bos_boost_payment_reversed')).toBe(true);
    expect(h.audits).toEqual([
      expect.objectContaining({
        action: 'BOS_BOOST_PAYMENT_REVERSED',
        entityType: 'business_os_boost_purchase',
        entityId: PURCHASE,
        userId: ACCOUNT,
        details: expect.objectContaining({ kind: 'refund', to_status: 'partially_refunded', from_status: 'paid', amount_refunded_minor: 1000 }),
      }),
    ]);
  });

  it('a second refund event with the full cumulative amount → refunded', async () => {
    const h = harness(paidRow({ status: 'partially_refunded', amountRefundedMinor: 1000 }));
    await h.run(refund(2500));
    expect(h.state.row?.status).toBe('refunded');
    expect(h.calls[0]).toMatchObject({ toStatus: 'refunded', amountRefundedMinor: 2500 });
  });

  it('the same refund event again → already: info, no audit, no alert', async () => {
    const h = harness(paidRow({ status: 'partially_refunded', amountRefundedMinor: 1000 }));
    await h.run(refund(1000));
    expect(h.audits).toEqual([]);
    expect(h.alerted()).toBe(false);
  });

  it('an older refund event arriving late → stale: info, no audit', async () => {
    const h = harness(paidRow({ status: 'refunded', amountRefundedMinor: 2500 }));
    await h.run(refund(1000));
    expect(h.audits).toEqual([]);
    expect(h.alerted()).toBe(false);
  });

  it('a refund event with nothing refunded is ignored (no call)', async () => {
    const h = harness(paidRow());
    await h.run(refund(0));
    expect(h.calls).toEqual([]);
  });

  it.each(['pending', 'awaiting_payment', 'expired'] as const)(
    '2b N-2 / SA Q-3: a refund on a %s purchase (not yet credited) → alert + FLAGGED reversal_before_credit, completes (the pass applies it later)',
    async (status) => {
      const h = harness(paidRow({ status, lotId: null, amountTotalMinor: null }));
      expect(await h.run(refund(2500))).toBe('complete');
      expect(h.alerted('bos_boost_reversal_before_credit')).toBe(true);
      expect(h.reasons()).toEqual(['BOS_BOOST_FLAGGED:reversal_before_credit']);
      expect(h.state.row?.status).toBe(status);
    }
  );

  it('2b I-1: a refund on a flagged purchase is recorded, alerted, and warned with its amount', async () => {
    const h = harness(paidRow({ status: 'flagged_mismatch', amountTotalMinor: null }));
    await h.run(refund(2500));
    expect(h.calls[0]).toMatchObject({ toStatus: 'refunded' });
    expect(h.alerted('bos_boost_payment_reversed')).toBe(true);
    expect(h.logs.find((l) => l.msg === 'bos_boost_refund_on_flagged_purchase')?.obj).toMatchObject({ amountRefundedMinor: 2500 });
    expect(h.reasons()).toEqual(['BOS_BOOST_PAYMENT_REVERSED']);
  });

  it('a refund above the purchase total → not_allowed: alert + FLAGGED, row untouched', async () => {
    const h = harness(paidRow());
    await h.run(refund(9999, { refunded: true }));
    expect(h.alerted('bos_boost_transition_not_allowed')).toBe(true);
    expect(h.state.row?.status).toBe('paid');
  });
});

describe('disputes', () => {
  it('created → disputed with the dispute id; alert + REVERSED audit', async () => {
    const h = harness(paidRow());
    await h.run(dispute('charge.dispute.created'));
    expect(h.calls).toEqual([{ purchaseId: PURCHASE, toStatus: 'disputed', paymentIntentId: PI, disputeId: DISPUTE }]);
    expect(h.state.row?.status).toBe('disputed');
    expect(h.audits[0].details).toMatchObject({ kind: 'dispute', phase: 'charge.dispute.created', to_status: 'disputed' });
  });

  it('closed won → back to paid; then funds_reinstated → already (idempotent)', async () => {
    const h = harness(paidRow({ status: 'disputed', stripeDisputeId: DISPUTE }));
    await h.run(dispute('charge.dispute.closed', 'won'));
    expect(h.state.row?.status).toBe('paid');
    const auditsAfterWin = h.audits.length;
    await h.run(dispute('charge.dispute.funds_reinstated', 'won'));
    expect(h.audits.length).toBe(auditsAfterWin);
  });

  it('closed won after a partial refund → back to partially_refunded', async () => {
    const h = harness(paidRow({ status: 'disputed', stripeDisputeId: DISPUTE, amountRefundedMinor: 1000 }));
    await h.run(dispute('charge.dispute.closed', 'won'));
    expect(h.state.row?.status).toBe('partially_refunded');
  });

  it('closed lost → dispute_lost; alert + audit', async () => {
    const h = harness(paidRow({ status: 'disputed', stripeDisputeId: DISPUTE }));
    await h.run(dispute('charge.dispute.closed', 'lost'));
    expect(h.state.row?.status).toBe('dispute_lost');
    expect(h.alerted('bos_boost_payment_reversed')).toBe(true);
  });

  it.each(['warning_closed', 'needs_response', 'under_review'])('closed with status %s → ignored (info), no call', async (status) => {
    const h = harness(paidRow({ status: 'disputed', stripeDisputeId: DISPUTE }));
    await h.run(dispute('charge.dispute.closed', status));
    expect(h.calls).toEqual([]);
    expect(h.alerted()).toBe(false);
  });

  it('a dispute on a flagged purchase records the id (recorded): alerted and audited', async () => {
    const h = harness(paidRow({ status: 'flagged_mismatch' }));
    await h.run(dispute('charge.dispute.created'));
    expect(h.state.row?.stripeDisputeId).toBe(DISPUTE);
    expect(h.reasons()).toEqual(['BOS_BOOST_PAYMENT_REVERSED']);
  });

  it('a different dispute id on outcome → not_allowed: alert + FLAGGED', async () => {
    const h = harness(paidRow({ status: 'disputed', stripeDisputeId: 'dp_test_other' }));
    await h.run(dispute('charge.dispute.closed', 'lost'));
    expect(h.alerted('bos_boost_transition_not_allowed')).toBe(true);
    expect(h.state.row?.status).toBe('disputed');
  });

  it('a dispute before crediting → reversal_before_credit (alert + audit), completes', async () => {
    const h = harness(paidRow({ status: 'awaiting_payment', lotId: null }));
    expect(await h.run(dispute('charge.dispute.created'))).toBe('complete');
    expect(h.reasons()).toEqual(['BOS_BOOST_FLAGGED:reversal_before_credit']);
  });
});

describe('cross-checks before any write', () => {
  it('livemode differs from the purchase → alert + FLAGGED, no call', async () => {
    const h = harness(paidRow());
    await h.run(refund(1000, {}, true));
    expect(h.calls).toEqual([]);
    expect(h.reasons()).toEqual(['BOS_BOOST_FLAGGED:livemode_mismatch']);
  });

  it('a currency that really differs (eur on a USD purchase) → alert + FLAGGED, no call; "usd" vs "USD" is the same (SA C-1)', async () => {
    const h = harness(paidRow());
    await h.run(refund(1000, { currency: 'eur' }));
    expect(h.calls).toEqual([]);
    expect(h.reasons()).toEqual(['BOS_BOOST_FLAGGED:currency_mismatch']);
    const ok = harness(paidRow({ currency: 'usd' }));
    await ok.run(refund(1000, { currency: 'USD' }));
    expect(ok.calls).toHaveLength(1);
  });

  it('an unreadable event (a negative amount) → alert + FLAGGED reversal_unreadable, no call', async () => {
    const h = harness(paidRow());
    await h.run(refund(-5));
    expect(h.calls).toEqual([]);
    expect(h.reasons()).toEqual(['BOS_BOOST_FLAGGED:reversal_unreadable']);
  });

  it('the account in every audit is the row\'s, never anything in the event', async () => {
    const h = harness(paidRow());
    await h.run(refund(1000, { metadata: { bos_user_id: OTHER_ACCOUNT, user_id: OTHER_ACCOUNT } }));
    for (const audit of h.audits) expect(audit.userId).toBe(ACCOUNT);
    expect(JSON.stringify(h.audits)).not.toContain(OTHER_ACCOUNT);
  });

  it('no purchase for this payment intent any more (a race) → warn, complete, nothing written', async () => {
    const h = harness(null);
    expect(await h.run(refund(1000))).toBe('complete');
    expect(h.calls).toEqual([]);
    expect(h.audits).toEqual([]);
  });
});

describe('repository failures (4a SA C-1)', () => {
  it.each(['22023', '23514', '42883'])('deterministic %s → alert + FLAGGED, completes', async (code) => {
    const h = harness(paidRow(), { error: new BoostRepositoryFailure('refused', code, true) });
    expect(await h.run(refund(1000))).toBe('complete');
    expect(h.reasons()).toEqual(['BOS_BOOST_FLAGGED:deterministic_failure']);
  });

  it.each(['23505', '40001', '08006', 'XX000', null])('transient %p → throws (claim released), no audit', async (code) => {
    const h = harness(paidRow(), { error: new BoostRepositoryFailure('unavailable', code, false) });
    expect(await h.run(refund(1000))).toBe('throw');
    expect(h.audits).toEqual([]);
  });

  it('a transient lookup failure throws; a deterministic one completes with an alert', async () => {
    expect(await harness(paidRow(), { lookupError: new BoostRepositoryFailure('x', null, false) }).run(refund(1000))).toBe('throw');
    const d = harness(paidRow(), { lookupError: new BoostRepositoryFailure('x', '22023', true) });
    expect(await d.run(refund(1000))).toBe('complete');
    expect(d.alerted('bos_boost_deterministic_failure')).toBe(true);
  });
});

describe('plan (pure)', () => {
  it('full vs partial is decided by the cumulative amount against our total; Stripe\'s flag only when our total is unknown', () => {
    const row = { id: PURCHASE, amountTotalMinor: 2500 };
    const fact = (amount: number, fully: boolean | null) => ({ kind: 'refund' as const, chargeId: 'ch_1', paymentIntentId: PI, amountRefundedMinor: amount, currency: 'usd', fullyRefunded: fully });
    expect(plan('charge.refunded', fact(2500, false), row)).toMatchObject({ input: { toStatus: 'refunded' } });
    expect(plan('charge.refunded', fact(100, true), row)).toMatchObject({ input: { toStatus: 'partially_refunded' } });
    expect(plan('charge.refunded', fact(100, true), { id: PURCHASE, amountTotalMinor: null })).toMatchObject({ input: { toStatus: 'refunded' } });
  });
});

describe('the owner\'s view of a reversal (SA Q-4)', () => {
  it('a neutral "Payment update" in three languages, with no details', () => {
    const shown = presentOwnerAuditRow({ action: 'BOS_BOOST_PAYMENT_REVERSED', details: { kind: 'dispute', to_status: 'dispute_lost' } });
    expect(shown).toMatchObject({ details: {}, owner_label: { en: 'Payment update', he: 'עדכון תשלום', es: 'Actualización del pago' } });
  });
});

describe('lots are never touched (T-9, FR-37)', () => {
  it.each([
    'lib/business-os/boost/boostChargeHandler.ts',
    'lib/business-os/boost/boostChargeEvents.ts',
    'lib/business-os/boost/boostWebhookResolver.ts',
    'lib/business-os/boost/boostWebhookDeps.ts',
  ])('%s names no lot table, lot repository, lot function or take-back', (file) => {
    const code = readFileSync(join(process.cwd(), file), 'utf8');
    for (const word of ['credit_lots', 'lot_draws', 'CreditLotRepository', 'record_credit_lot', 'confirmPaidCredits', 'adjust_credit', 'reduceCredits']) {
      expect({ file, word, found: code.includes(word) }).toEqual({ file, word, found: false });
    }
  });
});

describe('QA R-1 (QA4b-M1): a concluded dispute is never reopened by a repeated dispute.created', () => {
  it('created → won → the SAME created again: no call, no alert, no audit; the purchase stays paid', async () => {
    const h = harness(paidRow());
    await h.run(dispute('charge.dispute.created'));
    await h.run(dispute('charge.dispute.closed', 'won'));
    expect(h.state.row?.status).toBe('paid');
    expect(h.state.row?.stripeDisputeId).toBe(DISPUTE);
    const callsBefore = h.calls.length;
    const auditsBefore = h.audits.length;
    const alertsBefore = h.logs.filter((l) => l.obj.alert === true).length;
    expect(await h.run(dispute('charge.dispute.created'))).toBe('complete');
    expect(h.calls.length).toBe(callsBefore);
    expect(h.audits.length).toBe(auditsBefore);
    expect(h.logs.filter((l) => l.obj.alert === true).length).toBe(alertsBefore);
    expect(h.logs.some((l) => l.msg.startsWith('bos_boost_dispute_already_concluded'))).toBe(true);
    expect(h.state.row?.status).toBe('paid');
  });

  it.each(['partially_refunded', 'refunded'] as const)('the same rule on a %s purchase whose dispute was won', async (status) => {
    const h = harness(paidRow({ status, stripeDisputeId: DISPUTE, amountRefundedMinor: status === 'refunded' ? 2500 : 1000 }));
    await h.run(dispute('charge.dispute.created'));
    expect(h.calls).toEqual([]);
    expect(h.audits).toEqual([]);
  });

  it('a NEW dispute id on a paid purchase (after an earlier won dispute) still opens a dispute', async () => {
    const h = harness(paidRow({ stripeDisputeId: DISPUTE }));
    await h.run(dispute('charge.dispute.created', 'needs_response', { id: 'dp_test_2' }));
    expect(h.calls).toEqual([{ purchaseId: PURCHASE, toStatus: 'disputed', paymentIntentId: PI, disputeId: 'dp_test_2' }]);
    expect(h.state.row?.status).toBe('disputed');
    expect(h.reasons()).toEqual(['BOS_BOOST_PAYMENT_REVERSED']);
  });

  it('KNOWN GAP (reported, needs SQL): closed(won) processed BEFORE created on a paid row is refused by 2b (no dispute id stored), so a later created still opens the dispute', async () => {
    // 20261031's dispute outcome branch refuses when the stored dispute id differs
    // (NULL here), so `dispute_won` cannot store the id; the handler alone cannot
    // remember it. Pinned as today's behaviour: the won is alerted (not_allowed),
    // and the later created moves the row to disputed.
    const h = harness(paidRow());
    await h.run(dispute('charge.dispute.closed', 'won'));
    expect(h.alerted('bos_boost_transition_not_allowed')).toBe(true);
    expect(h.state.row?.stripeDisputeId).toBeNull();
    await h.run(dispute('charge.dispute.created'));
    expect(h.state.row?.status).toBe('disputed');
  });
});

describe('QA R-3: the full event × row-state matrix on the 20261031 fake (132 cells)', () => {
  const STATES = ['pending', 'awaiting_payment', 'expired', 'paid', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost', 'flagged_mismatch', 'failed', 'abandoned'] as const;
  const rowIn = (status: (typeof STATES)[number]) => {
    const credited = !['pending', 'awaiting_payment', 'expired', 'failed', 'abandoned'].includes(status);
    return paidRow({
      status: status as Row['status'],
      lotId: credited && status !== 'flagged_mismatch' ? '77777777-7777-4777-8777-777777777777' : null,
      amountTotalMinor: credited ? 2500 : null,
      amountRefundedMinor: status === 'partially_refunded' ? 1000 : status === 'refunded' ? 2500 : 0,
      stripeDisputeId: status === 'disputed' || status === 'dispute_lost' ? DISPUTE : null,
    });
  };
  const EVENTS: Array<[string, () => Stripe.Event]> = [
    ['refund 1000', () => refund(1000)],
    ['refund 1500', () => refund(1500)],
    ['refund 2500', () => refund(2500)],
    ['refund 500', () => refund(500)],
    ['refund 0', () => refund(0)],
    ['refund 3000', () => refund(3000, { refunded: true })],
    ['created', () => dispute('charge.dispute.created')],
    ['closed won', () => dispute('charge.dispute.closed', 'won')],
    ['closed lost', () => dispute('charge.dispute.closed', 'lost')],
    ['closed warning_closed', () => dispute('charge.dispute.closed', 'warning_closed')],
    ['funds_reinstated', () => dispute('charge.dispute.funds_reinstated', 'won')],
    ['created other id', () => dispute('charge.dispute.created', 'needs_response', { id: 'dp_test_2' })],
  ];
  // B = reversal before credit (alert + FLAGGED); T = transitioned; R = recorded; A = already; S = stale;
  // N = not_allowed (alert + FLAGGED); I = ignored (no call).
  const B = 'B', T = 'T', R = 'R', A = 'A', S = 'S', N = 'N', I = 'I';
  const EXPECTED: Record<string, string[]> = {
    //                   pend awt exp  paid part  ref  disp lost flag fail aban
    'refund 1000':      [B, B, B, T, A, S, R, R, R, N, N],
    'refund 1500':      [B, B, B, T, T, S, R, R, R, N, N],
    'refund 2500':      [B, B, B, T, T, A, R, R, R, N, N],
    'refund 500':       [B, B, B, T, S, S, R, R, R, N, N],
    'refund 0':         [I, I, I, I, I, I, I, I, I, I, I],
    'refund 3000':      [B, B, B, N, N, N, N, N, N, N, N],
    'created':          [B, B, B, T, T, T, A, N, R, N, N],
    'closed won':       [B, B, B, N, N, N, T, N, N, N, N],
    'closed lost':      [B, B, B, N, N, N, T, A, N, N, N],
    'closed warning_closed': [I, I, I, I, I, I, I, I, I, I, I],
    'funds_reinstated': [B, B, B, N, N, N, T, N, N, N, N],
    'created other id': [B, B, B, T, T, T, N, N, R, N, N],
  };
  const answerOf = async (h: ReturnType<typeof harness>): Promise<string> => {
    if (h.repo.transition.mock.calls.length === 0) return I;
    const status = (await h.repo.transition.mock.results[0].value).data.status as string;
    if (status === 'not_allowed') return h.reasons().some((r) => r.endsWith(':reversal_before_credit')) ? B : N;
    return { transitioned: T, recorded: R, already: A, stale: S }[status] ?? status;
  };

  for (const [name, event] of EVENTS) {
    STATES.forEach((status, index) => {
      it(`${name} on ${status} → ${EXPECTED[name][index]}`, async () => {
        const h = harness(rowIn(status));
        expect(await h.run(event())).toBe('complete');
        const answer = await answerOf(h);
        expect(answer).toBe(EXPECTED[name][index]);
        for (const audit of h.audits) {
          expect(audit.userId).toBe(ACCOUNT);
          expect(audit.entityType).toBe('business_os_boost_purchase');
        }
        if (answer === T || answer === R) {
          expect(h.reasons()).toEqual(['BOS_BOOST_PAYMENT_REVERSED']);
          expect(h.alerted('bos_boost_payment_reversed')).toBe(true);
        }
        if (answer === A || answer === S || answer === I) {
          expect(h.audits).toEqual([]);
          expect(h.alerted()).toBe(false);
        }
        if (answer === B) expect(h.reasons()).toEqual(['BOS_BOOST_FLAGGED:reversal_before_credit']);
        if (answer === N) expect(h.alerted('bos_boost_transition_not_allowed')).toBe(true);
      });
    });
  }

  it('the matrix has 132 cells', () => {
    expect(Object.values(EXPECTED).reduce((sum, row) => sum + row.length, 0)).toBe(132);
  });
});

describe('QA R-4: currency edge cases, unreadable amounts, and the buyer\'s email never logged', () => {
  it('"Usd" is the same currency; "usd " (trailing space) is not, and writes nothing', async () => {
    const same = harness(paidRow());
    await same.run(refund(1000, { currency: 'Usd' }));
    expect(same.calls).toHaveLength(1);
    const spaced = harness(paidRow());
    await spaced.run(refund(1000, { currency: 'usd ' }));
    expect(spaced.calls).toEqual([]);
    expect(spaced.reasons()).toEqual(['BOS_BOOST_FLAGGED:currency_mismatch']);
  });

  it.each([
    ['a string amount', { amount_refunded: '1000' }],
    ['a transfer id instead of a charge id', { id: 'tr_test_1' }],
  ])('%s → reversal_unreadable, no write', async (_name, over) => {
    const h = harness(paidRow());
    await h.run(refund(1000, over));
    expect(h.calls).toEqual([]);
    expect(h.reasons()).toEqual(['BOS_BOOST_FLAGGED:reversal_unreadable']);
  });

  it('an email planted in the charge and the dispute never reaches a log line or an audit entry', async () => {
    const EMAIL = 'buyer@example.com';
    const h = harness(paidRow());
    await h.run(refund(1000, { billing_details: { email: EMAIL }, receipt_email: EMAIL }));
    await h.run(dispute('charge.dispute.created', 'needs_response', { evidence: { customer_email_address: EMAIL } }));
    await h.run(refund(1000, { currency: 'eur', receipt_email: EMAIL }));
    await h.run(refund(-1, { receipt_email: EMAIL }));
    expect(JSON.stringify(h.logs)).not.toContain(EMAIL);
    expect(JSON.stringify(h.audits)).not.toContain(EMAIL);
  });
});
