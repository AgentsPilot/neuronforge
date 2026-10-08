/**
 * StripeService — the four Business OS plan checkout methods (plan payments
 * P-3a, workplan §3.4; SA-P2, SA-P8, SA-P14, SA-P15; CF-4 / C-3; SA C-1, C-2).
 *
 * What matters: the checkout session carries EXACTLY the pinned parameters,
 * its metadata is exactly `product` + `bos_user_id` (never a legacy
 * Pilot-Credit key, never an anchor, trial, proration, promotion, tax or
 * currency parameter), the idempotency key is passed as a request option, and
 * the live-subscription list pages through everything.
 */

const mockSessionsCreate = jest.fn();
const mockSessionsExpire = jest.fn();
const mockPricesList = jest.fn();
const mockSubscriptionsList = jest.fn();

jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    checkout: {
      sessions: {
        create: (...args: unknown[]) => mockSessionsCreate(...args),
        expire: (...args: unknown[]) => mockSessionsExpire(...args),
      },
    },
    prices: { list: (...args: unknown[]) => mockPricesList(...args) },
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

import { readFileSync } from 'fs';
import { join } from 'path';

import { StripeService } from '@/lib/stripe/StripeService';

const USER = '11111111-1111-4111-8111-111111111111';
const service = () => new StripeService('sk_test_unit');

beforeEach(() => {
  mockSessionsCreate.mockReset();
  mockSessionsExpire.mockReset();
  mockPricesList.mockReset();
  mockSubscriptionsList.mockReset();
});

describe('createBusinessOsPlanCheckoutSession', () => {
  const PARAMS = {
    customerId: 'cus_1',
    priceId: 'price_1',
    bosUserId: USER,
    returnUrl: 'https://app.example/test-business-os?checkout={CHECKOUT_SESSION_ID}',
    expiresAt: 1_800_000_000,
    idempotencyKey: `bos-plan-checkout:${USER}:attempt-1`,
  };

  it('sends exactly the pinned parameters and the idempotency key as a request option', async () => {
    mockSessionsCreate.mockResolvedValue({ id: 'cs_test_1', client_secret: 'cs_secret', expires_at: 1_800_000_100, livemode: false });
    await expect(service().createBusinessOsPlanCheckoutSession(PARAMS)).resolves.toEqual({
      sessionId: 'cs_test_1',
      clientSecret: 'cs_secret',
      expiresAt: 1_800_000_100,
      livemode: false,
    });

    expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
    const [params, options] = mockSessionsCreate.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(params).toEqual({
      mode: 'subscription',
      ui_mode: 'embedded',
      return_url: PARAMS.returnUrl,
      redirect_on_completion: 'if_required',
      customer: 'cus_1',
      line_items: [{ price: 'price_1', quantity: 1 }],
      payment_method_types: ['card'],
      adaptive_pricing: { enabled: false },
      expires_at: 1_800_000_000,
      metadata: { product: 'business_os_plan', bos_user_id: USER },
      subscription_data: { metadata: { product: 'business_os_plan', bos_user_id: USER } },
    });
    expect(options).toEqual({ idempotencyKey: PARAMS.idempotencyKey });
  });

  it('never sends a legacy Pilot-Credit key, an anchor, a trial, proration, promotion, tax or currency parameter (CF-4, SA-P2)', async () => {
    mockSessionsCreate.mockResolvedValue({ id: 'cs_test_1', client_secret: 'cs_secret', expires_at: 1, livemode: false });
    // Even if a caller tried to smuggle metadata in, the method takes none.
    await service().createBusinessOsPlanCheckoutSession({ ...PARAMS, metadata: { user_id: 'x', credits: '1' } } as typeof PARAMS);
    const [params] = mockSessionsCreate.mock.calls[0] as [Record<string, unknown>];
    const text = JSON.stringify(params);
    for (const forbidden of ['user_id', 'credits', 'pilot_credits', 'billing_cycle_anchor', 'proration_behavior', 'trial_end', 'trial_period_days', 'allow_promotion_codes', 'automatic_tax', 'currency']) {
      expect(text).not.toContain(`"${forbidden}"`);
    }
    expect(Object.keys((params.metadata as Record<string, string>)).sort()).toEqual(['bos_user_id', 'product']);
  });

  it('a session without a client secret is an error (nobody could pay it)', async () => {
    mockSessionsCreate.mockResolvedValue({ id: 'cs_test_1', client_secret: null, expires_at: 1, livemode: false });
    await expect(service().createBusinessOsPlanCheckoutSession(PARAMS)).rejects.toThrow(/client secret/);
  });

  it('a Stripe error propagates untouched (the caller classifies it)', async () => {
    const stripeError = Object.assign(new Error('No such customer'), { code: 'resource_missing', param: 'customer' });
    mockSessionsCreate.mockRejectedValue(stripeError);
    await expect(service().createBusinessOsPlanCheckoutSession(PARAMS)).rejects.toBe(stripeError);
  });
});

