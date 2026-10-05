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
  type BusinessOsBillingCustomerInput,
} from '@/lib/repositories/BusinessOsBillingAccountRepository';

const ROOT = process.cwd();
const USER = '11111111-1111-4111-8111-111111111111';
const ROW_ID = '22222222-2222-4222-8222-222222222222';

type Call = { method: string; args: unknown[] };
type Answer = { data: unknown; error: unknown };

/** Records every from() query; each terminal call answers `respond(calls, index)`. */
function recordingClient(respond: (calls: Call[], index: number) => Answer) {
  const queries: Call[][] = [];
  const client = {
    from: (table: string) => {
      const calls: Call[] = [{ method: 'from', args: [table] }];
      const index = queries.length;
      queries.push(calls);
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'insert', 'update', 'upsert', 'delete']) {
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

describe('source guards', () => {
  const source = fs.readFileSync(path.join(ROOT, 'lib', 'repositories', 'BusinessOsBillingAccountRepository.ts'), 'utf8');
  const code = source.replace(/\/\/.*$/gm, '');

  it('the column list equals the migration columns, in order, and never *', () => {
    expect(BILLING_ACCOUNT_COLUMNS).not.toContain('*');
    expect(BILLING_ACCOUNT_COLUMNS.split(', ')).toEqual(migrationColumns());
  });

  it('P-2a scope (SA Q-9): one insert, no update, no delete, no upsert, no rpc, no spread into a payload', () => {
    expect(code.match(/\.insert\(/g)).toHaveLength(1);
    expect(code).not.toMatch(/\.(update|delete|upsert|rpc)\(/);
    expect(code).not.toMatch(/\.insert\(\{\s*\.\.\./);
    expect(code).not.toMatch(/select\(\s*['"]\*['"]/);
  });

  it('the one read scopes by user_id and livemode; the other from() is the three-field insert', () => {
    expect(code.match(/\.from\(/g)).toHaveLength(2);
    expect(code.match(/\.maybeSingle\(\)/g)).toHaveLength(1);
    expect(code.match(/\.eq\('user_id', userId\)/g)).toHaveLength(1);
    expect(code.match(/\.eq\('livemode', livemode\)/g)).toHaveLength(1);
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
   * function and its test (SA Q-11). A new caller is added here, in a
   * reviewable diff, or this test fails.
   */
  it('only the listed files name the repository', () => {
    const ALLOWED = [
      // Not a caller: the P1-C6 / M-1 placement guard names the repository's
      // module path to assert businessOsStripeCustomer.ts is its only billing importer.
      'app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts',
      'lib/business-os/billing/__tests__/businessOsStripeCustomer.test.ts',
      'lib/business-os/billing/businessOsStripeCustomer.ts',
      // Admin delete AD-1b (SC-5): R-3 reads BOTH livemode rows of the target's
      // plan billing account (findByUser only); the evaluator imports the status
      // type. Their tests name it to fake it. No entitlements import.
      'lib/business-os/purge/AdminDeletionPreview.ts',
      'lib/business-os/purge/__tests__/AdminDeletionPreview.test.ts',
      'lib/business-os/purge/__tests__/adminDeletionRefusals.test.ts',
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
