/**
 * A Link People Click And Nothing Comes Of
 *
 * A smart link with real clicks over thirty days and no bookings or enquiries
 * behind any of them.
 *
 * This is the sharpest conversion finding the platform can make, and the only
 * one it can make with certainty. A page view and a booking are two separate
 * events joined by a guess; a smart-link click and the booking that followed it
 * share a session id, so "these forty people clicked and none of them booked"
 * is measured rather than inferred.
 *
 * ---------------------------------------------------------------------------
 * WHAT A FINDING HERE MEANS
 *
 * The link works — people are pressing it. So the loss is at the other end:
 * the destination is wrong, the price is a surprise, there are no times
 * available, or the page asks for more than a stranger will give. All of those
 * are fixable, and none of them is visible from the click count alone, which is
 * the number the owner currently sees.
 *
 * WHY IT CANNOT BE RETROACTIVE
 *
 * `smart_link_clicks.converted` is set by
 * `SmartLinkRepository.markConversion()`, which matches a booking back to its
 * click on `session_id`. Nothing called that method until the booking widget
 * was wired to send the id, so every click recorded before then reads as
 * unconverted whether it converted or not.
 *
 * Reporting those would tell every existing business its links convert nobody.
 * So the window starts at `ATTRIBUTION_LIVE_FROM`: clicks older than that are
 * not evidence of anything and are excluded from both halves of the ratio.
 * Move that date only if the attribution is rebuilt, never to widen a sample.
 * ---------------------------------------------------------------------------
 *
 * @see docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

const WINDOW_DAYS = 30;

/**
 * Clicks a link needs before "nobody converted" is a finding rather than a
 * small number.
 *
 * Twelve. Below that a link with no bookings is a link nobody has really tried
 * yet, and telling an owner their booking page is broken on the strength of
 * four clicks is worse than saying nothing.
 */
const MIN_CLICKS = 12;

/**
 * The day click-to-booking attribution started working.
 *
 * Before this `converted` was false on every row because nothing ever set it.
 * See the header: this is a correctness boundary, not a tuning knob.
 */
const ATTRIBUTION_LIVE_FROM = '2026-09-17T00:00:00.000Z';

interface LinkRow {
  id: string;
  code: string | null;
  name: string | null;
  destination_type: string | null;
  is_active: boolean | null;
}

interface ClickRow {
  smart_link_id: string | null;
  converted: boolean | null;
}

export class WebLinkNotConvertingDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'web_link_not_converting',
    name: 'A Link People Click And Nothing Comes Of',
    category: 'acquisition',
    description: 'Finds smart links with real clicks that produced no bookings or enquiries',

    watchedMetrics: ['acquisition.link_conversion_rate'],
    eventTypes: [],

    baselineWindow: 'month',
    thresholdType: 'absolute',
    threshold: 0,
    direction: 'below',
    minSamples: MIN_CLICKS,

    severityFn: (clicks: number, links: number): InsightSeverity => {
      // The clicks are the cost: people arrived and left. More arrivals wasted
      // is a bigger problem than more links.
      if (clicks >= 100) return 'high';
      if (clicks >= 40 || links >= 2) return 'medium';
      return 'low';
    },

    /*
     * No automation. What is wrong is at the destination — a price, a page, an
     * empty calendar — and none of it is fixed by sending an email.
     */
    pairedProcessId: undefined,
    ignoresVectorMaturity: false,

    consentTier: 'suggest',
    eligibleForAutomation: false,
    ownerParameters: [],
    guardrails: [],
    cooldownHours: 336,
  };

  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async evaluate(userId: string): Promise<DetectionResult | null> {
    if (await this.isOnCooldown(userId)) {
      this.logDetection(userId, null);
      return null;
    }

    const windowStart = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
    // Whichever is later: attribution has to have been working.
    const from = windowStart > ATTRIBUTION_LIVE_FROM ? windowStart : ATTRIBUTION_LIVE_FROM;

    const { data: linkData, error: linkError } = await this.supabase
      .from('smart_links')
      .select('id, code, name, destination_type, is_active')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (linkError) throw linkError;

    const links = (linkData ?? []) as unknown as LinkRow[];
    if (links.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    /*
     * Counted from the clicks, not from `smart_links.conversion_count`.
     *
     * That column is a convenience kept alongside the real rows, and it has
     * been wrong before — it was "incremented" by assigning a query builder to
     * it, which is not an increment. The clicks table is the source of truth;
     * a detector that reads the cached number inherits whatever last corrupted
     * it.
     *
     * `smart_link_clicks` carries no `user_id` — it hangs off the link — so the
     * scope comes from the link ids read above, which are this user's.
     */
    const { data: clickData, error: clickError } = await this.supabase
      .from('smart_link_clicks')
      .select('smart_link_id, converted')
      .in('smart_link_id', links.map(l => l.id))
      .gte('clicked_at', from);

    if (clickError) throw clickError;

    const clicks = (clickData ?? []) as unknown as ClickRow[];

    const byLink = new Map<string, { clicks: number; converted: number }>();
    for (const c of clicks) {
      if (!c.smart_link_id) continue;
      const entry = byLink.get(c.smart_link_id) ?? { clicks: 0, converted: 0 };
      entry.clicks += 1;
      if (c.converted) entry.converted += 1;
      byLink.set(c.smart_link_id, entry);
    }

    const failing = links
      .map(link => ({ link, ...(byLink.get(link.id) ?? { clicks: 0, converted: 0 }) }))
      .filter(entry => entry.clicks >= MIN_CLICKS && entry.converted === 0)
      .sort((a, b) => b.clicks - a.clicks);

    if (failing.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    const wastedClicks = failing.reduce((sum, f) => sum + f.clicks, 0);
    const severity = this.definition.severityFn(wastedClicks, failing.length);

    const result = this.createDetectionResult({
      severity,
      metricKey: 'acquisition.link_conversion_rate',
      currentValue: 0,
      baselineValue: wastedClicks,
      thresholdValue: MIN_CLICKS,
      /*
       * No percentage. There is no baseline to have changed from, and a
       * hardcoded 100 here would be narrated to the owner as "a 100% change" —
       * the fabricated statistic sixteen detectors were caught doing.
       */
      percentChange: 0,
      direction: 'below',
      affectedEntityType: 'page',
      affectedEntityIds: failing.map(f => f.link.id),
      affectedCount: failing.length,
      impactDirection: 'opportunity',
      impactPeriod: 'monthly',
      processParameters: {
        window_days: WINDOW_DAYS,
        wasted_clicks: wastedClicks,
        links: failing.slice(0, 5).map(f => ({
          code: f.link.code,
          name: f.link.name,
          type: f.link.destination_type,
          clicks: f.clicks,
        })),
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
