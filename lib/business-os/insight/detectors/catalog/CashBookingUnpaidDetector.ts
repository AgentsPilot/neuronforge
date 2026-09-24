/**
 * Booking With Payment Outstanding
 *
 * An appointment is coming up that the client was supposed to pay for and
 * hasn't. Deliberately NOT "unpaid invoices": the money matters here because it
 * is attached to something happening on a specific day, which is what makes it
 * actionable before the appointment rather than after it.
 *
 * The hard part is knowing when payment was actually EXPECTED. A business that
 * invoices after the session has unpaid upcoming bookings as its normal state,
 * and flagging those would be a daily false alarm. Two pieces of evidence say
 * payment was due up front, and nothing else counts:
 *
 *  1. `scheduling_services.collection === 'online'` — the owner's own answer
 *     that this service is paid by card at booking.
 *  2. A `payment_amount` on the booking with `payment_status` still pending —
 *     a charge was raised against this booking and has not landed, whatever
 *     the service says.
 *
 * `collection === 'invoice'` is explicitly excluded. Billed-afterwards is a
 * business model, not a problem.
 *
 * @see docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

/** Payment states that mean the money arrived. Anything else is outstanding. */
const SETTLED = new Set(['paid', 'refunded', 'partially_refunded']);

interface BookingRow {
  id: string;
  start_time: string | null;
  payment_status: string | null;
  payment_amount: number | string | null;
  payment_currency: string | null;
  contact_id: string | null;
  service_id: string | null;
  service?: {
    service_name?: string | null;
    price?: number | string | null;
    collection?: string | null;
  } | null;
  contact?: { first_name?: string | null; last_name?: string | null; email?: string | null } | null;
}

