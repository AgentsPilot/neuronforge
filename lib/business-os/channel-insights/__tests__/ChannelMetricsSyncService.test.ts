import { ChannelMetricsSyncService } from '../ChannelMetricsSyncService';
import type { ChannelConnection } from '@/lib/repositories/ChannelConnectionRepository';

const mockExecute = jest.fn();
jest.mock('@/lib/server/plugin-executer-v2', () => ({
  PluginExecuterV2: {
    getInstance: jest.fn().mockResolvedValue({
      execute: (...args: unknown[]) => mockExecute(...args),
    }),
  },
}));

function connection(over: Partial<ChannelConnection> = {}): ChannelConnection {
  return {
    id: 'conn-1',
    user_id: 'user-1',
    platform: 'facebook_page',
    plugin_key: 'meta-insights',
    account_id: 'page-123',
    account_name: 'Test Page',
    account_token: null,
    insights_enabled: true,
    connected_at: '2026-08-01T00:00:00Z',
    last_synced_at: null,
    last_sync_error: null,
    backfill_completed_at: '2026-08-01T00:00:00Z',
    ...over,
  };
}

function stubRepos() {
  const connections = {
    findEnabledByUser: jest.fn(),
    findDueForSync: jest.fn(),
    markSynced: jest.fn().mockResolvedValue({ data: true, error: null }),
    markSyncFailed: jest.fn().mockResolvedValue({ data: true, error: null }),
  } as any;

  const metrics = {
    upsertMany: jest.fn().mockResolvedValue({ data: 1, error: null }),
  } as any;

  return { connections, metrics };
}

beforeEach(() => {
  mockExecute.mockReset();
});

