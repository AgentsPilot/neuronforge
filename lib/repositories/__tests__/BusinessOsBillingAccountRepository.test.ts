/**
 * Unit tests for BusinessOsBillingAccountRepository (plan payments P-2a;
 * workplan BUSINESS_OS_PLAN_PAYMENTS_P2_WORKPLAN.md §3.7, §7 and §9; SA
 * rulings Q-1, Q-2, Q-9; tenant-isolation-guard).
 *
 * What matters here: every read scopes by `user_id` AND `livemode` with an
 * explicit column list equal to the migration's; the insert payload is exactly
 * three fields, never a spread (an injected `id` or extra field cannot reach
 * the database); a unique violation re-reads the caller's OWN row and returns
 * it, and when there is none (the customer belongs to another account) it is
 * an error with an alert, never a row; nothing is ever thrown; and only the
 * listed files may name the repository.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));
const mockWarn = jest.fn();
const mockError = jest.fn();
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {
      info: jest.fn(),
      warn: (...args: unknown[]) => mockWarn(...args),
      error: (...args: unknown[]) => mockError(...args),
      debug: jest.fn(),
    };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import {
  BILLING_ACCOUNT_COLUMNS,
  BOS_BILLING_ACCOUNTS_TABLE,
  BusinessOsBillingAccountRepository,
  businessOsBillingAccountRepository,
  checkoutLockFreeFilter,
  decideRenewalCure,
  decideRenewalFailure,
  isHostedInvoiceUrl,
  type BusinessOsBillingCustomerInput,
  type RenewalFailureFacts,
  type RenewalFailureRowFacts,
} from '@/lib/repositories/BusinessOsBillingAccountRepository';

const ROOT = process.cwd();
const USER = '11111111-1111-4111-8111-111111111111';
const ROW_ID = '22222222-2222-4222-8222-222222222222';

type Call = { method: string; args: unknown[] };
type Answer = { data: unknown; error: unknown; count?: number | null };

/** Records every from() query; each terminal call answers `respond(calls, index)`. */
function recordingClient(respond: (calls: Call[], index: number) => Answer) {
  const queries: Call[][] = [];
  const client = {
    from: (table: string) => {
      const calls: Call[] = [{ method: 'from', args: [table] }];
      const index = queries.length;
      queries.push(calls);
      const builder: Record<string, unknown> = {};
      // `is`: P-3b.2's link compare-and-set (`stripe_subscription_id IS NULL`).
      for (const method of ['select', 'eq', 'is', 'or', 'insert', 'update', 'upsert', 'delete']) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ method, args });
          return builder;
        };
      }
      for (const terminal of ['maybeSingle', 'single']) {
        builder[terminal] = () => {
          calls.push({ method: terminal, args: [] });
          return Promise.resolve(respond(calls, index));
        };
      }
      // P-3a: the compare-and-set UPDATEs end in a filter and are awaited as
      // the builder itself (no `.select()`, no `.single()`).
      builder.then = (resolve: (value: Answer) => unknown, reject: (reason: unknown) => unknown) => {
        calls.push({ method: 'await', args: [] });
        return Promise.resolve(respond(calls, index)).then(resolve, reject);
      };
      return builder;
    },
    rpc: () => {
      throw new Error('the billing repository must not call rpc');
    },
  } as unknown as SupabaseClient;
  return { client, queries };
}

const argsOf = (calls: Call[], method: string) => calls.filter((c) => c.method === method).map((c) => c.args);

function rowRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ROW_ID,
    user_id: USER,
    livemode: false,
    stripe_customer_id: 'cus_abc123',
    stripe_subscription_id: null,
    subscription_status: null,
    bought_tier: null,
    current_period_end: null,
    cancel_at_period_end: false,
    pending_tier: null,
    open_checkout_session_id: null,
    open_checkout_expires_at: null,
    last_invoice_id: null,
    last_paid_at: null,
    last_payment_failed_at: null,
    failed_attempts: 0,
    action_required_invoice_url: null,
    founder_discount_applied_at: null,
    ended_at: null,
    created_at: '2026-10-04T10:00:00.000Z',
    updated_at: '2026-10-04T10:00:00.000Z',
    ...overrides,
  };
}

function migrationColumns(): string[] {
  const migration = fs
    .readFileSync(path.join(ROOT, 'supabase', 'migrations', '20261025_business_os_billing_accounts.sql'), 'utf8')
    .replace(/\r\n/g, '\n');
  const start = migration.indexOf('CREATE TABLE public.business_os_billing_accounts (');
  expect(start).toBeGreaterThanOrEqual(0);
  return migration
    .slice(start, migration.indexOf('\n);\n', start))
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => /^[a-z_]+ /.test(line) && !line.startsWith('CONSTRAINT'))
    .map((line) => line.split(' ')[0]);
}

beforeEach(() => {
  mockWarn.mockReset();
  mockError.mockReset();
});

describe('findByUser', () => {
  it('scopes by user_id AND livemode with the explicit column list, and maps the row', async () => {
    const { client, queries } = recordingClient(() => ({ data: rowRaw({ subscription_status: null }), error: null }));
    const result = await new BusinessOsBillingAccountRepository(client).findByUser(USER, false);
    expect(queries).toHaveLength(1);
    expect(argsOf(queries[0], 'from')).toEqual([[BOS_BILLING_ACCOUNTS_TABLE]]);
    expect(argsOf(queries[0], 'select')).toEqual([[BILLING_ACCOUNT_COLUMNS]]);
    expect(argsOf(queries[0], 'eq')).toEqual([
      ['user_id', USER],
      ['livemode', false],
    ]);
    expect(argsOf(queries[0], 'maybeSingle')).toHaveLength(1);
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ id: ROW_ID, accountId: USER, livemode: false, stripeCustomerId: 'cus_abc123', failedAttempts: 0 });
  });

  it('live mode is a different row: the livemode filter is true', async () => {
    const { client, queries } = recordingClient(() => ({ data: null, error: null }));
    await new BusinessOsBillingAccountRepository(client).findByUser(USER, true);
    expect(argsOf(queries[0], 'eq')).toContainEqual(['livemode', true]);
  });

  it('absent (or another account\'s row, which the user_id filter excludes) → data null', async () => {
    const { client } = recordingClient(() => ({ data: null, error: null }));
    expect(await new BusinessOsBillingAccountRepository(client).findByUser(USER, false)).toEqual({ data: null, error: null });
  });

  it('a query error is returned, never thrown', async () => {
    const { client } = recordingClient(() => ({ data: null, error: { code: '42501', message: 'permission denied' } }));
    const result = await new BusinessOsBillingAccountRepository(client).findByUser(USER, false);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toBe('permission denied');
  });

  it('an unreadable row is an error, never a guessed value', async () => {
    const { client } = recordingClient(() => ({ data: rowRaw({ subscription_status: 'mystery' }), error: null }));
    const result = await new BusinessOsBillingAccountRepository(client).findByUser(USER, false);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('unknown_subscription_status');
  });

  it('refuses a non-uuid account or a non-boolean mode before querying', async () => {
    const { client, queries } = recordingClient(() => ({ data: null, error: null }));
    const repository = new BusinessOsBillingAccountRepository(client);
    expect((await repository.findByUser('nope', false)).error?.message).toBe('invalid_input');
    expect((await repository.findByUser(USER, 'false' as unknown as boolean)).error?.message).toBe('invalid_input');
    expect(queries).toHaveLength(0);
  });
});

describe('recordCustomer', () => {
  const INPUT: BusinessOsBillingCustomerInput = { userId: USER, livemode: false, stripeCustomerId: 'cus_abc123' };

  it('inserts exactly three fields, selects the explicit columns, and returns created: true', async () => {
    const { client, queries } = recordingClient(() => ({ data: rowRaw(), error: null }));
    const result = await new BusinessOsBillingAccountRepository(client).recordCustomer(INPUT);
    expect(queries).toHaveLength(1);
    expect(argsOf(queries[0], 'insert')).toEqual([[{ user_id: USER, livemode: false, stripe_customer_id: 'cus_abc123' }]]);
    expect(argsOf(queries[0], 'select')).toEqual([[BILLING_ACCOUNT_COLUMNS]]);
    expect(argsOf(queries[0], 'upsert')).toEqual([]);
    expect(result.error).toBeNull();
    expect(result.data?.created).toBe(true);
    expect(result.data?.account.id).toBe(ROW_ID);
  });

  it('drops injected fields at runtime: an extra id, user_id twist or status never reaches the insert', async () => {
    const { client, queries } = recordingClient(() => ({ data: rowRaw(), error: null }));
    const injected = {
      ...INPUT,
      id: '99999999-9999-4999-8999-999999999999',
      user_id: '88888888-8888-4888-8888-888888888888',
      subscription_status: 'active',
    } as unknown as BusinessOsBillingCustomerInput;
    await new BusinessOsBillingAccountRepository(client).recordCustomer(injected);
    expect(argsOf(queries[0], 'insert')).toEqual([[{ user_id: USER, livemode: false, stripe_customer_id: 'cus_abc123' }]]);
  });

  it('23505 with the caller\'s own row → re-reads (user_id AND livemode) and returns it, created: false', async () => {
    const { client, queries } = recordingClient((_calls, index) =>
      index === 0
        ? { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
        : { data: rowRaw({ stripe_customer_id: 'cus_winner' }), error: null }
    );
    const result = await new BusinessOsBillingAccountRepository(client).recordCustomer(INPUT);
    expect(queries).toHaveLength(2);
    expect(argsOf(queries[1], 'eq')).toEqual([
      ['user_id', USER],
      ['livemode', false],
    ]);
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ created: false, account: { stripeCustomerId: 'cus_winner' } });
    expect(mockWarn).toHaveBeenCalled();
  });

  it('23505 with NO own row (the customer belongs to another account) → an error and an alert, never a row', async () => {
    const { client } = recordingClient((_calls, index) =>
      index === 0 ? { data: null, error: { code: '23505', message: 'duplicate key' } } : { data: null, error: null }
    );
    const result = await new BusinessOsBillingAccountRepository(client).recordCustomer(INPUT);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('stripe_customer_held_by_another_account');
    expect(mockError).toHaveBeenCalledWith(expect.objectContaining({ alert: true }), expect.any(String));
  });

  it('23505 whose re-read fails → that error, no row', async () => {
    const { client } = recordingClient((_calls, index) =>
      index === 0 ? { data: null, error: { code: '23505', message: 'duplicate key' } } : { data: null, error: { message: 'down' } }
    );
    const result = await new BusinessOsBillingAccountRepository(client).recordCustomer(INPUT);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('down');
  });

  it('any other error → { data: null, error }, never thrown', async () => {
    const { client } = recordingClient(() => ({ data: null, error: { code: '23514', message: 'check violation' } }));
    const result = await new BusinessOsBillingAccountRepository(client).recordCustomer(INPUT);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('check violation');
    expect((result.error as Error & { code?: string }).code).toBe('23514');
  });

  it.each([
    [{ ...INPUT, userId: 'nope' }],
    [{ ...INPUT, livemode: 'true' as unknown as boolean }],
    [{ ...INPUT, stripeCustomerId: 'sub_abc' }],
    [{ ...INPUT, stripeCustomerId: 'cus_' }],
  ])('refuses invalid input %p before querying', async (input) => {
    const { client, queries } = recordingClient(() => ({ data: rowRaw(), error: null }));
    const result = await new BusinessOsBillingAccountRepository(client).recordCustomer(input);
    expect(result.error?.message).toBe('invalid_input');
    expect(queries).toHaveLength(0);
  });
});

