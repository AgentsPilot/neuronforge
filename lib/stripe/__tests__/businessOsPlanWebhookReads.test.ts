/**
 * StripeService — the three Business OS plan webhook READS (plan payments
 * P-3b.2, workplan §3.1, §3.6, §3.7; CF-2 / P-1 SA Q-8).
 *
 * What matters: each method pages to the end (a truncated invoice, a long
 * session or a subscription with many items is read in full), gives up with a
 * throw instead of a partial answer, and makes no write of any kind.
 */

const mockSubscriptionsRetrieve = jest.fn();
const mockSubscriptionItemsList = jest.fn();
const mockInvoiceLines = jest.fn();
const mockSessionLines = jest.fn();

jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    subscriptions: { retrieve: (...args: unknown[]) => mockSubscriptionsRetrieve(...args) },
    subscriptionItems: { list: (...args: unknown[]) => mockSubscriptionItemsList(...args) },
    invoices: { listLineItems: (...args: unknown[]) => mockInvoiceLines(...args) },
    checkout: { sessions: { listLineItems: (...args: unknown[]) => mockSessionLines(...args) } },
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

import { readFileSync } from 'fs';
import { join } from 'path';

import { StripeService } from '@/lib/stripe/StripeService';

const service = () => new StripeService('sk_test_unit');

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_1',
    status: 'active',
    customer: 'cus_1',
    billing_cycle_anchor: 1_790_000_000,
    cancel_at_period_end: false,
    ended_at: null,
    livemode: false,
    metadata: { product: 'business_os_plan' },
    items: { data: [{ id: 'si_1', price: { id: 'price_a' } }], has_more: false },
    ...overrides,
  };
}

beforeEach(() => {
  mockSubscriptionsRetrieve.mockReset();
  mockSubscriptionItemsList.mockReset();
  mockInvoiceLines.mockReset();
  mockSessionLines.mockReset();
});

describe('retrieveBusinessOsSubscription', () => {
  it('maps the §3.7 fields and the embedded item prices', async () => {
    mockSubscriptionsRetrieve.mockResolvedValue(subscription());
    await expect(service().retrieveBusinessOsSubscription('sub_1')).resolves.toEqual({
      id: 'sub_1',
      status: 'active',
      customerId: 'cus_1',
      billingCycleAnchor: 1_790_000_000,
      cancelAtPeriodEnd: false,
      endedAt: null,
      livemode: false,
      metadata: { product: 'business_os_plan' },
      priceIds: ['price_a'],
      // P-7b.1a (§3.3 a): additive fields; the fixture's item carries no period.
      items: [{ id: 'si_1', priceId: 'price_a', currentPeriodStart: null, currentPeriodEnd: null }],
      pendingUpdate: null,
      latestInvoiceId: null,
    });
    expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith('sub_1');
    expect(mockSubscriptionItemsList).not.toHaveBeenCalled();
  });

  it('an expanded customer object gives its id; ended_at is passed through', async () => {
    mockSubscriptionsRetrieve.mockResolvedValue(
      subscription({ customer: { id: 'cus_2' }, status: 'canceled', ended_at: 1_790_500_000 })
    );
    const out = await service().retrieveBusinessOsSubscription('sub_1');
    expect(out.customerId).toBe('cus_2');
    expect(out.endedAt).toBe(1_790_500_000);
    expect(out.status).toBe('canceled');
  });

  it('has_more on the items: every item page is read and the embedded page is not double counted', async () => {
    mockSubscriptionsRetrieve.mockResolvedValue(
      subscription({ items: { data: [{ id: 'si_1', price: { id: 'price_a' } }], has_more: true } })
    );
    mockSubscriptionItemsList
      .mockResolvedValueOnce({ data: [{ id: 'si_1', price: { id: 'price_a' } }, { id: 'si_2', price: { id: 'price_b' } }], has_more: true })
      .mockResolvedValueOnce({ data: [{ id: 'si_3', price: { id: 'price_c' } }], has_more: false });
    const out = await service().retrieveBusinessOsSubscription('sub_1');
    expect(out.priceIds).toEqual(['price_a', 'price_b', 'price_c']);
    // P-7b.1a: `items` is the paged list itself, the embedded page not counted twice.
    expect(out.items.map((item) => item.id)).toEqual(['si_1', 'si_2', 'si_3']);
    expect(mockSubscriptionItemsList.mock.calls).toEqual([
      [{ subscription: 'sub_1', limit: 100 }],
      [{ subscription: 'sub_1', limit: 100, starting_after: 'si_2' }],
    ]);
  });

  it('items that never end within maxPages: throws (never a partial price list)', async () => {
    mockSubscriptionsRetrieve.mockResolvedValue(subscription({ items: { data: [], has_more: true } }));
    mockSubscriptionItemsList.mockResolvedValue({ data: [{ id: 'si_x', price: { id: 'price_x' } }], has_more: true });
    await expect(service().retrieveBusinessOsSubscription('sub_1', { maxPages: 2 })).rejects.toThrow('subscription_items_incomplete');
    expect(mockSubscriptionItemsList).toHaveBeenCalledTimes(2);
  });

  it('a Stripe error propagates (the webhook releases the claim)', async () => {
    mockSubscriptionsRetrieve.mockRejectedValue(new Error('stripe down'));
    await expect(service().retrieveBusinessOsSubscription('sub_1')).rejects.toThrow('stripe down');
  });
});

