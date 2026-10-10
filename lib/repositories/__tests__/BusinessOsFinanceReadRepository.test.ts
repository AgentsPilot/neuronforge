/**
 * BusinessOsFinanceReadRepository — the read-only money-table access of the
 * admin finance & business health page (slice 1a: R-c, R-c′, R-d).
 *
 * Pinned: each method's query (columns, live mode only, account scope, keyset
 * paging, head counts), that bad input is refused BEFORE querying, that the
 * ceiling is an error and never a partial list, that a missing count is an
 * error and never 0, that the source holds no write verb and does not name the
 * money writers' repositories, and who may import it.
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
  BusinessOsFinanceReadRepository,
  FINANCE_BILLING_STATUS_COLUMNS,
  FINANCE_READ_LIMITS,
  FinanceReadCeilingError,
  type FinanceBillingStatusRow,
} from '../BusinessOsFinanceReadRepository';

type Call = { method: string; args: unknown[] };
type Response = { data?: unknown; error: unknown; count?: number | null };

/** Records every query; each resolves with `respond(calls, index)`. */
function recordingClient(respond: (calls: Call[], index: number) => Response) {
  const queries: Call[][] = [];
  const client = {
    from: (table: string) => {
      const calls: Call[] = [{ method: 'from', args: [table] }];
      const index = queries.length;
      queries.push(calls);
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'not', 'gt', 'order', 'limit', 'maybeSingle']) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ method, args });
          return builder;
        };
      }
      builder.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
        try {
          resolve(respond(calls, index));
        } catch (err) {
          reject(err);
        }
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, queries };
}

const argsOf = (calls: Call[], method: string) => calls.filter((c) => c.method === method).map((c) => c.args);

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

const row = (user_id: string, subscription_status: string | null = 'active'): FinanceBillingStatusRow => ({
  user_id,
  subscription_status,
  ended_at: null,
});

beforeEach(() => jest.clearAllMocks());

describe('column allow-list', () => {
  it('selects exactly who, which status and whether it ended', () => {
    expect(FINANCE_BILLING_STATUS_COLUMNS.split(',').map((c) => c.trim())).toEqual([
      'user_id',
      'subscription_status',
      'ended_at',
    ]);
    expect(FINANCE_READ_LIMITS).toEqual({ BILLING_PAGE_SIZE: 1000, BILLING_CEILING: 20_000 });
  });
});

describe('R-c listLiveBillingStatusesAllAccounts (the one all-accounts billing read)', () => {
  it('reads live rows only, with no account filter, skipping detached (NULL) rows, keyset on user_id', async () => {
    const { client, queries } = recordingClient(() => ({ data: [row(A), row(B)], error: null }));
    const result = await new BusinessOsFinanceReadRepository(client).listLiveBillingStatusesAllAccounts();

    expect(result).toEqual({ data: [row(A), row(B)], error: null });
    const [q] = queries;
    expect(q[0].args).toEqual(['business_os_billing_accounts']);
    expect(argsOf(q, 'select')).toEqual([[FINANCE_BILLING_STATUS_COLUMNS]]);
    expect(argsOf(q, 'eq')).toEqual([['livemode', true]]);
    expect(argsOf(q, 'not')).toEqual([['user_id', 'is', null]]);
    expect(argsOf(q, 'gt')).toEqual([]);
    expect(argsOf(q, 'order')).toEqual([['user_id', { ascending: true }]]);
    expect(argsOf(q, 'limit')).toEqual([[1000]]);
    expect(mockLog.info).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'listLiveBillingStatusesAllAccounts', rows: 2 }),
      expect.any(String)
    );
  });

  it('pages by keyset (gt the last user_id) and stops on a short page', async () => {
    const { client, queries } = recordingClient((_c, i) =>
      i === 0 ? { data: [row(A), row(B)], error: null } : { data: [row(C)], error: null }
    );
    const result = await new BusinessOsFinanceReadRepository(client).listLiveBillingStatusesAllAccounts({
      pageSize: 2,
      ceiling: 10,
    });
    expect(result.data?.map((r) => r.user_id)).toEqual([A, B, C]);
    expect(queries).toHaveLength(2);
    expect(argsOf(queries[0], 'gt')).toEqual([]);
    expect(argsOf(queries[1], 'gt')).toEqual([['user_id', B]]);
  });

  it('reaching the ceiling (>=) is an ERROR, never a partial list', async () => {
    const { client } = recordingClient(() => ({ data: [row(A), row(B)], error: null }));
    const result = await new BusinessOsFinanceReadRepository(client).listLiveBillingStatusesAllAccounts({
      pageSize: 2,
      ceiling: 2,
    });
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(FinanceReadCeilingError);
  });

  it.each([
    ['a page over 1000', { pageSize: 1001 }],
    ['a zero page', { pageSize: 0 }],
    ['a ceiling over 20,000', { ceiling: 20_001 }],
  ])('refuses %s before querying', async (_n, opts) => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    const result = await new BusinessOsFinanceReadRepository(client).listLiveBillingStatusesAllAccounts(opts);
    expect(result.data).toBeNull();
    expect(queries).toHaveLength(0);
    expect(mockLog.warn).toHaveBeenCalled();
  });

  it('a read error is { data: null, error } and never throws', async () => {
    const { client } = recordingClient(() => ({ data: null, error: new Error('boom') }));
    const result = await new BusinessOsFinanceReadRepository(client).listLiveBillingStatusesAllAccounts();
    expect(result).toEqual({ data: null, error: expect.objectContaining({ message: 'boom' }) });
    expect(mockLog.error).toHaveBeenCalled();
  });
});

