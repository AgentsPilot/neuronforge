/**
 * AdminWebhookEventReadRepository (plan payments P-8b.3b, AM-4; SA P3-SA-5,
 * P3-SA-2 items 2 and 7).
 *
 * Pinned: the fixed column list; the mode filter `metadata->>livemode`; the
 * no-mode reads use `.is(…, null)`; no `.or(`, no write and no rpc; no
 * `user_id`; the stale cutoff comes from `STALE_CLAIM_AGE_MS` (never a second
 * 15-minute literal); the per-state limit is 200; it is `server-only`, names
 * its one caller, and is not exported from `lib/repositories/index.ts`.
 *
 * A recording fake client: no database, no network.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));

import {
  ADMIN_WEBHOOK_EVENT_COLUMNS,
  ADMIN_WEBHOOK_READ_PER_STATE,
  ADMIN_WEBHOOK_STALE_AFTER_MS,
  AdminWebhookEventReadRepository,
  webhookStaleCutoffIso,
} from '@/lib/repositories/AdminWebhookEventReadRepository';
import { STALE_CLAIM_AGE_MS } from '@/lib/repositories/ProcessedWebhookEventRepository';

type Call = [method: string, ...args: unknown[]];
type Result = { data?: unknown; error: unknown; count?: number | null };

/** Every query is recorded separately; each answers `answer(calls)` when awaited. */
function recordingClient(answer: (calls: Call[]) => Result) {
  const queries: Call[][] = [];
  const client = {
    from: (table: string) => {
      const calls: Call[] = [['from', table]];
      queries.push(calls);
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'lt', 'filter', 'is', 'order', 'limit', 'or', 'in', 'neq']) {
        builder[method] = (...args: unknown[]) => {
          calls.push([method, ...args]);
          return builder;
        };
      }
      builder.then = (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) =>
        Promise.resolve(answer(calls)).then(onF, onR);
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, queries };
}

const NOW = new Date('2026-10-28T12:00:00.000Z');
const CUTOFF = new Date(NOW.getTime() - STALE_CLAIM_AGE_MS).toISOString();
const hasStatus = (calls: Call[], status: string) => calls.some(([m, a, b]) => m === 'eq' && a === 'status' && b === status);

function expectNoOwnerAndNoOr(queries: Call[][]) {
  const text = JSON.stringify(queries);
  expect(text).not.toContain('user_id');
  for (const calls of queries) for (const [method] of calls) expect(method).not.toBe('or');
}

describe('the stale cutoff and the limits', () => {
  it('the cutoff is now minus STALE_CLAIM_AGE_MS, the webhook\'s own figure', () => {
    expect(ADMIN_WEBHOOK_STALE_AFTER_MS).toBe(STALE_CLAIM_AGE_MS);
    expect(webhookStaleCutoffIso(NOW)).toBe(CUTOFF);
  });

  it('reads up to 200 per state (P3-SA-2 item 2)', () => {
    expect(ADMIN_WEBHOOK_READ_PER_STATE).toBe(200);
  });

  it('the column list is fixed', () => {
    expect(ADMIN_WEBHOOK_EVENT_COLUMNS).toBe('event_id, event_type, status, processed_at, failure_message, metadata');
  });
});

describe('countUnfinishedAllEvents', () => {
  it.each([true, false])('livemode %p: two head counts, failed and stale processing, each filtered on the row mode', async (livemode) => {
    const { client, queries } = recordingClient((calls) => ({ error: null, count: hasStatus(calls, 'failed') ? 5 : 2 }));
    const result = await new AdminWebhookEventReadRepository(client).countUnfinishedAllEvents({ livemode, now: NOW });

    expect(result).toEqual({ data: { failed: 5, stuck: 2 }, error: null });
    expect(queries).toHaveLength(2);
    const mode = String(livemode);
    expect(queries[0]).toEqual([
      ['from', 'processed_webhook_events'],
      ['select', 'event_id', { count: 'exact', head: true }],
      ['eq', 'status', 'failed'],
      ['filter', 'metadata->>livemode', 'eq', mode],
    ]);
    expect(queries[1]).toEqual([
      ['from', 'processed_webhook_events'],
      ['select', 'event_id', { count: 'exact', head: true }],
      ['eq', 'status', 'processing'],
      ['lt', 'processed_at', CUTOFF],
      ['filter', 'metadata->>livemode', 'eq', mode],
    ]);
    expectNoOwnerAndNoOr(queries);
  });

  it('an error on either read is returned, never a partial count', async () => {
    const { client } = recordingClient((calls) => ({ error: hasStatus(calls, 'processing') ? { code: 'XX000' } : null, count: 1 }));
    const result = await new AdminWebhookEventReadRepository(client).countUnfinishedAllEvents({ livemode: true, now: NOW });
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });
});

