jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import type Stripe from 'stripe';

import {
  BusinessOsHandlerMissingError,
  DEFAULT_RESOLVERS,
  denyLevel,
  dispatchBusinessOsEvent,
  type BusinessOsResolver,
  type DispatchOutcome,
  type ResolverContext,
} from '@/lib/business-os/billing/webhookDispatcher';
import { planResolver } from '@/lib/business-os/billing/planInvoiceResolver';
import type { Logger } from '@/lib/logger';

const error = jest.fn();
const ctx: ResolverContext = { log: { info: jest.fn(), warn: jest.fn(), error } as unknown as Logger };

const platformEvent = { id: 'evt_p', type: 'invoice.paid', livemode: false, data: { object: { id: 'in_1' } } } as unknown as Stripe.Event;
const connectEvent = { ...platformEvent, account: 'acct_1' } as unknown as Stripe.Event;

function resolver(flow: 'plan' | 'boost', outcome: DispatchOutcome | Error): BusinessOsResolver & { resolve: jest.Mock } {
  return {
    flow,
    resolve: jest.fn(() => (outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome))),
  };
}

const FLOW_PLAN: DispatchOutcome = { kind: 'flow', flow: 'plan', lookupKeys: ['k'] };
const FLOW_BOOST: DispatchOutcome = { kind: 'flow', flow: 'boost', lookupKeys: [] };
const NOT_OURS: DispatchOutcome = { kind: 'not_business_os' };
const DENY: DispatchOutcome = {
  kind: 'deny',
  reason: 'unknown_price',
  detail: { eventType: 'invoice.paid', objectId: 'in_1', priceIds: ['p'], lookupKeysMatched: [], metadataKeys: [], livemode: false },
};

beforeEach(() => error.mockReset());

describe('dispatchBusinessOsEvent (SA-P6)', () => {
  it('P-1 registers exactly the plan resolver', () => {
    expect(DEFAULT_RESOLVERS).toEqual([planResolver]);
  });

  it('a Connect event is not Business OS, and no resolver is consulted', async () => {
    const r = resolver('plan', FLOW_PLAN);
    expect(await dispatchBusinessOsEvent(connectEvent, ctx, [r])).toEqual(NOT_OURS);
    expect(r.resolve).not.toHaveBeenCalled();
  });

  it('a Connect event never reaches the default resolvers either', async () => {
    const spy = jest.spyOn(planResolver, 'resolve');
    expect(await dispatchBusinessOsEvent(connectEvent, ctx)).toEqual(NOT_OURS);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('no resolver decides → not Business OS (ungoverned events pass through)', async () => {
    expect(await dispatchBusinessOsEvent(platformEvent, ctx, [resolver('plan', NOT_OURS), resolver('boost', NOT_OURS)])).toEqual(NOT_OURS);
  });

  it('one resolver decides a flow → that flow', async () => {
    expect(await dispatchBusinessOsEvent(platformEvent, ctx, [resolver('plan', FLOW_PLAN), resolver('boost', NOT_OURS)])).toEqual(FLOW_PLAN);
  });

  it('one resolver denies → that deny', async () => {
    expect(await dispatchBusinessOsEvent(platformEvent, ctx, [resolver('plan', DENY)])).toEqual(DENY);
  });

  it.each([
    ['two flows', FLOW_PLAN, FLOW_BOOST],
    ['a flow and a deny', FLOW_BOOST, DENY],
  ])('%s → deny resolver_conflict, logged as an alert', async (_label, a, b) => {
    const out = await dispatchBusinessOsEvent(platformEvent, ctx, [resolver('plan', a), resolver('boost', b)]);
    expect(out).toMatchObject({ kind: 'deny', reason: 'resolver_conflict', detail: { objectId: 'in_1' } });
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'bos_billing_resolver_conflict', alert: true }),
      expect.any(String)
    );
  });

  it('a resolver that throws rejects: "could not tell" is never a deny', async () => {
    await expect(
      dispatchBusinessOsEvent(platformEvent, ctx, [resolver('plan', new Error('stripe down'))])
    ).rejects.toThrow('stripe down');
  });

  it('the default resolvers deny an unknown-price platform invoice (empty P-1 catalog)', async () => {
    const event = {
      id: 'evt_x',
      type: 'invoice.paid',
      livemode: false,
      data: {
        object: {
          id: 'in_x',
          metadata: {},
          parent: null,
          lines: { has_more: false, data: [{ pricing: { price_details: { price: 'price_any' } } }] },
        },
      },
    } as unknown as Stripe.Event;
    expect(await dispatchBusinessOsEvent(event, ctx)).toMatchObject({ kind: 'deny', reason: 'unknown_price' });
  });

  it('outcomes carry no account field (type-level)', () => {
    // @ts-expect-error a flow outcome cannot name a user: accounts come from our billing record (SR-8)
    const withUser: DispatchOutcome = { kind: 'flow', flow: 'plan', lookupKeys: [], userId: 'u' };
    // @ts-expect-error a deny outcome cannot name an account either
    const withAccount: DispatchOutcome = { kind: 'deny', reason: 'unknown_price', detail: DENY.kind === 'deny' ? DENY.detail : undefined!, accountId: 'a' };
    expect([withUser, withAccount]).toHaveLength(2);
  });
});

describe('deny levels', () => {
  it.each([
    ['unknown_price', 'warn'],
    ['no_priced_lines', 'warn'],
    ['legacy_subscription_checkout', 'warn'],
    ['mixed_prices', 'error'],
    ['lines_truncated', 'error'],
    ['metadata_mismatch', 'error'],
    ['resolver_conflict', 'error'],
  ] as const)('%s → %s', (reason, level) => {
    expect(denyLevel(reason)).toBe(level);
  });
});

describe('BusinessOsHandlerMissingError', () => {
  it('names the flow', () => {
    const err = new BusinessOsHandlerMissingError('plan');
    expect(err.flow).toBe('plan');
    expect(err.name).toBe('BusinessOsHandlerMissingError');
    expect(err.message).toContain("'plan'");
  });
});
