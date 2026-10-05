/**
 * BusinessOsCreditOwnerReadRepository.listLedgerRowsForWindow — the credit
 * history's paged read (credit deduction slice 7a, workplan §4.3; SA SQ-29,
 * SQ-31, W7-9).
 *
 * Pinned with a fake PostgREST that EVALUATES the query (it does not just
 * record it): `period_start` is matched by exact string, and `created_at` is
 * compared at the microsecond, as Postgres does. So a key or a keyset value
 * rebuilt from a millisecond `Date` matches nothing or repeats rows here, as
 * it would in production.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

import {
  BusinessOsCreditOwnerReadRepository,
  OWNER_CREDIT_READ_LIMITS,
  OWNER_DIARY_COLUMNS,
  type OwnerDiaryRow,
  type OwnerLedgerWindow,
} from '../BusinessOsCreditOwnerReadRepository';

const A = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const PERIOD = '2026-09-14T09:31:07.123456+00:00';
const EARLIER_PERIOD = '2026-08-14T09:31:07.123456+00:00';

/** Microseconds since the epoch, from a PostgREST timestamptz string. */
function micros(ts: string): bigint {
  const m = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(ts);
  if (!m) throw new Error(`fake: not a timestamp: ${ts}`);
  const seconds = Date.parse(`${m[1]}${m[3]}`);
  return BigInt(seconds) * BigInt(1000) + BigInt((m[2] ?? '').padEnd(6, '0'));
}

type Filter = (row: OwnerDiaryRow) => boolean;

/** Parses exactly the or-expression the repository writes; anything else throws. */
function parseKeysetOr(expr: string): Filter {
  const m = /^created_at\.lt\."([^"]+)",and\(created_at\.eq\."([^"]+)",id\.lt\.([0-9a-f-]+)\)$/.exec(expr);
  if (!m || m[1] !== m[2]) throw new Error(`fake: unexpected or-expression ${expr}`);
  const t = micros(m[1]);
  const id = m[3];
  return (row) => micros(row.created_at) < t || (micros(row.created_at) === t && row.id < id);
}

