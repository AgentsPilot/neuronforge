/**
 * FF-3 tranche A (finance follow-ups bundle, SA-WP-FU FU-C3; workplan
 * docs/workplans/FINANCE_FOLLOWUPS_BUNDLE_WORKPLAN.md, item 10): the three
 * repository reads that asked PostgREST for more than 1,000 rows in one go now
 * page at 1,000.
 *
 * For each of `AuditTrailRepository.countOwnerActionsSince`,
 * `SmartLinkRepository.uniqueVisitorsByLink` and the insight repository's
 * page-view identity read (`getVectorMaturity`'s visitor scan):
 *   - every request's `.range` span is at most 1,000 rows, and there is no `.limit`;
 *   - a short page stops the read; exactly 1,000 asks once more and stops on 0;
 *   - the read stops at the method's existing ceiling and logs the floor warning;
 *   - the account / link scope and a total order (`id` last) are on EVERY page;
 *   - a page error yields no partial figure.
 *
 * The fake client serves rows by the requested range, like PostgREST, and
 * never more than 1,000 per request (its `max-rows`).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('@/lib/logger', () => ({ createLogger: () => mockLog }));
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

import { AuditTrailRepository } from '../AuditTrailRepository';
import { SmartLinkRepository } from '../SmartLinkRepository';
import { InsightRepository } from '@/lib/business-os/insight/repository/InsightRepository';

type Call = { method: string; args: unknown[] };
const MAX_ROWS = 1000;

/** A PostgREST-like fake: `total` rows exist; each request gets its `.range` slice, capped at 1,000. */
function pagedClient(total: number, makeRow: (i: number) => Record<string, unknown>, failOnRequest: number | null = null) {
  const requests: Call[][] = [];
  const client = {
    from: (table: string) => {
      const calls: Call[] = [{ method: 'from', args: [table] }];
      requests.push(calls);
      const index = requests.length - 1;
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'not', 'gte', 'order', 'range', 'limit']) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ method, args });
          return builder;
        };
      }
      builder.then = (resolve: (v: unknown) => void) => {
        if (failOnRequest === index) return resolve({ data: null, error: { message: 'page failed' } });
        const range = calls.find((c) => c.method === 'range');
        const [from, to] = range ? (range.args as [number, number]) : [0, MAX_ROWS - 1];
        const end = Math.min(to + 1, from + MAX_ROWS, total);
        const data = [];
        for (let i = from; i < end; i += 1) data.push(makeRow(i));
        return resolve({ data, error: null });
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, requests };
}

const argsOf = (calls: Call[], method: string) => calls.filter((c) => c.method === method).map((c) => c.args);
const spans = (requests: Call[][]) => requests.map((calls) => argsOf(calls, 'range')[0] as [number, number]);

const USER = '11111111-1111-4111-8111-111111111111';

// ── AuditTrailRepository.countOwnerActionsSince (ceiling 5,000) ────────────────
describe('countOwnerActionsSince: paged at 1,000 (FF-3 tranche A)', () => {
  const auditRow = (i: number) => ({ action: 'CRM_CONTACT_CREATED', entity_type: 'crm_contact', entity_id: `e${i}`, created_at: '2026-10-20T10:00:00Z' });
  const run = async (total: number, fail: number | null = null) => {
    const { client, requests } = pagedClient(total, auditRow, fail);
    const result = await new AuditTrailRepository(client).countOwnerActionsSince(USER, '2026-10-01T00:00:00Z');
    return { result, requests };
  };
  beforeEach(() => jest.clearAllMocks());

  it('2,500 rows: three requests, each span <= 1,000, every row counted; scope, filters and total order on every page', async () => {
    const { result, requests } = await run(2500);
    expect(spans(requests)).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(result.data?.find((r) => r.action === 'CRM_CONTACT_CREATED')?.count).toBe(2500);
    for (const calls of requests) {
      expect(argsOf(calls, 'eq')).toEqual([['user_id', USER]]);
      expect(argsOf(calls, 'not')).toHaveLength(2);
      expect(argsOf(calls, 'order')).toEqual([['created_at', { ascending: false }], ['id', { ascending: false }]]);
      expect(argsOf(calls, 'limit')).toEqual([]);
    }
    expect(mockLog.warn).not.toHaveBeenCalled();
  });

  it('exactly 1,000 rows: a second request returns 0 and the read stops', async () => {
    const { requests } = await run(1000);
    expect(spans(requests)).toEqual([[0, 999], [1000, 1999]]);
  });

  it('at the ceiling (5,000): five requests, no sixth, and the floor warning with counts only', async () => {
    const { result, requests } = await run(12_000);
    expect(spans(requests)).toEqual([[0, 999], [1000, 1999], [2000, 2999], [3000, 3999], [4000, 4999]]);
    expect(result.data?.[0].count).toBe(5000);
    expect(mockLog.warn).toHaveBeenCalledWith(expect.objectContaining({ scanned: 5000, cap: 5000 }), expect.stringMatching(/floor/));
  });

  it('a failed second page is an error result, never a partial count', async () => {
    const { result } = await run(2500, 1);
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });
});

