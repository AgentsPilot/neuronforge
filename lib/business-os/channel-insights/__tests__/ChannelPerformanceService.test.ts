import { ChannelPerformanceService } from '../ChannelPerformanceService';
import type {
  AttributedContact,
  ContactOutcomes,
} from '@/lib/repositories/ChannelAttributionRepository';

function contact(id: string, over: Partial<AttributedContact> = {}): AttributedContact {
  return {
    id,
    created_at: '2026-08-01T00:00:00Z',
    referrer_domain: null,
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    ...over,
  };
}

function stubRepo(contacts: AttributedContact[], outcomes: Partial<ContactOutcomes> = {}) {
  return {
    findAttributedContacts: jest.fn().mockResolvedValue({ data: contacts, error: null }),
    findOutcomesForContacts: jest.fn().mockResolvedValue({
      data: {
        bookingsByContact: outcomes.bookingsByContact ?? new Map(),
        revenueByContact: outcomes.revenueByContact ?? new Map(),
        // Money asked for. Defaults to what was collected, so tests that don't
        // care about the paid/unpaid distinction stay short.
        billedByContact: outcomes.billedByContact ?? outcomes.revenueByContact ?? new Map(),
      },
      error: null,
    }),
  } as any;
}

const SINCE = '2026-07-01T00:00:00Z';

/**
 * Stubs for the visit-side collaborators.
 *
 * Supplied explicitly rather than left to default: without them the service
 * falls through to the real repositories, which only "pass" because a failed
 * Supabase call is caught and returns null. The tests would then be exercising
 * error handling instead of the logic under test, and would start making
 * network calls the moment that changed.
 */
function stubMetrics(
  daily: Array<{ channel: string; metric_date: string; sessions: number; visitors?: number }> = []
) {
  return {
    getTotalsSince: jest.fn().mockResolvedValue({ data: [], error: null }),
    getDailyByPlatformSince: jest.fn().mockResolvedValue({
      // GA4 counts people as activeUsers. Defaulting visitors to sessions keeps
      // fixtures short where the distinction isn't what's being tested.
      data: daily.map(d => ({ ...d, visitors: d.visitors ?? d.sessions, impressions: 0, reach: 0 })),
      error: null,
    }),
  } as any;
}

/**
 * Page views. `views` is how many loads; identity is what the unique count is
 * built from, so each fixture row gets its own distinct people unless a test
 * deliberately reuses them.
 */
function stubSiteAnalytics(
  rows: Array<{
    channel: string;
    metric_date: string;
    views: number;
    visitorIds?: string[];
    surface?: 'website' | 'landing';
  }> = []
) {
  return {
    getVisitTotalsByChannelSince: jest.fn().mockResolvedValue({
      data: rows.map((r, i) => {
        const visitorIds =
          r.visitorIds ?? Array.from({ length: r.views }, (_, n) => `site-${i}-${n}`);
        return {
          ...r,
          visitorIds,
          visitors: new Set(visitorIds).size,
          surface: r.surface ?? ('website' as const),
        };
      }),
      error: null,
    }),
  } as any;
}

/** Smart link clicks — arrivals at booking and form pages nothing else sees. */
function stubLinks(
  rows: Array<{ channel: string; metric_date: string; views: number; visitorIds?: string[] }> = []
) {
  return {
    getClickTotalsByChannelSince: jest.fn().mockResolvedValue({
      data: rows.map((r, i) => {
        const visitorIds =
          r.visitorIds ?? Array.from({ length: r.views }, (_, n) => `link-${i}-${n}`);
        return { ...r, visitorIds, visitors: new Set(visitorIds).size };
      }),
      error: null,
    }),
  } as any;
}

function stubPages(hosts: string[] = []) {
  return { getHostedHosts: jest.fn().mockResolvedValue({ data: hosts, error: null }) } as any;
}

function stubConnections(connections: any[] = []) {
  return { findEnabledByUser: jest.fn().mockResolvedValue({ data: connections, error: null }) } as any;
}

/** Build the service with every collaborator stubbed. */
function makeService(
  repo: any,
  opts: {
    metrics?: any;
    site?: any;
    pages?: any;
    connections?: any;
    links?: any;
  } = {}
) {
  return new ChannelPerformanceService(
    repo,
    opts.metrics ?? stubMetrics(),
    opts.site ?? stubSiteAnalytics(),
    opts.pages ?? stubPages(),
    opts.connections ?? stubConnections(),
    opts.links ?? stubLinks()
  );
}

