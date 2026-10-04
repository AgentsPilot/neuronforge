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
  OWNER_TOTALS_COLUMNS,
} from '../BusinessOsCreditOwnerReadRepository';

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
 * Credit deduction slice 11c (SA W11c-17): the CI-side pin on the one
 * service-role path. This suite runs in `test:bos-entitlements`. Exactly two
 * product files construct this repository, and only the admin wiring names
 * the service client.
 */
describe('who constructs this repository (slice 11c, SA W11c-17)', () => {
  const ROOT = process.cwd();
  const OWNER_WIRING = 'lib/business-os/credits/ownerCreditUsageDeps.ts';
  const ADMIN_WIRING = 'lib/business-os/credits/adminCreditPositionDeps.ts';
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

  it('exactly two product files construct it: the owner wiring and the admin wiring', () => {
    expect(sources.filter(({ code }) => CONSTRUCTS.test(code)).map(({ file }) => file).sort()).toEqual(
      [ADMIN_WIRING, OWNER_WIRING].sort()
    );
  });

  it('only the admin wiring names the service client', () => {
    const constructors = sources.filter(({ code }) => CONSTRUCTS.test(code));
    expect(constructors.filter(({ code }) => SERVICE_CLIENT.test(code)).map(({ file }) => file)).toEqual([ADMIN_WIRING]);
  });
});
