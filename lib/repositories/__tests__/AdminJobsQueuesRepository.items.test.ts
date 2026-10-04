/**
 * AdminJobsQueuesRepository.listQueueItemsAllAccounts (ADMIN_BOS_CLEANUP slice
 * 7a; SA C7-12, C7-13; workplan §2.3, §5.3 and conditions W7A-2, W7A-3, W7A-6).
 *
 * Kept in its own file so the figures suite (AdminJobsQueuesRepository.test.ts)
 * changes by exactly one pin (W7A-6): the figures read selects only
 * ADMIN_QUEUE_FIGURE_COLUMNS.
 *
 * Pinned here: the context is required; one request per call, on the queue's
 * own table, with the exact column list and `count: 'exact'`; the state filters
 * are the figures' own (built by the same helpers, so list and count cannot
 * drift); explicit NULL ordering; the 50-row page and the 20-page cap; a page
 * past the end (PostgREST 416 PGRST103) is an empty page, not an error; rows
 * are mapped field by field; nothing is written; no row value is logged.
 */

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
  ADMIN_QUEUE_FIGURE_COLUMNS,
  ADMIN_QUEUE_ITEM_COLUMNS,
  ADMIN_QUEUE_ITEM_STATES,
  ADMIN_QUEUE_ITEMS_MAX_PAGE,
  ADMIN_QUEUE_ITEMS_PAGE_SIZE,
  ADMIN_QUEUE_SELECTABLE_COLUMNS,
  ADMIN_QUEUE_SPECS,
  AdminJobsQueuesRepository,
  DEAD_LETTER_MARKER,
  GUARDRAIL_SKIP_MARKERS,
  quoteFilterValue,
  type AdminQueueId,
  type AdminQueueItemState,
} from '../AdminJobsQueuesRepository';

type Call = { method: string; args: unknown[] };
type Result = { data: unknown; error: unknown; count?: number | null };

const CTX = { correlationId: 'corr-items', adminId: 'admin-1' };
const NOW = new Date('2026-10-04T12:00:00.000Z');
const QUEUES = Object.keys(ADMIN_QUEUE_SPECS) as AdminQueueId[];
const STATES: AdminQueueItemState[] = ['stuck', 'failed', 'dead_lettered', 'waiting'];
const WRITES = ['insert', 'update', 'upsert', 'delete', 'rpc'];

/** Records every builder call of every query, writes included; resolves with `result(calls)`. */
function recordingClient(result: (calls: Call[]) => Result) {
  const queries: Call[][] = [];
  const chain = (calls: Call[]) => {
    const builder: Record<string, unknown> = {};
    for (const method of [
      'select', 'eq', 'lte', 'lt', 'gte', 'gt', 'is', 'in', 'not', 'or', 'order', 'limit', 'range', 'abortSignal',
      'insert', 'update', 'upsert', 'delete',
    ]) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ method, args });
        return builder;
      };
    }
    builder.then = (resolve: (v: unknown) => void) => resolve(result(calls));
    return builder;
  };
  const client = {
    from: (table: string) => {
      const calls: Call[] = [{ method: 'from', args: [table] }];
      queries.push(calls);
      return chain(calls);
    },
    rpc: (name: string, params: unknown) => {
      const calls: Call[] = [{ method: 'rpc', args: [name, params] }];
      queries.push(calls);
      return chain(calls);
    },
  } as unknown as SupabaseClient;
  return { client, queries };
}

