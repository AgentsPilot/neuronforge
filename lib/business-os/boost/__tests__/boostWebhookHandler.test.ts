/**
 * The boost webhook handler (credits boost slice 4a; FR-13 to FR-17, HP-1,
 * T-6, T-7, R-6, R-10; SA C-1, C-3, C-8 b, Q-3, Q-7; 2b N-1, I-3).
 *
 * Every event × outcome. The contract with the route: RETURN = complete the
 * event, THROW = release it for a Stripe retry. The account in every call and
 * audit entry is the purchase row's, never the event's.
 */

import { createBoostWebhookHandler, BoostWebhookTransientError, type BoostWebhookDeps } from '@/lib/business-os/boost/boostWebhookHandler';
import {
  BoostRepositoryFailure,
  type BusinessOsBoostCreditResult,
  type BusinessOsBoostPurchase,
  type BusinessOsBoostTransitionInput,
  type BusinessOsBoostTransitionResult,
} from '@/lib/repositories/BusinessOsBoostPurchaseRepository';
import type { AuditLogInput } from '@/lib/audit/types';
import {
  ACCOUNT,
  INTENT,
  LOT,
  OTHER_ACCOUNT,
  OTHER_SESSION,
  PURCHASE,
  SESSION,
  boostEvent,
  purchaseRow,
} from '@/lib/business-os/boost/__fixtures__/boostWebhookFixtures';

type Repo = BoostWebhookDeps['purchases'];

function setup(opts: {
  row?: BusinessOsBoostPurchase | null;
  byReference?: BusinessOsBoostPurchase | null;
  credit?: { data: BusinessOsBoostCreditResult | null; error: Error | null };
  transition?: { data: BusinessOsBoostTransitionResult | null; error: Error | null };
  lookupError?: Error;
} = {}) {
  const order: string[] = [];
  const row = opts.row === undefined ? purchaseRow() : opts.row;
  const purchases: Repo = {
    findBySessionIdForWebhook: jest.fn(async () => (opts.lookupError ? { data: null, error: opts.lookupError } : { data: row, error: null })),
    findByIdForWebhook: jest.fn(async () => ({ data: opts.byReference ?? null, error: null })),
    credit: jest.fn(async () => {
      order.push('credit');
      const credited: BusinessOsBoostCreditResult = { outcome: 'credited', accountId: ACCOUNT, lotId: LOT };
      return opts.credit ?? { data: credited, error: null };
    }),
    transition: jest.fn(async (input: BusinessOsBoostTransitionInput) => {
      order.push(`transition:${input.toStatus}`);
      const moved: BusinessOsBoostTransitionResult = { status: 'transitioned', accountId: ACCOUNT, fromStatus: 'pending' };
      return opts.transition ?? { data: moved, error: null };
    }),
  };
  const audits: AuditLogInput[] = [];
  const audit = jest.fn(async (entry: AuditLogInput) => {
    order.push(`audit:${entry.action}`);
    audits.push(entry);
  });
  const receipt = jest.fn(async () => {
    order.push('receipt');
    return 'recorded' as const;
  });
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const handle = createBoostWebhookHandler({ purchases, audit, receipt });
  return { handle, purchases, audits, audit, receipt, log, order };
}

const deterministic = (code: string) => new BoostRepositoryFailure('db refused', code, true);
const transient = (code: string | null) => new BoostRepositoryFailure('db unavailable', code, false);
const alerted = (log: { error: jest.Mock }, name: string) =>
  log.error.mock.calls.some(([ctx, msg]) => (ctx as { alert?: boolean }).alert === true && String(msg).startsWith(name));

