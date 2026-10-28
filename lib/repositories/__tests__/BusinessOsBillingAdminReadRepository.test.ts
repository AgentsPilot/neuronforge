/**
 * The admin billing read (plan payments P-8a.1, R-p; SA-WP-P8a P8A-R2 paging
 * and P8A-R3 columns; workplan AC-P8a.4).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {
      info: (...a: unknown[]) => mockLog.info(...a),
      warn: (...a: unknown[]) => mockLog.warn(...a),
      error: (...a: unknown[]) => mockLog.error(...a),
      debug: (...a: unknown[]) => mockLog.debug(...a),
    };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import {
  ADMIN_BILLING_PANEL_COLUMNS,
  ADMIN_BILLING_READ_LIMITS,
  ADMIN_BILLING_ROW_COLUMNS,
  AdminBillingReadCeilingError,
  AdminBillingReadDuplicateError,
  AdminBillingReadIsolationError,
  BusinessOsBillingAdminReadRepository,
  FIRST_PAYMENT_RANGE_MAX_DAYS,
  FIRST_PLAN_PAYMENT_COLUMNS,
  FIRST_PLAN_PAYMENTS_VIEW,
  type AdminBillingRow,
} from '../BusinessOsBillingAdminReadRepository';

type Call = { method: string; args: unknown[] };
type Response = { data?: unknown; error: unknown };

function recordingClient(respond: (calls: Call[], index: number) => Response) {
  const queries: Call[][] = [];
  const client = {
    from: (table: string) => {
      const calls: Call[] = [{ method: 'from', args: [table] }];
      const index = queries.length;
      queries.push(calls);
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'gt', 'gte', 'lt', 'not', 'in', 'order', 'limit', 'maybeSingle']) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ method, args });
          return builder;
        };
      }
      builder.then = (resolve: (v: unknown) => void) => resolve(respond(calls, index));
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, queries };
}

const argsOf = (calls: Call[], method: string) => calls.filter((c) => c.method === method).map((c) => c.args);

function billingRow(n: number, patch: Partial<AdminBillingRow> = {}): AdminBillingRow {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    user_id: `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`,
    livemode: false,
    subscription_status: 'active',
    bought_tier: 'some_tier',
    current_period_end: '2026-11-01T00:00:00.000Z',
    cancel_at_period_end: false,
    pending_tier: null,
    last_paid_at: '2026-10-01T00:00:00.000Z',
    last_payment_failed_at: null,
    failed_attempts: 0,
    founder_discount_applied_at: null,
    ended_at: null,
    ...patch,
  };
}

const rows = (from: number, count: number) => Array.from({ length: count }, (_, i) => billingRow(from + i));

beforeEach(() => jest.clearAllMocks());

describe('columns (P8A-R3)', () => {
  const columns = ADMIN_BILLING_ROW_COLUMNS.split(',').map((c) => c.trim());

  it('selects exactly the columns the list needs', () => {
    expect(columns).toEqual([
      'id',
      'user_id',
      'livemode',
      'subscription_status',
      'bought_tier',
      'current_period_end',
      'cancel_at_period_end',
      'pending_tier',
      'last_paid_at',
      'last_payment_failed_at',
      'failed_attempts',
      'founder_discount_applied_at',
      'ended_at',
    ]);
  });

  it('never selects the checkout lock, the bearer invoice link or a Stripe id', () => {
    for (const column of columns) {
      expect(column).not.toMatch(/open_checkout|action_required_invoice_url|stripe_/);
    }
  });

  it('every column exists in the billing-accounts migration (business-os-schema-check)', () => {
    const migration = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20261025_business_os_billing_accounts.sql'),
      'utf8'
    );
    for (const column of columns) expect(migration).toMatch(new RegExp(`\\n\\s+${column} [a-z]`));
  });
});

describe('listBillingRowsForModeAllAccounts (R-p)', () => {
  it('reads one mode, keyset on id, at most 1,000 rows per request', async () => {
    const { client, queries } = recordingClient(() => ({ data: rows(1, 2), error: null }));
    const result = await new BusinessOsBillingAdminReadRepository(client).listBillingRowsForModeAllAccounts(false);

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(2);
    expect(queries).toHaveLength(1);
    const q = queries[0];
    expect(q[0].args).toEqual(['business_os_billing_accounts']);
    expect(argsOf(q, 'select')).toEqual([[ADMIN_BILLING_ROW_COLUMNS]]);
    expect(argsOf(q, 'eq')).toEqual([['livemode', false]]);
    expect(argsOf(q, 'gt')).toEqual([]);
    expect(argsOf(q, 'order')).toEqual([['id', { ascending: true }]]);
    expect(argsOf(q, 'limit')).toEqual([[1000]]);
    expect(ADMIN_BILLING_READ_LIMITS.PAGE_SIZE).toBeLessThanOrEqual(1000);
  });

  it('passes the live mode through as asked', async () => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    await new BusinessOsBillingAdminReadRepository(client).listBillingRowsForModeAllAccounts(true);
    expect(argsOf(queries[0], 'eq')).toEqual([['livemode', true]]);
  });

  it('a page of exactly 1,000 rows asks for the next page after the last id (P8A-R2)', async () => {
    const first = rows(1, 1000);
    const { client, queries } = recordingClient((_calls, index) =>
      index === 0 ? { data: first, error: null } : { data: rows(1001, 3), error: null }
    );
    const result = await new BusinessOsBillingAdminReadRepository(client).listBillingRowsForModeAllAccounts(false);

    expect(result.data).toHaveLength(1003);
    expect(queries).toHaveLength(2);
    expect(argsOf(queries[1], 'gt')).toEqual([['id', first[999].id]]);
    expect(argsOf(queries[1], 'eq')).toEqual([['livemode', false]]);
    expect(argsOf(queries[1], 'limit')).toEqual([[1000]]);
  });

  it('includes rows detached from a deleted account (user_id NULL)', async () => {
    const { client } = recordingClient(() => ({ data: [billingRow(1, { user_id: null })], error: null }));
    const result = await new BusinessOsBillingAdminReadRepository(client).listBillingRowsForModeAllAccounts(false);
    expect(result.data?.[0].user_id).toBeNull();
  });

  it('reaching the ceiling is an ERROR, never a partial list', async () => {
    const { client } = recordingClient(() => ({ data: rows(1, 2), error: null }));
    const result = await new BusinessOsBillingAdminReadRepository(client).listBillingRowsForModeAllAccounts(false, {
      pageSize: 2,
      ceiling: 4,
    });
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(AdminBillingReadCeilingError);
  });

  it.each([0, 1001, 1.5])('refuses a page size of %p before querying', async (pageSize) => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    const result = await new BusinessOsBillingAdminReadRepository(client).listBillingRowsForModeAllAccounts(false, { pageSize });
    expect(result.error).toBeInstanceOf(Error);
    expect(queries).toHaveLength(0);
    expect(mockLog.warn).toHaveBeenCalled();
  });

  it('refuses a mode that is not a boolean before querying', async () => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    const result = await new BusinessOsBillingAdminReadRepository(client).listBillingRowsForModeAllAccounts(
      'false' as unknown as boolean
    );
    expect(result.error).toBeInstanceOf(Error);
    expect(queries).toHaveLength(0);
  });

  it('a database error is returned, never thrown, and logged at error', async () => {
    const { client } = recordingClient(() => ({ data: null, error: new Error('boom') }));
    const result = await new BusinessOsBillingAdminReadRepository(client).listBillingRowsForModeAllAccounts(false);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('boom');
    expect(mockLog.error).toHaveBeenCalled();
  });

  it('logs counts only, never an account id', async () => {
    const { client } = recordingClient(() => ({ data: rows(1, 1), error: null }));
    await new BusinessOsBillingAdminReadRepository(client).listBillingRowsForModeAllAccounts(false);
    expect(JSON.stringify(mockLog.info.mock.calls)).not.toContain('11111111-1111-4111-8111');
  });
});

describe('source: read-only', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'BusinessOsBillingAdminReadRepository.ts'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('names no write call', () => {
    expect(code).not.toMatch(/\.(insert|update|upsert|delete|rpc)\s*\(/);
  });

  it('every .from( names a billing table, and every read filters livemode', () => {
    // P-8a.2: two reads (R-p and R-p′), each with its own mode filter.
    // MK-5b (SA-10): one more, the first plan payment, with its own mode filter.
    // MK5B-FU-1 (SA-WP-M5F): the first-payment reads moved from the billing events table to the read-only
    // view (named by its constant), and Q1 joined them: two view reads, each with its own mode filter.
    // The billing events table is no longer read here.
    expect([...code.matchAll(/\.from\(\s*'([a-z_]+)'\s*\)/g)].map((m) => m[1])).toEqual([
      'business_os_billing_accounts',
      'business_os_billing_accounts',
    ]);
    expect((code.match(/\.from\(FIRST_PLAN_PAYMENTS_VIEW\)/g) ?? []).length).toBe(2);
    expect(code).toContain("export const FIRST_PLAN_PAYMENTS_VIEW = 'business_os_first_plan_payments';");
    expect((code.match(/\.from\s*\(/g) ?? []).length).toBe(4);
    expect((code.match(/\.eq\('livemode', livemode\)/g) ?? []).length).toBe(4);
    expect(code).not.toContain('business_os_billing_events');
  });

  it('MK-5b: the first-payment read names no boost table (a boost is never a first payment, PAY SR-6)', () => {
    expect(code).not.toMatch(/boost/i);
  });
});

describe('findBillingRowForAccount (R-p′, P-8a.2)', () => {
  const ACCOUNT = '11111111-1111-4111-8111-000000000001';

  it('selects the panel columns: the list columns plus the customer id, nothing secret', () => {
    const columns = ADMIN_BILLING_PANEL_COLUMNS.split(',').map((c) => c.trim());
    expect(columns).toEqual([...ADMIN_BILLING_ROW_COLUMNS.split(',').map((c) => c.trim()), 'stripe_customer_id']);
    for (const column of columns) {
      expect(column).not.toMatch(/open_checkout|action_required_invoice_url|stripe_subscription_id|invoice_id/);
    }
  });

  it('reads one account in one mode, maybeSingle', async () => {
    const row = { ...billingRow(1), stripe_customer_id: 'cus_Test1' };
    const { client, queries } = recordingClient(() => ({ data: row, error: null }));
    const result = await new BusinessOsBillingAdminReadRepository(client).findBillingRowForAccount(ACCOUNT, true);
    expect(result).toEqual({ data: row, error: null });
    const q = queries[0];
    expect(q[0].args).toEqual(['business_os_billing_accounts']);
    expect(argsOf(q, 'select')).toEqual([[ADMIN_BILLING_PANEL_COLUMNS]]);
    expect(argsOf(q, 'eq')).toEqual([
      ['user_id', ACCOUNT],
      ['livemode', true],
    ]);
    expect(argsOf(q, 'maybeSingle')).toEqual([[]]);
  });

  it('no row is null, not an error', async () => {
    const { client } = recordingClient(() => ({ data: null, error: null }));
    expect(await new BusinessOsBillingAdminReadRepository(client).findBillingRowForAccount(ACCOUNT, false)).toEqual({
      data: null,
      error: null,
    });
  });

  it.each(['', 'not-a-uuid', "x' or 1=1"])('refuses the account id %p before querying', async (id) => {
    const { client, queries } = recordingClient(() => ({ data: null, error: null }));
    const result = await new BusinessOsBillingAdminReadRepository(client).findBillingRowForAccount(id, false);
    expect(result.error).toBeInstanceOf(Error);
    expect(queries).toHaveLength(0);
  });

  it('a database error is returned, never thrown', async () => {
    const { client } = recordingClient(() => ({ data: null, error: new Error('boom') }));
    const result = await new BusinessOsBillingAdminReadRepository(client).findBillingRowForAccount(ACCOUNT, false);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('boom');
  });
});

// ── Money MK-5b (SA-10), re-sourced by MK5B-FU-1 (SA-WP-M5F): the first plan payment per account ──
describe('listFirstPlanPaymentsForAccounts (MK-5b, SA-10; MK5B-FU-1 view)', () => {
  const id = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`;
  const ids = (count: number, from = 1) => Array.from({ length: count }, (_, i) => id(from + i));
  const viewRow = (userN: number, at: string) => ({ user_id: id(userN), first_payment_at: at });
  const read = (client: SupabaseClient) => new BusinessOsBillingAdminReadRepository(client);

  it('R-1: one query of the first-payment VIEW, one mode, the asked ids, keyset on user_id, at most 1,000 rows', async () => {
    const { client, queries } = recordingClient(() => ({ data: [viewRow(1, '2026-10-05T10:00:00.000Z')], error: null }));
    const result = await read(client).listFirstPlanPaymentsForAccounts([id(1)], false);

    expect(result).toEqual({ data: [{ user_id: id(1), paid_at: '2026-10-05T10:00:00.000Z' }], error: null });
    expect(queries).toHaveLength(1);
    const q = queries[0];
    expect(q[0].args).toEqual([FIRST_PLAN_PAYMENTS_VIEW]);
    expect(FIRST_PLAN_PAYMENTS_VIEW).toBe('business_os_first_plan_payments');
    expect(argsOf(q, 'select')).toEqual([[FIRST_PLAN_PAYMENT_COLUMNS]]);
    expect(FIRST_PLAN_PAYMENT_COLUMNS).toBe('user_id, first_payment_at');
    expect(argsOf(q, 'eq')).toEqual([['livemode', false]]);
    expect(argsOf(q, 'in')).toEqual([['user_id', [id(1)]]]);
    expect(argsOf(q, 'gt')).toEqual([]);
    expect(argsOf(q, 'order')).toEqual([['user_id', { ascending: true }]]);
    expect(argsOf(q, 'limit')).toEqual([[1000]]);
  });

  it('R-2: current mode only: the mode passes through as asked; a mode that is not a boolean reads nothing', async () => {
    const live = recordingClient(() => ({ data: [], error: null }));
    await read(live.client).listFirstPlanPaymentsForAccounts([id(1)], true);
    expect(argsOf(live.queries[0], 'eq')[0]).toEqual(['livemode', true]);

    const bad = recordingClient(() => ({ data: [], error: null }));
    const result = await read(bad.client).listFirstPlanPaymentsForAccounts([id(1)], 'true' as unknown as boolean);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(bad.queries).toHaveLength(0);
  });

  it('R-3: 250 ids are read in chunks of at most 100 (100, 100, 50), each with the mode filter', async () => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    const result = await read(client).listFirstPlanPaymentsForAccounts(ids(250), false);
    expect(result).toEqual({ data: [], error: null });
    expect(ADMIN_BILLING_READ_LIMITS.IN_CHUNK).toBe(100);
    expect(queries.map((q) => (argsOf(q, 'in')[0][1] as string[]).length)).toEqual([100, 100, 50]);
    expect(new Set(queries.flatMap((q) => argsOf(q, 'in')[0][1] as string[])).size).toBe(250);
    for (const q of queries) expect(argsOf(q, 'eq')).toEqual([['livemode', false]]);
  });

  it('R-3: ids are lower-cased and de-duplicated before the chunks', async () => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    await read(client).listFirstPlanPaymentsForAccounts([id(1), id(1).toUpperCase(), id(2)], false);
    expect(argsOf(queries[0], 'in')).toEqual([['user_id', [id(1), id(2)]]]);
  });

  it('R-4: a full page (a defence: the view gives at most one row per id) asks for the next page after the last user_id', async () => {
    const { client, queries } = recordingClient((_calls, index) =>
      index === 0 ? { data: [viewRow(1, '2026-10-05T10:00:00.000Z'), viewRow(2, '2026-10-06T10:00:00.000Z')], error: null } : { data: [], error: null }
    );
    const result = await read(client).listFirstPlanPaymentsForAccounts([id(1), id(2), id(3)], false, { pageSize: 2 });
    expect(queries).toHaveLength(2);
    expect(argsOf(queries[1], 'gt')).toEqual([['user_id', id(2)]]);
    expect(argsOf(queries[1], 'in')).toEqual([['user_id', [id(1), id(2), id(3)]]]);
    expect(result.data).toHaveLength(2);
  });

  it('R-5: reaching the ceiling, across chunks, is an ERROR, never a partial list', async () => {
    const { client } = recordingClient((calls) => {
      const chunk = (calls.find((c) => c.method === 'in')?.args[1] ?? []) as string[];
      return { data: [{ user_id: chunk[0], first_payment_at: '2026-10-05T10:00:00.000Z' }], error: null };
    });
    const result = await read(client).listFirstPlanPaymentsForAccounts(ids(250), false, { ceiling: 3 });
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(AdminBillingReadCeilingError);
  });

  it('R-6: one row per account with a first payment, sorted by account; an account with none is absent', async () => {
    const { client } = recordingClient(() => ({
      data: [viewRow(2, '2026-10-01T00:00:00.000Z'), viewRow(1, '2026-08-02T00:00:00.000Z')],
      error: null,
    }));
    const result = await read(client).listFirstPlanPaymentsForAccounts([id(1), id(2), id(3)], false);
    expect(result.data).toEqual([
      { user_id: id(1), paid_at: '2026-08-02T00:00:00.000Z' },
      { user_id: id(2), paid_at: '2026-10-01T00:00:00.000Z' },
    ]);
  });

  it('R-7: a second row for one account is an ERROR, never a pick (planted: the view cannot give it)', async () => {
    const { client } = recordingClient(() => ({ data: [viewRow(1, '2026-10-05T00:00:00.000Z'), viewRow(1, '2026-09-05T00:00:00.000Z')], error: null }));
    const result = await read(client).listFirstPlanPaymentsForAccounts([id(1)], false);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(AdminBillingReadDuplicateError);
  });

  it('R-8: isolation: a row for an account not asked for is an ERROR, never kept', async () => {
    const { client } = recordingClient(() => ({ data: [viewRow(1, '2026-10-05T00:00:00.000Z'), viewRow(99, '2026-10-05T00:00:00.000Z')], error: null }));
    const result = await read(client).listFirstPlanPaymentsForAccounts([id(1)], false);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(AdminBillingReadIsolationError);
    expect(mockLog.error).toHaveBeenCalled();
  });

  it('R-8: a row with no user_id is not an asked account either: an error', async () => {
    const { client } = recordingClient(() => ({ data: [{ user_id: null, first_payment_at: '2026-10-05T00:00:00.000Z' }], error: null }));
    const result = await read(client).listFirstPlanPaymentsForAccounts([id(1)], false);
    expect(result.error).toBeInstanceOf(AdminBillingReadIsolationError);
  });

  it.each([[['not-a-uuid']], [[`${'x'}' or 1=1`]], [[123 as unknown as string]], ['nope' as unknown as string[]]])(
    'R-8: refuses %p before any query',
    async (bad) => {
      const { client, queries } = recordingClient(() => ({ data: [], error: null }));
      const result = await read(client).listFirstPlanPaymentsForAccounts(bad as string[], false);
      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(Error);
      expect(queries).toHaveLength(0);
      expect(mockLog.warn).toHaveBeenCalled();
    }
  );

  it('R-8: an empty list makes no query and finds nothing', async () => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    expect(await read(client).listFirstPlanPaymentsForAccounts([], false)).toEqual({ data: [], error: null });
    expect(queries).toHaveLength(0);
  });

  it('R-9: an unreadable first_payment_at is an error, never skipped', async () => {
    const { client } = recordingClient(() => ({ data: [viewRow(1, 'not a date')], error: null }));
    const result = await read(client).listFirstPlanPaymentsForAccounts([id(1)], false);
    expect(result.data).toBeNull();
    expect(result.error?.message).toMatch(/first_payment_at/);
  });

  it('R-10: a database error is returned, never thrown; the log has counts only, never an id', async () => {
    const failing = recordingClient(() => ({ data: null, error: new Error('boom') }));
    const failed = await read(failing.client).listFirstPlanPaymentsForAccounts([id(1)], false);
    expect(failed).toEqual({ data: null, error: expect.objectContaining({ message: 'boom' }) });

    const ok = recordingClient(() => ({ data: [viewRow(1, '2026-10-05T00:00:00.000Z')], error: null }));
    await read(ok.client).listFirstPlanPaymentsForAccounts([id(1)], false);
    const info = mockLog.info.mock.calls.find((c) => c[1] === 'First plan payments of one mode read');
    expect(info?.[0]).toEqual(expect.objectContaining({ accounts: 1, chunks: 1, rows: 1, found: 1 }));
    expect(JSON.stringify(mockLog.info.mock.calls)).not.toContain('22222222-2222-4222-8222');
  });

  it.each([0, 1001])('refuses a page size of %p before querying', async (pageSize) => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    const result = await read(client).listFirstPlanPaymentsForAccounts([id(1)], false, { pageSize });
    expect(result.error).toBeInstanceOf(Error);
    expect(queries).toHaveLength(0);
  });
});

// ── MK5B-FU-1 (SA-WP-M5F, Q1): every account whose first payment is in a range ──
describe('listFirstPlanPaymentsInRangeAllAccounts (MK5B-FU-1, Q1)', () => {
  const id = (n: number) => `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`;
  const OCT = { from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' };
  const viewRow = (userN: number, at = '2026-10-05T10:00:00.000Z') => ({ user_id: id(userN), first_payment_at: at });
  const read = (client: SupabaseClient) => new BusinessOsBillingAdminReadRepository(client);

  it('Q1-1: one query of the view: one mode, the range [from, to), keyset on user_id, at most 1,000 rows', async () => {
    const { client, queries } = recordingClient(() => ({ data: [viewRow(2), viewRow(1, '2026-10-01T00:00:00.000Z')], error: null }));
    const result = await read(client).listFirstPlanPaymentsInRangeAllAccounts(OCT, true);
    expect(result).toEqual({
      data: [
        { user_id: id(1), paid_at: '2026-10-01T00:00:00.000Z' },
        { user_id: id(2), paid_at: '2026-10-05T10:00:00.000Z' },
      ],
      error: null,
    });
    expect(queries).toHaveLength(1);
    const q = queries[0];
    expect(q[0].args).toEqual(['business_os_first_plan_payments']);
    expect(argsOf(q, 'select')).toEqual([['user_id, first_payment_at']]);
    expect(argsOf(q, 'eq')).toEqual([['livemode', true]]);
    expect(argsOf(q, 'gte')).toEqual([['first_payment_at', OCT.from]]);
    expect(argsOf(q, 'lt')).toEqual([['first_payment_at', OCT.to]]);
    expect(argsOf(q, 'in')).toEqual([]);
    expect(argsOf(q, 'order')).toEqual([['user_id', { ascending: true }]]);
    expect(argsOf(q, 'limit')).toEqual([[1000]]);
  });

  it.each([
    ['unreadable', { from: 'nope', to: OCT.to }],
    ['backwards', { from: OCT.to, to: OCT.from }],
    ['empty', { from: OCT.from, to: OCT.from }],
    ['over 31 days', { from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:01.000Z' }],
    ['missing', null as unknown as { from: string; to: string }],
  ])('Q1-2: a %s range is refused before any query', async (_label, range) => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    const result = await read(client).listFirstPlanPaymentsInRangeAllAccounts(range, false);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(queries).toHaveLength(0);
    expect(FIRST_PAYMENT_RANGE_MAX_DAYS).toBe(31);
  });

  it('Q1-2: exactly 31 days is allowed (December)', async () => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    const result = await read(client).listFirstPlanPaymentsInRangeAllAccounts({ from: '2026-12-01T00:00:00.000Z', to: '2027-01-01T00:00:00.000Z' }, false);
    expect(result).toEqual({ data: [], error: null });
    expect(queries).toHaveLength(1);
  });

  it('Q1-3: keyset paging over 2,500 rows: 1,000, 1,000, 500, each after the last user_id', async () => {
    const all = Array.from({ length: 2500 }, (_, i) => viewRow(i + 1));
    const { client, queries } = recordingClient((_calls, index) => ({ data: all.slice(index * 1000, index * 1000 + 1000), error: null }));
    const result = await read(client).listFirstPlanPaymentsInRangeAllAccounts(OCT, false);
    expect(result.data).toHaveLength(2500);
    expect(queries).toHaveLength(3);
    expect(argsOf(queries[0], 'gt')).toEqual([]);
    expect(argsOf(queries[1], 'gt')).toEqual([['user_id', id(1000)]]);
    expect(argsOf(queries[2], 'gt')).toEqual([['user_id', id(2000)]]);
    for (const q of queries) expect(argsOf(q, 'limit')).toEqual([[1000]]);
  });

  it('Q1-4: reaching the ceiling is an ERROR, never a partial list', async () => {
    const { client } = recordingClient(() => ({ data: [viewRow(1), viewRow(2)], error: null }));
    const result = await read(client).listFirstPlanPaymentsInRangeAllAccounts(OCT, false, { pageSize: 2, ceiling: 3 });
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(AdminBillingReadCeilingError);
  });

  it('Q1-4: a row outside the range, a duplicate, a bad id or a bad date is an error (planted)', async () => {
    const outside = recordingClient(() => ({ data: [viewRow(1, '2026-11-01T00:00:00.000Z')], error: null }));
    expect((await read(outside.client).listFirstPlanPaymentsInRangeAllAccounts(OCT, false)).error?.message).toMatch(/outside the range/);
    const before = recordingClient(() => ({ data: [viewRow(1, '2026-09-30T23:59:59.999Z')], error: null }));
    expect((await read(before.client).listFirstPlanPaymentsInRangeAllAccounts(OCT, false)).error?.message).toMatch(/outside the range/);
    const dup = recordingClient(() => ({ data: [viewRow(1), viewRow(1)], error: null }));
    expect((await read(dup.client).listFirstPlanPaymentsInRangeAllAccounts(OCT, false)).error).toBeInstanceOf(AdminBillingReadDuplicateError);
    const badId = recordingClient(() => ({ data: [{ user_id: 'x', first_payment_at: '2026-10-05T00:00:00.000Z' }], error: null }));
    expect((await read(badId.client).listFirstPlanPaymentsInRangeAllAccounts(OCT, false)).error).toBeInstanceOf(AdminBillingReadIsolationError);
    const badDate = recordingClient(() => ({ data: [viewRow(1, 'never')], error: null }));
    expect((await read(badDate.client).listFirstPlanPaymentsInRangeAllAccounts(OCT, false)).error?.message).toMatch(/first_payment_at/);
  });

  it('Q1-5: a database error is returned, never thrown; logs carry counts only, never an id', async () => {
    const failing = recordingClient(() => ({ data: null, error: new Error('boom') }));
    expect(await read(failing.client).listFirstPlanPaymentsInRangeAllAccounts(OCT, false)).toEqual({
      data: null,
      error: expect.objectContaining({ message: 'boom' }),
    });
    const ok = recordingClient(() => ({ data: [viewRow(7)], error: null }));
    await read(ok.client).listFirstPlanPaymentsInRangeAllAccounts(OCT, false);
    const info = mockLog.info.mock.calls.find((c) => c[1] === 'First plan payments of one mode in a range read');
    expect(info?.[0]).toEqual(expect.objectContaining({ pages: 1, rows: 1, found: 1 }));
    expect(JSON.stringify([mockLog.info.mock.calls, mockLog.error.mock.calls])).not.toContain('33333333-3333-4333-8333');
  });
});
