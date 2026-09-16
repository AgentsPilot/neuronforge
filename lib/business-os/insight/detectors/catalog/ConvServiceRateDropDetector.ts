/**
 * A Service Stopped Converting
 *
 * "Your free consultation converted 52% of people into paid work last month.
 * This month it is 38%." Two periods, one service, and the comparison between
 * them — which is the whole insight: 38% on its own is a number nobody can
 * act on, because nobody knows whether it is good.
 *
 * Conversion here means something specific and checkable: someone booked the
 * service, and afterwards paid for something. Not "became a client", which is a
 * stage somebody has to remember to set — money moving is the one signal that
 * cannot be forgotten, backdated or left stale.
 *
 * Deliberately limited to entry services, the free or cheap thing people try
 * first. A £6,000 programme "converting" at 20% is not a problem, it is what a
 * £6,000 programme does; the question only makes sense about the step designed
 * to lead somewhere else.
 *
 * @see docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import { createLogger } from '@/lib/logger';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

const logger = createLogger({ module: 'ConvServiceRateDropDetector' });

/** Each period compared. Two of these are looked at. */
const PERIOD_DAYS = 30;

/**
 * How long someone gets to go on and buy something.
 *
 * Bookings from the last few days are excluded from BOTH periods rather than
 * counted as failures — a consultation on Friday has not converted yet, and
 * counting it as a miss would make the current period look worse than the
 * previous one every single time the detector ran.
 */
const CONVERSION_WINDOW_DAYS = 14;

/** Below this, a percentage is noise. */
const MIN_COHORT = 5;

/** Percentage points the rate must fall before it is worth saying. */
const MIN_DROP_POINTS = 15;

interface BookingRow {
  contact_id: string | null;
  service_id: string | null;
  created_at: string | null;
  service?: { service_name?: string | null; price?: number | string | null } | null;
}

