/**
 * BusinessOsCreditOwnerReadRepository — the owner's own ledger read for the
 * dashboard card (credit deduction slice 6a, workplan §4.3, SA SQ-21, W6-3, W6-8).
 *
 * Pinned: the client is required and no service-role client is imported; the
 * selected columns are a subset of the migration's `authenticated` GRANT lines
 * (parsed, not hand-copied); every method scopes by `user_id` and refuses a
 * non-UUID account before querying; period keys pass through verbatim; errors
 * are returned, never thrown; the source holds no write verb and no `.rpc(`,
 * and never filters on the raw `service` column.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

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
  BusinessOsCreditOwnerReadRepository,
  OWNER_CHARGE_COLUMNS,
  OWNER_CREDIT_READ_LIMITS,
  OWNER_DIARY_COLUMNS,
  OWNER_LOT_COLUMNS,
  OWNER_LOT_DRAW_COLUMNS,
  OWNER_TOTALS_COLUMNS,
  type OwnerCreditLotRow,
} from '../BusinessOsCreditOwnerReadRepository';
// Slice 11d: type only, for the type-level assertion that an owner lot row is
// a balance-core lot (listed on the G3 guard, SA W11d-3).
import type { CreditLotForBalance } from '@/lib/business-os/credits/creditLots';

type Call = { method: string; args: unknown[] };

/** Records every query; each resolves with `respond(calls, index)`. */
function recordingClient(respond: (calls: Call[], index: number) => { data: unknown; error: unknown }) {
  const queries: Call[][] = [];
  const client = {
    from: (table: string) => {
      const calls: Call[] = [{ method: 'from', args: [table] }];
      const index = queries.length;
      queries.push(calls);
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'gte', 'lt', 'lte', 'order', 'range', 'limit']) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ method, args });
          return builder;
        };
      }
      builder.maybeSingle = () => {
        calls.push({ method: 'maybeSingle', args: [] });
        return Promise.resolve(respond(calls, index));
      };
      builder.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
        try {
          resolve(respond(calls, index));
        } catch (err) {
          reject(err);
        }
      };
      return builder;
    },
    rpc: () => {
      throw new Error('the owner repository must never call rpc');
    },
  } as unknown as SupabaseClient;
  return { client, queries };
}

const argsOf = (calls: Call[], method: string) => calls.filter((c) => c.method === method).map((c) => c.args);

const A = '11111111-1111-4111-8111-111111111111';
const PERIOD = '2026-09-14T09:31:07.123456+00:00';
const ACTION = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';

beforeEach(() => jest.clearAllMocks());

describe('columns (owner-granted only)', () => {
  const migration = fs.readFileSync(
    path.join(process.cwd(), 'supabase/migrations/20261015_business_os_credit_charges.sql'),
    'utf8'
  );

  function grantedTo(table: string): string[] {
    const match = new RegExp(
      `GRANT SELECT \\(([^)]*)\\) ON TABLE public\\.${table} TO authenticated;`
    ).exec(migration);
    if (!match) throw new Error(`No authenticated GRANT line for ${table}`);
    return match[1].split(',').map((c) => c.trim());
  }

  const columns = (list: string) => list.split(',').map((c) => c.trim());

  it('parses both GRANT lines (a failed parse would make the checks below vacuous)', () => {
    expect(grantedTo('business_os_credit_totals')).toContain('credits_owner');
    expect(grantedTo('business_os_credit_charges')).toContain('triggered_by');
    // The cost columns are NOT granted — the reason this repository exists.
    expect(grantedTo('business_os_credit_totals')).not.toContain('cost_usd_total');
    expect(grantedTo('business_os_credit_charges')).not.toContain('cost_usd');
  });

  it('selects only totals columns the owner is granted', () => {
    const granted = grantedTo('business_os_credit_totals');
    expect(columns(OWNER_TOTALS_COLUMNS).filter((c) => !granted.includes(c))).toEqual([]);
  });

  it('selects only charge columns the owner is granted, including those the effective-fields resolver needs (W6-3)', () => {
    const granted = grantedTo('business_os_credit_charges');
    expect(columns(OWNER_CHARGE_COLUMNS).filter((c) => !granted.includes(c))).toEqual([]);
    expect(columns(OWNER_CHARGE_COLUMNS)).toEqual(
      expect.arrayContaining(['kind', 'action_id', 'adjusts_action_id', 'user_id', 'service', 'action_type', 'triggered_by'])
    );
  });
});

