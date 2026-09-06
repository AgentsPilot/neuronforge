/**
 * Ops Peak Hours Unutilized Detector
 *
 * Detects when historically popular time slots are going unfilled.
 * Helps identify scheduling/marketing gaps.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

interface TimeSlotStats {
  dayOfWeek: number;
  hour: number;
  historicalBookings: number;
  recentBookings: number;
  utilization: number;
}

export class OpsPeakUnutilizedDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'ops_peak_unutilized',
    name: 'Peak Hours Unutilized',
    category: 'operations',
    description: 'Detects historically busy time slots going unfilled',

    watchedMetrics: ['operations.peak_utilization'],
    eventTypes: ['booking.created', 'booking.cancelled'],

    baselineWindow: 'month',
    thresholdType: 'percent_change',
    threshold: 50, // <50% utilization during peak hours
    direction: 'below',
    minSamples: 20, // Need at least 20 historical bookings

    severityFn: (utilizationDrop: number, missedSlots: number): InsightSeverity => {
      if (utilizationDrop >= 70 || missedSlots >= 10) return 'critical';
      if (utilizationDrop >= 50 || missedSlots >= 5) return 'high';
      if (utilizationDrop >= 30) return 'medium';
      return 'low';
    },

    pairedProcessId: 'send_availability_blast',
    consentTier: 'automate',
    eligibleForAutomation: true,
    ownerParameters: [
      {
        id: 'target_contacts',
        label: 'Target Contacts',
        type: 'select',
        default: 'recent_clients',
        options: [
          { value: 'recent_clients', label: 'Recent Clients' },
          { value: 'all_contacts', label: 'All Contacts' },
          { value: 'engaged_leads', label: 'Engaged Leads' },
        ],
      },
    ],
    guardrails: [],
    cooldownHours: 72, // 3 days
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
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    // Get historical bookings (30-60 days ago) to establish baseline
    const { data: historicalBookings, error: histError } = await this.supabase
      .from('scheduling_bookings')
      .select('start_time, status')
      .eq('user_id', userId)
      .gte('start_time', sixtyDaysAgo.toISOString())
      .lt('start_time', thirtyDaysAgo.toISOString())
      .in('status', ['confirmed', 'completed']);

    if (histError) {
      throw histError;
    }

    if (!historicalBookings || historicalBookings.length < this.definition.minSamples) {
      this.logDetection(userId, null);
      return null;
    }

    // Get recent bookings (last 30 days)
    const { data: recentBookings, error: recentError } = await this.supabase
      .from('scheduling_bookings')
      .select('start_time, status')
      .eq('user_id', userId)
      .gte('start_time', thirtyDaysAgo.toISOString())
      .in('status', ['confirmed', 'completed']);

    if (recentError) {
      throw recentError;
    }

    // Build time slot frequency maps
    const historicalSlots: Record<string, number> = {};
    const recentSlots: Record<string, number> = {};

    historicalBookings.forEach((booking) => {
      const date = new Date(booking.start_time);
      const key = `${date.getDay()}-${date.getHours()}`;
      historicalSlots[key] = (historicalSlots[key] || 0) + 1;
    });

    recentBookings?.forEach((booking) => {
      const date = new Date(booking.start_time);
      const key = `${date.getDay()}-${date.getHours()}`;
      recentSlots[key] = (recentSlots[key] || 0) + 1;
    });

    // Identify peak slots (slots with above-average historical bookings)
    const avgHistorical =
      Object.values(historicalSlots).reduce((a, b) => a + b, 0) /
      Math.max(Object.keys(historicalSlots).length, 1);

    const peakSlots = Object.entries(historicalSlots)
      .filter(([, count]) => count >= avgHistorical)
      .map(([key, historicalCount]) => {
        const [day, hour] = key.split('-').map(Number);
        const recentCount = recentSlots[key] || 0;
        const utilization = historicalCount > 0 ? (recentCount / historicalCount) * 100 : 0;

        return {
          dayOfWeek: day,
          hour,
          historicalBookings: historicalCount,
          recentBookings: recentCount,
          utilization: Math.round(utilization),
        } as TimeSlotStats;
      });

    // Find underutilized peak slots (<50% of historical)
    const underutilized = peakSlots.filter(
      (slot) => slot.utilization < this.definition.threshold
    );

    if (underutilized.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    // Calculate average utilization drop
    const avgUtilization =
      underutilized.reduce((sum, s) => sum + s.utilization, 0) / underutilized.length;
    const utilizationDrop = 100 - avgUtilization;

    // Calculate severity
    const severity = this.definition.severityFn(utilizationDrop, underutilized.length);

    // Get average booking value
    const { data: avgValue } = await this.supabase
      .from('scheduling_bookings')
      .select('price')
      .eq('user_id', userId)
      .gte('start_time', thirtyDaysAgo.toISOString())
      .in('status', ['completed']);

    const avgBookingValue =
      avgValue && avgValue.length > 0
        ? avgValue.reduce((sum, b) => sum + parseFloat(b.price || '0'), 0) / avgValue.length
        : 75; // Default estimate

    // Calculate missed revenue
    const missedBookings = underutilized.reduce(
      (sum, slot) => sum + (slot.historicalBookings - slot.recentBookings),
      0
    );
    const missedRevenue = missedBookings * avgBookingValue;

    // Day names for display
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    const result = this.createDetectionResult({
      severity,
      metricKey: 'operations.peak_utilization',
      currentValue: Math.round(avgUtilization),
      baselineValue: 100,
      thresholdValue: this.definition.threshold,
      percentChange: -utilizationDrop,
      direction: 'below',
      affectedEntityType: 'time_slot',
      affectedEntityIds: underutilized.map((s) => `${s.dayOfWeek}-${s.hour}`),
      affectedCount: underutilized.length,
      estimatedImpactUsd: Math.round(missedRevenue),
      impactDirection: 'loss',
      impactPeriod: 'monthly',
      processParameters: {
        target_contacts: 'recent_clients',
        avg_utilization: Math.round(avgUtilization),
        utilization_drop: Math.round(utilizationDrop),
        missed_bookings: missedBookings,
        avg_booking_value: Math.round(avgBookingValue),
        underutilized_slots: underutilized.map((slot) => ({
          day: dayNames[slot.dayOfWeek],
          hour: slot.hour,
          time_display: `${dayNames[slot.dayOfWeek]} ${slot.hour}:00-${slot.hour + 1}:00`,
          historical_bookings: slot.historicalBookings,
          recent_bookings: slot.recentBookings,
          utilization: slot.utilization,
        })),
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