// ── P-3a: the checkout lock and the customer replacement (workplan §3.5) ──

const NOW_ISO = '2026-10-07T10:00:00.000Z';
const EXPIRES_ISO = '2026-10-07T10:31:00.000Z';
const SESSION = 'cs_test_a1B2c3D4';

describe('acquireCheckoutLock (SR-5 / SA-P14 layer 1, compare-and-set)', () => {
  const INPUT = {
    userId: USER,
    livemode: false,
    stripeCustomerId: 'cus_abc123',
    sessionId: SESSION,
    expiresAtIso: EXPIRES_ISO,
    nowIso: NOW_ISO,
  };

  it('updates exactly the three lock columns, count exact, scoped by user_id, livemode and the customer, free-lock filter pinned, no select', async () => {
    const { client, queries } = recordingClient(() => ({ data: null, error: null, count: 1 }));
    const result = await new BusinessOsBillingAccountRepository(client).acquireCheckoutLock(INPUT);
    expect(result).toEqual({ data: { acquired: true }, error: null });
    expect(queries).toHaveLength(1);
    expect(argsOf(queries[0], 'from')).toEqual([[BOS_BILLING_ACCOUNTS_TABLE]]);
    expect(argsOf(queries[0], 'update')).toEqual([
      [{ open_checkout_session_id: SESSION, open_checkout_expires_at: EXPIRES_ISO, updated_at: NOW_ISO }, { count: 'exact' }],
    ]);
    expect(argsOf(queries[0], 'eq')).toEqual([
      ['user_id', USER],
      ['livemode', false],
      ['stripe_customer_id', 'cus_abc123'],
    ]);
    expect(argsOf(queries[0], 'or')).toEqual([[`open_checkout_session_id.is.null,open_checkout_expires_at.lte.${NOW_ISO}`]]);
    expect(checkoutLockFreeFilter(NOW_ISO)).toBe(
      'open_checkout_session_id.is.null,open_checkout_expires_at.lte.2026-10-07T10:00:00.000Z'
    );
    expect(argsOf(queries[0], 'select')).toEqual([]);
    expect(argsOf(queries[0], 'single')).toEqual([]);
    expect(argsOf(queries[0], 'maybeSingle')).toEqual([]);
  });

  it('count 0 → acquired: false (another unexpired lock holds, or the customer changed)', async () => {
    const { client } = recordingClient(() => ({ data: null, error: null, count: 0 }));
    expect(await new BusinessOsBillingAccountRepository(client).acquireCheckoutLock(INPUT)).toEqual({
      data: { acquired: false },
      error: null,
    });
  });

  it('a database error is returned, never thrown', async () => {
    const { client } = recordingClient(() => ({ data: null, error: { code: '23514', message: 'check violation' }, count: null }));
    const result = await new BusinessOsBillingAccountRepository(client).acquireCheckoutLock(INPUT);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('check violation');
  });

  it('an impossible count (more than one row) is an error, never "acquired"', async () => {
    const { client } = recordingClient(() => ({ data: null, error: null, count: 2 }));
    const result = await new BusinessOsBillingAccountRepository(client).acquireCheckoutLock(INPUT);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('unexpected_update_count');
  });

  it('drops injected fields at runtime: the patch stays the three lock columns', async () => {
    const { client, queries } = recordingClient(() => ({ data: null, error: null, count: 1 }));
    await new BusinessOsBillingAccountRepository(client).acquireCheckoutLock({
      ...INPUT,
      user_id: '88888888-8888-4888-8888-888888888888',
      subscription_status: 'active',
    } as unknown as typeof INPUT);
    expect(Object.keys(argsOf(queries[0], 'update')[0][0] as Record<string, unknown>).sort()).toEqual([
      'open_checkout_expires_at',
      'open_checkout_session_id',
      'updated_at',
    ]);
  });

  it.each([
    ['a non-uuid account', { ...INPUT, userId: 'nope' }],
    ['a non-boolean mode', { ...INPUT, livemode: 'false' as unknown as boolean }],
    ['a non-customer id', { ...INPUT, stripeCustomerId: 'sub_1' }],
    ['a non-session id', { ...INPUT, sessionId: 'pi_123' }],
    ['a session id carrying a filter', { ...INPUT, sessionId: 'cs_test_x,open_checkout_session_id.is.null' }],
    ['an offset time (a + would become a space)', { ...INPUT, nowIso: '2026-10-07T10:00:00+00:00' }],
    ['a time carrying a filter', { ...INPUT, nowIso: '2026-10-07T10:00:00.000Z,user_id.neq.x' }],
    ['an unreadable expiry', { ...INPUT, expiresAtIso: 'tomorrow' }],
  ])('refuses %s before querying', async (_label, input) => {
    const { client, queries } = recordingClient(() => ({ data: null, error: null, count: 1 }));
    const result = await new BusinessOsBillingAccountRepository(client).acquireCheckoutLock(input);
    expect(result.error?.message).toBe('invalid_input');
    expect(queries).toHaveLength(0);
  });
});

describe('replaceCustomer (compare-and-set on the old customer id)', () => {
  const INPUT = { userId: USER, livemode: false, oldCustomerId: 'cus_old', newCustomerId: 'cus_new', nowIso: NOW_ISO };

  it('swaps the customer and clears the subscription mirror and the lock, CAS on the old id, count exact, no select', async () => {
    const { client, queries } = recordingClient(() => ({ data: null, error: null, count: 1 }));
    const result = await new BusinessOsBillingAccountRepository(client).replaceCustomer(INPUT);
    expect(result).toEqual({ data: { replaced: true }, error: null });
    expect(argsOf(queries[0], 'update')).toEqual([
      [
        {
          stripe_customer_id: 'cus_new',
          stripe_subscription_id: null,
          subscription_status: null,
          open_checkout_session_id: null,
          open_checkout_expires_at: null,
          updated_at: NOW_ISO,
        },
        { count: 'exact' },
      ],
    ]);
    expect(argsOf(queries[0], 'eq')).toEqual([
      ['user_id', USER],
      ['livemode', false],
      ['stripe_customer_id', 'cus_old'],
    ]);
    expect(argsOf(queries[0], 'select')).toEqual([]);
    expect(argsOf(queries[0], 'or')).toEqual([]);
  });

  it('count 0 → replaced: false (someone else replaced it first)', async () => {
    const { client } = recordingClient(() => ({ data: null, error: null, count: 0 }));
    expect(await new BusinessOsBillingAccountRepository(client).replaceCustomer(INPUT)).toEqual({
      data: { replaced: false },
      error: null,
    });
  });

  it("a unique violation (the new customer is another account's) → an error with an alert, never a row", async () => {
    const { client } = recordingClient(() => ({ data: null, error: { code: '23505', message: 'duplicate key' }, count: null }));
    const result = await new BusinessOsBillingAccountRepository(client).replaceCustomer(INPUT);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('stripe_customer_held_by_another_account');
    expect(mockError).toHaveBeenCalledWith(expect.objectContaining({ alert: true }), expect.any(String));
  });

  it('any other error → returned, never thrown', async () => {
    const { client } = recordingClient(() => ({ data: null, error: { message: 'down' }, count: null }));
    const result = await new BusinessOsBillingAccountRepository(client).replaceCustomer(INPUT);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('down');
  });

  it.each([
    ['a non-uuid account', { ...INPUT, userId: 'nope' }],
    ['a non-customer old id', { ...INPUT, oldCustomerId: 'sub_1' }],
    ['an empty new id', { ...INPUT, newCustomerId: 'cus_' }],
    ['the same id twice', { ...INPUT, newCustomerId: 'cus_old' }],
    ['an unreadable time', { ...INPUT, nowIso: 'now' }],
  ])('refuses %s before querying', async (_label, input) => {
    const { client, queries } = recordingClient(() => ({ data: null, error: null, count: 1 }));
    const result = await new BusinessOsBillingAccountRepository(client).replaceCustomer(input);
    expect(result.error?.message).toBe('invalid_input');
    expect(queries).toHaveLength(0);
  });
});

