/**
 * Work Done And Never Billed
 *
 * An appointment the owner has marked `completed`, with no invoice raised and
 * no payment against it. The work happened; the asking never did.
 *
 * This is the most recoverable money on the dashboard. Everything else in the
 * cash category chases a debt the client already knows about: an invoice was
 * sent, a charge was raised, a plan is running. Here the client has no idea
 * they owe anything, because nobody told them, so the money is not late. It is
 * missing.
 *
 * THE HARD PART is not finding completed bookings. It is not reporting the ones
 * that are correctly unbilled, and there are two large classes of those:
 *
 *  1. FREE work. An intro session priced at zero is completed and uninvoiced
 *     forever, and that is right. The price is read from the SERVICE rather
 *     than the booking, because a booking carries `payment_amount` only where a
 *     charge was raised, and the whole point here is that none was.
 *
 *  2. Work billed somewhere this query cannot see. A booking can be settled
 *     through an invoice (`invoice_id`), a transaction, or an instalment of a
 *     payment plan (`payment_plan_id`). All three are checked. Reporting a
 *     booking already covered by a plan instalment would tell the owner to
 *     chase money they have already collected, which is the failure that made
 *     the package-ending detector worthless.
 *
 * A grace period applies. Work finished this morning is not an unbilled debt,
 * it is work finished this morning, and an owner who invoices weekly should not
 * be told they are losing money every afternoon.
 *
 * @see docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'CashWorkUnbilledDetector' });

/** Payment states on the booking that mean money arrived or is on its way. */
const SETTLED = new Set(['paid', 'refunded', 'partially_refunded', 'processing']);

/**
 * How long after the work before silence counts as an omission.
 *
 * Two days, deliberately. Same day is not a finding, and a week is long enough
 * that the owner has usually moved on and would be told about it too late to
 * act while the session is still fresh in the client's mind.
 */
const GRACE_DAYS = 2;

/** Ignore work older than this: at some point it was a decision, not an oversight. */
const LOOKBACK_DAYS = 120;

interface BookingRow {
  id: string;
  start_time: string | null;
  status: string | null;
  payment_status: string | null;
  payment_amount: number | string | null;
  payment_currency: string | null;
  invoice_id: string | null;
  payment_plan_id: string | null;
  contact_id: string | null;
  service_id: string | null;
  service?: { service_name?: string | null; price?: number | string | null; currency?: string | null } | null;
  contact?: { first_name?: string | null; last_name?: string | null; email?: string | null } | null;
}

