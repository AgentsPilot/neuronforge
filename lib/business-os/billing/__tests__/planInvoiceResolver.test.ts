/**
 * Plan resolver on Basil-shaped invoice payloads (PF-9, C-8).
 *
 * The fixtures in `fixtures/stripe/` are currently HAND-BUILT (each says so in
 * `_fixture_source`). `scripts/capture-stripe-billing-fixtures.ts` replaces
 * them with captured test-mode payloads; the price ids then change, which is
 * why the tests read ids from the fixtures instead of hard-coding them.
 */

import fs from 'fs';
import path from 'path';
import type Stripe from 'stripe';

import { createPlanResolver } from '@/lib/business-os/billing/planInvoiceResolver';
import {
  BOS_PLAN_LOOKUP_KEYS,
  createPlanPriceCatalog,
  type KnownPlanPrices,
  type PlanPriceCatalog,
  type PriceLister,
} from '@/lib/business-os/billing/planPriceCatalog';
import type { DispatchOutcome, ResolverContext } from '@/lib/business-os/billing/webhookDispatcher';
import type { Logger } from '@/lib/logger';

const FIXTURES = path.join(__dirname, 'fixtures', 'stripe');
const fixtureNames = fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.json'));

function fixture(name: string): Stripe.Event {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8')) as Stripe.Event;
}

const invoiceOf = (event: Stripe.Event) => event.data.object as Stripe.Invoice;

function linePrices(event: Stripe.Event): string[] {
  return invoiceOf(event).lines.data.map((l) => (l.pricing?.price_details?.price as string));
}

/** A copy of the event with the invoice changed by `edit`. */
function withInvoice(event: Stripe.Event, edit: (invoice: Stripe.Invoice) => void): Stripe.Event {
  const copy = JSON.parse(JSON.stringify(event)) as Stripe.Event;
  edit(invoiceOf(copy));
  return copy;
}

function catalogKnowing(byPriceId: Record<string, string>, fromCache = false): PlanPriceCatalog & { load: jest.Mock } {
  const known: KnownPlanPrices = { byPriceId: new Map(Object.entries(byPriceId)), fromCache };
  return { load: jest.fn(() => Promise.resolve(known)) };
}

const ctx: ResolverContext = { log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as Logger };

async function resolveWith(catalog: PlanPriceCatalog, event: Stripe.Event): Promise<DispatchOutcome> {
  return createPlanResolver({ catalog }).resolve(event, ctx);
}

const reasonOf = (o: DispatchOutcome) => (o.kind === 'deny' ? o.reason : o.kind);

const CREATE = fixture('invoice-paid-subscription-create.json');
const PRORATION = fixture('invoice-paid-proration.json');
const UNKNOWN = fixture('invoice-paid-unknown-price.json');
const FAILED = fixture('invoice-payment-failed.json');
const [PRICE_A] = linePrices(CREATE);
// The proration's other price, whatever order Stripe lists the lines in.
const PRICE_B = linePrices(PRORATION).find((p) => p !== PRICE_A) as string;

describe('fixtures', () => {
  it('the proration fixture charges the subscription-create price and one other', () => {
    expect(linePrices(PRORATION)).toContain(PRICE_A);
    expect(PRICE_B).toBeTruthy();
  });

  // P-3b.2 (SA Q-9, C-6): a HAND-BUILT fixture is written in the SDK's pinned
  // version; a CAPTURED one keeps the version Stripe rendered it in (the
  // sandbox's account default is 2025-09-30.clover), and its source line says so.
  // P-7b.1b (U-7): the P-7b.1 captures add SDK answers to our own calls, which
  // carry no `api_version` and state theirs in `_fixture_api_version` (the
  // pinned 2025-10-29.clover), and events as the standard sandbox renders them
  // (2026-09-30.endive, requirement §9.1.2 F-4).
  it.each(fixtureNames)('%s is labelled with its real API version', (name) => {
    const event = fixture(name) as unknown as { api_version?: string; _fixture_api_version?: string; _fixture_source: string };
    if (event._fixture_source.startsWith('HAND-BUILT')) {
      expect(event.api_version).toBe('2025-10-29.clover');
    } else {
      const version = event.api_version ?? event._fixture_api_version;
      expect(['2025-09-30.clover', '2025-10-29.clover', '2026-09-30.endive']).toContain(version);
      expect(event._fixture_source).toContain(version);
    }
  });

  it.each(fixtureNames)('%s states where it came from (captured, or hand-built)', (name) => {
    const source = (fixture(name) as unknown as { _fixture_source?: string })._fixture_source;
    expect(source).toMatch(/^(HAND-BUILT|CAPTURED)/);
  });
});

