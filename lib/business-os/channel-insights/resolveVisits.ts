/**
 * Decides how many visits each channel sent, without counting anyone twice.
 *
 * Two collectors can see the same visit. If a business has Google Analytics on
 * its AgentPilot-hosted page, one person arriving from Instagram appears both as
 * a GA4 session and as a row in `website_page_views`. Summing them would double
 * every number on that channel.
 *
 * Kept pure so the precedence rules can be tested exhaustively — this is the
 * kind of logic that is quietly wrong for months otherwise.
 */

import type { Channel } from './channelFromReferrer';

export interface Ga4DailyVisits {
  channel: string;
  metric_date: string;
  sessions: number;
  /**
   * GA4's activeUsers for that day. Distinct people *within the day* — the
   * platform gives us daily rows, so people returning across days cannot be
   * merged. This is the one place the unique count can run high, and it is a
   * limit of the stored data rather than a choice.
   */
  visitors: number;
}

export interface SiteDailyVisits {
  channel: string;
  metric_date: string;
  views: number;
  /** Distinct visitor hashes, so uniques can be counted across the period. */
  visitorIds: string[];
  /** The main site, or a landing page built for one campaign. */
  surface: 'website' | 'landing';
}

/**
 * Smart link clicks. Already filtered by the repository to destinations no
 * other collector sees — a link to the public website is excluded there,
 * because its arrival lands in `siteRows` as a page view.
 */
export interface SmartLinkDailyVisits {
  channel: string;
  metric_date: string;
  views: number;
  /** Distinct visitor hashes, so uniques can be counted across the period. */
  visitorIds: string[];
}

export interface ResolveVisitsInput {
  ga4Rows: Ga4DailyVisits[];
  siteRows: SiteDailyVisits[];
  /**
   * Arrivals at booking, form and payment destinations, which carry no
   * page-view tracker. Additive: nothing else records them.
   */
  smartLinkRows?: SmartLinkDailyVisits[];
  /**
   * True when the GA4 property measures a host AgentPilot also tracks itself.
   * False for an external site — then the two collectors see different places
   * and their visits are additive rather than duplicated.
   */
  ga4CoversHostedSite: boolean;
}

export type VisitsByChannel = Map<Channel, number>;

/** Where a visit landed. Not where it came from — that's the channel. */
export type VisitSurface = 'website' | 'landing' | 'smart_links' | 'analytics';

export interface ResolvedVisits {
  /**
   * Unique visitors per channel. A channel absent from the map means *no
   * collector reported it* — which the UI must render as "—", not 0. Nobody
   * visiting and nobody measuring are different facts.
   */
  byChannel: VisitsByChannel;
  /**
   * The same people, grouped by the surface they landed on. Only surfaces that
   * actually reported anything appear, for the same reason.
   *
   * `analytics` is the GA4-measured site. It is its own surface rather than
   * being folded into `website` because when GA4 covers the hosted page it
   * *replaces* our count for those days — so attributing its users to
   * `website` would look like the page-view tracker produced them.
   */
  bySurface: Map<VisitSurface, number>;
  /**
   * Unique people who arrived anywhere.
   *
   * The parts do NOT sum to this. Someone who lands on the website and later
   * follows a booking link is one visitor in this total and appears under both
   * surfaces — that is what "unique" means, and it is why the breakdown is
   * presented as where people went rather than as a division of the total.
   */
  total: number;
}

/**
 * Counts people, not page loads.
 *
 * Identity comes from a per-visitor hash the collectors already record, unioned
 * across the whole period rather than summed per day: someone who visits on
 * Monday and again on Friday is one visitor. Adding daily figures would have
 * counted them twice.
 *
 * GA4 is the exception and cannot be made to behave: we hold daily activeUsers,
 * with no identity to union, so its contribution is the sum of daily uniques
 * and runs high for people who return across days. The alternative — asking GA4
 * for one window-wide figure — would break the per-day precedence that stops
 * GA4 and our own tracker double-counting the same page.
 */
