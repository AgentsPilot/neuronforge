/**
 * QA edge cases for AdminWebhookEventReadRepository (plan payments P-8b.3b,
 * AM-4; SA P3-SA-2 items 2 and 7, P3-SA-5).
 *
 * Unlike the recording fake in the Dev test, this fake EVALUATES the filters
 * the repository chains (eq / lt / filter('metadata->>livemode','eq') /
 * is('metadata->>livemode', null) / order / limit / head counts) against an
 * in-memory table, so the boundaries are exercised as PostgREST would apply
 * them. No database, no network.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

import {
  ADMIN_WEBHOOK_READ_PER_STATE,
  AdminWebhookEventReadRepository,
} from '@/lib/repositories/AdminWebhookEventReadRepository';
import { STALE_CLAIM_AGE_MS } from '@/lib/repositories/ProcessedWebhookEventRepository';

interface Row {
  event_id: string;
  event_type: string | null;
  status: string;
  processed_at: string | null;
  failure_message: string | null;
  metadata: unknown;
}

/** `metadata->>livemode` as Postgres renders it: text, or null when absent. */
function livemodeText(metadata: unknown): string | null {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>).livemode;
  if (value === undefined || value === null) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function evaluatingClient(table: Row[]) {
  const client = {
    from: () => {
      let head = false;
      let columns = '*';
      const preds: Array<(r: Row) => boolean> = [];
      let orderAsc: boolean | null = null;
      let limit: number | null = null;
      const b: Record<string, unknown> = {};
      b.select = (cols: string, opts?: { head?: boolean }) => {
        columns = cols;
        head = opts?.head === true;
        return b;
      };
      b.eq = (col: keyof Row, v: unknown) => (preds.push((r) => r[col] === v), b);
      b.lt = (col: keyof Row, v: string) =>
        (preds.push((r) => r[col] !== null && Date.parse(r[col] as string) < Date.parse(v)), b);
      b.filter = (col: string, op: string, v: string) => {
        if (col !== 'metadata->>livemode' || op !== 'eq') throw new Error(`unexpected filter ${col} ${op}`);
        preds.push((r) => livemodeText(r.metadata) === v);
        return b;
      };
      b.is = (col: string, v: null) => {
        if (col !== 'metadata->>livemode' || v !== null) throw new Error(`unexpected is ${col}`);
        preds.push((r) => livemodeText(r.metadata) === null);
        return b;
      };
      b.order = (col: string, opts: { ascending: boolean }) => {
        if (col !== 'processed_at') throw new Error('unexpected order');
        orderAsc = opts.ascending;
        return b;
      };
      b.limit = (n: number) => ((limit = n), b);
      b.then = (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) => {
        let rows = table.filter((r) => preds.every((p) => p(r)));
        if (head) return Promise.resolve({ data: null, error: null, count: rows.length }).then(onF, onR);
        if (orderAsc !== null) {
          rows = [...rows].sort((a, z) => Date.parse(a.processed_at ?? '') - Date.parse(z.processed_at ?? ''));
          if (!orderAsc) rows.reverse();
        }
        if (limit !== null) rows = rows.slice(0, limit);
        const keep = columns.split(',').map((c) => c.trim());
        const data = rows.map((r) => Object.fromEntries(keep.map((k) => [k, r[k as keyof Row]])));
        return Promise.resolve({ data, error: null }).then(onF, onR);
      };
      return b;
    },
  } as unknown as SupabaseClient;
  return new AdminWebhookEventReadRepository(client);
}

const NOW = new Date('2026-10-28T12:00:00.000Z');
const msAgo = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

function make(id: string, patch: Partial<Row> = {}): Row {
  return {
    event_id: id,
    event_type: 'invoice.paid',
    status: 'failed',
    processed_at: msAgo(60_000),
    failure_message: 'boom',
    metadata: { created: 1761652800, livemode: false },
    ...patch,
  };
}

describe('QA: stuck at the 15-minute boundary (±1 ms)', () => {
  const processing = (id: string, ageMs: number) =>
    make(id, { status: 'processing', failure_message: null, processed_at: msAgo(ageMs) });

  it('exactly 15 min is NOT stuck; 15 min + 1 ms is; 15 min − 1 ms is not', async () => {
    const repo = evaluatingClient([
      processing('evt_exact', STALE_CLAIM_AGE_MS),
      processing('evt_plus1', STALE_CLAIM_AGE_MS + 1),
      processing('evt_minus1', STALE_CLAIM_AGE_MS - 1),
    ]);
    const counts = await repo.countUnfinishedAllEvents({ livemode: false, now: NOW });
    expect(counts).toEqual({ data: { failed: 0, stuck: 1 }, error: null });
    const lists = await repo.listUnfinishedAllEvents({ livemode: false, now: NOW });
    expect(lists.data!.stuck.map((r) => r.event_id)).toEqual(['evt_plus1']);
    expect(lists.data!.failed).toEqual([]);
  });

  it('the same boundary holds for the no-mode stuck count', async () => {
    const repo = evaluatingClient([
      { ...processing('evt_nm_exact', STALE_CLAIM_AGE_MS), metadata: null },
      { ...processing('evt_nm_plus1', STALE_CLAIM_AGE_MS + 1), metadata: null },
    ]);
    expect(await repo.countUnfinishedNoModeAllEvents({ now: NOW })).toEqual({ data: { failed: 0, stuck: 1 }, error: null });
  });

  it('a processing row with a null processed_at is never counted as stuck', async () => {
    const repo = evaluatingClient([{ ...processing('evt_null', 0), processed_at: null }]);
    expect((await repo.countUnfinishedAllEvents({ livemode: false, now: NOW })).data).toEqual({ failed: 0, stuck: 0 });
  });

  it('completed rows are never read, however old', async () => {
    const repo = evaluatingClient([make('evt_done', { status: 'completed', processed_at: msAgo(10 * 86_400_000) })]);
    expect((await repo.countUnfinishedAllEvents({ livemode: false, now: NOW })).data).toEqual({ failed: 0, stuck: 0 });
    expect((await repo.countUnfinishedNoModeAllEvents({ now: NOW })).data).toEqual({ failed: 0, stuck: 0 });
  });
});

