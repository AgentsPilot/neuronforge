/**
 * BusinessOsBillingAccountRepository: the D4b plan-ends reminder record
 * (account deletion lifecycle SX-3 part 2; workplan
 * BUSINESS_OS_D4_PLAN_CANCEL_EMAILS_WORKPLAN.md §3.4, §3.5, D4b addendum;
 * SA S-3, S-12, DR-2, DR-3, DR-13, R-C, R-D; durable-queue-drain;
 * tenant-isolation-guard Step 6).
 *
 * What matters: the claim is ONE rpc with bounded arguments and a strictly
 * mapped answer; complete and release are a compare-and-set on the row id,
 * THIS runner, and the row's own user_id and livemode, so a lost lease writes
 * nothing; the covered mark is user-scoped and only marks a row still set to
 * end at that period end; no write names `updated_at`; nothing is thrown.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));
const mockError = jest.fn();
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {
      info: jest.fn(),
      warn: jest.fn(),
      error: (...args: unknown[]) => mockError(...args),
      debug: jest.fn(),
    };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import {
  BOS_BILLING_ACCOUNTS_TABLE,
  BusinessOsBillingAccountRepository,
  CLAIM_CANCEL_REMINDERS_RPC,
} from '@/lib/repositories/BusinessOsBillingAccountRepository';

const USER = '11111111-1111-4111-8111-111111111111';
const ROW_ID = '22222222-2222-4222-8222-222222222222';
const RUNNER = '33333333-3333-4333-8333-333333333333';
const PERIOD_END = '2026-11-01T07:05:22.000Z';

type Call = { method: string; args: unknown[] };
type Answer = { data: unknown; error: unknown; count?: number | null };

/** Records every from() query and every rpc() call. */
function recordingClient(respond: (calls: Call[]) => Answer) {
  const queries: Call[][] = [];
  const rpcs: Array<{ name: string; args: unknown }> = [];
  let rpcAnswer: Answer = { data: [], error: null };
  const client = {
    from: (table: string) => {
      const calls: Call[] = [{ method: 'from', args: [table] }];
      queries.push(calls);
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'is', 'or', 'insert', 'update', 'upsert', 'delete']) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ method, args });
          return builder;
        };
      }
      builder.then = (resolve: (value: Answer) => unknown, reject: (reason: unknown) => unknown) => {
        calls.push({ method: 'await', args: [] });
        return Promise.resolve(respond(calls)).then(resolve, reject);
      };
      return builder;
    },
    rpc: (name: string, args: unknown) => {
      rpcs.push({ name, args });
      return Promise.resolve(rpcAnswer);
    },
  } as unknown as SupabaseClient;
  return {
    client,
    queries,
    rpcs,
    answerRpc: (answer: Answer) => {
      rpcAnswer = answer;
    },
  };
}

const argsOf = (calls: Call[], method: string) => calls.filter((c) => c.method === method).map((c) => c.args);

function claimRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    reminder_row_id: ROW_ID,
    reminder_user_id: USER,
    reminder_livemode: false,
    reminder_subscription_id: 'sub_reminder1',
    reminder_customer_id: 'cus_reminder1',
    // PostgREST prints the offset form; the repository returns the canonical ISO form.
    reminder_period_end: '2026-11-01T07:05:22+00:00',
    reminder_sent_for: null,
    ...overrides,
  };
}

const CLAIM_INPUT = { runnerId: RUNNER, livemode: false, windowSeconds: 259_200, leaseSeconds: 90, batch: 25 };

beforeEach(() => {
  mockError.mockReset();
});