describe('checkout.session.completed', () => {
  it('paid → credit with the ROW id and the session facts; audit CREDITED; then the receipt (order: money, audit, receipt)', async () => {
    const t = setup();
    await t.handle(boostEvent('checkout.session.completed'), t.log);
    expect(t.purchases.credit).toHaveBeenCalledWith({
      purchaseId: PURCHASE,
      sessionId: SESSION,
      paymentIntentId: INTENT,
      amountSubtotalMinor: 2500,
      amountTaxMinor: 0,
      amountTotalMinor: 2500,
      currency: 'usd',
      livemode: false,
    });
    expect(t.order).toEqual(['credit', 'audit:BOS_BOOST_CREDITED', 'receipt']);
    expect(t.audits[0]).toMatchObject({
      action: 'BOS_BOOST_CREDITED',
      entityType: 'business_os_boost_purchase',
      entityId: PURCHASE,
      userId: ACCOUNT,
      details: {
        package_id: 'plus',
        package_version: 1,
        credits_total: 13750,
        price_minor: 2500,
        currency: 'usd',
        lot_id: LOT,
        stripe_payment_intent_id: INTENT,
        livemode: false,
      },
    });
    expect(JSON.stringify(t.audits)).not.toContain(SESSION);
    expect(JSON.stringify(t.audits)).not.toContain('owner@example.com');
    expect(t.receipt).toHaveBeenCalledWith({ purchaseId: PURCHASE, paymentIntentId: INTENT, eventLivemode: false }, t.log);
  });

  it('R-6: the account is the row\'s even when the event names another (metadata and reference planted)', async () => {
    const t = setup();
    const event = boostEvent('checkout.session.completed', { metadata: { product: 'business_os_boost', bos_user_id: OTHER_ACCOUNT } });
    await t.handle(event, t.log);
    expect(t.audits[0].userId).toBe(ACCOUNT);
    expect(JSON.stringify((t.purchases.credit as jest.Mock).mock.calls)).not.toContain(OTHER_ACCOUNT);
  });

  it('already_credited (a replay) → no second audit (FR-15); the receipt only if the row has none', async () => {
    const t = setup({ credit: { data: { outcome: 'already_credited', accountId: ACCOUNT, lotId: LOT }, error: null } });
    await t.handle(boostEvent('checkout.session.completed'), t.log);
    expect(t.audits).toHaveLength(0);
    expect(t.receipt).toHaveBeenCalledTimes(1);

    const withReceipt = setup({
      row: purchaseRow({ receiptUrl: 'https://pay.stripe.com/receipts/x' }),
      credit: { data: { outcome: 'already_credited', accountId: ACCOUNT, lotId: LOT }, error: null },
    });
    await withReceipt.handle(boostEvent('checkout.session.completed'), withReceipt.log);
    expect(withReceipt.receipt).not.toHaveBeenCalled();
  });

  it.each([
    'no_session',
    'session_mismatch',
    'payment_intent_mismatch',
    'livemode_mismatch',
    'currency_mismatch',
    'amount_mismatch',
    'total_mismatch',
    'payment_intent_reused',
    'account_deleted',
    'lot_key_conflict',
  ] as const)('credit → mismatch %s: error + alert + FLAGGED audit, no receipt, completes', async (flagReason) => {
    const t = setup({ credit: { data: { outcome: 'mismatch', accountId: ACCOUNT, flagReason }, error: null } });
    await expect(t.handle(boostEvent('checkout.session.completed'), t.log)).resolves.toBeUndefined();
    expect(alerted(t.log, 'bos_boost_mismatch')).toBe(true);
    expect(t.audits).toEqual([expect.objectContaining({ action: 'BOS_BOOST_FLAGGED', userId: ACCOUNT, details: expect.objectContaining({ reason: flagReason }) })]);
    expect(t.receipt).not.toHaveBeenCalled();
  });

  it('C-8 b: not_creditable on a PAID session → error bos_boost_paid_not_creditable + alert + audit, completes', async () => {
    const t = setup({ row: purchaseRow({ status: 'failed' }), credit: { data: { outcome: 'not_creditable', accountId: ACCOUNT }, error: null } });
    await t.handle(boostEvent('checkout.session.completed'), t.log);
    expect(alerted(t.log, 'bos_boost_paid_not_creditable')).toBe(true);
    expect(t.audits[0]).toMatchObject({ action: 'BOS_BOOST_FLAGGED', details: { reason: 'paid_not_creditable', row_status: 'failed' } });
  });

  it('credit → not_found (a race) → warn, nothing else, completes', async () => {
    const t = setup({ credit: { data: { outcome: 'not_found' }, error: null } });
    await t.handle(boostEvent('checkout.session.completed'), t.log);
    expect(t.log.warn).toHaveBeenCalled();
    expect(t.audits).toHaveLength(0);
  });

  it('unpaid (a delayed method) → transition awaiting_payment with the intent; no credit (T-7)', async () => {
    const t = setup();
    await t.handle(boostEvent('checkout.session.completed', { payment_status: 'unpaid' }), t.log);
    expect(t.purchases.transition).toHaveBeenCalledWith({ purchaseId: PURCHASE, toStatus: 'awaiting_payment', paymentIntentId: INTENT });
    expect(t.purchases.credit).not.toHaveBeenCalled();
    expect(t.audits).toHaveLength(0);
  });

  it('unpaid with no payment intent → flagged no_payment_intent', async () => {
    const t = setup();
    await t.handle(boostEvent('checkout.session.completed', { payment_status: 'unpaid', payment_intent: null }), t.log);
    expect(t.purchases.transition).toHaveBeenCalledWith({ purchaseId: PURCHASE, toStatus: 'flagged_mismatch', flagReason: 'no_payment_intent' });
  });

  it('no_payment_required → never credited; flagged and alerted (T-7)', async () => {
    const t = setup();
    await t.handle(boostEvent('checkout.session.completed', { payment_status: 'no_payment_required', amount_total: 0 }), t.log);
    expect(t.purchases.credit).not.toHaveBeenCalled();
    expect(t.purchases.transition).toHaveBeenCalledWith({ purchaseId: PURCHASE, toStatus: 'flagged_mismatch', flagReason: 'no_payment_required' });
    expect(alerted(t.log, 'bos_boost_mismatch')).toBe(true);
    expect(t.audits[0]).toMatchObject({ action: 'BOS_BOOST_FLAGGED', details: { reason: 'no_payment_required' } });
  });

  it('paid with no payment intent, or missing amounts → flagged, never credited', async () => {
    for (const [patch, reason] of [
      [{ payment_intent: null }, 'no_payment_intent'],
      [{ amount_total: null }, 'session_amounts_missing'],
      [{ currency: null }, 'session_amounts_missing'],
    ] as const) {
      const t = setup();
      await t.handle(boostEvent('checkout.session.completed', patch), t.log);
      expect(t.purchases.credit).not.toHaveBeenCalled();
      expect(t.purchases.transition).toHaveBeenCalledWith({ purchaseId: PURCHASE, toStatus: 'flagged_mismatch', flagReason: reason });
    }
  });
});

