/**
 * Sales Stalled Detector
 *
 * Detects enquiries that have been waiting 48+ hours without a reply.
 * This is an absolute threshold detector.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md Section 3
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

    pairedProcessId: 'send_followup_nudge',
    consentTier: 'automate',
    eligibleForAutomation: true,
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

    // Find enquiries without replies for 48+ hours
    const delayHours = 48;
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - delayHours);

    // Get enquiries received before cutoff
    const { data: enquiries, error } = await this.supabase
      .from('business_events')
      .select('entity_id, contact_id, created_at')
      .eq('user_id', userId)
      .eq('event_type', 'enquiry.received')
      .lt('created_at', cutoffDate.toISOString());

    if (error) {
      throw error;
    }

    if (!enquiries || enquiries.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    // Get enquiries that have been replied to
    const { data: replied } = await this.supabase
      .from('business_events')
      .select('entity_id')
      .eq('user_id', userId)
      .eq('event_type', 'enquiry.replied');

    const repliedIds = new Set(replied?.map((r) => r.entity_id) || []);

    // Filter to stalled enquiries (received but not replied)
    const stalledEnquiries = enquiries.filter((e) => !repliedIds.has(e.entity_id));

    if (stalledEnquiries.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    // Calculate severity
    const severity = this.definition.severityFn(stalledEnquiries.length, 0);

    // Estimate potential revenue (assume conversion rate and avg deal value)
    const avgDealValue = 500; // Default assumption
    const conversionRate = 0.2; // 20% conversion
    const estimatedLoss = stalledEnquiries.length * avgDealValue * conversionRate;

    const result = this.createDetectionResult({
      severity,
      metricKey: 'sales.stalled_enquiries',
      currentValue: stalledEnquiries.length,
      baselineValue: 0,
      thresholdValue: 1, // Any stalled enquiry is a problem
      percentChange: 100,
      direction: 'above',
      affectedEntityType: 'enquiry',
      affectedEntityIds: stalledEnquiries.map((e) => e.entity_id),
      affectedCount: stalledEnquiries.length,
      estimatedImpactUsd: estimatedLoss,
      impactDirection: 'opportunity',
      impactPeriod: 'weekly',
      processParameters: {
        delay_hours: delayHours,
        enquiry_ids: stalledEnquiries.map((e) => e.entity_id),
        contact_ids: stalledEnquiries.map((e) => e.contact_id).filter(Boolean),
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
