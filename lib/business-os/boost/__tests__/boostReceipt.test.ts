/**
 * The boost receipt fill (credits boost slice 4a; FR-27, T-8; SA C-4, Q-5).
 * One bounded Stripe read after the credit; never throws, never hangs.
 */

import {
  BOOST_RECEIPT_HARD_LIMIT_MS,
  BOOST_RECEIPT_REQUEST_OPTIONS,
  recordBoostReceipt,
  type BoostReceiptDeps,
} from '@/lib/business-os/boost/boostReceipt';
import { INTENT, PURCHASE } from '@/lib/business-os/boost/__fixtures__/boostWebhookFixtures';

const RECEIPT = 'https://pay.stripe.com/receipts/payment/abc';
const INPUT = { purchaseId: PURCHASE, paymentIntentId: INTENT, eventLivemode: false };

function setup(over: Partial<BoostReceiptDeps> & { retrieve?: jest.Mock; recordStatus?: string; recordError?: Error } = {}) {
  const retrieve = over.retrieve ?? jest.fn(async () => ({ id: INTENT, latest_charge: { id: 'ch_test_1', receipt_url: RECEIPT } }));
  const recordReceipt = jest.fn(async () =>
    over.recordError ? { data: null, error: over.recordError } : { data: { status: (over.recordStatus ?? 'recorded') as never, accountId: null }, error: null }
  );
  const deps: BoostReceiptDeps = {
    stripe: over.stripe ?? (() => ({ paymentIntents: { retrieve } })),
    keyIsLive: over.keyIsLive ?? (() => false),
    purchases: { recordReceipt },
  };
  const log = { info: jest.fn(), warn: jest.fn() };
  return { deps, retrieve, recordReceipt, log };
}

describe('recordBoostReceipt', () => {
  it('C-4: one retrieve, expanding latest_charge, with the bounds as REQUEST options; then recordReceipt once', async () => {
    const t = setup();
    expect(await recordBoostReceipt(INPUT, t.deps, t.log)).toBe('recorded');
    expect(t.retrieve).toHaveBeenCalledTimes(1);
    expect(t.retrieve).toHaveBeenCalledWith(INTENT, { expand: ['latest_charge'] }, { timeout: 5000, maxNetworkRetries: 0 });
    expect(BOOST_RECEIPT_REQUEST_OPTIONS).toEqual({ timeout: 5000, maxNetworkRetries: 0 });
    expect(t.recordReceipt).toHaveBeenCalledWith({ purchaseId: PURCHASE, chargeId: 'ch_test_1', receiptUrl: RECEIPT });
  });

  it('C-4: a retrieve that never answers is abandoned at the hard limit; it never throws or hangs', async () => {
    jest.useFakeTimers();
    try {
      const t = setup({ retrieve: jest.fn(() => new Promise(() => {})) });
      const pending = recordBoostReceipt(INPUT, t.deps, t.log);
      await jest.advanceTimersByTimeAsync(BOOST_RECEIPT_HARD_LIMIT_MS + 1);
      await expect(pending).resolves.toBe('unavailable');
      expect(t.recordReceipt).not.toHaveBeenCalled();
      expect(t.log.warn).toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('a Stripe error → warn with facts only (no message), never throws', async () => {
    const leaky = Object.assign(new Error('No such payment_intent for owner@example.com'), { type: 'StripeInvalidRequestError', requestId: 'req_1', statusCode: 404 });
    const t = setup({ retrieve: jest.fn(async () => Promise.reject(leaky)) });
    await expect(recordBoostReceipt(INPUT, t.deps, t.log)).resolves.toBe('unavailable');
    const logged = JSON.stringify(t.log.warn.mock.calls);
    expect(logged).toContain('req_1');
    expect(logged).not.toContain('owner@example.com');
  });

  it.each([
    ['no charge', { id: INTENT, latest_charge: null }],
    ['a charge id only (not expanded)', { id: INTENT, latest_charge: 'ch_test_1' }],
    ['no receipt link', { id: INTENT, latest_charge: { id: 'ch_test_1', receipt_url: null } }],
    ['a non-https link', { id: INTENT, latest_charge: { id: 'ch_test_1', receipt_url: 'http://x' } }],
    ['a foreign charge id', { id: INTENT, latest_charge: { id: 'in_1', receipt_url: RECEIPT } }],
  ])('%s → warn, nothing stored', async (_name, intent) => {
    const t = setup({ retrieve: jest.fn(async () => intent) });
    expect(await recordBoostReceipt(INPUT, t.deps, t.log)).toBe('unavailable');
    expect(t.recordReceipt).not.toHaveBeenCalled();
  });

  it('the key mode differs from the event (or cannot be told) → skipped, no Stripe call', async () => {
    for (const keyIsLive of [() => true, () => null]) {
      const t = setup({ keyIsLive });
      expect(await recordBoostReceipt(INPUT, t.deps, t.log)).toBe('skipped_mode');
      expect(t.retrieve).not.toHaveBeenCalled();
    }
  });

  it('no Business OS Stripe client → skipped', async () => {
    const t = setup({ stripe: () => null });
    expect(await recordBoostReceipt(INPUT, t.deps, t.log)).toBe('skipped_no_client');
  });

  it.each(['already_recorded', 'conflict', 'not_paid', 'not_found'])('recordReceipt → %s is reported, never thrown', async (status) => {
    const t = setup({ recordStatus: status });
    expect(await recordBoostReceipt(INPUT, t.deps, t.log)).toBe(status);
  });

  it('recordReceipt failing → unavailable, never thrown', async () => {
    const t = setup({ recordError: new Error('db down') });
    expect(await recordBoostReceipt(INPUT, t.deps, t.log)).toBe('unavailable');
  });

  it('a throwing client factory is caught (never thrown)', async () => {
    const t = setup({ stripe: () => { throw new Error('stripe_key_missing'); } });
    await expect(recordBoostReceipt(INPUT, t.deps, t.log)).resolves.toBe('unavailable');
  });
});

describe('R-4: a Stripe error message never reaches the logs', () => {
  it('an error whose message and raw body carry the buyer email → only type, code, request id and status are logged', async () => {
    const leaky = Object.assign(new Error('Invalid request: owner@example.com'), {
      type: 'StripeAPIError',
      code: 'resource_missing',
      requestId: 'req_r4',
      statusCode: 500,
      raw: { message: 'owner@example.com', param: 'receipt_email' },
    });
    const t = setup({ retrieve: jest.fn(async () => Promise.reject(leaky)) });
    await recordBoostReceipt(INPUT, t.deps, t.log);
    const logged = JSON.stringify([...t.log.warn.mock.calls, ...t.log.info.mock.calls]);
    expect(logged).not.toContain('owner@example.com');
    expect(logged).not.toContain('Invalid request');
    expect(logged).toContain('req_r4');
    expect(logged).toContain('resource_missing');
  });
});
