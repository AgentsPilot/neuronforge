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
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';
import { paymentInvoiceRepository, ISSUED_INVOICE_STATUSES } from '@/lib/repositories/PaymentRepository';
import { createLogger } from '@/lib/logger';
import { findGaps } from '@/lib/business-os/gaps/findGaps';
import type { GapId, GapResult } from '@/lib/business-os/gaps/types';
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
    /**
     * Coming today and not paid for, where payment was due up front.
     *
     * The other half of "is this appointment ready". Intake and payment are the
     * two things that can be outstanding on a booking, and an owner checking
     * their day wants both in one glance rather than one on the card and the
     * other buried in the payments page.
     */
    awaitingPayment: BriefedPerson[];
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

  /**
   * What is true beyond today — the only part of the briefing that looks
   * outside the day.
   *
   * It exists for the day that has nothing in it. A card whose entire content
   * was "nothing is scheduled today" told the owner something they could see
   * from an empty calendar, and a quiet day is exactly when the next thing on
   * the books and the leads that arrived are worth naming.
   */
  outlook: {
    /**
     * The soonest appointment after today. Present ONLY when today has none:
     * beside a day with six appointments, next Wednesday's is noise.
     */
    next?: {
      name: string;
      /** Wall-clock time in the business's zone, e.g. '09:00'. */
      timeLocal: string;
      /** The business's local date, 'YYYY-MM-DD'. Phrased downstream. */
      dateLocal: string;
      serviceName?: string;
    };
    /**
     * The people who got in touch during the business's day.
     *
     * A count AND a few names. It was a bare number — *"2 new people got in
     * touch today"* — which told the owner something had happened and left
     * them to open the CRM to find out what, which is the errand the briefing
     * exists to save them. `people` is capped; `count` covers the rest.
     */
    newLeads: {
      count: number;
      people: Array<{ name: string; note?: string }>;
    };

    /**
     * People waiting on a PRICE.
     *
     * Its own fact rather than folded into `newLeads`, because it is the one
     * thing on this card that only the owner can do — a booking link does not
     * answer "what does it cost". They are alerted the moment it arrives; this
     * is the reminder that it is still unanswered tomorrow.
     */
    quotesWaiting: {
      count: number;
      people: Array<{ name: string; note?: string }>;
      /** What the group is worth, when every one of them is in the same currency. */
      value?: number;
      currency?: string;
    };

    /**
     * Quotes out with the client and unanswered for three days or more.
     *
     * Separate from `quotesWaiting` because the owner is not the blocker.
     * Reported so they know, never presented as something to do — chasing is a
     * judgement about a relationship, not a button.
     */
    quotesOut: {
      count: number;
      people: Array<{ name: string; note?: string }>;
      value?: number;
      currency?: string;
    };
  };

  /**
   * Nothing happened today worth an email.
   *
   * This flag is what stops the morning email going out, so what counts as
   * "nothing" decides what lands in someone's inbox. A daily email that arrives
   * on empty days is the fastest route to an unsubscribe, so most of `outlook`
   * is deliberately excluded: "nothing happened today, but you have someone on
   * Wednesday" is not a reason to write to anybody.
   *
   * NEW LEADS ARE THE EXCEPTION, and it is not an arbitrary one.
   *
   * Everything else in `outlook` is a fact about the future that will still be
   * true tomorrow. A person who got in touch is waiting for an answer NOW, and
   * the cost of the two errors is wildly asymmetric: an extra email on a day
   * somebody asked to be contacted is a minor annoyance; a silent day when two
   * clients wrote in is the business losing both. That is the failure this
   * whole piece of work exists to fix, and suppressing the email on exactly the
   * days it matters would have reproduced it one layer up.
   */
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

  const [bookingsResult, invoicesResult, nextBookingResult, newLeadsResult, gaps] =
    await Promise.all([
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
    // Fetched unconditionally so it can join the same concurrent batch. Whether
    // it is USED depends on today being empty, which is not known until the
    // bookings above come back — and a second round trip after that would cost
    // more than the query it saved.
    schedulingBookingRepository.findNextAfter(userId, day.endUtc),
    crmContactRepository.listCreatedBetween(userId, day.startUtc, day.endUtc, NEW_LEAD_NAMES),
    /*
     * Everything currently stuck, from the gap registry.
     *
     * This was a bare count of `quote_requested` activities with no check
     * against `proposals` — so a quote written, sent and accepted still
     * reported as "still waiting on a price from you" every morning for a
     * fortnight. The registry knows the difference between unwritten, unsent
     * and awaiting the client, and the dashboard and the insight read the same
     * definitions.
     */
    findGaps(userId, { now: new Date(day.startUtc) }),
  ]);

  if (bookingsResult.error) {
    logger.warn({ err: bookingsResult.error, userId }, 'Briefing could not read bookings');
  }
  if (invoicesResult.error) {
    logger.warn({ err: invoicesResult.error, userId }, 'Briefing could not read invoices');
  }
  if (nextBookingResult.error) {
    logger.warn({ err: nextBookingResult.error, userId }, 'Briefing could not read the next booking');
  }
  if (newLeadsResult.error) {
    logger.warn({ err: newLeadsResult.error, userId }, 'Briefing could not read new contacts');
  }

  const bookings = bookingsResult.data ?? [];
  const invoices = invoicesResult.data ?? [];

  const appointments = summariseAppointments(bookings, day);
  const money = summariseMoney(invoices);
  const outlook = summariseOutlook(
    appointments,
    nextBookingResult.data as BookingRow | null,
    (newLeadsResult.data ?? []) as unknown as Array<Record<string, unknown>>,
    gaps,
    day
  );

  const isQuiet = isQuietDay(appointments, money, outlook);

  return { day, appointments, money, outlook, isQuiet };
}