describe('cross-checks before any write (R-10, HP-3, SA Q-3)', () => {
  it('livemode differs from the row → flagged livemode_mismatch, no credit', async () => {
    const t = setup({ row: purchaseRow({ livemode: true }) });
    await t.handle(boostEvent('checkout.session.completed'), t.log);
    expect(t.purchases.credit).not.toHaveBeenCalled();
    expect(t.purchases.transition).toHaveBeenCalledWith({ purchaseId: PURCHASE, toStatus: 'flagged_mismatch', flagReason: 'livemode_mismatch' });
    expect(alerted(t.log, 'bos_boost_mismatch')).toBe(true);
  });

  it.each([
    ['another product', { product: 'business_os_plan' }],
    ['legacy Pilot-Credit keys', { product: 'business_os_boost', user_id: 'someone', credits: '999999' }],
  ])('metadata names %s → flagged metadata_mismatch, no credit', async (_name, metadata) => {
    const t = setup();
    await t.handle(boostEvent('checkout.session.completed', { metadata }), t.log);
    expect(t.purchases.credit).not.toHaveBeenCalled();
    expect(t.purchases.transition).toHaveBeenCalledWith({ purchaseId: PURCHASE, toStatus: 'flagged_mismatch', flagReason: 'metadata_mismatch' });
  });

  it('a session that fails the narrowing → flagged session_unreadable (issue paths only), no credit', async () => {
    const t = setup();
    await t.handle(boostEvent('checkout.session.completed', { amount_total: 25.5 }), t.log);
    expect(t.purchases.credit).not.toHaveBeenCalled();
    expect(t.purchases.transition).toHaveBeenCalledWith({ purchaseId: PURCHASE, toStatus: 'flagged_mismatch', flagReason: 'session_unreadable' });
    expect(JSON.stringify(t.audits)).not.toContain('25.5');
  });
});

