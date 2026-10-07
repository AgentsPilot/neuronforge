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
  type BusinessOsBillingCustomerInput,
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
      for (const method of ['select', 'eq', 'or', 'insert', 'update', 'upsert', 'delete']) {
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

describe('source guards', () => {
  const source = fs.readFileSync(path.join(ROOT, 'lib', 'repositories', 'BusinessOsBillingAccountRepository.ts'), 'utf8');
  const code = source.replace(/\/\/.*$/gm, '');

  it('the column list equals the migration columns, in order, and never *', () => {
    expect(BILLING_ACCOUNT_COLUMNS).not.toContain('*');
    expect(BILLING_ACCOUNT_COLUMNS.split(', ')).toEqual(migrationColumns());
  });

  it('scope (P-2a SA Q-9, P-3a §3.5): one insert, two compare-and-set updates, no delete, no upsert, no rpc, no spread into a payload', () => {
    expect(code.match(/\.insert\(/g)).toHaveLength(1);
    expect(code.match(/\.update\(/g)).toHaveLength(2);
    expect(code).not.toMatch(/\.(delete|upsert|rpc)\(/);
    expect(code).not.toMatch(/\.update\(\{\s*\.\.\./);
    // UPDATE + .or() + .select() fails 42703 in production (2026-09-29): the
    // two compare-and-set methods must never select.
    const lf = code.replace(/\r\n/g, '\n');
    for (const method of ['acquireCheckoutLock', 'replaceCustomer']) {
      const start = lf.indexOf(`async ${method}(`);
      const end = lf.indexOf('\n  }\n', start);
      expect(start).toBeGreaterThan(0);
      expect(end).toBeGreaterThan(start);
      const body = lf.slice(start, end);
      expect(body).toContain("{ count: 'exact' }");
      expect(body).not.toMatch(/\.select\(|\.single\(|\.maybeSingle\(/);
    }
    expect(code).not.toMatch(/\.insert\(\{\s*\.\.\./);
    expect(code).not.toMatch(/select\(\s*['"]\*['"]/);
  });

  it('the read and both updates scope by user_id and livemode; the other from() is the three-field insert', () => {
    expect(code.match(/\.from\(/g)).toHaveLength(4);
    expect(code.match(/\.maybeSingle\(\)/g)).toHaveLength(1);
    expect(code.match(/\.eq\('user_id', userId\)/g)).toHaveLength(3);
    expect(code.match(/\.eq\('livemode', livemode\)/g)).toHaveLength(3);
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
      // Plan payments P-3a: the checkout route's integration test fakes the
      // repository module by name. The route itself does not name it.
      'app/api/business-os/billing/plan/checkout/__tests__/route.test.ts',
      // Not a caller: the P1-C6 / M-1 placement guard names the repository's
      // module path to assert the allow-listed billing files are its only billing importers.
      'app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts',
      'lib/business-os/billing/__tests__/businessOsStripeCustomer.test.ts',
      // P-3a: imports the billing row TYPE to build fakes.
      'lib/business-os/billing/__tests__/planCheckout.test.ts',
      'lib/business-os/billing/businessOsStripeCustomer.ts',
      // Plan payments P-3a: the checkout reads the billing row and records the
      // lock (findByUser, acquireCheckoutLock; replaceCustomer via the customer
      // function).
      'lib/business-os/billing/planCheckout.ts',
      // Admin delete AD-1b (SC-5): R-3 reads BOTH livemode rows of the target's
      // plan billing account (findByUser only); the evaluator imports the status
      // type. Their tests name it to fake it. No entitlements import.
      'lib/business-os/purge/__tests__/AdminDeletionPreview.test.ts',
      'lib/business-os/purge/__tests__/adminDeletionRefusals.test.ts',
      // AD-2a: the read moved verbatim to adminDeletionFacts.ts (shared by the
      // preview and the commit gate). Kept in sorted order: the guard compares
      // against found.sort().
      'lib/business-os/purge/adminDeletionFacts.ts',
      'lib/business-os/purge/adminDeletionRefusals.ts',
      'lib/repositories/BusinessOsBillingAccountRepository.ts',
      'lib/repositories/__tests__/BusinessOsBillingAccountRepository.test.ts',
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
