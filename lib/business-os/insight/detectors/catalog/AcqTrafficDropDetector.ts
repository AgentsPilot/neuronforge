/**
 * Acquisition Traffic Drop Detector
 *
 * Detects when website traffic drops significantly compared to previous period.
 * This is a percent_change detector comparing last 7 days vs previous 7 days.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

export class AcqTrafficDropDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'acq_traffic_drop',
    name: 'Traffic Drop',
    category: 'acquisition',
    description: 'Detects when website traffic drops 30%+ from previous week',

    watchedMetrics: ['acquisition.unique_visitors'],
    eventTypes: ['page.viewed'],

    baselineWindow: 'week',
    thresholdType: 'percent_change',
    threshold: 30, // 30% drop
    direction: 'below',
    minSamples: 1,

    severityFn: (percentDrop: number): InsightSeverity => {
      const absDrop = Math.abs(percentDrop);
      if (absDrop >= 50) return 'critical';
      if (absDrop >= 40) return 'high';
      if (absDrop >= 30) return 'medium';
      return 'low';
    },

    pairedProcessId: undefined, // Advisory only
    consentTier: 'observe',
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

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    // Get user's subdomain
    const { data: pages } = await this.supabase
      .from('website_pages')
      .select('subdomain')
      .eq('user_id', userId)
      .limit(1)
      .single();

    if (!pages?.subdomain) {
      this.logDetection(userId, null);
      return null;
    }

    const subdomain = pages.subdomain;

    // Get current week unique visitors (last 7 days)
    const { data: currentWeek, error: currentError } = await this.supabase
      .from('website_page_views')
      .select('ip_hash')
      .eq('subdomain', subdomain)
      .gte('viewed_at', weekAgo.toISOString())
      .lt('viewed_at', now.toISOString());

    if (currentError) {
      throw currentError;
    }

    // Get previous week unique visitors (7-14 days ago)
    const { data: previousWeek, error: previousError } = await this.supabase
      .from('website_page_views')
      .select('ip_hash')
      .eq('subdomain', subdomain)
      .gte('viewed_at', twoWeeksAgo.toISOString())
      .lt('viewed_at', weekAgo.toISOString());

    if (previousError) {
      throw previousError;
    }

    // Calculate unique visitors
    const currentUnique = new Set(currentWeek?.map((v) => v.ip_hash) || []).size;
    const previousUnique = new Set(previousWeek?.map((v) => v.ip_hash) || []).size;

    // Need baseline data to compare
    if (previousUnique === 0) {
      this.logDetection(userId, null);
      return null;
    }

    // Calculate percent change
    const percentChange = ((currentUnique - previousUnique) / previousUnique) * 100;

    // Only fire if traffic dropped by threshold or more
    if (percentChange >= -this.definition.threshold) {
      this.logDetection(userId, null);
      return null;
    }

    // Calculate severity based on drop magnitude
    const severity = this.definition.severityFn(percentChange, previousUnique);

    // Estimate impact: lost visitors × conversion rate × avg deal value
    const lostVisitors = previousUnique - currentUnique;
    const conversionRate = 0.02; // 2% form submission rate
    const avgDealValue = 300;
    const estimatedLoss = lostVisitors * conversionRate * avgDealValue;

    const result = this.createDetectionResult({
      severity,
      metricKey: 'acquisition.unique_visitors',
      currentValue: currentUnique,
      baselineValue: previousUnique,
      thresholdValue: previousUnique * (1 - this.definition.threshold / 100),
      percentChange: Math.round(percentChange),
      direction: 'below',
      affectedEntityType: 'session',
      affectedEntityIds: [],
      affectedCount: lostVisitors,
      estimatedImpactUsd: estimatedLoss,
      impactDirection: 'opportunity',
      impactPeriod: 'weekly',
      processParameters: {
        current_visitors: currentUnique,
        previous_visitors: previousUnique,
        drop_percent: Math.abs(Math.round(percentChange)),
        lost_visitors: lostVisitors,
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