describe('claimCancelReminders (⟨unscoped-by-design⟩, one rpc)', () => {
  it('calls the claim rpc once with exactly the five arguments, and maps each row to the canonical form', async () => {
    const h = recordingClient(() => ({ data: null, error: null }));
    h.answerRpc({ data: [claimRow(), claimRow({ reminder_row_id: '44444444-4444-4444-8444-444444444444', reminder_sent_for: '2026-08-01T07:05:22+00:00' })], error: null });
    const result = await new BusinessOsBillingAccountRepository(h.client).claimCancelReminders(CLAIM_INPUT);
    expect(h.rpcs).toEqual([
      {
        name: 'claim_bos_plan_cancel_reminders',
        args: { p_runner: RUNNER, p_livemode: false, p_window_seconds: 259_200, p_lease_seconds: 90, p_batch: 25 },
      },
    ]);
    expect(CLAIM_CANCEL_REMINDERS_RPC).toBe('claim_bos_plan_cancel_reminders');
    expect(h.queries).toEqual([]);
    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      {
        id: ROW_ID,
        userId: USER,
        livemode: false,
        stripeSubscriptionId: 'sub_reminder1',
        stripeCustomerId: 'cus_reminder1',
        currentPeriodEnd: PERIOD_END,
        cancelReminderSentFor: null,
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        userId: USER,
        livemode: false,
        stripeSubscriptionId: 'sub_reminder1',
        stripeCustomerId: 'cus_reminder1',
        currentPeriodEnd: PERIOD_END,
        cancelReminderSentFor: '2026-08-01T07:05:22.000Z',
      },
    ]);
  });

  it('no rows (null or empty) → an empty list', async () => {
    for (const data of [null, []]) {
      const h = recordingClient(() => ({ data: null, error: null }));
      h.answerRpc({ data, error: null });
      expect(await new BusinessOsBillingAccountRepository(h.client).claimCancelReminders(CLAIM_INPUT)).toEqual({ data: [], error: null });
    }
  });

  it('an rpc error (the function is missing before 20261100 is applied) is returned, never thrown', async () => {
    const h = recordingClient(() => ({ data: null, error: null }));
    h.answerRpc({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    const result = await new BusinessOsBillingAccountRepository(h.client).claimCancelReminders(CLAIM_INPUT);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('Could not find the function');
    expect(mockError).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a row with no account', { reminder_user_id: null }],
    ['a row with a malformed subscription id', { reminder_subscription_id: 'sub_a,user_id.neq.x' }],
    ['a row with a malformed customer id', { reminder_customer_id: 'acct_1' }],
    ['a row with an unreadable period end', { reminder_period_end: 'soon' }],
    ['a row in the other mode', { reminder_livemode: true }],
  ])('%s → an error, never a guessed row', async (_label, overrides) => {
    const h = recordingClient(() => ({ data: null, error: null }));
    h.answerRpc({ data: [claimRow(overrides)], error: null });
    const result = await new BusinessOsBillingAccountRepository(h.client).claimCancelReminders(CLAIM_INPUT);
    expect(result.data).toBeNull();
    expect(result.error).not.toBeNull();
  });

  it('more rows than the batch → an error', async () => {
    const h = recordingClient(() => ({ data: null, error: null }));
    h.answerRpc({ data: [claimRow(), claimRow()], error: null });
    const result = await new BusinessOsBillingAccountRepository(h.client).claimCancelReminders({ ...CLAIM_INPUT, batch: 1 });
    expect(result.error?.message).toBe('unexpected_claim');
  });

  it.each([
    ['a non-uuid runner', { runnerId: 'runner' }],
    ['a non-boolean mode', { livemode: 'false' as unknown as boolean }],
    ['a zero window', { windowSeconds: 0 }],
    ['a window over 10 days', { windowSeconds: 864_001 }],
    ['a fractional lease', { leaseSeconds: 1.5 }],
    ['a lease over an hour', { leaseSeconds: 3_601 }],
    ['a zero batch', { batch: 0 }],
    ['a batch over 100', { batch: 101 }],
  ])('refuses %s before calling', async (_label, overrides) => {
    const h = recordingClient(() => ({ data: null, error: null }));
    const result = await new BusinessOsBillingAccountRepository(h.client).claimCancelReminders({ ...CLAIM_INPUT, ...overrides });
    expect(result.error?.message).toBe('invalid_input');
    expect(h.rpcs).toEqual([]);
  });
});