describe('listInvoiceLinesAll (CF-2)', () => {
  it('pages through every line, 100 per page', async () => {
    mockInvoiceLines
      .mockResolvedValueOnce({ data: [{ id: 'il_1' }, { id: 'il_2' }], has_more: true })
      .mockResolvedValueOnce({ data: [{ id: 'il_3' }], has_more: false });
    const lines = await service().listInvoiceLinesAll('in_1');
    expect(lines.map((l) => l.id)).toEqual(['il_1', 'il_2', 'il_3']);
    expect(mockInvoiceLines.mock.calls).toEqual([
      ['in_1', { limit: 100 }],
      ['in_1', { limit: 100, starting_after: 'il_2' }],
    ]);
  });

  it('throws after maxPages rather than return a truncated list', async () => {
    mockInvoiceLines.mockResolvedValue({ data: [{ id: 'il_x' }], has_more: true });
    await expect(service().listInvoiceLinesAll('in_1', { maxPages: 3 })).rejects.toThrow('invoice_lines_incomplete');
    expect(mockInvoiceLines).toHaveBeenCalledTimes(3);
  });

  it('a Stripe error propagates', async () => {
    mockInvoiceLines.mockRejectedValue(new Error('rate limited'));
    await expect(service().listInvoiceLinesAll('in_1')).rejects.toThrow('rate limited');
  });
});

describe('listCheckoutSessionPriceIds', () => {
  it('returns the distinct price ids over every page; a line without a price adds nothing', async () => {
    mockSessionLines
      .mockResolvedValueOnce({ data: [{ id: 'li_1', price: { id: 'price_a' } }, { id: 'li_2', price: null }], has_more: true })
      .mockResolvedValueOnce({ data: [{ id: 'li_3', price: { id: 'price_a' } }, { id: 'li_4', price: { id: 'price_b' } }], has_more: false });
    await expect(service().listCheckoutSessionPriceIds('cs_test_1')).resolves.toEqual(['price_a', 'price_b']);
    expect(mockSessionLines.mock.calls).toEqual([
      ['cs_test_1', { limit: 100 }],
      ['cs_test_1', { limit: 100, starting_after: 'li_2' }],
    ]);
  });

  it('throws after maxPages', async () => {
    mockSessionLines.mockResolvedValue({ data: [{ id: 'li_x', price: { id: 'price_x' } }], has_more: true });
    await expect(service().listCheckoutSessionPriceIds('cs_test_1', { maxPages: 2 })).rejects.toThrow(
      'checkout_session_items_incomplete'
    );
  });
});

describe('fail closed: a page that says has_more but carries no data (QA hardening)', () => {
  it('subscription items: throws, never a partial price list', async () => {
    mockSubscriptionsRetrieve.mockResolvedValue(subscription({ items: { data: [], has_more: true } }));
    mockSubscriptionItemsList
      .mockResolvedValueOnce({ data: [{ id: 'si_1', price: { id: 'price_a' } }], has_more: true })
      .mockResolvedValueOnce({ data: [], has_more: true });
    await expect(service().retrieveBusinessOsSubscription('sub_1')).rejects.toThrow('subscription_items_incomplete');
    expect(mockSubscriptionItemsList).toHaveBeenCalledTimes(2);
  });

  it('invoice lines: throws, never a truncated list treated as complete', async () => {
    mockInvoiceLines.mockResolvedValueOnce({ data: [], has_more: true });
    await expect(service().listInvoiceLinesAll('in_1')).rejects.toThrow('invoice_lines_incomplete');
    expect(mockInvoiceLines).toHaveBeenCalledTimes(1);
  });

  it('checkout session line items: throws', async () => {
    mockSessionLines
      .mockResolvedValueOnce({ data: [{ id: 'li_1', price: { id: 'price_a' } }], has_more: true })
      .mockResolvedValueOnce({ data: [], has_more: true });
    await expect(service().listCheckoutSessionPriceIds('cs_test_1')).rejects.toThrow('checkout_session_items_incomplete');
  });

  it('an empty LAST page (has_more false) is complete, not an error', async () => {
    mockInvoiceLines.mockResolvedValueOnce({ data: [], has_more: false });
    await expect(service().listInvoiceLinesAll('in_1')).resolves.toEqual([]);
  });
});

describe('source guards', () => {
  const svc = readFileSync(join(process.cwd(), 'lib', 'stripe', 'StripeService.ts'), 'utf8').replace(/\r\n/g, '\n');
  const NAMES = ['retrieveBusinessOsSubscription', 'listInvoiceLinesAll', 'listCheckoutSessionPriceIds'];

  function bodyOf(name: string): string {
    const start = svc.indexOf(`async ${name}(`);
    expect(start).toBeGreaterThan(0);
    return svc.slice(start, svc.indexOf('\n  }\n', start));
  }

  it('the three reads sit after the P-3a methods (outside the user_subscriptions lockdown slice) and take no database client', () => {
    const p3a = svc.indexOf('async expireCheckoutSession(');
    for (const name of NAMES) {
      expect(svc.indexOf(`async ${name}(`)).toBeGreaterThan(p3a);
      expect(bodyOf(name)).not.toMatch(/SupabaseClient|supabase/i);
    }
  });

  it('they only read: no create, update, del, cancel or expire call', () => {
    for (const name of NAMES) {
      expect(bodyOf(name)).not.toMatch(/\.(create|update|del|cancel|expire|pay|finalizeInvoice)\(/);
    }
  });
});