const empty = (): Result => ({ data: [], error: null, count: 0 });
const FILTERS = ['eq', 'or', 'in', 'not', 'is'];
const filtersOf = (calls: Call[]) => calls.filter((c) => FILTERS.includes(c.method));

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'item-1',
    user_id: 'user-1',
    status: 'failed',
    attempts: 2,
    claimed_at: null,
    created_at: '2026-10-04T09:00:00.000Z',
    scheduled_at: '2026-10-04T08:00:00.000Z',
    next_attempt_at: null,
    reminder_type: 'overdue',
    kind: 'chase',
    briefing_date: '2026-10-04',
    timezone: 'Asia/Jerusalem',
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('R-12: the column allow-lists (C7-12, OP-2)', () => {
  it('the figures read keeps the original four; the selectable set is exactly their union with the item lists', () => {
    expect([...ADMIN_QUEUE_FIGURE_COLUMNS]).toEqual(['id', 'scheduled_at', 'next_attempt_at', 'created_at']);
    expect([...ADMIN_QUEUE_SELECTABLE_COLUMNS].sort()).toEqual(
      [
        'id', 'scheduled_at', 'next_attempt_at', 'created_at',
        'user_id', 'status', 'attempts', 'claimed_at', 'reminder_type', 'kind', 'briefing_date', 'timezone',
      ].sort()
    );
  });

  it('the exact select per table (workplan section 6)', () => {
    expect(ADMIN_QUEUE_ITEM_COLUMNS).toEqual({
      payment_reminders: ['id', 'user_id', 'status', 'attempts', 'claimed_at', 'created_at', 'scheduled_at', 'next_attempt_at', 'reminder_type'],
      payment_automations: ['id', 'user_id', 'status', 'attempts', 'claimed_at', 'created_at', 'scheduled_at', 'next_attempt_at'],
      daily_briefing_sends: ['id', 'user_id', 'status', 'attempts', 'claimed_at', 'created_at', 'next_attempt_at', 'briefing_date', 'timezone'],
      lead_responses: ['id', 'user_id', 'status', 'attempts', 'claimed_at', 'created_at', 'next_attempt_at', 'kind'],
      insight_actions: ['id', 'user_id', 'status', 'attempts', 'claimed_at', 'created_at', 'next_attempt_at', 'kind'],
    });
  });

  it('the states and the page limits', () => {
    expect([...ADMIN_QUEUE_ITEM_STATES]).toEqual(STATES);
    expect(ADMIN_QUEUE_ITEMS_PAGE_SIZE).toBe(50);
    expect(ADMIN_QUEUE_ITEMS_MAX_PAGE).toBe(20);
  });
});

describe('R-1: the read context is first and required', () => {
  it.each([undefined, { correlationId: '', adminId: 'a' }, { correlationId: 'c', adminId: '' }])('%j: error, no request', async (ctx) => {
    const { client, queries } = recordingClient(empty);
    const result = await new AdminJobsQueuesRepository(client).listQueueItemsAllAccounts(ctx as never, 'lead_responses', 'stuck', NOW, { page: 1 });
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
    expect(queries).toHaveLength(0);
  });
});

