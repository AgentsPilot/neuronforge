/**
 * Ops Service Performance Gap Detector
 *
 * Detects services that are significantly underperforming compared to others.
 * Helps identify services that may need promotion or removal.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';
import { MIN_PER_SEGMENT } from '../../patterns/segmentRate';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'OpsServicePerformanceDetector' });

interface ServicePerformance {
  id: string;
  name: string;
  bookings: number;
  revenue: number;
  /** Time actually sold, in hours — the denominator that makes services comparable. */
  hours: number;
}

export class OpsServicePerformanceDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'ops_service_performance',
    name: 'Service Performance Gap',
    category: 'operations',
    description: 'Detects services significantly underperforming vs others',

    watchedMetrics: ['operations.service_performance'],
    documentsEventTypes: ['service.booked'],

    baselineWindow: 'month',
    thresholdType: 'absolute',
    threshold: 20, // Service with <20% of top performer's bookings
    direction: 'below',
    minSamples: 10, // Need at least 10 total bookings

    severityFn: (gapPercent: number, underperformerCount: number): InsightSeverity => {
      if (gapPercent >= 90 || underperformerCount >= 3) return 'critical';
      if (gapPercent >= 80 || underperformerCount >= 2) return 'high';
      if (gapPercent >= 70) return 'medium';
      return 'low';
    },

    /*

     * Advisory: nothing can run this yet.

     *

     * It used to name `service_promotion_campaign`, a process that was never built — so the card

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

    // Get all services for user
    const { data: services, error: servicesError } = await this.supabase
      .from('scheduling_services')
      .select('id, service_name, price, duration_minutes')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (servicesError) {
      throw servicesError;
    }

    if (!services || services.length < 2) {
      // Need at least 2 services to compare
      this.logDetection(userId, null);
      return null;
    }

    // Get bookings by service in last 30 days (use payment_amount since price is on service)
    const { data: bookings, error: bookingsError } = await this.supabase
      .from('scheduling_bookings')
      .select('service_id, payment_amount, status')
      .eq('user_id', userId)
      .gte('created_at', thirtyDaysAgo.toISOString())
      .in('status', ['confirmed', 'completed']);

    if (bookingsError) {
      throw bookingsError;
    }

    if (!bookings || bookings.length < this.definition.minSamples) {
      this.logDetection(userId, null);
      return null;
    }

    // Calculate performance per service
    const servicePerformance: Record<string, ServicePerformance> = {};

    const serviceDurations: Record<string, number> = {};
    services.forEach((service) => {
      serviceDurations[service.id] = Number(
        (service as { duration_minutes?: unknown }).duration_minutes ?? 0
      );
    });

    services.forEach((service) => {
      servicePerformance[service.id] = {
        id: service.id,
        name: service.service_name,
        bookings: 0,
        revenue: 0,
        hours: 0,
      };
    });

    bookings.forEach((booking) => {
      if (booking.service_id && servicePerformance[booking.service_id]) {
        servicePerformance[booking.service_id].bookings++;
        servicePerformance[booking.service_id].revenue += parseFloat(booking.payment_amount || '0');

        /*
         * Hours sold, from the service's own duration.
         *
         * Total revenue alone ranks services by how often they are booked,
         * which is a popularity contest: a £40 half-hour booked thirty times
         * beats a £300 full day booked four, and the owner is told to sell more
         * of the one that earns less per hour of their life. Revenue per hour
         * is the comparison that answers "what is actually making me money".
         */
        const minutes = Number(serviceDurations[booking.service_id] ?? 0);
        servicePerformance[booking.service_id].hours += Number.isFinite(minutes) ? minutes / 60 : 0;
      }
    });

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * WHAT THIS DETECTOR MAY AND MAY NOT CLAIM.
     *
     * It compares BOOKING VOLUME between services, and volume is not a rate.
     * Every other comparison in this module goes through
     * `patterns/segmentRate.ts`, which refuses a bare count precisely because
     * "Thursday has more bookings" only means she works Thursdays. The same
     * objection applies here and cannot be engineered away: this detector
     * queries only `confirmed` and `completed` bookings, so every row is a
     * success and there is no denominator anywhere in its data. Different
     * services also have different numbers of OPPORTUNITIES — a premium
     * service deliberately offered twice a month is not underperforming — and
     * nothing in the schema records that.
     *
     * So the claim is kept descriptive: these services take a small share of
     * her bookings. That is true, checkable, and hers to interpret. Three
     * things it used to do, which were not:
     *
     *   1. ANY service with one booking could be flagged. `bookings > 0` was
     *      the only floor, so a service booked once was judged against one
     *      booked forty times. One is not a sample. Same class of error as the
     *      275% refund rate.
     *   2. ZERO-BOOKING services were folded in as underperformers, so a
     *      service created yesterday was reported as failing.
     *   3. The money was invented. `potentialRevenue` assumed every service
     *      should reach the AVERAGE, which presumes she wants to sell them
     *      equally. Nothing says she does.
     *
     * `minSamples: 10` gated only the TOTAL booking count, which is why none of
     * it was caught.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const performers = Object.values(servicePerformance).filter((s) => s.bookings > 0);

    if (performers.length < 2) {
      this.logDetection(userId, null);
      return null;
    }

    const topPerformer = performers.reduce((max, s) => (s.bookings > max.bookings ? s : max));
    const threshold = topPerformer.bookings * (this.definition.threshold / 100);

    /*
     * A service has to have been booked enough times to be worth comparing.
     *
     * `MIN_PER_SEGMENT` is the same floor every other comparison in the module
     * uses, borrowed rather than re-chosen so the two cannot drift apart.
     * Services below it are not "performing badly" — they are unmeasured, and
     * the honest thing is to leave them out of the sentence.
     */
    const comparable = performers.filter((s) => s.bookings >= MIN_PER_SEGMENT);

    const allUnderperformers = comparable.filter(
      (s) => s.id !== topPerformer.id && s.bookings < threshold
    );

    /*
     * A service nobody has booked at all is a DIFFERENT card: "this is not
     * selling" rather than "this sells less than that". Writing it here made
     * every newly created service an immediate failure. Counted for the log so
     * the omission is visible, never reported.
     */
    const unbooked = Object.values(servicePerformance).filter((s) => s.bookings === 0).length;
    const tooFewToJudge = performers.length - comparable.length;

    if (allUnderperformers.length === 0) {
      logger.debug(
        { userId, comparable: comparable.length, tooFewToJudge, unbooked },
        'No service is both far behind the busiest and booked enough to say so'
      );
      this.logDetection(userId, null);
      return null;
    }

    // Calculate severity
    const avgGapPercent =
      allUnderperformers.length > 0
        ? allUnderperformers.reduce((sum, s) => {
            const gap = ((topPerformer.bookings - s.bookings) / topPerformer.bookings) * 100;
            return sum + gap;
          }, 0) / allUnderperformers.length
        : 0;

    const severity = this.definition.severityFn(avgGapPercent, allUnderperformers.length);

    const avgBookingsPerService = bookings.length / performers.length;

    const result = this.createDetectionResult({
      severity,
      metricKey: 'operations.service_performance',
      currentValue: allUnderperformers.length,

      // Services, not shekels. Unlabelled, the prompt called it an

      // "Amount involved" and the card read "₪2 עלולים להפסיד ₪340".

      currentValueUnit: 'count',
      baselineValue: 0,
      thresholdValue: this.definition.threshold,
      percentChange: avgGapPercent,
      direction: 'below',
      affectedEntityType: 'service',
      affectedEntityIds: allUnderperformers.map((s) => s.id),
      affectedCount: allUnderperformers.length,
      /*
       * No money, deliberately.
       *
       * The figure here was `(average bookings - this service's bookings) x
       * price`, which presumes she wants every service to sell equally. A
       * premium service offered twice a month is not losing the difference.
       * The module has removed several such numbers this cycle; saying nothing
       * beats a sum the owner reads as a measurement.
       */
      impactDirection: 'opportunity',
      impactPeriod: 'monthly',
      processParameters: {
        top_performer: {
          id: topPerformer.id,
          name: topPerformer.name,
          bookings: topPerformer.bookings,
          revenue: Math.round(topPerformer.revenue),
        },
        underperformers: allUnderperformers.map((s) => ({
          id: s.id,
          name: s.name,
          bookings: s.bookings,
          revenue: Math.round(s.revenue),
          gap_percent: Math.round(
            ((topPerformer.bookings - s.bookings) / topPerformer.bookings) * 100
          ),
        })),
        avg_bookings_per_service: Math.round(avgBookingsPerService * 10) / 10,
        total_services: services.length,
        /*
         * What was left out, so the card's count is readable against the
         * owner's own service list. Without these she counts six services,
         * sees two named, and cannot tell whether the rest passed or were
         * never examined.
         */
        services_too_few_to_judge: tooFewToJudge,
        services_never_booked: unbooked,
        /*
         * Ranked by what an hour of the owner's time earns, which can invert
         * the revenue ranking entirely. Services with no recorded duration are
         * omitted rather than shown as infinite.
         */
        revenue_per_hour: performers
          .filter((s) => s.hours > 0)
          .map((s) => ({
            id: s.id,
            name: s.name,
            per_hour: Math.round((s.revenue / s.hours) * 100) / 100,
            hours: Math.round(s.hours * 10) / 10,
          }))
          .sort((a, b) => b.per_hour - a.per_hour),
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