describe('columns of the credit history (slice 7a, SA SQ-31)', () => {
  const migration = fs.readFileSync(
    path.join(process.cwd(), 'supabase/migrations/20261015_business_os_credit_charges.sql'),
    'utf8'
  );
  const granted = /GRANT SELECT \(([^)]*)\) ON TABLE public\.business_os_credit_charges TO authenticated;/
    .exec(migration)![1]
    .split(',')
    .map((c) => c.trim());
  const columns = OWNER_DIARY_COLUMNS.split(',').map((c) => c.trim());

  it('selects only charge columns the owner is granted', () => {
    expect(granted).toContain('outcome');
    expect(columns.filter((c) => !granted.includes(c))).toEqual([]);
  });

  it('is exactly the SA list: no group id, reason code or credit value version', () => {
    expect(columns).toEqual([
      'id', 'kind', 'action_id', 'adjusts_action_id', 'period_start', 'credits',
      'service', 'action_type', 'triggered_by', 'outcome', 'created_at', 'user_id',
    ]);
  });
});

describe('constructor', () => {
  it('requires the caller\'s client: there is no service-role default', () => {
    expect(() => new BusinessOsCreditOwnerReadRepository(undefined as unknown as SupabaseClient)).toThrow();
  });
});

describe('findTotalsForPeriod', () => {
  it('reads one period of one account, by the exact period string', async () => {
    const row = { period_start: PERIOD, credits_total: '3.500000' };
    const { client, queries } = recordingClient(() => ({ data: row, error: null }));

    const result = await new BusinessOsCreditOwnerReadRepository(client).findTotalsForPeriod(A, PERIOD);

    expect(result).toEqual({ data: row, error: null });
    const calls = queries[0];
    expect(calls[0].args).toEqual(['business_os_credit_totals']);
    expect(argsOf(calls, 'select')).toEqual([[OWNER_TOTALS_COLUMNS]]);
    expect(argsOf(calls, 'eq')).toEqual([
      ['user_id', A],
      ['period_start', PERIOD],
    ]);
  });

  it('reports no row as null (nothing charged yet)', async () => {
    const { client } = recordingClient(() => ({ data: null, error: null }));
    expect(await new BusinessOsCreditOwnerReadRepository(client).findTotalsForPeriod(A, PERIOD)).toEqual({
      data: null,
      error: null,
    });
  });

  it('returns a read error, never "no row"', async () => {
    const { client } = recordingClient(() => ({ data: null, error: new Error('JWT expired') }));
    const result = await new BusinessOsCreditOwnerReadRepository(client).findTotalsForPeriod(A, PERIOD);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('JWT expired');
  });

  it.each([
    ['a non-UUID account', 'not-a-uuid', PERIOD],
    ['an empty account', '', PERIOD],
    ['a missing period', A, ''],
    ['a nonsense period', A, 'yesterday'],
  ])('refuses %s before querying', async (_name, account, period) => {
    const { client, queries } = recordingClient(() => ({ data: null, error: null }));
    const result = await new BusinessOsCreditOwnerReadRepository(client).findTotalsForPeriod(account, period);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(queries).toHaveLength(0);
    expect(mockLog.warn).toHaveBeenCalled();
  });
});

describe('listTotalsFrom', () => {
  it('reads every period from the anchor string on, oldest first, bounded', async () => {
    const { client, queries } = recordingClient(() => ({ data: [{ period_start: PERIOD }], error: null }));

    const result = await new BusinessOsCreditOwnerReadRepository(client).listTotalsFrom(A, PERIOD);

    expect(result.data).toEqual({ rows: [{ period_start: PERIOD }], reachedCeiling: false });
    const calls = queries[0];
    expect(argsOf(calls, 'eq')).toEqual([['user_id', A]]);
    expect(argsOf(calls, 'gte')).toEqual([['period_start', PERIOD]]);
    expect(argsOf(calls, 'range')).toEqual([[0, OWNER_CREDIT_READ_LIMITS.TOTALS_CEILING - 1]]);
  });

  it('says so when the ceiling is reached', async () => {
    const rows = Array.from({ length: OWNER_CREDIT_READ_LIMITS.TOTALS_CEILING }, (_, i) => ({ period_start: `p${i}` }));
    const { client } = recordingClient(() => ({ data: rows, error: null }));
    const result = await new BusinessOsCreditOwnerReadRepository(client).listTotalsFrom(A, PERIOD);
    expect(result.data?.reachedCeiling).toBe(true);
  });

  it('returns a read error, never throws', async () => {
    const client = { from: () => { throw new Error('client exploded'); } } as unknown as SupabaseClient;
    const result = await new BusinessOsCreditOwnerReadRepository(client).listTotalsFrom(A, PERIOD);
    expect(result.error?.message).toBe('client exploded');
  });
});