describe.each(QUEUES)('listQueueItemsAllAccounts: %s', (queue) => {
  const spec = ADMIN_QUEUE_SPECS[queue];

  it.each(STATES)('R-2: state %s reads only its own table, with the exact columns and count: exact', async (state) => {
    const { client, queries } = recordingClient(empty);
    const signal = new AbortController().signal;
    const result = await new AdminJobsQueuesRepository(client).listQueueItemsAllAccounts(CTX, queue, state, NOW, { page: 1 }, { signal });
    expect(result.error).toBeNull();
    expect(queries).toHaveLength(1);
    const [q] = queries;
    expect(q[0]).toEqual({ method: 'from', args: [spec.table] });
    const select = q.find((c) => c.method === 'select')!;
    expect(select.args).toEqual([ADMIN_QUEUE_ITEM_COLUMNS[queue].join(', '), { count: 'exact' }]);
    expect(String(select.args[0])).not.toMatch(
      /error_message|skip_reason|payload|recommendation|contact_id|invoice_id|installment_id|booking_id|entity_id|rule_id|trigger_event_id|claimed_by|dedupe_key|channel|\*/
    );
    expect(q).toContainEqual({ method: 'abortSignal', args: [signal] });
    // R-11: nothing is written.
    expect(q.some((c) => WRITES.includes(c.method))).toBe(false);
  });

  it('R-3: each state uses exactly the figures\' own predicate (without the 24 h / 7 d window)', async () => {
    const figures = recordingClient(empty);
    await new AdminJobsQueuesRepository(figures.client).readQueueFiguresAllAccounts(CTX, queue, NOW);
    const listed = async (state: AdminQueueItemState) => {
      const { client, queries } = recordingClient(empty);
      await new AdminJobsQueuesRepository(client).listQueueItemsAllAccounts(CTX, queue, state, NOW, { page: 1 });
      return filtersOf(queries[0]);
    };
    const stuckBefore = new Date(NOW.getTime() - 690_000).toISOString();
    const q = quoteFilterValue;

    // Stuck: the figures' "stuck" query, call for call.
    const stuck = await listed('stuck');
    expect(stuck).toEqual([
      { method: 'eq', args: ['status', spec.inProgress] },
      { method: 'or', args: [`claimed_at.is.null,claimed_at.lt.${q(stuckBefore)}`] },
    ]);
    expect(figures.queries.some((f) => JSON.stringify(filtersOf(f)) === JSON.stringify(stuck))).toBe(true);

    // Failed (not dead-lettered, not a guardrail decision): the "Failed" figure minus its window.
    const failed = await listed('failed');
    const excluded = [...(spec.deadLetterByMarker ? [DEAD_LETTER_MARKER] : []), ...spec.guardrailMarkers];
    expect(failed).toEqual([
      { method: 'eq', args: ['status', 'failed'] },
      ...(excluded.length ? [{ method: 'or', args: [`error_message.is.null,error_message.not.in.(${excluded.map(q).join(',')})`] }] : []),
    ]);
    if (queue === 'payment_automations') {
      expect(JSON.stringify(failed)).toContain(q(GUARDRAIL_SKIP_MARKERS[0]).replace(/"/g, '\\"'));
    }
    const failedFigure = figures.queries.find(
      (f) => JSON.stringify(filtersOf(f)) === JSON.stringify(failed) && f.some((c) => c.method === 'gte')
    );
    expect(failedFigure).toBeDefined();

    // Dead-lettered: the "Dead-lettered" figure minus its window.
    const dead = await listed('dead_lettered');
    expect(dead).toEqual(
      spec.deadLetterByMarker
        ? [
            { method: 'eq', args: ['status', 'failed'] },
            { method: 'eq', args: ['error_message', DEAD_LETTER_MARKER] },
          ]
        : [{ method: 'eq', args: ['status', 'dead_letter'] }]
    );
    expect(
      figures.queries.some((f) => JSON.stringify(filtersOf(f)) === JSON.stringify(dead) && f.some((c) => c.method === 'gte'))
    ).toBe(true);

    // Waiting: every pending row, due or not.
    expect(await listed('waiting')).toEqual([{ method: 'eq', args: ['status', 'pending'] }]);
  });

  it('R-3: no list query carries a time window', async () => {
    for (const state of STATES) {
      const { client, queries } = recordingClient(empty);
      await new AdminJobsQueuesRepository(client).listQueueItemsAllAccounts(CTX, queue, state, NOW, { page: 1 });
      expect(queries[0].some((c) => ['gte', 'lte', 'gt', 'lt'].includes(c.method))).toBe(false);
    }
  });

  it('R-4: explicit NULL ordering, id as the tie-breaker (W7A-3)', async () => {
    const orders = async (state: AdminQueueItemState) => {
      const { client, queries } = recordingClient(empty);
      await new AdminJobsQueuesRepository(client).listQueueItemsAllAccounts(CTX, queue, state, NOW, { page: 1 });
      return queries[0].filter((c) => c.method === 'order').map((c) => c.args);
    };
    const tie = ['id', { ascending: true }];
    expect(await orders('stuck')).toEqual([['claimed_at', { ascending: true, nullsFirst: true }], tie]);
    expect(await orders('failed')).toEqual([[spec.windowColumn, { ascending: false, nullsFirst: false }], tie]);
    expect(await orders('dead_lettered')).toEqual([[spec.windowColumn, { ascending: false, nullsFirst: false }], tie]);
    expect(await orders('waiting')).toEqual([
      [spec.hasScheduledAt ? 'scheduled_at' : 'created_at', { ascending: true, nullsFirst: false }],
      tie,
    ]);
  });
});

describe('R-5: the 50-row page and the 20-page cap', () => {
  it.each([
    [1, 0, 49],
    [2, 50, 99],
    [20, 950, 999],
  ])('page %i → range(%i, %i)', async (page, from, to) => {
    const { client, queries } = recordingClient(empty);
    await new AdminJobsQueuesRepository(client).listQueueItemsAllAccounts(CTX, 'lead_responses', 'waiting', NOW, { page });
    expect(queries[0].filter((c) => c.method === 'range')).toEqual([{ method: 'range', args: [from, to] }]);
  });

  it.each([0, 21, -1, 1.5, Number.NaN])('page %p: error and no request', async (page) => {
    const { client, queries } = recordingClient(empty);
    const result = await new AdminJobsQueuesRepository(client).listQueueItemsAllAccounts(CTX, 'lead_responses', 'waiting', NOW, { page });
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
    expect(queries).toHaveLength(0);
  });

  it('an unknown queue or state: error and no request', async () => {
    const { client, queries } = recordingClient(empty);
    const repo = new AdminJobsQueuesRepository(client);
    expect((await repo.listQueueItemsAllAccounts(CTX, 'nope' as AdminQueueId, 'stuck', NOW, { page: 1 })).error).toBeTruthy();
    expect((await repo.listQueueItemsAllAccounts(CTX, 'lead_responses', 'sent' as AdminQueueItemState, NOW, { page: 1 })).error).toBeTruthy();
    expect(queries).toHaveLength(0);
  });

  it('a client that ignores the range still yields at most 50 rows', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => row({ id: `item-${i}` }));
    const { client } = recordingClient(() => ({ data: rows, error: null, count: 60 }));
    const result = await new AdminJobsQueuesRepository(client).listQueueItemsAllAccounts(CTX, 'lead_responses', 'failed', NOW, { page: 1 });
    expect(result.data!.rows).toHaveLength(50);
    expect(result.data!.total).toBe(60);
  });

  it('W7A-2: a page past the end (PostgREST 416 PGRST103) is an empty page with total null, not an error', async () => {
    const { client } = recordingClient(() => ({
      data: null,
      error: { code: 'PGRST103', message: 'Requested range not satisfiable', details: 'An offset of 50 was requested, but there are only 3 rows.' },
      count: null,
    }));
    const result = await new AdminJobsQueuesRepository(client).listQueueItemsAllAccounts(CTX, 'lead_responses', 'waiting', NOW, { page: 2 });
    expect(result).toEqual({ data: { rows: [], total: null }, error: null });
    const logged = JSON.stringify([...mockLog.info.mock.calls, ...mockLog.warn.mock.calls]);
    expect(logged).toContain('past the end');
    expect(logged).not.toContain('only 3 rows');
    expect(mockLog.warn).not.toHaveBeenCalled();
    expect(mockLog.error).not.toHaveBeenCalled();
  });
});