describe('planResolver: invoice events', () => {
  it('an unknown price is denied (unknown_price)', async () => {
    const out = await resolveWith(catalogKnowing({ [PRICE_A]: 'probe_a' }), UNKNOWN);
    expect(out).toMatchObject({
      kind: 'deny',
      reason: 'unknown_price',
      detail: { eventType: 'invoice.paid', priceIds: linePrices(UNKNOWN), lookupKeysMatched: [], livemode: false },
    });
  });

  it('every invoice is unknown with the P-1 (empty) catalog', async () => {
    for (const event of [CREATE, PRORATION, UNKNOWN, FAILED]) {
      expect(reasonOf(await resolveWith(catalogKnowing({}), event))).toBe('unknown_price');
    }
  });

  it('the same invoice with a catalog that knows its price is a plan flow', async () => {
    expect(await resolveWith(catalogKnowing({ [PRICE_A]: 'probe_a' }), CREATE)).toEqual({
      kind: 'flow',
      flow: 'plan',
      lookupKeys: ['probe_a'],
    });
  });

  it('a two-line proration invoice with both prices known is a plan flow', async () => {
    const out = await resolveWith(catalogKnowing({ [PRICE_A]: 'probe_a', [PRICE_B]: 'probe_b' }), PRORATION);
    expect(out).toEqual({ kind: 'flow', flow: 'plan', lookupKeys: ['probe_a', 'probe_b'] });
  });

  it('one known and one unknown price is denied (mixed_prices)', async () => {
    const out = await resolveWith(catalogKnowing({ [PRICE_A]: 'probe_a' }), PRORATION);
    expect(out).toMatchObject({ kind: 'deny', reason: 'mixed_prices', detail: { lookupKeysMatched: ['probe_a'] } });
  });

  it.each([
    ['user_id on the invoice', (i: Stripe.Invoice) => { i.metadata = { user_id: 'someone' }; }],
    ['credits on the subscription snapshot', (i: Stripe.Invoice) => { i.parent!.subscription_details!.metadata = { credits: '5000' }; }],
    ['pilot_credits on the invoice', (i: Stripe.Invoice) => { i.metadata = { pilot_credits: '5000' }; }],
    ['another product marker', (i: Stripe.Invoice) => { i.metadata = { product: 'business_os_boost' }; }],
  ])('known price + %s is denied (metadata_mismatch)', async (_label, edit) => {
    const out = await resolveWith(catalogKnowing({ [PRICE_A]: 'probe_a' }), withInvoice(CREATE, edit));
    expect(reasonOf(out)).toBe('metadata_mismatch');
  });

  it('known price + the plan marker and bos_user_id is a plan flow (metadata agrees)', async () => {
    const event = withInvoice(CREATE, (i) => {
      i.parent!.subscription_details!.metadata = { product: 'business_os_plan', bos_user_id: 'u-1' };
    });
    expect(reasonOf(await resolveWith(catalogKnowing({ [PRICE_A]: 'probe_a' }), event))).toBe('flow');
  });

  it.each([
    ['product: business_os_plan', { product: 'business_os_plan' }],
    ['bos_user_id', { bos_user_id: 'u-1' }],
  ])('unknown price + %s is denied (metadata_mismatch)', async (_label, metadata) => {
    const event = withInvoice(UNKNOWN, (i) => { i.metadata = metadata; });
    expect(reasonOf(await resolveWith(catalogKnowing({}), event))).toBe('metadata_mismatch');
  });

  it('the deny detail carries metadata KEYS only, never values', async () => {
    const event = withInvoice(UNKNOWN, (i) => { i.metadata = { user_id: 'victim-user', credits: '5000' }; });
    const out = await resolveWith(catalogKnowing({}), event);
    expect(out.kind === 'deny' && out.detail.metadataKeys).toEqual(['credits', 'user_id']);
    expect(JSON.stringify(out)).not.toContain('victim-user');
  });

  it('lines.has_more is denied (lines_truncated) without reading the catalog', async () => {
    const catalog = catalogKnowing({ [PRICE_A]: 'probe_a' });
    const out = await resolveWith(catalog, withInvoice(CREATE, (i) => { i.lines.has_more = true; }));
    expect(reasonOf(out)).toBe('lines_truncated');
    expect(catalog.load).not.toHaveBeenCalled();
  });

  it('no priced lines is denied (no_priced_lines)', async () => {
    const event = withInvoice(CREATE, (i) => {
      for (const line of i.lines.data) (line as unknown as { pricing: null }).pricing = null;
    });
    expect(reasonOf(await resolveWith(catalogKnowing({}), event))).toBe('no_priced_lines');
  });

  it('invoice.payment_failed with an unknown price is DENIED, not passed to the legacy dunning (SA Q-1)', async () => {
    expect(await resolveWith(catalogKnowing({}), FAILED)).toMatchObject({
      kind: 'deny',
      reason: 'unknown_price',
      detail: { eventType: 'invoice.payment_failed' },
    });
  });

  it('invoice.payment_failed with a known price is a plan flow', async () => {
    const [price] = linePrices(FAILED);
    expect(reasonOf(await resolveWith(catalogKnowing({ [price]: 'probe_b' }), FAILED))).toBe('flow');
  });

  it('a catalog failure propagates: never turned into a deny', async () => {
    const catalog: PlanPriceCatalog = { load: () => Promise.reject(new Error('stripe down')) };
    await expect(resolveWith(catalog, CREATE)).rejects.toThrow('stripe down');
  });
});

