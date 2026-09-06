/**
 * Turns raw lead attribution into the per-channel table the reports page shows:
 * how many people arrived from each channel, how many booked, and what it was
 * worth.
 */

import { createLogger } from '@/lib/logger';
import {
  channelAttributionRepository,
  ChannelAttributionRepository,
} from '@/lib/repositories/ChannelAttributionRepository';
import {
  channelMetricsRepository,
  ChannelMetricsRepository,
} from '@/lib/repositories/ChannelMetricsRepository';
import type { ChannelPlatform } from '@/lib/repositories/ChannelConnectionRepository';
import { resolveChannel, CHANNEL_ORDER, type Channel } from './channelFromReferrer';
import {
  resolveVisits,
  describeVisitsCoverage,
  type VisitsCoverage,
  type VisitSurface,
} from './resolveVisits';
import { ga4CoversHost } from './ga4Source';
import { WebsitePageRepository } from '@/lib/repositories/WebsitePageRepository';
import { WebsiteAnalyticsRepository } from '@/lib/repositories/WebsiteAnalyticsRepository';
import { channelConnectionRepository } from '@/lib/repositories/ChannelConnectionRepository';
import { smartLinkRepository } from '@/lib/repositories/SmartLinkRepository';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ service: 'ChannelPerformanceService' });

/**
 * A connected platform maps onto the channel a lead's referrer resolves to, so
 * "how many people saw you on Instagram" lands on the same row as "how many of
 * them became clients".
 *
 * ga4 is absent deliberately: it measures the website as a whole, not one
 * acquisition channel, so folding it into a channel row would double-count
 * traffic already attributed to Instagram or Google.
 */
const PLATFORM_TO_CHANNEL: Partial<Record<ChannelPlatform, Channel>> = {
  facebook_page: 'facebook',
  instagram: 'instagram',
  google_business_profile: 'google',
};

/**
 * Channels whose platform does not report reach at all.
 *
 * Meta retired page_impressions and page_impressions_unique: a Page now reports
 * what people did, never how many saw it, and asking returns error #100 even
 * with full permissions. Without this, a connected Page sat on "waiting for the
 * first numbers" permanently — an hourglass promising figures that can never
 * arrive.
 */
const REACH_NOT_REPORTED = new Set<Channel>(['facebook']);

export interface ChannelPerformanceRow {
  channel: Channel;
  leads: number;
  bookings: number;
  /** Money that actually arrived. */
  revenue: number;
  /**
   * Money asked for, paid or not — always >= revenue. A channel with work
   * invoiced but nothing collected shows what it produced instead of ₪0.
   */
  billed: number;
  /** Share of total leads, 0-100, rounded. */
  leadShare: number;
  /**
   * True when every lead in this row was identified from a referrer rather than
   * an explicit tag. Referrers are reliable but not universal, so the UI can
   * qualify the number rather than presenting it as exact.
   */
  inferred: boolean;
  /**
   * People the business reached on this channel, from a connected account.
   * Null when the channel isn't connected — which is not the same as zero, and
   * the UI must render it as "—" rather than "0".
   */
  reach: number | null;

  /**
   * Connected, but no reach has been recorded for it yet — the first sync is
   * still pending or failing. Distinct from `reach: null`, which means the
   * channel isn't connected at all; both would otherwise render as a dash.
   */
  awaitingData: boolean;
  /**
   * The platform behind this channel does not publish reach, so no amount of
   * waiting or reconnecting will fill the cell. Set only for connected
   * channels — an unconnected one is simply unknown.
   */
  reachUnavailable: boolean;
  /**
   * Unique people who arrived at something the business owns, from this
   * channel. A strictly different measurement from `reach` and never summed
   * with it: seeing a post and visiting a site are different acts.
   */
  visits: number | null;
}

export interface ChannelPerformance {
  rows: ChannelPerformanceRow[];
  totals: { leads: number; bookings: number; revenue: number; billed: number };
  /**
   * Leads with no referrer and no tag. Surfaced deliberately: pretending this is
   * zero, or spreading it across the known channels, would misrepresent how much
   * of the picture we actually have.
   */
  untracked: { leads: number; bookings: number; revenue: number; billed: number };
  /** Which collectors produced these numbers, for an honest caption. */
  coverage: { reach: 'connected' | 'none'; visits: VisitsCoverage };
  /**
   * Everyone who arrived at something the business owns, and where they landed.
   *
   * `total` is the top of the funnel: the public website, landing pages, an
   * analytics-measured site, and booking or form pages reached through a smart
   * link — deduplicated by resolveVisits, so it counts arrivals rather than
   * summing collectors.
   *
   * Deliberately excludes reach. Seeing a post and visiting a page are
   * different acts, and adding them would inflate the funnel with people who
   * never arrived.
   */
  visits: { total: number; bySurface: { surface: VisitSurface; visits: number }[] };
}

