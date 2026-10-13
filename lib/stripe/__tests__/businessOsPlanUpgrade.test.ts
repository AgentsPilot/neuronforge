/**
 * StripeService — the Business OS plan upgrade methods (plan payments
 * P-7b.1a, workplan §3.3; SA U-1, V-1, V-7, V-8).
 *
 * What matters: the ONE write sends exactly the U-1 parameters (asserted as a
 * whole object, so a `metadata`, `billing_cycle_anchor` or `trial_end` added
 * later fails here) under the U-1 idempotency key; the preview is read-only
 * with the same proration parameters; every method returns facts, never the
 * raw Stripe object; the subscription read gains complete, un-deduplicated
 * items with their period (on clover the period lives on the item).
 *
 * The Stripe answers are HAND-BUILT, labelled as such: the sandbox captures
 * (U-7) wait on experiments E-1 to E-6, which have not run yet.
 */

const mockSubscriptionsRetrieve = jest.fn();
const mockSubscriptionsUpdate = jest.fn();
const mockCreatePreview = jest.fn();
const mockInvoicesRetrieve = jest.fn();
const mockInvoicePaymentsList = jest.fn();

jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    subscriptions: {
      retrieve: (...args: unknown[]) => mockSubscriptionsRetrieve(...args),
      update: (...args: unknown[]) => mockSubscriptionsUpdate(...args),
    },
    subscriptionItems: { list: jest.fn() },
    invoices: {
      createPreview: (...args: unknown[]) => mockCreatePreview(...args),
      retrieve: (...args: unknown[]) => mockInvoicesRetrieve(...args),
    },
    invoicePayments: { list: (...args: unknown[]) => mockInvoicePaymentsList(...args) },
  }))
);

jest.mock('@/lib/logger', () => {
  // One shared logger, exposed as `__logger` so the F-1 tests can read what was logged.
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger, __logger: logger };
});

import { businessOsUpgradeIdempotencyKey, StripeService, upgradePaymentStateOf } from '@/lib/stripe/StripeService';

const sharedLogger = (jest.requireMock('@/lib/logger') as { __logger: Record<string, jest.Mock> }).__logger;
const service = () => new StripeService('sk_test_unit');
const SECRET = 'pi_handbuilt_secret_never_logged';

/** Hand-built: the update's answer with `latest_invoice.confirmation_secret` expanded (shape pending E-1). */
function updated(overrides: Record<string, unknown> = {}, invoice: Record<string, unknown> | null = {}) {
  return {
    id: 'sub_1',
    livemode: false,
    pending_update: null,
    latest_invoice:
      invoice === null
        ? null
        : { id: 'in_up_1', status: 'paid', confirmation_secret: { client_secret: SECRET, type: 'payment_intent' }, ...invoice },
    ...overrides,
  };
}

function payment(status: string, isDefault = true) {
  return { is_default: isDefault, payment: { type: 'payment_intent', payment_intent: { id: 'pi_1', status } } };
}

beforeEach(() => {
  for (const fn of [mockSubscriptionsRetrieve, mockSubscriptionsUpdate, mockCreatePreview, mockInvoicesRetrieve, mockInvoicePaymentsList]) {
    fn.mockReset();
  }
  for (const level of ['info', 'warn', 'error', 'debug']) sharedLogger[level].mockClear();
});