describe('[smoke] ChannelPerformanceService', () => {
  it('groups leads, bookings and revenue by resolved channel', async () => {
    const service = makeService(stubRepo(
        [
          contact('a', { referrer_domain: 'l.instagram.com' }),
          contact('b', { referrer_domain: 'instagram.com' }),
          contact('c', { referrer_domain: 'google.com' }),
        ],
        {
          bookingsByContact: new Map([['a', 1], ['c', 2]]),
          revenueByContact: new Map([['a', 300], ['c', 900]]),
        }
      ));

    const result = await service.getPerformance('user-1', SINCE);
    const instagram = result.rows.find(r => r.channel === 'instagram')!;
    const google = result.rows.find(r => r.channel === 'google')!;

    expect(instagram.leads).toBe(2);
    expect(instagram.bookings).toBe(1);
    expect(instagram.revenue).toBe(300);
    expect(google.leads).toBe(1);
    expect(google.revenue).toBe(900);
    expect(result.totals).toEqual({ leads: 3, bookings: 3, revenue: 1200, billed: 1200 });
  });

  it('surfaces untraceable leads instead of hiding or reassigning them', async () => {
    // Half this business's leads have no referrer. Spreading them across the
    // known channels would overstate every one of them.
    const service = makeService(stubRepo(
        [
          contact('a', { referrer_domain: 'l.instagram.com' }),
          contact('b'),
          contact('c'),
        ],
        { revenueByContact: new Map([['b', 500]]) }
      ));

    const result = await service.getPerformance('user-1', SINCE);

    expect(result.untracked.leads).toBe(2);
    expect(result.untracked.revenue).toBe(500);
    // Still part of the totals — the money is real, we just can't credit it.
    expect(result.totals.revenue).toBe(500);
    expect(result.rows.find(r => r.channel === 'instagram')!.revenue).toBe(0);
  });

  it('marks referrer-only channels as inferred so the UI can qualify them', async () => {
    const service = makeService(stubRepo([
        contact('a', { referrer_domain: 'l.instagram.com' }),
        contact('b', { utm_source: 'facebook' }),
      ]));

    const result = await service.getPerformance('user-1', SINCE);

    expect(result.rows.find(r => r.channel === 'instagram')!.inferred).toBe(true);
    expect(result.rows.find(r => r.channel === 'facebook')!.inferred).toBe(false);
  });

  it('gives a connected channel a row before any data has arrived', async () => {
    // Connecting Instagram and then not finding it in this table reads as "the
    // connection failed". The row has to exist, marked as waiting, so the
    // difference between "not connected" and "connected, nothing yet" is
    // visible — they are otherwise both a dash.
    const service = makeService(stubRepo([]), {
      connections: stubConnections([
        { platform: 'instagram', account_id: '17841400000000000', insights_enabled: true },
      ]),
    });

    const result = await service.getPerformance('user-1', SINCE);
    const instagram = result.rows.find(r => r.channel === 'instagram');

    expect(instagram).toBeDefined();
    expect(instagram!.reach).toBeNull();
    expect(instagram!.awaitingData).toBe(true);
    expect(instagram!.reachUnavailable).toBe(false);
    expect(instagram!.leads).toBe(0);
  });

  it('does not leave a connected Facebook Page waiting for reach it can never get', async () => {
    // Meta retired page_impressions and page_impressions_unique: a Page reports
    // what people did, never how many saw it. Marking the row as "waiting"
    // promised numbers that cannot arrive, so it sat on an hourglass forever.
    const service = makeService(stubRepo([]), {
      connections: stubConnections([
        { platform: 'facebook_page', account_id: '101748632743751', insights_enabled: true },
      ]),
    });

    const result = await service.getPerformance('user-1', SINCE);
    const facebook = result.rows.find(r => r.channel === 'facebook');

    expect(facebook).toBeDefined();
    expect(facebook!.reach).toBeNull();
    expect(facebook!.awaitingData).toBe(false);
    expect(facebook!.reachUnavailable).toBe(true);
  });

  it('returns empty rather than throwing when there are no leads', async () => {
    const service = makeService(stubRepo([]));
    const result = await service.getPerformance('user-1', SINCE);

    expect(result.rows).toEqual([]);
    expect(result.totals).toEqual({ leads: 0, bookings: 0, revenue: 0, billed: 0 });
  });

  it('degrades to lead counts when outcomes cannot be loaded', async () => {
    // A failure fetching bookings/revenue must not blank the whole section —
    // knowing where leads came from is still useful on its own.
    const repo = stubRepo([contact('a', { referrer_domain: 'l.instagram.com' })]);
    repo.findOutcomesForContacts = jest
      .fn()
      .mockResolvedValue({ data: null, error: new Error('db down') });

    const result = await makeService(repo).getPerformance('user-1', SINCE);

    expect(result.rows.find(r => r.channel === 'instagram')!.leads).toBe(1);
    expect(result.totals.revenue).toBe(0);
  });

  it('orders rows consistently regardless of arrival order', async () => {
    const service = makeService(stubRepo([
        contact('a'),
        contact('b', { referrer_domain: 'google.com' }),
        contact('c', { referrer_domain: 'l.instagram.com' }),
      ]));

    const result = await service.getPerformance('user-1', SINCE);

    // Instagram before Google before direct, per CHANNEL_ORDER.
    expect(result.rows.map(r => r.channel)).toEqual(['instagram', 'google', 'direct']);
  });

  it('computes lead share against the total', async () => {
    const service = makeService(stubRepo([
        contact('a', { referrer_domain: 'l.instagram.com' }),
        contact('b', { referrer_domain: 'l.instagram.com' }),
        contact('c', { referrer_domain: 'l.instagram.com' }),
        contact('d', { referrer_domain: 'google.com' }),
      ]));

    const result = await service.getPerformance('user-1', SINCE);

    expect(result.rows.find(r => r.channel === 'instagram')!.leadShare).toBe(75);
    expect(result.rows.find(r => r.channel === 'google')!.leadShare).toBe(25);
  });
});

