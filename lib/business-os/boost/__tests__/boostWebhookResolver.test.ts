/**
 * The boost resolver and the shared session lookup (credits boost slice 4a;
 * R-6, HP-3, T-4; SA C-8 a, Q-1, Q-3, Q-6).
 */

import type Stripe from 'stripe';

import { createBoostResolver, BoostResolverLookupError } from '@/lib/business-os/boost/boostWebhookResolver';
import {
  boostMetadataDisagrees,
  findBoostPurchaseForSession,
  hasBoostMarker,
  parseBoostSession,
  BOOST_SESSION_EVENT_TYPES,
} from '@/lib/business-os/boost/boostWebhookSession';
import { dispatchBusinessOsEvent, type BusinessOsResolver } from '@/lib/business-os/billing/webhookDispatcher';
import { BoostRepositoryFailure } from '@/lib/repositories/BusinessOsBoostPurchaseRepository';
import {
  OTHER_SESSION,
  PURCHASE,
  SESSION,
  boostEvent,
  boostSession,
  purchaseRow,
} from '@/lib/business-os/boost/__fixtures__/boostWebhookFixtures';
import type { Logger } from '@/lib/logger';

function port(opts: { bySession?: unknown; byId?: unknown; sessionError?: Error; idError?: Error; byIntent?: unknown; intentError?: Error } = {}) {
  return {
    findByPaymentIntentIdForWebhook: jest.fn(async () =>
      opts.intentError ? { data: null, error: opts.intentError } : { data: (opts.byIntent ?? null) as never, error: null }
    ),
    findBySessionIdForWebhook: jest.fn(async () =>
      opts.sessionError ? { data: null, error: opts.sessionError } : { data: (opts.bySession ?? null) as never, error: null }
    ),
    findByIdForWebhook: jest.fn(async () =>
      opts.idError ? { data: null, error: opts.idError } : { data: (opts.byId ?? null) as never, error: null }
    ),
  };
}

const ctx = { log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as Logger };
const transient = new BoostRepositoryFailure('fetch failed', null, false);