export class ConvServiceRateDropDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'conv_service_rate_drop',
    name: 'Service Conversion Fell',
    category: 'conversion',
    description: 'Finds an entry service converting into paid work less often than it did',

    watchedMetrics: ['conversion.lead_to_client_rate'],
    eventTypes: [],

    baselineWindow: 'month',
    thresholdType: 'percent_change',
    threshold: MIN_DROP_POINTS,
    direction: 'below',
    minSamples: MIN_COHORT,

    severityFn: (dropPoints: number, cohort: number): InsightSeverity => {
      if (dropPoints >= 30 && cohort >= 10) return 'high';
      if (dropPoints >= 25 || cohort >= 15) return 'medium';
      return 'low';
    },

    pairedProcessId: 'send_followup_nudge',
    consentTier: 'suggest',
    eligibleForAutomation: false,
    ownerParameters: [],
    guardrails: [],
    cooldownHours: 336,
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
    const settled = now - CONVERSION_WINDOW_DAYS * 86_400_000;
    const currentStart = settled - PERIOD_DAYS * 86_400_000;
    const previousStart = currentStart - PERIOD_DAYS * 86_400_000;

    const [bookingsResult, paymentsResult] = await Promise.all([
      this.supabase
        .from('scheduling_bookings')
        .select('contact_id, service_id, created_at, service:scheduling_services(service_name, price)')
        .eq('user_id', userId)
        .neq('status', 'cancelled')
        .gte('created_at', new Date(previousStart).toISOString())
        .lt('created_at', new Date(settled).toISOString())
        .limit(2000),

      // Money arriving is the proof of conversion. Invoices rather than
      // bookings: a client who paid without a second booking still converted.
      this.supabase
        .from('payment_invoices')
        .select('contact_id, paid_at')
        .eq('user_id', userId)
        .not('paid_at', 'is', null)
        .gte('paid_at', new Date(previousStart).toISOString())
        .limit(2000),
    ]);

    if (bookingsResult.error) throw bookingsResult.error;
    if (paymentsResult.error) throw paymentsResult.error;

    /*
     * When each contact first paid. A payment BEFORE the entry booking is not a
     * conversion of it — they were already a customer — so the date is kept
     * rather than a bare "has paid" flag.
     */
    const firstPaid = new Map<string, number>();
    for (const row of paymentsResult.data ?? []) {
      const contactId = row.contact_id ? String(row.contact_id) : '';
      const at = Date.parse(String(row.paid_at ?? ''));
      if (!contactId || Number.isNaN(at)) continue;
      if (!firstPaid.has(contactId) || at < firstPaid.get(contactId)!) firstPaid.set(contactId, at);
    }

    const rows = (bookingsResult.data ?? []) as unknown as BookingRow[];

    // Cheapest service wins the "entry" title; ties go to whichever is free.
    const byService = new Map<string, { name: string; price: number; rows: BookingRow[] }>();
    for (const row of rows) {
      if (!row.service_id || !row.contact_id) continue;
      const price = Number(row.service?.price ?? 0);
      const existing = byService.get(row.service_id) ?? {
        name: row.service?.service_name ?? 'this service',
        price: Number.isFinite(price) ? price : 0,
        rows: [],
      };
      existing.rows.push(row);
      byService.set(row.service_id, existing);
    }

    let worst: {
      name: string;
      current: number;
      previous: number;
      cohort: number;
      contactIds: string[];
    } | null = null;

    for (const [, service] of byService) {
      const current = this.rateFor(service.rows, currentStart, settled, firstPaid);
      const previous = this.rateFor(service.rows, previousStart, currentStart, firstPaid);

      if (!current || !previous) continue;

      const dropPoints = previous.rate - current.rate;
      if (dropPoints < MIN_DROP_POINTS) continue;

      if (!worst || dropPoints > worst.previous - worst.current) {
        worst = {
          name: service.name,
          current: current.rate,
          previous: previous.rate,
          cohort: current.cohort,
          contactIds: current.unconverted,
        };
      }
    }

    if (!worst) {
      this.logDetection(userId, null);
      return null;
    }

    const dropPoints = Math.round(worst.previous - worst.current);
    const severity = this.definition.severityFn(dropPoints, worst.cohort);

    logger.info(
      { userId, service: worst.name, previous: worst.previous, current: worst.current },
      'Service conversion drop detected'
    );

    const result = this.createDetectionResult({
      severity,
      metricKey: 'conversion.lead_to_client_rate',
      currentValue: Math.round(worst.current),
      baselineValue: Math.round(worst.previous),
      thresholdValue: MIN_DROP_POINTS,
      percentChange: -dropPoints,
      direction: 'below',
      affectedEntityType: 'contact',
      affectedEntityIds: worst.contactIds,
      affectedCount: worst.contactIds.length,
      impactDirection: 'opportunity',
      impactPeriod: 'monthly',
      processParameters: {
        service_name: worst.name,
        current_rate_percent: Math.round(worst.current),
        previous_rate_percent: Math.round(worst.previous),
        drop_points: dropPoints,
        cohort_size: worst.cohort,
        period_days: PERIOD_DAYS,
        contact_ids: worst.contactIds.slice(0, 20),
      },
    });

    this.logDetection(userId, result);
    return result;
  }

  /**
   * The conversion rate for one service over one window.
   *
   * Returns null below the cohort floor rather than a percentage, so a service
   * booked twice cannot produce "50%" and outrank a service booked forty times.
   */
  private rateFor(
    rows: BookingRow[],
    from: number,
    to: number,
    firstPaid: Map<string, number>
  ): { rate: number; cohort: number; unconverted: string[] } | null {
    const contacts = new Map<string, number>();
    for (const row of rows) {
      const at = Date.parse(String(row.created_at ?? ''));
      if (Number.isNaN(at) || at < from || at >= to) continue;
      const contactId = String(row.contact_id);
      if (!contacts.has(contactId) || at < contacts.get(contactId)!) contacts.set(contactId, at);
    }

    if (contacts.size < MIN_COHORT) return null;

    const unconverted: string[] = [];
    let converted = 0;

    for (const [contactId, bookedAt] of contacts) {
      const paidAt = firstPaid.get(contactId);
      // Paid AFTER the booking, not before: an existing customer booking an
      // entry service has not been converted by it.
      if (paidAt !== undefined && paidAt >= bookedAt) converted += 1;
      else unconverted.push(contactId);
    }

    return {
      rate: (converted / contacts.size) * 100,
      cohort: contacts.size,
      unconverted,
    };
  }
}