describe('QA: test vs live filtering, and no-mode rows', () => {
  const table = [
    make('evt_t1', { metadata: { created: 1, livemode: false } }),
    make('evt_t2', { metadata: { created: 2, livemode: false } }),
    make('evt_l1', { metadata: { created: 3, livemode: true } }),
    make('evt_nm_null', { metadata: null }),
    make('evt_nm_missing', { metadata: { created: 4 } }),
    make('evt_nm_explicit_null', { metadata: { created: 5, livemode: null } }),
  ];

  it('test mode reads only livemode=false rows', async () => {
    const repo = evaluatingClient(table);
    expect((await repo.countUnfinishedAllEvents({ livemode: false, now: NOW })).data).toEqual({ failed: 2, stuck: 0 });
    const ids = (await repo.listUnfinishedAllEvents({ livemode: false, now: NOW })).data!.failed.map((r) => r.event_id);
    expect(ids.sort()).toEqual(['evt_t1', 'evt_t2']);
  });

  it('live mode reads only livemode=true rows', async () => {
    const repo = evaluatingClient(table);
    expect((await repo.countUnfinishedAllEvents({ livemode: true, now: NOW })).data).toEqual({ failed: 1, stuck: 0 });
    expect((await repo.listUnfinishedAllEvents({ livemode: true, now: NOW })).data!.failed.map((r) => r.event_id)).toEqual(['evt_l1']);
  });

  it('no-mode rows (null metadata, missing key, explicit null) are counted once, and in neither mode', async () => {
    const repo = evaluatingClient(table);
    expect((await repo.countUnfinishedNoModeAllEvents({ now: NOW })).data).toEqual({ failed: 3, stuck: 0 });
    const both = [
      ...(await repo.listUnfinishedAllEvents({ livemode: false, now: NOW })).data!.failed,
      ...(await repo.listUnfinishedAllEvents({ livemode: true, now: NOW })).data!.failed,
    ].map((r) => r.event_id);
    expect(both).not.toEqual(expect.arrayContaining(['evt_nm_null']));
    expect(both.filter((id) => id.startsWith('evt_nm_'))).toEqual([]);
  });

  it.each([
    [0, { failed: 0, stuck: 0 }],
    [1, { failed: 1, stuck: 0 }],
    [7, { failed: 7, stuck: 0 }],
  ])('no-mode count with %i rows', async (n, expected) => {
    const repo = evaluatingClient(Array.from({ length: n }, (_, i) => make(`evt_nm${i}`, { metadata: {} })));
    expect((await repo.countUnfinishedNoModeAllEvents({ now: NOW })).data).toEqual(expected);
  });
});

describe('QA: 200 per state against 201', () => {
  const failedRows = (n: number) =>
    Array.from({ length: n }, (_, i) => make(`evt_f${String(i).padStart(4, '0')}`, { processed_at: msAgo((n - i) * 1000) }));

  it('exactly 200: all are read, the count is 200', async () => {
    const repo = evaluatingClient(failedRows(200));
    const lists = await repo.listUnfinishedAllEvents({ livemode: false, now: NOW });
    expect(lists.data!.failed).toHaveLength(ADMIN_WEBHOOK_READ_PER_STATE);
    expect((await repo.countUnfinishedAllEvents({ livemode: false, now: NOW })).data!.failed).toBe(200);
  });

  it('201: 200 read (oldest last attempt first, the newest is the one dropped), the count is exact at 201', async () => {
    const rows = failedRows(201);
    const repo = evaluatingClient(rows);
    const read = (await repo.listUnfinishedAllEvents({ livemode: false, now: NOW })).data!.failed;
    expect(read).toHaveLength(200);
    expect(read[0].event_id).toBe('evt_f0000');
    expect(read.map((r) => r.event_id)).not.toContain('evt_f0200');
    expect((await repo.countUnfinishedAllEvents({ livemode: false, now: NOW })).data!.failed).toBe(201);
  });

  it('the limit is per state: 201 failed and 201 stuck give 200 + 200', async () => {
    const stuck = Array.from({ length: 201 }, (_, i) =>
      make(`evt_s${i}`, { status: 'processing', processed_at: msAgo(STALE_CLAIM_AGE_MS + 1 + i) })
    );
    const repo = evaluatingClient([...failedRows(201), ...stuck]);
    const lists = (await repo.listUnfinishedAllEvents({ livemode: false, now: NOW })).data!;
    expect(lists.failed).toHaveLength(200);
    expect(lists.stuck).toHaveLength(200);
  });

  it('the list rows carry exactly the fixed columns', async () => {
    const repo = evaluatingClient(failedRows(1));
    const [first] = (await repo.listUnfinishedAllEvents({ livemode: false, now: NOW })).data!.failed;
    expect(Object.keys(first).sort()).toEqual(['event_id', 'event_type', 'failure_message', 'metadata', 'processed_at', 'status']);
  });
});