describe('boost resolver (R-6)', () => {
  it.each(BOOST_SESSION_EVENT_TYPES)('%s with a row found by session → flow boost, no account in the outcome', async (type) => {
    const purchases = port({ bySession: purchaseRow() });
    const outcome = await createBoostResolver({ purchases }).resolve(boostEvent(type), ctx);
    expect(outcome).toEqual({ kind: 'flow', flow: 'boost', lookupKeys: [] });
    expect(JSON.stringify(outcome)).not.toContain('1111');
    expect(purchases.findBySessionIdForWebhook).toHaveBeenCalledWith(SESSION);
    expect(purchases.findByIdForWebhook).not.toHaveBeenCalled();
  });

  it('a subscription-mode session is the plan resolver\'s: not_business_os, and nothing is read', async () => {
    const purchases = port({ bySession: purchaseRow() });
    const outcome = await createBoostResolver({ purchases }).resolve(boostEvent('checkout.session.completed', { mode: 'subscription' }), ctx);
    expect(outcome).toEqual({ kind: 'not_business_os' });
    expect(purchases.findBySessionIdForWebhook).not.toHaveBeenCalled();
  });

  it.each(['invoice.paid', 'payment_intent.succeeded', 'charge.succeeded', 'customer.subscription.updated'])(
    '%s → not_business_os, nothing read',
    async (type) => {
      const purchases = port({ bySession: purchaseRow() });
      expect(await createBoostResolver({ purchases }).resolve(boostEvent(type), ctx)).toEqual({ kind: 'not_business_os' });
      expect(purchases.findBySessionIdForWebhook).not.toHaveBeenCalled();
    }
  );

  it('a Connect event is not ours even if handed to the resolver directly', async () => {
    const purchases = port({ bySession: purchaseRow() });
    const event = boostEvent('checkout.session.completed', {}, { account: 'acct_1' });
    expect(await createBoostResolver({ purchases }).resolve(event, ctx)).toEqual({ kind: 'not_business_os' });
    expect(purchases.findBySessionIdForWebhook).not.toHaveBeenCalled();
  });

  it('C-8 a: a session-id miss with the marker and a UUID reference falls back to the row by id → flow', async () => {
    const purchases = port({ byId: purchaseRow({ stripeCheckoutSessionId: null }) });
    const outcome = await createBoostResolver({ purchases }).resolve(boostEvent('checkout.session.completed', { id: OTHER_SESSION }), ctx);
    expect(outcome).toEqual({ kind: 'flow', flow: 'boost', lookupKeys: [] });
    expect(purchases.findByIdForWebhook).toHaveBeenCalledWith(PURCHASE);
  });

  it('marker but no row at all → deny metadata_mismatch (alerted by the route), keys only in the detail', async () => {
    const purchases = port();
    const outcome = await createBoostResolver({ purchases }).resolve(boostEvent('checkout.session.completed'), ctx);
    expect(outcome).toMatchObject({ kind: 'deny', reason: 'metadata_mismatch' });
    if (outcome.kind !== 'deny') throw new Error('expected a deny');
    const detail = outcome.detail;
    expect(detail.objectId).toBe(SESSION);
    expect(detail.metadataKeys).toEqual(['package_id', 'package_version', 'product', 'purchase_id']);
    expect(JSON.stringify(outcome)).not.toContain('business_os_boost');
  });

  it('marker with a non-UUID reference → deny, and no second read', async () => {
    const purchases = port();
    const outcome = await createBoostResolver({ purchases }).resolve(boostEvent('checkout.session.completed', { client_reference_id: 'abc' }), ctx);
    expect(outcome).toMatchObject({ kind: 'deny', reason: 'metadata_mismatch' });
    expect(purchases.findByIdForWebhook).not.toHaveBeenCalled();
  });

  it('no row and no marker (an agent-platform boost pack) → not_business_os, no second read', async () => {
    const purchases = port();
    const pack = boostEvent('checkout.session.completed', { metadata: { user_id: 'u', purchase_type: 'boost_pack', credits: '1000' }, client_reference_id: null });
    expect(await createBoostResolver({ purchases }).resolve(pack, ctx)).toEqual({ kind: 'not_business_os' });
    expect(purchases.findByIdForWebhook).not.toHaveBeenCalled();
  });

  it('SA Q-6: a lookup error on either read throws (the claim is released), never a deny', async () => {
    await expect(createBoostResolver({ purchases: port({ sessionError: transient }) }).resolve(boostEvent('checkout.session.completed'), ctx)).rejects.toBeInstanceOf(BoostResolverLookupError);
    await expect(createBoostResolver({ purchases: port({ idError: transient }) }).resolve(boostEvent('checkout.session.completed'), ctx)).rejects.toBeInstanceOf(BoostResolverLookupError);
  });

  it('with the plan resolver: a boost session → boost, a plan invoice → plan; never a conflict', async () => {
    const boost = createBoostResolver({ purchases: port({ bySession: purchaseRow() }) });
    const plan: BusinessOsResolver = {
      flow: 'plan',
      resolve: async (event: Stripe.Event) =>
        event.type === 'invoice.paid' ? { kind: 'flow', flow: 'plan', lookupKeys: ['bos_basic'] } : { kind: 'not_business_os' },
    };
    expect(await dispatchBusinessOsEvent(boostEvent('checkout.session.completed'), ctx, [plan, boost])).toEqual({ kind: 'flow', flow: 'boost', lookupKeys: [] });
    expect(await dispatchBusinessOsEvent(boostEvent('invoice.paid'), ctx, [plan, boost])).toEqual({ kind: 'flow', flow: 'plan', lookupKeys: ['bos_basic'] });
  });
});