describe('R-c′ findLiveBillingStatusForAccount (account-scoped, SA-W1)', () => {
  it('reads ONE account, live mode, at most one row', async () => {
    const { client, queries } = recordingClient(() => ({ data: row(A, 'past_due'), error: null }));
    const result = await new BusinessOsFinanceReadRepository(client).findLiveBillingStatusForAccount(A);
    expect(result).toEqual({ data: row(A, 'past_due'), error: null });
    const [q] = queries;
    expect(q[0].args).toEqual(['business_os_billing_accounts']);
    expect(argsOf(q, 'select')).toEqual([[FINANCE_BILLING_STATUS_COLUMNS]]);
    expect(argsOf(q, 'eq')).toEqual([
      ['user_id', A],
      ['livemode', true],
    ]);
    expect(argsOf(q, 'maybeSingle')).toEqual([[]]);
  });

  it('no live row → null data, no error', async () => {
    const { client } = recordingClient(() => ({ data: null, error: null }));
    expect(await new BusinessOsFinanceReadRepository(client).findLiveBillingStatusForAccount(A)).toEqual({
      data: null,
      error: null,
    });
  });

  it.each([[''], ['not-a-uuid'], ["11111111-1111-4111-8111-111111111111' or 1=1"]])(
    'refuses %p before any query',
    async (id) => {
      const { client, queries } = recordingClient(() => ({ data: null, error: null }));
      const result = await new BusinessOsFinanceReadRepository(client).findLiveBillingStatusForAccount(id);
      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(Error);
      expect(queries).toHaveLength(0);
    }
  );

  it('does not log the account id at info', async () => {
    const { client } = recordingClient(() => ({ data: row(A), error: null }));
    await new BusinessOsFinanceReadRepository(client).findLiveBillingStatusForAccount(A);
    expect(JSON.stringify(mockLog.info.mock.calls)).not.toContain(A);
  });
});

