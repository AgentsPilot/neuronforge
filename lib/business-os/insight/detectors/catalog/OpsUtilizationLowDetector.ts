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
import { createLogger } from '@/lib/logger';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

const logger = createLogger({ module: 'OpsUtilizationLowDetector' });
import { BusinessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';

/**
 * Weekly availability JSONB shape stored on `business_profiles.scheduling_availability`
 * (e.g. `{ "monday": [{ "start": "09:00", "end": "17:00" }], ... }`). Declared locally
 * because the field is absent from the generated Database type (M2).
 */
export type WeeklyAvailability = Record<string, { start: string; end: string }[]>;

const DEFAULT_AVAILABLE_HOURS_PER_WEEK = 40;

/**
 * Days of taking bookings before an empty slot is worth remarking on.
 *
 * Four weeks, which is what `minSamples: 28` on the definition below has always
 * claimed and never enforced. Measured from the first booking.
 */
const MIN_DAYS_TAKING_BOOKINGS = 28;

/**
 * Bookings behind the rate before it is a rate.
 *
 * Eight. Below that the percentage swings wildly on one booking, and an owner
 * told their calendar is "critical" can do the arithmetic themselves.
 */
const MIN_BOOKINGS = 8;

/** The stretch of calendar the percentage is measured over. */
const WINDOW_DAYS = 28;

/**
 * Booking states that actually occupied the slot.
 *
 * A cancellation or a no-show freed the time, and counting them would report a
 * calendar as busy on the strength of appointments nobody attended — the
 * flattering direction, which is the one to be careful about.
 */
const OCCUPIES_A_SLOT = ['confirmed', 'completed'];

/**
 * Has the owner told us when they work?
 *
 * Asked separately because `calculateAvailableHours` answers 40 for missing or
 * malformed input. That default is right for its other caller and wrong as a
 * denominator: it would turn "we do not know your hours" into "you are 8% full".
 */
function hasAnyAvailability(availability: WeeklyAvailability | null | undefined): boolean {
  if (!availability || typeof availability !== 'object') return false;

  return Object.values(availability).some(
    intervals => Array.isArray(intervals) && intervals.some(i => i?.start && i?.end)
  );
}

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

  /**
   * Enough days AND enough bookings for a utilisation rate to mean something.
   *
   * Returns false for a calendar that is simply new. See the note at the call
   * site for why this is counted from the first booking rather than from the
   * account, and why both conditions are needed.
   */
  private async calendarHasHistory(userId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('scheduling_bookings')
      .select('created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(MIN_BOOKINGS);

    if (error) {
      // Unreadable means we cannot show this is worth saying, so we do not say
      // it. Failing towards silence, as everywhere else in this module.
      logger.warn({ err: error, userId }, 'Could not read booking history; not reporting utilisation');
      return false;
    }

    const bookings = data ?? [];
    if (bookings.length < MIN_BOOKINGS) return false;

    const first = Date.parse(String(bookings[0].created_at));
    if (Number.isNaN(first)) return false;

    const daysTakingBookings = Math.floor((Date.now() - first) / 86_400_000);
    return daysTakingBookings >= MIN_DAYS_TAKING_BOOKINGS;
  }

  /**
   * How full the calendar actually was, over the window.
   *
   * Booked hours divided by available hours, both measured:
   *
   *   booked     `scheduling_bookings` that occupied time — confirmed or
   *              completed. Cancelled and no-show bookings did not fill the
   *              slot, and counting them would report a calendar as busy on the
   *              strength of appointments nobody attended.
   *   available  the owner's own weekly availability, parsed by
   *              `calculateAvailableHours`, multiplied by the weeks in view.
   *
   * Returns null when there is no availability to divide by. That is the honest
   * answer: without it there is no denominator, and the constant this used to
   * assume (40 hours) is a working week somebody invented.
   */
  private async measureUtilisation(userId: string): Promise<{
    utilisationPercent: number;
    bookedHours: number;
    availableHours: number;
    availableHoursPerWeek: number;
    weeks: number;
  } | null> {
    const profileRepo = new BusinessProfileRepository(this.supabase);
    const { data: profile } = await profileRepo.findByUserId(userId);

    // M2: field is absent from the generated Database type — read via a narrow
    // shape, not `any`.
    const weeklyAvailability =
      (profile as { scheduling_availability?: WeeklyAvailability } | null)
        ?.scheduling_availability;

    /*
     * `calculateAvailableHours` falls back to 40 for missing or malformed
     * input, which is right for its other caller and wrong here — so the
     * absence is detected before calling it rather than after.
     */
    if (!hasAnyAvailability(weeklyAvailability)) return null;

    const availableHoursPerWeek = calculateAvailableHours(weeklyAvailability);
    if (availableHoursPerWeek <= 0) return null;

    const from = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

    const { data, error } = await this.supabase
      .from('scheduling_bookings')
      .select('start_time, end_time, status')
      .eq('user_id', userId)
      .in('status', OCCUPIES_A_SLOT)
      .gte('start_time', from)
      .lte('start_time', new Date().toISOString());

    if (error) {
      logger.warn({ err: error, userId }, 'Could not read bookings; not reporting utilisation');
      return null;
    }

    let bookedHours = 0;
    for (const row of (data ?? []) as Array<{ start_time?: string; end_time?: string }>) {
      const start = Date.parse(String(row.start_time));
      const end = Date.parse(String(row.end_time));
      if (Number.isNaN(start) || Number.isNaN(end) || end <= start) continue;
      bookedHours += (end - start) / 3_600_000;
    }

    const weeks = WINDOW_DAYS / 7;
    const availableHours = availableHoursPerWeek * weeks;

    return {
      utilisationPercent: Math.min(100, (bookedHours / availableHours) * 100),
      bookedHours,
      availableHours,
      availableHoursPerWeek,
      weeks,
    };
  }

  async evaluate(userId: string): Promise<DetectionResult | null> {
    // Check cooldown
    if (await this.isOnCooldown(userId)) {
      this.logDetection(userId, null);
      return null;
    }

    /*
     * Has this calendar been open long enough for "empty" to mean anything?
     *
     * ───────────────────────────────────────────────────────────────────────
     * A new business has an empty calendar. That is what new means, not a
     * finding, and telling somebody six days in that 32 slots are "critical"
     * describes their situation back to them as a failure.
     *
     * `minSamples: 28` has been declared on this detector since it was written
     * and was never read by anything. The only gate that actually ran was the
     * ops vector's, and that lights on `total_bookings >= 1` — so one booking
     * was enough for the platform to start judging the other thirty-nine hours
     * of the week.
     *
     * Counted from the FIRST BOOKING, never from signup. That is the module's
     * own rule, for the reason `VECTOR_THRESHOLDS.ret` gives about retention:
     * a rate needs enough history behind it to be a rate. Re-running onboarding
     * also recreates the profile row, so account age is not a clock.
     *
     * Both conditions, because either alone is defeatable: four weeks with one
     * booking is not a utilisation rate, and twenty bookings in three days is
     * a business whose calendar is still filling.
     * ───────────────────────────────────────────────────────────────────────
     */
    if (!(await this.calendarHasHistory(userId))) {
      this.logDetection(userId, null);
      return null;
    }

    /*
     * ───────────────────────────────────────────────────────────────────────
     * MEASURED FROM THE CALENDAR, NOT READ FROM A METRIC NOTHING FEEDS.
     *
     * This asked `derived_metrics` for `operations.calendar_utilization`. That
     * metric is defined over the event `calendar.slot_filled`, which NOTHING
     * emits — so `MetricsComputeService` upserts `value: 0, sampleSize: 0`, and
     * zero is permanently below the 50% threshold.
     *
     * The detector therefore never measured a calendar. It read a fabricated
     * zero and told owners "100% of your time stays empty" while they had
     * appointments booked. Every row of that metric on the live database is
     * `value: 0, n: 0` except two written by the seed script.
     *
     * Booked hours over available hours, both from tables that hold real rows.
     * ───────────────────────────────────────────────────────────────────────
     */
    const measured = await this.measureUtilisation(userId);

    if (measured === null) {
      // No availability configured: there is no denominator, so there is no
      // percentage. Saying nothing beats inventing a 40-hour week.
      this.logDetection(userId, null);
      return null;
    }

    const currentValue = measured.utilisationPercent;
    const threshold = this.definition.threshold;

    // Check if below threshold
    if (currentValue >= threshold) {
      this.logDetection(userId, null);
      return null;
    }

    /*
     * No baseline. There is nothing to compare against: the metric this used to
     * read is empty, so `computeBaseline` had nothing either and fell through to
     * a hardcoded 50 that was then reported as the business's usual level.
     *
     * The finding stands on its own — the calendar is this empty now — and
     * `percentChange: 0` below says no change was measured.
     */
    const baselineMean = 0;

    // Calculate severity
    const severity = this.definition.severityFn(currentValue, 0);

    // Estimate lost revenue opportunity
    // Assumption: each unfilled hour could generate avg booking revenue
    /*
     * What a booking is typically worth, from the bookings themselves.
     *
     * This used to average `value_usd` on `booking.completed` events — a table
     * that, until those events started being written, had nothing in it. The
     * query succeeded, returned no rows, and every run silently fell through to
     * a hardcoded $75 that was then shown to the owner as their own average.
     *
     * The event rail is still the better long-term source once it has history.
     * Until then the answer is in the bookings: what was actually charged, or
     * failing that what the service lists.
     */
    const { data: avgBooking, error: avgBookingError } = await this.supabase
      .from('scheduling_bookings')
      .select('payment_amount, service:scheduling_services(price)')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .limit(100);

    if (avgBookingError) {
      logger.warn(
        { err: avgBookingError, userId },
        'Could not read booking values; falling back to the default estimate'
      );
    }

    const bookingValues = (avgBooking ?? [])
      .map((row) => {
        const charged = parseFloat(String((row as { payment_amount?: unknown }).payment_amount ?? '0'));
        if (Number.isFinite(charged) && charged > 0) return charged;
        const service = (row as { service?: { price?: unknown } | null }).service;
        const listed = parseFloat(String(service?.price ?? '0'));
        return Number.isFinite(listed) ? listed : 0;
      })
      .filter((value) => value > 0);

    // Null rather than a guess — see OpsPeakUnutilizedDetector.
    const avgBookingValue =
      bookingValues.length > 0
        ? bookingValues.reduce((sum, value) => sum + value, 0) / bookingValues.length
        : null;

    /*
     * Both figures come from `measureUtilisation`, which read the same hours it
     * divided by. Recomputing them from a percentage would reintroduce the
     * 40-hour default this detector used to assume for every business.
     */
    const availableHoursPerWeek = measured.availableHoursPerWeek;
    const unfilledHours = Math.max(0, measured.availableHours - measured.bookedHours) / measured.weeks;

    const estimatedOpportunity =
      avgBookingValue === null ? undefined : unfilledHours * avgBookingValue;

    /*
     * Nothing was compared. `getPercentChange` read the same empty metric as
     * the value itself, so it could only ever answer null or a change from a
     * fabricated baseline.
     */
    const percentChange = 0;

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
      processParameters: {
        /*
         * Carried so the projection does not have to invent one.
         *
         * `ImpactProjector.projectOpsUtilizationLow` held `const
         * avgBookingValue = 75` and multiplied the empty hours by it — the same
         * fabricated $75 the comment above describes removing from this
         * detector. The number was shown to owners as their own potential
         * revenue; on the account this was found from, the real service price
         * is $100.
         *
         * Null when nothing has been charged yet, and the projection then
         * states no money at all rather than a guess.
         */
        avg_booking_value: avgBookingValue,
        available_hours_per_week: availableHoursPerWeek,
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
