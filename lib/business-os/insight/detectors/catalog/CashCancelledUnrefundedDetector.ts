/**
 * Money Held On An Appointment That Is Not Happening
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A cancelled booking the client paid for, where nothing has been given back.
 * The hour is gone, the money is still in the business, and nobody on either
 * side is necessarily wrong about that — a late cancellation may be correctly
 * kept, and a deposit may be non-refundable by agreement.
 *
 * WHAT MAKES IT AN INSIGHT RATHER THAN A CHORE
 *
 * The owner may genuinely owe it back and not know they are holding it. There
 * is no screen in the product that lists "money I am sitting on", and the
 * client is the only party watching — so the first reminder is usually theirs,
 * arriving as a complaint or a chargeback weeks later. That is the worst
 * possible way to be told.
 *
 * So this reports, and never acts. Refunding is a judgement about a
 * relationship and a cancellation policy, and a platform that issued one on the
 * owner's behalf would be moving real money out of a real account on a rule it
 * inferred. `pairedProcessId` is deliberately absent.
 *
 * WHY IT IS NOT THE NEEDS-YOU CARD ROW
 *
 * `booking_cancelled` in the gap registry covers the same money, but only where
 * the CLIENT cancelled — an owner who cancelled does not need telling that they
 * cancelled. That reasoning is right for the empty slot and wrong for the
 * money: an owner cancelling a paid appointment is exactly the case where the
 * client is owed and nobody is chasing. This one looks at both sides.
 *
 * HOW "HELD" IS COMPUTED
 *
 * From the PAYMENTS, not from `booking.payment_status`, and reached by both
 * `booking_id` and `invoice_id` — the same shape `lib/business-os/gaps/
 * definitions.ts` uses, for the same reasons written up there. An invoice-only
 * sum misses the commonest online sale (a widget payment carries a booking and
 * no invoice at all), and `payment_status` is documented as not updated by
 * every refund path. Net of refunds, so a booking already handed back is
 * silent.
 *
 * @see docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';
import { createLogger } from '@/lib/logger';
// The legacy prefix, for rows that predate `cancelled_by`. Imported rather
// than retyped: the two spellings drifted apart within a day of each other
// once, and a mismatch is silent.
import { CLIENT_CANCELLED_PREFIX } from '@/lib/services/bookingCancellationReason';

const logger = createLogger({ module: 'CashCancelledUnrefundedDetector' });

/**
 * How long after the cancellation before silence is worth a word.
 *
 * Three days. An appointment cancelled this morning is not an unrefunded
 * liability, it is this morning's cancellation, and an owner who settles
 * refunds on a Friday should not be told they are holding money every
 * afternoon in between.
 */
const GRACE_DAYS = 3;

/**
 * Past this it was a decision, not an oversight.
 *
 * Six months. A deposit kept since spring has been kept on purpose, and saying
 * so every week teaches the owner to stop reading the category.
 */
const LOOKBACK_DAYS = 180;

/** PostgREST `.in()` has a URL-length ceiling; the gap registry chunks at this too. */
const CHUNK = 50;

/**
 * Payment states on the BOOKING that mean money arrived and is still here.
 *
 * `refunded` and `partially_refunded` are deliberately absent: those say
 * something went back, and this detector is about what did not.
 */
const PAID_ON_BOOKING = new Set(['paid', 'succeeded', 'captured']);

interface BookingRow {
  id: string;
  start_time: string | null;
  payment_status: string | null;
  payment_amount: number | string | null;
  payment_currency: string | null;
  updated_at: string | null;
  created_at: string | null;
  cancellation_reason: string | null;
  /** 'client' | 'owner' | 'system'. Null on rows cancelled before 20260928c. */
  cancelled_by: string | null;
  /** A code from CLIENT_CANCEL_REASONS / OWNER_CANCEL_REASONS, or null. */
  cancel_reason: string | null;
  contact_id: string | null;
  service?: { service_name?: string | null } | null;
  contact?: { first_name?: string | null; last_name?: string | null; email?: string | null } | null;
}

interface Held {
  amount: number;
  currency?: string;
}

export class CashCancelledUnrefundedDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'cash_cancelled_unrefunded',
    name: 'Money Held On A Cancelled Appointment',
    category: 'cash_flow',
    description:
      'Finds cancelled bookings the client paid for where nothing has been refunded',

    watchedMetrics: ['cashflow.held_on_cancelled'],
    eventTypes: [],

    baselineWindow: 'week',
    thresholdType: 'absolute',
    threshold: 0,
    direction: 'above',
    /*
     * One is enough. A named client, a named appointment that is not happening
     * and a figure still in the business is a complete fact — there is no
     * sample size below which it stops being true.
     */
    minSamples: 1,

    severityFn: (count: number, value: number): InsightSeverity => {
      if (value >= 1000 || count >= 4) return 'high';
      if (value > 0 || count >= 1) return 'medium';
      return 'low';
    },

    /*
     * No automation, and no paired process.
     *
     * The platform can chase money owed TO the business. It must not move money
     * OUT of it: whether a cancellation is refundable is a cancellation policy,
     * a relationship and sometimes a negotiation, and none of those is
     * inferable from a row. `RefundModal` is where a human does this, with the
     * choices it asks about (stop the plan? tell the client?) intact.
     */
    pairedProcessId: undefined,

    /*
     * Runs while the category's vector is still dark. A business with four
     * bookings has no baseline, and the first paid cancellation it forgets is
     * exactly when it most needs telling.
     */
    ignoresVectorMaturity: true,

    consentTier: 'suggest',
    eligibleForAutomation: false,
    ownerParameters: [],
    guardrails: [],
    cooldownHours: 48,
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

    /*
     * Dated by `updated_at`, which is when the status last moved.
     *
     * A booking has no "cancelled_at" column. `updated_at` is the closest thing
     * and is what the gap registry already dates this same event by, so the two
     * surfaces cannot disagree about how old a cancellation is. It moves on any
     * later edit, which can only make a row look NEWER — and a row that looks
     * newer is one this detector stays quiet about, which is the safe
     * direction.
     */
    const { data, error } = await this.supabase
      .from('scheduling_bookings')
      .select(`
        id, start_time, updated_at, created_at, cancellation_reason, contact_id,
        cancelled_by, cancel_reason,
        payment_status, payment_amount, payment_currency,
        service:scheduling_services(service_name),
        contact:crm_contacts(first_name, last_name, email)
      `)
      .eq('user_id', userId)
      .eq('status', 'cancelled')
      .gte('updated_at', lookbackFrom)
      .lt('updated_at', graceCutoff)
      .order('updated_at', { ascending: false });

    if (error) throw error;

    const rows = (data ?? []) as unknown as BookingRow[];
    if (rows.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    const held = await this.heldByBooking(userId, rows.map(r => r.id));

    // Null means the payments could not be read. Silence beats guessing about
    // money, so the detector says nothing at all rather than "nothing is held".
    if (held === null) {
      this.logDetection(userId, null);
      return null;
    }

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * MONEY THAT NEVER REACHED THE LEDGER STILL COUNTS.
     *
     * The transactions are the authority on HOW MUCH, and they are silent for
     * a payment taken in cash or by bank transfer: the owner marks the booking
     * paid and no row is written anywhere. On the account this was built
     * against, one cancelled booking read `payment_status = 'paid'` with no
     * transaction, no invoice and a null amount — a client's money held, and
     * invisible to a ledger-only reading.
     *
     * So such a booking is COUNTED and contributes nothing to the figure.
     * `unpriced` carries how many, and the narrator is told plainly, because
     * the one thing that must not happen is a sum that quietly includes a
     * booking whose amount nobody recorded.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const isPaidOnBooking = (row: BookingRow) =>
      PAID_ON_BOOKING.has((row.payment_status ?? '').toLowerCase());

    const unrefunded = rows.filter(
      row => (held.get(row.id)?.amount ?? 0) > 0 || isPaidOnBooking(row)
    );
    if (unrefunded.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    const unpriced = unrefunded.filter(row => (held.get(row.id)?.amount ?? 0) <= 0);

    /*
     * Totalled per currency, and reported in the dominant one.
     *
     * There is no FX rate anywhere in this platform, so a single sum across two
     * currencies would be invented. The largest group is what the figure
     * names, and `currency` says which — the same rule the briefing follows.
     */
    const byCurrency = new Map<string, number>();
    for (const row of unrefunded) {
      const entry = held.get(row.id);
      // The unpriced ones add nothing. They are in the count, never in the sum.
      if (!entry || entry.amount <= 0) continue;
      const code = entry.currency ?? 'USD';
      byCurrency.set(code, (byCurrency.get(code) ?? 0) + entry.amount);
    }

    const dominant = [...byCurrency.entries()].sort((a, b) => b[1] - a[1])[0];
    const value = dominant?.[1] ?? 0;
    // A currency is still named where one can be: the count is reported either
    // way, and a figure of zero must not drag a wrong symbol along with it.
    const currency =
      dominant?.[0] ??
      unrefunded.find(row => row.payment_currency)?.payment_currency ??
      undefined;

    const oldest = unrefunded[unrefunded.length - 1];
    const oldestDays = Math.floor(
      (now - Date.parse(oldest.updated_at ?? oldest.created_at ?? '')) / 86_400_000
    );

    const result = this.createDetectionResult({
      severity: this.definition.severityFn(unrefunded.length, value),
      metricKey: 'cashflow.held_on_cancelled',
      currentValue: unrefunded.length,
      baselineValue: 0,
      thresholdValue: 0,
      /*
       * A count, so nothing moved by a percentage.
       *
       * Reporting 100 here reached the narrator as a measurement and produced
       * sentences about "a 100% increase" against a base of zero. See the same
       * note on `CashWorkUnbilledDetector`.
       */
      percentChange: 0,
      direction: 'above',
      affectedEntityType: 'booking',
      affectedEntityIds: unrefunded.map(row => row.id),
      affectedCount: unrefunded.length,
      /*
       * Omitted entirely when nothing could be priced, rather than sent as 0.
       *
       * Zero would read as "you are holding nothing", which is the opposite of
       * what the count says — and the base class drops a non-positive figure
       * anyway, logging an error about an impossible amount for a case that is
       * perfectly ordinary: a cash payment nobody wrote down.
       */
      estimatedImpactUsd: value > 0 ? Math.round(value * 100) / 100 : undefined,
      /*
       * `impactDirection` is deliberately unset.
       *
       * Its three values are 'loss', 'opportunity' and 'savings', and this
       * money is none of them. It is not lost — it is in the business's
       * account. It is not an opportunity — chasing it harder is not a thing to
       * do. It is not a saving. It is a LIABILITY the owner may or may not owe,
       * and labelling it as any of the three would state something the platform
       * cannot know. `CashClientConcentrationDetector` leaves it unset for the
       * same reason.
       */
      impactPeriod: 'monthly',
      processParameters: {
        oldest_days: oldestDays,
        currency,
        mixed_currency: byCurrency.size > 1,
        /*
         * How many of these carry no recorded amount. The figure above covers
         * the rest, and saying so is the difference between a total and a
         * guess.
         */
        unpriced_count: unpriced.length,
        booking_ids: unrefunded.map(row => row.id),
        bookings: unrefunded.slice(0, 10).map(row => ({
          id: row.id,
          cancelled_at: row.updated_at,
          was_due: row.start_time,
          service: row.service?.service_name ?? null,
          amount: held.get(row.id)?.amount ?? null,
          currency: held.get(row.id)?.currency ?? row.payment_currency ?? null,
          // Marked paid on the booking, with nothing in the ledger to price it.
          amount_unknown: (held.get(row.id)?.amount ?? 0) <= 0,
          client: displayName(row),
          /*
           * Who called it off, so the narrator can say the right sentence.
           *
           * The two readings are genuinely different: a client who cancelled
           * may be waiting for their money back, while an owner who cancelled
           * has almost certainly left a client out of pocket without meaning
           * to. Reported as a fact rather than an adjective — the advice stays
           * the same either way.
           */
          cancelled_by_client: isClientCancellation(row),
          /*
           * Why it was called off, where it was recorded as a code.
           *
           * Free of charge: the column is already selected and already indexed
           * by `idx_bookings_cancel_reason`. "A client cancelled on cost and
           * you are still holding their deposit" is a different conversation
           * from the same sentence with no reason attached.
           */
          cancel_reason: row.cancel_reason ?? null,
        })),
      },
    });

    this.logDetection(userId, result);
    return result;
  }

  /**
   * What is still held on each booking, net of refunds.
   *
   * Returns null when the payments cannot be read. That is NOT the same as an
   * empty map: treating an unreadable ledger as "nothing is held" would make
   * this detector silently correct, and a detector that is silently correct
   * about money is the failure mode this module has already paid for twice.
   */
  private async heldByBooking(
    userId: string,
    bookingIds: string[]
  ): Promise<Map<string, Held> | null> {
    if (bookingIds.length === 0) return new Map();

    try {
      /*
       * Invoices first, so a payment recorded against an INVOICE can be
       * credited to the booking that invoice belongs to. `booking_id` and
       * `invoice_id` are separate columns and PostgREST cannot express "or"
       * across two in-lists, so both are asked for and merged.
       */
      const bookingByInvoice = new Map<string, string>();
      for (const ids of chunked(bookingIds)) {
        const { data, error } = await this.supabase
          .from('payment_invoices')
          .select('id, booking_id')
          .eq('user_id', userId)
          .in('booking_id', ids);
        if (error) throw error;
        for (const invoice of data ?? []) {
          bookingByInvoice.set(
            (invoice as { id: string }).id,
            (invoice as { booking_id: string }).booking_id
          );
        }
      }

      // Merged by PAYMENT id: one carrying both columns comes back from both
      // queries, and counted twice it would report double the money held.
      const payments = new Map<string, Record<string, unknown>>();

      const collect = async (column: 'booking_id' | 'invoice_id', ids: string[]) => {
        const { data, error } = await this.supabase
          .from('payment_transactions')
          .select('id, booking_id, invoice_id, amount, refunded_amount, currency')
          .eq('user_id', userId)
          .eq('status', 'succeeded')
          .in(column, ids);
        if (error) throw error;
        for (const row of data ?? []) {
          payments.set((row as { id: string }).id, row as Record<string, unknown>);
        }
      };

      for (const ids of chunked(bookingIds)) await collect('booking_id', ids);
      for (const ids of chunked([...bookingByInvoice.keys()])) await collect('invoice_id', ids);

      const held = new Map<string, Held>();
      for (const payment of payments.values()) {
        const bookingId =
          (payment.booking_id as string) ||
          bookingByInvoice.get(payment.invoice_id as string) ||
          '';
        if (!bookingId) continue;

        const net = toNumber(payment.amount) - toNumber(payment.refunded_amount);
        if (net <= 0) continue;

        const current = held.get(bookingId);
        held.set(bookingId, {
          amount: (current?.amount ?? 0) + net,
          currency: current?.currency ?? (str(payment.currency) || undefined),
        });
      }

      return held;
    } catch (error) {
      logger.warn(
        { err: error, userId },
        'Could not read the payments; staying quiet rather than reporting money as unheld'
      );
      return null;
    }
  }
}