describe('planResolver: stale cache (SA P1-C3)', () => {
  it('a price missing from a CACHED map triggers one bypassing reload before denying', async () => {
    const load = jest
      .fn()
      .mockResolvedValueOnce({ byPriceId: new Map(), fromCache: true })
      .mockResolvedValueOnce({ byPriceId: new Map([[PRICE_A, 'probe_a']]), fromCache: false });
    const out = await resolveWith({ load }, CREATE);
    expect(out).toEqual({ kind: 'flow', flow: 'plan', lookupKeys: ['probe_a'] });
    expect(load).toHaveBeenNthCalledWith(1);
    expect(load).toHaveBeenNthCalledWith(2, { bypassCache: true });
  });

  it('still unknown after the reload: denied, and only one reload', async () => {
    const load = jest
      .fn()
      .mockResolvedValueOnce({ byPriceId: new Map(), fromCache: true })
      .mockResolvedValueOnce({ byPriceId: new Map(), fromCache: false });
    expect(reasonOf(await resolveWith({ load }, CREATE))).toBe('unknown_price');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('a fresh (not cached) map is trusted: no reload', async () => {
    const catalog = catalogKnowing({}, false);
    await resolveWith(catalog, CREATE);
    expect(catalog.load).toHaveBeenCalledTimes(1);
  });

  it('a cached map that knows every price is trusted: no reload', async () => {
    const catalog = catalogKnowing({ [PRICE_A]: 'probe_a' }, true);
    expect(reasonOf(await resolveWith(catalog, CREATE))).toBe('flow');
    expect(catalog.load).toHaveBeenCalledTimes(1);
  });
});

describe('planResolver: checkout sessions and other events', () => {
  const sessionEvent = (mode: string): Stripe.Event =>
    ({
      id: 'evt_s',
      type: 'checkout.session.completed',
      livemode: false,
      data: { object: { id: 'cs_1', mode, amount_total: 2000, metadata: { user_id: 'x', credits: '5000' } } },
    }) as unknown as Stripe.Event;

  it('a subscription-mode session is denied (legacy_subscription_checkout), keys only', async () => {
    const out = await resolveWith(catalogKnowing({}), sessionEvent('subscription'));
    expect(out).toMatchObject({
      kind: 'deny',
      reason: 'legacy_subscription_checkout',
      detail: { objectId: 'cs_1', metadataKeys: ['credits', 'user_id'] },
    });
  });

  it('a payment-mode session (boost pack) is not Business OS', async () => {
    expect(await resolveWith(catalogKnowing({}), sessionEvent('payment'))).toEqual({ kind: 'not_business_os' });
  });

  it.each(['customer.subscription.updated', 'invoice.finalized', 'charge.refunded', 'payment_intent.succeeded'])(
    '%s is not governed by the plan resolver',
    async (type) => {
      const catalog = catalogKnowing({});
      const event = { id: 'evt_o', type, livemode: false, data: { object: { id: 'x' } } } as unknown as Stripe.Event;
      expect(await resolveWith(catalog, event)).toEqual({ kind: 'not_business_os' });
      expect(catalog.load).not.toHaveBeenCalled();
    }
  );
});

describe('planResolver on the REAL catalog (P-2b, workplan §3.5)', () => {
  // The catalog is the production one, configured keys included; only Stripe is
  // replaced, by a lister that says which fixture price holds which plan key.
  const [CHEAPER_KEY, DEARER_KEY] = BOS_PLAN_LOOKUP_KEYS;
  const lister: PriceLister = {
    prices: {
      list: jest.fn(() =>
        Promise.resolve({ data: [{ id: PRICE_A, lookup_key: CHEAPER_KEY }, { id: PRICE_B, lookup_key: DEARER_KEY }] })
      ),
    },
  };
  const realCatalog = () => createPlanPriceCatalog({ lookupKeys: BOS_PLAN_LOOKUP_KEYS, stripe: () => lister });

  it('a subscription-create invoice on the cheaper plan price resolves to the plan flow, named by its lookup key', async () => {
    expect(await resolveWith(realCatalog(), CREATE)).toEqual({ kind: 'flow', flow: 'plan', lookupKeys: [CHEAPER_KEY] });
    expect(lister.prices.list).toHaveBeenCalledWith({ lookup_keys: [...BOS_PLAN_LOOKUP_KEYS], limit: 100 });
  });

  it('the upgrade proration (both plan prices) resolves to the plan flow with both keys', async () => {
    expect(await resolveWith(realCatalog(), PRORATION)).toEqual({
      kind: 'flow',
      flow: 'plan',
      lookupKeys: [CHEAPER_KEY, DEARER_KEY].sort(),
    });
  });

  it('a failed payment on a plan price is a plan flow; the no-key price is denied', async () => {
    expect(reasonOf(await resolveWith(realCatalog(), FAILED))).toBe('flow');
    expect(reasonOf(await resolveWith(realCatalog(), UNKNOWN))).toBe('unknown_price');
  });
});

// ── P-3b.2: truncation fetch (CF-2), sessions and subscriptions (workplan §3.6) ──

const SESSION_COMPLETED = fixture('checkout-session-completed-subscription.json');
const SESSION_EXPIRED = fixture('checkout-session-expired-subscription.json');
const SUB_UPDATED = fixture('customer-subscription-updated.json');
const SUB_DELETED = fixture('customer-subscription-deleted.json');

function fakeStripe(overrides: Partial<Record<'lines' | 'sessionPrices' | 'subscription', jest.Mock>> = {}) {
  const reads = {
    listInvoiceLinesAll: overrides.lines ?? jest.fn(),
    listCheckoutSessionPriceIds: overrides.sessionPrices ?? jest.fn(),
    retrieveBusinessOsSubscription: overrides.subscription ?? jest.fn(),
  };
  const factory = jest.fn(() => reads);
  return { reads, factory };
}

function resolverWith(
  catalog: PlanPriceCatalog,
  stripe: ReturnType<typeof fakeStripe>,
  enabled: boolean
): (event: Stripe.Event) => Promise<DispatchOutcome> {
  const resolver = createPlanResolver({
    catalog,
    stripe: stripe.factory as unknown as () => never,
    recognitionEnabled: () => enabled,
  });
  return (event) => resolver.resolve(event, ctx);
}

/** A copy of an event with its object changed by `edit`. */
function withObject<T>(event: Stripe.Event, edit: (object: T) => void): Stripe.Event {
  const copy = JSON.parse(JSON.stringify(event)) as Stripe.Event;
  edit(copy.data.object as unknown as T);
  return copy;
}

const TRUNCATED = withInvoice(CREATE, (i) => {
  i.lines.has_more = true;
});

describe('P-3b.2 switch OFF: every new branch is P-1 exactly, with ZERO Stripe calls (§3.6)', () => {
  const cases: Array<[string, Stripe.Event, string]> = [
    ['a truncated invoice', TRUNCATED, 'lines_truncated'],
    ['a subscription-mode session completed', SESSION_COMPLETED, 'legacy_subscription_checkout'],
    ['a subscription-mode session expired', SESSION_EXPIRED, 'not_business_os'],
    ['a subscription updated', SUB_UPDATED, 'not_business_os'],
    ['a subscription deleted', SUB_DELETED, 'not_business_os'],
    [
      'a subscription whose items are truncated',
      withObject<Stripe.Subscription>(SUB_UPDATED, (s) => {
        s.items.has_more = true;
      }),
      'not_business_os',
    ],
  ];

  it.each(cases)('%s', async (_label, event, expected) => {
    const stripe = fakeStripe();
    const catalog = catalogKnowing({ [PRICE_A]: 'probe_a' });
    const out = await resolverWith(catalog, stripe, false)(event);
    expect(reasonOf(out)).toBe(expected);
    expect(stripe.factory).not.toHaveBeenCalled();
  });

  it('the default switch is the price switch: unset in this suite, so the default resolver makes no Stripe call', async () => {
    const stripe = fakeStripe();
    const resolver = createPlanResolver({
      catalog: catalogKnowing({ [PRICE_A]: 'probe_a' }),
      stripe: stripe.factory as unknown as () => never,
    });
    for (const event of [TRUNCATED, SESSION_COMPLETED, SESSION_EXPIRED, SUB_UPDATED, SUB_DELETED]) {
      await resolver.resolve(event, ctx);
    }
    expect(stripe.factory).not.toHaveBeenCalled();
  });

  it('the subscription-mode session deny is identical to P-1 (detail included)', async () => {
    const out = await resolverWith(catalogKnowing({}), fakeStripe(), false)(SESSION_COMPLETED);
    const session = SESSION_COMPLETED.data.object as Stripe.Checkout.Session;
    expect(out).toEqual({
      kind: 'deny',
      reason: 'legacy_subscription_checkout',
      detail: {
        eventType: 'checkout.session.completed',
        objectId: session.id,
        priceIds: [],
        lookupKeysMatched: [],
        metadataKeys: Object.keys(session.metadata ?? {}).sort(),
        amountPaid: session.amount_total,
        livemode: false,
      },
    });
  });
});

describe('P-3b.2 switch ON: a truncated invoice is read in full (CF-2)', () => {
  it('a truncated recognised invoice is fetched and becomes a plan flow', async () => {
    const all = [...invoiceOf(CREATE).lines.data];
    const stripe = fakeStripe({ lines: jest.fn().mockResolvedValue(all) });
    const out = await resolverWith(catalogKnowing({ [PRICE_A]: 'probe_a' }), stripe, true)(TRUNCATED);
    expect(out).toEqual({ kind: 'flow', flow: 'plan', lookupKeys: ['probe_a'] });
    expect(stripe.reads.listInvoiceLinesAll).toHaveBeenCalledWith(invoiceOf(CREATE).id);
  });

  it('the fetched lines decide: a second, unknown price on page two is mixed_prices', async () => {
    const all = [...invoiceOf(CREATE).lines.data, ...invoiceOf(UNKNOWN).lines.data];
    const stripe = fakeStripe({ lines: jest.fn().mockResolvedValue(all) });
    expect(reasonOf(await resolverWith(catalogKnowing({ [PRICE_A]: 'probe_a' }), stripe, true)(TRUNCATED))).toBe('mixed_prices');
  });

  it('a fetch error throws (the claim is released and Stripe retries), never a deny', async () => {
    const stripe = fakeStripe({ lines: jest.fn().mockRejectedValue(new Error('stripe down')) });
    await expect(resolverWith(catalogKnowing({ [PRICE_A]: 'probe_a' }), stripe, true)(TRUNCATED)).rejects.toThrow('stripe down');
  });

  it('an untruncated invoice is never fetched', async () => {
    const stripe = fakeStripe();
    await resolverWith(catalogKnowing({ [PRICE_A]: 'probe_a' }), stripe, true)(CREATE);
    expect(stripe.factory).not.toHaveBeenCalled();
  });
});

describe('P-3b.2 switch ON: checkout sessions, by their line-item prices (never by metadata)', () => {
  const sessionId = (SESSION_COMPLETED.data.object as Stripe.Checkout.Session).id;

  it.each([
    ['completed', SESSION_COMPLETED],
    ['expired', SESSION_EXPIRED],
  ])('a %s session selling a plan price is a plan flow', async (_label, event) => {
    const stripe = fakeStripe({ sessionPrices: jest.fn().mockResolvedValue([PRICE_A]) });
    expect(await resolverWith(catalogKnowing({ [PRICE_A]: 'probe_a' }), stripe, true)(event)).toEqual({
      kind: 'flow',
      flow: 'plan',
      lookupKeys: ['probe_a'],
    });
    expect(stripe.reads.listCheckoutSessionPriceIds).toHaveBeenCalledWith(sessionId);
  });

  it('unrecognised prices: completed keeps the P-1 deny, expired stays not Business OS, even with plan metadata', async () => {
    const stripe = fakeStripe({ sessionPrices: jest.fn().mockResolvedValue(['price_other']) });
    const resolve = resolverWith(catalogKnowing({ [PRICE_A]: 'probe_a' }), stripe, true);
    expect(reasonOf(await resolve(SESSION_COMPLETED))).toBe('legacy_subscription_checkout');
    expect(reasonOf(await resolve(SESSION_EXPIRED))).toBe('not_business_os');
  });

  it('no priced line items: the unrecognised outcome', async () => {
    const stripe = fakeStripe({ sessionPrices: jest.fn().mockResolvedValue([]) });
    expect(reasonOf(await resolverWith(catalogKnowing({ [PRICE_A]: 'probe_a' }), stripe, true)(SESSION_COMPLETED))).toBe(
      'legacy_subscription_checkout'
    );
  });

  it('a plan price beside another price is mixed_prices', async () => {
    const stripe = fakeStripe({ sessionPrices: jest.fn().mockResolvedValue([PRICE_A, 'price_other']) });
    expect(await resolverWith(catalogKnowing({ [PRICE_A]: 'probe_a' }), stripe, true)(SESSION_COMPLETED)).toMatchObject({
      kind: 'deny',
      reason: 'mixed_prices',
      detail: { objectId: sessionId, priceIds: [PRICE_A, 'price_other'], lookupKeysMatched: ['probe_a'] },
    });
  });

  it('a plan price with legacy Pilot-Credit metadata is metadata_mismatch', async () => {
    const event = withObject<Stripe.Checkout.Session>(SESSION_COMPLETED, (s) => {
      s.metadata = { user_id: 'someone', credits: '5000' };
    });
    const stripe = fakeStripe({ sessionPrices: jest.fn().mockResolvedValue([PRICE_A]) });
    expect(reasonOf(await resolverWith(catalogKnowing({ [PRICE_A]: 'probe_a' }), stripe, true)(event))).toBe('metadata_mismatch');
  });

  it('a payment-mode session (boost pack) is not Business OS, and Stripe is not asked', async () => {
    const event = withObject<Stripe.Checkout.Session>(SESSION_COMPLETED, (s) => {
      s.mode = 'payment';
    });
    const stripe = fakeStripe();
    expect(await resolverWith(catalogKnowing({ [PRICE_A]: 'probe_a' }), stripe, true)(event)).toEqual({ kind: 'not_business_os' });
    expect(stripe.factory).not.toHaveBeenCalled();
  });

  it('a Stripe error throws', async () => {
    const stripe = fakeStripe({ sessionPrices: jest.fn().mockRejectedValue(new Error('rate limited')) });
    await expect(resolverWith(catalogKnowing({}), stripe, true)(SESSION_EXPIRED)).rejects.toThrow('rate limited');
  });
});

describe('P-3b.2 switch ON: subscriptions, by their item prices', () => {
  it.each([
    ['updated', SUB_UPDATED],
    ['deleted', SUB_DELETED],
  ])('a %s subscription on a plan price is a plan flow, read from the embedded items (no Stripe call)', async (_label, event) => {
    const stripe = fakeStripe();
    expect(await resolverWith(catalogKnowing({ [PRICE_A]: 'probe_a' }), stripe, true)(event)).toEqual({
      kind: 'flow',
      flow: 'plan',
      lookupKeys: ['probe_a'],
    });
    expect(stripe.factory).not.toHaveBeenCalled();
  });

  it('an unrecognised price leaves it to the legacy handlers (not Business OS), even with plan metadata', async () => {
    expect(await resolverWith(catalogKnowing({}), fakeStripe(), true)(SUB_UPDATED)).toEqual({ kind: 'not_business_os' });
  });

  it('truncated items: the subscription is read in full', async () => {
    const event = withObject<Stripe.Subscription>(SUB_UPDATED, (s) => {
      s.items.has_more = true;
    });
    const stripe = fakeStripe({ subscription: jest.fn().mockResolvedValue({ priceIds: [PRICE_A, 'price_other'] }) });
    expect(reasonOf(await resolverWith(catalogKnowing({ [PRICE_A]: 'probe_a' }), stripe, true)(event))).toBe('mixed_prices');
    expect(stripe.reads.retrieveBusinessOsSubscription).toHaveBeenCalledWith('sub_probe_1');
  });

  it('a plan price with legacy metadata is metadata_mismatch (the legacy handler never sees it)', async () => {
    const event = withObject<Stripe.Subscription>(SUB_UPDATED, (s) => {
      s.metadata = { user_id: 'someone' };
    });
    expect(reasonOf(await resolverWith(catalogKnowing({ [PRICE_A]: 'probe_a' }), fakeStripe(), true)(event))).toBe(
      'metadata_mismatch'
    );
  });

  it('a Stripe error on the full read throws', async () => {
    const event = withObject<Stripe.Subscription>(SUB_DELETED, (s) => {
      s.items.has_more = true;
    });
    const stripe = fakeStripe({ subscription: jest.fn().mockRejectedValue(new Error('stripe down')) });
    await expect(resolverWith(catalogKnowing({}), stripe, true)(event)).rejects.toThrow('stripe down');
  });

  it('a catalog failure throws (never a deny)', async () => {
    const catalog: PlanPriceCatalog = { load: () => Promise.reject(new Error('catalog down')) };
    await expect(resolverWith(catalog, fakeStripe(), true)(SUB_UPDATED)).rejects.toThrow('catalog down');
  });
});