// ── P-6a.1 (SA C-6): the test-clock attach clears the WHOLE subscription mirror ──

describe('attachTestClockCustomer (TEST MODE ONLY, compare-and-set on the old customer id)', () => {
  const INPUT = { userId: USER, oldCustomerId: 'cus_old', newCustomerId: 'cus_clock', nowIso: NOW_ISO };

  it('swaps the customer and clears every subscription-scoped column, test mode only, CAS on the old id, count exact, no select, no or', async () => {
    const { client, queries } = recordingClient(() => ({ data: null, error: null, count: 1 }));
    const result = await new BusinessOsBillingAccountRepository(client).attachTestClockCustomer(INPUT);
    expect(result).toEqual({ data: { replaced: true }, error: null });
    expect(argsOf(queries[0], 'update')).toEqual([
      [
        {
          stripe_customer_id: 'cus_clock',
          stripe_subscription_id: null,
          subscription_status: null,
          bought_tier: null,
          current_period_end: null,
          cancel_at_period_end: false,
          pending_tier: null,
          open_checkout_session_id: null,
          open_checkout_expires_at: null,
          last_invoice_id: null,
          last_paid_at: null,
          last_payment_failed_at: null,
          failed_attempts: 0,
          action_required_invoice_url: null,
          ended_at: null,
          updated_at: NOW_ISO,
        },
        { count: 'exact' },
      ],
    ]);
    expect(argsOf(queries[0], 'eq')).toEqual([
      ['user_id', USER],
      ['livemode', false],
      ['stripe_customer_id', 'cus_old'],
    ]);
    expect(argsOf(queries[0], 'select')).toEqual([]);
    expect(argsOf(queries[0], 'or')).toEqual([]);
  });

  it('writes every UPDATE-granted column of 20261025 except the founder discount stamp, and resets all but the customer and updated_at (C-6)', async () => {
    const migration = fs
      .readFileSync(path.join(ROOT, 'supabase', 'migrations', '20261025_business_os_billing_accounts.sql'), 'utf8')
      .replace(/\r\n/g, '\n');
    const grant = migration.match(/GRANT UPDATE \(([^)]+)\) ON TABLE public\.business_os_billing_accounts TO service_role;/);
    expect(grant).not.toBeNull();
    const granted = (grant as RegExpMatchArray)[1].split(',').map((column) => column.trim());

    const { client, queries } = recordingClient(() => ({ data: null, error: null, count: 1 }));
    await new BusinessOsBillingAccountRepository(client).attachTestClockCustomer(INPUT);
    const patch = argsOf(queries[0], 'update')[0][0] as Record<string, unknown>;

    const kept = ['stripe_customer_id', 'founder_discount_applied_at', 'updated_at'];
    expect(Object.keys(patch).sort()).toEqual(granted.filter((column) => column !== 'founder_discount_applied_at').sort());
    for (const column of granted.filter((name) => !kept.includes(name))) {
      expect([null, false, 0]).toContain(patch[column]);
    }
  });

  it('count 0 → replaced: false (someone else changed the customer first)', async () => {
    const { client } = recordingClient(() => ({ data: null, error: null, count: 0 }));
    expect(await new BusinessOsBillingAccountRepository(client).attachTestClockCustomer(INPUT)).toEqual({
      data: { replaced: false },
      error: null,
    });
  });

  it("a unique violation (the new customer is another account's) → an error with an alert, never a row", async () => {
    const { client } = recordingClient(() => ({ data: null, error: { code: '23505', message: 'duplicate key' }, count: null }));
    const result = await new BusinessOsBillingAccountRepository(client).attachTestClockCustomer(INPUT);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('stripe_customer_held_by_another_account');
    expect(mockError).toHaveBeenCalledWith(expect.objectContaining({ alert: true }), expect.any(String));
  });

  it('any other error → returned, never thrown', async () => {
    const { client } = recordingClient(() => ({ data: null, error: { message: 'down' }, count: null }));
    const result = await new BusinessOsBillingAccountRepository(client).attachTestClockCustomer(INPUT);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('down');
  });

  it.each([
    ['a non-uuid account', { ...INPUT, userId: 'nope' }],
    ['a non-customer old id', { ...INPUT, oldCustomerId: 'sub_1' }],
    ['an empty new id', { ...INPUT, newCustomerId: 'cus_' }],
    ['an id carrying a filter', { ...INPUT, newCustomerId: 'cus_a,user_id.neq.x' }],
    ['the same id twice', { ...INPUT, newCustomerId: 'cus_old' }],
    ['an unreadable time', { ...INPUT, nowIso: 'now' }],
  ])('refuses %s before querying', async (_label, input) => {
    const { client, queries } = recordingClient(() => ({ data: null, error: null, count: 1 }));
    const result = await new BusinessOsBillingAccountRepository(client).attachTestClockCustomer(input);
    expect(result.error?.message).toBe('invalid_input');
    expect(queries).toHaveLength(0);
  });
});

// ── P-3b.2: the webhook's lookups and compare-and-set writes (workplan §3.3, §3.5) ──

const SUBSCRIPTION = 'sub_a1B2c3';

describe.each([
  ['findByStripeSubscription', 'stripe_subscription_id', SUBSCRIPTION, 'cus_abc123'],
  ['findByStripeCustomer', 'stripe_customer_id', 'cus_abc123', SUBSCRIPTION],
] as const)('%s (documented lookup by a UNIQUE Stripe id, §3.3)', (method, column, id, wrongShape) => {
  const call = (repository: BusinessOsBillingAccountRepository, value: string, livemode: boolean) =>
    repository[method](value, livemode);

  it('filters by the Stripe id AND livemode (no user_id: the account is what is being found), explicit columns, maps the row', async () => {
    const { client, queries } = recordingClient(() => ({ data: rowRaw({ stripe_subscription_id: SUBSCRIPTION }), error: null }));
    const result = await call(new BusinessOsBillingAccountRepository(client), id, true);
    expect(argsOf(queries[0], 'select')).toEqual([[BILLING_ACCOUNT_COLUMNS]]);
    expect(argsOf(queries[0], 'eq')).toEqual([
      [column, id],
      ['livemode', true],
    ]);
    expect(argsOf(queries[0], 'maybeSingle')).toHaveLength(1);
    expect(result.data).toMatchObject({ id: ROW_ID, accountId: USER, stripeSubscriptionId: SUBSCRIPTION });
  });

  it('a detached row (account deleted) maps with accountId null, never a guess', async () => {
    const { client } = recordingClient(() => ({ data: rowRaw({ user_id: null }), error: null }));
    expect((await call(new BusinessOsBillingAccountRepository(client), id, false)).data?.accountId).toBeNull();
  });

  it('no row → data null; an error → returned, never thrown', async () => {
    const empty = recordingClient(() => ({ data: null, error: null }));
    expect(await call(new BusinessOsBillingAccountRepository(empty.client), id, false)).toEqual({ data: null, error: null });
    const failing = recordingClient(() => ({ data: null, error: { message: 'down' } }));
    const result = await call(new BusinessOsBillingAccountRepository(failing.client), id, false);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('down');
  });

  it.each([
    ['the other kind of Stripe id', wrongShape],
    ['an id carrying a filter', `${id},user_id.neq.x`],
    ['an empty id', ''],
  ])('refuses %s before querying', async (_label, value) => {
    const { client, queries } = recordingClient(() => ({ data: null, error: null }));
    expect((await call(new BusinessOsBillingAccountRepository(client), value, false)).error?.message).toBe('invalid_input');
    expect(queries).toHaveLength(0);
  });

  it('refuses a non-boolean mode before querying', async () => {
    const { client, queries } = recordingClient(() => ({ data: null, error: null }));
    expect((await call(new BusinessOsBillingAccountRepository(client), id, 'true' as unknown as boolean)).error?.message).toBe(
      'invalid_input'
    );
    expect(queries).toHaveLength(0);
  });
});