describe('listCustomerSubscriptions (layer 1b, C-2)', () => {
  it('pages through every subscription, status all, 100 per page', async () => {
    mockSubscriptionsList
      .mockResolvedValueOnce({ data: [{ id: 'sub_1', status: 'canceled' }, { id: 'sub_2', status: 'canceled' }], has_more: true })
      .mockResolvedValueOnce({ data: [{ id: 'sub_3', status: 'active' }], has_more: false });
    await expect(service().listCustomerSubscriptions('cus_1')).resolves.toEqual({
      subscriptions: [
        { id: 'sub_1', status: 'canceled' },
        { id: 'sub_2', status: 'canceled' },
        { id: 'sub_3', status: 'active' },
      ],
      complete: true,
    });
    expect(mockSubscriptionsList.mock.calls).toEqual([
      [{ customer: 'cus_1', status: 'all', limit: 100 }],
      [{ customer: 'cus_1', status: 'all', limit: 100, starting_after: 'sub_2' }],
    ]);
  });

  it('stops at maxPages and reports complete: false (the caller fails closed)', async () => {
    mockSubscriptionsList.mockResolvedValue({ data: [{ id: 'sub_x', status: 'canceled' }], has_more: true });
    const result = await service().listCustomerSubscriptions('cus_1', { maxPages: 3 });
    expect(result.complete).toBe(false);
    expect(mockSubscriptionsList).toHaveBeenCalledTimes(3);
  });

  it('an empty customer is one call, complete', async () => {
    mockSubscriptionsList.mockResolvedValue({ data: [], has_more: false });
    await expect(service().listCustomerSubscriptions('cus_1')).resolves.toEqual({ subscriptions: [], complete: true });
  });
});

describe('listPricesByLookupKeys and expireCheckoutSession', () => {
  it('lists by lookup key with NO active filter, so an archived price still surfaces', async () => {
    mockPricesList.mockResolvedValue({ data: [{ id: 'price_1' }] });
    await expect(service().listPricesByLookupKeys(['k1'])).resolves.toEqual([{ id: 'price_1' }]);
    expect(mockPricesList).toHaveBeenCalledWith({ lookup_keys: ['k1'], limit: 10 });
  });

  it('refuses zero or more than ten keys (Stripe limit)', async () => {
    await expect(service().listPricesByLookupKeys([])).rejects.toThrow();
    await expect(service().listPricesByLookupKeys(Array.from({ length: 11 }, (_v, i) => `k${i}`))).rejects.toThrow();
    expect(mockPricesList).not.toHaveBeenCalled();
  });

  it('expires a session by id', async () => {
    mockSessionsExpire.mockResolvedValue({});
    await service().expireCheckoutSession('cs_test_1');
    expect(mockSessionsExpire).toHaveBeenCalledWith('cs_test_1');
  });
});

describe('source guards', () => {
  const svc = readFileSync(join(process.cwd(), 'lib', 'stripe', 'StripeService.ts'), 'utf8');

  it('the plan checkout methods take no database client and sit after createBoostPackCheckout (lockdown slice untouched)', () => {
    const boost = svc.indexOf('async createBoostPackCheckout(');
    for (const name of ['listPricesByLookupKeys', 'listCustomerSubscriptions', 'createBusinessOsPlanCheckoutSession', 'expireCheckoutSession']) {
      const start = svc.indexOf(`async ${name}(`);
      expect(start).toBeGreaterThan(boost);
      expect(svc.slice(start, start + 600)).not.toMatch(/SupabaseClient/);
    }
  });

  it('the metadata comes from the shared Business OS keys only', () => {
    const start = svc.indexOf('async createBusinessOsPlanCheckoutSession(');
    const body = svc.slice(start, svc.indexOf('async expireCheckoutSession(', start));
    expect(body).toContain('[BOS_PRODUCT_METADATA_KEY]: BOS_PLAN_PRODUCT_MARKER');
    expect(body).toContain('[BOS_USER_ID_METADATA_KEY]: bosUserId');
    expect(body).not.toMatch(/['"](user_id|credits|pilot_credits)['"]\s*:/);
    expect(body).not.toMatch(/\buser_id\s*:/);
  });
});
