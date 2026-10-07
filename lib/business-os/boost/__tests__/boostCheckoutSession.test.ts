/**
 * The boost checkout session parameters (credits boost slice 3, workplan §3.3;
 * SA T-4, T-8, T-14, T-15, R-9, C-3, C-5). These are exactly what Stripe
 * receives, so they are pinned field by field.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import {
  BOOST_CHECKOUT_IDEMPOTENCY_PREFIX,
  BOOST_CHECKOUT_TTL_SECONDS,
  buildBoostCheckoutSessionParams,
  createBoostCheckoutSession,
  expireBoostCheckoutSession,
  type BoostSessionPackage,
  type BoostStripeClient,
} from '@/lib/business-os/boost/boostCheckoutSession';
import { BOS_BOOST_PRODUCT_MARKER, BOS_PRODUCT_METADATA_KEY } from '@/lib/business-os/billing/stripeMetadataKeys';

const PLUS: BoostSessionPackage = { id: 'plus', version: 1, priceMinor: 2500, currency: 'USD', labels: { name: { en: 'Plus' } } };
const PURCHASE = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-10-06T12:00:00.000Z');
const RETURN_URL = 'https://app.example.com/business-os?boost=return&session_id={CHECKOUT_SESSION_ID}';

describe('buildBoostCheckoutSessionParams', () => {
  it('is exactly the embedded one-off USD checkout the workplan pins', () => {
    expect(buildBoostCheckoutSessionParams({ pkg: PLUS, purchaseId: PURCHASE, email: 'owner@example.com', returnUrl: RETURN_URL, now: NOW })).toEqual({
      mode: 'payment',
      ui_mode: 'embedded',
      client_reference_id: PURCHASE,
      customer_email: 'owner@example.com',
      line_items: [
        {
          quantity: 1,
          price_data: { currency: 'usd', unit_amount: 2500, tax_behavior: 'exclusive', product_data: { name: 'Plus' } },
        },
      ],
      metadata: { [BOS_PRODUCT_METADATA_KEY]: BOS_BOOST_PRODUCT_MARKER, purchase_id: PURCHASE, package_id: 'plus', package_version: '1' },
      payment_intent_data: {
        receipt_email: 'owner@example.com',
        metadata: { [BOS_PRODUCT_METADATA_KEY]: BOS_BOOST_PRODUCT_MARKER, purchase_id: PURCHASE, package_id: 'plus', package_version: '1' },
      },
      adaptive_pricing: { enabled: false },
      automatic_tax: { enabled: false },
      allow_promotion_codes: false,
      expires_at: Math.floor(NOW.getTime() / 1000) + 1860,
      return_url: RETURN_URL,
    });
  });

  it('the marker is business_os_boost under the product key (the dispatcher cross-check)', () => {
    const params = buildBoostCheckoutSessionParams({ pkg: PLUS, purchaseId: PURCHASE, email: null, returnUrl: RETURN_URL, now: NOW });
    expect(params.metadata?.product).toBe('business_os_boost');
  });

  it('SA C-3: the expiry is 31 minutes out, inside attach\'s 24 h 5 min bound', () => {
    expect(BOOST_CHECKOUT_TTL_SECONDS).toBe(1860);
    const params = buildBoostCheckoutSessionParams({ pkg: PLUS, purchaseId: PURCHASE, email: null, returnUrl: RETURN_URL, now: NOW });
    const ahead = (params.expires_at as number) - NOW.getTime() / 1000;
    expect(ahead).toBeGreaterThan(30 * 60);
    expect(ahead).toBeLessThan(24 * 3600 + 5 * 60);
  });

  it('SA C-5: no email means no customer_email and no receipt_email (never a null)', () => {
    const params = buildBoostCheckoutSessionParams({ pkg: PLUS, purchaseId: PURCHASE, email: null, returnUrl: RETURN_URL, now: NOW });
    expect(params).not.toHaveProperty('customer_email');
    expect(params.payment_intent_data).not.toHaveProperty('receipt_email');
  });

  it('R-9: never a customer; the amount is the catalogue figure, never multiplied', () => {
    const params = buildBoostCheckoutSessionParams({ pkg: { ...PLUS, priceMinor: 999 }, purchaseId: PURCHASE, email: 'a@b.co', returnUrl: RETURN_URL, now: NOW });
    expect(params).not.toHaveProperty('customer');
    expect(params).not.toHaveProperty('customer_creation');
    expect(params.line_items?.[0].price_data?.unit_amount).toBe(999);
  });
});

describe('create and expire', () => {
  it('create passes the idempotency key bos-boost-checkout:<purchase id> (T-4)', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'cs_test_1' });
    const client = { checkout: { sessions: { create, expire: jest.fn() } } } as unknown as BoostStripeClient;
    const params = buildBoostCheckoutSessionParams({ pkg: PLUS, purchaseId: PURCHASE, email: null, returnUrl: RETURN_URL, now: NOW });
    await createBoostCheckoutSession(client, params, PURCHASE);
    expect(create).toHaveBeenCalledWith(params, { idempotencyKey: `${BOOST_CHECKOUT_IDEMPOTENCY_PREFIX}${PURCHASE}` });
    expect(BOOST_CHECKOUT_IDEMPOTENCY_PREFIX).toBe('bos-boost-checkout:');
  });

  it('expire calls checkout.sessions.expire with the session id', async () => {
    const expire = jest.fn().mockResolvedValue({ id: 'cs_test_1', status: 'expired' });
    const client = { checkout: { sessions: { create: jest.fn(), expire } } } as unknown as BoostStripeClient;
    await expireBoostCheckoutSession(client, 'cs_test_1');
    expect(expire).toHaveBeenCalledWith('cs_test_1');
  });
});

describe('source guards (G-5, G-6)', () => {
  const ROOT = process.cwd();
  const boostFiles = ['boostCheckoutSession.ts', 'boostCheckout.ts', 'boostCheckoutDeps.ts', 'boostCheckoutAccess.ts'].map((name) =>
    readFileSync(join(ROOT, 'lib', 'business-os', 'boost', name), 'utf8')
  );

  it('no boost file creates or reuses a Stripe customer, or reaches StripeService or the agent-platform tables', () => {
    for (const text of boostFiles) {
      expect(text).not.toMatch(/customers\.create|businessOsStripeCustomer|StripeService|user_subscriptions|credit_transactions/);
      expect(text).not.toMatch(/\bcustomer:\s/);
    }
  });

  it('no boost file multiplies money by 100 or types a credit figure', () => {
    for (const text of boostFiles) {
      expect(text).not.toMatch(/\*\s*100\b/);
      expect(text).not.toMatch(/\b(?:5000|12500|13750|25000|28750)\b/);
    }
  });

  it('the metadata marker comes from the shared constants, never a literal', () => {
    const session = boostFiles[0];
    expect(session).toContain('BOS_BOOST_PRODUCT_MARKER');
    expect(session).not.toContain("'business_os_boost'");
  });
});
