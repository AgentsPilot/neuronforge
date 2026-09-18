/**
 * TokenUsageRepository — Layer 1.1 FR-24 / AC-24.
 *
 * Every method must (a) always apply its account filter, (b) refuse a missing
 * or empty account before any query, (c) select only allow-listed columns, and
 * (d) never throw. The client is an in-memory PostgREST stand-in, so filters,
 * ordering and paging are really applied to fixture rows.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  TOKEN_USAGE_CHAT_READ_LIMITS,
  TOKEN_USAGE_COLUMNS,
  TokenUsageRepository,
  type TokenUsageFeatureFilter,
  type TokenUsageWindow,
} from '../TokenUsageRepository';
import { createFakeSupabase, type FakeDbOptions, type RecordedQuery, type Row } from '@/tests/helpers/fakePostgrest';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ZERO = '00000000-0000-0000-0000-000000000000';
const FORBIDDEN = ['request_payload', 'response_metadata', 'metadata', 'error_message', '*'];

const WINDOW: TokenUsageWindow = {
  start: new Date('2026-09-17T10:00:00.000Z'),
  end: new Date('2026-09-17T12:00:00.000Z'),
};
const FILTER: TokenUsageFeatureFilter = { featurePrefix: 'business-os', features: ['lead-reply', 'insight-generation'] };

function row(overrides: Row): Row {
  return {
    id: `id-${Math.random().toString(16).slice(2)}`,
    user_id: A,
    created_at: '2026-09-17T11:00:00.000Z',
    feature: 'business-os-chat',
    component: 'planner',
    session_id: '33333333-3333-4333-8333-333333333333',
    input_tokens: 10,
    output_tokens: 5,
    total_tokens: 15,
    cost_usd: '0.0001',
    success: true,
    error_code: null,
    error_message: 'SECRET MESSAGE',
    request_payload: { prompt: 'SECRET PROMPT' },
    response_metadata: {},
    metadata: {},
    ...overrides,
  };
}

function setup(options: FakeDbOptions) {
  const fake = createFakeSupabase(options);
  const repo = new TokenUsageRepository(fake.client as unknown as SupabaseClient);
  return { fake, repo };
}

function accountFilterOf(q: RecordedQuery) {
  return q.filters.filter((f) => f.column === 'user_id');
}

function expectAllowListed(queries: RecordedQuery[]) {
  for (const q of queries) {
    for (const bad of FORBIDDEN) {
      expect((q.select ?? '').split(',').map((c) => c.trim())).not.toContain(bad);
    }
  }
}

describe('TOKEN_USAGE_COLUMNS', () => {
  it('never lists a payload, metadata or error-message column', () => {
    for (const columns of Object.values(TOKEN_USAGE_COLUMNS)) {
      const list = columns.split(',').map((c) => c.trim());
      for (const bad of FORBIDDEN) expect(list).not.toContain(bad);
    }
  });
});

describe('usageSummaryByFeatureAndDay', () => {
  it('calls the RPC with the account and start', async () => {
    const { fake, repo } = setup({ rpc: () => ({ data: [{ bucket: 'feature', key: 'x', tokens: '5', calls: '1' }], error: null }) });
    const result = await repo.usageSummaryByFeatureAndDay(A, WINDOW.start);
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1);
    expect(fake.rpcCalls).toEqual([
      { name: 'business_os_usage_summary', args: { p_user_id: A, p_since: WINDOW.start.toISOString() } },
    ]);
  });

  it('refuses a missing or non-UUID account before any call', async () => {
    const { fake, repo } = setup({});
    for (const bad of ['', 'not-a-uuid', undefined as unknown as string]) {
      const result = await repo.usageSummaryByFeatureAndDay(bad, WINDOW.start);
      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(Error);
    }
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it('returns the RPC error without throwing', async () => {
    const { repo } = setup({ rpc: () => ({ data: null, error: { message: 'missing', code: 'PGRST202' } }) });
    const result = await repo.usageSummaryByFeatureAndDay(A, WINDOW.start);
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });
});

describe('listSummaryRowsPage', () => {
  it('applies the account filter, start, order and range with the summary columns', async () => {
    const { fake, repo } = setup({
      tables: {
        token_usage: [
          row({ created_at: '2026-09-17T11:00:00.000Z' }),
          row({ user_id: B }),
          row({ created_at: '2026-09-17T09:00:00.000Z' }),
        ],
      },
    });
    const result = await repo.listSummaryRowsPage(A, WINDOW.start, 0, 999);
    expect(result.data).toEqual([{ feature: 'business-os-chat', total_tokens: 15, created_at: '2026-09-17T11:00:00.000Z' }]);
    const q = fake.queries[0];
    expect(accountFilterOf(q)).toEqual([{ op: 'eq', column: 'user_id', value: A }]);
    expect(q.select).toBe(TOKEN_USAGE_COLUMNS.summary);
    expect(q.order).toEqual([{ column: 'created_at', ascending: false }]);
    expect(q.range).toEqual([0, 999]);
    expectAllowListed(fake.queries);
  });

  it('refuses a missing account and an oversized page', async () => {
    const { fake, repo } = setup({ tables: { token_usage: [] } });
    expect((await repo.listSummaryRowsPage('', WINDOW.start, 0, 999)).error).toBeTruthy();
    expect((await repo.listSummaryRowsPage(A, WINDOW.start, 0, 1000)).error).toBeTruthy();
    expect(fake.queries).toHaveLength(0);
  });
});

describe('listCallsInWindow', () => {
  function manyRows(n: number, overrides: Row = {}): Row[] {
    return Array.from({ length: n }, (_, i) =>
      row({
        id: `row-${String(i).padStart(5, '0')}`,
        created_at: new Date(WINDOW.end.getTime() - (i + 1) * 1000).toISOString(),
        ...overrides,
      })
    );
  }

  it('reads only the account, window and Business OS filter, newest first, allow-listed columns', async () => {
    const { fake, repo } = setup({
      tables: {
        token_usage: [
          row({ id: 'keep-chat', created_at: '2026-09-17T11:00:00.000Z' }),
          row({ id: 'keep-legacy', feature: 'lead-reply', created_at: '2026-09-17T11:30:00.000Z' }),
          row({ id: 'keep-typo', feature: 'business-os-webiste', created_at: '2026-09-17T10:30:00.000Z' }),
          row({ id: 'other-account', user_id: B }),
          row({ id: 'not-bos', feature: 'onboarding' }),
          row({ id: 'before', created_at: '2026-09-17T09:59:59.999Z' }),
          row({ id: 'after', created_at: '2026-09-17T12:00:00.001Z' }),
        ],
      },
    });

    const result = await repo.listCallsInWindow(A, WINDOW, FILTER, { pageSize: 1000, ceiling: 5000 });

    expect(result.error).toBeNull();
    expect(result.data?.rows.map((r) => r.id)).toEqual(['keep-legacy', 'keep-chat', 'keep-typo']);
    expect(result.data?.reachedCeiling).toBe(false);
    const q = fake.queries[0];
    expect(accountFilterOf(q)).toEqual([{ op: 'eq', column: 'user_id', value: A }]);
    expect(q.filters).toEqual(
      expect.arrayContaining([
        { op: 'gte', column: 'created_at', value: WINDOW.start.toISOString() },
        { op: 'lte', column: 'created_at', value: WINDOW.end.toISOString() },
        { op: 'or', column: '', value: 'feature.like.business-os*,feature.in.("lead-reply","insight-generation")' },
      ])
    );
    expect(q.order).toEqual([
      { column: 'created_at', ascending: false },
      { column: 'id', ascending: false },
    ]);
    expect(q.select).toBe(TOKEN_USAGE_COLUMNS.call);
    expect(JSON.stringify(result.data)).not.toMatch(/SECRET/);
    expectAllowListed(fake.queries);
  });

  it('pages 1,000 at a time and stops on a short page', async () => {
    const { fake, repo } = setup({ tables: { token_usage: manyRows(2500) } });
    const result = await repo.listCallsInWindow(A, WINDOW, FILTER, { pageSize: 1000, ceiling: 5000 });
    expect(result.data?.rows).toHaveLength(2500);
    expect(result.data?.reachedCeiling).toBe(false);
    expect(fake.queries.map((q) => q.range)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('stops at the ceiling and says so', async () => {
    const { fake, repo } = setup({ tables: { token_usage: manyRows(6200) } });
    const result = await repo.listCallsInWindow(A, WINDOW, FILTER, { pageSize: 1000, ceiling: 5000 });
    expect(result.data?.rows).toHaveLength(5000);
    expect(result.data?.reachedCeiling).toBe(true);
    expect(fake.queries).toHaveLength(5);
  });

  it('treats exactly the ceiling as reached (never a false complete)', async () => {
    const { repo } = setup({ tables: { token_usage: manyRows(3000) } });
    const result = await repo.listCallsInWindow(A, WINDOW, FILTER, { pageSize: 1000, ceiling: 3000 });
    expect(result.data?.rows).toHaveLength(3000);
    expect(result.data?.reachedCeiling).toBe(true);
  });

  it('keeps one copy of a row that appears on two pages', async () => {
    const rows = manyRows(1500);
    const fake = createFakeSupabase({ tables: { token_usage: rows } });
    // Simulate a newer insert between page reads: the second page re-serves the last row of page one.
    const client = {
      from: (table: string) => {
        const b = fake.client.from(table);
        const originalRange = b.range.bind(b);
        b.range = (from: number, to: number) => originalRange(from === 1000 ? 999 : from, to);
        return b;
      },
      rpc: fake.client.rpc,
    };
    const repo = new TokenUsageRepository(client as unknown as SupabaseClient);
    const result = await repo.listCallsInWindow(A, WINDOW, FILTER, { pageSize: 1000, ceiling: 5000 });
    const ids = result.data?.rows.map((r) => r.id) ?? [];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(1500);
  });

  it('refuses a bad account, window, filter or limits before any query', async () => {
    const { fake, repo } = setup({ tables: { token_usage: manyRows(3) } });
    const opts = { pageSize: 1000, ceiling: 5000 };
    const cases = [
      repo.listCallsInWindow('', WINDOW, FILTER, opts),
      repo.listCallsInWindow('x', WINDOW, FILTER, opts),
      repo.listCallsInWindow(A, { start: WINDOW.end, end: WINDOW.start }, FILTER, opts),
      repo.listCallsInWindow(A, WINDOW, { featurePrefix: 'business-os),user_id.neq.(x', features: [] }, opts),
      repo.listCallsInWindow(A, WINDOW, { featurePrefix: 'business-os', features: ['a","b'] }, opts),
      repo.listCallsInWindow(A, WINDOW, FILTER, { pageSize: 1001, ceiling: 5000 }),
      repo.listCallsInWindow(A, WINDOW, FILTER, { pageSize: 1000, ceiling: 5001 }),
    ];
    for (const result of await Promise.all(cases)) {
      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(Error);
    }
    expect(fake.queries).toHaveLength(0);
  });

  it('returns a page error without throwing', async () => {
    const { repo } = setup({
      tables: { token_usage: manyRows(1500) },
      errorWhen: (q) => (q.range?.[0] === 1000 ? { message: 'timeout', code: '57014' } : null),
    });
    const result = await repo.listCallsInWindow(A, WINDOW, FILTER, { pageSize: 1000, ceiling: 5000 });
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });
});

describe('countInWindow', () => {
  const rows = [
    row({ user_id: ZERO, feature: 'business-os-website' }),
    row({ user_id: ZERO, feature: 'lead-reply' }),
    row({ user_id: ZERO, feature: 'onboarding', component: 'simple-complete' }),
    row({ user_id: B, feature: 'business-os-chat' }),
    row({ user_id: A, feature: 'onboarding', component: 'simple-complete' }),
    row({ user_id: A, feature: 'business-os-chat', created_at: '2026-09-17T08:00:00.000Z' }),
  ];

  it('counts exactly with a head request, scoped to the id list', async () => {
    const { fake, repo } = setup({ tables: { token_usage: rows } });
    const result = await repo.countInWindow([ZERO, B], WINDOW, { kind: 'row_filter', filter: FILTER });
    expect(result).toEqual({ data: 3, error: null });
    const q = fake.queries[0];
    expect(q.selectOptions).toEqual({ count: 'exact', head: true });
    expect(accountFilterOf(q)).toEqual([{ op: 'in', column: 'user_id', value: [ZERO, B] }]);
    expectAllowListed(fake.queries);
  });

  it('matches a feature list and an exact label', async () => {
    const { repo } = setup({ tables: { token_usage: rows } });
    expect((await repo.countInWindow([ZERO], WINDOW, { kind: 'features', features: ['lead-reply'] })).data).toBe(1);
    expect(
      (await repo.countInWindow([A], WINDOW, { kind: 'label', feature: 'onboarding', component: 'simple-complete' })).data
    ).toBe(1);
  });

  it('refuses an empty id list, a bad id and a bad match before any query', async () => {
    const { fake, repo } = setup({ tables: { token_usage: rows } });
    const results = await Promise.all([
      repo.countInWindow([], WINDOW, { kind: 'row_filter', filter: FILTER }),
      repo.countInWindow([A, 'nope'], WINDOW, { kind: 'row_filter', filter: FILTER }),
      repo.countInWindow([A], WINDOW, { kind: 'features', features: [] }),
      repo.countInWindow([A], WINDOW, { kind: 'label', feature: 'onboarding', component: 'a,b' }),
    ]);
    for (const r of results) expect(r.error).toBeInstanceOf(Error);
    expect(fake.queries).toHaveLength(0);
  });

  it('returns an error without throwing', async () => {
    const { repo } = setup({ tables: { token_usage: rows }, throwWhen: () => true });
    const result = await repo.countInWindow([A], WINDOW, { kind: 'row_filter', filter: FILTER });
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });
});

describe('listLabelsInWindow', () => {
  it('returns capped newest-first labels for the id list only', async () => {
    const rows = Array.from({ length: 80 }, (_, i) =>
      row({
        user_id: i % 2 ? ZERO : B,
        feature: 'onboarding',
        component: 'simple-complete',
        created_at: new Date(WINDOW.end.getTime() - (i + 1) * 1000).toISOString(),
      })
    );
    const { fake, repo } = setup({ tables: { token_usage: rows } });
    const result = await repo.listLabelsInWindow(
      [ZERO],
      WINDOW,
      { kind: 'label', feature: 'onboarding', component: 'simple-complete' },
      30
    );
    expect(result.data).toHaveLength(30);
    expect(Object.keys(result.data?.[0] ?? {})).toEqual(['created_at', 'feature', 'component']);
    const times = (result.data ?? []).map((r) => r.created_at);
    expect([...times].sort().reverse()).toEqual(times);
    expect(accountFilterOf(fake.queries[0])).toEqual([{ op: 'in', column: 'user_id', value: [ZERO] }]);
    expect(fake.queries[0].limit).toBe(30);
    expectAllowListed(fake.queries);
  });

  it('refuses an empty id list and an out-of-range limit', async () => {
    const { fake, repo } = setup({ tables: { token_usage: [] } });
    const match = { kind: 'row_filter', filter: FILTER } as const;
    expect((await repo.listLabelsInWindow([], WINDOW, match, 10)).error).toBeTruthy();
    expect((await repo.listLabelsInWindow([A], WINDOW, match, 501)).error).toBeTruthy();
    expect((await repo.listLabelsInWindow([A], WINDOW, match, 0)).error).toBeTruthy();
    expect(fake.queries).toHaveLength(0);
  });
});

// ─── Layer 1.5 F-1: the chat telemetry reads (FR-24, AC-18) ──────────────────

describe('chat telemetry reads', () => {
  const CHAT = 'business-os-chat';
  const OPTS = { pageSize: TOKEN_USAGE_CHAT_READ_LIMITS.PAGE_SIZE, ceiling: TOKEN_USAGE_CHAT_READ_LIMITS.USAGE_CEILING };

  function chatRows(n: number, overrides: Row = {}, idPrefix = String(overrides.user_id ?? A).slice(0, 4)): Row[] {
    return Array.from({ length: n }, (_, i) =>
      row({
        id: `chat-${idPrefix}-${String(i).padStart(5, '0')}`,
        created_at: new Date(WINDOW.end.getTime() - (i + 1) * 1000).toISOString(),
        activity_type: 'plan',
        activity_name: 'planner',
        model_name: 'gpt-4o',
        latency_ms: 120,
        ...overrides,
      })
    );
  }

  it('keeps the report caps as they were, above the verification ceiling (RC-12d)', () => {
    expect(TOKEN_USAGE_CHAT_READ_LIMITS.USAGE_CEILING).toBe(10_000);
    expect(TOKEN_USAGE_CHAT_READ_LIMITS.PRICING_CEILING).toBe(50_000);
  });

  it('the per-account read filters on the account and the chat feature, newest first', async () => {
    const { fake, repo } = setup({
      tables: { token_usage: [...chatRows(3), ...chatRows(2, { user_id: B }), ...chatRows(1, { feature: 'business-os-leads' })] },
    });
    const result = await repo.listChatCallsForAccountInWindow(A, WINDOW, CHAT, OPTS);

    expect(result.error).toBeNull();
    expect(result.data?.rows).toHaveLength(3);
    expect(result.data?.reachedCeiling).toBe(false);
    const q = fake.queries[0];
    expect(accountFilterOf(q)).toEqual([{ op: 'eq', column: 'user_id', value: A }]);
    expect(q.filters).toEqual(expect.arrayContaining([{ op: 'eq', column: 'feature', value: CHAT }]));
    expect(q.select).toBe(TOKEN_USAGE_COLUMNS.chat);
    expect(JSON.stringify(result.data)).not.toMatch(/SECRET/);
    expectAllowListed(fake.queries);
  });

  it('the all-accounts read applies no account filter, and only the chat feature', async () => {
    const { fake, repo } = setup({ tables: { token_usage: [...chatRows(3), ...chatRows(2, { user_id: B })] } });
    const result = await repo.listChatCallsAllAccountsInWindow(WINDOW, CHAT, OPTS);

    expect(result.data?.rows).toHaveLength(5);
    expect(accountFilterOf(fake.queries[0])).toEqual([]);
    expect(result.data?.rows.map((r) => r.user_id).sort()).toEqual([A, A, A, B, B]);
  });

  it('reports reachedCeiling at the cap, exactly as listCallsInWindow does', async () => {
    const { repo } = setup({ tables: { token_usage: chatRows(2500) } });
    const capped = await repo.listChatCallsAllAccountsInWindow(WINDOW, CHAT, { pageSize: 1000, ceiling: 2000 });
    expect(capped.data?.rows).toHaveLength(2000);
    expect(capped.data?.reachedCeiling).toBe(true);

    const exact = await repo.listChatCallsAllAccountsInWindow(WINDOW, CHAT, { pageSize: 1000, ceiling: 2500 });
    expect(exact.data?.reachedCeiling).toBe(true);

    const under = await repo.listChatCallsAllAccountsInWindow(WINDOW, CHAT, { pageSize: 1000, ceiling: 3000 });
    expect(under.data?.reachedCeiling).toBe(false);
  });

  it('refuses a bad account, feature, window or limits before any query, without throwing', async () => {
    const { fake, repo } = setup({ tables: { token_usage: chatRows(3) } });
    const bad = await Promise.all([
      repo.listChatCallsForAccountInWindow('not-a-uuid', WINDOW, CHAT, OPTS),
      repo.listChatCallsAllAccountsInWindow(WINDOW, 'Bad Feature!', OPTS),
      repo.listChatCallsAllAccountsInWindow({ start: WINDOW.end, end: WINDOW.start }, CHAT, OPTS),
      repo.listChatCallsAllAccountsInWindow(WINDOW, CHAT, { pageSize: 5000, ceiling: 10 }),
      repo.listChatCallsAllAccountsInWindow(WINDOW, CHAT, { pageSize: 1000, ceiling: 50_001 }),
    ]);
    for (const result of bad) {
      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(Error);
    }
    expect(fake.queries).toHaveLength(0);
  });

  it('returns a read error without throwing', async () => {
    const { repo } = setup({ tables: { token_usage: chatRows(1) }, errorWhen: () => ({ message: 'boom' }) });
    const result = await repo.listChatCallsAllAccountsInWindow(WINDOW, CHAT, OPTS);
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });
});