/**
 * Is there anything here worth an email?
 *
 * Its own function because it decides whether mail lands in somebody's inbox,
 * and a rule that important should be readable and testable on its own rather
 * than being four clauses buried in a builder.
 *
 * Today, plus anyone who got in touch today. The rest of `outlook` stays out —
 * see the `isQuiet` field comment for why a future appointment is not a reason
 * to write to anyone.
 */
export function isQuietDay(
  appointments: BriefingFacts['appointments'],
  money: BriefingFacts['money'],
  outlook: BriefingFacts['outlook']
): boolean {
  return (
    appointments.total === 0 &&
    appointments.cancelled.length === 0 &&
    money.owed.length === 0 &&
    outlook.newLeads.count === 0 &&
    // A price nobody has named is somebody still waiting. Never a quiet day.
    outlook.quotesWaiting.count === 0
  );
}

/* ------------------------------------------------------------------------- */

/** Payment states that mean the money arrived. */
const SETTLED_PAYMENT = new Set(['paid', 'refunded', 'partially_refunded']);

type BookingRow = {
  start_time?: string | null;
  status?: string | null;
  payment_status?: string | null;
  payment_amount?: number | string | null;
  cancellation_reason?: string | null;
  intake_sent_at?: string | null;
  intake_completed_at?: string | null;
  notes?: string | null;
  internal_notes?: string | null;
  client_name?: string | null;
  contact?: { first_name?: string | null; last_name?: string | null; email?: string | null } | null;
  service?: { service_name?: string | null; collection?: string | null } | null;
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

  /*
   * Payment counts the same way intake does: outstanding only where it was
   * actually expected before the appointment. A service billed afterwards is
   * not unready — see the booking-unpaid detector, which draws the same line.
   */
  const awaitingPay = live.filter(
    r => !SETTLED_PAYMENT.has((r.payment_status ?? '').toLowerCase()) &&
         (toNumber(r.payment_amount) > 0 || r.service?.collection === 'online')
  );

  /*
   * Ready means nothing outstanding of EITHER kind. Counting only intake here
   * would let the card say "all 8 are ready" on a morning when one of them
   * hasn't paid — and the unpaid line directly beneath would contradict it.
   */
  const unready = new Set([...awaiting, ...awaitingPay]);
  const ready = live.length - unready.size;

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
    awaitingPayment: awaitingPay.map(r => ({
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

/**
 * What to say about the days ahead — which, on a busy day, is nothing.
 *
 * The next appointment is withheld whenever today has one of its own. The
 * briefing is about today; a business with six appointments does not need to be
 * told about Wednesday's, and printing it would push a genuinely useful line
 * off a card that holds six.
 *
 * New leads are reported whatever kind of day it is: someone arriving is news
 * on a full day as much as on an empty one.
 */
function summariseOutlook(
  appointments: BriefingFacts['appointments'],
  nextRow: BookingRow | null,
  newLeadRows: Array<Record<string, unknown>>,
  gaps: GapResult[],
  day: BusinessDay
): BriefingFacts['outlook'] {
  const todayIsEmpty = appointments.total === 0;
  const name = nextRow ? displayName(nextRow) : '';
  const timeLocal = timeIn(nextRow?.start_time, day.timezone);
  const dateLocal = dateIn(nextRow?.start_time, day.timezone);

  return {
    // Every part has to be present. A line reading "your next appointment is
    // at 09:00" with nobody's name in it is worse than no line.
    ...(todayIsEmpty && name && timeLocal && dateLocal
      ? {
          next: {
            name,
            timeLocal,
            dateLocal,
            serviceName: nextRow?.service?.service_name ?? undefined,
          },
        }
      : {}),
    newLeads: {
      count: newLeadRows.length,
      people: newLeadRows.map(toLeadPerson).filter(person => Boolean(person.name)),
    },
    /*
     * Owed a price: nobody has written the quote, or somebody wrote it and
     * never sent it. Written-but-unsent is not better than unwritten — the work
     * is done and the client still has nothing.
     */
    quotesWaiting: fromGaps(gaps, ['quote_unwritten', 'quote_unsent']),
    /* Out with the client, who has not answered. News, not an errand. */
    quotesOut: fromGaps(gaps, ['quote_awaiting_client']),
  };
}

/** Fold one or more gaps into the count-and-names shape the briefing narrates. */
function fromGaps(
  gaps: GapResult[],
  ids: GapId[]
): { count: number; people: Array<{ name: string; note?: string }>; value?: number; currency?: string } {
  const matching = gaps.filter(gap => ids.includes(gap.id));
  const items = matching.flatMap(gap => gap.items);

  /*
   * What the group is worth, where the gap carries money.
   *
   * A count on its own — "3 quotes waiting" — does not tell the owner which
   * line to start with on a morning that has four of them. The total does, and
   * it is the figure the brief asks for.
   *
   * Summed in ONE currency only: the dominant one, with mixed sets reported
   * without a total rather than adding shekels to dollars. This dashboard has
   * shipped that bug once already, printing a ₪ symbol over USD amounts.
   */
  const byCurrency = new Map<string, number>();
  for (const item of items) {
    if (!item.value || item.value <= 0) continue;
    const currency = (item.currency || '').toUpperCase();
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + item.value);
  }

  const dominant = [...byCurrency.entries()].sort((a, b) => b[1] - a[1])[0];
  const singleCurrency = byCurrency.size === 1 && dominant;

  return {
    count: matching.reduce((sum, gap) => sum + gap.count, 0),
    people: items
      .slice(0, NEW_LEAD_NAMES)
      .map(item => ({ name: item.name, note: item.note })),
    ...(singleCurrency ? { value: Math.round(dominant[1] * 100) / 100, currency: dominant[0] } : {}),
  };
}


/**
 * How many names the briefing will print before it just counts.
 *
 * Three is a sentence; six is a list nobody reads in a summary card.
 */
const NEW_LEAD_NAMES = 3;

/**
 * One new contact, as the briefing refers to them.
 *
 * The note is what they actually said they wanted — a service they named, or
 * the opening of their message. It is the difference between "someone got in
 * touch" and "Dana asked about the intro call", and it is the whole reason this
 * stopped being a number.
 */
function toLeadPerson(row: Record<string, unknown>): { name: string; note?: string } {
  const first = typeof row.first_name === 'string' ? row.first_name.trim() : '';
  const last = typeof row.last_name === 'string' ? row.last_name.trim() : '';
  const email = typeof row.email === 'string' ? row.email.trim() : '';

  // A name if they gave one, otherwise the address — never an empty label.
  const name = [first, last].filter(Boolean).join(' ') || email;

  const custom = (row.custom_fields ?? {}) as Record<string, unknown>;
  const interest = typeof custom.service_interest === 'string' ? custom.service_interest.trim() : '';
  const message =
    typeof custom.first_website_message === 'string'
      ? custom.first_website_message.trim()
      : typeof custom.last_website_message === 'string'
        ? custom.last_website_message.trim()
        : '';

  const note = interest || (message ? truncate(message, 90) : '');
  return note ? { name, note } : { name };
}

/** Cut at a word boundary where there is one nearby, so it does not read as broken. */
function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
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

/** Calendar date of an instant, as the business reads it. 'YYYY-MM-DD'. */
function dateIn(instant: string | null | undefined, timezone: string): string | undefined {
  if (!instant) return undefined;

  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) return undefined;

  try {
    // 'en-CA' is the shortest route to ISO order from Intl, and the locale is
    // irrelevant here: this string is never read by anyone, only formatted
    // downstream in the reader's own language.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
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