describe('the session narrowing and the shared lookup', () => {
  it('parses a paid session into the repository shape (tax from total_details, null → 0)', () => {
    expect(parseBoostSession(boostSession())).toEqual({
      ok: true,
      session: {
        id: SESSION,
        paymentStatus: 'paid',
        paymentIntentId: 'pi_test_boost_1',
        amountSubtotalMinor: 2500,
        amountTaxMinor: 0,
        amountTotalMinor: 2500,
        currency: 'usd',
        clientReferenceId: PURCHASE,
        metadata: { product: 'business_os_boost', purchase_id: PURCHASE, package_id: 'plus', package_version: '1' },
      },
    });
    const parsed = parseBoostSession(boostSession({ total_details: null, payment_intent: { id: 'pi_test_x', object: 'payment_intent' } }));
    expect(parsed.ok && parsed.session.amountTaxMinor).toBe(0);
    expect(parsed.ok && parsed.session.paymentIntentId).toBe('pi_test_x');
  });

  it.each([
    ['a fractional amount', { amount_total: 25.5 }],
    ['a negative amount', { amount_subtotal: -1 }],
    ['an unknown payment status', { payment_status: 'pending' }],
    ['a non-pi intent', { payment_intent: 'ch_1' }],
    ['a non-cs id', { id: 'in_1' }],
    ['subscription mode', { mode: 'subscription' }],
  ])('refuses %s, with paths and codes only (no values)', (_name, patch) => {
    const parsed = parseBoostSession(boostSession(patch));
    expect(parsed.ok).toBe(false);
    expect(JSON.stringify(parsed)).not.toContain('owner@example.com');
  });

  it('marker and disagreement rules (HP-3)', () => {
    expect(hasBoostMarker({ product: 'business_os_boost' })).toBe(true);
    expect(hasBoostMarker({ product: 'business_os_plan' })).toBe(false);
    expect(hasBoostMarker(null)).toBe(false);
    expect(boostMetadataDisagrees({ product: 'business_os_boost', purchase_id: PURCHASE })).toBe(false);
    expect(boostMetadataDisagrees({})).toBe(false);
    expect(boostMetadataDisagrees({ product: 'business_os_plan' })).toBe(true);
    expect(boostMetadataDisagrees({ product: 'business_os_boost', user_id: 'x' })).toBe(true);
    expect(boostMetadataDisagrees({ product: 'business_os_boost', credits: '999999' })).toBe(true);
    expect(boostMetadataDisagrees({ product: 'business_os_boost', user_id: '' })).toBe(false);
  });

  it('a found-by-session row wins; the reference is never consulted then', async () => {
    const purchases = port({ bySession: purchaseRow(), byId: purchaseRow({ id: '55555555-5555-4555-8555-555555555555' }) });
    const found = await findBoostPurchaseForSession({ id: SESSION, clientReferenceId: PURCHASE, metadata: { product: 'business_os_boost' } }, purchases);
    expect(found.kind).toBe('by_session');
    expect(purchases.findByIdForWebhook).not.toHaveBeenCalled();
  });
});

