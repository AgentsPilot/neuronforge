/**
 * What was ordered in a period, priced from the agreement.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE OLD SUM READ ZERO
 *
 * `booked_value` was the sum of `scheduling_services.price`, one per booking.
 * That worked while every service carried its own price, and quote-sold work
 * does not: the price of a proposal is negotiated per client and lives on the
 * PROPOSAL. `scheduling_services.price` is NULL for those services, and
 * `Number(price) || 0` turns NULL into zero without a sound.
 *
 * Measured 2026-10-29, one account, ninety days, non-cancelled:
 *
 *   41 bookings considered
 *   17 priced by service.price ....... reported 8,900
 *   24 priced at NULL ................ reported 0
 *      of which 10 were really invoiced 25,866.64
 *
 * So the figure an owner reads as "what I sold" was a quarter of what they
 * sold, and the missing three quarters was the entire quote channel — the part
 * of the business most likely to be the expensive part.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ORDER OF PREFERENCE, AND WHY IT IS THIS WAY ROUND
 *
 * 1. AN ACCEPTED PROPOSAL. The agreed price of the work, which is exactly what
 *    "booked value" means. Only `accepted`: a `superseded` proposal was
 *    replaced by a later one and counting both would bill the client twice in
 *    the report, and a `stopped` one is work that will not happen. On the
 *    account above, 6 of 15 proposals are superseded and 5 are stopped — more
 *    than two thirds would have been double or phantom value.
 *
 * 2. INVOICES RAISED. For work sold without a proposal. The second-best record
 *    of what was agreed, because somebody has asked the client for it.
 *
 * 3. THE SERVICE PRICE. Today's behaviour, and still right for an ordinary
 *    priced service booked off the website.
 *
 * First hit wins, and they are never added together: an accepted proposal
 * usually HAS invoices against it — often one per installment — and summing
 * both counts the same agreement twice over.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND IT IS NEVER ONE NUMBER
 *
 * CLAUDE.md § Currency: money is never summed across currencies, and no rate
 * in this platform may convert it. The old sum added raw numbers whatever they
 * were denominated in. This groups, and names the largest so a caller that can
 * only show one figure can at least label it honestly.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'bookedValue' });

/** Where a booking's price was found. Reported so the figure can be explained. */
export type PriceSource = 'proposal' | 'invoice' | 'service' | 'unpriced';

export interface BookedValue {
  /** Totals kept apart, largest first. Never added together. */
  byCurrency: { currency: string; value: number }[];
  /** The largest by value, or null when nothing was booked. */
  primaryCurrency: string | null;
  /** The primary currency's total — the single figure, honestly labelled. */
  total: number;
  /** How many bookings took their price from where. */
  sources: Record<PriceSource, number>;
}

const EMPTY: BookedValue = {
  byCurrency: [],
  primaryCurrency: null,
  total: 0,
  sources: { proposal: 0, invoice: 0, service: 0, unpriced: 0 },
};

/** Rounds away the float dust that summing money in JS leaves behind. */
const cents = (n: number): number => Math.round(n * 100) / 100;

/**
 * The value ordered between `from` and `to`, by `created_at`.
 *
 * Dated by when the ORDER arrived, not when the appointment is — that is what
 * "booked this week" has always meant here, and it is also the only date a
 * package has, its container carrying no hour of its own.
 *
 * Three queries, resolved in memory. A per-booking lookup would be four
 * round-trips per row on the dashboard's hot path.
 *
 * @param userId CLAUDE.md rule 4, on every one of the three.
 */
