/**
 * What a connected Google listing actually reports.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS CONNECTOR IS WORTH ITS APPROVAL COST
 *
 * Two of these four numbers cannot be obtained any other way. A client who
 * finds a clinic on Maps and taps the phone number never loads the website, so
 * they never appear in `website_page_views`, never become a `website_booking`,
 * and are invisible to every other surface in the platform. `CALL_CLICKS` and
 * `BUSINESS_DIRECTION_REQUESTS` are that demand, counted on Google's side.
 *
 * And impressions are the only REACH the platform can get. Meta retired page
 * impressions; GA4 is excluded by definition — a session is a visit, and
 * `resolveVisits` says so: "GA4 cannot say how many people saw the business
 * elsewhere."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SHAPE GOOGLE ACTUALLY SENDS
 *
 * Two things about this response are easy to get wrong and are both tested:
 *
 *   · A ZERO DAY HAS NO `value`. Google omits the field rather than sending 0,
 *     so `Number(undefined)` is NaN and a day with no calls would poison the
 *     column it was summed into.
 *
 *   · IMPRESSIONS ARRIVE AS FOUR SERIES. Search/Maps x desktop/mobile. Their
 *     sum is the total, and the sum alone cannot be taken apart again — so the
 *     axes are kept beside it. Maps is someone looking for a business near
 *     them; Search is someone looking for a thing.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { GoogleBusinessProfilePluginExecutor } from '@/lib/server/google-business-profile-plugin-executor';

/** One `datedValues` entry. `value` absent is Google's way of saying zero. */
const point = (day: number, value?: number) => ({
  date: { year: 2026, month: 10, day },
  ...(value === undefined ? {} : { value: String(value) }),
});

const series = (dailyMetric: string, points: ReturnType<typeof point>[]) => ({
  dailyMetric,
  timeSeries: { datedValues: points },
});

/**
 * The executor's HTTP is stubbed; the parsing below it is the real code path.
 *
 * `getLocationMetrics` directly rather than through `executeAction`: the base
 * class resolves the plugin definition from a manager singleton first, which
 * needs a database. The transformation is what has the rules in it.
 */
function withResponse(response: unknown) {
  const executor = new GoogleBusinessProfilePluginExecutor() as unknown as {
    request: (connection: unknown, url: string) => Promise<unknown>;
    getLocationMetrics: (connection: unknown, params: Record<string, unknown>) => Promise<any>;
  };

  const urls: string[] = [];
  executor.request = async (_connection, url) => {
    urls.push(url);
    return response;
  };

  return { executor, urls };
}

const run = (response: unknown) => {
  const { executor, urls } = withResponse(response);
  return {
    urls,
    result: executor.getLocationMetrics(
      { access_token: 't' },
      { location_id: 'locations/123', since: '2026-10-01', until: '2026-10-03' }
    ),
  };
};

describe('it asks Google for the right metrics', () => {
  it('requests all four impression series plus the three actions', async () => {
    const { urls, result } = run({ multiDailyMetricTimeSeries: [] });
    await result;

    const url = urls[0];
    for (const metric of [
      'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
      'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
      'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
      'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
      'WEBSITE_CLICKS',
      'CALL_CLICKS',
      'BUSINESS_DIRECTION_REQUESTS',
    ]) {
      expect(url).toContain(metric);
    }
  });

  it('asks the performance API, for the chosen location', async () => {
    const { urls, result } = run({ multiDailyMetricTimeSeries: [] });
    await result;

    expect(urls[0]).toContain('businessprofileperformance.googleapis.com');
    expect(urls[0]).toContain('locations/123:fetchMultiDailyMetricsTimeSeries');
  });
});