// ── SmartLinkRepository.uniqueVisitorsByLink (ceiling 20,000) ─────────────────
describe('uniqueVisitorsByLink: paged at 1,000 (FF-3 tranche A)', () => {
  const LINK = 'link-1';
  // Every click is a distinct visitor, so the count equals the rows read.
  const clickRow = (i: number) => ({ smart_link_id: LINK, ip_hash: `ip${i}` });
  const run = async (total: number, fail: number | null = null) => {
    const { client, requests } = pagedClient(total, clickRow, fail);
    const repo = new SmartLinkRepository();
    (repo as unknown as { supabase: SupabaseClient }).supabase = client;
    const result = await repo.uniqueVisitorsByLink(USER, [LINK]);
    return { result, requests };
  };
  beforeEach(() => jest.clearAllMocks());

  it('2,500 clicks: three requests, each span <= 1,000; the link scope and total order on every page', async () => {
    const { result, requests } = await run(2500);
    expect(spans(requests)).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(result.data).toEqual({ [LINK]: 2500 });
    for (const calls of requests) {
      expect(argsOf(calls, 'in')).toEqual([['smart_link_id', [LINK]]]);
      expect(argsOf(calls, 'order')).toEqual([['clicked_at', { ascending: true }], ['id', { ascending: true }]]);
      expect(argsOf(calls, 'limit')).toEqual([]);
    }
    expect(mockLog.warn).not.toHaveBeenCalled();
  });

  it('exactly 1,000 clicks: a second request returns 0 and the read stops', async () => {
    const { requests } = await run(1000);
    expect(spans(requests)).toHaveLength(2);
  });

  it('at the ceiling (20,000): twenty requests and the floor warning', async () => {
    const { result, requests } = await run(25_000);
    expect(requests).toHaveLength(20);
    expect(Math.max(...spans(requests).map(([a, b]) => b - a + 1))).toBe(1000);
    expect(result.data).toEqual({ [LINK]: 20_000 });
    expect(mockLog.warn).toHaveBeenCalledWith(expect.objectContaining({ cap: 20_000 }), expect.stringMatching(/floor/));
  });

  it('a failed page gives no figure at all (the method’s existing never-fatal empty result), never a partial count', async () => {
    const { result } = await run(2500, 2);
    expect(result).toEqual({ data: {}, error: null });
    expect(mockLog.error).toHaveBeenCalled();
  });
});

// ── InsightRepository: the page-view identity read (ceiling 5,000) ────────────
describe('the insight visitor identity read: paged at 1,000 (FF-3 tranche A)', () => {
  type VisitorRead = { readVisitorIdentityRows(userId: string): Promise<{ data: unknown[] | null; error: unknown; count: number | null }> };
  const viewRow = (i: number) => ({ session_id: `s${i}`, ip_hash: null, is_owner_view: false });
  const run = async (total: number, fail: number | null = null) => {
    const { client, requests } = pagedClient(total, viewRow, fail);
    // The read is private to the repository; reached by its name to test it on its own.
    const repo = new InsightRepository(client) as unknown as VisitorRead;
    const result = await repo.readVisitorIdentityRows(USER);
    return { result, requests };
  };

  it('2,500 rows: three requests, each span <= 1,000; user scope and total order on every page; count stays null', async () => {
    const { result, requests } = await run(2500);
    expect(spans(requests)).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(result.data).toHaveLength(2500);
    expect(result.count).toBeNull();
    for (const calls of requests) {
      expect(argsOf(calls, 'eq')).toEqual([['user_id', USER]]);
      expect(argsOf(calls, 'order')).toEqual([['id', { ascending: true }]]);
      expect(argsOf(calls, 'limit')).toEqual([]);
    }
  });

  it('exactly 1,000 rows: a second request returns 0 and the read stops', async () => {
    const { requests } = await run(1000);
    expect(spans(requests)).toEqual([[0, 999], [1000, 1999]]);
  });

  it('at the ceiling (5,000): five requests, 5,000 rows, so the caller’s floor warning can fire', async () => {
    const { result, requests } = await run(9000);
    expect(requests).toHaveLength(5);
    expect(result.data).toHaveLength(5000);
  });

  it('a failed page is { data: null, error }, never a partial list', async () => {
    const { result } = await run(2500, 1);
    expect(result.data).toBeNull();
    expect(result.error).toEqual({ message: 'page failed' });
  });
});
