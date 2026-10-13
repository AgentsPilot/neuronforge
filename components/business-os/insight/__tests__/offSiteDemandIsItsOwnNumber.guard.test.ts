/**
 * Calls from a Google listing are shown, and are not folded into visits.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * (a) COLLECTED AND INVISIBLE. The sync now writes `actions_calls` and
 *     `actions_directions`, and until this change nothing read them: 40 people
 *     tapping the phone number sat in the database and appeared on no screen.
 *
 * (b) ADDED TO THE WRONG THING, which is worse than not showing them. The
 *     funnel's first station counts people who ARRIVED at something the
 *     business owns. A tap on a listing's phone number is somebody who found
 *     them and never arrived — the call replaced the visit. Summed into that
 *     station, the top of the funnel inflates and every conversion rate below
 *     it deflates: the same denominator mistake `acq_low_conversion` was just
 *     fixed for, in a place where it is harder to notice.
 *
 *     They are equally not leads. A lead here is a CRM contact with a name; a
 *     call tap is an anonymous count from Google, and the same person may have
 *     called twice or called and then booked online and been counted again as a
 *     real lead.
 *
 * (c) A DASH OVER A BUSINESS THAT IS BEING FOUND. The station dashed whenever
 *     no website was published, because arrivals at an unreachable page cannot
 *     exist. A Google listing is reachable with no website at all, so a
 *     business with a verified listing was told nothing was happening while
 *     people were phoning them.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

const repo = read('lib/repositories/ChannelMetricsRepository.ts');
const service = read('lib/business-os/channel-insights/ChannelPerformanceService.ts');
const page = read('app/business-os/page.tsx');
const dashboard = read('components/business-os/insight/LiveDashboard.tsx');
const map = read('components/business-os/insight/FunnelMap.tsx');
const sources = read('components/business-os/insight/ChannelSourcesSection.tsx');

describe('the figure reaches the client', () => {
  it('the repository selects and sums both columns', () => {
    expect(repo).toMatch(/actions_calls, actions_directions/);
    expect(repo).toMatch(/totals\.actions_calls \+= Number\(row\.actions_calls\) \|\| 0/);
    expect(repo).toMatch(/totals\.actions_directions \+= Number\(row\.actions_directions\) \|\| 0/);
  });

  it('the service adds them together per channel', () => {
    expect(service).toMatch(/\(totals\.actions_calls \|\| 0\) \+ \(totals\.actions_directions \|\| 0\)/);
  });

  it('reports null, not zero, where the platform cannot say', () => {
    /* The same distinction `reach` draws: a dash is "unknown", a zero is a
       claim that nothing happened. */
    expect(service).toMatch(/offSiteActions: actionsByChannel\.has\(channel\) \? actionsByChannel\.get\(channel\)! : null/);
  });
});

describe('it is never added to visits or leads', () => {
  it('the dashboard keeps it out of the station count', () => {
    expect(page).toMatch(/found: channelVisits \?\? s\.website\?\.visitors_30d \?\? 0,\s*\n\s*offSiteActions,/);
    /* The failure mode in one line: if it were summed in, this is what it
       would look like. */
    expect(page).not.toMatch(/found: \(channelVisits[^)]*\) \+ offSiteActions/);
  });

  it('the station renders it on its own line', () => {
    expect(dashboard).toMatch(/sub:\s*\n\s*offSite > 0/);
    expect(map).toMatch(/\{station\.sub && \(/);
  });

  it('the channel tile keeps it out of the lead figure', () => {
    /* The big number on a tile is always leads — one unit per column, or the
       tiles stop being comparable with each other. */
    expect(sources).toMatch(/\{quiet \? '—' : formatCount\(tile\.leads\)\}/);
  });
});

describe('it is shown rather than merely stored', () => {
  it('the tile prefers it over reach, which is only exposure', () => {
    expect(sources).toMatch(/\{\(tile\.offSiteActions \?\? 0\) > 0/);
  });

  it('the tile keeps it in the tooltip, so a channel with leads still shows it', () => {
    expect(sources).toMatch(/t\('offSiteActions'\)\}: \$\{formatCount\(tile\.offSiteActions!\)\}/);
  });

  it('has wording in all three languages', () => {
    for (const locale of ['en', 'he', 'es']) {
      const dict = read(`lib/business-os/translations/${locale}.ts`);
      expect({ locale, has: /'station\.found\.off_site':/.test(dict) }).toEqual({
        locale,
        has: true,
      });
    }
    expect(sources).toMatch(/offSiteActions: \{ en: 'called you'/);
  });
});

describe('a listing with no website still reports being found', () => {
  it('the dash is withheld when somebody has called', () => {
    expect(dashboard).toMatch(
      /const awaitingSite = node\.key === 'found' && !hasPublished && offSite === 0;/
    );
  });

  it('and still appears when nothing at all has happened', () => {
    /* A real zero is information; the dash is for the case that cannot have a
       number yet. Removing it entirely would be the opposite error. */
    expect(dashboard).toMatch(/n: awaitingSite \? '—' : node\.count\.toString\(\)/);
  });
});

describe('the memo recomputes when the figure arrives', () => {
  it('lists the new reads as dependencies', () => {
    /*
     * It arrives from a second request after the first paint. Left out of the
     * dependency list, the station would render once without it and never
     * update — collected, passed in, and still invisible.
     */
    expect(dashboard).toMatch(/\}, \[funnelNodes, hasPublished, stats\.offSiteActions, t\]\);/);
  });
});
