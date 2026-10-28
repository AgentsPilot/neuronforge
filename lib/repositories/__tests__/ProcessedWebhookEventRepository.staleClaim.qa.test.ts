/**
 * QA tests for plan payments P-8b.1: stale webhook claims are taken back.
 *
 * Workplan: docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P8B_WORKPLAN.md §4.1.
 * An in-memory fake Supabase builder that records filters AND applies them to
 * a small table with Postgres semantics (NULL < x is not true), so boundary,
 * legacy-NULL and race behaviour are exercised against row state, not only
 * against the query shape. No database, no network, no Stripe.
 */

import fs from 'fs';
import path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));

import {
  ProcessedWebhookEventRepository,
  STALE_CLAIM_AGE_MS,
} from '@/lib/repositories/ProcessedWebhookEventRepository';

type Row = { event_id: string; status: string; processed_at: string | null; failure_message: string | null };
type Filter = [op: 'eq' | 'lt', column: string, value: unknown];

/** A fake table: update(...).eq().eq().lt() applied to rows on await. */
function fakeTable(rows: Row[], opts: { error?: unknown; forceCount?: number | null } = {}) {
  const recorded: { table: string; payload: unknown; options: unknown; filters: Filter[] }[] = [];
  const client = {
    from(table: string) {
      const entry = { table, payload: undefined as unknown, options: undefined as unknown, filters: [] as Filter[] };
      recorded.push(entry);
      const builder: Record<string, unknown> = {
        update(payload: unknown, options: unknown) {
          entry.payload = payload;
          entry.options = options;
          return builder;
        },
        eq(col: string, v: unknown) {
          entry.filters.push(['eq', col, v]);
          return builder;
        },
        lt(col: string, v: unknown) {
          entry.filters.push(['lt', col, v]);
          return builder;
        },
        then(onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) {
          if (opts.error) return Promise.resolve({ data: null, error: opts.error, count: null }).then(onF, onR);
          const matches = rows.filter((r) =>
            entry.filters.every(([op, col, v]) => {
              const cell = (r as Record<string, unknown>)[col];
              if (cell === null || cell === undefined) return false; // SQL NULL never matches = or <
              if (op === 'eq') return cell === v;
              return Date.parse(cell as string) < Date.parse(v as string);
            })
          );
          for (const r of matches) Object.assign(r, entry.payload as Partial<Row>);
          const count = opts.forceCount !== undefined ? opts.forceCount : matches.length;
          return Promise.resolve({ data: null, error: null, count }).then(onF, onR);
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, recorded };
}

const NOW = Date.parse('2026-10-27T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const cutoff = () => iso(NOW - STALE_CLAIM_AGE_MS);
const row = (over: Partial<Row>): Row => ({
  event_id: 'evt_qa',
  status: 'processing',
  processed_at: iso(NOW - 20 * 60 * 1000),
  failure_message: null,
  ...over,
});

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
});
afterEach(() => jest.useRealTimers());

describe('P-8b.1 QA: reclaimStale', () => {
  it('STALE_CLAIM_AGE_MS is exactly 900000 (15 minutes)', () => {
    expect(STALE_CLAIM_AGE_MS).toBe(900000);
  });

  it('records one conditional update: count exact, event_id, status processing, strict lt on processed_at', async () => {
    const { client, recorded } = fakeTable([row({})]);
    await new ProcessedWebhookEventRepository(client).reclaimStale('evt_qa', cutoff());
    expect(recorded).toHaveLength(1);
    expect(recorded[0].table).toBe('processed_webhook_events');
    expect(recorded[0].options).toEqual({ count: 'exact' });
    expect(recorded[0].filters).toEqual([
      ['eq', 'event_id', 'evt_qa'],
      ['eq', 'status', 'processing'],
      ['lt', 'processed_at', cutoff()],
    ]);
    expect(JSON.stringify(recorded)).not.toContain('user_id');
  });

  it('a claim exactly 15 min old is NOT reclaimed (strict lt boundary)', async () => {
    const r = row({ processed_at: cutoff() });
    const { client } = fakeTable([r]);
    const res = await new ProcessedWebhookEventRepository(client).reclaimStale('evt_qa', cutoff());
    expect(res).toEqual({ data: { won: false }, error: null });
    expect(r.processed_at).toBe(cutoff());
  });

  it('14:59 old stays; 15:01 old is reclaimed', async () => {
    const young = row({ processed_at: iso(NOW - (14 * 60 + 59) * 1000) });
    const a = fakeTable([young]);
    expect((await new ProcessedWebhookEventRepository(a.client).reclaimStale('evt_qa', cutoff())).data).toEqual({ won: false });
    expect(young.processed_at).toBe(iso(NOW - (14 * 60 + 59) * 1000));

    const old = row({ processed_at: iso(NOW - (15 * 60 + 1) * 1000) });
    const b = fakeTable([old]);
    expect((await new ProcessedWebhookEventRepository(b.client).reclaimStale('evt_qa', cutoff())).data).toEqual({ won: true });
  });

  it('legacy NULL processed_at stays stuck and does not throw', async () => {
    const r = row({ processed_at: null });
    const { client } = fakeTable([r]);
    await expect(new ProcessedWebhookEventRepository(client).reclaimStale('evt_qa', cutoff())).resolves.toEqual({
      data: { won: false },
      error: null,
    });
    expect(r).toEqual(row({ processed_at: null }));
  });

  it.each(['completed', 'failed'])('a %s row, however old, is never touched', async (status) => {
    const r = row({ status, processed_at: iso(NOW - 24 * 3600 * 1000), failure_message: status === 'failed' ? 'x' : null });
    const before = { ...r };
    const { client } = fakeTable([r]);
    expect((await new ProcessedWebhookEventRepository(client).reclaimStale('evt_qa', cutoff())).data).toEqual({ won: false });
    expect(r).toEqual(before);
  });

  it('only the target event id is touched', async () => {
    const other = row({ event_id: 'evt_other' });
    const before = { ...other };
    const { client } = fakeTable([row({}), other]);
    expect((await new ProcessedWebhookEventRepository(client).reclaimStale('evt_qa', cutoff())).data).toEqual({ won: true });
    expect(other).toEqual(before);
  });

  it('the winner writes processed_at = now, keeps processing, clears failure_message', async () => {
    const r = row({ failure_message: 'old failure' });
    const { client, recorded } = fakeTable([r]);
    await new ProcessedWebhookEventRepository(client).reclaimStale('evt_qa', cutoff());
    expect(recorded[0].payload).toEqual({ status: 'processing', failure_message: null, processed_at: iso(NOW) });
    expect(r).toEqual({ event_id: 'evt_qa', status: 'processing', processed_at: iso(NOW), failure_message: null });
  });

  it('two concurrent reclaims on one stuck row: exactly one wins', async () => {
    const shared = [row({})];
    const repoA = new ProcessedWebhookEventRepository(fakeTable(shared).client);
    const repoB = new ProcessedWebhookEventRepository(fakeTable(shared).client);
    const [a, b] = await Promise.all([repoA.reclaimStale('evt_qa', cutoff()), repoB.reclaimStale('evt_qa', cutoff())]);
    expect([a.data?.won, b.data?.won].filter(Boolean)).toHaveLength(1);
  });

  it.each([
    [1, true],
    [0, false],
    [2, false],
    [null, false],
  ])('count %p -> won %p', async (count, won) => {
    const { client } = fakeTable([row({})], { forceCount: count as number | null });
    expect((await new ProcessedWebhookEventRepository(client).reclaimStale('evt_qa', cutoff())).data).toEqual({ won });
  });

  it('an error is passed through with data null, never won', async () => {
    const err = Object.assign(new Error('db down'), { code: 'XX000' });
    const { client } = fakeTable([row({})], { error: err });
    const res = await new ProcessedWebhookEventRepository(client).reclaimStale('evt_qa', cutoff());
    expect(res.data).toBeNull();
    expect(res.error).toBe(err);
  });
});

describe('P-8b.1 QA: route source guards', () => {
  const src = fs
    .readFileSync(path.join(process.cwd(), 'app/api/stripe/webhook/route.ts'), 'utf8')
    .replace(/\r\n/g, '\n');
  const start = src.indexOf("if (existingEvent?.status === 'processing')");
  const end = src.indexOf('} else if (existingEvent) {', start);
  const branch = src.slice(start, end);

  it('the processing branch exists, ahead of the failed branch', () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
  });

  it('the error path never processes: the duplicate return gates on !won, and processedEventId is set only after it', () => {
    const dup = branch.indexOf('if (!reclaim?.won)');
    const ret = branch.indexOf('return NextResponse.json({ received: true, duplicate: true })', dup);
    const set = branch.indexOf('processedEventId = event.id');
    expect(dup).toBeGreaterThan(0);
    expect(ret).toBeGreaterThan(dup);
    expect(set).toBeGreaterThan(ret);
    expect(branch).toMatch(/if \(reclaimError\)[\s\S]*log\.error\(\{ err: reclaimError \}/);
  });

  it('cutoff is now minus STALE_CLAIM_AGE_MS', () => {
    expect(branch).toContain('new Date(Date.now() - STALE_CLAIM_AGE_MS).toISOString()');
  });

  it('applies to Connect and plan events alike: no event.account / type branch before the reclaim', () => {
    const before = src.slice(src.indexOf('processedWebhookEventRepository.findClaim(event.id)'), end);
    expect(before).not.toMatch(/event\.account|isConnectEvent|event\.type\s*===|planPriceRouter|isBusinessOs/i);
    expect(src.indexOf('const isConnectEvent')).toBeGreaterThan(end);
  });

  it('the warn line carries no PII: only the event marker', () => {
    const warn = branch.match(/log\.warn\((.*)\);\n/);
    expect(warn).not.toBeNull();
    expect(warn![1]).toContain("{ event: 'bos_webhook_stale_claim_reclaimed' }");
    expect(warn![1]).not.toMatch(/email|name|customer|amount|metadata|body|user/i);
    expect(branch).not.toMatch(/console\./);
  });

  it('the failed branch is unchanged: still the unconditional reclaimFailed', () => {
    const failed = src.slice(end, src.indexOf('} else {', end));
    expect(failed).toContain("log.info('Retrying previously failed event');");
    expect(failed).toContain('await processedWebhookEventRepository.reclaimFailed(event.id);');
    expect(failed).toContain('processedEventId = event.id;');
  });
});
