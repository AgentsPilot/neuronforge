/**
 * Unit tests for MetaInsightsPluginExecutor.
 *
 * The behaviour worth protecting here is metric resilience. Meta fails an
 * entire insights request with error #100 when any single requested metric is
 * invalid, and it retires metrics on a rolling schedule — a large batch lapsed
 * on 15 June 2026. A hardcoded metric list therefore breaks silently over time,
 * taking every valid metric down with the dead one.
 *
 * These tests pin the fallback that keeps partial data flowing.
 */

import { MetaInsightsPluginExecutor } from '@/lib/server/meta-insights-plugin-executor';

function makeExecutor(): any {
  // The base class handles auth and validation; these tests drive the Graph
  // layer directly, so the collaborators are not exercised.
  return new MetaInsightsPluginExecutor({} as any, {} as any);
}

const connection = { access_token: 'test-token' };

function mockFetchSequence(handlers: Array<(url: string) => { ok: boolean; body: any }>) {
  let call = 0;
  global.fetch = jest.fn(async (url: string) => {
    const handler = handlers[Math.min(call, handlers.length - 1)];
    call += 1;
    const { ok, body } = handler(String(url));
    return { ok, status: ok ? 200 : 400, json: async () => body } as any;
  }) as any;
}

function dayValues(metric: string, values: Array<{ end_time: string; value: number }>) {
  return { name: metric, values };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('[smoke] MetaInsightsPluginExecutor metric resilience', () => {
  it('uses the batch request when every metric is valid', async () => {
    mockFetchSequence([
      () => ({
        ok: true,
        body: {
          data: [
            dayValues('page_post_engagements', [{ end_time: '2026-08-24T07:00:00+0000', value: 21 }]),
            dayValues('page_views_total', [{ end_time: '2026-08-24T07:00:00+0000', value: 9 }]),
          ],
        },
      }),
    ]);

    const executor = makeExecutor();
    const result = await executor.getPageInsights(connection, { page_id: '123', page_token: 'page-token' });

    // One batch call plus the follower-count lookup.
    expect((global.fetch as jest.Mock).mock.calls.length).toBeLessThanOrEqual(2);
    expect(result.days[0]).toMatchObject({ date: '2026-08-24', engagements: 21, profile_views: 9 });
  });

  it('recovers the valid metrics when one is no longer supported', async () => {
    // This is the exact production failure: one dead metric took four good ones
    // with it, and the table stayed empty.
    mockFetchSequence([
      // The batch is rejected because one metric is retired.
      () => ({ ok: false, body: { error: { message: '(#100) The value must be a valid insights metric' } } }),
      // Individual probes follow.
      url => {
        if (url.includes('metric=page_post_engagements')) {
          return {
            ok: true,
            body: {
              data: [dayValues('page_post_engagements', [{ end_time: '2026-08-24T07:00:00+0000', value: 44 }])],
            },
          };
        }
        if (url.includes('page_views_total')) {
          return { ok: false, body: { error: { message: '(#100) The value must be a valid insights metric' } } };
        }
        return { ok: true, body: { data: [] } };
      },
    ]);

    const executor = makeExecutor();
    const result = await executor.getPageInsights(connection, { page_id: '123', page_token: 'page-token' });

    // Degraded, not dead: the surviving metric is stored.
    expect(result.days.length).toBeGreaterThan(0);
    expect(result.days[0].engagements).toBe(44);
    // The retired metric reads as zero rather than blocking everything.
    expect(result.days[0].profile_views).toBe(0);
  });

  it('does not probe individually for a token or permission failure', async () => {
    // Probing would multiply a permission error into one call per metric for
    // no benefit — every probe fails identically.
    mockFetchSequence([
      () => ({
        ok: false,
        body: { error: { message: '(#200) Requires read_insights permission', code: 200 } },
      }),
    ]);

    const executor = makeExecutor();
    await expect(executor.getPageInsights(connection, { page_id: '123', page_token: 'page-token' })).rejects.toThrow(
      /read_insights/
    );

    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);
  });

  it('reports a failure when no metric survives probing', async () => {
    mockFetchSequence([
      () => ({ ok: false, body: { error: { message: '(#100) The value must be a valid insights metric' } } }),
    ]);

    const executor = makeExecutor();
    await expect(executor.getPageInsights(connection, { page_id: '123', page_token: 'page-token' })).rejects.toThrow(
      /valid insights metric/
    );
  });

  it('never puts the access token in a log-visible URL field', async () => {
    // The token travels in the query string for Graph GETs, so the logged
    // payload must carry the endpoint only.
    const executor = makeExecutor();
    const debug = jest.spyOn(executor.logger, 'debug').mockImplementation(() => {});

    mockFetchSequence([() => ({ ok: true, body: { data: [] } })]);
    await executor.listPages(connection);

    for (const call of debug.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('test-token');
    }
  });
});

describe('[smoke] MetaInsightsPluginExecutor shaping', () => {
  it('pivots per-metric series into one row per day', async () => {
    mockFetchSequence([
      () => ({
        ok: true,
        body: {
          data: [
            dayValues('page_views_total', [
              { end_time: '2026-08-24T07:00:00+0000', value: 10 },
              { end_time: '2026-08-25T07:00:00+0000', value: 20 },
            ]),
            dayValues('page_post_engagements', [
              { end_time: '2026-08-25T07:00:00+0000', value: 5 },
            ]),
          ],
        },
      }),
    ]);

    const executor = makeExecutor();
    const result = await executor.getPageInsights(connection, { page_id: '123', page_token: 'page-token' });

    expect(result.days).toHaveLength(2);
    expect(result.days[0]).toMatchObject({ date: '2026-08-24', profile_views: 10, engagements: 0 });
    expect(result.days[1]).toMatchObject({ date: '2026-08-25', profile_views: 20, engagements: 5 });
  });

  it('surfaces the linked Instagram account alongside its Page', async () => {
    mockFetchSequence([
      () => ({
        ok: true,
        body: {
          data: [
            {
              id: 'page-1',
              name: 'Parenting School',
              instagram_business_account: { id: 'ig-1', username: 'school' },
              access_token: 'page-token',
            },
            { id: 'page-2', name: 'Therapy Group' },
          ],
        },
      }),
    ]);

    const executor = makeExecutor();
    const result = await executor.listPages(connection);

    expect(result.page_count).toBe(2);
    expect(result.pages[0]).toMatchObject({
      id: 'page-1',
      instagram_account_id: 'ig-1',
      instagram_username: 'school',
    });
    // A Page with no linked Business Instagram must report null, not undefined,
    // so the caller can tell "none" from "not asked".
    expect(result.pages[1].instagram_account_id).toBeNull();
  });
});
