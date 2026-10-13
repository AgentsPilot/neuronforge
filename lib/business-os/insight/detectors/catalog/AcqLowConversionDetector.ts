/**
 * Acquisition Low Conversion Detector
 *
 * Detects when the share of website visitors who become leads falls below the
 * 2% benchmark.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT USED TO MEASURE FORMS, AND MOST OF THIS PLATFORM'S SITES DO NOT CONVERT
 * THROUGH A FORM.
 *
 * The numerator was `source = 'website_form'` alone, so a visitor who BOOKED
 * straight off the page counted as a visitor who did nothing. Three production
 * routes write `website_booking` — `/api/website/booking/create`, `/confirm`
 * and `/finalize` — against one that writes `website_form`, and booking is the
 * conversion the product is built around. A site converting perfectly well
 * through it read as converting nobody, and the benchmark then called that
 * critical, with a money figure attached, once a week forever.
 *
 * `quote_unwritten` in `lib/business-os/gaps/definitions.ts` was broken the same
 * way by the same column, and its note is worth reading: a source filter that
 * omits `website_booking` does not narrow a finding, it inverts it.
 *
 * The denominator was wrong in the other direction at the same time — it took
 * ONE arbitrary subdomain and counted the owner's own visits — so the rate was
 * not merely biased, it had no consistent sign. See `resolveUniqueVisitors`.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

/**
 * Every way arriving on the website turns into someone in the CRM.
 *
 * `website_booking` is the one that matters most and the one that was missing:
 * a visitor who booked is the strongest conversion the site can produce.
 *
 * `newsletter` is deliberately absent. A subscriber is not a lead — the contact
 * form route says so at length, having already been fixed once for filing one
 * as the other and chasing them for a message they never sent.
 */
export const WEBSITE_CONVERSION_SOURCES = [
  'website_booking',
  'website_form',
  'conversion_page',
  'website',
] as const;

