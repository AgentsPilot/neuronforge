/**
 * StripeService — the Business OS portal and invoice reads (plan payments
 * P-7a.2; workplan §4.4, §4.5; SA C-6, TQ-6 to TQ-8).
 *
 * What matters: the portal session names OUR configuration and customer and
 * nothing else (asserted as a whole object, so an added key fails here);
 * `update_card` opens the card flow with an `after_completion` redirect to
 * the same return URL (C-6); the invoice list is ONE call of the caller's
 * limit (TQ-6: no auto-paging); and every method returns facts, never the raw
 * Stripe object.
 *
 * Stripe answers are HAND-BUILT in the shapes seen on the standard sandbox
 * (2026-10-26, X-1 / X-5).
 */

const mockConfigRetrieve = jest.fn();
const mockSessionCreate = jest.fn();
const mockInvoicesList = jest.fn();

jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    billingPortal: {
      configurations: { retrieve: (...args: unknown[]) => mockConfigRetrieve(...args) },
      sessions: { create: (...args: unknown[]) => mockSessionCreate(...args) },
    },
    invoices: { list: (...args: unknown[]) => mockInvoicesList(...args) },
  }))
);

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

import { StripeService } from '@/lib/stripe/StripeService';

const service = () => new StripeService('sk_test_unit');
const RETURN = 'https://app.example.test/business-os/settings?section=plan';

beforeEach(() => {
  mockConfigRetrieve.mockReset();
  mockSessionCreate.mockReset();
  mockInvoicesList.mockReset();
});

describe('retrieveBusinessOsPortalConfiguration', () => {
  it('maps the five feature switches, mode and active flag', async () => {
    mockConfigRetrieve.mockResolvedValue({
      id: 'bpc_1',
      active: true,
      livemode: false,
      is_default: true,
      features: {
        payment_method_update: { enabled: true },
        invoice_history: { enabled: true },
        subscription_cancel: { enabled: false, mode: 'at_period_end' },
        subscription_update: { enabled: false },
        customer_update: { enabled: false, allowed_updates: [] },
      },
    });
    expect(await service().retrieveBusinessOsPortalConfiguration('bpc_1')).toEqual({
      id: 'bpc_1',
      active: true,
      livemode: false,
      features: { payment_method_update: true, invoice_history: true, subscription_cancel: false, subscription_update: false, customer_update: false },
    });
    expect(mockConfigRetrieve).toHaveBeenCalledWith('bpc_1');
  });
});

describe('createBusinessOsPortalSession (C-6, TQ-8)', () => {
  const answer = { id: 'bps_1', url: 'https://billing.stripe.com/p/session/x', customer: 'cus_1', configuration: 'bpc_1', livemode: false, return_url: RETURN };

  it('update card: our configuration and customer, the card flow, redirect back to the same URL — nothing else', async () => {
    mockSessionCreate.mockResolvedValue(answer);
    const facts = await service().createBusinessOsPortalSession({
      customerId: 'cus_1',
      configurationId: 'bpc_1',
      returnUrl: RETURN,
      locale: 'es',
      flow: 'payment_method_update',
    });
    expect(mockSessionCreate).toHaveBeenCalledTimes(1);
    expect(mockSessionCreate.mock.calls[0]).toEqual([
      {
        customer: 'cus_1',
        configuration: 'bpc_1',
        return_url: RETURN,
        locale: 'es',
        flow_data: { type: 'payment_method_update', after_completion: { type: 'redirect', redirect: { return_url: RETURN } } },
      },
    ]);
    expect(facts).toEqual({ url: answer.url, customerId: 'cus_1', configurationId: 'bpc_1', livemode: false });
  });

  it('invoices: the portal home, no flow', async () => {
    mockSessionCreate.mockResolvedValue({ ...answer, configuration: { id: 'bpc_1' } });
    const facts = await service().createBusinessOsPortalSession({
      customerId: 'cus_1',
      configurationId: 'bpc_1',
      returnUrl: RETURN,
      locale: 'auto',
      flow: null,
    });
    expect(mockSessionCreate.mock.calls[0][0]).toEqual({ customer: 'cus_1', configuration: 'bpc_1', return_url: RETURN, locale: 'auto' });
    expect(facts.configurationId).toBe('bpc_1');
  });
});

describe('listBusinessOsInvoices (TQ-6)', () => {
  function stripeInvoice(overrides: Record<string, unknown> = {}) {
    return {
      id: 'in_1',
      customer: 'cus_1',
      livemode: false,
      status: 'paid',
      billing_reason: 'subscription_cycle',
      total: 7900,
      currency: 'usd',
      created: 1_790_000_000,
      hosted_invoice_url: 'https://invoice.stripe.com/i/acct_1/test_x',
      invoice_pdf: 'https://pay.stripe.com/invoice/acct_1/test_x/pdf',
      lines: { data: [{ pricing: { price_details: { price: 'price_1' } } }], has_more: false },
      payment_intent: { client_secret: 'never_returned' },
      ...overrides,
    };
  }

  it('one call for our customer at the caller\'s limit, no paging; facts only', async () => {
    mockInvoicesList.mockResolvedValue({ data: [stripeInvoice(), stripeInvoice({ id: 'in_2', total: -500, customer: { id: 'cus_1' } })], has_more: true });
    const result = await service().listBusinessOsInvoices({ customerId: 'cus_1', limit: 12 });
    expect(mockInvoicesList).toHaveBeenCalledTimes(1);
    expect(mockInvoicesList).toHaveBeenCalledWith({ customer: 'cus_1', limit: 12 });
    expect(result.hasMore).toBe(true);
    expect(result.invoices[0]).toEqual({
      id: 'in_1',
      customerId: 'cus_1',
      livemode: false,
      status: 'paid',
      billingReason: 'subscription_cycle',
      totalMinor: 7900,
      currency: 'usd',
      created: 1_790_000_000,
      hostedInvoiceUrl: 'https://invoice.stripe.com/i/acct_1/test_x',
      invoicePdf: 'https://pay.stripe.com/invoice/acct_1/test_x/pdf',
      priceIds: ['price_1'],
    });
    // A credit is a real invoice; an expanded customer reads as its id.
    expect(result.invoices[1].totalMinor).toBe(-500);
    expect(result.invoices[1].customerId).toBe('cus_1');
    expect(JSON.stringify(result)).not.toContain('never_returned');
  });

  it('clamps the limit to Stripe\'s 1..100', async () => {
    mockInvoicesList.mockResolvedValue({ data: [], has_more: false });
    await service().listBusinessOsInvoices({ customerId: 'cus_1', limit: 500 });
    await service().listBusinessOsInvoices({ customerId: 'cus_1', limit: 0 });
    expect(mockInvoicesList.mock.calls.map((c) => c[0].limit)).toEqual([100, 1]);
  });
});