describe('R-6: total', () => {
  it('comes from the response count; a null count is 0', async () => {
    const a = recordingClient(() => ({ data: [row()], error: null, count: 132 }));
    expect((await new AdminJobsQueuesRepository(a.client).listQueueItemsAllAccounts(CTX, 'lead_responses', 'failed', NOW, { page: 1 })).data!.total).toBe(132);
    const b = recordingClient(() => ({ data: [], error: null, count: null }));
    expect((await new AdminJobsQueuesRepository(b.client).listQueueItemsAllAccounts(CTX, 'lead_responses', 'failed', NOW, { page: 1 })).data!.total).toBe(0);
  });
});

describe('R-7: rows are mapped field by field', () => {
  const PLANTED = {
    error_message: 'SENTINEL-ERR a@b.c',
    skip_reason: 'SENTINEL-SKIP',
    payload: { to: 'sentinel@client.test' },
    contact_id: 'SENTINEL-CONTACT',
    claimed_by: 'SENTINEL-WORKER',
    recommendation: 'SENTINEL-REC',
  };
  const KEYS = ['id', 'userId', 'status', 'attempts', 'claimedAt', 'createdAt', 'scheduledAt', 'nextAttemptAt', 'kind', 'briefingDate', 'timezone'].sort();

  it.each(QUEUES)('%s: exactly the documented keys, none of the planted values, per-table fields only', async (queue) => {
    const { client } = recordingClient(() => ({ data: [row({ ...PLANTED, claimed_at: '2026-10-04T11:00:00.000Z' })], error: null, count: 1 }));
    const result = await new AdminJobsQueuesRepository(client).listQueueItemsAllAccounts(CTX, queue, 'failed', NOW, { page: 1 });
    const [item] = result.data!.rows;
    expect(Object.keys(item).sort()).toEqual(KEYS);
    expect(JSON.stringify(result)).not.toMatch(/SENTINEL|sentinel|a@b\.c/);
    expect(item).toMatchObject({ id: 'item-1', userId: 'user-1', status: 'failed', attempts: 2, claimedAt: '2026-10-04T11:00:00.000Z', createdAt: '2026-10-04T09:00:00.000Z' });
    const spec = ADMIN_QUEUE_SPECS[queue];
    expect(item.scheduledAt).toBe(spec.hasScheduledAt ? '2026-10-04T08:00:00.000Z' : null);
    expect(item.kind).toBe(queue === 'payment_reminders' ? 'overdue' : queue === 'lead_responses' || queue === 'insight_actions' ? 'chase' : null);
    expect(item.briefingDate).toBe(queue === 'daily_briefing_sends' ? '2026-10-04' : null);
    expect(item.timezone).toBe(queue === 'daily_briefing_sends' ? 'Asia/Jerusalem' : null);
  });
});

