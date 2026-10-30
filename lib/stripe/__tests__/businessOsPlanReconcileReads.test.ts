/**
 * StripeService — the two nightly plan reconcile READS (plan payments P-8b.2,
 * workplan §4.2, §5): paged at 100, bounded at 10 pages, `complete: false`
 * instead of a silent partial list, platform account only, no write.
 */

const mockEventsList = jest.fn();
const mockSubscriptionsList = jest.fn();

jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    events: { list: (...args: unknown[]) => mockEventsList(...args) },
    subscriptions: { list: (...args: unknown[]) => mockSubscriptionsList(...args) },
  }))
);

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import { StripeService } from '@/lib/stripe/StripeService';

const service = () => new StripeService('sk_test_unit');
const TYPES = ['invoice.paid', 'customer.subscription.deleted'];

beforeEach(() => {
  mockEventsList.mockReset();
  mockSubscriptionsList.mockReset();
});

describe('listBusinessOsPlanEvents', () => {
  it('lists the given types created since the cutoff, 100 per page, following the cursor to the end', async () => {
    mockEventsList
      .mockResolvedValueOnce({ data: [{ id: 'evt_2' }, { id: 'evt_1' }], has_more: true })
      .mockResolvedValueOnce({ data: [{ id: 'evt_0' }], has_more: false });
    const result = await service().listBusinessOsPlanEvents({ createdGte: 1_790_000_000, types: TYPES });
    expect(result).toEqual({ items: [{ id: 'evt_2' }, { id: 'evt_1' }, { id: 'evt_0' }], complete: true });
    expect(mockEventsList).toHaveBeenNthCalledWith(1, { types: TYPES, created: { gte: 1_790_000_000 }, limit: 100 });
    expect(mockEventsList).toHaveBeenNthCalledWith(2, { types: TYPES, created: { gte: 1_790_000_000 }, limit: 100, starting_after: 'evt_1' });
  });

  it('stops at the page cap with complete: false', async () => {
    mockEventsList.mockResolvedValue({ data: [{ id: 'evt_x' }], has_more: true });
    const result = await service().listBusinessOsPlanEvents({ createdGte: 1, types: TYPES, maxPages: 3 });
    expect(mockEventsList).toHaveBeenCalledTimes(3);
    expect(result.complete).toBe(false);
  });

  it('"more" with an empty page (no cursor) is complete: false, never a loop', async () => {
    mockEventsList.mockResolvedValue({ data: [], has_more: true });
    const result = await service().listBusinessOsPlanEvents({ createdGte: 1, types: TYPES });
    expect(mockEventsList).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ items: [], complete: false });
  });

  it('refuses an empty or oversized type list before calling Stripe', async () => {
    await expect(service().listBusinessOsPlanEvents({ createdGte: 1, types: [] })).rejects.toThrow();
    await expect(service().listBusinessOsPlanEvents({ createdGte: 1, types: new Array(21).fill('invoice.paid') })).rejects.toThrow();
    expect(mockEventsList).not.toHaveBeenCalled();
  });

  it('sends no Stripe-Account option (platform events only, SR-10)', async () => {
    mockEventsList.mockResolvedValue({ data: [], has_more: false });
    await service().listBusinessOsPlanEvents({ createdGte: 1, types: TYPES });
    expect(mockEventsList.mock.calls[0]).toHaveLength(1);
  });
});

describe('listBusinessOsSubscriptionsByPrice', () => {
  const subscription = (id: string) => ({
    id,
    status: 'active',
    customer: { id: 'cus_1' },
    livemode: false,
    cancel_at_period_end: true,
    ended_at: null,
    items: { data: [{ id: 'si_1', price: { id: 'price_a' }, current_period_start: 100, current_period_end: 200 }] },
  });

  it('lists non-cancelled subscriptions on one price (no status filter), mapped to the reconcile facts', async () => {
    mockSubscriptionsList.mockResolvedValueOnce({ data: [subscription('sub_1')], has_more: false });
    const result = await service().listBusinessOsSubscriptionsByPrice('price_a');
    expect(mockSubscriptionsList).toHaveBeenCalledWith({ price: 'price_a', limit: 100 });
    expect(result).toEqual({
      items: [
        {
          id: 'sub_1',
          status: 'active',
          customerId: 'cus_1',
          livemode: false,
          cancelAtPeriodEnd: true,
          cancelAt: null,
          endedAt: null,
          items: [{ id: 'si_1', priceId: 'price_a', currentPeriodStart: 100, currentPeriodEnd: 200 }],
        },
      ],
      complete: true,
    });
  });

  it('follow-ups C-3 (SA W-2): maps `cancel_at` through unixOrNull (a number kept; null and 0 read as null)', async () => {
    for (const [raw, expected] of [
      [200, 200],
      [null, null],
      [0, null],
    ] as const) {
      mockSubscriptionsList.mockResolvedValueOnce({ data: [{ ...subscription('sub_c'), cancel_at: raw }], has_more: false });
      const result = await service().listBusinessOsSubscriptionsByPrice('price_a');
      expect(result.items[0].cancelAt).toBe(expected);
    }
  });

  it('pages with the cursor and stops at the cap with complete: false', async () => {
    mockSubscriptionsList.mockResolvedValue({ data: [subscription('sub_9')], has_more: true });
    const result = await service().listBusinessOsSubscriptionsByPrice('price_a', { maxPages: 2 });
    expect(mockSubscriptionsList).toHaveBeenNthCalledWith(2, { price: 'price_a', limit: 100, starting_after: 'sub_9' });
    expect(result.complete).toBe(false);
    expect(result.items).toHaveLength(2);
  });
});
