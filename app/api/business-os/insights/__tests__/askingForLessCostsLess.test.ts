/**
 * A request that declines a section does not pay for it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Every part of this response is behind a flag — projections, correlated
 * insights, the health summary, vector maturity — except the one that was
 * bolted on last. `getMyDayData` ran unconditionally at the end of the handler,
 * so the dashboard's own "give me a single insight cheaply" request
 *
 *     ?limit=1&includeCorrelated=false&includeVectorMaturity=false
 *      &includeProjection=false
 *
 * turned three things off and still built the whole work feed.
 *
 * It is two bounded queries, so this was never where a slow response came from.
 * It is work a caller explicitly asked not to do, which is its own reason.
 *
 * THE RISK IN FIXING IT is the other direction: the dashboard reads
 * `autonomousWork` and `stats` off this response without checking whether it
 * asked for them. So the flag defaults TRUE, and declining returns an empty
 * feed rather than an absent key. Both halves are tested below, because getting
 * either wrong breaks a component that never heard of the flag.
 * ─────────────────────────────────────────────────────────────────────────────
 */

jest.mock('@/lib/logger', () => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: () => logger };
  return { createLogger: () => logger };
});

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

const mockFindActive = jest.fn();
const mockMarkSurfaced = jest.fn();
const mockHealth = jest.fn();
const mockCorrelated = jest.fn();
const mockMaturity = jest.fn();

jest.mock('@/lib/business-os/insight/repository/InsightRepository', () => ({
  InsightRepository: class {
    findActive = (...a: unknown[]) => mockFindActive(...a);
    findByStatus = (...a: unknown[]) => mockFindActive(...a);
    markManySurfaced = (...a: unknown[]) => mockMarkSurfaced(...a);
    getLatestHealthSummary = (...a: unknown[]) => mockHealth(...a);
    getCorrelatedInsights = (...a: unknown[]) => mockCorrelated(...a);
    getVectorMaturity = (...a: unknown[]) => mockMaturity(...a);
  },
}));

const mockMyDay = jest.fn();
jest.mock('@/lib/business-os/insight/reporting/AutonomousWorkFeed', () => ({
  AutonomousWorkFeed: class {
    getMyDayData = (...a: unknown[]) => mockMyDay(...a);
  },
}));

import { GET } from '../route';

const MY_DAY = {
  completedWork: [{ id: 'w1' }],
  pendingInsights: [],
  stats: {
    totalActionsToday: 1,
    totalValueImpact: 250,
    pendingInsightCount: 0,
    criticalInsightCount: 0,
  },
};

function request(query: string) {
  const url = `http://localhost/api/business-os/insights${query}`;
  return { nextUrl: new URL(url), headers: new Headers() } as unknown as Parameters<typeof GET>[0];
}

const body = async (query: string) => (await GET(request(query))).json();

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ id: 'user-1' });
  mockFindActive.mockResolvedValue({ data: [], error: null });
  mockMarkSurfaced.mockResolvedValue({ error: null });
  mockHealth.mockResolvedValue({ data: null, error: null });
  mockCorrelated.mockResolvedValue({ data: [], error: null });
  mockMaturity.mockResolvedValue({ data: null, error: null });
  mockMyDay.mockResolvedValue(MY_DAY);
});

describe('by default nothing changes', () => {
  it('still builds the work feed for a caller that says nothing', async () => {
    const result = await body('');

    expect(mockMyDay).toHaveBeenCalledTimes(1);
    expect(result.data.autonomousWork).toEqual(MY_DAY.completedWork);
    expect(result.data.stats).toEqual(MY_DAY.stats);
  });
});

describe('a caller that declines it', () => {
  /* The dashboard's own cheap request, verbatim. */
  const CHEAP =
    '?limit=1&includeCorrelated=false&includeVectorMaturity=false&includeProjection=false&includeMyDay=false';

  it('does not build it', async () => {
    await body(CHEAP);

    expect(mockMyDay).not.toHaveBeenCalled();
  });

  /*
   * An empty feed, not a missing key. The component reading this never heard
   * of the flag and would throw on `undefined.completedWork`.
   */
  it('still gets the shape, empty', async () => {
    const result = await body(CHEAP);

    expect(result.success).toBe(true);
    expect(result.data.autonomousWork).toEqual([]);
    expect(result.data.stats).toEqual({
      totalActionsToday: 0,
      totalValueImpact: 0,
      pendingInsightCount: 0,
      criticalInsightCount: 0,
    });
  });

  it('declines the other three as well, so the cheap request is actually cheap', async () => {
    await body(CHEAP);

    expect(mockCorrelated).not.toHaveBeenCalled();
    expect(mockMaturity).not.toHaveBeenCalled();
  });
});

describe('what it refuses', () => {
  it('turns away a caller with no session before any query', async () => {
    mockGetUser.mockResolvedValue(null);

    expect((await GET(request(''))).status).toBe(401);
    expect(mockFindActive).not.toHaveBeenCalled();
    expect(mockMyDay).not.toHaveBeenCalled();
  });
});