describe('linkCheckoutSession (checkout.session.completed, compare-and-set)', () => {
  const INPUT = { userId: USER, livemode: false, sessionId: SESSION, stripeSubscriptionId: SUBSCRIPTION, nowIso: NOW_ISO };

  it('links the subscription and clears the lock, CAS on this session and NO subscription yet, count exact, no select, no or', async () => {
    const { client, queries } = recordingClient(() => ({ data: null, error: null, count: 1 }));
    const result = await new BusinessOsBillingAccountRepository(client).linkCheckoutSession(INPUT);
    expect(result).toEqual({ data: { linked: true }, error: null });
    expect(argsOf(queries[0], 'update')).toEqual([
      [
        { stripe_subscription_id: SUBSCRIPTION, open_checkout_session_id: null, open_checkout_expires_at: null, updated_at: NOW_ISO },
        { count: 'exact' },
      ],
    ]);
    expect(argsOf(queries[0], 'eq')).toEqual([
      ['user_id', USER],
      ['livemode', false],
      ['open_checkout_session_id', SESSION],
    ]);
    expect(argsOf(queries[0], 'is')).toEqual([['stripe_subscription_id', null]]);
    expect(argsOf(queries[0], 'select')).toEqual([]);
    expect(argsOf(queries[0], 'or')).toEqual([]);
  });

  it('count 0 → linked: false (a replay, another lock, or a subscription already on the row)', async () => {
    const { client } = recordingClient(() => ({ data: null, error: null, count: 0 }));
    expect(await new BusinessOsBillingAccountRepository(client).linkCheckoutSession(INPUT)).toEqual({
      data: { linked: false },
      error: null,
    });
  });

  it("a unique violation (another account's row holds the subscription) → an error with an alert, never linked", async () => {
    const { client } = recordingClient(() => ({ data: null, error: { code: '23505', message: 'duplicate key' }, count: null }));
    const result = await new BusinessOsBillingAccountRepository(client).linkCheckoutSession(INPUT);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('stripe_subscription_held_by_another_account');
    expect(mockError).toHaveBeenCalledWith(expect.objectContaining({ alert: true }), expect.any(String));
  });

  it('an impossible count is an error', async () => {
    const { client } = recordingClient(() => ({ data: null, error: null, count: 2 }));
    expect((await new BusinessOsBillingAccountRepository(client).linkCheckoutSession(INPUT)).error?.message).toBe('unexpected_update_count');
  });

  it('drops injected fields at runtime: the patch stays the four columns', async () => {
    const { client, queries } = recordingClient(() => ({ data: null, error: null, count: 1 }));
    await new BusinessOsBillingAccountRepository(client).linkCheckoutSession({
      ...INPUT,
      user_id: '88888888-8888-4888-8888-888888888888',
      bought_tier: 'x',
    } as unknown as typeof INPUT);
    expect(Object.keys(argsOf(queries[0], 'update')[0][0] as Record<string, unknown>).sort()).toEqual([
      'open_checkout_expires_at',
      'open_checkout_session_id',
      'stripe_subscription_id',
      'updated_at',
    ]);
  });

  it.each([
    ['a non-uuid account', { ...INPUT, userId: 'nope' }],
    ['a non-session id', { ...INPUT, sessionId: 'pi_1' }],
    ['a non-subscription id', { ...INPUT, stripeSubscriptionId: 'cus_1' }],
    ['a subscription id carrying a filter', { ...INPUT, stripeSubscriptionId: 'sub_1,user_id.neq.x' }],
    ['an offset time', { ...INPUT, nowIso: '2026-10-07T10:00:00+00:00' }],
  ])('refuses %s before querying', async (_label, input) => {
    const { client, queries } = recordingClient(() => ({ data: null, error: null, count: 1 }));
    expect((await new BusinessOsBillingAccountRepository(client).linkCheckoutSession(input)).error?.message).toBe('invalid_input');
    expect(queries).toHaveLength(0);
  });
});

describe('releaseCheckoutLock (compare-and-set on the session id)', () => {
  const INPUT = { userId: USER, livemode: true, sessionId: SESSION, nowIso: NOW_ISO };

  it('clears exactly the two lock columns of THIS session only, count exact, no select', async () => {
    const { client, queries } = recordingClient(() => ({ data: null, error: null, count: 1 }));
    expect(await new BusinessOsBillingAccountRepository(client).releaseCheckoutLock(INPUT)).toEqual({
      data: { released: true },
      error: null,
    });
    expect(argsOf(queries[0], 'update')).toEqual([
      [{ open_checkout_session_id: null, open_checkout_expires_at: null, updated_at: NOW_ISO }, { count: 'exact' }],
    ]);
    expect(argsOf(queries[0], 'eq')).toEqual([
      ['user_id', USER],
      ['livemode', true],
      ['open_checkout_session_id', SESSION],
    ]);
    expect(argsOf(queries[0], 'select')).toEqual([]);
    expect(argsOf(queries[0], 'or')).toEqual([]);
  });

  it("count 0 → released: false (already gone, or another session's lock, which is left alone)", async () => {
    const { client } = recordingClient(() => ({ data: null, error: null, count: 0 }));
    expect((await new BusinessOsBillingAccountRepository(client).releaseCheckoutLock(INPUT)).data).toEqual({ released: false });
  });

  it('a database error is returned, never thrown', async () => {
    const { client } = recordingClient(() => ({ data: null, error: { message: 'down' }, count: null }));
    expect((await new BusinessOsBillingAccountRepository(client).releaseCheckoutLock(INPUT)).error?.message).toBe('down');
  });

  it('refuses invalid input before querying', async () => {
    const { client, queries } = recordingClient(() => ({ data: null, error: null, count: 1 }));
    const repository = new BusinessOsBillingAccountRepository(client);
    expect((await repository.releaseCheckoutLock({ ...INPUT, sessionId: 'cs_x,open_checkout_session_id.is.null' })).error?.message).toBe('invalid_input');
    expect((await repository.releaseCheckoutLock({ ...INPUT, userId: 'nope' })).error?.message).toBe('invalid_input');
    expect(queries).toHaveLength(0);
  });
});

describe('mirrorSubscriptionState (SA Q-1, status-only mirror)', () => {
  const INPUT = {
    userId: USER,
    livemode: false,
    stripeSubscriptionId: SUBSCRIPTION,
    status: 'canceled' as const,
    cancelAtPeriodEnd: false,
    endedAtIso: '2026-10-07T09:00:00.000Z',
    nowIso: NOW_ISO,
  };

  it('writes exactly status, cancel_at_period_end and ended_at, CAS on the row holding this subscription, count exact, no select', async () => {
    const { client, queries } = recordingClient(() => ({ data: null, error: null, count: 1 }));
    expect(await new BusinessOsBillingAccountRepository(client).mirrorSubscriptionState(INPUT)).toEqual({
      data: { mirrored: true },
      error: null,
    });
    expect(argsOf(queries[0], 'update')).toEqual([
      [
        { subscription_status: 'canceled', cancel_at_period_end: false, ended_at: '2026-10-07T09:00:00.000Z', updated_at: NOW_ISO },
        { count: 'exact' },
      ],
    ]);
    expect(argsOf(queries[0], 'eq')).toEqual([
      ['user_id', USER],
      ['livemode', false],
      ['stripe_subscription_id', SUBSCRIPTION],
    ]);
    expect(argsOf(queries[0], 'select')).toEqual([]);
  });

  it('never writes current_period_end, the tier or the lock (only a paid invoice moves those)', async () => {
    const { client, queries } = recordingClient(() => ({ data: null, error: null, count: 1 }));
    await new BusinessOsBillingAccountRepository(client).mirrorSubscriptionState({
      ...INPUT,
      current_period_end: '2030-01-01T00:00:00.000Z',
      bought_tier: 'x',
    } as unknown as typeof INPUT);
    expect(Object.keys(argsOf(queries[0], 'update')[0][0] as Record<string, unknown>).sort()).toEqual([
      'cancel_at_period_end',
      'ended_at',
      'subscription_status',
      'updated_at',
    ]);
  });

  it('a live subscription mirrors ended_at as null', async () => {
    const { client, queries } = recordingClient(() => ({ data: null, error: null, count: 1 }));
    await new BusinessOsBillingAccountRepository(client).mirrorSubscriptionState({
      ...INPUT,
      status: 'active',
      cancelAtPeriodEnd: true,
      endedAtIso: null,
    });
    expect(argsOf(queries[0], 'update')[0][0]).toMatchObject({ subscription_status: 'active', cancel_at_period_end: true, ended_at: null });
  });

  it('count 0 → mirrored: false (the row no longer holds this subscription)', async () => {
    const { client } = recordingClient(() => ({ data: null, error: null, count: 0 }));
    expect((await new BusinessOsBillingAccountRepository(client).mirrorSubscriptionState(INPUT)).data).toEqual({ mirrored: false });
  });

  it.each([
    ['an unknown status', { ...INPUT, status: 'mystery' as unknown as 'active' }],
    ['a non-boolean cancel flag', { ...INPUT, cancelAtPeriodEnd: 'true' as unknown as boolean }],
    ['an unreadable end', { ...INPUT, endedAtIso: 'yesterday' }],
    ['a non-subscription id', { ...INPUT, stripeSubscriptionId: 'cus_1' }],
  ])('refuses %s before querying', async (_label, input) => {
    const { client, queries } = recordingClient(() => ({ data: null, error: null, count: 1 }));
    expect((await new BusinessOsBillingAccountRepository(client).mirrorSubscriptionState(input)).error?.message).toBe('invalid_input');
    expect(queries).toHaveLength(0);
  });
});