export class ChannelPerformanceService {
  constructor(
    private readonly repository: ChannelAttributionRepository = channelAttributionRepository,
    private readonly metrics: ChannelMetricsRepository = channelMetricsRepository,
    // Instantiated rather than imported as singletons: neither module exports
    // one, and the getter in WebsiteAnalyticsRepository caches its first client
    // forever, so every existing caller constructs directly too.
    private readonly siteAnalytics = new WebsiteAnalyticsRepository(supabaseServer),
    private readonly pages = new WebsitePageRepository(supabaseServer),
    private readonly connections = channelConnectionRepository,
    private readonly links = smartLinkRepository
  ) {}

  /**
   * @param since ISO timestamp — leads acquired on or after this moment.
   *              Revenue is counted whenever it landed (cohort model).
   */
  async getPerformance(userId: string, since: string): Promise<ChannelPerformance> {
    const empty: ChannelPerformance = {
      rows: [],
      totals: { leads: 0, bookings: 0, revenue: 0, billed: 0 },
      untracked: { leads: 0, bookings: 0, revenue: 0, billed: 0 },
      coverage: { reach: 'none', visits: 'none' },
      visits: { total: 0, bySurface: [] },
    };

    const sinceDate = since.slice(0, 10);

    const [
      { data: contacts },
      { data: channelTotals },
      { data: ga4Daily },
      { data: siteDaily },
      { data: hostedHosts },
      { data: connections },
      { data: smartLinkClicks },
    ] = await Promise.all([
      this.repository.findAttributedContacts(userId, since),
      // Reach from connected accounts. Fetched independently of leads: a newly
      // connected account with reach but no leads yet is exactly the case worth
      // showing, so this must not be gated on there being contacts.
      this.metrics.getTotalsSince(userId, sinceDate),
      this.metrics.getDailyByPlatformSince(userId, 'ga4', sinceDate),
      this.siteAnalytics.getVisitTotalsByChannelSince(userId, since),
      this.pages.getHostedHosts(userId),
      this.connections.findEnabledByUser(userId),
      // Arrivals at booking, form and payment pages. Nothing else records
      // these — the page-view tracker only runs on the public website.
      this.links.getClickTotalsByChannelSince(userId, since),
    ]);

    const reachByChannel = new Map<Channel, number>();
    for (const totals of channelTotals || []) {
      const channel = PLATFORM_TO_CHANNEL[totals.platform];
      if (!channel) continue;
      reachByChannel.set(channel, (reachByChannel.get(channel) || 0) + totals.reach);
    }

    // Channels the user has connected, whether or not a single number has
    // arrived yet. Connecting an account and then not finding it in this table
    // reads as "it didn't work" — which, while the first sync is pending or
    // failing, is indistinguishable from the truth but tells the user nothing.
    const connectedChannels = new Set<Channel>();
    for (const connection of connections || []) {
      const channel = PLATFORM_TO_CHANNEL[connection.platform as ChannelPlatform];
      if (channel) connectedChannels.add(channel);
    }

    // Does a connected analytics property measure a page we also track? If so
    // its rows supersede ours for the days it covers, rather than being added.
    const measuredHosts = (connections ?? [])
      .filter(connection => connection.platform === 'ga4')
      .flatMap(connection => connection.measured_hosts ?? []);
    const coversHostedSite = ga4CoversHost(measuredHosts, hostedHosts || []);

    const visits = resolveVisits({
      ga4Rows: (ga4Daily || []).map(r => ({
        channel: r.channel,
        metric_date: r.metric_date,
        sessions: r.sessions,
        visitors: r.visitors,
      })),
      siteRows: (siteDaily || []).map(r => ({
        channel: r.channel,
        metric_date: r.metric_date,
        views: r.views,
        visitorIds: r.visitorIds,
        surface: r.surface,
      })),
      smartLinkRows: (smartLinkClicks || []).map(r => ({
        channel: r.channel,
        metric_date: r.metric_date,
        views: r.views,
        visitorIds: r.visitorIds,
      })),
      ga4CoversHostedSite: coversHostedSite,
    });

    // Largest surface first: the reader wants to know where most people land,
    // not the order the collectors happened to run in.
    const bySurface = [...visits.bySurface.entries()]
      .map(([surface, count]) => ({ surface, visits: count }))
      .sort((a, b) => b.visits - a.visits);

    const coverage = {
      reach: (reachByChannel.size > 0 ? 'connected' : 'none') as 'connected' | 'none',
      visits: describeVisitsCoverage({
        hasGa4: (ga4Daily || []).length > 0,
        hasSiteViews: (siteDaily || []).length > 0,
        hasSmartLinks: (smartLinkClicks || []).length > 0,
        ga4CoversHostedSite: coversHostedSite,
      }),
    };

    // A user with only analytics connected and no leads yet still has a table
    // worth showing, so visits must be part of this check.
    if (
      (!contacts || contacts.length === 0) &&
      reachByChannel.size === 0 &&
      visits.byChannel.size === 0 &&
      connectedChannels.size === 0
    ) {
      return empty;
    }

    const { data: outcomes } = contacts?.length
      ? await this.repository.findOutcomesForContacts(userId, contacts.map(c => c.id))
      : { data: null };
    const bookingsByContact = outcomes?.bookingsByContact ?? new Map();
    const revenueByContact = outcomes?.revenueByContact ?? new Map();
    const billedByContact = outcomes?.billedByContact ?? new Map();

    interface Bucket {
      leads: number;
      bookings: number;
      revenue: number;
      billed: number;
      taggedLeads: number;
    }
    const buckets = new Map<Channel, Bucket>();

    for (const contact of contacts ?? []) {
      const { channel, basis } = resolveChannel(contact.referrer_domain, contact.utm_source);
      const bucket = buckets.get(channel) ?? { leads: 0, bookings: 0, revenue: 0, billed: 0, taggedLeads: 0 };

      bucket.leads += 1;
      bucket.bookings += bookingsByContact.get(contact.id) || 0;
      bucket.revenue += revenueByContact.get(contact.id) || 0;
      bucket.billed += billedByContact.get(contact.id) || 0;
      if (basis === 'utm') bucket.taggedLeads += 1;

      buckets.set(channel, bucket);
    }

    const totals = { leads: 0, bookings: 0, revenue: 0, billed: 0 };
    for (const bucket of buckets.values()) {
      totals.leads += bucket.leads;
      totals.bookings += bucket.bookings;
      totals.revenue += bucket.revenue;
      totals.billed += bucket.billed;
    }

    // A connected channel that produced no leads still deserves a row: "3,400
    // people saw you and none got in touch" is the single most actionable thing
    // this section can say, and dropping the row would hide it.
    const channelsToShow = CHANNEL_ORDER.filter(
      channel =>
        buckets.has(channel) ||
        reachByChannel.has(channel) ||
        visits.byChannel.has(channel) ||
        connectedChannels.has(channel)
    );

    const rows: ChannelPerformanceRow[] = channelsToShow.map(channel => {
      const bucket = buckets.get(channel) ?? { leads: 0, bookings: 0, revenue: 0, billed: 0, taggedLeads: 0 };
      const reach = reachByChannel.has(channel) ? reachByChannel.get(channel)! : null;
      const reachUnavailable = connectedChannels.has(channel) && REACH_NOT_REPORTED.has(channel);
      // Connected but nothing measured yet: a dash here would read the same as
      // "not connected", so the row is marked and the table can say which. A
      // platform that never reports reach is not waiting for anything.
      const awaitingData =
        connectedChannels.has(channel) && !reachByChannel.has(channel) && !reachUnavailable;

      return {
        channel,
        leads: bucket.leads,
        bookings: bucket.bookings,
        revenue: bucket.revenue,
        billed: bucket.billed,
        leadShare: totals.leads > 0 ? Math.round((bucket.leads / totals.leads) * 100) : 0,
        inferred: channel !== 'direct' && bucket.leads > 0 && bucket.taggedLeads === 0,
        reach,
        awaitingData,
        reachUnavailable,
        visits: visits.byChannel.has(channel) ? visits.byChannel.get(channel)! : null,
      };
    });

    const direct = buckets.get('direct');

    logger.info(
      { userId, channels: rows.length, leads: totals.leads, visits: visits.total, coverage },
      'Computed channel performance'
    );

    return {
      rows,
      totals,
      untracked: {
        leads: direct?.leads ?? 0,
        bookings: direct?.bookings ?? 0,
        revenue: direct?.revenue ?? 0,
        billed: direct?.billed ?? 0,
      },
      coverage,
      visits: { total: visits.total, bySurface },
    };
  }
}

export const channelPerformanceService = new ChannelPerformanceService();