describe('R-8: a malformed row fails the read', () => {
  it.each([
    ['non-integer attempts', { attempts: 1.5 }],
    ['negative attempts', { attempts: -1 }],
    ['string attempts', { attempts: '2' }],
    ['missing id', { id: undefined }],
    ['missing created_at', { created_at: null }],
    ['unparseable created_at', { created_at: 'yesterday' }],
    ['unparseable claimed_at', { claimed_at: 'soon' }],
    ['missing user_id', { user_id: null }],
    ['non-string status', { status: 3 }],
  ])('%s', async (_name, overrides) => {
    const { client } = recordingClient(() => ({ data: [row(), row(overrides)], error: null, count: 2 }));
    const result = await new AdminJobsQueuesRepository(client).listQueueItemsAllAccounts(CTX, 'lead_responses', 'failed', NOW, { page: 1 });
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });
});

describe('R-9 / R-10: logs', () => {
  it('a Supabase error is returned with its code; the warn log carries the code, never the message', async () => {
    const { client } = recordingClient(() => ({ data: null, error: { code: '57014', message: 'canceling statement SENTINEL-MSG a@b.c' } }));
    const result = await new AdminJobsQueuesRepository(client).listQueueItemsAllAccounts(CTX, 'insight_actions', 'stuck', NOW, { page: 1 });
    expect(result.data).toBeNull();
    expect((result.error as Error & { code?: string }).code).toBe('57014');
    expect(mockLog.warn).toHaveBeenCalledTimes(1);
    expect(mockLog.warn.mock.calls[0][0]).toMatchObject({ code: '57014', queue: 'insight_actions', state: 'stuck' });
    const logged = JSON.stringify([...mockLog.info.mock.calls, ...mockLog.warn.mock.calls, ...mockLog.error.mock.calls, ...mockLog.debug.mock.calls]);
    expect(logged).not.toMatch(/SENTINEL|a@b\.c/);
  });

  it('the info log carries ids and counts only, no row value', async () => {
    const { client } = recordingClient(() => ({
      data: [row({ id: 'SENTINEL-ID', user_id: 'SENTINEL-USER', kind: 'SENTINEL-KIND', timezone: 'SENTINEL/Zone' })],
      error: null,
      count: 7,
    }));
    await new AdminJobsQueuesRepository(client).listQueueItemsAllAccounts(CTX, 'lead_responses', 'failed', NOW, { page: 1 });
    const served = mockLog.info.mock.calls.find(([, msg]) => msg === 'Queue items read (all accounts)');
    expect(served?.[0]).toEqual({
      correlationId: 'corr-items',
      adminUserId: 'admin-1',
      queue: 'lead_responses',
      state: 'failed',
      page: 1,
      returned: 1,
      total: 7,
    });
    expect(JSON.stringify(mockLog.info.mock.calls)).not.toContain('SENTINEL');
  });

  it('a thrown client error is returned, not thrown', async () => {
    const client = {
      from: () => {
        throw new Error('boom SENTINEL');
      },
    } as unknown as SupabaseClient;
    const result = await new AdminJobsQueuesRepository(client).listQueueItemsAllAccounts(CTX, 'lead_responses', 'failed', NOW, { page: 1 });
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
    expect(JSON.stringify(mockLog.warn.mock.calls)).not.toContain('SENTINEL');
  });
});
