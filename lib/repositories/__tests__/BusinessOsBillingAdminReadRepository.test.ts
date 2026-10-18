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
  ADMIN_BILLING_READ_LIMITS,
  ADMIN_BILLING_ROW_COLUMNS,
  AdminBillingReadCeilingError,
  BusinessOsBillingAdminReadRepository,
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
      for (const method of ['select', 'eq', 'gt', 'order', 'limit']) {
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

  it('every .from( names the billing-accounts table, and every read filters livemode', () => {
    expect([...code.matchAll(/\.from\(\s*'([a-z_]+)'\s*\)/g)].map((m) => m[1])).toEqual(['business_os_billing_accounts']);
    expect((code.match(/\.from\s*\(/g) ?? []).length).toBe(1);
    expect(code).toMatch(/\.eq\('livemode', livemode\)/);
  });
});