describe('[smoke] ChannelPerformanceService visits', () => {
  it('reports GA4 sessions as visits, never as reach', () => {
    // Guarded because the two are different populations: reach is people who
    // saw a post, visits are people who arrived at the business's own site.
    // Summing them would misreport by an order of magnitude.
    return makeService(stubRepo([]), {
      metrics: stubMetrics([{ channel: 'instagram', metric_date: '2026-08-24', sessions: 42 }]),
    })
      .getPerformance('user-1', SINCE)
      .then(result => {
        const instagram = result.rows.find(r => r.channel === 'instagram')!;
        expect(instagram.visits).toBe(42);
        expect(instagram.reach).toBeNull();
      });
  });

  it('shows a channel that has visits but no leads', () => {
    // "42 people came from Instagram and none got in touch" is the single most
    // actionable row this table can produce; dropping it would hide that.
    return makeService(stubRepo([]), {
      metrics: stubMetrics([{ channel: 'instagram', metric_date: '2026-08-24', sessions: 42 }]),
    })
      .getPerformance('user-1', SINCE)
      .then(result => {
        const instagram = result.rows.find(r => r.channel === 'instagram')!;
        expect(instagram.leads).toBe(0);
        expect(instagram.visits).toBe(42);
      });
  });

  it('suppresses our own page views when GA4 measures the same host', async () => {
    const result = await makeService(stubRepo([]), {
      metrics: stubMetrics([{ channel: 'instagram', metric_date: '2026-08-24', sessions: 10 }]),
      site: stubSiteAnalytics([{ channel: 'instagram', metric_date: '2026-08-24', views: 20 }]),
      pages: stubPages(['school.agentpilot.io']),
      connections: stubConnections([
        { platform: 'ga4', measured_hosts: ['school.agentpilot.io'] },
      ]),
    }).getPerformance('user-1', SINCE);

    expect(result.rows.find(r => r.channel === 'instagram')!.visits).toBe(10);
    expect(result.coverage.visits).toBe('analytics');
  });

  it('adds both when GA4 measures a different site', async () => {
    const result = await makeService(stubRepo([]), {
      metrics: stubMetrics([{ channel: 'instagram', metric_date: '2026-08-24', sessions: 10 }]),
      site: stubSiteAnalytics([{ channel: 'instagram', metric_date: '2026-08-24', views: 20 }]),
      pages: stubPages(['school.agentpilot.io']),
      connections: stubConnections([{ platform: 'ga4', measured_hosts: ['mysite.wixsite.com'] }]),
    }).getPerformance('user-1', SINCE);

    expect(result.rows.find(r => r.channel === 'instagram')!.visits).toBe(30);
    expect(result.coverage.visits).toBe('both');
  });

  it('leaves visits null for a channel nothing measured', async () => {
    const result = await makeService(stubRepo([contact('a', { referrer_domain: 'l.instagram.com' })]))
      .getPerformance('user-1', SINCE);

    // A lead arrived from Instagram, but no collector measured visits — that is
    // "unknown", rendered as "—", not zero visits.
    expect(result.rows.find(r => r.channel === 'instagram')!.visits).toBeNull();
    expect(result.coverage.visits).toBe('none');
  });

  it('returns a table for a user with analytics but no leads at all', async () => {
    // The early return must consider visits, or connecting GA4 before getting a
    // single lead shows an empty section.
    const result = await makeService(stubRepo([]), {
      metrics: stubMetrics([{ channel: 'google', metric_date: '2026-08-24', sessions: 5 }]),
    }).getPerformance('user-1', SINCE);

    expect(result.rows.length).toBeGreaterThan(0);
  });
});