describe('upgradeBusinessOsPlanSubscription (U-1)', () => {
  const params = { subscriptionId: 'sub_1', itemId: 'si_1', priceId: 'price_pro', prorationDate: 1_790_100_000 };

  it('sends EXACTLY the U-1 parameters and key: no metadata, no anchor, no trial end, no new price', async () => {
    mockSubscriptionsUpdate.mockResolvedValue(updated());
    await service().upgradeBusinessOsPlanSubscription(params);
    expect(mockSubscriptionsUpdate).toHaveBeenCalledTimes(1);
    expect(mockSubscriptionsUpdate.mock.calls[0]).toEqual([
      'sub_1',
      {
        items: [{ id: 'si_1', price: 'price_pro' }],
        proration_behavior: 'always_invoice',
        proration_date: 1_790_100_000,
        payment_behavior: 'pending_if_incomplete',
        expand: ['latest_invoice.confirmation_secret'],
      },
      { idempotencyKey: 'bos-upgrade:sub_1:price_pro:1790100000' },
    ]);
    const sent = mockSubscriptionsUpdate.mock.calls[0][1] as Record<string, unknown>;
    for (const forbidden of ['metadata', 'billing_cycle_anchor', 'trial_end', 'price_data', 'cancel_at_period_end']) {
      expect(sent).not.toHaveProperty(forbidden);
    }
    expect((sent.items as Array<Record<string, unknown>>)[0]).not.toHaveProperty('price_data');
  });

  it('the same request builds the same key (a double click replays, never charges twice)', () => {
    expect(businessOsUpgradeIdempotencyKey('sub_1', 'price_pro', 1)).toBe(businessOsUpgradeIdempotencyKey('sub_1', 'price_pro', 1));
    expect(businessOsUpgradeIdempotencyKey('sub_1', 'price_pro', 1)).not.toBe(businessOsUpgradeIdempotencyKey('sub_1', 'price_pro', 2));
  });

  it('paid at once: facts only, `succeeded`, no pending update, no extra read', async () => {
    mockSubscriptionsUpdate.mockResolvedValue(updated());
    const facts = await service().upgradeBusinessOsPlanSubscription(params);
    expect(facts).toEqual({
      subscriptionId: 'sub_1',
      livemode: false,
      pendingUpdate: false,
      pendingUpdateExpiresAt: null,
      invoiceId: 'in_up_1',
      invoiceStatus: 'paid',
      paymentState: 'succeeded',
      confirmationClientSecret: SECRET,
    });
    expect(mockInvoicePaymentsList).not.toHaveBeenCalled();
  });

  it('3-D Secure: pending update + open invoice → one invoicePayments read (pending E-1), `requires_action`', async () => {
    mockSubscriptionsUpdate.mockResolvedValue(
      updated({ pending_update: { expires_at: 1_790_180_000, subscription_items: [{ price: { id: 'price_pro' } }] } }, { status: 'open' })
    );
    mockInvoicePaymentsList.mockResolvedValue({ data: [payment('requires_action')] });
    const facts = await service().upgradeBusinessOsPlanSubscription(params);
    expect(facts).toMatchObject({ pendingUpdate: true, pendingUpdateExpiresAt: 1_790_180_000, invoiceStatus: 'open', paymentState: 'requires_action' });
    expect(mockInvoicePaymentsList).toHaveBeenCalledWith({ invoice: 'in_up_1', limit: 10, expand: ['data.payment.payment_intent'] });
  });

  it('an expanded `payments` list on the invoice is used without the extra read (the other E-1 answer)', async () => {
    mockSubscriptionsUpdate.mockResolvedValue(
      updated({ pending_update: { expires_at: 1, subscription_items: [] } }, { status: 'open', payments: { data: [payment('requires_payment_method')] } })
    );
    const facts = await service().upgradeBusinessOsPlanSubscription(params);
    expect(facts.paymentState).toBe('requires_payment_method');
    expect(mockInvoicePaymentsList).not.toHaveBeenCalled();
  });

  it('SA F-1: no pending update → the payment list is never read, whatever the invoice status', async () => {
    mockSubscriptionsUpdate.mockResolvedValue(updated({}, { status: 'open' }));
    const facts = await service().upgradeBusinessOsPlanSubscription(params);
    expect(facts).toMatchObject({ pendingUpdate: false, invoiceStatus: 'open', paymentState: 'none' });
    expect(mockInvoicePaymentsList).not.toHaveBeenCalled();
  });

  it('SA F-1: the payment read AFTER the write fails → resolves with `none` (never throws); only safe error fields are logged', async () => {
    mockSubscriptionsUpdate.mockResolvedValue(
      updated({ pending_update: { expires_at: 1_790_180_000, subscription_items: [{ price: { id: 'price_pro' } }] } }, { status: 'open' })
    );
    // Hand-built StripeInvalidRequestError that carries the secret, as a Stripe error may carry the PaymentIntent.
    mockInvoicePaymentsList.mockRejectedValue(
      Object.assign(new Error(`No such expand: ${SECRET}`), {
        name: 'StripeInvalidRequestError',
        type: 'StripeInvalidRequestError',
        code: 'parameter_invalid',
        statusCode: 400,
        requestId: 'req_f1',
        raw: { payment_intent: { client_secret: SECRET } },
      })
    );
    const facts = await service().upgradeBusinessOsPlanSubscription(params);
    expect(facts).toMatchObject({ pendingUpdate: true, invoiceId: 'in_up_1', invoiceStatus: 'open', paymentState: 'none' });
    expect(mockInvoicePaymentsList).toHaveBeenCalledTimes(1);
    expect(sharedLogger.warn).toHaveBeenCalledWith(
      {
        event: 'bos_billing_upgrade_payment_read_failed',
        subscriptionId: 'sub_1',
        invoiceId: 'in_up_1',
        stripeError: { name: 'StripeInvalidRequestError', type: 'StripeInvalidRequestError', code: 'parameter_invalid', statusCode: 400, requestId: 'req_f1' },
      },
      expect.any(String)
    );
    for (const level of ['info', 'warn', 'error', 'debug']) {
      expect(JSON.stringify(sharedLogger[level].mock.calls)).not.toContain(SECRET);
    }
  });

  it('a thrown card error propagates (the orchestration maps it, V-7)', async () => {
    mockSubscriptionsUpdate.mockRejectedValue(Object.assign(new Error('Your card was declined.'), { type: 'StripeCardError' }));
    await expect(service().upgradeBusinessOsPlanSubscription(params)).rejects.toMatchObject({ type: 'StripeCardError' });
  });
});