export class CashBookingUnpaidDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'cash_booking_unpaid',
    name: 'Booking Not Paid For',
    category: 'cash_flow',
    description: 'Finds upcoming appointments whose payment was due up front and has not arrived',

    watchedMetrics: ['cashflow.pending_payments'],
    eventTypes: [],

    baselineWindow: 'week',
    thresholdType: 'absolute',
    threshold: 0,
    direction: 'above',
    /*
     * One is enough. Unlike a rate, a single appointment tomorrow that hasn't
     * been paid for is a complete fact about a named person on a named day —
     * there is no sample size below which it stops being true.
     */
    minSamples: 1,

    severityFn: (count: number, soonestDays: number): InsightSeverity => {
      // Proximity outranks volume: one unpaid appointment tomorrow needs the
      // owner today, five next month do not.
      if (soonestDays <= 1) return 'critical';
      if (soonestDays <= 3 || count >= 5) return 'high';
      if (soonestDays <= 7 || count >= 2) return 'medium';
      return 'low';
    },

    // Reuses the existing chase process rather than adding a near-duplicate:
    // a booking's payment is carried by an invoice, and this is what chases it.
    pairedProcessId: 'chase_overdue_invoices',
    /*
     * Runs even while this category's vector is dark, because an appointment tomorrow that has not been paid for is true on day one, and
     * a business with one booking has no history for a baseline to be built from.
     */
    ignoresVectorMaturity: true,

    consentTier: 'automate',
    eligibleForAutomation: true,
    ownerParameters: [],
    guardrails: [],
    cooldownHours: 24,
  };

  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async evaluate(userId: string): Promise<DetectionResult | null> {
    if (await this.isOnCooldown(userId)) {
      this.logDetection(userId, null);
      return null;
    }

    const now = new Date();

    const { data, error } = await this.supabase
      .from('scheduling_bookings')
      .select(`
        id, start_time, payment_status, payment_amount, payment_currency, contact_id, service_id,
        service:scheduling_services(service_name, price, collection),
        contact:crm_contacts(first_name, last_name, email)
      `)
      .eq('user_id', userId)
      .eq('status', 'confirmed')
      .gte('start_time', now.toISOString())
      .order('start_time', { ascending: true });

    if (error) throw error;

    const rows = (data ?? []) as unknown as BookingRow[];

    const unpaid = rows.filter(row => {
      if (SETTLED.has((row.payment_status ?? '').toLowerCase())) return false;

      const chargeRaised = toNumber(row.payment_amount) > 0;
      const paidAtBooking = row.service?.collection === 'online';

      // Either piece of evidence will do; an invoiced service with no charge
      // raised against the booking is normal and is not reported.
      return chargeRaised || (paidAtBooking && toNumber(row.service?.price) > 0);
    });

    if (unpaid.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    const soonestDays = Math.max(
      0,
      Math.floor((Date.parse(unpaid[0].start_time ?? '') - now.getTime()) / 86_400_000)
    );

    // What is actually owed: the charge on the booking where there is one, the
    // service price where there is not. Never both.
    const owed = unpaid.reduce(
      (sum, row) => sum + (toNumber(row.payment_amount) || toNumber(row.service?.price)),
      0
    );

    const severity = this.definition.severityFn(unpaid.length, soonestDays);

    /*
     * The invoices behind these bookings, so the chase has something to chase.
     *
     * This reported BOOKING ids while pairing with `chase_overdue_invoices`,
     * which accepts invoices only — so the enqueuer refused every run and the
     * owner saw a "Handle it for me" button that answered 400.
     *
     * `payment_invoices.booking_id` is the link. A booking with no invoice
     * raised against it is still part of the finding — the money is still
     * owed — but there is nothing to send about it, so it contributes to the
     * count and not to the action.
     */
    const { data: invoiceRows } = await this.supabase
      .from('payment_invoices')
      .select('id, booking_id, status')
      .eq('user_id', userId)
      .in('booking_id', unpaid.map(row => row.id))
      .in('status', ['sent', 'pending', 'overdue']);

    const invoiceIds = (invoiceRows ?? []).map(row => String(row.id));

    const result = this.createDetectionResult({
      severity,
      metricKey: 'cashflow.pending_payments',
      currentValue: unpaid.length,
      baselineValue: 0,
      thresholdValue: 0,
      /*
       * Nothing changed by a hundred per cent.
       *
       * This detector counts: there is no baseline to have moved from, and a
       * hardcoded 100 reached the narrator as a real measurement. It produced
       * sentences like "a 100% increase in risk compared to your usual client
       * retention" and "a 100% increase in your expected cash flow" — arithmetic
       * presented as a trend, about a base of zero.
       *
       * `hasRealBaseline` now keeps the figure out of the prompt, but that guard
       * reads `baselineValue`, so it is the second line of defence. This is the
       * first: a count reports no change, because none was measured.
       */
      percentChange: 0,
      direction: 'above',
      // Invoices, because that is what the paired chase acts on. The bookings
      // themselves travel in `process_parameters.booking_ids` below.
      /*
       * Only where an invoice actually exists to chase. An unpaid booking with
       * no invoice raised against it is still money owed and still worth
       * showing — there is just nothing to send about it.
       */
      pairedProcessId: invoiceIds.length > 0 ? this.definition.pairedProcessId : undefined,
      affectedEntityType: 'invoice',
      affectedEntityIds: invoiceIds,
      affectedCount: unpaid.length,
      estimatedImpactUsd: Math.round(owed * 100) / 100,
      impactDirection: 'loss',
      impactPeriod: 'weekly',
      processParameters: {
        soonest_days: soonestDays,
        currency: unpaid[0].payment_currency ?? undefined,
        booking_ids: unpaid.map(row => row.id),
        bookings: unpaid.slice(0, 10).map(row => ({
          id: row.id,
          starts_at: row.start_time,
          service: row.service?.service_name ?? null,
          amount: toNumber(row.payment_amount) || toNumber(row.service?.price),
          client: displayName(row),
        })),
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** Names exactly as stored — never transliterated. */
function displayName(row: BookingRow): string | null {
  const full = [row.contact?.first_name, row.contact?.last_name].filter(Boolean).join(' ').trim();
  return full || row.contact?.email?.trim() || null;
}
