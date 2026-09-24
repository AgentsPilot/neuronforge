/**
 * Sales Reply Slow Detector
 *
 * Detects when reply time to enquiries is slower than baseline (2+ std dev).
 * This is a baseline-relative detector.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md Section 3
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

export class SalesReplySlowDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'sales_reply_slow',
    name: 'Slow Reply Times',
    category: 'sales',
    description: 'Detects when reply time is slower than baseline',

    watchedMetrics: ['sales.avg_reply_time_hours'],
    eventTypes: ['enquiry.replied'],

    baselineWindow: 'month',
    thresholdType: 'std_deviation',
    threshold: 2, // 2 standard deviations
    direction: 'above',
    minSamples: 14, // 2 weeks of data

    severityFn: (replyTimeHours: number, baseline: number): InsightSeverity => {
      const percentIncrease = baseline > 0 ? ((replyTimeHours - baseline) / baseline) * 100 : 100;
      if (percentIncrease >= 100 || replyTimeHours >= 72) return 'critical';
      if (percentIncrease >= 50 || replyTimeHours >= 48) return 'high';
      if (percentIncrease >= 25 || replyTimeHours >= 24) return 'medium';
      return 'low';
    },

    /*
     * Advisory. There is no process that can reply faster on the owner's
     * behalf.
     *
     * This named `draft_reply_templates`, which renders "Handle it for me" —
     * and that process is deliberately absent from `PROCESS_EFFECTS`, because
     * drafting a template sends nothing. So the enqueuer answered "no send
     * effect" and the owner got a 400 from a button the card had offered them.
     *
     * Replying sooner is something a person does. The finding is worth stating;
     * the button was not.
     */
    pairedProcessId: undefined,
    consentTier: 'suggest', // Not automatable - just advice
    eligibleForAutomation: false,
    ownerParameters: [],
    guardrails: [],
    cooldownHours: 168, // 1 week
  };

  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async evaluate(userId: string): Promise<DetectionResult | null> {
    if (await this.isOnCooldown(userId)) {
      this.logDetection(userId, null);
      return null;
    }

    const now = Date.now();
    const from = new Date(now - WINDOW_DAYS * 86_400_000).toISOString();

    /*
     * Measured from the CRM, not from the event rail.
     *
     * This used to count `enquiry.received` in `business_events`, which nothing
     * writes, so it could never fire. The same fact is in two tables that are
     * written on every enquiry: when the contact was created, and when the
     * business first reached back out to them.
     */
    const [contactResult, activityResult] = await Promise.all([
      this.supabase
        .from('crm_contacts')
        .select('id, created_at')
        .eq('user_id', userId)
        .gte('created_at', from),
      this.supabase
        .from('crm_activities')
        .select('contact_id, activity_type, activity_date')
        .eq('user_id', userId)
        .in('activity_type', [...OUTBOUND])
        .gte('activity_date', from),
    ]);

    if (contactResult.error) throw contactResult.error;
    if (activityResult.error) throw activityResult.error;

    const contacts = (contactResult.data ?? []) as unknown as ContactRow[];
    const activities = (activityResult.data ?? []) as unknown as ActivityRow[];

    // The first time each person heard back.
    const firstTouch = new Map<string, string>();
    for (const a of activities) {
      if (!a.contact_id || !a.activity_date) continue;
      const seen = firstTouch.get(a.contact_id);
      if (!seen || a.activity_date < seen) firstTouch.set(a.contact_id, a.activity_date);
    }

    /*
     * Automated replies COUNT, deliberately.
     *
     * From the client's side an automatic booking link arriving in ninety
     * seconds is a reply — they asked, and they heard back. A business that has
     * autosend on genuinely does respond quickly, and excluding that would
     * punish it for the thing that makes it fast. A business without autosend
     * is measured on the replies it actually sends, which is equally fair.
     *
     * What is excluded is everything not addressed to the client: a stage
     * change, a note-to-self, an uploaded document. Those record the owner
     * thinking, not the client being answered.
     */
    const hours: number[] = [];
    let unanswered = 0;

    for (const c of contacts) {
      const replied = firstTouch.get(c.id);
      if (!replied) {
        unanswered += 1;
        continue;
      }
      const gap = (Date.parse(replied) - Date.parse(c.created_at)) / 3_600_000;
      // A reply logged before the contact existed is a clock or import
      // artefact, not a negative reply time.
      if (gap >= 0) hours.push(gap);
    }

    if (hours.length < MIN_REPLIES) {
      this.logDetection(userId, null);
      return null;
    }

    /*
     * The median, not the mean.
     *
     * One enquiry answered three weeks late drags an average past any threshold
     * and makes a business that replies within the hour look slow. The median
     * says what usually happens, which is what the owner is being told about.
     */
    const sorted = [...hours].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const typicalHours = Math.round(median * 10) / 10;

    if (typicalHours < SLOW_THRESHOLD_HOURS) {
      this.logDetection(userId, null);
      return null;
    }

    const severity = this.definition.severityFn(typicalHours, SLOW_THRESHOLD_HOURS);

    const result = this.createDetectionResult({
      severity,
      metricKey: 'sales.avg_reply_time_hours',
      currentValue: typicalHours,
      baselineValue: SLOW_THRESHOLD_HOURS,
      thresholdValue: SLOW_THRESHOLD_HOURS,
      percentChange: Math.round(((typicalHours - SLOW_THRESHOLD_HOURS) / SLOW_THRESHOLD_HOURS) * 100),
      direction: 'above',
      affectedEntityType: 'contact',
      affectedEntityIds: [],
      affectedCount: hours.length,
      impactDirection: 'opportunity',
      impactPeriod: 'monthly',
      processParameters: {
        window_days: WINDOW_DAYS,
        typical_reply_hours: typicalHours,
        enquiries_answered: hours.length,
        enquiries_unanswered: unanswered,
        fastest_hours: Math.round(sorted[0] * 10) / 10,
        slowest_hours: Math.round(sorted[sorted.length - 1] * 10) / 10,
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}

/**
 * Activities that mean the client heard from the business.
 *
 * Everything here is addressed OUTWARD. `stage_changed`, `note`,
 * `document_uploaded` and `contact_updated` are deliberately absent: they are
 * the owner working, not the client being answered.
 */
const OUTBOUND = new Set([
  'email',
  'booking_link_sent',
  'booking_confirmation_sent',
  'proposal_sent',
  'invoice_sent',
]);

const WINDOW_DAYS = 30;
/** Answered enquiries needed before a median means anything. */
const MIN_REPLIES = 5;
/** Above this, a typical reply is worth telling the owner about. */
const SLOW_THRESHOLD_HOURS = 24;

interface ContactRow {
  id: string;
  created_at: string;
}

interface ActivityRow {
  contact_id: string | null;
  activity_type: string | null;
  activity_date: string | null;
}
