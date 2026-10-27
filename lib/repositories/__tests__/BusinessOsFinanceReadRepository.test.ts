/**
 * BusinessOsFinanceReadRepository — the read-only money-table access of the
 * admin finance & business health page (slice 1a: R-c, R-c′, R-d).
 *
 * Pinned: each method's query (columns, account scope, keyset paging, head
 * counts), that bad input is refused BEFORE querying, that the
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
 *
 * Slice 2b (R-g, R-g′, R-h, R-h′, R-i, R-i′): the exact columns (no client
 * data, AC-64), the exact `.or()` string from fixed status literals and a
 * strict UTC date (SA-WR-25), no other filter, the same keyset and ceiling,
 * `.eq('user_id')` on every page of the account-scoped reads, refusal before
 * any query, and the plan and reminder writers absent from the source
 * (SA-W40). The pager was generalised (SA-W28): the 2a describes above are
 * unedited and still pass (SA-WR-20).
 *
 * Slice 1c (BD-14, BD-16): R-c, R-c′ and R-d are renamed and name no mode
 * column (test and real rows count together); the reads keep their shape (one
 * billing row per account). Two rows for one account are an ERROR: R-c's
 * duplicate check (SA-WR-27) and R-c′'s `maybeSingle` error, returned and never
 * thrown (SA-WR-28). `bought_tier` joins the billing columns (SA-Q20).
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

// R4-FU-1: FINANCE_BILLING_STATUS_COLUMNS, FinanceReadCeilingError and FinanceBillingStatusRow left
// this import with R-c and R-c′.
import {
  BusinessOsFinanceReadRepository,
  FINANCE_CLIENT_PAYMENT_COLUMNS,
  FINANCE_CLIENT_REFUND_COLUMNS,
  FINANCE_READ_LIMITS,
} from '../BusinessOsFinanceReadRepository';
// Slice 2b: a separate import, so the 2a import above stays byte-identical (SA-WR-20).
import {
  FINANCE_CLIENT_INSTALMENT_DUE_COLUMNS,
  FINANCE_CLIENT_INVOICE_DUE_COLUMNS,
  FINANCE_CLIENT_PLAN_COLUMNS,
} from '../BusinessOsFinanceReadRepository';
// Slice 4a: a separate import too, so the imports above stay byte-identical.
import { FINANCE_BOOST_PURCHASE_COLUMNS } from '../BusinessOsFinanceReadRepository';
// Slice 5a: a separate import too, so the imports above stay byte-identical.
import { FINANCE_PLAN_PAYMENT_COLUMNS } from '../BusinessOsFinanceReadRepository';

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
      // Slice 4b.2: `in` joins (the 100-id chunks, E-69).
      for (const method of ['select', 'eq', 'in', 'not', 'gt', 'gte', 'lt', 'or', 'order', 'limit', 'maybeSingle']) {
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

beforeEach(() => jest.clearAllMocks());

describe('R4-FU-1 (finance follow-ups bundle, SA-WP-FU): the unwired billing reads and R-d are gone', () => {
  it('the read limits are the layer-B pager’s only (the billing page size and ceiling went with R-c)', () => {
    expect(FINANCE_READ_LIMITS).toEqual({
      CLIENT_PAGE_SIZE: 1000,
      CLIENT_CEILING: 5_000,
    });
  });

  it('the repository has no R-c, R-c′ or R-d method, and never opens the billing-account table', () => {
    const repo = new BusinessOsFinanceReadRepository(recordingClient(() => ({ data: [], error: null })).client) as unknown as Record<string, unknown>;
    for (const name of ['listBillingStatusesAllAccounts', 'findBillingStatusForAccount', 'countRevenueRows']) {
      expect({ name, present: typeof repo[name] }).toEqual({ name, present: 'undefined' });
    }
    const source = fs.readFileSync(path.join(process.cwd(), 'lib', 'repositories', 'BusinessOsFinanceReadRepository.ts'), 'utf8');
    expect(source).not.toMatch(/business_os_billing_accounts/);
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

// ── Slice 2b: overdue invoices and instalments, client plans (R-g to R-i′) ───

const TODAY = '2026-10-01';
const INVOICE_OR = 'status.eq.overdue,and(status.eq.sent,due_date.lt.2026-10-01)';
const INSTALMENT_OR = 'status.eq.overdue,and(status.eq.pending,due_date.lt.2026-10-01)';
const dueRow = (id: string) => ({ id, user_id: A, amount: '12.34', currency: 'usd', status: 'overdue', due_date: '2026-09-30' });

type Args2b = { opts?: { pageSize?: number; ceiling?: number }; id?: string; today?: string };
const LAYER_B_2B = [
  {
    name: 'R-g listOverdueClientInvoicesAllAccounts',
    table: 'payment_invoices',
    columns: () => FINANCE_CLIENT_INVOICE_DUE_COLUMNS,
    or: INVOICE_OR,
    noun: 'Overdue client invoice rows',
    scoped: false,
    call: (repo: Repo, a: Args2b = {}) => repo.listOverdueClientInvoicesAllAccounts(a.today ?? TODAY, a.opts),
  },
  {
    name: 'R-g′ listOverdueClientInvoicesForAccount',
    table: 'payment_invoices',
    columns: () => FINANCE_CLIENT_INVOICE_DUE_COLUMNS,
    or: INVOICE_OR,
    noun: 'Overdue client invoice rows',
    scoped: true,
    call: (repo: Repo, a: Args2b = {}) => repo.listOverdueClientInvoicesForAccount(a.id ?? A, a.today ?? TODAY, a.opts),
  },
  {
    name: 'R-h listOverdueClientInstalmentsAllAccounts',
    table: 'payment_plan_installments',
    columns: () => FINANCE_CLIENT_INSTALMENT_DUE_COLUMNS,
    or: INSTALMENT_OR,
    noun: 'Overdue client instalment rows',
    scoped: false,
    call: (repo: Repo, a: Args2b = {}) => repo.listOverdueClientInstalmentsAllAccounts(a.today ?? TODAY, a.opts),
  },
  {
    name: 'R-h′ listOverdueClientInstalmentsForAccount',
    table: 'payment_plan_installments',
    columns: () => FINANCE_CLIENT_INSTALMENT_DUE_COLUMNS,
    or: INSTALMENT_OR,
    noun: 'Overdue client instalment rows',
    scoped: true,
    call: (repo: Repo, a: Args2b = {}) => repo.listOverdueClientInstalmentsForAccount(a.id ?? A, a.today ?? TODAY, a.opts),
  },
  {
    name: 'R-i listClientPlansAllAccounts',
    table: 'payment_plan_subscriptions',
    columns: () => FINANCE_CLIENT_PLAN_COLUMNS,
    or: null,
    noun: 'Client plan rows',
    scoped: false,
    call: (repo: Repo, a: Args2b = {}) => repo.listClientPlansAllAccounts(a.opts),
  },
  {
    name: 'R-i′ listClientPlansForAccount',
    table: 'payment_plan_subscriptions',
    columns: () => FINANCE_CLIENT_PLAN_COLUMNS,
    or: null,
    noun: 'Client plan rows',
    scoped: true,
    call: (repo: Repo, a: Args2b = {}) => repo.listClientPlansForAccount(a.id ?? A, a.opts),
  },
] as const;

describe('slice 2b column allow-lists (AC-64, SA-W34)', () => {
  const cols = (list: string) => list.split(',').map((c) => c.trim());

  it('invoices: exactly who, how much, in which currency, which status and the due date', () => {
    expect(cols(FINANCE_CLIENT_INVOICE_DUE_COLUMNS)).toEqual(['id', 'user_id', 'amount', 'currency', 'status', 'due_date']);
  });

  it('instalments: the same six, and no subscription_id (SA-W34)', () => {
    expect(cols(FINANCE_CLIENT_INSTALMENT_DUE_COLUMNS)).toEqual(['id', 'user_id', 'amount', 'currency', 'status', 'due_date']);
  });

  it('client plans: no amount and no currency (SA-W34)', () => {
    expect(cols(FINANCE_CLIENT_PLAN_COLUMNS)).toEqual([
      'id', 'user_id', 'status', 'cancelled_at', 'completed_at', 'next_charge_at', 'last_failure_at',
    ]);
  });

  it.each([FINANCE_CLIENT_INVOICE_DUE_COLUMNS, FINANCE_CLIENT_INSTALMENT_DUE_COLUMNS, FINANCE_CLIENT_PLAN_COLUMNS])(
    '%s: no client data, no livemode',
    (list) => {
      for (const banned of ['contact_id', 'metadata', 'notes', 'internal_notes', 'invoice_number', 'line_items', 'livemode', 'subscription_id']) {
        expect(cols(list)).not.toContain(banned);
      }
      for (const column of cols(list)) expect(column).not.toMatch(/name|email|phone/);
    }
  );
});

describe.each(LAYER_B_2B)('$name', ({ table, columns, or, noun, scoped, call }) => {
  it('one page: the exact table and columns, the exact filter, keyset order, page 1000; no livemode, no other filter', async () => {
    const { client, queries } = recordingClient(() => ({ data: [dueRow(P1)], error: null }));
    const result = await call(new BusinessOsFinanceReadRepository(client));

    expect(result).toEqual({ data: { rows: [dueRow(P1)], reachedCeiling: false }, error: null });
    expect(queries).toHaveLength(1);
    const [q] = queries;
    expect(q[0].args).toEqual([table]);
    expect(argsOf(q, 'select')).toEqual([[columns()]]);
    // SA-WR-25: exactly one .or() with exactly this text; R-i has none.
    expect(argsOf(q, 'or')).toEqual(or === null ? [] : [[or]]);
    expect(argsOf(q, 'order')).toEqual([['id', { ascending: true }]]);
    expect(argsOf(q, 'limit')).toEqual([[1000]]);
    expect(argsOf(q, 'gt')).toEqual([]);
    expect(argsOf(q, 'gte')).toEqual([]);
    expect(argsOf(q, 'lt')).toEqual([]);
    expect(argsOf(q, 'not')).toEqual([]);
    // No status `eq` (statuses live only in the .or()); the account scope only on the scoped read.
    expect(argsOf(q, 'eq')).toEqual(scoped ? [['user_id', A]] : []);
    expect(JSON.stringify(q)).not.toContain('livemode');
    const filters = or === null ? [] : ['or'];
    expect(q.map((c) => c.method)).toEqual(['from', 'select', ...filters, ...(scoped ? ['eq'] : []), 'order', 'limit']);
  });

  it('pages by keyset (gt the last id) and stops on a short page; the filter and the scope are on every page', async () => {
    const { client, queries } = recordingClient((_c, i) =>
      i === 0 ? { data: [dueRow(P1), dueRow(P2)], error: null } : { data: [dueRow(P3)], error: null }
    );
    const result = await call(new BusinessOsFinanceReadRepository(client), { opts: { pageSize: 2, ceiling: 10 } });
    expect(result.data?.rows.map((r) => r.id)).toEqual([P1, P2, P3]);
    expect(result.data?.reachedCeiling).toBe(false);
    expect(queries).toHaveLength(2);
    expect(argsOf(queries[0], 'gt')).toEqual([]);
    expect(argsOf(queries[1], 'gt')).toEqual([['id', P2]]);
    for (const q of queries) {
      expect(argsOf(q, 'eq')).toEqual(scoped ? [['user_id', A]] : []);
      expect(argsOf(q, 'or')).toEqual(or === null ? [] : [[or]]);
    }
  });

  it('the ceiling (>=) returns the rows read with reachedCeiling, never an error; 3 rows at ceiling 3 is true; 2 rows is false', async () => {
    const plenty = recordingClient((calls) => {
      const [[size]] = argsOf(calls, 'limit') as number[][];
      return { data: [P1, P2, P3, P4].slice(0, size).map(dueRow), error: null };
    });
    const capped = await call(new BusinessOsFinanceReadRepository(plenty.client), { opts: { ceiling: 3, pageSize: 2 } });
    expect(capped.error).toBeNull();
    expect(capped.data?.rows).toHaveLength(3);
    expect(capped.data?.reachedCeiling).toBe(true);
    expect(plenty.queries.map((q) => argsOf(q, 'limit')[0][0])).toEqual([2, 1]);

    const onlyTwo = recordingClient((_c, i) => (i === 0 ? { data: [dueRow(P1), dueRow(P2)], error: null } : { data: [], error: null }));
    const two = await call(new BusinessOsFinanceReadRepository(onlyTwo.client), { opts: { ceiling: 3, pageSize: 2 } });
    expect(two.data).toEqual({ rows: [P1, P2].map(dueRow), reachedCeiling: false });
  });

  it.each([
    ['a zero page', { pageSize: 0 }],
    ['a page over 1000', { pageSize: 1001 }],
    ['a zero ceiling', { ceiling: 0 }],
    ['a ceiling over 5,000', { ceiling: 5001 }],
  ])('refuses %s before querying', async (_n, opts) => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    const result = await call(new BusinessOsFinanceReadRepository(client), { opts });
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(queries).toHaveLength(0);
    expect(mockLog.warn).toHaveBeenCalled();
  });

  it('a read error is { data: null, error }, logged at error, never throws', async () => {
    const { client } = recordingClient(() => ({ data: null, error: new Error('boom') }));
    const result = await call(new BusinessOsFinanceReadRepository(client));
    expect(result).toEqual({ data: null, error: expect.objectContaining({ message: 'boom' }) });
    expect(mockLog.error).toHaveBeenCalled();
  });

  it(scoped ? 'logs at debug with counts only; never the id, an amount, a currency or a date' : 'logs one info line with counts and timing only', async () => {
    const { client } = recordingClient(() => ({ data: [dueRow(P1)], error: null }));
    await call(new BusinessOsFinanceReadRepository(client));
    const level = scoped ? mockLog.debug : mockLog.info;
    expect(level).toHaveBeenCalledTimes(1);
    const [ctx, message] = level.mock.calls[0];
    expect(message).toBe(`${noun} of ${scoped ? 'one account' : 'all accounts'} read`);
    expect(Object.keys(ctx).sort()).toEqual(scoped ? ['method', 'reachedCeiling', 'rows'] : ['durationMs', 'method', 'reachedCeiling', 'rows']);
    const logged = JSON.stringify([mockLog.info.mock.calls, mockLog.debug.mock.calls]);
    for (const secret of [A, '12.34', 'usd', '2026-09-30', TODAY]) expect(logged).not.toContain(secret);
    if (scoped) expect(mockLog.info).not.toHaveBeenCalled();
  });
});

describe.each(LAYER_B_2B.filter((r) => r.or !== null))('$name: the UTC date (SA-WR-25)', ({ call }) => {
  it.each([
    ['an empty string', ''],
    ['a date that does not exist', '2026-02-30'],
    ['a timestamp', '2026-10-01T00:00:00Z'],
    ['a filter injection', '2026-10-01,status.eq.paid'],
    ['a short year', '26-10-01'],
    ['a Date object', new Date('2026-10-01T00:00:00Z') as unknown as string],
  ])('refuses %s before from is called, at warn', async (_n, today) => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    const result = await call(new BusinessOsFinanceReadRepository(client), { today });
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(queries).toHaveLength(0);
    expect(mockLog.warn).toHaveBeenCalled();
    expect(mockLog.error).not.toHaveBeenCalled();
  });

  it('builds the filter from the date it is given, and nothing else (the date is the only variable part)', async () => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    await call(new BusinessOsFinanceReadRepository(client), { today: '2024-02-29' });
    const [[text]] = argsOf(queries[0], 'or') as string[][];
    expect(text).toMatch(/^status\.eq\.overdue,and\(status\.eq\.(sent|pending),due_date\.lt\.2024-02-29\)$/);
  });
});

describe.each(LAYER_B_2B.filter((r) => r.scoped))('$name: the account id (SA-W1, AC-65)', ({ call }) => {
  it.each([[''], ['not-a-uuid'], ["11111111-1111-4111-8111-111111111111' or 1=1"]])(
    'refuses %p before any query, at warn',
    async (id) => {
      const { client, queries } = recordingClient(() => ({ data: [], error: null }));
      const result = await call(new BusinessOsFinanceReadRepository(client), { id });
      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(Error);
      expect(queries).toHaveLength(0);
      expect(mockLog.warn).toHaveBeenCalled();
      expect(JSON.stringify(mockLog.info.mock.calls)).not.toContain(id || 'never-empty');
    }
  );
});

describe('slice 2b: the plan and reminder writers are named in words only (SA-W40)', () => {
  const raw = fs.readFileSync(path.join(process.cwd(), 'lib/repositories/BusinessOsFinanceReadRepository.ts'), 'utf8');
  // Built from parts so this test file does not name them either.
  const NAMES = ['PaymentPlan', 'PaymentReminder'].map((part) => part + 'Repository');

  it('the check bites (planted negative control)', () => {
    const planted = `// see ${NAMES[1]}\nimport { x } from './${NAMES[0]}';`;
    expect(NAMES.filter((name) => planted.includes(name))).toEqual(NAMES);
    // A near miss is not a match: the client plan repository's name does not contain the plan one.
    expect(['PaymentPlanSubscription' + 'Repository'].filter((n) => n.includes(NAMES[0]))).toEqual([]);
  });

  it.each(NAMES)('the source does not contain %s, even in a comment', (name) => {
    expect(raw).not.toContain(name);
  });

  it('the header names them in words, and says the reminder queue is never read here', () => {
    expect(raw).toMatch(/payment plan repository/);
    expect(raw).toMatch(/payment reminder repository/);
    expect(raw).toMatch(/THIS FILE NEVER READS THE REMINDER QUEUE/);
  });
});

// ── Slice 4a: the platform's boost purchases paid in the window (R-k, R-k′) ──

const boostRow = (id: string) => ({
  id,
  user_id: A,
  status: 'paid',
  package_id: 'pkg-a',
  package_version: 1,
  currency: 'usd',
  amount_total_minor: 98765,
  amount_tax_minor: 0,
  credits_total: '5000.000000',
  paid_at: '2026-10-12T10:00:00.000Z',
});

const BOOST_READS = [
  {
    name: 'R-k listBoostPurchasesAllAccountsPaidInRange',
    scoped: false,
    call: (repo: Repo, range: Range, opts?: Opts) => repo.listBoostPurchasesAllAccountsPaidInRange(range, opts),
  },
  {
    name: 'R-k′ listBoostPurchasesForAccountPaidInRange',
    scoped: true,
    call: (repo: Repo, range: Range, opts?: Opts, id: string = A) => repo.listBoostPurchasesForAccountPaidInRange(id, range, opts),
  },
] as const;

describe('slice 4a column allow-list (§11C.6, S4-FR-9)', () => {
  const cols = (list: string) => list.split(',').map((c) => c.trim());

  it('boost purchases: exactly the revenue columns', () => {
    expect(cols(FINANCE_BOOST_PURCHASE_COLUMNS)).toEqual([
      // Slice 4b.2 (SA-W119): no refunded amount; refunds are dated events (R-n).
      'id', 'user_id', 'status', 'package_id', 'package_version', 'currency',
      'amount_total_minor', 'amount_tax_minor', 'credits_total', 'paid_at',
    ]);
  });

  it('no mode, no Stripe id, no receipt, no flag reason, no lot, no created_at or status_changed_at', () => {
    for (const banned of ['livemode', 'receipt_url', 'flag_reason', 'lot_id', 'created_at', 'status_changed_at']) {
      expect(cols(FINANCE_BOOST_PURCHASE_COLUMNS)).not.toContain(banned);
    }
    expect(FINANCE_BOOST_PURCHASE_COLUMNS).not.toContain('stripe_');
  });
});

describe.each(BOOST_READS)('$name', ({ scoped, call }) => {
  it('one page: the boost table, the exact columns, paid_at in the range as ISO strings (AC-88), keyset order, page 1000; no livemode, no status filter', async () => {
    const { client, queries } = recordingClient(() => ({ data: [boostRow(P1)], error: null }));
    const result = await call(new BusinessOsFinanceReadRepository(client), RANGE);

    expect(result).toEqual({ data: { rows: [boostRow(P1)], reachedCeiling: false }, error: null });
    expect(queries).toHaveLength(1);
    const [q] = queries;
    expect(q[0].args).toEqual(['business_os_boost_purchases']);
    expect(argsOf(q, 'select')).toEqual([[FINANCE_BOOST_PURCHASE_COLUMNS]]);
    expect(argsOf(q, 'gte')).toEqual([['paid_at', '2026-10-01T00:00:00.000Z']]);
    expect(argsOf(q, 'lt')).toEqual([['paid_at', '2026-11-01T00:00:00.000Z']]);
    expect(argsOf(q, 'order')).toEqual([['id', { ascending: true }]]);
    expect(argsOf(q, 'limit')).toEqual([[1000]]);
    expect(argsOf(q, 'gt')).toEqual([]);
    expect(argsOf(q, 'not')).toEqual([]);
    expect(argsOf(q, 'or')).toEqual([]);
    expect(argsOf(q, 'eq')).toEqual(scoped ? [['user_id', A]] : []);
    expect(JSON.stringify(q)).not.toContain('livemode');
    expect(q.map((c) => c.method)).toEqual(
      scoped ? ['from', 'select', 'gte', 'lt', 'eq', 'order', 'limit'] : ['from', 'select', 'gte', 'lt', 'order', 'limit']
    );
  });

  it('AC-88 / S4-F2: a month-boundary window carries exactly its half-open ISO bounds (the database applies the microsecond rule)', async () => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    const november = { from: new Date('2026-11-01T00:00:00.000Z'), to: new Date('2026-12-01T00:00:00.000Z') };
    await call(new BusinessOsFinanceReadRepository(client), november);
    expect(argsOf(queries[0], 'gte')).toEqual([['paid_at', '2026-11-01T00:00:00.000Z']]);
    expect(argsOf(queries[0], 'lt')).toEqual([['paid_at', '2026-12-01T00:00:00.000Z']]);
  });

  it('pages by keyset (gt the last id) and stops on a short page; the scope is on every page', async () => {
    const { client, queries } = recordingClient((_c, i) =>
      i === 0 ? { data: [boostRow(P1), boostRow(P2)], error: null } : { data: [boostRow(P3)], error: null }
    );
    const result = await call(new BusinessOsFinanceReadRepository(client), RANGE, { pageSize: 2, ceiling: 10 });
    expect(result.data?.rows.map((r) => r.id)).toEqual([P1, P2, P3]);
    expect(result.data?.reachedCeiling).toBe(false);
    expect(queries).toHaveLength(2);
    expect(argsOf(queries[0], 'gt')).toEqual([]);
    expect(argsOf(queries[1], 'gt')).toEqual([['id', P2]]);
    for (const q of queries) expect(argsOf(q, 'eq')).toEqual(scoped ? [['user_id', A]] : []);
  });

  it('AC-93: the ceiling (>=) returns the rows read with reachedCeiling, never an error; exactly 3 is true; 2 is false', async () => {
    const plenty = recordingClient((calls) => {
      const [[size]] = argsOf(calls, 'limit') as number[][];
      return { data: [P1, P2, P3, P4].slice(0, size).map(boostRow), error: null };
    });
    const capped = await call(new BusinessOsFinanceReadRepository(plenty.client), RANGE, { ceiling: 3, pageSize: 2 });
    expect(capped.error).toBeNull();
    expect(capped.data?.rows).toHaveLength(3);
    expect(capped.data?.reachedCeiling).toBe(true);

    const exactlyThree = recordingClient((_c, i) =>
      i === 0 ? { data: [boostRow(P1), boostRow(P2)], error: null } : { data: [boostRow(P3)], error: null }
    );
    const three = await call(new BusinessOsFinanceReadRepository(exactlyThree.client), RANGE, { ceiling: 3, pageSize: 2 });
    expect(three.data).toEqual({ rows: [P1, P2, P3].map(boostRow), reachedCeiling: true });

    const onlyTwo = recordingClient((_c, i) => (i === 0 ? { data: [boostRow(P1), boostRow(P2)], error: null } : { data: [], error: null }));
    const two = await call(new BusinessOsFinanceReadRepository(onlyTwo.client), RANGE, { ceiling: 3, pageSize: 2 });
    expect(two.data).toEqual({ rows: [P1, P2].map(boostRow), reachedCeiling: false });
  });

  it.each([
    ['from equal to to', { from: RANGE.from, to: RANGE.from }, undefined],
    ['from after to', { from: RANGE.to, to: RANGE.from }, undefined],
    ['an invalid from', { from: new Date('nope'), to: RANGE.to }, undefined],
    ['a zero page', RANGE, { pageSize: 0 }],
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

  it(scoped ? 'logs at debug with counts only (AC-98): never the id, an amount, a currency or a package' : 'logs one info line with counts and timing only (AC-98)', async () => {
    const { client } = recordingClient(() => ({ data: [boostRow(P1)], error: null }));
    await call(new BusinessOsFinanceReadRepository(client), RANGE);
    const level = scoped ? mockLog.debug : mockLog.info;
    expect(level).toHaveBeenCalledTimes(1);
    const [ctx, message] = level.mock.calls[0];
    expect(message).toBe(`Boost purchase rows of ${scoped ? 'one account' : 'all accounts'} read`);
    expect(Object.keys(ctx).sort()).toEqual(scoped ? ['method', 'reachedCeiling', 'rows'] : ['durationMs', 'method', 'reachedCeiling', 'rows']);
    const logged = JSON.stringify([mockLog.info.mock.calls, mockLog.debug.mock.calls]);
    for (const secret of [A, P1, '98765', 'usd', 'pkg-a']) expect(logged).not.toContain(secret);
    if (scoped) expect(mockLog.info).not.toHaveBeenCalled();
  });
});

describe('R-k′ listBoostPurchasesForAccountPaidInRange: the account id (SA-W1, AC-96)', () => {
  it.each([[''], ['not-a-uuid'], ["11111111-1111-4111-8111-111111111111' or 1=1"]])(
    'refuses %p before any query, at warn',
    async (id) => {
      const { client, queries } = recordingClient(() => ({ data: [], error: null }));
      const result = await new BusinessOsFinanceReadRepository(client).listBoostPurchasesForAccountPaidInRange(id, RANGE);
      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(Error);
      expect(queries).toHaveLength(0);
      expect(mockLog.warn).toHaveBeenCalled();
      expect(JSON.stringify(mockLog.info.mock.calls)).not.toContain(id || 'never-empty');
    }
  );
});

// ── Slice 5a: the platform's paid plan invoices in the window (R-m, R-m′) ────
// The R-d describe, the limits equality, the no-write and no-aggregate pins,
// the writer names and the one-caller list above are unedited (§11D.7).

const planRow = (id: string) => ({
  id,
  user_id: A,
  kind: 'invoice_paid',
  tier: 'some-tier',
  amount_minor: 7900,
  amount_tax_minor: 0,
  currency: 'usd',
  period_start: '2026-10-12T18:21:00.000Z',
  period_end: '2026-11-12T18:21:00.000Z',
  paid_at: '2026-10-12T18:21:00.000Z',
});

const PLAN_READS = [
  {
    name: 'R-m listPlanPaymentsAllAccountsPaidInRange',
    scoped: false,
    call: (repo: Repo, range: Range, opts?: Opts) => repo.listPlanPaymentsAllAccountsPaidInRange(range, opts),
  },
  {
    name: 'R-m′ listPlanPaymentsForAccountPaidInRange',
    scoped: true,
    call: (repo: Repo, range: Range, opts?: Opts, id: string = A) => repo.listPlanPaymentsForAccountPaidInRange(id, range, opts),
  },
] as const;

describe('slice 5a column allow-list (§11D.6, M2-FR-10, AC-127)', () => {
  const cols = (list: string) => list.split(',').map((c) => c.trim());

  it('plan payments: exactly the revenue columns', () => {
    expect(cols(FINANCE_PLAN_PAYMENT_COLUMNS)).toEqual([
      'id', 'user_id', 'kind', 'tier', 'amount_minor', 'amount_tax_minor', 'currency', 'period_start', 'period_end', 'paid_at',
    ]);
  });

  it('no mode, no Stripe id, no refusal reason, no plan_written, no created_at', () => {
    for (const banned of ['livemode', 'refusal_reason', 'plan_written', 'created_at']) {
      expect(cols(FINANCE_PLAN_PAYMENT_COLUMNS)).not.toContain(banned);
    }
    expect(FINANCE_PLAN_PAYMENT_COLUMNS).not.toContain('stripe_');
  });
});

describe.each(PLAN_READS)('$name', ({ scoped, call }) => {
  const eqs = scoped ? [['kind', 'invoice_paid'], ['user_id', A]] : [['kind', 'invoice_paid']];

  it('one page: the billing events table, the exact columns, kind invoice_paid, paid_at in the range as ISO strings (AC-118), keyset order, page 1000; no livemode', async () => {
    const { client, queries } = recordingClient(() => ({ data: [planRow(P1)], error: null }));
    const result = await call(new BusinessOsFinanceReadRepository(client), RANGE);

    expect(result).toEqual({ data: { rows: [planRow(P1)], reachedCeiling: false }, error: null });
    expect(queries).toHaveLength(1);
    const [q] = queries;
    expect(q[0].args).toEqual(['business_os_billing_events']);
    expect(argsOf(q, 'select')).toEqual([[FINANCE_PLAN_PAYMENT_COLUMNS]]);
    expect(argsOf(q, 'eq')).toEqual(eqs);
    expect(argsOf(q, 'gte')).toEqual([['paid_at', '2026-10-01T00:00:00.000Z']]);
    expect(argsOf(q, 'lt')).toEqual([['paid_at', '2026-11-01T00:00:00.000Z']]);
    expect(argsOf(q, 'order')).toEqual([['id', { ascending: true }]]);
    expect(argsOf(q, 'limit')).toEqual([[1000]]);
    expect(argsOf(q, 'gt')).toEqual([]);
    expect(argsOf(q, 'not')).toEqual([]);
    expect(argsOf(q, 'or')).toEqual([]);
    expect(JSON.stringify(q)).not.toContain('livemode');
  });

  it('AC-118: a month-boundary window carries exactly its half-open ISO bounds (the database applies the microsecond rule)', async () => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    const november = { from: new Date('2026-11-01T00:00:00.000Z'), to: new Date('2026-12-01T00:00:00.000Z') };
    await call(new BusinessOsFinanceReadRepository(client), november);
    expect(argsOf(queries[0], 'gte')).toEqual([['paid_at', '2026-11-01T00:00:00.000Z']]);
    expect(argsOf(queries[0], 'lt')).toEqual([['paid_at', '2026-12-01T00:00:00.000Z']]);
  });

  it('pages by keyset (gt the last id); the kind filter (and the account) on EVERY page', async () => {
    const { client, queries } = recordingClient((_c, i) =>
      i === 0 ? { data: [planRow(P1), planRow(P2)], error: null } : { data: [planRow(P3)], error: null }
    );
    const result = await call(new BusinessOsFinanceReadRepository(client), RANGE, { pageSize: 2, ceiling: 10 });
    expect(result.data?.rows.map((r) => r.id)).toEqual([P1, P2, P3]);
    expect(result.data?.reachedCeiling).toBe(false);
    expect(queries).toHaveLength(2);
    expect(argsOf(queries[1], 'gt')).toEqual([['id', P2]]);
    for (const q of queries) {
      expect(argsOf(q, 'eq')).toEqual(eqs);
      expect(argsOf(q, 'gte')).toEqual([['paid_at', '2026-10-01T00:00:00.000Z']]);
    }
  });

  it('AC-125: the ceiling (>=) returns the rows read with reachedCeiling; exactly 3 is true; 2 is false', async () => {
    const plenty = recordingClient((calls) => {
      const [[size]] = argsOf(calls, 'limit') as number[][];
      return { data: [P1, P2, P3, P4].slice(0, size).map(planRow), error: null };
    });
    const capped = await call(new BusinessOsFinanceReadRepository(plenty.client), RANGE, { ceiling: 3, pageSize: 2 });
    expect(capped.error).toBeNull();
    expect(capped.data?.rows).toHaveLength(3);
    expect(capped.data?.reachedCeiling).toBe(true);

    const exactlyThree = recordingClient((_c, i) =>
      i === 0 ? { data: [planRow(P1), planRow(P2)], error: null } : { data: [planRow(P3)], error: null }
    );
    const three = await call(new BusinessOsFinanceReadRepository(exactlyThree.client), RANGE, { ceiling: 3, pageSize: 2 });
    expect(three.data).toEqual({ rows: [P1, P2, P3].map(planRow), reachedCeiling: true });

    const onlyTwo = recordingClient((_c, i) => (i === 0 ? { data: [planRow(P1), planRow(P2)], error: null } : { data: [], error: null }));
    const two = await call(new BusinessOsFinanceReadRepository(onlyTwo.client), RANGE, { ceiling: 3, pageSize: 2 });
    expect(two.data).toEqual({ rows: [P1, P2].map(planRow), reachedCeiling: false });
  });

  it.each([
    ['from equal to to', { from: RANGE.from, to: RANGE.from }, undefined],
    ['from after to', { from: RANGE.to, to: RANGE.from }, undefined],
    ['an invalid from', { from: new Date('nope'), to: RANGE.to }, undefined],
    ['a zero page', RANGE, { pageSize: 0 }],
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

  it(scoped ? 'logs at debug with counts only (AC-127): never the id, an amount, a currency or a tier' : 'logs one info line with counts and timing only (AC-127)', async () => {
    const { client } = recordingClient(() => ({ data: [planRow(P1)], error: null }));
    await call(new BusinessOsFinanceReadRepository(client), RANGE);
    const level = scoped ? mockLog.debug : mockLog.info;
    expect(level).toHaveBeenCalledTimes(1);
    const [ctx, message] = level.mock.calls[0];
    expect(message).toBe(`Plan payment rows of ${scoped ? 'one account' : 'all accounts'} read`);
    expect(Object.keys(ctx).sort()).toEqual(scoped ? ['method', 'reachedCeiling', 'rows'] : ['durationMs', 'method', 'reachedCeiling', 'rows']);
    const logged = JSON.stringify([mockLog.info.mock.calls, mockLog.debug.mock.calls]);
    for (const secret of [A, P1, '7900', 'usd', 'some-tier']) expect(logged).not.toContain(secret);
    if (scoped) expect(mockLog.info).not.toHaveBeenCalled();
  });
});

describe('R-m′ listPlanPaymentsForAccountPaidInRange: the account id (SA-W1, AC-123)', () => {
  it.each([[''], ['not-a-uuid'], ["' or 1=1"], ["11111111-1111-4111-8111-111111111111' or 1=1"]])(
    'refuses %p before any query, at warn',
    async (id) => {
      const { client, queries } = recordingClient(() => ({ data: [], error: null }));
      const result = await new BusinessOsFinanceReadRepository(client).listPlanPaymentsForAccountPaidInRange(id, RANGE);
      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(Error);
      expect(queries).toHaveLength(0);
      expect(mockLog.warn).toHaveBeenCalled();
      expect(JSON.stringify(mockLog.info.mock.calls)).not.toContain(id || 'never-empty');
    }
  );
});

// ── Slice 4b.2: the reversal events (R-n, R-n′) and the purchases needing attention (R-l, R-l′) ──
// The describes above are unedited apart from the recording client's `in` and the 4a column list (SA-W119).

import {
  FINANCE_BOOST_ATTENTION_COLUMNS,
  FINANCE_ID_CHUNK,
  FINANCE_REVERSAL_EVENT_COLUMNS,
  FINANCE_REVERSAL_PURCHASE_COLUMNS,
  FinanceReadTableAbsentError,
} from '../BusinessOsFinanceReadRepository';

const idOf = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const evRaw = (n: number, purchase_id: string) => ({
  id: idOf('eeeeeeee', n),
  purchase_id,
  kind: 'refund',
  amount_minor: 100,
  currency: 'USD',
  recorded_at: '2026-10-05T00:00:00.000Z',
});
const purchaseRaw = (id: string, user_id: string | null = A) => ({
  id,
  user_id,
  package_id: 'pkg-a',
  package_version: 1,
  amount_total_minor: 1000,
  amount_tax_minor: 0,
  paid_at: '2026-10-01T00:00:00.000Z',
});
const tableOf = (q: Call[]) => q[0].args[0];
const inArgs = (q: Call[]) => argsOf(q, 'in');

describe('slice 4b.2 column allow-lists (§11I.7, AC-230)', () => {
  const cols = (list: string) => list.split(',').map((c) => c.trim());
  it('events: exactly six columns; no Stripe id, no mode, no status around the step, no cumulative', () => {
    expect(cols(FINANCE_REVERSAL_EVENT_COLUMNS)).toEqual(['id', 'purchase_id', 'kind', 'amount_minor', 'currency', 'recorded_at']);
    for (const list of [FINANCE_REVERSAL_EVENT_COLUMNS, FINANCE_REVERSAL_PURCHASE_COLUMNS, FINANCE_BOOST_ATTENTION_COLUMNS]) {
      expect(list).not.toMatch(/livemode|stripe_|receipt|flag_reason|lot_id|status_before|status_after|cumulative/);
    }
    expect(cols(FINANCE_REVERSAL_PURCHASE_COLUMNS)).toEqual(['id', 'user_id', 'package_id', 'package_version', 'amount_total_minor', 'amount_tax_minor', 'paid_at']);
    expect(cols(FINANCE_BOOST_ATTENTION_COLUMNS)).toEqual(['id', 'user_id', 'status', 'currency', 'amount_total_minor', 'amount_refunded_minor', 'status_changed_at']);
    expect(FINANCE_ID_CHUNK).toBe(100);
  });
});

describe('R-n listBoostReversalEventsAllAccountsRecordedInRange', () => {
  it('events by half-open recorded_at, keyset at 1000, then their purchases by id; joined field by field; paid as a boolean', async () => {
    const PUR = idOf('pppppppp', 1);
    const { client, queries } = recordingClient((calls) =>
      tableOf(calls) === 'business_os_boost_reversal_events'
        ? { data: [evRaw(1, PUR), evRaw(2, PUR)], error: null }
        : { data: [{ ...purchaseRaw(PUR), paid_at: null }], error: null }
    );
    const result = await new BusinessOsFinanceReadRepository(client).listBoostReversalEventsAllAccountsRecordedInRange(RANGE);
    expect(result.error).toBeNull();
    expect(queries).toHaveLength(2);
    const [events, purchases] = queries;
    expect(tableOf(events)).toBe('business_os_boost_reversal_events');
    expect(argsOf(events, 'select')).toEqual([[FINANCE_REVERSAL_EVENT_COLUMNS]]);
    expect(argsOf(events, 'gte')).toEqual([['recorded_at', '2026-10-01T00:00:00.000Z']]);
    expect(argsOf(events, 'lt')).toEqual([['recorded_at', '2026-11-01T00:00:00.000Z']]);
    expect(argsOf(events, 'limit')).toEqual([[1000]]);
    expect(argsOf(events, 'eq')).toEqual([]);
    expect(tableOf(purchases)).toBe('business_os_boost_purchases');
    expect(inArgs(purchases)).toEqual([['id', [PUR]]]);
    expect(argsOf(purchases, 'limit')).toEqual([[1000]]);
    expect(result.data!.rows[0]).toEqual({
      ...evRaw(1, PUR),
      purchase: { user_id: A, package_id: 'pkg-a', package_version: 1, amount_total_minor: 1000, amount_tax_minor: 0, paid: false },
    });
    expect(JSON.stringify(queries)).not.toContain('livemode');
  });

  it('AC-217: a month-boundary window carries exactly its half-open bounds (the database applies the microsecond rule)', async () => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    const november = { from: new Date('2026-11-01T00:00:00.000Z'), to: new Date('2026-12-01T00:00:00.000Z') };
    await new BusinessOsFinanceReadRepository(client).listBoostReversalEventsAllAccountsRecordedInRange(november);
    expect(argsOf(queries[0], 'gte')).toEqual([['recorded_at', '2026-11-01T00:00:00.000Z']]);
    expect(argsOf(queries[0], 'lt')).toEqual([['recorded_at', '2026-12-01T00:00:00.000Z']]);
    // No event → no purchase read.
    expect(queries).toHaveLength(1);
  });

  it('4B2-R1: 1,000 events per page → a next page with gt(last id); and the purchases go out in chunks of 100, each paged', async () => {
    const page = (start: number, n: number) => Array.from({ length: n }, (_, i) => evRaw(start + i, idOf('pppppppp', start + i)));
    const { client, queries } = recordingClient((calls, i) => {
      if (tableOf(calls) === 'business_os_boost_reversal_events') return { data: i === 0 ? page(1, 1000) : page(1001, 250), error: null };
      const [[, ids]] = inArgs(calls) as [string, string[]][];
      return { data: ids.map((id) => purchaseRaw(id)), error: null };
    });
    const result = await new BusinessOsFinanceReadRepository(client).listBoostReversalEventsAllAccountsRecordedInRange(RANGE);
    expect(result.data!.rows).toHaveLength(1250);
    const eventQueries = queries.filter((q) => tableOf(q) === 'business_os_boost_reversal_events');
    expect(eventQueries).toHaveLength(2);
    expect(argsOf(eventQueries[1], 'gt')).toEqual([['id', idOf('eeeeeeee', 1000)]]);
    const purchaseQueries = queries.filter((q) => tableOf(q) === 'business_os_boost_purchases');
    expect(purchaseQueries).toHaveLength(13);
    for (const q of purchaseQueries) {
      const [[, ids]] = inArgs(q) as [string, string[]][];
      expect(ids.length).toBeLessThanOrEqual(100);
      expect(argsOf(q, 'limit')[0][0]).toBeLessThanOrEqual(1000);
    }
    for (const q of queries) for (const [n] of argsOf(q, 'limit') as number[][]) expect(n).toBeLessThanOrEqual(1000);
  });

  it('the ceiling (>=) → reachedCeiling, never an error', async () => {
    const { client } = recordingClient((calls) => {
      if (tableOf(calls) !== 'business_os_boost_reversal_events') return { data: [], error: null };
      const [[size]] = argsOf(calls, 'limit') as number[][];
      return { data: Array.from({ length: size }, (_, i) => evRaw(i + 1, idOf('pppppppp', 1))), error: null };
    });
    const result = await new BusinessOsFinanceReadRepository(client).listBoostReversalEventsAllAccountsRecordedInRange(RANGE, { ceiling: 3, pageSize: 2 });
    expect(result.data).toMatchObject({ reachedCeiling: true });
    expect(result.data!.rows).toHaveLength(3);
  });

  it.each([['42P01'], ['PGRST205']])('§7: the table absent (%s) → FinanceReadTableAbsentError, logged at warn, never at error, never thrown', async (code) => {
    const { client } = recordingClient(() => ({ data: null, error: { code, message: 'relation does not exist' } }));
    const result = await new BusinessOsFinanceReadRepository(client).listBoostReversalEventsAllAccountsRecordedInRange(RANGE);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(FinanceReadTableAbsentError);
    expect(mockLog.warn).toHaveBeenCalledWith(expect.objectContaining({ reason: 'table_absent' }), expect.any(String));
    expect(mockLog.error).not.toHaveBeenCalled();
  });

  it('any other error is { data: null, error } at error; a bad range is refused before any query', async () => {
    const { client } = recordingClient(() => ({ data: null, error: new Error('boom') }));
    expect((await new BusinessOsFinanceReadRepository(client).listBoostReversalEventsAllAccountsRecordedInRange(RANGE)).error).toBeInstanceOf(Error);
    expect(mockLog.error).toHaveBeenCalled();
    const empty = recordingClient(() => ({ data: [], error: null }));
    const refused = await new BusinessOsFinanceReadRepository(empty.client).listBoostReversalEventsAllAccountsRecordedInRange({ from: RANGE.to, to: RANGE.from });
    expect(refused.data).toBeNull();
    expect(empty.queries).toHaveLength(0);
  });

  it('logs one info line with counts and timing only', async () => {
    const { client } = recordingClient((calls) =>
      tableOf(calls) === 'business_os_boost_reversal_events' ? { data: [evRaw(1, P1)], error: null } : { data: [purchaseRaw(P1)], error: null }
    );
    await new BusinessOsFinanceReadRepository(client).listBoostReversalEventsAllAccountsRecordedInRange(RANGE);
    expect(mockLog.info).toHaveBeenCalledTimes(1);
    const [ctx] = mockLog.info.mock.calls[0];
    expect(Object.keys(ctx).sort()).toEqual(['durationMs', 'method', 'purchases', 'reachedCeiling', 'rows']);
    expect(JSON.stringify(mockLog.info.mock.calls)).not.toContain(P1);
  });
});

describe('R-n′ listBoostReversalEventsForAccountRecordedInRange (4B2-R2: isolation)', () => {
  it('the account’s purchases first (.eq user_id on every page, every status), then only their events, in chunks', async () => {
    const OWN = idOf('pppppppp', 1);
    const { client, queries } = recordingClient((calls) =>
      tableOf(calls) === 'business_os_boost_purchases' ? { data: [purchaseRaw(OWN)], error: null } : { data: [evRaw(1, OWN)], error: null }
    );
    const result = await new BusinessOsFinanceReadRepository(client).listBoostReversalEventsForAccountRecordedInRange(A, RANGE);
    const [purchases, events] = queries;
    expect(tableOf(purchases)).toBe('business_os_boost_purchases');
    expect(argsOf(purchases, 'eq')).toEqual([['user_id', A]]);
    expect(argsOf(purchases, 'in')).toEqual([]);
    expect(tableOf(events)).toBe('business_os_boost_reversal_events');
    expect(inArgs(events)).toEqual([['purchase_id', [OWN]]]);
    expect(argsOf(events, 'gte')).toEqual([['recorded_at', '2026-10-01T00:00:00.000Z']]);
    expect(result.data!.rows.map((r) => r.purchase_id)).toEqual([OWN]);
  });

  it('fail closed: an event whose purchase is not the account’s is DROPPED (a foreign event)', async () => {
    const OWN = idOf('pppppppp', 1);
    const FOREIGN = idOf('pppppppp', 9);
    const { client } = recordingClient((calls) =>
      tableOf(calls) === 'business_os_boost_purchases'
        ? { data: [purchaseRaw(OWN)], error: null }
        : { data: [evRaw(1, OWN), evRaw(2, FOREIGN)], error: null }
    );
    const result = await new BusinessOsFinanceReadRepository(client).listBoostReversalEventsForAccountRecordedInRange(A, RANGE);
    expect(result.data!.rows.map((r) => r.purchase_id)).toEqual([OWN]);
    expect(mockLog.debug).toHaveBeenCalledWith(expect.objectContaining({ dropped: 1 }), expect.any(String));
  });

  it('the purchase read pages at 1,000 with .eq(user_id) on EVERY page; no purchase → no event query', async () => {
    const { client, queries } = recordingClient((calls, i) =>
      tableOf(calls) === 'business_os_boost_purchases'
        ? { data: i === 0 ? Array.from({ length: 1000 }, (_, k) => purchaseRaw(idOf('pppppppp', k + 1))) : [], error: null }
        : { data: [], error: null }
    );
    await new BusinessOsFinanceReadRepository(client).listBoostReversalEventsForAccountRecordedInRange(A, RANGE);
    const purchaseQueries = queries.filter((q) => tableOf(q) === 'business_os_boost_purchases');
    expect(purchaseQueries).toHaveLength(2);
    for (const q of purchaseQueries) expect(argsOf(q, 'eq')).toEqual([['user_id', A]]);
    expect(argsOf(purchaseQueries[1], 'gt')).toEqual([['id', idOf('pppppppp', 1000)]]);
    // 1,000 purchase ids → ten event chunks of 100.
    expect(queries.filter((q) => tableOf(q) === 'business_os_boost_reversal_events')).toHaveLength(10);

    const none = recordingClient(() => ({ data: [], error: null }));
    await new BusinessOsFinanceReadRepository(none.client).listBoostReversalEventsForAccountRecordedInRange(A, RANGE);
    expect(none.queries.map(tableOf)).toEqual(['business_os_boost_purchases']);
  });

  it('4B2-R1: 1,000 events inside one chunk → the next page inside that chunk', async () => {
    const OWN = idOf('pppppppp', 1);
    let eventCalls = 0;
    const { client, queries } = recordingClient((calls) => {
      if (tableOf(calls) === 'business_os_boost_purchases') return { data: [purchaseRaw(OWN)], error: null };
      eventCalls += 1;
      return { data: eventCalls === 1 ? Array.from({ length: 1000 }, (_, k) => evRaw(k + 1, OWN)) : [evRaw(2000, OWN)], error: null };
    });
    const result = await new BusinessOsFinanceReadRepository(client).listBoostReversalEventsForAccountRecordedInRange(A, RANGE);
    const eventQueries = queries.filter((q) => tableOf(q) === 'business_os_boost_reversal_events');
    expect(eventQueries).toHaveLength(2);
    expect(inArgs(eventQueries[1])).toEqual([['purchase_id', [OWN]]]);
    expect(argsOf(eventQueries[1], 'gt')).toEqual([['id', idOf('eeeeeeee', 1000)]]);
    expect(result.data!.rows).toHaveLength(1001);
  });

  it.each([[''], ['not-a-uuid'], ["11111111-1111-4111-8111-111111111111' or 1=1"]])('refuses %p before any query, at warn', async (id) => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    const result = await new BusinessOsFinanceReadRepository(client).listBoostReversalEventsForAccountRecordedInRange(id, RANGE);
    expect(result.data).toBeNull();
    expect(queries).toHaveLength(0);
    expect(mockLog.warn).toHaveBeenCalled();
  });

  it('the events table absent → the typed error', async () => {
    const { client } = recordingClient((calls) =>
      tableOf(calls) === 'business_os_boost_purchases' ? { data: [purchaseRaw(P1)], error: null } : { data: null, error: { code: '42P01', message: 'x' } }
    );
    expect((await new BusinessOsFinanceReadRepository(client).listBoostReversalEventsForAccountRecordedInRange(A, RANGE)).error).toBeInstanceOf(
      FinanceReadTableAbsentError
    );
  });
});

const attentionRaw = (n: number, status = 'disputed', user_id: string | null = A) => ({
  id: idOf('aaaaaaaa', n),
  user_id,
  status,
  currency: 'USD',
  amount_total_minor: 1000,
  amount_refunded_minor: 0,
  status_changed_at: '2026-10-03T00:00:00.000Z',
});

describe.each([
  { name: 'R-l listBoostPurchasesNeedingAttentionAllAccounts', scoped: false },
  { name: 'R-l′ listBoostPurchasesNeedingAttentionForAccount', scoped: true },
])('$name', ({ scoped }) => {
  const call = (repo: Repo, opts?: Opts) =>
    scoped ? repo.listBoostPurchasesNeedingAttentionForAccount(A, opts) : repo.listBoostPurchasesNeedingAttentionAllAccounts(opts);

  it('the two statuses, the exact columns, keyset at 1000; the scope on every page; then the opened dates of the disputed ones only', async () => {
    const { client, queries } = recordingClient((calls) =>
      tableOf(calls) === 'business_os_boost_purchases'
        ? { data: [attentionRaw(1), attentionRaw(2, 'flagged_mismatch')], error: null }
        : {
            data: [
              { id: idOf('eeeeeeee', 1), purchase_id: idOf('aaaaaaaa', 1), recorded_at: '2026-10-02T00:00:00.000Z' },
              { id: idOf('eeeeeeee', 2), purchase_id: idOf('aaaaaaaa', 1), recorded_at: '2026-10-04T00:00:00.000Z' },
            ],
            error: null,
          }
    );
    const result = await call(new BusinessOsFinanceReadRepository(client));
    const [purchases, opened] = queries;
    expect(argsOf(purchases, 'select')).toEqual([[FINANCE_BOOST_ATTENTION_COLUMNS]]);
    expect(inArgs(purchases)).toEqual([['status', ['disputed', 'flagged_mismatch']]]);
    expect(argsOf(purchases, 'eq')).toEqual(scoped ? [['user_id', A]] : []);
    expect(argsOf(purchases, 'limit')).toEqual([[1000]]);
    expect(tableOf(opened)).toBe('business_os_boost_reversal_events');
    expect(inArgs(opened)).toEqual([['purchase_id', [idOf('aaaaaaaa', 1)]]]);
    expect(argsOf(opened, 'eq')).toEqual([['kind', 'dispute_opened']]);
    expect(result.data!.openedDates).toBe('read');
    // The latest opening is the open dispute's.
    expect(result.data!.rows.map((r) => r.disputeOpenedAt)).toEqual(['2026-10-04T00:00:00.000Z', null]);
  });

  it('4B2-R1 / R2: 1,000 rows → next page with gt(last id); the scope on EVERY page', async () => {
    const { client, queries } = recordingClient((calls, i) =>
      tableOf(calls) === 'business_os_boost_purchases'
        ? { data: i === 0 ? Array.from({ length: 1000 }, (_, k) => attentionRaw(k + 1, 'flagged_mismatch')) : [attentionRaw(5000, 'flagged_mismatch')], error: null }
        : { data: [], error: null }
    );
    const result = await call(new BusinessOsFinanceReadRepository(client));
    const purchaseQueries = queries.filter((q) => tableOf(q) === 'business_os_boost_purchases');
    expect(purchaseQueries).toHaveLength(2);
    expect(argsOf(purchaseQueries[1], 'gt')).toEqual([['id', idOf('aaaaaaaa', 1000)]]);
    for (const q of purchaseQueries) expect(argsOf(q, 'eq')).toEqual(scoped ? [['user_id', A]] : []);
    expect(result.data!.rows).toHaveLength(1001);
    // No disputed row → no events query.
    expect(queries.filter((q) => tableOf(q) === 'business_os_boost_reversal_events')).toHaveLength(0);
  });

  it('§7: the opened dates failing (table absent) never fails the read: openedDates failed, dates null, warn', async () => {
    const { client } = recordingClient((calls) =>
      tableOf(calls) === 'business_os_boost_purchases' ? { data: [attentionRaw(1)], error: null } : { data: null, error: { code: 'PGRST205', message: 'x' } }
    );
    const result = await call(new BusinessOsFinanceReadRepository(client));
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ openedDates: 'failed', rows: [expect.objectContaining({ disputeOpenedAt: null })] });
    expect(mockLog.warn).toHaveBeenCalledWith(expect.objectContaining({ reason: 'table_absent' }), expect.any(String));
  });

  it('the purchase read failing is { data: null, error }, never thrown', async () => {
    const { client } = recordingClient(() => ({ data: null, error: new Error('boom') }));
    const result = await call(new BusinessOsFinanceReadRepository(client));
    expect(result.data).toBeNull();
    expect(mockLog.error).toHaveBeenCalled();
  });
});

describe('R-l′: the account id', () => {
  it.each([[''], ['not-a-uuid']])('refuses %p before any query', async (id) => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    const result = await new BusinessOsFinanceReadRepository(client).listBoostPurchasesNeedingAttentionForAccount(id);
    expect(result.data).toBeNull();
    expect(queries).toHaveLength(0);
  });
});
