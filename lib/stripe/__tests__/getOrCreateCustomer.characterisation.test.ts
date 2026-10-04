/**
 * Characterisation of the agent-platform Stripe customer path (plan payments
 * P-2a, workplan BUSINESS_OS_PLAN_PAYMENTS_P2_WORKPLAN.md §3.6, SA P2-C4).
 *
 * WHY. P-2a splits `StripeService.getOrCreateCustomer` into a shared,
 * Stripe-only `findOrCreatePlatformCustomer` and the agent-platform caller
 * that keeps the `user_subscriptions` seed (Q-T8). The agent platform must not
 * change. This suite was recorded on the UNMODIFIED file first, and the
 * snapshot must stay byte-identical after the split and again after the Pino
 * conversion (the SHA-256 of the snapshot file is in the workplan's evidence
 * log for all three points).
 *
 * WHAT IS RECORDED. Only the Stripe calls and the Supabase calls, in order,
 * with their arguments, plus each scenario's result or rejection. The logger
 * is mocked and `console` is silenced and NOT recorded, so the logging change
 * (P2-C5) cannot move the snapshot.
 */

type Call = { target: string; method: string; args: unknown[] };

const mockCalls: Call[] = [];
const mockStripeBehaviour: {
  retrieve: (id: string) => Promise<unknown>;
  create: (params: unknown, options?: unknown) => Promise<unknown>;
} = {
  retrieve: async (id: string) => ({ id, object: 'customer', livemode: false }),
  create: async () => ({ id: 'cus_new', object: 'customer', livemode: false }),
};

jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    customers: {
      retrieve: (...args: unknown[]) => {
        mockCalls.push({ target: 'stripe', method: 'customers.retrieve', args });
        return mockStripeBehaviour.retrieve(args[0] as string);
      },
      create: (...args: unknown[]) => {
        mockCalls.push({ target: 'stripe', method: 'customers.create', args });
        return mockStripeBehaviour.create(args[0], args[1]);
      },
    },
    checkout: {
      sessions: {
        create: (...args: unknown[]) => {
          mockCalls.push({ target: 'stripe', method: 'checkout.sessions.create', args });
          const params = args[0] as { customer: string };
          return Promise.resolve({ id: 'cs_test_1', customer: params.customer });
        },
      },
    },
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

import type { SupabaseClient } from '@supabase/supabase-js';
import { StripeService } from '@/lib/stripe/StripeService';

const USER = '11111111-1111-4111-8111-111111111111';

/**
 * A Supabase double. Each `.single()` (and each awaited write) answers the
 * next item of `answers`, in order; every call is recorded.
 */
function supabaseDouble(answers: Array<{ data: unknown; error: unknown }>): SupabaseClient {
  let next = 0;
  const answer = () => answers[next++] ?? { data: null, error: null };
  return {
    from: (table: string) => {
      mockCalls.push({ target: 'supabase', method: 'from', args: [table] });
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'update', 'insert']) {
        builder[method] = (...args: unknown[]) => {
          mockCalls.push({ target: 'supabase', method, args });
          return builder;
        };
      }
      builder.single = () => {
        mockCalls.push({ target: 'supabase', method: 'single', args: [] });
        return Promise.resolve(answer());
      };
      builder.then = (resolve: (value: unknown) => void) => resolve(answer());
      return builder;
    },
  } as unknown as SupabaseClient;
}

async function run(scenario: () => Promise<unknown>): Promise<{ calls: Call[]; outcome: unknown }> {
  mockCalls.length = 0;
  let outcome: unknown;
  try {
    outcome = { resolved: await scenario() };
  } catch (err) {
    outcome = { rejected: err instanceof Error ? err.message : String(err) };
  }
  return { calls: [...mockCalls], outcome };
}

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  mockStripeBehaviour.retrieve = async (id: string) => ({ id, object: 'customer', livemode: false });
  mockStripeBehaviour.create = async () => ({ id: 'cus_new', object: 'customer', livemode: false });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('getOrCreateCustomer: agent-platform behaviour (recorded before the Q-T8 split)', () => {
  const service = () => new StripeService('sk_test_characterisation');

  it('1. a row with a valid customer: retrieve, then return it', async () => {
    const supabase = supabaseDouble([{ data: { stripe_customer_id: 'cus_existing' }, error: null }]);
    expect(await run(() => service().getOrCreateCustomer(supabase, USER, 'a@example.com', 'Ann'))).toMatchSnapshot();
  });

  it('2. a row whose retrieve throws: create with metadata.user_id, then UPDATE', async () => {
    mockStripeBehaviour.retrieve = async () => {
      throw new Error('No such customer');
    };
    const supabase = supabaseDouble([
      { data: { stripe_customer_id: 'cus_gone' }, error: null },
      { data: { id: 'sub-row-1' }, error: null },
      { data: null, error: null },
    ]);
    expect(await run(() => service().getOrCreateCustomer(supabase, USER, 'a@example.com', 'Ann'))).toMatchSnapshot();
  });

  it('3. a row whose customer is deleted at Stripe: reused (the kept quirk, Q-6)', async () => {
    mockStripeBehaviour.retrieve = async (id: string) => ({ id, object: 'customer', deleted: true });
    const supabase = supabaseDouble([{ data: { stripe_customer_id: 'cus_deleted' }, error: null }]);
    expect(await run(() => service().getOrCreateCustomer(supabase, USER, 'a@example.com', 'Ann'))).toMatchSnapshot();
  });

  it('4. no row: create, then INSERT with the hard-coded seed', async () => {
    const supabase = supabaseDouble([
      { data: null, error: { code: 'PGRST116' } },
      { data: null, error: { code: 'PGRST116' } },
      { data: null, error: null },
    ]);
    expect(await run(() => service().getOrCreateCustomer(supabase, USER, 'a@example.com'))).toMatchSnapshot();
  });

  it('5. a row with a null customer id: create, then UPDATE', async () => {
    const supabase = supabaseDouble([
      { data: { stripe_customer_id: null }, error: null },
      { data: { id: 'sub-row-1' }, error: null },
      { data: null, error: null },
    ]);
    expect(await run(() => service().getOrCreateCustomer(supabase, USER, 'a@example.com', 'Ann'))).toMatchSnapshot();
  });

  it('6. a Stripe create error: rejects, and nothing is written', async () => {
    mockStripeBehaviour.create = async () => {
      throw new Error('stripe create failed');
    };
    const supabase = supabaseDouble([{ data: null, error: { code: 'PGRST116' } }]);
    expect(await run(() => service().getOrCreateCustomer(supabase, USER, 'a@example.com', 'Ann'))).toMatchSnapshot();
  });

  it('7. createBoostPackCheckout end to end: the same customer id lands on the session', async () => {
    const supabase = supabaseDouble([
      {
        data: { id: 'pack-1', pack_name: 'Boost', price_usd: 10, credits_amount: 1000, bonus_credits: 100 },
        error: null,
      },
      { data: { stripe_customer_id: 'cus_existing' }, error: null },
    ]);
    const result = await run(() =>
      service().createBoostPackCheckout({
        supabase,
        userId: USER,
        email: 'a@example.com',
        name: 'Ann',
        boostPackId: 'pack-1',
        successUrl: 'https://example.com/ok',
        cancelUrl: 'https://example.com/cancel',
      })
    );
    expect(result).toMatchSnapshot();
  });
});