export class AcqLowConversionDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'acq_low_conversion',
    name: 'Low Website Conversion',
    category: 'acquisition',
    description: 'Detects when website visitor-to-lead conversion is below 2%',

    watchedMetrics: ['acquisition.website_conversion_rate'],
    documentsEventTypes: ['form.submitted', 'page.viewed'],

    baselineWindow: 'week',
    thresholdType: 'absolute',
    threshold: 2, // 2% conversion rate benchmark
    direction: 'below',
    minSamples: 50, // Need at least 50 visitors for meaningful data

    severityFn: (conversionRate: number, visitorCount: number): InsightSeverity => {
      // More visitors + lower conversion = higher severity
      if (visitorCount >= 200 && conversionRate < 1) return 'critical';
      if (visitorCount >= 100 && conversionRate < 1.5) return 'high';
      if (visitorCount >= 50 && conversionRate < 2) return 'medium';
      return 'low';
    },

    /*

     * Advisory: nothing can run this yet.

     *

     * It used to name `review_website_forms`, a process that was never built — so the card

     * offered "handle it for me", the server answered 404 on the process, and the

     * insight was never marked acted. Whatever fixes this is a different KIND of

     * action from the four that exist, which all send a message.

     *

     * Declaring nothing is honest: the card shows the finding without a button

     * that cannot work.

     */
    eligibleForAutomation: false,
    cooldownHours: 168, // 1 week
  };

  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async evaluate(userId: string): Promise<DetectionResult | null> {
    // Check cooldown
    if (await this.isOnCooldown(userId)) {
      this.logDetection(userId, null);
      return null;
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    /*
     * THE DENOMINATOR, from the one place that counts visitors.
     *
     * This used to pick a single subdomain off `website_pages` with no ordering
     * and count that one's rows, so an account with two sites was judged on
     * whichever row came back first — while the numerator covered all of them.
     * It also counted the owner's own visits. Both are handled in
     * `resolveUniqueVisitors`, which every other visitor figure now shares.
     *
     * `null` means the read failed. Dividing by a traffic number we could not
     * establish is how a confident wrong percentage gets onto a card, so it
     * stops here instead.
     */
    const uniqueVisitors = await this.resolveUniqueVisitors(userId, 30);

    if (uniqueVisitors === null || uniqueVisitors < this.definition.minSamples) {
      this.logDetection(userId, null);
      return null;
    }

    /*
     * THE NUMERATOR: every way the website produces a lead, with the breakdown
     * kept rather than summed away.
     *
     * The breakdown is what makes the percentage answerable. "2% convert" sends
     * an owner to look at a form; "18 booked, 1 enquired" tells them the site
     * already works and where it works, which is a different action entirely.
     */
    const { data: converted, error: contactsError } = await this.supabase
      .from('crm_contacts')
      .select('source')
      .eq('user_id', userId)
      .in('source', WEBSITE_CONVERSION_SOURCES as unknown as string[])
      .gte('created_at', thirtyDaysAgo.toISOString())
      .limit(5000);

    if (contactsError) {
      throw contactsError;
    }

    const bySource: Record<string, number> = {};
    for (const row of converted || []) {
      const key = String((row as { source?: string | null }).source || 'unknown');
      bySource[key] = (bySource[key] || 0) + 1;
    }

    const conversions = converted?.length || 0;

    // Calculate conversion rate
    const conversionRate = (conversions / uniqueVisitors) * 100;

    // Only fire if below benchmark
    if (conversionRate >= this.definition.threshold) {
      this.logDetection(userId, null);
      return null;
    }

    // Calculate severity
    const severity = this.definition.severityFn(conversionRate, uniqueVisitors);

    /*
     * How many leads the benchmark implies were missed.
     *
     * Floored, so just under the threshold can round to the same integer the
     * site already achieved: 51 visitors with 1 lead is 1.96%, and 2% of 51
     * floors to 1. That fired a card reporting nothing missed, with a severity
     * on it. Nothing missed is nothing to say.
     */
    const expectedConversions = Math.floor(uniqueVisitors * (this.definition.threshold / 100));
    const missedSubmissions = expectedConversions - conversions;

    if (missedSubmissions < 1) {
      this.logDetection(userId, null);
      return null;
    }
    // This business's own figure, not a constant — see BaseDetector.
    const avgDealValue = await this.resolveAverageDealValue(userId);
    // This business's own rate, from who has actually paid it — null when
    // there is too little history to divide. See BaseDetector.
    const conversionToClient = await this.resolveLeadConversionRate(userId);
    const estimatedLoss =
      avgDealValue === null || conversionToClient === null
        ? undefined
        : missedSubmissions * avgDealValue * conversionToClient;

    const result = this.createDetectionResult({
      severity,
      metricKey: 'acquisition.website_conversion_rate',
      currentValue: Math.round(conversionRate * 100) / 100, // Round to 2 decimals
      baselineValue: this.definition.threshold,
      thresholdValue: this.definition.threshold,
      percentChange: Math.round(((conversionRate - this.definition.threshold) / this.definition.threshold) * 100),
      direction: 'below',
      affectedEntityType: 'session',
      affectedEntityIds: [],
      affectedCount: missedSubmissions,
      estimatedImpactUsd: estimatedLoss,
      impactDirection: 'opportunity',
      impactPeriod: 'monthly',
      processParameters: {
        conversion_rate: Math.round(conversionRate * 100) / 100,
        benchmark_rate: this.definition.threshold,
        unique_visitors: uniqueVisitors,
        conversions,
        /* Which routes actually produced them, so the figure can be read rather
           than just believed. */
        conversions_by_source: bySource,
        missed_submissions: missedSubmissions,
        /* `form_submissions` kept under its old name: consumers of a stored
           insight's parameters read it, and it now means what it says — forms
           only — rather than standing in for every conversion. */
        form_submissions: bySource['website_form'] || 0,
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