describe('the delayed-payment and expiry events (T-7)', () => {
  it('async_payment_succeeded (paid) → credit', async () => {
    const t = setup({ row: purchaseRow({ status: 'awaiting_payment', stripePaymentIntentId: INTENT }) });
    await t.handle(boostEvent('checkout.session.async_payment_succeeded'), t.log);
    expect(t.purchases.credit).toHaveBeenCalledTimes(1);
    expect(t.audits[0].action).toBe('BOS_BOOST_CREDITED');
  });

  it('async_payment_succeeded that is not paid → alert + audit, no write', async () => {
    const t = setup();
    await t.handle(boostEvent('checkout.session.async_payment_succeeded', { payment_status: 'unpaid' }), t.log);
    expect(t.purchases.credit).not.toHaveBeenCalled();
    expect(t.purchases.transition).not.toHaveBeenCalled();
    expect(alerted(t.log, 'bos_boost_unexpected_status')).toBe(true);
    expect(t.audits[0].details).toMatchObject({ reason: 'async_succeeded_not_paid' });
  });

  it('async_payment_failed → transition failed + PAYMENT_FAILED audit (owner-visible, no amounts)', async () => {
    const t = setup({ row: purchaseRow({ status: 'awaiting_payment' }) });
    await t.handle(boostEvent('checkout.session.async_payment_failed', { payment_status: 'unpaid' }), t.log);
    expect(t.purchases.transition).toHaveBeenCalledWith({ purchaseId: PURCHASE, toStatus: 'failed', paymentIntentId: INTENT });
    expect(t.audits).toEqual([expect.objectContaining({ action: 'BOS_BOOST_PAYMENT_FAILED', userId: ACCOUNT, details: { package_id: 'plus', livemode: false } })]);
  });

  it('async_payment_failed replayed (already) → no second audit', async () => {
    const t = setup({ transition: { data: { status: 'already', accountId: ACCOUNT, fromStatus: 'failed' }, error: null } });
    await t.handle(boostEvent('checkout.session.async_payment_failed', { payment_status: 'unpaid' }), t.log);
    expect(t.audits).toHaveLength(0);
  });

  it('expired → transition expired, no audit', async () => {
    const t = setup();
    await t.handle(boostEvent('checkout.session.expired', { status: 'expired', payment_status: 'unpaid', payment_intent: null }), t.log);
    expect(t.purchases.transition).toHaveBeenCalledWith({ purchaseId: PURCHASE, toStatus: 'expired', paymentIntentId: null });
    expect(t.audits).toHaveLength(0);
  });

  it('SA Q-7: a disallowed move (expired after paid) → error + alert + FLAGGED audit, the row untouched', async () => {
    const t = setup({ row: purchaseRow({ status: 'paid' }), transition: { data: { status: 'not_allowed', accountId: ACCOUNT, fromStatus: 'paid' }, error: null } });
    await t.handle(boostEvent('checkout.session.expired', { payment_status: 'unpaid', payment_intent: null }), t.log);
    expect(alerted(t.log, 'bos_boost_transition_not_allowed')).toBe(true);
    expect(t.audits[0].details).toMatchObject({ reason: 'transition_not_allowed:expired', from_status: 'paid' });
  });

  it('a reused intent on awaiting_payment → mismatch: alert + audit', async () => {
    const t = setup({ transition: { data: { status: 'mismatch', accountId: ACCOUNT, fromStatus: 'pending' }, error: null } });
    await t.handle(boostEvent('checkout.session.completed', { payment_status: 'unpaid' }), t.log);
    expect(alerted(t.log, 'bos_boost_mismatch')).toBe(true);
    expect(t.audits[0].details).toMatchObject({ reason: 'payment_intent_reused' });
  });
});

describe('repository failures (SA C-1, 2b N-1, I-3, HP-1)', () => {
  it.each(['22004', '22023', '22003', '23514', '23502', '23503', '42883'])(
    'deterministic %s from credit → error + alert + FLAGGED audit, and the event COMPLETES (no throw)',
    async (code) => {
      const t = setup({ credit: { data: null, error: deterministic(code) } });
      await expect(t.handle(boostEvent('checkout.session.completed'), t.log)).resolves.toBeUndefined();
      expect(alerted(t.log, 'bos_boost_deterministic_failure')).toBe(true);
      expect(t.audits[0]).toMatchObject({ action: 'BOS_BOOST_FLAGGED', details: { reason: 'deterministic_failure', step: 'credit' } });
      expect(t.receipt).not.toHaveBeenCalled();
    }
  );

  it.each(['23505', '40001', '40P01', '08006', '53300', '57014', null])(
    'transient %p from credit → THROWS (the claim is released), and nothing claims success',
    async (code) => {
      const t = setup({ credit: { data: null, error: transient(code) } });
      await expect(t.handle(boostEvent('checkout.session.completed'), t.log)).rejects.toBeInstanceOf(BoostWebhookTransientError);
      expect(t.audits).toHaveLength(0);
      expect(t.receipt).not.toHaveBeenCalled();
    }
  );

  it('XX000 → throws AND alerts (the 2b anomaly)', async () => {
    const t = setup({ credit: { data: null, error: transient('XX000') } });
    await expect(t.handle(boostEvent('checkout.session.completed'), t.log)).rejects.toBeInstanceOf(BoostWebhookTransientError);
    expect(alerted(t.log, 'bos_boost_internal_error')).toBe(true);
  });

  it('a plain Error (not a classified failure) is transient', async () => {
    const t = setup({ credit: { data: null, error: new Error('socket hang up') } });
    await expect(t.handle(boostEvent('checkout.session.completed'), t.log)).rejects.toBeInstanceOf(BoostWebhookTransientError);
  });

  it('transient from a transition → throws; deterministic from a transition → completes', async () => {
    const a = setup({ transition: { data: null, error: transient('08006') } });
    await expect(a.handle(boostEvent('checkout.session.expired', { payment_intent: null }), a.log)).rejects.toBeInstanceOf(BoostWebhookTransientError);
    const b = setup({ transition: { data: null, error: deterministic('22023') } });
    await expect(b.handle(boostEvent('checkout.session.expired', { payment_intent: null }), b.log)).resolves.toBeUndefined();
  });

  it('the lookup failing transiently throws; deterministically completes with an alert (no row to audit)', async () => {
    const a = setup({ lookupError: transient(null) });
    await expect(a.handle(boostEvent('checkout.session.completed'), a.log)).rejects.toBeInstanceOf(BoostWebhookTransientError);
    const b = setup({ lookupError: deterministic('22023') });
    await expect(b.handle(boostEvent('checkout.session.completed'), b.log)).resolves.toBeUndefined();
    expect(alerted(b.log, 'bos_boost_deterministic_failure')).toBe(true);
    expect(b.audits).toHaveLength(0);
  });

  it('an audit or receipt failure never changes the outcome (they never throw by contract; even if they did, the write is done)', async () => {
    const t = setup();
    (t.receipt as jest.Mock).mockResolvedValueOnce('unavailable');
    await expect(t.handle(boostEvent('checkout.session.completed'), t.log)).resolves.toBeUndefined();
    expect(t.purchases.credit).toHaveBeenCalledTimes(1);
  });
});

