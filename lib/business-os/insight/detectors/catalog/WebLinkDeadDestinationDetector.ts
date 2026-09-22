/**
 * A Link You Are Sharing That Goes Nowhere
 *
 * An active smart link whose destination cannot be reached from anyone else's
 * phone. Not a link that converts badly: a link that does not open.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS CAN HAPPEN AT ALL
 *
 * `/go/[code]` repairs exactly one thing before redirecting — a stale `/c/<code>`
 * segment, replaced with the owner's current code. The HOST is passed through
 * untouched, because the platform has no business overriding an owner who
 * deliberately points a link at their Instagram or their accountant.
 *
 * So a destination saved while the owner was on a laptop at
 * `http://localhost:3000/...` is stored, redirected to, and fails in the
 * client's browser with a connection error — on the owner's screen it works
 * perfectly, which is exactly why nobody catches it.
 *
 * This is not hypothetical. Both of these are live rows:
 *
 *   "Contact Form"                http://localhost:3000/c/fny614/contact   2 clicks
 *   "Deletion test booking link"  https://example.invalid/book/1789601273026
 *
 * Two people clicked the first one. Whatever they wanted, the business never
 * heard about it, and nothing anywhere told the owner.
 *
 * WHAT COUNTS AS UNREACHABLE
 *
 * Only hosts that cannot resolve for a stranger, ever: loopback, a private
 * network address, a `.local`/`.test`/`.invalid` name, or a reserved
 * documentation domain. Nothing is judged on being unfamiliar — an owner
 * linking to Calendly, WhatsApp or their own domain is doing something normal,
 * and a detector that second-guesses that would be wrong far more often than
 * right.
 *
 * No network call is made. That is deliberate: a detector runs for every user
 * on a cron, and fetching owner-supplied URLs from the server would turn this
 * into an outbound request engine pointed wherever a row says. Reachability is
 * decided from the address itself, which is enough for the cases above and
 * makes no claim about hosts it cannot judge.
 * ---------------------------------------------------------------------------
 *
 * @see docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

interface LinkRow {
  id: string;
  code: string | null;
  name: string | null;
  destination_url: string | null;
  destination_type: string | null;
  click_count: number | null;
}

/** Host suffixes that never resolve outside the machine that wrote them. */
const UNREACHABLE_SUFFIXES = ['.local', '.localhost', '.test', '.invalid', '.example'];

/** Reserved for documentation by RFC 2606. Never a real destination. */
const PLACEHOLDER_HOSTS = ['example.com', 'example.org', 'example.net', 'example.edu'];

export type DeadReason = 'missing' | 'loopback' | 'private_network' | 'placeholder' | 'malformed';

/**
 * Why this destination cannot be opened by someone else, or null if it can be
 * (or if nothing here is able to tell).
 *
 * Exported for the test, and because this is the only part of the detector
 * worth reading twice: everything it returns is a claim made to a business
 * owner about their own link being broken, so it errs toward silence.
 */
export function deadReason(url: string | null | undefined): DeadReason | null {
  const raw = (url ?? '').trim();
  if (!raw) return 'missing';

  /*
   * A relative path is resolved against the incoming request by the redirect
   * route, so it always lands on the platform itself and is by definition
   * reachable. Nothing to judge.
   */
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw.startsWith('/') ? null : 'malformed';

  let host: string;
  try {
    const parsed = new URL(raw);
    // A `mailto:` or `tel:` destination has no host and opens fine.
    if (!parsed.protocol.startsWith('http')) return null;
    host = parsed.hostname.toLowerCase();
  } catch {
    return 'malformed';
  }

  if (!host) return 'malformed';

  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') {
    return 'loopback';
  }
  if (host.startsWith('127.')) return 'loopback';

  // RFC 1918 and the link-local block. Reachable on the owner's network, and
  // nowhere else.
  if (host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('169.254.')) {
    return 'private_network';
  }
  const rfc1918 = /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (rfc1918) return 'private_network';

  if (PLACEHOLDER_HOSTS.includes(host)) return 'placeholder';
  if (UNREACHABLE_SUFFIXES.some(suffix => host.endsWith(suffix))) return 'placeholder';

  return null;
}

export class WebLinkDeadDestinationDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'web_link_dead_destination',
    name: 'A Link You Are Sharing That Goes Nowhere',
    category: 'acquisition',
    description: 'Finds active shared links whose destination cannot open on anyone else\'s device',

    watchedMetrics: ['acquisition.broken_link_destinations'],
    eventTypes: [],

    baselineWindow: 'week',
    thresholdType: 'absolute',
    threshold: 0,
    direction: 'above',
    /*
     * One is the finding. Every other detector here waits for a pattern,
     * because one late invoice is not a cash-flow problem — but one broken link
     * is one broken link, and waiting for a second would mean holding the news
     * back until it happened twice.
     */
    minSamples: 1,

    severityFn: (clicks: number, _links: number): InsightSeverity => {
      // Clicks are people who already hit the error. A link nobody has pressed
      // yet is still broken, just not yet costing anything.
      if (clicks >= 5) return 'high';
      if (clicks >= 1) return 'medium';
      return 'low';
    },

    /*
     * No automation and no guess at a correction. The platform knows the
     * destination is unreachable; it does not know where the owner meant to
     * point it, and quietly rewriting a link someone shares under their own
     * name is not a repair.
     */
    pairedProcessId: undefined,
    /*
     * A broken link does not become more or less broken because the account is
     * new, and this is often at its most useful on day one — a link built while
     * testing locally and then shared. The maturity gate exists to stop
     * statistical claims on thin data; there is no statistic here.
     */
    ignoresVectorMaturity: true,

    consentTier: 'suggest',
    eligibleForAutomation: false,
    ownerParameters: [],
    guardrails: [],
    // Short, because this is actionable and stays true until it is fixed.
    cooldownHours: 72,
  };

  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async evaluate(userId: string): Promise<DetectionResult | null> {
    if (await this.isOnCooldown(userId)) {
      this.logDetection(userId, null);
      return null;
    }

    const { data, error } = await this.supabase
      .from('smart_links')
      .select('id, code, name, destination_url, destination_type, click_count')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (error) throw error;

    const links = (data ?? []) as unknown as LinkRow[];

    const broken = links
      .map(link => ({ link, reason: deadReason(link.destination_url) }))
      .filter((entry): entry is { link: LinkRow; reason: DeadReason } => entry.reason !== null)
      .sort((a, b) => (b.link.click_count ?? 0) - (a.link.click_count ?? 0));

    if (broken.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    /*
     * `click_count` is maintained by a database trigger on insert, which is why
     * it is trusted here while its neighbour `conversion_count` is not: that one
     * was written by application code that assigned a query builder to it, and
     * any detector reading it would have inherited the damage.
     */
    const clicks = broken.reduce((sum, b) => sum + (b.link.click_count ?? 0), 0);
    const severity = this.definition.severityFn(clicks, broken.length);

    const result = this.createDetectionResult({
      severity,
      metricKey: 'acquisition.broken_link_destinations',
      currentValue: broken.length,
      baselineValue: 0,
      thresholdValue: 0,
      // Nothing was measured against anything. See WebLinkNotConvertingDetector.
      percentChange: 0,
      direction: 'above',
      affectedEntityType: 'page',
      affectedEntityIds: broken.map(b => b.link.id),
      affectedCount: broken.length,
      impactDirection: 'opportunity',
      impactPeriod: 'monthly',
      processParameters: {
        lost_clicks: clicks,
        links: broken.slice(0, 5).map(b => ({
          code: b.link.code,
          name: b.link.name,
          type: b.link.destination_type,
          reason: b.reason,
          clicks: b.link.click_count ?? 0,
        })),
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
