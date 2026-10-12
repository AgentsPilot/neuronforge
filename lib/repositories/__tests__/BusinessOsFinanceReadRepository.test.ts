/**
 * BusinessOsFinanceReadRepository — the read-only money-table access of the
 * admin finance & business health page (slice 1a: R-c, R-c′, R-d).
 *
 * Pinned: each method's query (columns, live mode only, account scope, keyset
 * paging, head counts), that bad input is refused BEFORE querying, that the
 * ceiling is an error and never a partial list, that a missing count is an
 * error and never 0, that the source holds no write verb and does not name the
 * money writers' repositories, and who may import it.
 *
 * Slice 2a (R-e, R-e′, R-f, R-f′): the exact client-payment and refund
 * columns (no client data), no `livemode` and no status filter, the range on
 * the right column, keyset on `id`, the `>=` ceiling returning rows plus
 * `reachedCeiling` (never an error), `.eq('user_id')` on every page of the
 * account-scoped reads, refusal before querying, and the payment writers'
 * class names absent from the source (SA-WR-19).
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
  FINANCE_CLIENT_PAYMENT_COLUMNS,
  FINANCE_CLIENT_REFUND_COLUMNS,
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
      for (const method of ['select', 'eq', 'not', 'gt', 'gte', 'lt', 'order', 'limit', 'maybeSingle']) {
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
    expect(FINANCE_READ_LIMITS).toEqual({
      BILLING_PAGE_SIZE: 1000,
      BILLING_CEILING: 20_000,
      CLIENT_PAGE_SIZE: 1000,
      CLIENT_CEILING: 5_000,
    });
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

// ── Slice 2a: layer-B client payments and refunds (R-e, R-e′, R-f, R-f′) ─────

const RANGE = { from: new Date('2026-10-01T00:00:00.000Z'), to: new Date('2026-11-01T00:00:00.000Z') };
const P1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const P2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const P3 = 'aaaaaaaa-0000-4000-8000-000000000003';
const P4 = 'aaaaaaaa-0000-4000-8000-000000000004';
const idRow = (id: string) => ({ id, user_id: A, amount: '12.34', currency: 'usd', status: 'succeeded' });

type Repo = BusinessOsFinanceReadRepository;
type Range = typeof RANGE;
type Opts = { pageSize?: number; ceiling?: number };
const LAYER_B = [
  {
    name: 'R-e listClientPaymentsAllAccountsPaidInRange',
    table: 'payment_transactions',
    columns: () => FINANCE_CLIENT_PAYMENT_COLUMNS,
    dateColumn: 'paid_at',
    scoped: false,
    call: (repo: Repo, range: Range, opts?: Opts) => repo.listClientPaymentsAllAccountsPaidInRange(range, opts),
  },
  {
    name: 'R-e′ listClientPaymentsForAccountPaidInRange',
    table: 'payment_transactions',
    columns: () => FINANCE_CLIENT_PAYMENT_COLUMNS,
    dateColumn: 'paid_at',
    scoped: true,
    call: (repo: Repo, range: Range, opts?: Opts, id: string = A) => repo.listClientPaymentsForAccountPaidInRange(id, range, opts),
  },
  {
    name: 'R-f listClientRefundsAllAccountsCreatedInRange',
    table: 'payment_refunds',
    columns: () => FINANCE_CLIENT_REFUND_COLUMNS,
    dateColumn: 'created_at',
    scoped: false,
    call: (repo: Repo, range: Range, opts?: Opts) => repo.listClientRefundsAllAccountsCreatedInRange(range, opts),
  },
  {
    name: 'R-f′ listClientRefundsForAccountCreatedInRange',
    table: 'payment_refunds',
    columns: () => FINANCE_CLIENT_REFUND_COLUMNS,
    dateColumn: 'created_at',
    scoped: true,
    call: (repo: Repo, range: Range, opts?: Opts, id: string = A) => repo.listClientRefundsForAccountCreatedInRange(id, range, opts),
  },
] as const;

describe('slice 2a column allow-lists', () => {
  const cols = (list: string) => list.split(',').map((c) => c.trim());

  it('payments: exactly the takings columns', () => {
    expect(cols(FINANCE_CLIENT_PAYMENT_COLUMNS)).toEqual([
      'id', 'user_id', 'amount', 'currency', 'status', 'paid_at', 'processor_fee', 'fee_currency', 'processor_type',
    ]);
  });

  it('refunds: exactly the refund columns, amount and never amount_minor (SA-Q13)', () => {
    expect(cols(FINANCE_CLIENT_REFUND_COLUMNS)).toEqual(['id', 'user_id', 'amount', 'currency', 'status', 'created_at']);
  });

  it.each([FINANCE_CLIENT_PAYMENT_COLUMNS, FINANCE_CLIENT_REFUND_COLUMNS])('%s: no client data, no livemode, no amount_minor', (list) => {
    for (const banned of ['contact_id', 'metadata', 'livemode', 'amount_minor']) expect(cols(list)).not.toContain(banned);
  });
});

describe.each(LAYER_B)('$name', ({ table, columns, dateColumn, scoped, call }) => {
  it('one page: the exact table and columns, the range on its own column as ISO strings, keyset order, page 1000; no livemode, no status filter', async () => {
    const { client, queries } = recordingClient(() => ({ data: [idRow(P1)], error: null }));
    const result = await call(new BusinessOsFinanceReadRepository(client), RANGE);

    expect(result).toEqual({ data: { rows: [idRow(P1)], reachedCeiling: false }, error: null });
    expect(queries).toHaveLength(1);
    const [q] = queries;
    expect(q[0].args).toEqual([table]);
    expect(argsOf(q, 'select')).toEqual([[columns()]]);
    expect(argsOf(q, 'gte')).toEqual([[dateColumn, '2026-10-01T00:00:00.000Z']]);
    expect(argsOf(q, 'lt')).toEqual([[dateColumn, '2026-11-01T00:00:00.000Z']]);
    expect(argsOf(q, 'order')).toEqual([['id', { ascending: true }]]);
    expect(argsOf(q, 'limit')).toEqual([[1000]]);
    expect(argsOf(q, 'gt')).toEqual([]);
    expect(argsOf(q, 'not')).toEqual([]);
    // Account scope only on the scoped read; never a mode or status filter (BD-13, S2-FR-2).
    expect(argsOf(q, 'eq')).toEqual(scoped ? [['user_id', A]] : []);
    expect(JSON.stringify(q)).not.toContain('livemode');
    // Nothing else was called: the only filters are the range and (scoped) the account.
    expect(q.map((c) => c.method)).toEqual(
      scoped ? ['from', 'select', 'gte', 'lt', 'eq', 'order', 'limit'] : ['from', 'select', 'gte', 'lt', 'order', 'limit']
    );
  });

  it('pages by keyset (gt the last id) and stops on a short page; the scope is on every page', async () => {
    const { client, queries } = recordingClient((_c, i) =>
      i === 0 ? { data: [idRow(P1), idRow(P2)], error: null } : { data: [idRow(P3)], error: null }
    );
    const result = await call(new BusinessOsFinanceReadRepository(client), RANGE, { pageSize: 2, ceiling: 10 });
    expect(result.data?.rows.map((r) => r.id)).toEqual([P1, P2, P3]);
    expect(result.data?.reachedCeiling).toBe(false);
    expect(queries).toHaveLength(2);
    expect(argsOf(queries[0], 'gt')).toEqual([]);
    expect(argsOf(queries[1], 'gt')).toEqual([['id', P2]]);
    for (const q of queries) expect(argsOf(q, 'eq')).toEqual(scoped ? [['user_id', A]] : []);
  });

  it('the ceiling (>=) returns the rows read with reachedCeiling, never an error; 3 rows at ceiling 3 is true; 2 rows is false', async () => {
    // Plenty of rows: each page answers with as many as it asked for.
    const plenty = recordingClient((calls) => {
      const [[size]] = argsOf(calls, 'limit') as number[][];
      return { data: [P1, P2, P3, P4].slice(0, size).map(idRow), error: null };
    });
    const capped = await call(new BusinessOsFinanceReadRepository(plenty.client), RANGE, { ceiling: 3, pageSize: 2 });
    expect(capped.error).toBeNull();
    expect(capped.data?.rows).toHaveLength(3);
    expect(capped.data?.reachedCeiling).toBe(true);
    // The last page asks only for what is left under the ceiling.
    expect(plenty.queries.map((q) => argsOf(q, 'limit')[0][0])).toEqual([2, 1]);

    const exactlyThree = recordingClient((_c, i) =>
      i === 0 ? { data: [idRow(P1), idRow(P2)], error: null } : { data: [idRow(P3)], error: null }
    );
    const three = await call(new BusinessOsFinanceReadRepository(exactlyThree.client), RANGE, { ceiling: 3, pageSize: 2 });
    expect(three.data).toEqual({ rows: [P1, P2, P3].map(idRow), reachedCeiling: true });

    const onlyTwo = recordingClient((_c, i) => (i === 0 ? { data: [idRow(P1), idRow(P2)], error: null } : { data: [], error: null }));
    const two = await call(new BusinessOsFinanceReadRepository(onlyTwo.client), RANGE, { ceiling: 3, pageSize: 2 });
    expect(two.data).toEqual({ rows: [P1, P2].map(idRow), reachedCeiling: false });
  });

  it.each([
    ['from equal to to', { from: RANGE.from, to: RANGE.from }, undefined],
    ['from after to', { from: RANGE.to, to: RANGE.from }, undefined],
    ['an invalid from', { from: new Date('nope'), to: RANGE.to }, undefined],
    ['an invalid to', { from: RANGE.from, to: new Date('nope') }, undefined],
    ['a zero page', RANGE, { pageSize: 0 }],
    ['a page over 1000', RANGE, { pageSize: 1001 }],
    ['a fractional page', RANGE, { pageSize: 1.5 }],
    ['a zero ceiling', RANGE, { ceiling: 0 }],
    ['a ceiling over 5,000', RANGE, { ceiling: 5001 }],
  ])('refuses %s before querying', async (_n, range, opts) => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    const result = await call(new BusinessOsFinanceReadRepository(client), range, opts);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(queries).toHaveLength(0);
    expect(mockLog.warn).toHaveBeenCalled();
  });

  it('a read error is { data: null, error }, logged at error, never throws', async () => {
    const { client } = recordingClient(() => ({ data: null, error: new Error('boom') }));
    const result = await call(new BusinessOsFinanceReadRepository(client), RANGE);
    expect(result).toEqual({ data: null, error: expect.objectContaining({ message: 'boom' }) });
    expect(mockLog.error).toHaveBeenCalled();
  });

  it(scoped ? 'logs at debug with counts only; never the id, an amount or a currency' : 'logs one info line with counts and timing only; never an amount or a currency', async () => {
    const { client } = recordingClient(() => ({ data: [idRow(P1)], error: null }));
    await call(new BusinessOsFinanceReadRepository(client), RANGE);
    const level = scoped ? mockLog.debug : mockLog.info;
    expect(level).toHaveBeenCalledTimes(1);
    const [ctx, message] = level.mock.calls[0];
    // SA-2 / QA-3: a refund read says refund rows, never payment rows.
    const noun = table === 'payment_refunds' ? 'Client refund rows' : 'Client payment rows';
    expect(message).toBe(`${noun} of ${scoped ? 'one account' : 'all accounts'} read`);
    expect(Object.keys(ctx).sort()).toEqual(scoped ? ['method', 'reachedCeiling', 'rows'] : ['durationMs', 'method', 'reachedCeiling', 'rows']);
    expect(ctx).toMatchObject({ rows: 1, reachedCeiling: false });
    const logged = JSON.stringify([mockLog.info.mock.calls, mockLog.debug.mock.calls]);
    expect(logged).not.toContain(A);
    expect(logged).not.toContain('12.34');
    expect(logged).not.toContain('usd');
    if (scoped) expect(mockLog.info).not.toHaveBeenCalled();
  });
});

describe.each(LAYER_B.filter((r) => r.scoped))('$name: the account id (SA-W1, T1)', ({ call }) => {
  it.each([[''], ['not-a-uuid'], ["11111111-1111-4111-8111-111111111111' or 1=1"]])(
    'refuses %p before any query, at warn',
    async (id) => {
      const { client, queries } = recordingClient(() => ({ data: [], error: null }));
      const result = await call(new BusinessOsFinanceReadRepository(client), RANGE, undefined, id);
      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(Error);
      expect(queries).toHaveLength(0);
      expect(mockLog.warn).toHaveBeenCalled();
      expect(JSON.stringify(mockLog.info.mock.calls)).not.toContain(id || 'never-empty');
    }
  );
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

describe('slice 2a: the payment writers are named in words only (SA-WR-19)', () => {
  const raw = fs.readFileSync(path.join(process.cwd(), 'lib/repositories/BusinessOsFinanceReadRepository.ts'), 'utf8');
  // Built from parts so this test file does not name them either.
  const NAMES = ['Payment', 'PaymentRefund', 'PaymentPlanSubscription'].map((part) => part + 'Repository');

  it('the check bites (planted negative control)', () => {
    const planted = `// see ${NAMES[1]}\nimport { x } from './${NAMES[0]}';`;
    expect(NAMES.filter((name) => planted.includes(name))).toEqual([NAMES[0], NAMES[1]]);
  });

  it.each(NAMES)('the source does not contain %s, even in a comment', (name) => {
    expect(raw).not.toContain(name);
  });
});