describe.each([
  [
    'completeCancelReminder',
    { id: ROW_ID, userId: USER, livemode: false, runnerId: RUNNER, periodEnd: PERIOD_END },
    { cancel_reminder_sent_for: PERIOD_END, cancel_reminder_claimed_by: null, cancel_reminder_claimed_at: null },
    'completed',
  ],
  [
    'releaseCancelReminder',
    { id: ROW_ID, userId: USER, livemode: false, runnerId: RUNNER },
    { cancel_reminder_claimed_by: null, cancel_reminder_claimed_at: null },
    'released',
  ],
] as const)('%s (⟨unscoped-by-design⟩, compare-and-set on the row, the runner, its user and mode)', (method, input, patch, flag) => {
  const call = (client: SupabaseClient, args: Record<string, unknown> = input) =>
    (new BusinessOsBillingAccountRepository(client)[method] as (a: Record<string, unknown>) => Promise<{ data: unknown; error: Error | null }>)(args);

  it('writes exactly the reminder columns, never updated_at, CAS on id + runner + user_id + livemode, count exact, no select, no or', async () => {
    const h = recordingClient(() => ({ data: null, error: null, count: 1 }));
    expect(await call(h.client)).toEqual({ data: { [flag]: true }, error: null });
    expect(h.queries).toHaveLength(1);
    expect(h.queries[0][0]).toEqual({ method: 'from', args: [BOS_BILLING_ACCOUNTS_TABLE] });
    expect(argsOf(h.queries[0], 'update')).toEqual([[patch, { count: 'exact' }]]);
    expect(Object.keys(argsOf(h.queries[0], 'update')[0][0] as object)).not.toContain('updated_at');
    expect(argsOf(h.queries[0], 'eq')).toEqual([
      ['id', ROW_ID],
      ['user_id', USER],
      ['livemode', false],
      ['cancel_reminder_claimed_by', RUNNER],
    ]);
    expect(argsOf(h.queries[0], 'select')).toEqual([]);
    expect(argsOf(h.queries[0], 'or')).toEqual([]);
  });

  it('a lost lease (count 0) writes nothing and says so', async () => {
    const h = recordingClient(() => ({ data: null, error: null, count: 0 }));
    expect(await call(h.client)).toEqual({ data: { [flag]: false }, error: null });
  });

  it('an impossible count is an error; a database error is returned, never thrown', async () => {
    const many = recordingClient(() => ({ data: null, error: null, count: 2 }));
    expect((await call(many.client)).error?.message).toBe('unexpected_update_count');
    const down = recordingClient(() => ({ data: null, error: { message: 'down' }, count: null }));
    const result = await call(down.client);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('down');
  });

  it.each([
    ['a non-uuid row id', { id: 'x' }],
    ['a non-uuid account', { userId: 'x' }],
    ['a non-boolean mode', { livemode: 1 }],
    ['a non-uuid runner', { runnerId: 'x' }],
  ])('refuses %s before querying', async (_label, overrides) => {
    const h = recordingClient(() => ({ data: null, error: null, count: 1 }));
    expect((await call(h.client, { ...input, ...overrides })).error?.message).toBe('invalid_input');
    expect(h.queries).toHaveLength(0);
  });
});

describe('completeCancelReminder: the period end is written only in the canonical form', () => {
  it.each([['2026-11-01T07:05:22Z'], ['2026-11-01 07:05:22+00'], ['soon']])('refuses %s', async (periodEnd) => {
    const h = recordingClient(() => ({ data: null, error: null, count: 1 }));
    const result = await new BusinessOsBillingAccountRepository(h.client).completeCancelReminder({
      id: ROW_ID,
      userId: USER,
      livemode: false,
      runnerId: RUNNER,
      periodEnd,
    });
    expect(result.error?.message).toBe('invalid_input');
    expect(h.queries).toHaveLength(0);
  });
});

describe('markCancelReminderCovered (SA R-D, user-scoped)', () => {
  const INPUT = { userId: USER, livemode: true, stripeSubscriptionId: 'sub_reminder1', periodEnd: PERIOD_END };

  it('records the period end only, CAS on the user, mode, subscription, this period end and still set to end; count exact, no select', async () => {
    const h = recordingClient(() => ({ data: null, error: null, count: 1 }));
    expect(await new BusinessOsBillingAccountRepository(h.client).markCancelReminderCovered(INPUT)).toEqual({
      data: { marked: true },
      error: null,
    });
    expect(argsOf(h.queries[0], 'update')).toEqual([[{ cancel_reminder_sent_for: PERIOD_END }, { count: 'exact' }]]);
    expect(argsOf(h.queries[0], 'eq')).toEqual([
      ['user_id', USER],
      ['livemode', true],
      ['stripe_subscription_id', 'sub_reminder1'],
      ['current_period_end', PERIOD_END],
      ['cancel_at_period_end', true],
    ]);
    expect(argsOf(h.queries[0], 'select')).toEqual([]);
    expect(argsOf(h.queries[0], 'or')).toEqual([]);
  });

  it('count 0 (another subscription or period, or no longer cancelling) → marked: false', async () => {
    const h = recordingClient(() => ({ data: null, error: null, count: 0 }));
    expect(await new BusinessOsBillingAccountRepository(h.client).markCancelReminderCovered(INPUT)).toEqual({
      data: { marked: false },
      error: null,
    });
  });

  it('a database error is returned, never thrown', async () => {
    const h = recordingClient(() => ({ data: null, error: { message: 'permission denied' }, count: null }));
    const result = await new BusinessOsBillingAccountRepository(h.client).markCancelReminderCovered(INPUT);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('permission denied');
  });

  it.each([
    ['a non-uuid account', { userId: 'x' }],
    ['a malformed subscription', { stripeSubscriptionId: 'sub_a,b' }],
    ['a non-canonical period end', { periodEnd: '2026-11-01' }],
    ['a non-boolean mode', { livemode: null as unknown as boolean }],
  ])('refuses %s before querying', async (_label, overrides) => {
    const h = recordingClient(() => ({ data: null, error: null, count: 1 }));
    const result = await new BusinessOsBillingAccountRepository(h.client).markCancelReminderCovered({ ...INPUT, ...overrides });
    expect(result.error?.message).toBe('invalid_input');
    expect(h.queries).toHaveLength(0);
  });
});