describe('source guards', () => {
  const source = fs.readFileSync(path.join(ROOT, 'lib', 'repositories', 'BusinessOsBillingAccountRepository.ts'), 'utf8');
  const code = source.replace(/\/\/.*$/gm, '');

  it('the column list equals the migration columns, in order, and never *', () => {
    expect(BILLING_ACCOUNT_COLUMNS).not.toContain('*');
    expect(BILLING_ACCOUNT_COLUMNS.split(', ')).toEqual(migrationColumns());
  });

  it('scope (P-2a SA Q-9, P-3a §3.5, P-3b.2 §3.5, P-6a.1 C-6, P-6a.2 C-2): one insert, eight compare-and-set updates, no delete, no upsert, no rpc, no spread into a payload', () => {
    expect(code.match(/\.insert\(/g)).toHaveLength(1);
    expect(code.match(/\.update\(/g)).toHaveLength(8);
    expect(code).not.toMatch(/\.(delete|upsert|rpc)\(/);
    expect(code).not.toMatch(/\.update\(\{\s*\.\.\./);
    // UPDATE + .or() + .select() fails 42703 in production (2026-09-29): the
    // two compare-and-set methods must never select.
    const lf = code.replace(/\r\n/g, '\n');
    for (const method of [
      'acquireCheckoutLock',
      'replaceCustomer',
      'attachTestClockCustomer',
      'linkCheckoutSession',
      'releaseCheckoutLock',
      'mirrorSubscriptionState',
      // P-6a.2 (SA C-2): read (through findByUser), decide, compare-and-set.
      'writeRenewalFailure',
      'clearRenewalFailure',
    ]) {
      const start = lf.indexOf(`async ${method}(`);
      const end = lf.indexOf('\n  }\n', start);
      expect(start).toBeGreaterThan(0);
      expect(end).toBeGreaterThan(start);
      const body = lf.slice(start, end);
      expect(body).toContain("{ count: 'exact' }");
      expect(body).not.toMatch(/\.select\(|\.single\(|\.maybeSingle\(/);
      // P-3b.2 (R-7): the three webhook writes use no `.or()` at all.
      if (method !== 'acquireCheckoutLock') expect(body).not.toMatch(/\.or\(/);
    }
    expect(code).not.toMatch(/\.insert\(\{\s*\.\.\./);
    expect(code).not.toMatch(/select\(\s*['"]\*['"]/);
  });

  it('the read and every update scope by user_id and livemode; the two Stripe-id lookups by livemode; the other from() is the three-field insert', () => {
    expect(code.match(/\.from\(/g)).toHaveLength(12);
    expect(code.match(/\.maybeSingle\(\)/g)).toHaveLength(3);
    // findByUser and the eight updates.
    expect(code.match(/\.eq\('user_id', userId\)/g)).toHaveLength(9);
    // The same nine, plus the two documented lookups by a UNIQUE Stripe id (§3.3).
    expect(code.match(/\.eq\('livemode', livemode\)/g)).toHaveLength(11);
    expect(code.match(/\.eq\('stripe_subscription_id', stripeSubscriptionId\)/g)).toHaveLength(4);
    expect(code.match(/\.eq\('stripe_customer_id', stripeCustomerId\)/g)).toHaveLength(2);
    expect(code).toContain('.insert({ user_id: userId, livemode, stripe_customer_id: stripeCustomerId })');
  });

  it('defaults to the service-role client, and the singleton uses it', () => {
    expect(source).toContain("import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';");
    expect(source).toContain('this.supabase = supabaseClient || defaultSupabase;');
    expect((businessOsBillingAccountRepository as unknown as { supabase: unknown }).supabase).toEqual({ marker: 'service-role-default' });
  });

  /**
   * EXACTLY these files may name the billing repository: the repository, its
   * test, the barrel (a re-export, not a caller), the Business OS customer
   * function and its test (SA Q-11), the P-3a plan checkout and its tests, and
   * the admin deletion reads. A new caller is added here, in a
   * reviewable diff, or this test fails.
   */
  it('only the listed files name the repository', () => {
    const ALLOWED = [
      // Plan payments P-3b.1 (SA C-8 ruling): the admin entitlements route suite
      // fakes this repository (no subscription) for the PF-13 billing read.
      'app/api/admin/business-os/entitlements/__tests__/routes.test.ts',
      // Plan payments P-6a.1: the test-clock route suite fakes the repository
      // module by name. The route itself does not name it (planTestClock.ts does).
      'app/api/admin/business-os/test/plan-test-clock/__tests__/route.test.ts',
      // D2 / SX-1 QA (2026-10-27): the gap tests over the same two routes fake
      // the repository module by name, as route.test.ts below. Test file only.
      'app/api/business-os/billing/plan/cancel/__tests__/route.d2.qa.test.ts',
      // Plan payments P-7a.4 QA (2026-10-27): the two-tab / cured-row / void-failure
      // gap tests fake the repository module by name (stateful). Test file only.
      'app/api/business-os/billing/plan/cancel/__tests__/route.p7a4.qa.test.ts',
      // Plan payments P-7a.4: the immediate-cancel route test fakes the repository
      // module by name, as route.test.ts below. Test file only.
      'app/api/business-os/billing/plan/cancel/__tests__/route.p7a4.test.ts',
      // Plan payments P-7a.1: the cancel / reactivate routes' integration test
      // fakes the repository module by name. The routes themselves do not name it.
      'app/api/business-os/billing/plan/cancel/__tests__/route.test.ts',
      // Plan payments P-3a: the checkout route's integration test fakes the
      // repository module by name. The route itself does not name it.
      'app/api/business-os/billing/plan/checkout/__tests__/route.test.ts',
      // Plan payments P-7a.2: the portal / invoices routes' integration test
      // fakes the repository module by name (and keeps the real
      // `isHostedInvoiceUrl`). The routes themselves do not name it.
      // Plan payments P-7a.2 QA: the extra route checks fake it the same way.
      'app/api/business-os/billing/plan/portal/__tests__/route.p7a2.qa.test.ts',
      'app/api/business-os/billing/plan/portal/__tests__/route.test.ts',
      // Plan payments P-7b.1a: the upgrade routes' integration test fakes the
      // repository module by name. The routes themselves do not name it.
      'app/api/business-os/billing/plan/upgrade/__tests__/route.test.ts',
      // Plan payments P-4.2: the my-plan route suite fakes the repository module
      // by name for the purchase view's billing read. The route does not name it.
      'app/api/business-os/entitlements/my-plan/__tests__/route.test.ts',
      // Not a caller: the P1-C6 / M-1 placement guard names the repository's
      // module path to assert the allow-listed billing files are its only billing importers.
      'app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts',
      'lib/business-os/billing/__tests__/businessOsStripeCustomer.test.ts',
      // P-5a.2 (SA W-8): the switch-matrix test fakes the repository module by
      // name, for the real checkout route and the real holding-screen model.
      'lib/business-os/billing/__tests__/heldPaymentOffer.matrix.test.ts',
      // P-3a: imports the billing row TYPE to build fakes.
      'lib/business-os/billing/__tests__/planCheckout.test.ts',
      // P-3b.2: the webhook use-case tests import the billing row TYPE to build fakes.
      'lib/business-os/billing/__tests__/planCheckoutSessionEvents.test.ts',
      // P-5a.1: the first payment stamp test imports the same TYPE for its fake.
      'lib/business-os/billing/__tests__/planPaymentApply.firstPayment.test.ts',
      // P-5b.1: the N-2 apply test imports the same TYPE for its fake.
      'lib/business-os/billing/__tests__/planPaymentApply.n2.test.ts',
      // FU-P7a4-1: the QA edge test imports the same TYPES for its fake.
      'lib/business-os/billing/__tests__/planPaymentApply.paidAfterEnd.qa.test.ts',
      'lib/business-os/billing/__tests__/planPaymentApply.test.ts',
      // P-6a.2: pins the notice's confirm prefix to this repository's HOSTED_INVOICE_URL_PREFIX.
      'lib/business-os/billing/__tests__/planPaymentNotice.test.ts',
      // P-6a.2 (T10): the renewal captured-payload test runs the repository's
      // REAL pure decisions in its fake, and imports the row TYPE.
      'lib/business-os/billing/__tests__/planRenewal.captured.test.ts',
      'lib/business-os/billing/__tests__/planSubscriptionMirror.test.ts',
      // P-7b.1b (U-7): the captured-payload test imports the billing row TYPE to build its fakes.
      'lib/business-os/billing/__tests__/planUpgrade.captured.test.ts',
      // P-7b.1a: the upgrade orchestration test imports the billing row TYPE to build fakes.
      'lib/business-os/billing/__tests__/planUpgrade.test.ts',
      // P-6a.2: the banner read's test fakes the repository module by name.
      'lib/business-os/billing/__tests__/readPaymentNotice.test.ts',
      'lib/business-os/billing/businessOsStripeCustomer.ts',
      // Plan payments P-5a.2 (workplan §3.3): the holding screen's model reads
      // the SESSION user's billing row for the current mode (findByUser only).
      'lib/business-os/billing/heldPaymentView.ts',
      // Plan payments P-7a.2 (workplan §4.4, §4.5): Update card and the invoice
      // list read the SESSION user's billing row for the current mode
      // (findByUser only) and use `isHostedInvoiceUrl` for the invoice links.
      'lib/business-os/billing/planBillingDocuments.ts',
      // Plan payments P-3b.2 (workplan §3.1, §3.5): the plan webhook handler
      // wires the singleton; its three use cases take it as a port TYPE
      // (findByStripeSubscription, findByStripeCustomer, linkCheckoutSession,
      // releaseCheckoutLock, mirrorSubscriptionState).
      'lib/business-os/billing/planBillingHandler.ts',
      // Plan payments P-3a: the checkout reads the billing row and records the
      // lock (findByUser, acquireCheckoutLock; replaceCustomer via the customer
      // function).
      'lib/business-os/billing/planCheckout.ts',
      'lib/business-os/billing/planCheckoutSessionEvents.ts',
      'lib/business-os/billing/planPaymentApply.ts',
      // Plan payments P-4.2 (SA W-8): the Settings → Plan purchase view reads
      // the SESSION user's billing row for the current mode (findByUser only).
      'lib/business-os/billing/planPurchaseView.ts',
      // Plan payments P-7a.1 (workplan §4.2; SA C-2): cancel / reactivate reads
      // the SESSION user's billing row for the current mode (findByUser) and
      // mirrors Stripe's answer onto it by CAS (mirrorSubscriptionState).
      'lib/business-os/billing/planSubscriptionManage.ts',
      'lib/business-os/billing/planSubscriptionMirror.ts',
      // Plan payments P-6a.1 (SA C-5, C-6): the TEST MODE ONLY test clock reads
      // the target account's test-mode row (findByUser) and records or moves its
      // customer (recordCustomer, attachTestClockCustomer).
      'lib/business-os/billing/planTestClock.ts',
      // Plan payments P-7b.1a (workplan §3.4, §3.8): the upgrade orchestration
      // reads the SESSION user's billing row for the current mode (findByUser only).
      'lib/business-os/billing/planUpgrade.ts',
      // Plan payments P-6a.2 (workplan §5.6, SA C-13): the owner banner reads
      // the SESSION account's billing row for the current mode (findByUser only),
      // and its test fakes the repository module by name.
      'lib/business-os/billing/readPaymentNotice.ts',
      // Admin delete AD-1b (SC-5): R-3 reads BOTH livemode rows of the target's
      // plan billing account (findByUser only); the evaluator imports the status
      // type. Their tests name it to fake it. No entitlements import.
      'lib/business-os/purge/__tests__/AdminDeletionPreview.test.ts',
      // Plan payments P-7a.3 (PF-14, SA C-9): the Reset guard's control 3 reads
      // the plan billing rows through hasLivePlanSubscription, so the purge
      // orchestration suites (both surfaces) fake the repository module by name.
      'lib/business-os/purge/__tests__/ResetService.adminSurface.test.ts',
      'lib/business-os/purge/__tests__/ResetService.order.test.ts',
      'lib/business-os/purge/__tests__/adminDeletionRefusals.test.ts',
      // P-3b.1 (QA Bug 1): fakes the repository to test hasLivePlanSubscription.
      'lib/business-os/purge/__tests__/hasLivePlanSubscription.test.ts',
      // Plan payments P-7a.3: the PF-14 cross-path pin fakes the repository and
      // imports the status TYPE to enumerate every row the rule distinguishes.
      'lib/business-os/purge/__tests__/planSubscriptionLive.paths.test.ts',
      // AD-2a: the read moved verbatim to adminDeletionFacts.ts (shared by the
      // preview and the commit gate). Kept in sorted order: the guard compares
      // against found.sort().
      'lib/business-os/purge/adminDeletionFacts.ts',
      'lib/business-os/purge/adminDeletionRefusals.ts',
      'lib/repositories/BusinessOsBillingAccountRepository.ts',
      // Plan payments P-3b.1: imports the subscription status TYPE only, for
      // the apply function's input. Not a caller of this repository.
      'lib/repositories/BusinessOsBillingEventRepository.ts',
      'lib/repositories/__tests__/BusinessOsBillingAccountRepository.test.ts',
      // Not a caller: the money history repository's caller guard names this
      // test file's path (the two guards list each other).
      'lib/repositories/__tests__/BusinessOsBillingEventRepository.test.ts',
      'lib/repositories/index.ts',
    ];
    const SYMBOLS = ['BusinessOsBillingAccountRepository', 'businessOsBillingAccountRepository'];
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', '.next', '.claude', 'coverage'].includes(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) {
          const text = fs.readFileSync(full, 'utf8');
          if (SYMBOLS.some((symbol) => text.includes(symbol))) found.push(path.relative(ROOT, full).split(path.sep).join('/'));
        }
      }
    };
    for (const dir of ['app', 'lib', 'components', 'hooks', 'scripts']) {
      if (fs.existsSync(path.join(ROOT, dir))) walk(path.join(ROOT, dir));
    }
    expect(found.sort()).toEqual(ALLOWED);
  });
});

// ── P-6a.2: renewal failures and their cure (§5.3, §5.4; SA C-1 ruling, C-2) ──

const SUB = 'sub_renewal1';
const INVOICE = 'in_renewal1';
/** Stripe's (test clock) time: the period dates. */
const T1 = '2026-12-15T07:05:22.000Z';
const P2 = '2027-01-15T07:05:22.000Z';
const P3 = '2027-02-15T07:05:22.000Z';
/** Real time: `event.created` under a test clock is EARLIER than every period date. */
const CREATED_1 = '2026-10-15T07:05:55.000Z';
const CREATED_2 = '2026-10-15T07:06:15.000Z';
const HOSTED = 'https://invoice.stripe.com/i/acct_test/test_hosted_one?s=ap';
const HOSTED_OTHER = 'https://invoice.stripe.com/i/acct_test/test_hosted_two?s=ap';

function failureRow(overrides: Partial<RenewalFailureRowFacts> = {}): RenewalFailureRowFacts {
  return {
    stripeSubscriptionId: SUB,
    currentPeriodEnd: T1,
    lastInvoiceId: 'in_paid_before',
    failedAttempts: 0,
    actionRequiredInvoiceUrl: null,
    lastPaymentFailedAt: null,
    ...overrides,
  };
}

function failureFacts(overrides: Partial<RenewalFailureFacts> = {}): RenewalFailureFacts {
  return {
    stripeSubscriptionId: SUB,
    invoiceId: INVOICE,
    periodEndIso: P2,
    attemptCount: 1,
    failedAtIso: CREATED_1,
    hostedInvoiceUrl: null,
    actionRequired: false,
    ...overrides,
  };
}

describe('isHostedInvoiceUrl (§5.4): Stripe-hosted pages only', () => {
  it.each([
    [HOSTED, true],
    ['https://invoice.stripe.com/', false],
    ['https://example.invalid/scrubbed', false],
    ['http://invoice.stripe.com/i/x', false],
    ['https://invoice.stripe.com.evil.example/i/x', false],
    ['https://invoice.stripe.com/i/x y', false],
    [null, false],
    [42, false],
  ])('%s → %s', (value, expected) => {
    expect(isHostedInvoiceUrl(value)).toBe(expected);
  });

  it('longer than 2048 characters → false', () => {
    expect(isHostedInvoiceUrl(`https://invoice.stripe.com/${'a'.repeat(2030)}`)).toBe(false);
  });
});

describe('decideRenewalFailure (SA C-1 ruling): cured by periods, never by event.created', () => {
  it('no row, or a row holding another subscription → moot', () => {
    expect(decideRenewalFailure(null, failureFacts())).toEqual({ kind: 'moot', reason: 'no_row' });
    expect(decideRenewalFailure(failureRow({ stripeSubscriptionId: 'sub_other' }), failureFacts())).toEqual({ kind: 'moot', reason: 'other_subscription' });
    expect(decideRenewalFailure(failureRow({ stripeSubscriptionId: null }), failureFacts())).toEqual({ kind: 'moot', reason: 'other_subscription' });
  });

  it('the row is already paid through P (equal or later) → moot: a failure delivered after its cure writes nothing', () => {
    expect(decideRenewalFailure(failureRow({ currentPeriodEnd: P2 }), failureFacts())).toEqual({ kind: 'moot', reason: 'period_already_paid' });
    expect(decideRenewalFailure(failureRow({ currentPeriodEnd: P3 }), failureFacts())).toEqual({ kind: 'moot', reason: 'period_already_paid' });
    // PostgREST's own timestamp text compares by instant.
    expect(decideRenewalFailure(failureRow({ currentPeriodEnd: '2027-01-15T07:05:22+00:00' }), failureFacts())).toEqual({ kind: 'moot', reason: 'period_already_paid' });
  });

  it('this very invoice is the last one paid → moot', () => {
    expect(decideRenewalFailure(failureRow({ lastInvoiceId: INVOICE }), failureFacts())).toEqual({ kind: 'moot', reason: 'invoice_already_paid' });
  });

  it('a first failure records max(attempt_count, 1) and the event date', () => {
    expect(decideRenewalFailure(failureRow(), failureFacts())).toEqual({
      kind: 'write',
      failedAttempts: 1,
      lastPaymentFailedAt: CREATED_1,
      actionRequiredInvoiceUrl: null,
    });
  });

  it('X-5: an off-session 3-D Secure failure arrives with attempt_count 0 and still records one attempt', () => {
    expect(decideRenewalFailure(failureRow(), failureFacts({ attemptCount: 0 }))).toMatchObject({ kind: 'write', failedAttempts: 1 });
  });

  it('the larger count wins: a replay is unchanged, a late older delivery never lowers it, a newer one raises it', () => {
    const recorded = failureRow({ failedAttempts: 3, lastPaymentFailedAt: CREATED_2 });
    expect(decideRenewalFailure(recorded, failureFacts({ attemptCount: 3, failedAtIso: CREATED_2 }))).toEqual({ kind: 'unchanged' });
    expect(decideRenewalFailure(recorded, failureFacts({ attemptCount: 1, failedAtIso: CREATED_1 }))).toEqual({ kind: 'unchanged' });
    expect(decideRenewalFailure(failureRow({ failedAttempts: 1, lastPaymentFailedAt: CREATED_1 }), failureFacts({ attemptCount: 2, failedAtIso: CREATED_2 }))).toEqual({
      kind: 'write',
      failedAttempts: 2,
      lastPaymentFailedAt: CREATED_2,
      actionRequiredInvoiceUrl: null,
    });
  });

  it('event.created is never compared with a Stripe date: a real-time created far BEFORE the clock-time period still records, and one far AFTER a paid period is still moot', () => {
    expect(decideRenewalFailure(failureRow(), failureFacts({ failedAtIso: '2020-01-01T00:00:00.000Z' }))).toMatchObject({ kind: 'write', failedAttempts: 1 });
    expect(decideRenewalFailure(failureRow({ currentPeriodEnd: P2 }), failureFacts({ failedAtIso: '2099-01-01T00:00:00.000Z' }))).toEqual({ kind: 'moot', reason: 'period_already_paid' });
  });

  it('action required stores a Stripe-hosted URL; a non-Stripe URL is never stored', () => {
    expect(decideRenewalFailure(failureRow(), failureFacts({ actionRequired: true, attemptCount: 0, hostedInvoiceUrl: HOSTED }))).toMatchObject({ kind: 'write', actionRequiredInvoiceUrl: HOSTED });
    expect(decideRenewalFailure(failureRow(), failureFacts({ actionRequired: true, hostedInvoiceUrl: 'https://example.invalid/scrubbed' }))).toMatchObject({ kind: 'write', actionRequiredInvoiceUrl: null });
  });

  it('X-5 order either way: a plain failure on the SAME invoice keeps the URL; on another invoice it clears it', () => {
    const asked = failureRow({ failedAttempts: 1, lastPaymentFailedAt: CREATED_1, actionRequiredInvoiceUrl: HOSTED });
    expect(decideRenewalFailure(asked, failureFacts({ attemptCount: 0, hostedInvoiceUrl: HOSTED }))).toEqual({ kind: 'unchanged' });
    expect(decideRenewalFailure(asked, failureFacts({ attemptCount: 1, periodEndIso: P3, invoiceId: 'in_next', hostedInvoiceUrl: HOSTED_OTHER, failedAtIso: CREATED_2 }))).toMatchObject({
      kind: 'write',
      actionRequiredInvoiceUrl: null,
    });
    // The other order: the failure first, then the action-required on the same invoice.
    const failedFirst = failureRow({ failedAttempts: 1, lastPaymentFailedAt: CREATED_1 });
    expect(decideRenewalFailure(failedFirst, failureFacts({ actionRequired: true, attemptCount: 0, hostedInvoiceUrl: HOSTED }))).toEqual({
      kind: 'write',
      failedAttempts: 1,
      lastPaymentFailedAt: CREATED_1,
      actionRequiredInvoiceUrl: HOSTED,
    });
  });
});

describe('decideRenewalCure (SA C-1 ruling, rule 5): only the newest paid invoice clears', () => {
  const cureRow = (overrides: Record<string, unknown> = {}) => ({
    stripeSubscriptionId: SUB,
    currentPeriodEnd: P2,
    failedAttempts: 2,
    actionRequiredInvoiceUrl: null,
    ...overrides,
  });

  it.each([
    ['no row', null, P2, { kind: 'nothing', reason: 'no_row' }],
    ['another subscription', cureRow({ stripeSubscriptionId: 'sub_other' }), P2, { kind: 'nothing', reason: 'other_subscription' }],
    ['nothing to clear', cureRow({ failedAttempts: 0 }), P2, { kind: 'nothing', reason: 'no_failure' }],
    ['no period on the row', cureRow({ currentPeriodEnd: null }), P2, { kind: 'nothing', reason: 'no_period' }],
    ['a late replay of an OLDER paid invoice', cureRow(), T1, { kind: 'nothing', reason: 'older_invoice' }],
    ['the paid invoice is the newest (P = current_period_end)', cureRow(), P2, { kind: 'clear' }],
    ['only the URL is left', cureRow({ failedAttempts: 0, actionRequiredInvoiceUrl: HOSTED }), P2, { kind: 'clear' }],
  ])('%s', (_name, row, paid, expected) => {
    expect(decideRenewalCure(row as Parameters<typeof decideRenewalCure>[0], { stripeSubscriptionId: SUB, paidPeriodEndIso: paid as string })).toEqual(expected);
  });
});

/** A client whose reads answer `rows` in order and whose updates answer `counts` in order. */
function renewalClient(rows: Array<Record<string, unknown> | null>, counts: Array<number | { error: unknown }>) {
  let reads = 0;
  let writes = 0;
  return recordingClient((calls) => {
    if (calls.some((c) => c.method === 'update')) {
      const answer = counts[writes];
      writes += 1;
      return typeof answer === 'number' ? { data: null, error: null, count: answer } : { data: null, error: answer.error, count: null };
    }
    const row = rows[Math.min(reads, rows.length - 1)];
    reads += 1;
    return { data: row, error: null };
  });
}

const NOW = '2026-10-15T08:00:00.000Z';
const renewalInput = (overrides: Record<string, unknown> = {}) => ({
  userId: USER,
  livemode: false,
  stripeSubscriptionId: SUB,
  invoiceId: INVOICE,
  periodEndIso: P2,
  attemptCount: 1,
  failedAtIso: CREATED_1,
  hostedInvoiceUrl: null as string | null,
  nowIso: NOW,
  ...overrides,
});

/** PostgREST's own timestamp text, with microseconds, exactly as a select returns it. */
const RAW_PERIOD = '2026-12-15T07:05:22+00:00';
const RAW_FAILED = '2026-10-15T07:05:55.123456+00:00';

describe('recordRenewalFailure / recordActionRequired (SA C-2: read, decide, compare-and-set)', () => {
  it('refuses invalid input with no query', async () => {
    const { client, queries } = renewalClient([], []);
    const repo = new BusinessOsBillingAccountRepository(client);
    for (const bad of [
      { userId: 'nope' },
      { stripeSubscriptionId: 'cus_x' },
      { invoiceId: 'inv_x' },
      { periodEndIso: '2027-01-15' },
      { failedAtIso: 'yesterday' },
      { attemptCount: -1 },
      { attemptCount: 1.5 },
      { hostedInvoiceUrl: 7 },
      { livemode: 'false' },
    ]) {
      const result = await repo.recordRenewalFailure(renewalInput(bad) as never);
      expect(result.error?.message).toBe('invalid_input');
    }
    expect(queries).toEqual([]);
  });

  it('reads the row by user and mode, then writes exactly four columns with a compare-and-set on every value it read', async () => {
    const { client, queries } = renewalClient(
      [rowRaw({ stripe_subscription_id: SUB, subscription_status: 'past_due', current_period_end: RAW_PERIOD, last_invoice_id: 'in_paid_before', failed_attempts: 1, last_payment_failed_at: RAW_FAILED })],
      [1]
    );
    const repo = new BusinessOsBillingAccountRepository(client);
    const result = await repo.recordRenewalFailure(renewalInput({ attemptCount: 2, failedAtIso: CREATED_2 }));
    expect(result).toEqual({ data: { outcome: 'recorded', failedAttempts: 2, actionRequiredUrlStored: false }, error: null });

    expect(queries).toHaveLength(2);
    const [read, write] = queries;
    expect(argsOf(read, 'eq')).toEqual([['user_id', USER], ['livemode', false]]);
    expect(argsOf(write, 'update')).toEqual([
      [{ failed_attempts: 2, last_payment_failed_at: CREATED_2, action_required_invoice_url: null, updated_at: NOW }, { count: 'exact' }],
    ]);
    expect(argsOf(write, 'eq')).toEqual([
      ['user_id', USER],
      ['livemode', false],
      ['stripe_subscription_id', SUB],
      ['failed_attempts', 1],
      ['current_period_end', RAW_PERIOD],
      ['last_invoice_id', 'in_paid_before'],
      ['last_payment_failed_at', RAW_FAILED],
    ]);
    expect(argsOf(write, 'is')).toEqual([['action_required_invoice_url', null]]);
    expect(write.map((c) => c.method)).not.toEqual(expect.arrayContaining(['select']));
    expect(write.map((c) => c.method)).not.toEqual(expect.arrayContaining(['or']));
    expect(write[write.length - 1].method).toBe('await');
  });

  it('NULL read values are compared with IS NULL', async () => {
    const { client, queries } = renewalClient([rowRaw({ stripe_subscription_id: SUB, current_period_end: null, last_invoice_id: null })], [1]);
    await new BusinessOsBillingAccountRepository(client).recordRenewalFailure(renewalInput());
    expect(argsOf(queries[1], 'is')).toEqual([
      ['current_period_end', null],
      ['last_invoice_id', null],
      ['action_required_invoice_url', null],
      ['last_payment_failed_at', null],
    ]);
  });

  it('moot and unchanged decisions write nothing', async () => {
    const paid = renewalClient([rowRaw({ stripe_subscription_id: SUB, current_period_end: P2 })], []);
    expect((await new BusinessOsBillingAccountRepository(paid.client).recordRenewalFailure(renewalInput())).data).toEqual({ outcome: 'moot', reason: 'period_already_paid' });
    expect(paid.queries).toHaveLength(1);

    const other = renewalClient([rowRaw({ stripe_subscription_id: 'sub_other' })], []);
    expect((await new BusinessOsBillingAccountRepository(other.client).recordRenewalFailure(renewalInput())).data).toEqual({ outcome: 'moot', reason: 'other_subscription' });

    const none = renewalClient([null], []);
    expect((await new BusinessOsBillingAccountRepository(none.client).recordRenewalFailure(renewalInput())).data).toEqual({ outcome: 'moot', reason: 'no_row' });

    const replay = renewalClient([rowRaw({ stripe_subscription_id: SUB, current_period_end: T1, failed_attempts: 1, last_payment_failed_at: CREATED_1 })], []);
    expect((await new BusinessOsBillingAccountRepository(replay.client).recordRenewalFailure(renewalInput())).data).toEqual({ outcome: 'unchanged' });
    expect(replay.queries).toHaveLength(1);
  });

  it('a lost compare-and-set re-reads and re-decides once; two lost rounds are concurrent_change', async () => {
    const before = rowRaw({ stripe_subscription_id: SUB, current_period_end: T1 });
    const won = renewalClient([before, rowRaw({ stripe_subscription_id: SUB, current_period_end: T1, failed_attempts: 1, last_payment_failed_at: CREATED_1 })], [0, 1]);
    const second = await new BusinessOsBillingAccountRepository(won.client).recordRenewalFailure(renewalInput({ attemptCount: 2, failedAtIso: CREATED_2 }));
    expect(second.data).toEqual({ outcome: 'recorded', failedAttempts: 2, actionRequiredUrlStored: false });
    expect(won.queries).toHaveLength(4);

    // The re-read shows the cure landed meanwhile: moot, nothing more.
    const cured = renewalClient([before, rowRaw({ stripe_subscription_id: SUB, current_period_end: P2 })], [0]);
    expect((await new BusinessOsBillingAccountRepository(cured.client).recordRenewalFailure(renewalInput())).data).toEqual({ outcome: 'moot', reason: 'period_already_paid' });

    const lost = renewalClient([before, before], [0, 0]);
    const result = await new BusinessOsBillingAccountRepository(lost.client).recordRenewalFailure(renewalInput());
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('concurrent_change');
  });

  it('a database error is returned, never thrown', async () => {
    const failing = renewalClient([rowRaw({ stripe_subscription_id: SUB, current_period_end: T1 })], [{ error: { code: 'XX000', message: 'boom' } }]);
    const result = await new BusinessOsBillingAccountRepository(failing.client).recordRenewalFailure(renewalInput());
    expect(result.error?.message).toBe('boom');
  });

  it('recordActionRequired stores the hosted URL; the URL appears in no log line', async () => {
    const { client, queries } = renewalClient([rowRaw({ stripe_subscription_id: SUB, current_period_end: T1 })], [0, 1]);
    const result = await new BusinessOsBillingAccountRepository(client).recordActionRequired(renewalInput({ attemptCount: 0, hostedInvoiceUrl: HOSTED }));
    expect(result.data).toEqual({ outcome: 'recorded', failedAttempts: 1, actionRequiredUrlStored: true });
    expect(argsOf(queries[3], 'update')[0][0]).toMatchObject({ action_required_invoice_url: HOSTED });
    expect(mockWarn).toHaveBeenCalled();
    expect(JSON.stringify([mockWarn.mock.calls, mockError.mock.calls])).not.toContain('invoice.stripe.com');
  });

  it('a plain failure never stores a URL, even a Stripe-hosted one', async () => {
    const { client, queries } = renewalClient([rowRaw({ stripe_subscription_id: SUB, current_period_end: T1 })], [1]);
    await new BusinessOsBillingAccountRepository(client).recordRenewalFailure(renewalInput({ hostedInvoiceUrl: HOSTED }));
    expect(argsOf(queries[1], 'update')[0][0]).toMatchObject({ action_required_invoice_url: null });
  });
});

describe('clearRenewalFailure (SA C-1 ruling, rule 5)', () => {
  const clearInput = (overrides: Record<string, unknown> = {}) => ({
    userId: USER,
    livemode: false,
    stripeSubscriptionId: SUB,
    paidPeriodEndIso: P2,
    nowIso: NOW,
    ...overrides,
  });

  it('refuses invalid input with no query', async () => {
    const { client, queries } = renewalClient([], []);
    const repo = new BusinessOsBillingAccountRepository(client);
    for (const bad of [{ userId: 'x' }, { stripeSubscriptionId: 'x' }, { paidPeriodEndIso: 'x' }, { nowIso: 'x' }]) {
      expect((await repo.clearRenewalFailure(clearInput(bad) as never)).error?.message).toBe('invalid_input');
    }
    expect(queries).toEqual([]);
  });

  it('the newest paid invoice clears the marker and the URL, keeps the date, by compare-and-set', async () => {
    const { client, queries } = renewalClient(
      [rowRaw({ stripe_subscription_id: SUB, current_period_end: '2027-01-15T07:05:22+00:00', failed_attempts: 2, action_required_invoice_url: HOSTED, last_payment_failed_at: RAW_FAILED })],
      [1]
    );
    const result = await new BusinessOsBillingAccountRepository(client).clearRenewalFailure(clearInput());
    expect(result).toEqual({ data: { outcome: 'cleared' }, error: null });
    const write = queries[1];
    expect(argsOf(write, 'update')).toEqual([[{ failed_attempts: 0, action_required_invoice_url: null, updated_at: NOW }, { count: 'exact' }]]);
    expect(argsOf(write, 'eq')).toEqual([
      ['user_id', USER],
      ['livemode', false],
      ['stripe_subscription_id', SUB],
      ['failed_attempts', 2],
      ['current_period_end', '2027-01-15T07:05:22+00:00'],
      ['action_required_invoice_url', HOSTED],
    ]);
    expect(write.map((c) => c.method)).not.toEqual(expect.arrayContaining(['select']));
    expect(write.map((c) => c.method)).not.toEqual(expect.arrayContaining(['or']));
  });

  it('an older paid invoice, or nothing to clear, writes nothing', async () => {
    const older = renewalClient([rowRaw({ stripe_subscription_id: SUB, current_period_end: P2, failed_attempts: 2 })], []);
    expect((await new BusinessOsBillingAccountRepository(older.client).clearRenewalFailure(clearInput({ paidPeriodEndIso: T1 }))).data).toEqual({ outcome: 'nothing', reason: 'older_invoice' });
    expect(older.queries).toHaveLength(1);

    const clean = renewalClient([rowRaw({ stripe_subscription_id: SUB, current_period_end: P2 })], []);
    expect((await new BusinessOsBillingAccountRepository(clean.client).clearRenewalFailure(clearInput())).data).toEqual({ outcome: 'nothing', reason: 'no_failure' });
  });

  it('two lost rounds are concurrent_change; one is retried', async () => {
    const row = rowRaw({ stripe_subscription_id: SUB, current_period_end: P2, failed_attempts: 2 });
    const retried = renewalClient([row, row], [0, 1]);
    expect((await new BusinessOsBillingAccountRepository(retried.client).clearRenewalFailure(clearInput())).data).toEqual({ outcome: 'cleared' });
    const lost = renewalClient([row, row], [0, 0]);
    expect((await new BusinessOsBillingAccountRepository(lost.client).clearRenewalFailure(clearInput())).error?.message).toBe('concurrent_change');
  });
});

describe('current_period_end is written only by the paid apply path (SA C-1 ruling, rule 3)', () => {
  const lf = (text: string) => text.replace(/\r\n/g, '\n');

  it('in this repository, the only UPDATE payload naming current_period_end is the TEST MODE attach, which clears it', () => {
    const code = lf(fs.readFileSync(path.join(ROOT, 'lib', 'repositories', 'BusinessOsBillingAccountRepository.ts'), 'utf8'));
    const writers: string[] = [];
    const starts = [...code.matchAll(/\n {2}(?:private )?async (\w+)\(/g)].map((m) => ({ name: m[1], at: m.index ?? 0 }));
    expect(starts.length).toBeGreaterThanOrEqual(12);
    starts.forEach((start, i) => {
      const body = code.slice(start.at, i + 1 < starts.length ? starts[i + 1].at : code.length);
      for (const update of body.matchAll(/\.update\(([\s\S]*?)\{ count: 'exact' \}/g)) {
        if (/current_period_end\s*:/.test(update[1])) writers.push(start.name);
      }
    });
    expect(writers).toEqual(['attachTestClockCustomer']);
    expect(code).toMatch(/current_period_end: null,/);
  });

  it('no other application file opens a query on the billing table, and the finance read repository no longer opens it', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', '.next', '.claude', 'coverage', '__tests__'].includes(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) {
          const text = fs.readFileSync(full, 'utf8');
          if (/\.from\(\s*(BOS_BILLING_ACCOUNTS_TABLE|['"]business_os_billing_accounts['"])/.test(text)) {
            offenders.push(path.relative(ROOT, full).split(path.sep).join('/'));
          }
        }
      }
    };
    for (const dir of ['app', 'lib', 'components', 'hooks']) walk(path.join(ROOT, dir));
    // Plan payments P-8a.1: the admin Subscriptions read joins as a third, read-only reader (one mode per read, PF-15).
    // R4-FU-1 (finance follow-ups bundle, SA-WP-FU, ruled): the finance read repository LEAVES the list
    // (R-c and R-c′ removed; Finance reads status through the admin read repository's current-mode reader).
    expect(offenders.sort()).toEqual([
      'lib/repositories/BusinessOsBillingAccountRepository.ts',
      'lib/repositories/BusinessOsBillingAdminReadRepository.ts',
    ]);
    const finance = fs.readFileSync(path.join(ROOT, 'lib', 'repositories', 'BusinessOsFinanceReadRepository.ts'), 'utf8');
    expect(finance).not.toMatch(/\.(update|insert|upsert|delete|rpc)\(/);
    const adminRead = fs.readFileSync(path.join(ROOT, 'lib', 'repositories', 'BusinessOsBillingAdminReadRepository.ts'), 'utf8');
    expect(adminRead).not.toMatch(/\.(update|insert|upsert|delete|rpc)\(/);
  });

  it('in SQL, only the apply function (20261027, replaced by 20261028) updates the billing table', () => {
    const dir = path.join(ROOT, 'supabase', 'migrations');
    const updaters = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .filter((name) => /UPDATE\s+public\.business_os_billing_accounts/i.test(fs.readFileSync(path.join(dir, name), 'utf8')))
      .sort();
    expect(updaters).toEqual(['20261027_business_os_billing_events.sql', '20261028_business_os_first_payment_stamp.sql']);
    for (const name of updaters) {
      const sql = lf(fs.readFileSync(path.join(dir, name), 'utf8'));
      const at = sql.search(/UPDATE\s+public\.business_os_billing_accounts/i);
      const fnStart = sql.lastIndexOf('FUNCTION', at);
      expect(fnStart).toBeGreaterThan(0);
      expect(sql.slice(fnStart, fnStart + 80)).toContain('business_os_apply_plan_payment');
    }
  });
});
