/**
 * Ops Peak Hours Unutilized Detector
 *
 * Detects when historically popular time slots are going unfilled.
 * Helps identify scheduling/marketing gaps.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { appointmentDetailsBetween, occupiesItsHour } from '@/lib/scheduling/appointmentFacts';
import { BaseDetector } from './BaseDetector';
import { createLogger } from '@/lib/logger';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';
import { MEETING_HOLDS_SLOT_FILTER } from '@/lib/business-os/bookingStatus';

const logger = createLogger({ module: 'OpsPeakUnutilizedDetector' });

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
    documentsEventTypes: ['booking.created', 'booking.cancelled'],

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

    /*

     * Advisory: nothing can run this yet.

     *

     * It used to name `send_availability_blast`, a process that was never built — so the card

     * offered "handle it for me", the server answered 404 on the process, and the

     * insight was never marked acted. Whatever fixes this is a different KIND of

     * action from the four that exist, which all send a message.

     *

     * Declaring nothing is honest: the card shows the finding without a button

     * that cannot work.

     */
    eligibleForAutomation: false,
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
    /*
     * ───────────────────────────────────────────────────────────────────────
     * BOTH WINDOWS COUNT APPOINTMENTS, NOT JOBS.
     *
     * These read `scheduling_bookings` ranged on `start_time`, which a job
     * whose hours live on its sessions does not have — NULL never satisfies
     * `gte`, so a package's sessions were absent from both windows. This
     * detector compares one window against the other to find a peak hour that
     * has gone quiet, so a blind spot in both does not cancel out: it moves
     * whichever window held more of them.
     *
     * The outcome rule is the one `MEETING_HOLDS_SLOT_FILTER` applied: an hour
     * counts while nobody has said it did not happen.
     * ───────────────────────────────────────────────────────────────────────
     */
    const occupied = (rows: Awaited<ReturnType<typeof appointmentDetailsBetween>>) =>
      rows
        .filter(occupiesItsHour)
        .map(a => ({ start_time: a.startTime, status: a.status }));

    const historicalBookings = occupied(
      await appointmentDetailsBetween(
        this.supabase,
        userId,
        sixtyDaysAgo.toISOString(),
        thirtyDaysAgo.toISOString()
      )
    );

    if (!historicalBookings || historicalBookings.length < this.definition.minSamples) {
      this.logDetection(userId, null);
      return null;
    }

    // Get recent bookings (last 30 days)
    /* The recent window, counted the same way as the historical one above. */
    const recentBookings = occupied(
      await appointmentDetailsBetween(this.supabase, userId, thirtyDaysAgo.toISOString())
    );

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

    /*
     * Average booking value, for the missed-revenue figure below.
     *
     * `scheduling_bookings.price` does not exist and never has, so this select
     * was rejected whole by PostgREST, the error was discarded with the rest of
     * the destructured result, and every run fell through to the $75 default —
     * which then reported a hardcoded number to the owner as their own average.
     * The price lives in two real places: what was actually charged against the
     * booking, and failing that what the service costs.
     */
    /*
     * ───────────────────────────────────────────────────────────────────────
     * WHAT A HELD APPOINTMENT IS WORTH, over the appointments that were held.
     *
     * This read `scheduling_bookings` ranged on `start_time` with
     * `meeting_status = 'held'`. Both halves missed a package: the job has no
     * `start_time`, and `held` is written on the SESSION, not on the job. So
     * the average that prices "missed revenue" was taken from single-session
     * bookings only — on a business selling packages, from almost nothing.
     *
     * The appointments carry the amount their job charged. Where that is empty
     * the service's list price stands in, exactly as before, which is the one
     * extra read below.
     * ───────────────────────────────────────────────────────────────────────
     */
    let held: Awaited<ReturnType<typeof appointmentDetailsBetween>> = [];
    try {
      held = (
        await appointmentDetailsBetween(this.supabase, userId, thirtyDaysAgo.toISOString())
      ).filter(a => (a.status ?? '').toLowerCase() === 'held');
    } catch (err) {
      logger.warn(
        { err, userId },
        'Could not read appointments; missed revenue will use the fallback estimate'
      );
    }

    /* The list price, for appointments whose job recorded no amount. One read
       for the services actually referenced, rather than one per appointment. */
    const serviceIds = [...new Set(held.map(a => a.serviceId).filter((id): id is string => Boolean(id)))];
    const listPrice = new Map<string, number>();

    if (serviceIds.length > 0) {
      const { data: services, error: servicesError } = await this.supabase
        .from('scheduling_services')
        .select('id, price')
        .eq('user_id', userId)
        .in('id', serviceIds);

      if (servicesError) {
        logger.warn(
          { err: servicesError, userId },
          'Could not read service prices; falling back to what each job charged'
        );
      }

      for (const row of (services ?? []) as Array<{ id: string; price: unknown }>) {
        const price = parseFloat(String(row.price ?? '0'));
        if (Number.isFinite(price) && price > 0) listPrice.set(row.id, price);
      }
    }

    const avgValue = held.map(a => ({
      payment_amount: a.paymentAmount,
      service: a.serviceId ? { price: listPrice.get(a.serviceId) ?? 0 } : null,
    }));

    const bookingValues = (avgValue ?? [])
      .map((row) => {
        const charged = parseFloat(String((row as { payment_amount?: unknown }).payment_amount ?? '0'));
        if (Number.isFinite(charged) && charged > 0) return charged;
        const service = (row as { service?: { price?: unknown } | null }).service;
        const listed = parseFloat(String(service?.price ?? '0'));
        return Number.isFinite(listed) ? listed : 0;
      })
      .filter((value) => value > 0);

    /*
     * Null when nothing completed carries a price. There is no sensible default
     * for what an hour of someone else's business is worth, and the $75 that
     * used to sit here was printed to owners as their own average.
     */
    const avgBookingValue =
      bookingValues.length > 0
        ? bookingValues.reduce((sum, value) => sum + value, 0) / bookingValues.length
        : null;

    // Calculate missed revenue
    const missedBookings = underutilized.reduce(
      (sum, slot) => sum + (slot.historicalBookings - slot.recentBookings),
      0
    );
    // No price data means no revenue claim — not a revenue claim of zero.
    const missedRevenue =
      avgBookingValue === null ? undefined : missedBookings * avgBookingValue;

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
      estimatedImpactUsd: missedRevenue === undefined ? undefined : Math.round(missedRevenue),
      impactDirection: 'loss',
      impactPeriod: 'monthly',
      processParameters: {
        target_contacts: 'recent_clients',
        avg_utilization: Math.round(avgUtilization),
        utilization_drop: Math.round(utilizationDrop),
        missed_bookings: missedBookings,
        avg_booking_value: avgBookingValue === null ? undefined : Math.round(avgBookingValue),
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
