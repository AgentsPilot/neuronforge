/**
 * StripeService — the Business OS immediate cancel and C-11's invoice voids
 * (plan payments P-7a.4; workplan §4.3; SA C-11, TQ-12).
 *
 * What matters:
 *   - the end sends EXACTLY `{ invoice_now: false, prorate: false }` (asserted
 *     as a whole object) with the caller's per-attempt key. In particular NO
 *     `cancellation_details` (comment / feedback): TL, agreed with the deletion
 *     session's SX-2b, which keys off Stripe's own
 *     `cancellation_details.reason = 'cancellation_requested'` (X-4 2026-10-27:
 *     that is what Stripe records for this exact call);
 *   - it returns the mirror's facts from the answer, never the raw object;
 *   - the open-invoice list asks Stripe for THIS subscription's OPEN invoices
 *     only, and reads the subscription from clover's `parent`;
 *   - the void sends no parameters beyond the key.
 *
 * Stripe answers are HAND-BUILT in the shapes X-4 observed on the standard
 * sandbox (2026-10-27).
 */

const mockSubscriptionsCancel = jest.fn();
const mockInvoicesList = jest.fn();
const mockInvoicesVoid = jest.fn();

jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    subscriptions: {
      cancel: (...args: unknown[]) => mockSubscriptionsCancel(...args),
      retrieve: jest.fn(),
      update: jest.fn(),
    },
    invoices: {
      list: (...args: unknown[]) => mockInvoicesList(...args),
      voidInvoice: (...args: unknown[]) => mockInvoicesVoid(...args),
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
const PERIOD_END = 1_795_780_911;
const ENDED = 1_795_870_911;
const KEY = 'bos-plan-manage:sub_1:cancel_now:0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';

beforeEach(() => {
  mockSubscriptionsCancel.mockReset();
  mockInvoicesList.mockReset();
  mockInvoicesVoid.mockReset();
});

describe('cancelBusinessOsSubscriptionNow (TQ-12)', () => {
  it('sends EXACTLY invoice_now false + prorate false, with the key, and NO cancellation_details', async () => {
    mockSubscriptionsCancel.mockResolvedValue({
      id: 'sub_1',
      status: 'canceled',
      customer: 'cus_1',
      livemode: false,
      cancel_at_period_end: false,
      cancel_at: null,
      ended_at: ENDED,
      cancellation_details: { comment: null, feedback: null, reason: 'cancellation_requested' },
      items: { data: [{ id: 'si_1', current_period_end: PERIOD_END }], has_more: false },
      latest_invoice: { id: 'in_1', confirmation_secret: { client_secret: 'never_returned' } },
    });

    const facts = await service().cancelBusinessOsSubscriptionNow('sub_1', { idempotencyKey: KEY });

    expect(mockSubscriptionsCancel).toHaveBeenCalledTimes(1);
    expect(mockSubscriptionsCancel.mock.calls[0]).toEqual(['sub_1', { invoice_now: false, prorate: false }, { idempotencyKey: KEY }]);
    const params = mockSubscriptionsCancel.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(params).sort()).toEqual(['invoice_now', 'prorate']);
    expect(params).not.toHaveProperty('cancellation_details');
    expect(facts).toEqual({
      id: 'sub_1',
      status: 'canceled',
      customerId: 'cus_1',
      livemode: false,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      endedAt: ENDED,
      currentPeriodEnd: PERIOD_END,
    });
    expect(JSON.stringify(facts)).not.toContain('never_returned');
  });

  it('a Stripe error propagates (the engine classifies it)', async () => {
    mockSubscriptionsCancel.mockRejectedValue(Object.assign(new Error('x'), { type: 'StripeConnectionError' }));
    await expect(service().cancelBusinessOsSubscriptionNow('sub_1', { idempotencyKey: KEY })).rejects.toMatchObject({ type: 'StripeConnectionError' });
  });
});

describe('listBusinessOsOpenSubscriptionInvoices (C-11)', () => {
  it('asks for THIS subscription\'s OPEN invoices, one page of 20, and reads the subscription from `parent`', async () => {
    mockInvoicesList.mockResolvedValue({
      data: [
        {
          id: 'in_open',
          status: 'open',
          customer: 'cus_1',
          livemode: false,
          parent: { subscription_details: { subscription: 'sub_1' } },
          hosted_invoice_url: 'https://invoice.stripe.com/i/never_returned',
        },
      ],
      has_more: false,
    });
    const listed = await service().listBusinessOsOpenSubscriptionInvoices('sub_1');
    expect(mockInvoicesList.mock.calls[0]).toEqual([{ subscription: 'sub_1', status: 'open', limit: 20 }]);
    expect(listed).toEqual({ invoices: [{ id: 'in_open', status: 'open', customerId: 'cus_1', subscriptionId: 'sub_1', livemode: false }], hasMore: false });
    expect(JSON.stringify(listed)).not.toContain('never_returned');
  });
});

describe('voidBusinessOsInvoice (C-11)', () => {
  it('voids with no parameters but the key and returns id + status only', async () => {
    mockInvoicesVoid.mockResolvedValue({ id: 'in_open', status: 'void', hosted_invoice_url: 'https://invoice.stripe.com/i/never_returned' });
    const answer = await service().voidBusinessOsInvoice('in_open', { idempotencyKey: 'k1' });
    expect(mockInvoicesVoid.mock.calls[0]).toEqual(['in_open', {}, { idempotencyKey: 'k1' }]);
    expect(answer).toEqual({ id: 'in_open', status: 'void' });
  });
});
