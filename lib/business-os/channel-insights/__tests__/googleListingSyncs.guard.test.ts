/**
 * A connected Google listing actually syncs.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * `fetchRows` had cases for Facebook, Instagram and GA4 and nothing for
 * `google_business_profile`, so the platform fell through to:
 *
 *     logger.warn('No fetcher for platform yet'); return [];
 *
 * The connector was otherwise complete. The plugin fetched the metrics, the
 * action was already on the read-only allow-list, and
 * `channel_metrics_daily` had `impressions`, `website_clicks`,
 * `actions_calls` and `actions_directions` columns that exist for no other
 * provider. The only missing piece was the method between them.
 *
 * So an owner would have connected, seen the tile turn green, watched the
 * setup step tick, and received nothing: the nightly cron writing zero rows
 * and a warning only we can read. After weeks of Google approval, that is the
 * worst possible moment to discover a missing pipe.
 *
 * `toRow` made it worse by hardcoding `actions_calls: 0` and
 * `actions_directions: 0` — the two numbers that justify the whole integration
 * could not be passed in even by a fetcher that had them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * The fetcher's behaviour needs a plugin executor, a database and a Google
 * token. What has to hold is that the case exists, that the two action columns
 * are passed through rather than zeroed, and that impressions are not recorded
 * as visits — all properties of the source. The transformation underneath is
 * tested for real in `googleBusinessProfileMetrics.test`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

const sync = read('lib/business-os/channel-insights/ChannelMetricsSyncService.ts');
const executor = read('lib/server/google-business-profile-plugin-executor.ts');
const performance = read('lib/business-os/channel-insights/ChannelPerformanceService.ts');

describe('the platform has a fetcher', () => {
  it('is dispatched rather than falling through to the warning', () => {
    expect(sync).toMatch(/case 'google_business_profile':\s*\n\s*return this\.fetchGoogleBusinessProfile/);
  });

  it('calls the action that is already on the read-only allow-list', () => {
    expect(sync).toMatch(/'get_location_metrics',/);
    /* The allow-list is the only thing standing between this service and a
       write action, so the action it calls has to be in it. */
    const list = sync.slice(sync.indexOf('READ_ONLY_CHANNEL_ACTIONS'), sync.indexOf('BACKFILL_DAYS'));
    expect(list).toContain("'get_location_metrics'");
  });

  it('asks for the location chosen at connect time', () => {
    expect(sync).toMatch(/location_id: connection\.account_id/);
  });
});

describe('the two numbers that justify the connector get through', () => {
  it('toRow accepts them', () => {
    expect(sync).toMatch(/actions_calls\?: number;/);
    expect(sync).toMatch(/actions_directions\?: number;/);
  });

  it('toRow no longer hardcodes them to zero', () => {
    expect(sync).toMatch(/actions_calls: Number\(values\.actions_calls\) \|\| 0,/);
    expect(sync).toMatch(/actions_directions: Number\(values\.actions_directions\) \|\| 0,/);
  });

  it('the fetcher passes them', () => {
    expect(sync).toMatch(/actions_calls: day\.actions_calls/);
    expect(sync).toMatch(/actions_directions: day\.actions_directions/);
  });
});

describe('impressions are reach, and are not visits', () => {
  it('fills reach, which no other channel can', () => {
    /*
     * `ChannelPerformanceService` is built around reach and flags platforms
     * that cannot report it. Meta is already on that list; leaving this null
     * would make the one channel that HAS the number read like the ones that
     * do not.
     */
    expect(sync).toMatch(/reach: day\.impressions/);

    /*
     * MEMBERSHIP, not the set's exact spelling.
     *
     * This pinned `new Set<Channel>(['facebook'])` on one line. The set has
     * since gained `'inbox'` — a mailbox enquiry arrives as an email the
     * business itself sent, so there is no impression to count and the row
     * would otherwise sit on `awaitingData` forever, promising a figure that
     * can never arrive. A correct addition, and the guard failed over the
     * punctuation of it.
     *
     * What matters here is that Google is NOT on the list while the channels
     * that genuinely cannot report reach ARE, so the one channel that has the
     * number does not read like the ones that do not.
     */
    const reachSet = performance.slice(
      performance.indexOf('REACH_NOT_REPORTED = new Set<Channel>('),
      performance.indexOf(']);', performance.indexOf('REACH_NOT_REPORTED'))
    );

    expect(reachSet).toContain("'facebook'");
    expect(reachSet).not.toContain("'google'");
  });

  it('records no sessions or visitors', () => {
    /*
     * An impression is not an arrival. `resolveVisits` would otherwise add
     * listing views to website visits and report a total that is neither.
     */
    const fetcher = sync.slice(
      sync.indexOf('private async fetchGoogleBusinessProfile'),
      sync.indexOf('private async fetchInstagram')
    );

    expect(fetcher).not.toMatch(/sessions:/);
    expect(fetcher).not.toMatch(/visitors:/);
  });
});

describe('the Search and Maps split survives the first sync', () => {
  it('the executor keeps both axes beside the total', () => {
    expect(executor).toMatch(/impressions_maps = \(row\.impressions_maps as number\) \+ value/);
    expect(executor).toMatch(/impressions_search = \(row\.impressions_search as number\) \+ value/);
  });

  it('the sync stores the whole day, so no migration is needed to read them', () => {
    /*
     * They ride in `channel_metrics_daily.raw`, which is JSONB. Surfacing them
     * later then needs no column and no backfill — and a backfill is capped by
     * Google's 18-month retention, so the history would simply be gone.
     */
    expect(sync).toMatch(/raw: day,/);
  });
});