export class CashWorkUnbilledDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'cash_work_unbilled',
    name: 'Work Done And Never Billed',
    category: 'cash_flow',
    description: 'Finds completed appointments with no invoice and no payment against them',

    watchedMetrics: ['cashflow.unbilled_work'],
    eventTypes: [],

    baselineWindow: 'week',
    thresholdType: 'absolute',
    threshold: 0,
    direction: 'above',
    /*
     * One is enough, as with an unpaid booking: a named session for a named
     * person on a named day that was never billed is a complete fact. There is
     * no sample size below which it stops being true.
     */
    minSamples: 1,

    severityFn: (count: number, value: number): InsightSeverity => {
      if (value >= 2000 || count >= 5) return 'critical';
      if (value >= 500 || count >= 3) return 'high';
      if (value > 0 || count >= 1) return 'medium';
      return 'low';
    },

    /*
     * No automation, deliberately.
     *
     * The platform can chase an invoice that exists. It cannot decide what to
     * charge for work nobody priced, and raising an invoice on the owner's
     * behalf for an amount inferred from a service list is a bill sent to a
     * real client in the owner's name. That stays a human decision.
     */
    pairedProcessId: undefined,

    /*
     * Runs while the category's vector is dark. A business with three
     * appointments has no baseline, and the first session it forgets to bill
     * is exactly when it most needs telling.
     */
    ignoresVectorMaturity: true,

    consentTier: 'suggest',
    eligibleForAutomation: false,
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

    const now = Date.now();
    const graceCutoff = new Date(now - GRACE_DAYS * 86_400_000).toISOString();
    const lookbackFrom = new Date(now - LOOKBACK_DAYS * 86_400_000).toISOString();

    const { data, error } = await this.supabase
      .from('scheduling_bookings')
      .select(`
        id, start_time, status, payment_status, payment_amount, payment_currency,
        invoice_id, payment_plan_id, contact_id, service_id,
        service:scheduling_services(service_name, price, currency),
        contact:crm_contacts(first_name, last_name, email)
      `)
      .eq('user_id', userId)
      .eq('status', 'completed')
      .gte('start_time', lookbackFrom)
      .lt('start_time', graceCutoff)
      .order('start_time', { ascending: false });

    if (error) throw error;

    const rows = (data ?? []) as unknown as BookingRow[];
    if (rows.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    /*
     * Which of these bookings a transaction already covers.
     *
     * Read in one query rather than per booking: a business with a hundred
     * completed sessions would otherwise make a hundred round trips inside a
     * cron that already runs every user serially.
     */
    const settledByTransaction = await this.bookingsWithTransactions(
      userId,
      rows.map(r => r.id)
    );

    const unbilled = rows.filter(row => {
      // Billed or paid through any of the three routes money can arrive by.
      if (row.invoice_id) return false;
      if (row.payment_plan_id) return false;
      if (settledByTransaction.has(row.id)) return false;
      if (SETTLED.has((row.payment_status ?? '').toLowerCase())) return false;

      // Free work is correctly unbilled, forever. Priced from the service,
      // because an unbilled booking carries no amount of its own.
      return toNumber(row.service?.price) > 0;
    });

    if (unbilled.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    const value = unbilled.reduce((sum, row) => sum + toNumber(row.service?.price), 0);
    const severity = this.definition.severityFn(unbilled.length, value);

    // The business's own currency, from the services being billed. Never
    // hardcoded: `estimated_impact_usd` does not hold USD.
    const currency =
      unbilled.find(r => r.service?.currency)?.service?.currency ??
      unbilled.find(r => r.payment_currency)?.payment_currency ??
      undefined;

    const oldestDays = Math.floor(
      (now - Date.parse(unbilled[unbilled.length - 1].start_time ?? '')) / 86_400_000
    );

    const result = this.createDetectionResult({
      severity,
      metricKey: 'cashflow.unbilled_work',
      currentValue: unbilled.length,
      baselineValue: 0,
      thresholdValue: 0,
      percentChange: 100,
      direction: 'above',
      affectedEntityType: 'booking',
      affectedEntityIds: unbilled.map(row => row.id),
      affectedCount: unbilled.length,
      estimatedImpactUsd: Math.round(value * 100) / 100,
      impactDirection: 'loss',
      impactPeriod: 'monthly',
      processParameters: {
        oldest_days: oldestDays,
        currency,
        booking_ids: unbilled.map(row => row.id),
        bookings: unbilled.slice(0, 10).map(row => ({
          id: row.id,
          happened_at: row.start_time,
          service: row.service?.service_name ?? null,
          amount: toNumber(row.service?.price),
          client: displayName(row),
        })),
      },
    });

    this.logDetection(userId, result);
    return result;
  }

  /** Booking ids that already have a transaction against them. */
  private async bookingsWithTransactions(userId: string, bookingIds: string[]): Promise<Set<string>> {
    if (bookingIds.length === 0) return new Set();

    const { data, error } = await this.supabase
      .from('payment_transactions')
      .select('booking_id')
      .eq('user_id', userId)
      .in('booking_id', bookingIds);

    /*
     * A failure here is reported, not swallowed.
     *
     * Treating an unreadable transaction list as "no transactions" would bill
     * the owner's clients twice over in the advice it gives. Returning every id
     * instead means the detector goes quiet, which is the safe direction.
     */
    if (error) {
      logger.warn(
        { err: error, userId },
        'Could not read transactions; suppressing unbilled-work detection rather than risk double-chasing'
      );
      return new Set(bookingIds);
    }

    return new Set(
      (data ?? [])
        .map(row => (row as { booking_id: string | null }).booking_id)
        .filter((id): id is string => !!id)
    );
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
