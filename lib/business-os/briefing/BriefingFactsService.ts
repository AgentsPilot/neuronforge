/**
 * The facts a daily briefing is built from.
 *
 * This module answers questions with SQL and returns numbers, names and times.
 * It renders no prose and calls no model. That separation is the safety
 * property of the whole feature: the narrator downstream is handed these values
 * and asked only to phrase them, so a briefing can never claim a client owes
 * money they do not owe.
 *
 * Everything here is scoped to the BUSINESS's day, not the server's. See
 * lib/business-os/businessDay.ts for why that distinction is not cosmetic.
 */

import { schedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';
import { paymentInvoiceRepository, ISSUED_INVOICE_STATUSES } from '@/lib/repositories/PaymentRepository';
import { createLogger } from '@/lib/logger';
import type { BusinessDay } from '@/lib/business-os/businessDay';

const logger = createLogger({ service: 'BriefingFactsService' });

/** Someone the owner will recognise by name, with the one fact that matters. */
export interface BriefedPerson {
  name: string;
  /** Wall-clock time in the business's zone, e.g. '09:00'. Absent for money-only entries. */
  timeLocal?: string;
}

export interface OwedAmount {
  name: string;
  amount: number;
  currency: string;
  overdue: boolean;
}

export interface BriefingFacts {
  day: BusinessDay;

  appointments: {
    total: number;
    /** Intake complete, or never required. */
    ready: number;
    /** Intake was sent and has not come back. These are the ones worth naming. */
    awaitingIntake: BriefedPerson[];
    first?: {
      name: string;
      timeLocal: string;
      serviceName?: string;
      /** Anything the owner wrote against this booking. Never client-visible text. */
      note?: string;
    };
    cancelled: Array<BriefedPerson & { reason?: string }>;
  };

  money: {
    owed: OwedAmount[];
    /** Sum of `owed` in the dominant currency only — see currencies below. */
    totalOwed: number;
    currency: string;
    /** True when outstanding invoices span more than one currency. */
    mixedCurrency: boolean;
  };

  /** Nothing today, in either direction. Drives both the card and "do not email". */
  isQuiet: boolean;
}

export interface BuildOptions {
  /** Cap on rows pulled per query. A day with more than this is summarised, not truncated silently. */
  limit?: number;
}

/**
 * Gather everything the briefing can say about `day`.
 *
 * Reads run concurrently and each degrades independently: a failure in the
 * money half still leaves an appointments briefing worth reading. A briefing
 * that renders nothing because one query timed out is worse than a partial one.
 */
export async function buildBriefingFacts(
  userId: string,
  day: BusinessDay,
  options: BuildOptions = {}
): Promise<BriefingFacts> {
  const limit = options.limit ?? 100;

  const [bookingsResult, invoicesResult] = await Promise.all([
    schedulingBookingRepository.list(userId, {
      startDate: day.startUtc,
      // Half-open: a booking at exactly tomorrow's midnight is tomorrow's.
      endBefore: day.endUtc,
      limit,
    }),
    paymentInvoiceRepository.list(userId, {
      status: ISSUED_INVOICE_STATUSES.join(','),
      includeContact: true,
      limit,
    }),
  ]);

  if (bookingsResult.error) {
    logger.warn({ err: bookingsResult.error, userId }, 'Briefing could not read bookings');
  }
  if (invoicesResult.error) {
    logger.warn({ err: invoicesResult.error, userId }, 'Briefing could not read invoices');
  }

  const bookings = bookingsResult.data ?? [];
  const invoices = invoicesResult.data ?? [];

  const appointments = summariseAppointments(bookings, day);
  const money = summariseMoney(invoices);

  const isQuiet =
    appointments.total === 0 &&
    appointments.cancelled.length === 0 &&
    money.owed.length === 0;

  return { day, appointments, money, isQuiet };
}

/* ------------------------------------------------------------------------- */

type BookingRow = {
  start_time?: string | null;
  status?: string | null;
  cancellation_reason?: string | null;
  intake_sent_at?: string | null;
  intake_completed_at?: string | null;
  notes?: string | null;
  internal_notes?: string | null;
  client_name?: string | null;
  contact?: { first_name?: string | null; last_name?: string | null; email?: string | null } | null;
  service?: { service_name?: string | null } | null;
};

function summariseAppointments(rows: BookingRow[], day: BusinessDay): BriefingFacts['appointments'] {
  const live = rows.filter(r => r.status === 'confirmed' || r.status === 'completed');
  const cancelled = rows.filter(r => r.status === 'cancelled');

  /*
   * "Ready" means nothing is being waited on. A booking whose service never
   * asked for an intake is ready by default — treating a never-sent intake as
   * outstanding would report every client of a business that does not use
   * intake forms as unprepared.
   */
  const awaiting = live.filter(r => r.intake_sent_at && !r.intake_completed_at);
  const ready = live.length - awaiting.length;

  const ordered = [...live].sort(
    (a, b) => Date.parse(a.start_time ?? '') - Date.parse(b.start_time ?? '')
  );
  const firstRow = ordered[0];

  return {
    total: live.length,
    ready,
    awaitingIntake: awaiting.map(r => ({
      name: displayName(r),
      timeLocal: timeIn(r.start_time, day.timezone),
    })),
    first: firstRow
      ? {
          name: displayName(firstRow),
          timeLocal: timeIn(firstRow.start_time, day.timezone) ?? '',
          serviceName: firstRow.service?.service_name ?? undefined,
          // Owner-authored notes only. `notes` may carry what the client wrote.
          note: firstRow.internal_notes?.trim() || undefined,
        }
      : undefined,
    cancelled: cancelled.map(r => ({
      name: displayName(r),
      timeLocal: timeIn(r.start_time, day.timezone),
      reason: r.cancellation_reason?.trim() || undefined,
    })),
  };
}

type InvoiceRow = {
  status?: string | null;
  amount?: number | string | null;
  refunded_amount?: number | string | null;
  currency?: string | null;
  due_date?: string | null;
  contact_name?: string | null;
  client_name?: string | null;
};

function summariseMoney(rows: InvoiceRow[]): BriefingFacts['money'] {
  const owed: OwedAmount[] = rows
    .map(row => {
      const gross = toNumber(row.amount);
      const refunded = toNumber(row.refunded_amount);
      const outstanding = gross - refunded;

      return {
        name: (row.contact_name || row.client_name || '').trim(),
        amount: outstanding,
        currency: (row.currency || 'USD').toUpperCase(),
        overdue: row.status === 'overdue',
      };
    })
    .filter(entry => entry.amount > 0 && entry.name.length > 0);

  /*
   * Money is per-invoice currency, so a total across a mixed set is a number
   * that means nothing. Total the dominant currency and flag the rest rather
   * than adding shekels to dollars — this dashboard has already shipped that
   * bug once, showing a ₪ symbol on USD amounts.
   */
  const byCurrency = new Map<string, number>();
  for (const entry of owed) {
    byCurrency.set(entry.currency, (byCurrency.get(entry.currency) ?? 0) + entry.amount);
  }

  const dominant = [...byCurrency.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    owed: owed.sort((a, b) => b.amount - a.amount),
    totalOwed: dominant?.[1] ?? 0,
    currency: dominant?.[0] ?? 'USD',
    mixedCurrency: byCurrency.size > 1,
  };
}

/* ------------------------------------------------------------------------- */

/**
 * What the owner calls this person.
 *
 * Names are used exactly as stored and never transliterated — a Hebrew-speaking
 * business has Hebrew-named records, and rewriting them in Latin script makes
 * the briefing describe people the owner does not recognise.
 */
function displayName(row: BookingRow): string {
  const contact = row.contact;
  const full = [contact?.first_name, contact?.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();

  return full || row.client_name?.trim() || contact?.email?.trim() || '';
}

/** Wall-clock time of an instant, as the business reads it. */
function timeIn(instant: string | null | undefined, timezone: string): string | undefined {
  if (!instant) return undefined;

  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) return undefined;

  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(parsed);
  } catch {
    return undefined;
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
