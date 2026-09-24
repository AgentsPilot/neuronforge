/**
 * People who got in touch 48+ hours ago and have had no reply.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS DETECTOR WAS DEAD, AND NOBODY COULD TELL
 *
 * It read `business_events` for `enquiry.received` and `enquiry.replied` — a
 * table with no producers anywhere in the codebase. So it returned null for
 * every business every night, silently, for as long as it has existed. It now
 * reads `crm_contacts` and `crm_activities`, which are the tables that actually
 * hold this, the same fix `CrmColdLeadsDetector` already embodies.
 *
 * IT CANNOT ACT, AND SAYS SO BY CARRYING NO ACTION
 *
 * `pairedProcessId` is gone and `eligibleForAutomation` is false, because
 * `KernelTrigger.executeProcess()` throws by design — so "Run this for me"
 * would have failed on press. `InsightDetailModal` gates both buttons on those
 * two fields, so removing them means no dead button is ever rendered. Snooze
 * and Dismiss remain, which is right for a backlog notice. Acting on these
 * people happens on the dashboard's enquiries card, which genuinely works.
 *
 * WHAT IT IS FOR, NOW THAT THE ALERT EXISTS
 *
 * The owner is emailed within seconds of each enquiry and the card shows who is
 * waiting. This answers the slower question those two cannot: you have a
 * BACKLOG. Which is why a daily cadence is right for it and wrong for them.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';
import { COMMON_GUARDRAILS } from '../types';

export class SalesStalledDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'sales_stalled',
    name: 'Stalled Enquiries',
    category: 'sales',
    description: 'Detects enquiries waiting 48+ hours without a reply',

    watchedMetrics: ['sales.stalled_enquiries'],
    eventTypes: ['enquiry.stalled'],

    baselineWindow: 'week', // Not used for absolute threshold
    thresholdType: 'absolute',
    threshold: 48, // 48 hours
    direction: 'above',
    minSamples: 1,

    severityFn: (stalledCount: number): InsightSeverity => {
      if (stalledCount >= 10) return 'critical';
      if (stalledCount >= 5) return 'high';
      if (stalledCount >= 2) return 'medium';
      return 'low';
    },

    /*
     * No paired process and not automatable, deliberately — see the header.
     * The kernel refuses every action today, and an insight that offers a
     * button which throws is worse than one that offers none.
     */
    consentTier: 'suggest',
    eligibleForAutomation: false,

    /*
     * Say this even to a business the maturity gate would silence.
     *
     * The gate exists so a COMPARATIVE detector is not asked to reason from a
     * baseline it does not have. This is an absolute count of people who wrote
     * to this business and got nothing back — true and worth saying on day one,
     * and the businesses it would silence are precisely the small ones that can
     * least afford to lose an enquiry.
     */
    ignoresVectorMaturity: true,
    ownerParameters: [
      {
        id: 'delay_hours',
        label: 'Delay Hours',
        type: 'number',
        default: 48,
        min: 24,
        max: 168,
      },
    ],
    guardrails: [COMMON_GUARDRAILS.max_1_per_contact_per_48h],
    cooldownHours: 24,
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

    // People who got in touch more than 48 hours ago and have heard nothing.
    const delayHours = 48;
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - delayHours);

    /*
     * `crm_contacts`, not `business_events`.
     *
     * A contact whose `source` says they arrived through a form IS an enquiry;
     * the event rail was a second, empty record of the same fact.
     */
    const { data: enquiries, error } = await this.supabase
      .from('crm_contacts')
      .select('id, created_at')
      .eq('user_id', userId)
      .in('source', ['website_form', 'conversion_page'])
      .lt('created_at', cutoffDate.toISOString());

    if (error) {
      throw error;
    }

    if (!enquiries || enquiries.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    const contactIds = enquiries.map(e => e.id);

    /*
     * Answered, by any route.
     *
     * A booking link sent through the dashboard, its chase, or a booking they
     * made themselves. Each means somebody is no longer waiting, and counting
     * them would tell the owner off for work they have already done.
     */
    const [repliedResult, bookedResult] = await Promise.all([
      this.supabase
        .from('crm_activities')
        .select('contact_id')
        .eq('user_id', userId)
        .in('contact_id', contactIds)
        .in('activity_type', ['booking_link_sent', 'booking_link_chase']),
      this.supabase
        .from('scheduling_bookings')
        .select('contact_id')
        .eq('user_id', userId)
        .in('contact_id', contactIds),
    ]);

    const answered = new Set<string>([
      ...(repliedResult.data || []).map((r: { contact_id: string }) => r.contact_id),
      ...(bookedResult.data || []).map((r: { contact_id: string }) => r.contact_id),
    ]);

    const stalledEnquiries = enquiries.filter(e => !answered.has(e.id));

    if (stalledEnquiries.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    // Calculate severity
    const severity = this.definition.severityFn(stalledEnquiries.length, 0);

    /*
     * No money figure.
     *
     * This multiplied the count by a hardcoded £500 deal and a hardcoded 20%
     * conversion rate and reported the product as `estimated_impact_usd` —
     * a number with nothing behind it, shown to the owner as if it were theirs.
     * That is exactly the fabricated-revenue problem the kernel's own comment
     * was written about. Better to say how many people are waiting and let that
     * speak.
     */

    const result = this.createDetectionResult({
      severity,
      metricKey: 'sales.stalled_enquiries',
      currentValue: stalledEnquiries.length,
      baselineValue: 0,
      thresholdValue: 1, // Any stalled enquiry is a problem
      /*
       * Nothing changed by a hundred per cent.
       *
       * This detector counts: there is no baseline to have moved from, and a
       * hardcoded 100 reached the narrator as a real measurement. It produced
       * sentences like "a 100% increase in risk compared to your usual client
       * retention" and "a 100% increase in your expected cash flow" — arithmetic
       * presented as a trend, about a base of zero.
       *
       * `hasRealBaseline` now keeps the figure out of the prompt, but that guard
       * reads `baselineValue`, so it is the second line of defence. This is the
       * first: a count reports no change, because none was measured.
       */
      percentChange: 0,
      direction: 'above',
      // Contact ids, so existing insight UI resolves them against `crm_contacts`.
      affectedEntityType: 'contact',
      affectedEntityIds: stalledEnquiries.map(e => e.id),
      affectedCount: stalledEnquiries.length,
      impactDirection: 'opportunity',
      impactPeriod: 'weekly',
      processParameters: {
        delay_hours: delayHours,
        contact_ids: stalledEnquiries.map(e => e.id),
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
