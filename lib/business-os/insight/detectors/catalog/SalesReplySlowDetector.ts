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

    pairedProcessId: 'draft_reply_templates',
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
    // Check cooldown
    if (await this.isOnCooldown(userId)) {
      this.logDetection(userId, null);
      return null;
    }

    // Get baseline for reply time
    const baseline = await this.baselineCalculator.computeBaseline(
      userId,
      'sales.avg_reply_time_hours',
      this.getBaselineLookbackDays(),
      this.definition.minSamples
    );

    // Not enough data
    if (!baseline.isSignificant) {
      this.logDetection(userId, null);
      return null;
    }

    // Get current reply time (last week)
    const latest = await this.getLatestMetricValue(userId, 'sales.avg_reply_time_hours');

    if (!latest) {
      this.logDetection(userId, null);
      return null;
    }

    const currentValue = latest.value;

    // Check if above threshold (baseline + 2 * stdDev)
    const threshold = baseline.threshold;

    if (currentValue <= threshold) {
      this.logDetection(userId, null);
      return null;
    }

    // Calculate delta and severity
    const percentChange = this.baselineCalculator.getPercentChange(currentValue, baseline.mean);
    const severity = this.definition.severityFn(currentValue, baseline.mean);

    // Estimate impact - slower replies mean lower conversion
    // Assumption: every hour of delay reduces conversion by 1%
    const extraHours = currentValue - baseline.mean;
    const conversionDropPercent = Math.min(extraHours * 1, 50); // Cap at 50%

    // Get recent enquiry count to estimate impact
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const { count } = await this.supabase
      .from('business_events')
      .select('id', { count: 'exact' })
      .eq('user_id', userId)
      .eq('event_type', 'enquiry.received')
      .gte('created_at', weekAgo.toISOString());

    const avgDealValue = 500;
    const baseConversionRate = 0.2;
    const enquiryCount = count || 0;
    const estimatedLoss = enquiryCount * avgDealValue * baseConversionRate * (conversionDropPercent / 100);

    const result = this.createDetectionResult({
      severity,
      metricKey: 'sales.avg_reply_time_hours',
      currentValue,
      baselineValue: baseline.mean,
      thresholdValue: threshold,
      percentChange,
      direction: 'above',
      affectedCount: enquiryCount,
      estimatedImpactUsd: estimatedLoss,
      impactDirection: 'opportunity',
      impactPeriod: 'weekly',
      processParameters: {},
    });

    this.logDetection(userId, result);
    return result;
  }
}