describe('[smoke] ChannelMetricsSyncService', () => {
  it('writes one row per day returned by the platform', async () => {
    mockExecute.mockResolvedValue({
      success: true,
      data: {
        days: [
          { date: '2026-08-24', impressions: 412, reach: 388, engagements: 21, profile_views: 9, website_clicks: 3 },
          { date: '2026-08-25', impressions: 500, reach: 460, engagements: 30, profile_views: 12, website_clicks: 5 },
        ],
        followers_count: 1840,
      },
    });

    const { connections, metrics } = stubRepos();
    await new ChannelMetricsSyncService(connections, metrics).syncConnection(connection());

    const rows = metrics.upsertMany.mock.calls[0][0];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      user_id: 'user-1',
      platform: 'facebook_page',
      account_id: 'page-123',
      metric_date: '2026-08-24',
      engagements: 21,
      profile_views: 9,
      followers_count: 1840,
    });
    // Meta retired page impressions and reach. Recorded as zero rather than
    // carried over from a metric that no longer exists.
    expect(rows[0].impressions).toBe(0);
    expect(rows[0].reach).toBe(0);
    expect(connections.markSynced).toHaveBeenCalled();
  });

  it('refuses to invoke an action that is not read-only', async () => {
    // The guard that stops a future edit from posting to a customer's Page.
    const { connections, metrics } = stubRepos();
    const service = new ChannelMetricsSyncService(connections, metrics) as any;

    await expect(
      service.callChannelAction('user-1', 'meta-insights', 'create_post', {})
    ).rejects.toThrow(/not a read-only channel action/);

    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('allows every action the read-only allowlist names', async () => {
    mockExecute.mockResolvedValue({ success: true, data: {} });
    const { connections, metrics } = stubRepos();
    const service = new ChannelMetricsSyncService(connections, metrics) as any;

    for (const action of ['list_pages', 'get_page_insights', 'get_instagram_insights']) {
      await expect(
        service.callChannelAction('user-1', 'meta-insights', action, {})
      ).resolves.toBeDefined();
    }
  });

  it('records a failure instead of throwing, so one broken account cannot halt the cron', async () => {
    mockExecute.mockResolvedValue({ success: false, message: 'Token expired' });

    const { connections, metrics } = stubRepos();
    const result = await new ChannelMetricsSyncService(connections, metrics).syncConnection(
      connection()
    );

    expect(result.error).toMatch(/Token expired/);
    expect(result.daysWritten).toBe(0);
    expect(connections.markSyncFailed).toHaveBeenCalledWith('conn-1', expect.stringMatching(/Token expired/));
    expect(connections.markSynced).not.toHaveBeenCalled();
  });

  it('continues syncing other connections after one fails', async () => {
    mockExecute
      .mockResolvedValueOnce({ success: false, message: 'Token expired' })
      .mockResolvedValueOnce({ success: true, data: { days: [{ date: '2026-08-25', impressions: 10 }] } });

    const { connections, metrics } = stubRepos();
    connections.findEnabledByUser.mockResolvedValue({
      data: [connection({ id: 'broken' }), connection({ id: 'healthy' })],
      error: null,
    });

    const results = await new ChannelMetricsSyncService(connections, metrics).syncUser('user-1');

    expect(results).toHaveLength(2);
    expect(results[0].error).toBeDefined();
    expect(results[1].error).toBeUndefined();
  });

  it('chunks Instagram into 30-day windows because the API will not serve more', async () => {
    mockExecute.mockResolvedValue({ success: true, data: { days: [] } });

    const { connections, metrics } = stubRepos();
    await new ChannelMetricsSyncService(connections, metrics).syncConnection(
      // No backfill timestamp -> 90-day backfill -> must be split
      connection({ platform: 'instagram', backfill_completed_at: null })
    );

    expect(mockExecute.mock.calls.length).toBeGreaterThan(1);
    for (const call of mockExecute.mock.calls) {
      const { since, until } = call[3] as { since: string; until: string };
      const spanDays = (new Date(until).getTime() - new Date(since).getTime()) / 86400000;
      expect(spanDays).toBeLessThanOrEqual(30);
    }
  });

  it('gives a failed connection a shorter clock than a healthy one', async () => {
    // last_synced_at records the last *attempt*, failures included, so both
    // windows are measured against it. A broken connection that waited out the
    // full stale window lost a whole day of data for a bad token.
    const { connections, metrics } = stubRepos();
    connections.findDueForSync.mockResolvedValue({ data: [], error: null });

    await new ChannelMetricsSyncService(connections, metrics).syncDue(20, 25, 3);

    const [staleBefore, retryBefore] = connections.findDueForSync.mock.calls[0];
    const hoursAgo = (iso: string) => (Date.now() - new Date(iso).getTime()) / 3600000;

    expect(hoursAgo(staleBefore)).toBeCloseTo(20, 1);
    expect(hoursAgo(retryBefore)).toBeCloseTo(3, 1);
    expect(new Date(retryBefore).getTime()).toBeGreaterThan(new Date(staleBefore).getTime());
  });

  it('omits page_token entirely when the connection has none', async () => {
    // The action schema types page_token as a string. Sending null fails
    // validation with "should be string, got object", because typeof null is
    // 'object' — so the key must be absent, not present-and-null.
    mockExecute.mockResolvedValue({ success: true, data: { days: [] } });

    const { connections, metrics } = stubRepos();
    await new ChannelMetricsSyncService(connections, metrics).syncConnection(
      connection({ account_token: null })
    );

    const params = mockExecute.mock.calls[0][3] as Record<string, unknown>;
    expect('page_token' in params).toBe(false);
  });

  it('passes the page token through when the connection has one', async () => {
    mockExecute.mockResolvedValue({ success: true, data: { days: [] } });

    const { connections, metrics } = stubRepos();
    await new ChannelMetricsSyncService(connections, metrics).syncConnection(
      connection({ account_token: 'page-token-abc' })
    );

    const params = mockExecute.mock.calls[0][3] as Record<string, unknown>;
    expect(params.page_token).toBe('page-token-abc');
  });

  it('treats a first sync as a backfill and marks it complete', async () => {
    mockExecute.mockResolvedValue({ success: true, data: { days: [] } });

    const { connections, metrics } = stubRepos();
    await new ChannelMetricsSyncService(connections, metrics).syncConnection(
      connection({ backfill_completed_at: null })
    );

    expect(connections.markSynced).toHaveBeenCalledWith('conn-1', { backfillCompleted: true });
  });
});

