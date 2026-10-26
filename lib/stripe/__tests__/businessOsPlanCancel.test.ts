/**
 * StripeService — the Business OS cancel / reactivate write and the fresh
 * read's `cancelAt` (plan payments P-7a.1; workplan §4.2; SA C-2, C-3, TQ-3).
 *
 * What matters: the ONE write sends exactly `{ cancel_at_period_end }` (asserted
 * as a whole object, so a metadata, anchor or proration key added later fails
 * here), with NO idempotency key (TQ-3); it returns the mirror's facts from the
 * update's own answer, never the raw Stripe object (C-2); and the fresh read
 * reports a `cancel_at` set without the flag (C-3, X-2).
 *
 * Stripe answers are HAND-BUILT in the shapes X-2 observed on the standard
 * sandbox (2026-10-26): the flag set also sets `cancel_at` to the period end.
 */

const mockSubscriptionsRetrieve = jest.fn();
const mockSubscriptionsUpdate = jest.fn();

jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    subscriptions: {
      retrieve: (...args: unknown[]) => mockSubscriptionsRetrieve(...args),
      update: (...args: unknown[]) => mockSubscriptionsUpdate(...args),
    },
    subscriptionItems: { list: jest.fn() },
  }))
);

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

import { StripeService } from '@/lib/stripe/StripeService';

const service = () => new StripeService('sk_test_unit');
const PERIOD_END = 1_795_690_892;

/** Hand-built: the subscription as `subscriptions.update` answers it (X-2 shape). */
function answered(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_1',
    status: 'active',
    customer: 'cus_1',
    livemode: false,
    cancel_at_period_end: true,
    cancel_at: PERIOD_END,
    ended_at: null,
    items: { data: [{ id: 'si_1', current_period_end: PERIOD_END }], has_more: false },
    latest_invoice: { id: 'in_1', confirmation_secret: { client_secret: 'never_returned' } },
    ...overrides,
  };
}

beforeEach(() => {
  mockSubscriptionsRetrieve.mockReset();
  mockSubscriptionsUpdate.mockReset();
});

describe('setBusinessOsCancelAtPeriodEnd (C-2, TQ-3)', () => {
  it('sends EXACTLY the flag, with no idempotency key, and returns the mirror facts', async () => {
    mockSubscriptionsUpdate.mockResolvedValue(answered());
    const facts = await service().setBusinessOsCancelAtPeriodEnd('sub_1', true);

    expect(mockSubscriptionsUpdate).toHaveBeenCalledTimes(1);
    // Two arguments only: the id and the params. No request options, so no idempotency key.
    expect(mockSubscriptionsUpdate.mock.calls[0]).toEqual(['sub_1', { cancel_at_period_end: true }]);
    expect(facts).toEqual({
      id: 'sub_1',
      status: 'active',
      customerId: 'cus_1',
      livemode: false,
      cancelAtPeriodEnd: true,
      cancelAt: PERIOD_END,
      endedAt: null,
      currentPeriodEnd: PERIOD_END,
    });
    // Facts only: nothing of the raw object (an invoice secret) travels.
    expect(JSON.stringify(facts)).not.toContain('never_returned');
  });

  it('reactivate sends false; a cleared `cancel_at` reads null; the latest item end is the period end', async () => {
    mockSubscriptionsUpdate.mockResolvedValue(
      answered({
        cancel_at_period_end: false,
        cancel_at: null,
        customer: { id: 'cus_1' },
        items: { data: [{ id: 'si_1', current_period_end: PERIOD_END - 10 }, { id: 'si_2', current_period_end: PERIOD_END }], has_more: false },
      })
    );
    const facts = await service().setBusinessOsCancelAtPeriodEnd('sub_1', false);
    expect(mockSubscriptionsUpdate.mock.calls[0]).toEqual(['sub_1', { cancel_at_period_end: false }]);
    expect(facts).toMatchObject({ customerId: 'cus_1', cancelAtPeriodEnd: false, cancelAt: null, currentPeriodEnd: PERIOD_END });
  });

  it('a thrown Stripe error propagates (the orchestration classifies it)', async () => {
    const err = Object.assign(new Error('boom'), { type: 'StripeAPIError' });
    mockSubscriptionsUpdate.mockRejectedValue(err);
    await expect(service().setBusinessOsCancelAtPeriodEnd('sub_1', true)).rejects.toBe(err);
  });
});

describe('retrieveBusinessOsSubscription: cancelAt (C-3, X-2)', () => {
  it('reports a `cancel_at` set WITHOUT the flag (the dashboard shape)', async () => {
    mockSubscriptionsRetrieve.mockResolvedValue(answered({ cancel_at_period_end: false, cancel_at: PERIOD_END }));
    const fresh = await service().retrieveBusinessOsSubscription('sub_1');
    expect(fresh.cancelAtPeriodEnd).toBe(false);
    expect(fresh.cancelAt).toBe(PERIOD_END);
  });

  it('no `cancel_at` reads null', async () => {
    mockSubscriptionsRetrieve.mockResolvedValue(answered({ cancel_at_period_end: false, cancel_at: null }));
    expect((await service().retrieveBusinessOsSubscription('sub_1')).cancelAt).toBeNull();
  });
});