export function resolveVisits({
  ga4Rows,
  siteRows,
  smartLinkRows = [],
  ga4CoversHostedSite,
}: ResolveVisitsInput): ResolvedVisits {
  // Identified people, kept as sets so the same person is not counted twice at
  // any level. Hashes never leave this function; only sizes are returned.
  const everyone = new Set<string>();
  const perChannel = new Map<Channel, Set<string>>();
  const perSurface = new Map<VisitSurface, Set<string>>();

  // GA4 has no identity to union, so its daily uniques are accumulated
  // separately and added at the end. Keeping them apart is what stops them
  // being mistaken for people we can actually deduplicate.
  const ga4PerChannel = new Map<Channel, number>();
  let ga4Total = 0;
  let ga4Surface = 0;

  const identify = (channel: string, surface: VisitSurface, visitorIds: string[]) => {
    const key = channel as Channel;
    for (const id of visitorIds) {
      if (!id) continue;
      everyone.add(id);
      if (!perChannel.has(key)) perChannel.set(key, new Set());
      perChannel.get(key)!.add(id);
      if (!perSurface.has(surface)) perSurface.set(surface, new Set());
      perSurface.get(surface)!.add(id);
    }
  };

  // GA4 wins wherever it measures: it runs in the browser, deduplicates into
  // its own sessions, and sees the real referrer.
  const ga4Dates = new Set<string>();
  for (const row of ga4Rows) {
    ga4Dates.add(row.metric_date);
    if (!row.visitors) continue;
    const key = row.channel as Channel;
    ga4PerChannel.set(key, (ga4PerChannel.get(key) || 0) + row.visitors);
    ga4Total += row.visitors;
    ga4Surface += row.visitors;
  }

  for (const row of siteRows) {
    // Suppression is decided one day at a time, not once for the whole window.
    // A day GA4 has no data for — an outage, a tag removed and restored, the
    // period before the property existed — falls back to our own count instead
    // of leaving a hole in the series.
    if (ga4CoversHostedSite && ga4Dates.has(row.metric_date)) continue;
    identify(row.channel, row.surface, row.visitorIds);
  }

  // Always additive. These are arrivals at booking, form and payment pages,
  // which no other collector watches — GA4 only sees hosts its tag is on, and
  // the page-view tracker only runs on the public website. The repository has
  // already dropped the link types that would overlap.
  for (const row of smartLinkRows) {
    identify(row.channel, 'smart_links', row.visitorIds);
  }

  const byChannel: VisitsByChannel = new Map();
  for (const [channel, people] of perChannel) byChannel.set(channel, people.size);
  for (const [channel, count] of ga4PerChannel) {
    byChannel.set(channel, (byChannel.get(channel) || 0) + count);
  }

  const bySurface = new Map<VisitSurface, number>();
  for (const [surface, people] of perSurface) bySurface.set(surface, people.size);
  if (ga4Surface > 0) bySurface.set('analytics', ga4Surface);

  return { byChannel, bySurface, total: everyone.size + ga4Total };
}

/** Which collector produced the visit numbers, for an honest one-line caption. */
export type VisitsCoverage = 'analytics' | 'agentpilot_page' | 'both' | 'none';

export function describeVisitsCoverage({
  hasGa4,
  hasSiteViews,
  hasSmartLinks = false,
  ga4CoversHostedSite,
}: {
  hasGa4: boolean;
  hasSiteViews: boolean;
  /**
   * Arrivals at booking or form pages. Counted as one of our own pages,
   * because that is what they are — without this a business whose only
   * traffic comes through smart links was told nothing was measuring visits,
   * while the total above it said otherwise.
   */
  hasSmartLinks?: boolean;
  ga4CoversHostedSite: boolean;
}): VisitsCoverage {
  const hasOwnPages = hasSiteViews || hasSmartLinks;
  if (hasGa4 && hasOwnPages) {
    // When GA4 covers the hosted page its rows replaced ours — but smart link
    // arrivals are never suppressed, so they still count as a second collector.
    if (ga4CoversHostedSite && !hasSmartLinks) return 'analytics';
    return 'both';
  }
  if (hasGa4) return 'analytics';
  if (hasOwnPages) return 'agentpilot_page';
  return 'none';
}