describe('4b.1: refund and dispute events, matched ONLY by our stored payment intent', () => {
  const charge = (over: Record<string, unknown> = {}) =>
    ({ id: 'evt_c', type: 'charge.refunded', livemode: false, data: { object: { id: 'ch_test_1', payment_intent: 'pi_test_boost_1', amount_refunded: 2500, currency: 'usd', ...over } } }) as unknown as Stripe.Event;
  const dispute = (type: string, over: Record<string, unknown> = {}) =>
    ({ id: 'evt_d', type, livemode: false, data: { object: { id: 'dp_test_1', payment_intent: 'pi_test_boost_1', status: 'needs_response', currency: 'usd', ...over } } }) as unknown as Stripe.Event;

  it.each([
    ['charge.refunded', charge()],
    ['charge.dispute.created', dispute('charge.dispute.created')],
    ['charge.dispute.closed', dispute('charge.dispute.closed', { status: 'won' })],
    ['charge.dispute.funds_reinstated', dispute('charge.dispute.funds_reinstated')],
  ])('%s with a purchase holding that payment intent → flow boost (no account in the outcome)', async (_name, event) => {
    const purchases = port({ byIntent: purchaseRow({ status: 'paid', stripePaymentIntentId: 'pi_test_boost_1' }) });
    expect(await createBoostResolver({ purchases }).resolve(event, ctx)).toEqual({ kind: 'flow', flow: 'boost', lookupKeys: [] });
    expect(purchases.findByPaymentIntentIdForWebhook).toHaveBeenCalledWith('pi_test_boost_1');
    expect(purchases.findBySessionIdForWebhook).not.toHaveBeenCalled();
    expect(purchases.findByIdForWebhook).not.toHaveBeenCalled();
  });

  it('a payment intent our table does not hold → not_business_os (the legacy path), never a deny', async () => {
    const purchases = port();
    expect(await createBoostResolver({ purchases }).resolve(charge(), ctx)).toEqual({ kind: 'not_business_os' });
  });

  it('SA Q-2: a charge with no payment intent keeps the legacy path, and nothing is read (no charge-id lookup)', async () => {
    const purchases = port({ byIntent: purchaseRow() });
    for (const event of [charge({ payment_intent: null }), charge({ payment_intent: undefined }), dispute('charge.dispute.created', { payment_intent: null })]) {
      expect(await createBoostResolver({ purchases }).resolve(event, ctx)).toEqual({ kind: 'not_business_os' });
    }
    expect(purchases.findByPaymentIntentIdForWebhook).not.toHaveBeenCalled();
  });

  it('metadata naming a boost, or our purchase id, never matches a charge (4a SA N-1)', async () => {
    const purchases = port();
    const event = charge({ payment_intent: 'pi_test_someone_else', metadata: { product: 'business_os_boost', purchase_id: PURCHASE } });
    expect(await createBoostResolver({ purchases }).resolve(event, ctx)).toEqual({ kind: 'not_business_os' });
    expect(purchases.findByIdForWebhook).not.toHaveBeenCalled();
    expect(purchases.findBySessionIdForWebhook).not.toHaveBeenCalled();
  });

  it('an expanded payment intent object is read by its id', async () => {
    const purchases = port({ byIntent: purchaseRow() });
    await createBoostResolver({ purchases }).resolve(charge({ payment_intent: { id: 'pi_test_boost_1', object: 'payment_intent' } }), ctx);
    expect(purchases.findByPaymentIntentIdForWebhook).toHaveBeenCalledWith('pi_test_boost_1');
  });

  it('a lookup error throws (the claim is released), never a deny', async () => {
    await expect(createBoostResolver({ purchases: port({ intentError: transient }) }).resolve(charge(), ctx)).rejects.toBeInstanceOf(BoostResolverLookupError);
  });

  it('a Connect refund never reaches the resolver (dispatcher), and the resolver itself refuses it too', async () => {
    const purchases = port({ byIntent: purchaseRow() });
    const connect = { ...charge(), account: 'acct_1' } as unknown as Stripe.Event;
    expect(await dispatchBusinessOsEvent(connect, ctx, [createBoostResolver({ purchases })])).toEqual({ kind: 'not_business_os' });
    expect(await createBoostResolver({ purchases }).resolve(connect, ctx)).toEqual({ kind: 'not_business_os' });
    expect(purchases.findByPaymentIntentIdForWebhook).not.toHaveBeenCalled();
  });
});

describe('QA R-2 / R-5: what the charge branch of the resolver never claims', () => {
  it('R-2 (QA4b-L1): a refund for a stuck PENDING purchase (no stored payment intent yet) → not_business_os (legacy); the 4b.2 pass recovers it', async () => {
    // A pending row holds no payment intent, and matching is by stored intent only.
    const pendingRow = purchaseRow({ status: 'pending', stripePaymentIntentId: null });
    const purchases = port();
    (purchases.findByPaymentIntentIdForWebhook as jest.Mock).mockImplementation(async (pi: string) => ({
      data: (pendingRow.stripePaymentIntentId === pi ? pendingRow : null) as never,
      error: null,
    }));
    const event = { id: 'evt_c', type: 'charge.refunded', livemode: false, data: { object: { id: 'ch_test_1', payment_intent: 'pi_test_boost_1', amount_refunded: 2500, currency: 'usd' } } } as unknown as Stripe.Event;
    expect(await createBoostResolver({ purchases }).resolve(event, ctx)).toEqual({ kind: 'not_business_os' });
  });

  it.each(['charge.succeeded', 'charge.dispute.updated', 'charge.refund.updated', 'charge.captured', 'charge.failed'])(
    'R-5: %s → not_business_os with no read at all',
    async (type) => {
      const purchases = port({ byIntent: purchaseRow({ status: 'paid', stripePaymentIntentId: 'pi_test_boost_1' }) });
      const event = { id: 'evt_x', type, livemode: false, data: { object: { id: 'ch_test_1', payment_intent: 'pi_test_boost_1' } } } as unknown as Stripe.Event;
      expect(await createBoostResolver({ purchases }).resolve(event, ctx)).toEqual({ kind: 'not_business_os' });
      expect(purchases.findByPaymentIntentIdForWebhook).not.toHaveBeenCalled();
      expect(purchases.findBySessionIdForWebhook).not.toHaveBeenCalled();
    }
  );
});