describe('R-d countLiveRevenueRows (platform-wide existence, head counts only)', () => {
  it('two head counts, live mode only: paid plan invoices and paid boosts', async () => {
    const { client, queries } = recordingClient((calls) =>
      (calls[0].args[0] as string) === 'business_os_billing_events'
        ? { data: null, error: null, count: 0 }
        : { data: null, error: null, count: 2 }
    );
    const result = await new BusinessOsFinanceReadRepository(client).countLiveRevenueRows();
    expect(result).toEqual({ data: { planInvoicesPaid: 0, boostsPaid: 2 }, error: null });

    const events = queries.find((q) => q[0].args[0] === 'business_os_billing_events')!;
    const boosts = queries.find((q) => q[0].args[0] === 'business_os_boost_purchases')!;
    expect(argsOf(events, 'select')).toEqual([['id', { count: 'exact', head: true }]]);
    // AC-23: a test-mode row cannot count — livemode must be true.
    expect(argsOf(events, 'eq')).toEqual([
      ['livemode', true],
      ['kind', 'invoice_paid'],
    ]);
    expect(argsOf(boosts, 'select')).toEqual([['id', { count: 'exact', head: true }]]);
    expect(argsOf(boosts, 'eq')).toEqual([['livemode', true]]);
    expect(argsOf(boosts, 'not')).toEqual([['paid_at', 'is', null]]);
    expect(queries).toHaveLength(2);
  });

  it.each([
    ['the invoice count errors', 'business_os_billing_events', { error: new Error('x'), count: null }],
    ['the boost count errors', 'business_os_boost_purchases', { error: new Error('x'), count: null }],
    ['a count comes back null (R-7: never treated as 0)', 'business_os_boost_purchases', { error: null, count: null }],
  ])('%s → { data: null, error }', async (_n, failing, failure) => {
    const { client } = recordingClient((calls) =>
      calls[0].args[0] === failing ? { data: null, ...failure } : { data: null, error: null, count: 0 }
    );
    const result = await new BusinessOsFinanceReadRepository(client).countLiveRevenueRows();
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });
});

describe('source guards', () => {
  const FILE = 'lib/repositories/BusinessOsFinanceReadRepository.ts';
  const raw = fs.readFileSync(path.join(process.cwd(), FILE), 'utf8');
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  const WRITE_VERB = /\.(insert|update|upsert|delete|rpc)\s*\(/;

  it('the write-verb rule matches a planted write, so a clean file means something', () => {
    expect(WRITE_VERB.test(`await this.supabase.from('x').insert({ a: 1 })`)).toBe(true);
    expect(WRITE_VERB.test(`this.supabase.rpc('fn', {})`)).toBe(true);
    expect(WRITE_VERB.test(`select('updated_at')`)).toBe(false);
  });

  it('names no write verb: the repository cannot write', () => {
    expect(WRITE_VERB.test(code)).toBe(false);
  });

  it('selects no aggregate (head counts only, never sum/count( in a select)', () => {
    expect(code).not.toMatch(/select\(\s*['"`][^'"`]*\b(sum|count|avg|min|max)\s*\(/i);
  });

  it('names none of the money writers’ repositories, even in a comment (their caller guards match text)', () => {
    // Built from parts so this test file does not name them either.
    for (const name of ['BillingAccount', 'BillingEvent', 'BoostPurchase']) {
      expect(raw).not.toContain(`BusinessOs${name}` + 'Repository');
      expect(raw).not.toContain(`businessOs${name}` + 'Repository');
    }
  });

  it('is imported only by the finance wiring, the finance builder (types), the barrel and itself', () => {
    const roots = ['app', 'lib', 'components', 'hooks', 'scripts'];
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', '.next', '.claude', '__tests__'].includes(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) {
          const rel = path.relative(process.cwd(), full).split(path.sep).join('/');
          if (fs.readFileSync(full, 'utf8').includes('BusinessOsFinanceReadRepository')) found.push(rel);
        }
      }
    };
    roots.filter((r) => fs.existsSync(r)).forEach((r) => walk(path.join(process.cwd(), r)));
    expect(found.sort()).toEqual(
      [
        // Types via Pick<...>; it calls no read method itself.
        'lib/business-os/finance/financeHealth.ts',
        // The production wiring: the one file that calls R-c, R-c′ and R-d.
        'lib/business-os/finance/financeHealthDeps.ts',
        'lib/repositories/BusinessOsFinanceReadRepository.ts',
        'lib/repositories/index.ts',
      ].sort()
    );
  });
});