function chunked(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(ids.slice(i, i + CHUNK));
  return out;
}

/**
 * Whether the CLIENT called it off.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `cancelled_by` is the answer, and this used to parse the English prefix out
 * of `cancellation_reason` instead. Migration 20260928c added the column for
 * exactly this purpose, and its own comment says so: "Replaces parsing the
 * CLIENT_CANCELLED_PREFIX out of cancellation_reason, which is still written
 * for existing readers." Reading the prose worked only because that prefix is
 * still written alongside the column, which makes it a dependency on something
 * the schema has already declared legacy.
 *
 * The prefix survives as the fallback, and ONLY as the fallback: rows cancelled
 * before the column existed carry no `cancelled_by`, and they are the whole
 * reason this branch is still here. On the account this was built against, all
 * four cancelled bookings are of that kind.
 *
 * An unknown party reads as the owner's doing, which stays the conservative
 * reading: it is the case where the client is most likely owed and least likely
 * to be asking.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function isClientCancellation(row: BookingRow): boolean {
  if (row.cancelled_by) return row.cancelled_by === 'client';
  return (row.cancellation_reason ?? '').startsWith(CLIENT_CANCELLED_PREFIX);
}

function toNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Names exactly as stored — never transliterated. */
function displayName(row: BookingRow): string | null {
  const full = [row.contact?.first_name, row.contact?.last_name].filter(Boolean).join(' ').trim();
  return full || row.contact?.email?.trim() || null;
}