describe('[smoke] ChannelMetricsSyncService GA4', () => {
  function ga4Connection(over: Partial<ChannelConnection> = {}): ChannelConnection {
    return connection({
      platform: 'ga4',
      plugin_key: 'google-analytics',
      account_id: '401234567',
      account_name: 'parentingschool.co.il',
      ...over,
    });
  }

  it('collapses many (source, host) rows into one row per day and channel', async () => {
    // GA4 returns a row per dimension COMBINATION. Instagram traffic arriving at
    // two hosts is two rows for one channel — writing both would make the second
    // overwrite the first on upsert and silently lose half the sessions.
    mockExecute.mockResolvedValue({
      success: true,
      data: {
        rows: [
          { date: '2026-08-24', sessionSource: 'l.instagram.com', hostName: 'a.agentpilot.io', sessions: 10, activeUsers: 8, screenPageViews: 20 },
          { date: '2026-08-24', sessionSource: 'instagram.com', hostName: 'a.agentpilot.io', sessions: 5, activeUsers: 4, screenPageViews: 9 },
          { date: '2026-08-24', sessionSource: 'google', hostName: 'a.agentpilot.io', sessions: 3, activeUsers: 3, screenPageViews: 6 },
        ],
      },
    });

    const { connections, metrics } = stubRepos();
    connections.setMeasuredHosts = jest.fn().mockResolvedValue({ data: true, error: null });

    await new ChannelMetricsSyncService(connections, metrics).syncConnection(ga4Connection());

    const rows = metrics.upsertMany.mock.calls[0][0];
    expect(rows).toHaveLength(2); // instagram + google, not three

    const instagram = rows.find((r: any) => r.channel === 'instagram');
    expect(instagram.sessions).toBe(15); // 10 + 5, summed not overwritten
    expect(instagram.visitors).toBe(12);
    expect(instagram.metric_date).toBe('2026-08-24');
  });

  it('never writes reach for GA4', async () => {
    // A GA4 session is a visit to the business's own site. Meta reach is people
    // who saw a post. Mixing them in one column misreports by an order of
    // magnitude depending only on which account was connected.
    mockExecute.mockResolvedValue({
      success: true,
      data: {
        rows: [
          { date: '2026-08-24', sessionSource: 'l.instagram.com', hostName: 'a.agentpilot.io', sessions: 10, activeUsers: 8, screenPageViews: 20 },
        ],
      },
    });

    const { connections, metrics } = stubRepos();
    connections.setMeasuredHosts = jest.fn().mockResolvedValue({ data: true, error: null });

    await new ChannelMetricsSyncService(connections, metrics).syncConnection(ga4Connection());

    const rows = metrics.upsertMany.mock.calls[0][0];
    expect(rows[0].reach).toBe(0);
    expect(rows[0].sessions).toBe(10);
  });

  it('records the hosts the property measures, for overlap detection', async () => {
    mockExecute.mockResolvedValue({
      success: true,
      data: {
        rows: [
          { date: '2026-08-24', sessionSource: 'google', hostName: 'a.agentpilot.io', sessions: 1, activeUsers: 1, screenPageViews: 1 },
          { date: '2026-08-24', sessionSource: 'google', hostName: 'mysite.wixsite.com', sessions: 2, activeUsers: 2, screenPageViews: 2 },
        ],
      },
    });

    const { connections, metrics } = stubRepos();
    connections.setMeasuredHosts = jest.fn().mockResolvedValue({ data: true, error: null });

    await new ChannelMetricsSyncService(connections, metrics).syncConnection(ga4Connection());

    const hosts = connections.setMeasuredHosts.mock.calls[0][1];
    expect(hosts.sort()).toEqual(['a.agentpilot.io', 'mysite.wixsite.com']);
  });

  it('maps GA4 placeholder sources to direct rather than referral', async () => {
    mockExecute.mockResolvedValue({
      success: true,
      data: {
        rows: [
          { date: '2026-08-24', sessionSource: '(direct)', hostName: 'a.agentpilot.io', sessions: 7, activeUsers: 6, screenPageViews: 11 },
        ],
      },
    });

    const { connections, metrics } = stubRepos();
    connections.setMeasuredHosts = jest.fn().mockResolvedValue({ data: true, error: null });

    await new ChannelMetricsSyncService(connections, metrics).syncConnection(ga4Connection());

    expect(metrics.upsertMany.mock.calls[0][0][0].channel).toBe('direct');
  });
});
