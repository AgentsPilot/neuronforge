/**
 * Operations Utilization Low Detector
 *
 * Detects when calendar utilization is below 50%.
 * This is an absolute threshold detector (advisory only, no automation).
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md Section 3
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';
import { BusinessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';

/**
 * Weekly availability JSONB shape stored on `business_profiles.scheduling_availability`
 * (e.g. `{ "monday": [{ "start": "09:00", "end": "17:00" }], ... }`). Declared locally
 * because the field is absent from the generated Database type (M2).
 */
export type WeeklyAvailability = Record<string, { start: string; end: string }[]>;

const DEFAULT_AVAILABLE_HOURS_PER_WEEK = 40;

/**
 * Parse an `HH:MM` string into fractional hours. Returns null for anything malformed.
 */
function parseTimeToHours(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours + minutes / 60;
}

/**
 * Sum configured available hours across a weekly availability object.
 * Falls back to 40h when the object is empty `{}` / missing / malformed (M3).
 */
export function calculateAvailableHours(
  availability: WeeklyAvailability | null | undefined
): number {
  if (!availability || typeof availability !== 'object') {
    return DEFAULT_AVAILABLE_HOURS_PER_WEEK;
  }

  let totalHours = 0;
  let hasValidInterval = false;

  for (const intervals of Object.values(availability)) {
    if (!Array.isArray(intervals)) continue;
    for (const interval of intervals) {
      const start = parseTimeToHours(interval?.start);
      const end = parseTimeToHours(interval?.end);
      if (start === null || end === null || end <= start) continue;
      totalHours += end - start;
      hasValidInterval = true;
    }
  }

  return hasValidInterval ? totalHours : DEFAULT_AVAILABLE_HOURS_PER_WEEK;
}

export class OpsUtilizationLowDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'ops_utilization_low',
    name: 'Low Calendar Utilization',
    category: 'operations',
    description: 'Detects when calendar utilization is below 50%',

    watchedMetrics: ['operations.calendar_utilization'],
    eventTypes: ['calendar.utilization_low'],

    baselineWindow: 'month',
    thresholdType: 'absolute',
    threshold: 50, // 50% utilization
    direction: 'below',
    minSamples: 28, // 4 weeks of data

    severityFn: (utilization: number): InsightSeverity => {
      if (utilization <= 20) return 'critical';
      if (utilization <= 30) return 'high';
      if (utilization <= 40) return 'medium';
      return 'low';
    },

    // No paired process - this is advisory only
    pairedProcessId: undefined,
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

    // Get current utilization
    const latest = await this.getLatestMetricValue(userId, 'operations.calendar_utilization');

    if (!latest) {
      this.logDetection(userId, null);
      return null;
    }

    const currentValue = latest.value;
    const threshold = this.definition.threshold;

    // Check if below threshold
    if (currentValue >= threshold) {
      this.logDetection(userId, null);
      return null;
    }

    // Get baseline for context.
    // calendar_utilization is stored at weekly/monthly granularity; 'weekly' is the
    // finest supported period and matches this detector's weekly impact framing.
    const baseline = await this.baselineCalculator.computeBaseline(
      userId,
      'operations.calendar_utilization',
      'weekly',
      this.getBaselineLookbackDays()
    );

    // Not enough data - but we can still surface the insight
    const baselineMean = baseline.isSignificant ? baseline.mean : 50;

    // Calculate severity
    const severity = this.definition.severityFn(currentValue, 0);

    // Estimate lost revenue opportunity
    // Assumption: each unfilled hour could generate avg booking revenue
    const { data: avgBooking } = await this.supabase
      .from('business_events')
      .select('value_usd')
      .eq('user_id', userId)
      .eq('event_type', 'booking.completed')
      .not('value_usd', 'is', null)
      .limit(100);

    const avgBookingValue = avgBooking && avgBooking.length > 0
      ? avgBooking.reduce((sum, b) => sum + parseFloat(b.value_usd || '0'), 0) / avgBooking.length
      : 75;

    // Get available hours per week from the business profile's weekly availability.
    // (scheduling_availability is a JSONB column on business_profiles, not a table.)
    const profileRepo = new BusinessProfileRepository(this.supabase);
    const { data: profile } = await profileRepo.findByUserId(userId);

    // M2: field is absent from the generated Database type — read via a narrow shape, not `any`.
    const weeklyAvailability =
      (profile as { scheduling_availability?: WeeklyAvailability } | null)
        ?.scheduling_availability;

    const availableHoursPerWeek = calculateAvailableHours(weeklyAvailability);

    // Calculate unfilled hours
    const filledPercent = currentValue / 100;
    const unfilledHours = availableHoursPerWeek * (1 - filledPercent);
    const estimatedOpportunity = unfilledHours * avgBookingValue;

    // getPercentChange returns { percentChange: number | null, baseline }; coalesce the
    // null case (insignificant/zero baseline) to 0 since DetectionResult.percentChange is number.
    const { percentChange: computedPercentChange } = await this.baselineCalculator.getPercentChange(
      userId,
      'operations.calendar_utilization',
      'weekly',
      currentValue,
      this.getBaselineLookbackDays()
    );
    const percentChange = computedPercentChange ?? 0;

    const result = this.createDetectionResult({
      severity,
      metricKey: 'operations.calendar_utilization',
      currentValue,
      baselineValue: baselineMean,
      thresholdValue: threshold,
      percentChange,
      direction: 'below',
      affectedCount: Math.round(unfilledHours),
      estimatedImpactUsd: estimatedOpportunity,
      impactDirection: 'opportunity',
      impactPeriod: 'weekly',
      processParameters: {},
    });

    this.logDetection(userId, result);
    return result;
  }
}