describe('upgradePaymentStateOf (the E-1 seam, pure)', () => {
  it.each([
    ['succeeded', 'succeeded'],
    ['requires_action', 'requires_action'],
    ['requires_payment_method', 'requires_payment_method'],
    ['processing', 'processing'],
    ['requires_capture', 'processing'],
    ['requires_confirmation', 'none'],
    ['canceled', 'none'],
  ])('PaymentIntent %s → %s', (status, expected) => {
    expect(upgradePaymentStateOf([payment(status)] as never)).toBe(expected);
  });

  it('the default payment decides; an unexpanded PaymentIntent or no payment tells nothing', () => {
    expect(upgradePaymentStateOf([payment('requires_payment_method', false), payment('succeeded', true)] as never)).toBe('succeeded');
    expect(upgradePaymentStateOf([{ is_default: true, payment: { type: 'payment_intent', payment_intent: 'pi_1' } }] as never)).toBe('none');
    expect(upgradePaymentStateOf([])).toBe('none');
  });
});

describe('previewBusinessOsPlanUpgrade (read-only)', () => {
  it('sends the preview parameters from our row and the fresh read; returns the amounts only (V-12 tax)', async () => {
    mockCreatePreview.mockResolvedValue({
      amount_due: 2985,
      total: 2985,
      currency: 'USD',
      total_taxes: [{ amount: 0 }],
      lines: { data: [{ id: 'il_1' }] },
      confirmation_secret: { client_secret: SECRET },
    });
    const out = await service().previewBusinessOsPlanUpgrade({
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      itemId: 'si_1',
      priceId: 'price_pro',
      prorationDate: 1_790_100_000,
    });
    expect(mockCreatePreview).toHaveBeenCalledWith({
      customer: 'cus_1',
      subscription: 'sub_1',
      subscription_details: {
        items: [{ id: 'si_1', price: 'price_pro' }],
        proration_behavior: 'always_invoice',
        proration_date: 1_790_100_000,
      },
    });
    expect(out).toEqual({ amountDueMinor: 2985, totalMinor: 2985, taxMinor: 0, currency: 'usd' });
    expect(JSON.stringify(out)).not.toContain(SECRET);
  });

  it('a balance-covered preview (amount due 0, total > 0) is read as such', async () => {
    mockCreatePreview.mockResolvedValue({ amount_due: 0, total: 2985, currency: 'usd', total_taxes: [] });
    await expect(
      service().previewBusinessOsPlanUpgrade({ customerId: 'c', subscriptionId: 's', itemId: 'i', priceId: 'p', prorationDate: 1 })
    ).resolves.toEqual({ amountDueMinor: 0, totalMinor: 2985, taxMinor: 0, currency: 'usd' });
  });

  it('unreadable amounts throw rather than quote a wrong price', async () => {
    mockCreatePreview.mockResolvedValue({ amount_due: null, total: 2985, currency: 'usd' });
    await expect(
      service().previewBusinessOsPlanUpgrade({ customerId: 'c', subscriptionId: 's', itemId: 'i', priceId: 'p', prorationDate: 1 })
    ).rejects.toThrow('upgrade_preview_amounts_unreadable');
  });
});