function fakeLedger(rows: OwnerDiaryRow[]) {
  const seen: { method: string; args: unknown[] }[][] = [];
  const client = {
    from: (table: string) => {
      if (table !== 'business_os_credit_charges') throw new Error(`fake: table ${table}`);
      const calls: { method: string; args: unknown[] }[] = [];
      seen.push(calls);
      const filters: Filter[] = [];
      let range: [number, number] = [0, 1000];
      const builder: Record<string, unknown> = {};
      const record = (method: string, args: unknown[]) => calls.push({ method, args });
      builder.select = (...args: unknown[]) => (record('select', args), builder);
      builder.eq = (col: string, value: string) => {
        record('eq', [col, value]);
        filters.push((row) => (row as unknown as Record<string, unknown>)[col] === value);
        return builder;
      };
      builder.gte = (col: string, value: string) => {
        record('gte', [col, value]);
        filters.push((row) => micros((row as unknown as Record<string, string>)[col]) >= micros(value));
        return builder;
      };
      builder.or = (expr: string) => {
        record('or', [expr]);
        filters.push(parseKeysetOr(expr));
        return builder;
      };
      builder.order = (...args: unknown[]) => (record('order', args), builder);
      builder.range = (from: number, to: number) => {
        record('range', [from, to]);
        range = [from, to];
        return builder;
      };
      builder.then = (resolve: (v: unknown) => void) => {
        const out = rows
          .filter((row) => filters.every((f) => f(row)))
          .sort((a, b) => {
            const d = micros(b.created_at) - micros(a.created_at);
            if (d !== BigInt(0)) return d > BigInt(0) ? 1 : -1;
            return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
          })
          .slice(range[0], range[1] + 1);
        resolve({ data: out, error: null });
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, seen };
}

let counter = 0;
function row(createdAt: string, overrides: Partial<OwnerDiaryRow> = {}): OwnerDiaryRow {
  counter += 1;
  const hex = counter.toString(16).padStart(12, '0');
  return {
    id: `00000000-0000-4000-8000-${hex}`,
    kind: 'charge',
    action_id: `aaaaaaaa-0000-4000-8000-${hex}`,
    adjusts_action_id: null,
    period_start: PERIOD,
    credits: '1.000000',
    service: 'ai',
    action_type: 'chat_turn',
    triggered_by: 'owner',
    outcome: 'succeeded',
    created_at: createdAt,
    user_id: A,
    ...overrides,
  };
}

const PERIOD_WINDOW: OwnerLedgerWindow = { kind: 'period', periodStart: PERIOD };

/** Walk every page with `limit`; return the ids in order. */
async function walk(repo: BusinessOsCreditOwnerReadRepository, window: OwnerLedgerWindow, limit: number) {
  const ids: string[] = [];
  let after: { createdAt: string; id: string } | null = null;
  for (let page = 0; page < 1000; page += 1) {
    const result = await repo.listLedgerRowsForWindow(A, window, after, limit);
    if (result.error || !result.data) throw result.error;
    ids.push(...result.data.rows.map((r) => r.id));
    if (!result.data.hasMore) return ids;
    const last = result.data.rows[result.data.rows.length - 1];
    after = { createdAt: last.created_at, id: last.id };
  }
  throw new Error('walk did not end');
}

describe('listLedgerRowsForWindow — the query', () => {
  it('selects the diary columns, scoped to the account and the exact period key, newest first, limit + 1', async () => {
    const { client, seen } = fakeLedger([]);
    await new BusinessOsCreditOwnerReadRepository(client).listLedgerRowsForWindow(A, PERIOD_WINDOW, null, 50);
    const calls = seen[0];
    expect(calls.find((c) => c.method === 'select')?.args).toEqual([OWNER_DIARY_COLUMNS]);
    expect(calls.filter((c) => c.method === 'eq').map((c) => c.args)).toEqual([
      ['user_id', A],
      ['period_start', PERIOD],
    ]);
    expect(calls.filter((c) => c.method === 'order').map((c) => c.args)).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
    expect(calls.find((c) => c.method === 'range')?.args).toEqual([0, 50]);
    expect(calls.some((c) => c.method === 'or')).toBe(false);
  });

  it('a trial window reads every period from the anchor string on', async () => {
    const { client, seen } = fakeLedger([]);
    await new BusinessOsCreditOwnerReadRepository(client).listLedgerRowsForWindow(
      A,
      { kind: 'from', fromPeriodStart: EARLIER_PERIOD },
      null,
      50
    );
    expect(seen[0].filter((c) => c.method === 'gte').map((c) => c.args)).toEqual([['period_start', EARLIER_PERIOD]]);
  });

  it('writes the keyset as one double-quoted or-expression of the exact strings', async () => {
    const { client, seen } = fakeLedger([]);
    const t = '2026-09-30T07:00:00.123456+00:00';
    const id = '00000000-0000-4000-8000-0000000000ff';
    await new BusinessOsCreditOwnerReadRepository(client).listLedgerRowsForWindow(A, PERIOD_WINDOW, { createdAt: t, id }, 50);
    expect(seen[0].find((c) => c.method === 'or')?.args).toEqual([
      `created_at.lt."${t}",and(created_at.eq."${t}",id.lt.${id})`,
    ]);
  });
});

describe('listLedgerRowsForWindow — paging against an evaluating fake', () => {
  it('returns charges AND adjustments of the window only, and says whether there is more', async () => {
    const rows = [
      row('2026-09-30T07:00:00.000001+00:00'),
      row('2026-09-30T08:00:00.000001+00:00', {
        kind: 'adjustment', action_id: null, adjusts_action_id: 'aaaaaaaa-0000-4000-8000-000000000001',
        service: null, action_type: null, triggered_by: null, outcome: null, credits: '-0.5',
      }),
      row('2026-09-30T09:00:00.000001+00:00', { period_start: EARLIER_PERIOD }),
      row('2026-09-30T10:00:00.000001+00:00', { user_id: OTHER }),
    ];
    const { client } = fakeLedger(rows);
    const result = await new BusinessOsCreditOwnerReadRepository(client).listLedgerRowsForWindow(A, PERIOD_WINDOW, null, 1);
    expect(result.error).toBeNull();
    expect(result.data!.rows.map((r) => r.kind)).toEqual(['adjustment']);
    expect(result.data!.hasMore).toBe(true);
  });

  it('walks 120 rows in pages of 50 with no repeat and no skip, newest first', async () => {
    const rows = Array.from({ length: 120 }, (_, i) =>
      row(`2026-09-${String(15 + Math.floor(i / 10)).padStart(2, '0')}T0${i % 10}:00:00.${String(100000 + i)}+00:00`)
    );
    const { client } = fakeLedger(rows);
    const repo = new BusinessOsCreditOwnerReadRepository(client);
    const ids = await walk(repo, PERIOD_WINDOW, 50);
    const expected = [...rows].sort((a, b) => (micros(b.created_at) > micros(a.created_at) ? 1 : -1)).map((r) => r.id);
    expect(ids).toEqual(expected);
  });

  it('rows in the same MILLISECOND but different microseconds, across a page boundary, are neither skipped nor repeated', async () => {
    const rows = [
      row('2026-09-30T07:00:00.123456+00:00'),
      row('2026-09-30T07:00:00.123455+00:00'),
      row('2026-09-30T07:00:00.123454+00:00'),
      row('2026-09-30T07:00:00.123999+00:00'),
    ];
    const { client } = fakeLedger(rows);
    const ids = await walk(new BusinessOsCreditOwnerReadRepository(client), PERIOD_WINDOW, 1);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });

  it('a keyset truncated to the millisecond (a Date round trip) would repeat rows — the reason the string travels verbatim', async () => {
    const rows = [row('2026-09-30T07:00:00.123456+00:00'), row('2026-09-30T07:00:00.123455+00:00')];
    const { client } = fakeLedger(rows);
    const repo = new BusinessOsCreditOwnerReadRepository(client);
    const first = await repo.listLedgerRowsForWindow(A, PERIOD_WINDOW, null, 1);
    const last = first.data!.rows[0];
    const truncated = new Date(last.created_at).toISOString();
    const second = await repo.listLedgerRowsForWindow(A, PERIOD_WINDOW, { createdAt: truncated, id: last.id }, 1);
    // .123Z is BEFORE both rows: the page after it is empty — the second row is skipped.
    expect(second.data!.rows).toEqual([]);
    const correct = await repo.listLedgerRowsForWindow(A, PERIOD_WINDOW, { createdAt: last.created_at, id: last.id }, 1);
    expect(correct.data!.rows.map((r) => r.id)).toEqual([rows[1].id]);
  });

  it('two rows in the SAME microsecond are ordered and paged by id (W7-9)', async () => {
    const same = '2026-09-30T07:00:00.123456+00:00';
    const low = row(same, { id: '00000000-0000-4000-8000-00000000000a' });
    const high = row(same, { id: '00000000-0000-4000-8000-00000000000b' });
    const { client } = fakeLedger([low, high]);
    const ids = await walk(new BusinessOsCreditOwnerReadRepository(client), PERIOD_WINDOW, 1);
    expect(ids).toEqual([high.id, low.id]);
  });

  it('a period key truncated to the millisecond matches nothing (exact-string period match)', async () => {
    const { client } = fakeLedger([row('2026-09-30T07:00:00.000001+00:00')]);
    const result = await new BusinessOsCreditOwnerReadRepository(client).listLedgerRowsForWindow(
      A,
      { kind: 'period', periodStart: new Date(PERIOD).toISOString() },
      null,
      50
    );
    expect(result.data!.rows).toEqual([]);
  });
});

describe('listLedgerRowsForWindow — refusals (no query is made)', () => {
  const refuses = async (
    args: Partial<{ account: string; window: OwnerLedgerWindow; after: { createdAt: string; id: string } | null; limit: number }>
  ) => {
    const { client, seen } = fakeLedger([]);
    const result = await new BusinessOsCreditOwnerReadRepository(client).listLedgerRowsForWindow(
      args.account ?? A,
      args.window ?? PERIOD_WINDOW,
      args.after === undefined ? null : args.after,
      args.limit ?? 50
    );
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(seen).toHaveLength(0);
  };

  it('a non-UUID account', () => refuses({ account: 'not-a-uuid' }));
  it('a page size of 0', () => refuses({ limit: 0 }));
  it('a page size above the ceiling', () => refuses({ limit: OWNER_CREDIT_READ_LIMITS.DIARY_PAGE_CEILING + 1 }));
  it('a fractional page size', () => refuses({ limit: 2.5 }));
  it('a window with no key', () => refuses({ window: { kind: 'period', periodStart: '' } }));

  it.each([
    '2026-09-30T07:00:00.123456+00:00",id.gt.0',
    '2026-09-30T07:00:00Z,or=(id.gt.0)',
    '2026-09-30T07:00:00Z)',
    '2026-09-30(T07:00:00Z',
    'now()',
    '',
  ])('a hostile keyset timestamp %p', (createdAt) =>
    refuses({ after: { createdAt, id: '00000000-0000-4000-8000-000000000001' } })
  );

  it.each(['1),or=(id.gt.0', 'abc', '00000000-0000-4000-8000-000000000001"'])('a hostile keyset id %p', (id) =>
    refuses({ after: { createdAt: '2026-09-30T07:00:00.123456+00:00', id } })
  );
});

describe('listLedgerRowsForWindow — errors', () => {
  it('returns a read error, never "no lines"', async () => {
    const client = {
      from: () => {
        const builder: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'gte', 'or', 'order', 'range']) builder[m] = () => builder;
        builder.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: new Error('permission denied') });
        return builder;
      },
    } as unknown as SupabaseClient;
    const result = await new BusinessOsCreditOwnerReadRepository(client).listLedgerRowsForWindow(A, PERIOD_WINDOW, null, 50);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('permission denied');
  });
});