describe('SA C-3: a row found only by client_reference_id', () => {
  it('(a) stored session NULL → credit is called (it flags no_session itself)', async () => {
    const t = setup({ row: null, byReference: purchaseRow({ stripeCheckoutSessionId: null }) });
    await t.handle(boostEvent('checkout.session.completed', { id: OTHER_SESSION }), t.log);
    expect(t.purchases.credit).toHaveBeenCalledWith(expect.objectContaining({ purchaseId: PURCHASE, sessionId: OTHER_SESSION }));
  });

  it('(b) stored session DIFFERENT, paid → no credit, no transition; bos_boost_orphan_session_paid alert with both ids; FLAGGED audit; completes', async () => {
    const t = setup({ row: null, byReference: purchaseRow({ stripeCheckoutSessionId: SESSION }) });
    await expect(t.handle(boostEvent('checkout.session.completed', { id: OTHER_SESSION }), t.log)).resolves.toBeUndefined();
    expect(t.purchases.credit).not.toHaveBeenCalled();
    expect(t.purchases.transition).not.toHaveBeenCalled();
    const call = t.log.error.mock.calls.find(([, msg]) => String(msg).startsWith('bos_boost_orphan_session_paid'));
    expect(call?.[0]).toMatchObject({ alert: true, sessionId: OTHER_SESSION, storedSessionId: SESSION });
    expect(t.audits).toEqual([expect.objectContaining({ action: 'BOS_BOOST_FLAGGED', userId: ACCOUNT, details: expect.objectContaining({ reason: 'orphan_session_paid' }) })]);
  });

  it('(b) stored session different and NOT paid (expired) → nothing written, no alert, completes', async () => {
    const t = setup({ row: null, byReference: purchaseRow({ stripeCheckoutSessionId: SESSION }) });
    await t.handle(boostEvent('checkout.session.expired', { id: OTHER_SESSION, payment_status: 'unpaid', payment_intent: null }), t.log);
    expect(t.purchases.transition).not.toHaveBeenCalled();
    expect(t.audits).toHaveLength(0);
  });

  it('a row matched by reference is never moved by a status event, even with a NULL stored session', async () => {
    for (const type of ['checkout.session.expired', 'checkout.session.async_payment_failed']) {
      const t = setup({ row: null, byReference: purchaseRow({ stripeCheckoutSessionId: null }) });
      await t.handle(boostEvent(type, { id: OTHER_SESSION, payment_status: 'unpaid' }), t.log);
      expect(t.purchases.transition).not.toHaveBeenCalled();
    }
  });

  it('a by-reference row with a cross-check failure is alerted and audited, never flagged in place', async () => {
    const t = setup({ row: null, byReference: purchaseRow({ stripeCheckoutSessionId: null, livemode: true }) });
    await t.handle(boostEvent('checkout.session.completed', { id: OTHER_SESSION }), t.log);
    expect(t.purchases.transition).not.toHaveBeenCalled();
    expect(t.purchases.credit).not.toHaveBeenCalled();
    expect(t.audits[0].details).toMatchObject({ reason: 'livemode_mismatch', matched_by: 'reference' });
  });
});