describe('the four actions a listing reports', () => {
  it('reads calls, directions and website clicks per day', async () => {
    const { result } = run({
      multiDailyMetricTimeSeries: [
        {
          dailyMetricTimeSeries: [
            series('CALL_CLICKS', [point(1, 4)]),
            series('BUSINESS_DIRECTION_REQUESTS', [point(1, 7)]),
            series('WEBSITE_CLICKS', [point(1, 2)]),
          ],
        },
      ],
    });

    const { days } = await result;

    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({
      date: '2026-10-01',
      actions_calls: 4,
      actions_directions: 7,
      website_clicks: 2,
    });
  });

  it('sums the four impression series into the total', async () => {
    const { result } = run({
      multiDailyMetricTimeSeries: [
        {
          dailyMetricTimeSeries: [
            series('BUSINESS_IMPRESSIONS_MOBILE_MAPS', [point(1, 10)]),
            series('BUSINESS_IMPRESSIONS_DESKTOP_MAPS', [point(1, 1)]),
            series('BUSINESS_IMPRESSIONS_MOBILE_SEARCH', [point(1, 20)]),
            series('BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', [point(1, 3)]),
          ],
        },
      ],
    });

    const { days } = await result;

    expect(days[0].impressions).toBe(34);
  });

  it('keeps Maps and Search apart, which the sum cannot answer', async () => {
    /*
     * The figure an owner acts on. 11 Maps impressions is people looking for a
     * business near them; 23 Search impressions is people looking for a thing.
     * Summed to 34 and nothing else stored, neither question is answerable
     * later without re-fetching 18 months of history.
     */
    const { result } = run({
      multiDailyMetricTimeSeries: [
        {
          dailyMetricTimeSeries: [
            series('BUSINESS_IMPRESSIONS_MOBILE_MAPS', [point(1, 10)]),
            series('BUSINESS_IMPRESSIONS_DESKTOP_MAPS', [point(1, 1)]),
            series('BUSINESS_IMPRESSIONS_MOBILE_SEARCH', [point(1, 20)]),
            series('BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', [point(1, 3)]),
          ],
        },
      ],
    });

    const { days } = await result;

    expect(days[0]).toMatchObject({
      impressions_maps: 11,
      impressions_search: 23,
      impressions_mobile: 30,
      impressions_desktop: 4,
    });
  });

  it('the axes each add up to the total', async () => {
    const { result } = run({
      multiDailyMetricTimeSeries: [
        {
          dailyMetricTimeSeries: [
            series('BUSINESS_IMPRESSIONS_MOBILE_MAPS', [point(1, 10)]),
            series('BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', [point(1, 3)]),
          ],
        },
      ],
    });

    const [day] = (await result).days;

    expect(day.impressions_maps + day.impressions_search).toBe(day.impressions);
    expect(day.impressions_mobile + day.impressions_desktop).toBe(day.impressions);
  });
});

describe('a day Google reports nothing for', () => {
  it('counts as zero, not as NaN', async () => {
    /*
     * Google omits `value` entirely rather than sending 0. `Number(undefined)`
     * is NaN, and one NaN added into a running total makes the whole column
     * NaN — which reaches the database as a failed insert or a null, for a day
     * that simply had no calls.
     */
    const { result } = run({
      multiDailyMetricTimeSeries: [
        {
          dailyMetricTimeSeries: [
            series('CALL_CLICKS', [point(1), point(2, 5)]),
            series('BUSINESS_IMPRESSIONS_MOBILE_MAPS', [point(1), point(2, 8)]),
          ],
        },
      ],
    });

    const { days } = await result;

    expect(days[0]).toMatchObject({ date: '2026-10-01', actions_calls: 0, impressions: 0 });
    expect(days[1]).toMatchObject({ date: '2026-10-02', actions_calls: 5, impressions: 8 });
    for (const day of days) {
      for (const value of Object.values(day)) {
        expect(Number.isNaN(value as number)).toBe(false);
      }
    }
  });

  it('returns no days at all for an empty response', async () => {
    const { result } = run({ multiDailyMetricTimeSeries: [] });

    expect((await result).days).toEqual([]);
  });

  it('survives a response with no series key', async () => {
    const { result } = run({});

    expect((await result).days).toEqual([]);
  });

  it('skips a point with an unusable date rather than keying on empty', async () => {
    const { result } = run({
      multiDailyMetricTimeSeries: [
        {
          dailyMetricTimeSeries: [
            { dailyMetric: 'CALL_CLICKS', timeSeries: { datedValues: [{ value: '3' }] } },
          ],
        },
      ],
    });

    expect((await result).days).toEqual([]);
  });
});

describe('the days come back in order', () => {
  it('sorted by date, whatever order the series arrived in', async () => {
    const { result } = run({
      multiDailyMetricTimeSeries: [
        { dailyMetricTimeSeries: [series('CALL_CLICKS', [point(3, 1), point(1, 1), point(2, 1)])] },
      ],
    });

    const { days } = await result;

    expect(days.map((d: { date: string }) => d.date)).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
    ]);
  });
});