describe('retrieveBusinessOsUpgradeInvoice (Q-2 resume read)', () => {
  it('reads one invoice with its confirmation secret expanded; facts only', async () => {
    mockInvoicesRetrieve.mockResolvedValue({
      id: 'in_up_1',
      status: 'open',
      billing_reason: 'subscription_update',
      amount_due: 2985,
      livemode: false,
      customer: 'cus_1',
      parent: { subscription_details: { subscription: 'sub_1' } },
      confirmation_secret: { client_secret: SECRET, type: 'payment_intent' },
      payments: { data: [payment('requires_action')] },
      lines: { data: [] },
    });
    await expect(service().retrieveBusinessOsUpgradeInvoice('in_up_1')).resolves.toEqual({
      invoiceId: 'in_up_1',
      subscriptionId: 'sub_1',
      customerId: 'cus_1',
      status: 'open',
      billingReason: 'subscription_update',
      amountDueMinor: 2985,
      livemode: false,
      paymentState: 'requires_action',
      confirmationClientSecret: SECRET,
    });
    expect(mockInvoicesRetrieve).toHaveBeenCalledWith('in_up_1', { expand: ['confirmation_secret'] });
  });
});

describe('retrieveBusinessOsSubscription: the additive upgrade fields (§3.3 a)', () => {
  it('items are NOT de-duplicated and carry the ITEM period (V-8); pending update and latest invoice are read', async () => {
    mockSubscriptionsRetrieve.mockResolvedValue({
      id: 'sub_1',
      status: 'active',
      customer: 'cus_1',
      billing_cycle_anchor: 1_790_000_000,
      cancel_at_period_end: false,
      ended_at: null,
      livemode: false,
      metadata: {},
      items: {
        data: [
          { id: 'si_1', price: { id: 'price_a' }, current_period_start: 1_790_000_000, current_period_end: 1_792_592_000 },
          { id: 'si_2', price: { id: 'price_a' }, current_period_start: 1_790_000_000, current_period_end: 1_792_592_000 },
        ],
        has_more: false,
      },
      pending_update: { expires_at: 1_790_080_000, subscription_items: [{ price: { id: 'price_b' } }] },
      latest_invoice: 'in_up_1',
    });
    const out = await service().retrieveBusinessOsSubscription('sub_1');
    expect(out.priceIds).toEqual(['price_a']);
    expect(out.items).toEqual([
      { id: 'si_1', priceId: 'price_a', currentPeriodStart: 1_790_000_000, currentPeriodEnd: 1_792_592_000 },
      { id: 'si_2', priceId: 'price_a', currentPeriodStart: 1_790_000_000, currentPeriodEnd: 1_792_592_000 },
    ]);
    expect(out.pendingUpdate).toEqual({ expiresAt: 1_790_080_000, priceIds: ['price_b'] });
    expect(out.latestInvoiceId).toBe('in_up_1');
  });
});