export async function bookedValueInRange(
  client: SupabaseClient,
  userId: string,
  from: string,
  to?: string
): Promise<BookedValue> {
  let bookingQuery = client
    .from('scheduling_bookings')
    .select('id, status, created_at, scheduling_services(price, currency)')
    .eq('user_id', userId)
    .neq('status', 'cancelled')
    .gte('created_at', from);

  if (to) bookingQuery = bookingQuery.lt('created_at', to);

  const { data: bookingRows, error: bookingError } = await bookingQuery;

  if (bookingError) {
    logger.error({ err: bookingError, userId, from, to }, 'Could not read bookings for booked value');
    return EMPTY;
  }

  const bookings = (bookingRows ?? []) as {
    id: string;
    scheduling_services: { price: number | null; currency: string | null }[] | { price: number | null; currency: string | null } | null;
  }[];

  if (bookings.length === 0) return EMPTY;

  const bookingIds = bookings.map(b => b.id);

  const [{ data: proposalRows, error: proposalError }, { data: invoiceRows, error: invoiceError }] =
    await Promise.all([
      client
        .from('proposals')
        .select('total, currency, booking_id, package_booking_id')
        .eq('user_id', userId)
        .eq('status', 'accepted'),
      client
        .from('payment_invoices')
        .select('booking_id, amount, currency')
        .eq('user_id', userId)
        .in('booking_id', bookingIds),
    ]);

  if (proposalError) {
    logger.error({ err: proposalError, userId }, 'Could not read proposals for booked value');
  }
  if (invoiceError) {
    logger.error({ err: invoiceError, userId }, 'Could not read invoices for booked value');
  }

  /*
   * A proposal reaches its booking by either column: `package_booking_id` when
   * it sold a package, `booking_id` when it sold a single appointment. Both are
   * indexed here so neither shape is missed.
   */
  const byProposal = new Map<string, { value: number; currency: string | null }>();
  for (const row of proposalRows ?? []) {
    const p = row as {
      total: number | null;
      currency: string | null;
      booking_id: string | null;
      package_booking_id: string | null;
    };
    const target = p.package_booking_id || p.booking_id;
    if (!target || !(Number(p.total) > 0)) continue;
    byProposal.set(target, { value: Number(p.total), currency: p.currency });
  }

  const byInvoice = new Map<string, { value: number; currency: string | null }>();
  for (const row of invoiceRows ?? []) {
    const i = row as { booking_id: string | null; amount: number | null; currency: string | null };
    if (!i.booking_id) continue;
    const held = byInvoice.get(i.booking_id);
    byInvoice.set(i.booking_id, {
      value: (held?.value ?? 0) + (Number(i.amount) || 0),
      currency: held?.currency ?? i.currency,
    });
  }

  const totals: Record<string, number> = {};
  const sources: Record<PriceSource, number> = {
    proposal: 0,
    invoice: 0,
    service: 0,
    unpriced: 0,
  };

  for (const booking of bookings) {
    const service = Array.isArray(booking.scheduling_services)
      ? booking.scheduling_services[0]
      : booking.scheduling_services;

    const proposal = byProposal.get(booking.id);
    const invoiced = byInvoice.get(booking.id);
    const servicePrice = Number(service?.price) || 0;

    let value = 0;
    let currency: string | null = null;
    let source: PriceSource = 'unpriced';

    if (proposal) {
      value = proposal.value;
      currency = proposal.currency;
      source = 'proposal';
    } else if (invoiced && invoiced.value > 0) {
      value = invoiced.value;
      currency = invoiced.currency;
      source = 'invoice';
    } else if (servicePrice > 0) {
      value = servicePrice;
      currency = service?.currency ?? null;
      source = 'service';
    }

    sources[source]++;
    if (value <= 0) continue;

    const key = (currency || 'unknown').toUpperCase();
    totals[key] = (totals[key] ?? 0) + value;
  }

  const byCurrency = Object.entries(totals)
    .map(([currency, value]) => ({ currency, value: cents(value) }))
    .sort((a, b) => b.value - a.value);

  return {
    byCurrency,
    primaryCurrency: byCurrency[0]?.currency ?? null,
    total: byCurrency[0]?.value ?? 0,
    sources,
  };
}