describe('[smoke] ChannelPerformanceService — visit totals', () => {
  it('counts one person once across every surface they used', async () => {
    // The same visitor reads the site on Monday and books through a link on
    // Tuesday. The funnel's first station must say one person arrived.
    const service = makeService(stubRepo([]), {
      site: stubSiteAnalytics([
        { channel: 'direct', metric_date: '2026-08-24', views: 1, visitorIds: ['same-person'] },
      ]),
      links: stubLinks([
        { channel: 'direct', metric_date: '2026-08-25', views: 1, visitorIds: ['same-person'] },
      ]),
    });

    const result = await service.getPerformance('user-1', SINCE);

    expect(result.visits.total).toBe(1);
  });

  it('reports each surface that carried arrivals, largest first', async () => {
    const service = makeService(stubRepo([]), {
      site: stubSiteAnalytics([
        { channel: 'direct', metric_date: '2026-08-24', views: 2, surface: 'landing' },
        { channel: 'direct', metric_date: '2026-08-24', views: 5, surface: 'website' },
      ]),
      links: stubLinks([{ channel: 'direct', metric_date: '2026-08-24', views: 3 }]),
    });

    const result = await service.getPerformance('user-1', SINCE);

    expect(result.visits.bySurface).toEqual([
      { surface: 'website', visits: 5 },
      { surface: 'smart_links', visits: 3 },
      { surface: 'landing', visits: 2 },
    ]);
    expect(result.visits.total).toBe(10);
  });

  it('does not count a repeat visitor twice across days', async () => {
    const service = makeService(stubRepo([]), {
      site: stubSiteAnalytics([
        { channel: 'google', metric_date: '2026-08-24', views: 3, visitorIds: ['a', 'b', 'c'] },
        { channel: 'google', metric_date: '2026-08-25', views: 2, visitorIds: ['a', 'd'] },
      ]),
    });

    const result = await service.getPerformance('user-1', SINCE);

    expect(result.visits.total).toBe(4);
  });

  it('reports no visits when nothing measured any', async () => {
    const service = makeService(stubRepo([]));
    const result = await service.getPerformance('user-1', SINCE);

    expect(result.visits).toEqual({ total: 0, bySurface: [] });
  });
});

describe('[smoke] ChannelPerformanceService — billed vs collected', () => {
  it('reports work invoiced but not paid instead of reporting nothing', async () => {
    // Twelve sent invoices and no payments read as ₪0 revenue, which looked
    // like a broken column rather than money that hasn't arrived.
    const service = makeService(
      stubRepo([contact('a', { referrer_domain: 'instagram.com' })], {
        revenueByContact: new Map(),
        billedByContact: new Map([['a', 2050]]),
      })
    );

    const result = await service.getPerformance('user-1', SINCE);
    const instagram = result.rows.find(r => r.channel === 'instagram')!;

    expect(instagram.revenue).toBe(0);
    expect(instagram.billed).toBe(2050);
    expect(result.totals.billed).toBe(2050);
  });

  it('never reports less billed than collected', async () => {
    // Collected money was always billed, so the pair can only go one way. A
    // row where paid exceeds billed would be arithmetic nobody could explain.
    const service = makeService(
      stubRepo([contact('a', { referrer_domain: 'instagram.com' })], {
        revenueByContact: new Map([['a', 300]]),
        billedByContact: new Map([['a', 500]]),
      })
    );

    const result = await service.getPerformance('user-1', SINCE);
    const instagram = result.rows.find(r => r.channel === 'instagram')!;

    expect(instagram.billed).toBeGreaterThanOrEqual(instagram.revenue);
  });

  it('counts untraceable leads' + " billing too", async () => {
    // The untracked line is a real slice of the business, not a rounding note.
    const service = makeService(
      stubRepo([contact('a')], { billedByContact: new Map([['a', 400]]) })
    );

    const result = await service.getPerformance('user-1', SINCE);

    expect(result.untracked.billed).toBe(400);
  });
});
