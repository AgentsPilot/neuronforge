/**
 * The owner's invoice list mapping (plan payments P-7a.2; workplan §4.5; SA
 * TQ-6; U-10, SR-15).
 */

import { mapPlanInvoices, planInvoiceReason } from '@/lib/business-os/billing/planInvoiceList';
import type { BusinessOsInvoiceListFacts } from '@/lib/stripe/StripeService';

const HOSTED = 'https://invoice.stripe.com/i/acct_1/test_x';
const isHosted = (value: unknown): value is string => typeof value === 'string' && value.startsWith('https://invoice.stripe.com/');

function facts(overrides: Partial<BusinessOsInvoiceListFacts> = {}): BusinessOsInvoiceListFacts {
  return {
    id: 'in_1',
    customerId: 'cus_own',
    livemode: false,
    status: 'paid',
    billingReason: 'subscription_create',
    totalMinor: 7900,
    currency: 'usd',
    created: 1_790_000_000,
    hostedInvoiceUrl: HOSTED,
    invoicePdf: null,
    priceIds: ['price_plan'],
    ...overrides,
  };
}

const context = {
  customerId: 'cus_own',
  livemode: false,
  labelForPriceId: (priceId: string) => (priceId === 'price_plan' ? 'Essentials' : null),
  isHostedInvoiceUrl: isHosted,
};

describe('mapPlanInvoices', () => {
  it('maps a paid first invoice', () => {
    expect(mapPlanInvoices([facts()], context)).toEqual({
      rows: [
        {
          id: 'in_1',
          createdAt: new Date(1_790_000_000 * 1000).toISOString(),
          reason: 'subscription_create',
          planLabel: 'Essentials',
          amountMinor: 7900,
          currency: 'usd',
          status: 'paid',
          hostedInvoiceUrl: HOSTED,
        },
      ],
      dropped: [],
    });
  });

  it('U-10: the voided invoice of a declined upgrade reads "Plan change", Not charged (void), never failed', () => {
    const [row] = mapPlanInvoices([facts({ billingReason: 'subscription_update', status: 'void', totalMinor: 3387 })], context).rows;
    expect(row).toMatchObject({ reason: 'subscription_update', status: 'void', amountMinor: 3387 });
  });

  it.each([
    ['a draft', { status: 'draft' }, 'draft'],
    ['another customer', { customerId: 'cus_other' }, 'other_customer'],
    ['another mode', { livemode: true }, 'other_mode'],
    ['not USD (SR-15)', { currency: 'eur' }, 'not_usd'],
    ['an unknown status', { status: 'weird' }, 'unknown_status'],
    ['no total', { totalMinor: null }, 'unreadable'],
    ['no date', { created: null }, 'unreadable'],
  ] as const)('%s is dropped (%s)', (_label, overrides, reason) => {
    expect(mapPlanInvoices([facts(overrides as Partial<BusinessOsInvoiceListFacts>)], context)).toEqual({ rows: [], dropped: [{ id: 'in_1', reason }] });
  });

  it('a link that is not Stripe\'s hosted invoice page is not shown; the row is', () => {
    const [row] = mapPlanInvoices([facts({ hostedInvoiceUrl: 'https://evil.example/pay' })], context).rows;
    expect(row.hostedInvoiceUrl).toBeNull();
  });

  it('an unknown price has no label; the first known line price names it', () => {
    expect(mapPlanInvoices([facts({ priceIds: ['price_other'] })], context).rows[0].planLabel).toBeNull();
    expect(mapPlanInvoices([facts({ priceIds: ['price_other', 'price_plan'] })], context).rows[0].planLabel).toBe('Essentials');
  });

  it('keeps Stripe\'s order (newest first) and every status a plan invoice can have', () => {
    const rows = mapPlanInvoices(
      [facts({ id: 'in_4', status: 'open' }), facts({ id: 'in_3', status: 'uncollectible' }), facts({ id: 'in_2', status: 'void' }), facts({ id: 'in_1' })],
      context
    ).rows;
    expect(rows.map((r) => `${r.id}:${r.status}`)).toEqual(['in_4:open', 'in_3:uncollectible', 'in_2:void', 'in_1:paid']);
  });
});

describe('planInvoiceReason', () => {
  it.each([
    ['subscription_create', 'subscription_create'],
    ['subscription_cycle', 'subscription_cycle'],
    ['subscription_update', 'subscription_update'],
    ['manual', 'other'],
    [null, 'other'],
  ])('%p → %p', (input, expected) => {
    expect(planInvoiceReason(input)).toBe(expected);
  });
});