describe('countUnfinishedNoModeAllEvents (Q-P3-7)', () => {
  it('two plain head counts of rows with no recorded mode, never .or()', async () => {
    const { client, queries } = recordingClient((calls) => ({ error: null, count: hasStatus(calls, 'failed') ? 1 : 0 }));
    const result = await new AdminWebhookEventReadRepository(client).countUnfinishedNoModeAllEvents({ now: NOW });

    expect(result).toEqual({ data: { failed: 1, stuck: 0 }, error: null });
    expect(queries).toEqual([
      [
        ['from', 'processed_webhook_events'],
        ['select', 'event_id', { count: 'exact', head: true }],
        ['eq', 'status', 'failed'],
        ['is', 'metadata->>livemode', null],
      ],
      [
        ['from', 'processed_webhook_events'],
        ['select', 'event_id', { count: 'exact', head: true }],
        ['eq', 'status', 'processing'],
        ['lt', 'processed_at', CUTOFF],
        ['is', 'metadata->>livemode', null],
      ],
    ]);
    expectNoOwnerAndNoOr(queries);
  });
});

describe('listUnfinishedAllEvents', () => {
  it('two reads with the fixed columns, the mode filter, oldest last attempt first, 200 each', async () => {
    const failedRow = { event_id: 'evt_1', status: 'failed' };
    const stuckRow = { event_id: 'evt_2', status: 'processing' };
    const { client, queries } = recordingClient((calls) => ({
      data: hasStatus(calls, 'failed') ? [failedRow] : [stuckRow],
      error: null,
    }));
    const result = await new AdminWebhookEventReadRepository(client).listUnfinishedAllEvents({ livemode: false, now: NOW });

    expect(result).toEqual({ data: { failed: [failedRow], stuck: [stuckRow] }, error: null });
    expect(queries).toEqual([
      [
        ['from', 'processed_webhook_events'],
        ['select', ADMIN_WEBHOOK_EVENT_COLUMNS],
        ['eq', 'status', 'failed'],
        ['filter', 'metadata->>livemode', 'eq', 'false'],
        ['order', 'processed_at', { ascending: true }],
        ['limit', 200],
      ],
      [
        ['from', 'processed_webhook_events'],
        ['select', ADMIN_WEBHOOK_EVENT_COLUMNS],
        ['eq', 'status', 'processing'],
        ['lt', 'processed_at', CUTOFF],
        ['filter', 'metadata->>livemode', 'eq', 'false'],
        ['order', 'processed_at', { ascending: true }],
        ['limit', 200],
      ],
    ]);
    expectNoOwnerAndNoOr(queries);
  });

  it('a read error is returned as { data: null, error }', async () => {
    const { client } = recordingClient(() => ({ data: null, error: { code: '42P01' } }));
    const result = await new AdminWebhookEventReadRepository(client).listUnfinishedAllEvents({ livemode: true, now: NOW });
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });

  it('a throw inside the client is caught and returned, never thrown', async () => {
    const client = {
      from: () => {
        throw new Error('boom');
      },
    } as unknown as SupabaseClient;
    const result = await new AdminWebhookEventReadRepository(client).listUnfinishedAllEvents({ livemode: true, now: NOW });
    expect(result).toEqual({ data: null, error: expect.any(Error) });
  });
});

describe('the source (P3-SA-5)', () => {
  const file = path.join(process.cwd(), 'lib/repositories/AdminWebhookEventReadRepository.ts');
  const source = fs.readFileSync(file, 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it("starts with import 'server-only' and names its one caller in the header", () => {
    expect(source.trimStart().startsWith("import 'server-only';")).toBe(true);
    expect(source).toMatch(/CALLERS: `app\/api\/admin\/jobs-queues\/webhook-events\/route\.ts` only/);
  });

  it('has no write, no rpc and no .or(', () => {
    expect(code).not.toMatch(/\.(insert|update|upsert|delete|rpc|or)\(/);
  });

  it('never names user_id in code', () => {
    expect(code).not.toMatch(/user_id/);
  });

  it('every read method carries the ⟨unscoped-by-design⟩ marker', () => {
    for (const method of ['countUnfinishedAllEvents', 'countUnfinishedNoModeAllEvents', 'listUnfinishedAllEvents']) {
      const at = source.indexOf(`async ${method}(`);
      expect(at).toBeGreaterThan(0);
      const doc = source.slice(source.lastIndexOf('/**', at), at);
      expect({ method, marked: doc.includes('⟨unscoped-by-design⟩') }).toEqual({ method, marked: true });
    }
  });

  it('takes the stale age from STALE_CLAIM_AGE_MS: no 15-minute literal of its own', () => {
    expect(code).toMatch(/import \{ STALE_CLAIM_AGE_MS \} from '\.\/ProcessedWebhookEventRepository';/);
    expect(code).not.toMatch(/15\s*\*\s*60|900_?000/);
  });

  it('is not exported from lib/repositories/index.ts', () => {
    const index = fs.readFileSync(path.join(process.cwd(), 'lib/repositories/index.ts'), 'utf8');
    expect(index).not.toMatch(/AdminWebhookEventReadRepository/);
  });

  it('imports neither billing repository (their allow-lists do not change)', () => {
    expect(code).not.toMatch(/BusinessOsBilling(Account|Event)Repository/);
  });
});