describe('listAdjustmentsForPeriods', () => {
  it('reads adjustment rows of the named periods only, for one account', async () => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));

    const result = await new BusinessOsCreditOwnerReadRepository(client).listAdjustmentsForPeriods(A, [PERIOD, PERIOD]);

    expect(result.data).toEqual({ rows: [], reachedCeiling: false });
    const calls = queries[0];
    expect(calls[0].args).toEqual(['business_os_credit_charges']);
    expect(argsOf(calls, 'select')).toEqual([[OWNER_CHARGE_COLUMNS]]);
    expect(argsOf(calls, 'eq')).toEqual([
      ['user_id', A],
      ['kind', 'adjustment'],
    ]);
    // De-duplicated, verbatim.
    expect(argsOf(calls, 'in')).toEqual([['period_start', [PERIOD]]]);
  });

  it('refuses an empty period list before querying', async () => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    const result = await new BusinessOsCreditOwnerReadRepository(client).listAdjustmentsForPeriods(A, []);
    expect(result.error).toBeInstanceOf(Error);
    expect(queries).toHaveLength(0);
  });
});

describe('findChargesByActionIds', () => {
  it('reads charge rows of this account by action id', async () => {
    const { client, queries } = recordingClient(() => ({ data: [{ action_id: ACTION }], error: null }));

    const result = await new BusinessOsCreditOwnerReadRepository(client).findChargesByActionIds(A, [ACTION]);

    expect(result.data).toEqual([{ action_id: ACTION }]);
    expect(argsOf(queries[0], 'eq')).toEqual([
      ['user_id', A],
      ['kind', 'charge'],
    ]);
    expect(argsOf(queries[0], 'in')).toEqual([['action_id', [ACTION]]]);
  });

  it('splits a long id list into requests of at most MAX_IDS_PER_REQUEST', async () => {
    const ids = Array.from(
      { length: OWNER_CREDIT_READ_LIMITS.MAX_IDS_PER_REQUEST + 1 },
      (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`
    );
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    await new BusinessOsCreditOwnerReadRepository(client).findChargesByActionIds(A, ids);
    expect(queries).toHaveLength(2);
  });

  it('refuses a non-UUID action id before querying', async () => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    const result = await new BusinessOsCreditOwnerReadRepository(client).findChargesByActionIds(A, ['nope']);
    expect(result.error).toBeInstanceOf(Error);
    expect(queries).toHaveLength(0);
  });

  it('returns a failed chunk as an error, never a partial list', async () => {
    const { client } = recordingClient(() => ({ data: null, error: new Error('boom') }));
    const result = await new BusinessOsCreditOwnerReadRepository(client).findChargesByActionIds(A, [ACTION]);
    expect(result).toEqual({ data: null, error: expect.any(Error) });
  });
});

describe('source guards', () => {
  const FILE = 'lib/repositories/BusinessOsCreditOwnerReadRepository.ts';
  const raw = fs.readFileSync(path.join(process.cwd(), FILE), 'utf8');
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const WRITE_VERB = /\.(insert|update|upsert|delete|rpc)\s*\(/;

  it('the write-verb rule matches a planted write, so a clean file means something', () => {
    expect(WRITE_VERB.test(`await this.supabase.from('x').insert({ a: 1 })`)).toBe(true);
    expect(WRITE_VERB.test(`this.supabase.rpc('fn', {})`)).toBe(true);
  });

  it('names no write verb and no rpc: the repository cannot write', () => {
    expect(WRITE_VERB.test(code)).toBe(false);
  });

  it('imports no service-role client (the caller passes the RLS client)', () => {
    expect(code).not.toMatch(/supabaseServer/);
  });

  it('never filters, orders or groups on the raw service column (N-10)', () => {
    expect(code).not.toMatch(/\.(eq|neq|in|is|filter|order|or|match)\(\s*['"]service['"]/);
  });

  it('scopes every query by user_id', () => {
    const froms = (code.match(/\.from\(/g) ?? []).length;
    const scopes = (code.match(/\.eq\('user_id', accountId\)/g) ?? []).length;
    expect(froms).toBeGreaterThan(0);
    expect(scopes).toBe(froms);
  });
});

/**
 * Credit deduction slice 11c (SA W11c-17): the CI-side pin on the
 * service-role paths. This suite runs in `test:bos-entitlements`. Exactly three
 * product files construct this repository (the owner wiring, slice 8b's
 * low-line wiring and the admin wiring), and only the two documented
 * service-role callers (low-line and admin) name the service client.
 */
describe('who constructs this repository (slice 11c, SA W11c-17)', () => {
  const ROOT = process.cwd();
  const OWNER_WIRING = 'lib/business-os/credits/ownerCreditUsageDeps.ts';
  const ADMIN_WIRING = 'lib/business-os/credits/adminCreditPositionDeps.ts';
  const LOW_LINE_WIRING = 'lib/business-os/credits/creditLowLineDeps.ts';
  const CONSTRUCTS = /new\s+BusinessOsCreditOwnerReadRepository\s*\(/;
  const SERVICE_CLIENT = /(?<![A-Za-z0-9_$])supabaseServer(?![A-Za-z0-9_$])/;
  const codeOf = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  function productFiles(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name.startsWith('.')) continue;
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) productFiles(rel, out);
      else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) out.push(rel);
    }
    return out;
  }

  const sources = ['app', 'lib', 'components']
    .flatMap((dir) => productFiles(dir))
    .map((file) => ({ file, code: codeOf(fs.readFileSync(path.join(ROOT, file), 'utf8')) }));

  it('the rules see a planted violation, and ignore one in a comment', () => {
    expect(CONSTRUCTS.test(codeOf('const r = new BusinessOsCreditOwnerReadRepository(supabaseServer);'))).toBe(true);
    expect(CONSTRUCTS.test(codeOf('// new BusinessOsCreditOwnerReadRepository(client)'))).toBe(false);
    expect(SERVICE_CLIENT.test(codeOf("import { supabaseServer } from '@/lib/supabaseServer';"))).toBe(true);
    expect(SERVICE_CLIENT.test(codeOf('/* supabaseServer is explained here */'))).toBe(false);
  });

  it('scans a non-trivial number of files', () => {
    expect(sources.length).toBeGreaterThan(500);
  });

  it('exactly three product files construct it: the owner, low-line and admin wirings', () => {
    expect(sources.filter(({ code }) => CONSTRUCTS.test(code)).map(({ file }) => file).sort()).toEqual(
      [ADMIN_WIRING, LOW_LINE_WIRING, OWNER_WIRING].sort()
    );
  });

  it('only the two documented service-role callers name the service client (not the owner wiring)', () => {
    const constructors = sources.filter(({ code }) => CONSTRUCTS.test(code));
    expect(
      constructors.filter(({ code }) => SERVICE_CLIENT.test(code)).map(({ file }) => file).sort()
    ).toEqual([ADMIN_WIRING, LOW_LINE_WIRING].sort());
  });
});

/**
 * Credit deduction slice 11d (workplan §11d.6.1; SA W11d-5, OP-40, W11d-7):
 * the owner's own credit lots, for the card's "Extra credits" figure.
 */
describe('listOwnCreditLots (slice 11d)', () => {
  const migration = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20261017_business_os_credit_lots.sql'), 'utf8');
  const grantedTo = (table: string): string[] => {
    const match = new RegExp(`GRANT SELECT \\(([^)]*)\\) ON TABLE public\\.${table} TO authenticated;`).exec(migration);
    if (!match) throw new Error(`No authenticated GRANT line for ${table}`);
    return match[1].split(',').map((c) => c.trim());
  };
  const columns = (list: string) => list.split(',').map((c) => c.trim());
  const HIDDEN = ['reason', 'actor_kind', 'actor_admin_id', 'idempotency_key', 'source_ref', 'credit_value_version'];

  const lotRow = (n: number, over: Record<string, unknown> = {}) => ({
    id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, '0')}`,
    user_id: A,
    credits_granted: '200.000000',
    expires_at: null,
    created_at: '2026-10-01T09:00:00.123456+00:00',
    ...over,
  });
  const drawRow = (lot: number, over: Record<string, unknown> = {}) => ({
    id: `eeeeeeee-eeee-4eee-8eee-${String(lot).padStart(12, '0')}`,
    lot_id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(lot).padStart(12, '0')}`,
    user_id: A,
    kind: 'reversal',
    credits: '50.000000',
    created_at: '2026-10-02T09:00:00+00:00',
    ...over,
  });

  /** Lots from `lots`, draws from `draws`, by table. */
  const byTable = (lots: unknown, draws: unknown = []) =>
    recordingClient((calls) =>
      calls[0].args[0] === 'business_os_credit_lots' ? { data: lots, error: null } : { data: draws, error: null }
    );

  it('parses both 20261017 GRANT lines (non-vacuity), and the hidden columns are not granted', () => {
    expect(grantedTo('business_os_credit_lots')).toContain('credits_granted');
    expect(grantedTo('business_os_credit_lot_draws')).toContain('lot_id');
    for (const column of HIDDEN) {
      expect(grantedTo('business_os_credit_lots')).not.toContain(column);
      expect(grantedTo('business_os_credit_lot_draws')).not.toContain(column);
    }
  });

  it('the column lists are exact strings (SA OP-40)', () => {
    expect(OWNER_LOT_COLUMNS).toBe('id, user_id, credits_granted, expires_at, created_at');
    expect(OWNER_LOT_DRAW_COLUMNS).toBe('id, lot_id, user_id, kind, credits, created_at');
  });

  it('both column lists are subsets of their GRANT lines, and narrower: no source, base or bonus', () => {
    expect(columns(OWNER_LOT_COLUMNS).filter((c) => !grantedTo('business_os_credit_lots').includes(c))).toEqual([]);
    expect(columns(OWNER_LOT_DRAW_COLUMNS).filter((c) => !grantedTo('business_os_credit_lot_draws').includes(c))).toEqual([]);
    for (const column of ['source', 'credits_base', 'credits_bonus', ...HIDDEN]) {
      expect(columns(OWNER_LOT_COLUMNS)).not.toContain(column);
      expect(columns(OWNER_LOT_DRAW_COLUMNS)).not.toContain(column);
    }
  });

  it('no lots: [] and NO draws query', async () => {
    const { client, queries } = byTable([]);
    const result = await new BusinessOsCreditOwnerReadRepository(client).listOwnCreditLots(A);
    expect(result).toEqual({ data: [], error: null });
    expect(queries).toHaveLength(1);
    const calls = queries[0];
    expect(calls[0].args).toEqual(['business_os_credit_lots']);
    expect(argsOf(calls, 'select')).toEqual([[OWNER_LOT_COLUMNS]]);
    expect(argsOf(calls, 'eq')).toEqual([['user_id', A]]);
    expect(argsOf(calls, 'order')).toEqual([['created_at', { ascending: true }]]);
    expect(argsOf(calls, 'range')).toEqual([[0, OWNER_CREDIT_READ_LIMITS.LOTS_CEILING - 1]]);
  });

  it('lots and their draws: both reads scoped by user_id, draws attached to their lot, numeric strings parsed', async () => {
    const { client, queries } = byTable(
      [lotRow(1), lotRow(2, { expires_at: '2026-12-31T00:00:00+00:00', credits_granted: 12.5 })],
      [drawRow(1), drawRow(1, { id: 'eeeeeeee-eeee-4eee-8eee-000000000099', credits: '0.250000' })]
    );
    const result = await new BusinessOsCreditOwnerReadRepository(client).listOwnCreditLots(A);
    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001',
        creditsGranted: 200,
        expiresAt: null,
        createdAt: '2026-10-01T09:00:00.123456+00:00',
        draws: [
          { kind: 'reversal', credits: 50, createdAt: '2026-10-02T09:00:00+00:00' },
          { kind: 'reversal', credits: 0.25, createdAt: '2026-10-02T09:00:00+00:00' },
        ],
      },
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002',
        creditsGranted: 12.5,
        expiresAt: '2026-12-31T00:00:00+00:00',
        createdAt: '2026-10-01T09:00:00.123456+00:00',
        draws: [],
      },
    ]);
    expect(queries).toHaveLength(2);
    const draws = queries[1];
    expect(draws[0].args).toEqual(['business_os_credit_lot_draws']);
    expect(argsOf(draws, 'select')).toEqual([[OWNER_LOT_DRAW_COLUMNS]]);
    expect(argsOf(draws, 'eq')).toEqual([['user_id', A]]);
    expect(argsOf(draws, 'in')).toEqual([
      ['lot_id', ['bbbbbbbb-bbbb-4bbb-8bbb-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002']],
    ]);
    expect(argsOf(draws, 'range')).toEqual([[0, OWNER_CREDIT_READ_LIMITS.LOTS_CEILING - 1]]);
  });

  it('chunks the draws read at MAX_IDS_PER_REQUEST (201 lots, two draw requests)', async () => {
    const lots = Array.from({ length: OWNER_CREDIT_READ_LIMITS.MAX_IDS_PER_REQUEST + 1 }, (_, i) => lotRow(i + 1));
    const { client, queries } = byTable(lots, []);
    const result = await new BusinessOsCreditOwnerReadRepository(client).listOwnCreditLots(A);
    expect(result.data).toHaveLength(201);
    expect(queries).toHaveLength(3);
    expect((argsOf(queries[1], 'in')[0][1] as string[]).length).toBe(OWNER_CREDIT_READ_LIMITS.MAX_IDS_PER_REQUEST);
    expect((argsOf(queries[2], 'in')[0][1] as string[]).length).toBe(1);
  });

  it.each([
    ['the lots ceiling', () => byTable(Array.from({ length: OWNER_CREDIT_READ_LIMITS.LOTS_CEILING }, (_, i) => lotRow(i + 1)))],
    [
      'a draws chunk at the ceiling',
      () => byTable([lotRow(1)], Array.from({ length: OWNER_CREDIT_READ_LIMITS.LOTS_CEILING }, () => drawRow(1))),
    ],
  ])('%s is an error, never a partial list', async (_name, make) => {
    const { client } = make();
    const result = await new BusinessOsCreditOwnerReadRepository(client).listOwnCreditLots(A);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });

  it('a read error on the lots or the draws is an error', async () => {
    const failLots = recordingClient(() => ({ data: null, error: new Error('permission denied for column') }));
    expect((await new BusinessOsCreditOwnerReadRepository(failLots.client).listOwnCreditLots(A)).error?.message).toBe(
      'permission denied for column'
    );
    const failDraws = recordingClient((calls) =>
      calls[0].args[0] === 'business_os_credit_lots'
        ? { data: [lotRow(1)], error: null }
        : { data: null, error: new Error('JWT expired') }
    );
    const result = await new BusinessOsCreditOwnerReadRepository(failDraws.client).listOwnCreditLots(A);
    expect(result).toEqual({ data: null, error: expect.any(Error) });
  });

  it.each([
    ['an unreadable granted figure', [lotRow(1, { credits_granted: 'abc' })], []],
    ['a null granted figure', [lotRow(1, { credits_granted: null })], []],
    ['an unreadable created_at', [lotRow(1, { created_at: 'yesterday' })], []],
    ['an unreadable expires_at', [lotRow(1, { expires_at: 'soon' })], []],
    ['a non-UUID lot id', [lotRow(1, { id: 'lot-1' })], []],
    ['an unreadable draw figure', [lotRow(1)], [drawRow(1, { credits: 'Infinity' })]],
    ['an unreadable draw date', [lotRow(1)], [drawRow(1, { created_at: 42 })]],
    ['a consumption draw: the slice 9 tripwire (W11d-7)', [lotRow(1)], [drawRow(1, { kind: 'consumption' })]],
    ['a lots answer that is not a list', { id: 'x' }, []],
  ])('%s is an error, never 0', async (_name, lots, draws) => {
    const { client } = byTable(lots, draws);
    const result = await new BusinessOsCreditOwnerReadRepository(client).listOwnCreditLots(A);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });

  it.each([['not-a-uuid'], [''], [undefined as unknown as string]])('refuses the account %p before any query', async (account) => {
    const { client, queries } = byTable([lotRow(1)]);
    const result = await new BusinessOsCreditOwnerReadRepository(client).listOwnCreditLots(account);
    expect(result.error).toBeInstanceOf(Error);
    expect(queries).toHaveLength(0);
  });

  it('its row type is a balance-core lot (type-level: the scoped tsc fails otherwise)', () => {
    const asBalanceLot = (row: OwnerCreditLotRow): CreditLotForBalance => row;
    expect(typeof asBalanceLot).toBe('function');
  });

  it('only the repository and the card payload builder name listOwnCreditLots among product files (G11d-4)', () => {
    const ROOT = process.cwd();
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name.startsWith('.')) continue;
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
          if (fs.readFileSync(path.join(ROOT, rel), 'utf8').includes('listOwnCreditLots')) found.push(rel);
        }
      }
    };
    ['app', 'lib', 'components', 'hooks'].forEach(walk);
    // Non-vacuity: the builder really is found, so an empty scan cannot pass.
    expect(found.sort()).toEqual(
      ['lib/business-os/credits/ownerCreditUsage.ts', 'lib/repositories/BusinessOsCreditOwnerReadRepository.ts'].sort()
    );
  });
});
