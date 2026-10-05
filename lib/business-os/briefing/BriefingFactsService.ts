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
import { supabaseServer } from '@/lib/supabaseServer';
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
  /**
   * When it falls due, as the calendar date on the invoice.
   *
   * Carried so a morning brief can tell "late" from "not due for six weeks".
   * Without it every outstanding invoice read as a debt: a real briefing said
   * "David still owes ₪4,250" about an invoice due on 9 November, which is not
   * something to act on over breakfast in September.
   */
  dueDate: string | null;
}

export interface BriefingFacts {
  day: BusinessDay;

  appointments: {
    total: number;
    /**
     * Already happened. Counted in `total`, excluded from everything that asks
     * whether something is outstanding — a finished session is not unready.
     */
    completed: number;
    /** Confirmed, and waiting on nothing. Finished sessions are not counted. */
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
    /**
     * Booked, and nobody came.
     *
     * Distinct from `cancelled`: a cancellation frees the slot and is often
     * fine; a no-show cost the hour. The briefing reported one and was silent
     * about the other.
     */
    noShows: BriefedPerson[];
    /**
     * Appointments that never reached the owner's real calendar.
     *
     * `calendar_sync_error` is set and nothing tells them, so the first sign is
     * a client arriving for a slot the owner had given away.
     */
    syncFailures: number;
  };

  money: {
    owed: OwedAmount[];
    /** Sum of `owed` in the dominant currency only — see currencies below. */
    totalOwed: number;
    currency: string;
    /** True when outstanding invoices span more than one currency. */
    mixedCurrency: boolean;
    /**
     * Money that ARRIVED today.
     *
     * The briefing could only ever report debts: `owed` was the whole of its
     * money vocabulary, so a day on which £500 came in and nothing was
     * outstanding had nothing to say about money at all. The one figure an
     * owner most wants at the end of a day was the one figure the card could
     * not produce.
     *
     * De-duplicated the way the stats route does it: an invoice settled BY a
     * transaction is one payment, not two.
     */
    receivedToday: number;
    /** How many separate payments that was. */
    receivedCount: number;
    /**
     * Instalments on a payment plan that have fallen due and are unpaid.
     *
     * Money owed on a SCHEDULE rather than against an invoice, so invisible to
     * `owed`, which reads `payment_invoices` only. A client paying a course
     * over four months showed the owner nothing.
     */
    instalmentsDue: Array<{ name?: string; amount: number; currency: string; dueDate: string | null }>;
    /** A card that has failed and is queued to try again. */
    retrying: number;
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
    /**
     * Somebody wrote in and still has no reply — whenever they wrote.
     *
     * `newLeads` counts contacts created TODAY, so an enquiry that arrived on
     * Friday and was never answered is invisible on Monday morning. It is the
     * gap the "reply to enquiries" automation exists to close, and the most
     * actionable thing a morning briefing can carry.
     */
    unanswered: { count: number; people: Array<{ name: string; note?: string }> };
    /** Bookings refunded — money that has gone back out. */
    refunded: { count: number; people: Array<{ name: string; note?: string }>; value?: number; currency?: string };
    /**
     * Quotes the client said YES to today.
     *
     * The only unambiguously good news a day can contain, and the briefing
     * never carried it: an owner who won ₪8,500 of work this morning read a
     * summary about appointments and unpaid invoices.
     */
    quotesAccepted: { count: number; people: Array<{ name: string; note?: string }>; value?: number; currency?: string };
    /**
     * Quotes turned down today, and the reason given where there was one.
     *
     * `topReason` is stated as a fact about one day and never as a trend.
     * Whether declines form a PATTERN is `ConvDeclineReasonDetector`'s
     * question, and it has a quarter of evidence behind it; the briefing has
     * this morning.
     */
    quotesDeclined: {
      count: number;
      people: Array<{ name: string; note?: string }>;
      value?: number;
      currency?: string;
      topReason?: string;
    };
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

    /**
     * Phases of a quoted job the owner has not yet marked done.
     *
     * Money already agreed, on work that may well be finished, which nobody has
     * asked for — because a phase has no date and nothing was reminding them.
     * Like `quotesWaiting` this is the owner's move, and unlike `quotesOut` it is
     * something they can act on today.
     */
    stagesToBill: {
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

  const [bookingsResult, invoicesResult, paidTodayTxResult, paidTodayInvResult, nextBookingResult, newLeadsResult, gaps, instalmentsResult, decidedResult] =
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
    /*
     * The day's takings, from both places money lands.
     *
     * Read directly rather than through the repository: neither list method
     * filters on a settlement date, and "paid today" is the whole question.
     * Both are scoped to the BUSINESS's day, like everything else here.
     */
    supabaseServer
      .from('payment_transactions')
      .select('id, amount, refunded_amount, currency, invoice_id')
      .eq('user_id', userId)
      .in('status', ['succeeded', 'refunded'])
      .gte('created_at', day.startUtc)
      .lt('created_at', day.endUtc),
    supabaseServer
      .from('payment_invoices')
      .select('id, amount, refunded_amount, currency')
      .eq('user_id', userId)
      .in('status', ['paid', 'refunded', 'partially_refunded'])
      .gte('paid_at', day.startUtc)
      .lt('paid_at', day.endUtc),
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
    /*
     * `named: BRIEFING_GAP_ITEMS`, not the registry's default of three.
     *
     * `findGaps` caps `items` at the few a CARD prints names for, while keeping
     * `count` honest. The briefing needs every row to total the money over —
     * see `fromGaps`, which now refuses to publish a figure that covers only
     * some of what it counted. Asking for more items here is what lets it
     * publish one at all; the number of NAMES it prints is still three,
     * capped separately where the people are built.
     */
    findGaps(userId, { now: new Date(day.startUtc), named: BRIEFING_GAP_ITEMS }),
    /*
     * Payment-plan instalments: money owed on a SCHEDULE rather than an invoice.
     *
     * Nothing in the briefing has ever read this table. A client paying a
     * course over four months, with the next instalment due the morning of
     * their session, showed the owner nothing at all — and the question "has
     * this person paid" is exactly what an owner asks before a meeting.
     *
     * The same rows carry `retry_count` / `next_retry_at`, so a card that keeps
     * failing comes back in the same query rather than a second one.
     */
    supabaseServer
      .from('payment_plan_installments')
      .select('id, amount, currency, due_date, status, contact_id, booking_id, retry_count, next_retry_at')
      .eq('user_id', userId)
      .not('status', 'in', '("paid","cancelled","refunded")')
      .lte('due_date', day.date)
      .limit(limit),
    /*
     * Quotes the client ANSWERED today, either way.
     *
     * The one thing in a day that can be unambiguously good news, and the
     * briefing has never carried it. An owner who won ₪8,500 of work this
     * morning read a summary about appointments and unpaid invoices.
     *
     * Not from `findGaps`: a decided quote is waiting on nobody, which is
     * exactly what disqualifies it from the gap registry and exactly why it
     * needed its own read. Scoped by `decided_at` to the BUSINESS's day, like
     * every other figure here.
     */
    supabaseServer
      .from('proposals')
      .select('id, status, total, currency, decline_reason, contact:crm_contacts(first_name, last_name, email)')
      .eq('user_id', userId)
      .in('status', ['accepted', 'declined'])
      .gte('decided_at', day.startUtc)
      .lt('decided_at', day.endUtc)
      .limit(limit),
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
  const money = summariseMoney(
    invoices,
    paidTodayTxResult.data ?? [],
    paidTodayInvResult.data ?? [],
    (instalmentsResult.data ?? []) as InstalmentRow[]
  );

  if (instalmentsResult.error) {
    logger.warn(
      { err: instalmentsResult.error, userId },
      'Briefing could not read payment-plan instalments; money due on a plan will not be reported'
    );
  }

  if (decidedResult.error) {
    logger.warn(
      { err: decidedResult.error, userId },
      'Briefing could not read decided quotes; an accepted quote will go unmentioned'
    );
  }

  if (paidTodayTxResult.error || paidTodayInvResult.error) {
    logger.warn(
      { err: paidTodayTxResult.error ?? paidTodayInvResult.error, userId },
      'Briefing could not read today\'s takings; money in will read as zero'
    );
  }
  const outlook = summariseOutlook(
    appointments,
    nextBookingResult.data as BookingRow | null,
    (newLeadsResult.data ?? []) as unknown as Array<Record<string, unknown>>,
    (decidedResult.data ?? []) as unknown as DecidedProposalRow[],
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
    /*
     * Money arriving is the best thing that can happen in a day. Suppressing
     * the briefing on the day someone paid would be the worst time to be
     * silent.
     *
     * Falsy rather than `=== 0`: this flag decides whether an email is sent, and
     * a caller whose facts predate this field would otherwise make every single
     * day non-quiet and mail somebody daily. An absent figure means nothing
     * arrived, which is the safe reading.
     */
    !money.receivedToday &&
    outlook.newLeads.count === 0 &&
    // A price nobody has named is somebody still waiting. Never a quiet day.
    outlook.quotesWaiting.count === 0 &&
    /*
     * A finished phase nobody has billed is money sitting still, and the owner is
     * the only one who can move it. Same rule as an unwritten price: this is
     * never a quiet day.
     *
     * Absent-safe for the same reason `money.receivedToday` is: a caller whose
     * facts predate this field would otherwise make every day non-quiet and mail
     * somebody daily.
     */
    (outlook.stagesToBill?.count ?? 0) === 0
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
  /** Set when the booking failed to reach the owner's real calendar. */
  calendar_sync_error?: string | null;
  intake_sent_at?: string | null;
  intake_completed_at?: string | null;
  notes?: string | null;
  internal_notes?: string | null;
  client_name?: string | null;
  contact?: { first_name?: string | null; last_name?: string | null; email?: string | null } | null;
  service?: { service_name?: string | null; collection?: string | null } | null;
};

function summariseAppointments(rows: BookingRow[], day: BusinessDay): BriefingFacts['appointments'] {
  /*
   * The day's appointments, with the finished ones marked rather than dropped.
   *
   * `total` is still everything on the day — a session that has happened is
   * part of it, and removing it would make the count shrink through the
   * afternoon for no reason the reader can see.
   *
   * What a finished session is NOT is outstanding. Everything below that asks
   * "is anything being waited on" runs over the confirmed ones only, because a
   * session that already happened cannot be missing its intake and cannot be
   * unpaid-in-advance — it reported both, and told the owner to chase a client
   * who had already been and gone.
   */
  const confirmed = rows.filter(r => r.status === 'confirmed');

  /*
   * FINISHED MEANS FINISHED, on the clock as well as in the column.
   *
   * `status === 'completed'` alone is not enough. The status can be set by hand
   * at any time, and a booking marked complete before it starts made the
   * briefing state something the owner could see was false: a brief sent at
   * 07:10, whose first appointment was at 09:30, reported "1 of them is already
   * done" about an 11:00 session.
   *
   * A session cannot have finished before it began, so the start time has to
   * have passed as well. One marked complete ahead of time simply counts as an
   * ordinary appointment until its hour arrives, which is the honest reading.
   */
  const now = Date.now();
  const hasStarted = (r: BookingRow) => {
    const start = r.start_time ? Date.parse(r.start_time) : NaN;
    // Unparseable: treat as not yet started, so it is never reported as done
    // on the strength of a date nobody could read.
    return Number.isFinite(start) && start <= now;
  };

  const done = rows.filter(r => r.status === 'completed' && hasStarted(r));
  const markedDoneEarly = rows.filter(r => r.status === 'completed' && !hasStarted(r));

  /*
   * A NO-SHOW IS STILL AN APPOINTMENT THE DAY HELD.
   *
   * The client booked, the hour was reserved and it is gone — the opposite of a
   * cancellation, which hands the slot back. Excluding it from the count made
   * the briefing contradict itself the moment the no-show fact was added: one
   * real day had a cancellation at 09:00, a no-show at 09:30 and a finished
   * session at 11:00, and read as "one appointment today, at 11:00, already
   * done" beside "אופיר עומר didn't turn up" — two lines that, taken together,
   * say the 11:00 was the one nobody attended.
   *
   * The same decision the verdict card's "booked this week" already records:
   * cancelled is out, no-show is in, because the client DID book. See
   * `app/api/business-os/stats/__tests__/bookedThisWeek.guard.test.ts`.
   *
   * In the total, never in `ready` or `completed`: nothing is outstanding on it
   * and it did not happen.
   */
  const noShows = rows.filter(r => r.status === 'no_show');

  // Still part of the day, and still ahead: an early-marked booking belongs in
  // the total and in "what is coming", not in the finished count.
  const live = [...confirmed, ...done, ...markedDoneEarly, ...noShows];
  const cancelled = rows.filter(r => r.status === 'cancelled');

  /*
   * "Ready" means nothing is being waited on. A booking whose service never
   * asked for an intake is ready by default — treating a never-sent intake as
   * outstanding would report every client of a business that does not use
   * intake forms as unprepared.
   */
  const awaiting = confirmed.filter(r => r.intake_sent_at && !r.intake_completed_at);

  /*
   * Payment counts the same way intake does: outstanding only where it was
   * actually expected before the appointment. A service billed afterwards is
   * not unready — see the booking-unpaid detector, which draws the same line.
   */
  const awaitingPay = confirmed.filter(
    r => !SETTLED_PAYMENT.has((r.payment_status ?? '').toLowerCase()) &&
         (toNumber(r.payment_amount) > 0 || r.service?.collection === 'online')
  );

  /*
   * Ready means nothing outstanding of EITHER kind. Counting only intake here
   * would let the card say "all 8 are ready" on a morning when one of them
   * hasn't paid — and the unpaid line directly beneath would contradict it.
   */
  const unready = new Set([...awaiting, ...awaitingPay]);
  const ready = confirmed.length - unready.size;

  const ordered = [...live].sort(
    (a, b) => Date.parse(a.start_time ?? '') - Date.parse(b.start_time ?? '')
  );
  const firstRow = ordered[0];

  return {
    total: live.length,
    completed: done.length,
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
    /*
     * Booked, and nobody came. Reported apart from cancellations because they
     * are not the same news: a cancellation frees the slot, a no-show cost the
     * hour. The briefing carried one and was silent about the other.
     */
    noShows: noShows.map(r => ({
      name: displayName(r),
      timeLocal: timeIn(r.start_time, day.timezone),
    })),
    /*
     * Appointments that never reached the owner's real calendar.
     *
     * A count, not names: what the owner does about it is the same whichever
     * booking failed — open the calendar settings — and naming them would
     * spend a line of a six-line briefing on detail that changes nothing.
     */
    syncFailures: rows.filter(r => !!r.calendar_sync_error).length,
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
/** One row of `proposals`, as the briefing reads a decided quote. */
interface DecidedProposalRow {
  id: string;
  status: string | null;
  total: number | string | null;
  currency: string | null;
  decline_reason: string | null;
  contact?:
    | { first_name?: string | null; last_name?: string | null; email?: string | null }
    | Array<{ first_name?: string | null; last_name?: string | null; email?: string | null }>
    | null;
}

/**
 * Quotes answered today, split by the answer.
 *
 * Value is summed in ONE currency, the dominant one, for the reason every
 * other total here is: there is no FX rate anywhere in this platform.
 */
function summariseDecided(
  rows: DecidedProposalRow[],
  status: 'accepted' | 'declined'
): { count: number; people: Array<{ name: string }>; value?: number; currency?: string; topReason?: string } {
  const mine = rows.filter(row => row.status === status);
  if (mine.length === 0) return { count: 0, people: [] };

  const byCurrency = new Map<string, number>();
  for (const row of mine) {
    const amount = Number(row.total) || 0;
    if (amount <= 0) continue;
    const code = (row.currency || 'USD').toUpperCase();
    byCurrency.set(code, (byCurrency.get(code) ?? 0) + amount);
  }
  const dominant = [...byCurrency.entries()].sort((a, b) => b[1] - a[1])[0];

  /*
   * The reason, only when every decline today agrees on it.
   *
   * One day is not a sample. "Two were turned down, one on price and one on
   * timing" is two anecdotes, and picking the first would be arbitrary.
   * Whether declines form a pattern belongs to `ConvDeclineReasonDetector`,
   * which has a quarter behind it.
   */
  const reasons = new Set(mine.map(row => row.decline_reason).filter(Boolean));
  const topReason = reasons.size === 1 ? ([...reasons][0] as string) : undefined;

  return {
    count: mine.length,
    people: mine
      .map(row => {
        const contact = Array.isArray(row.contact) ? row.contact[0] : row.contact;
        const full = [contact?.first_name, contact?.last_name].filter(Boolean).join(' ').trim();
        return { name: full || contact?.email?.trim() || '' };
      })
      .filter(person => person.name.length > 0),
    ...(dominant ? { value: dominant[1], currency: dominant[0] } : {}),
    ...(status === 'declined' && topReason ? { topReason } : {}),
  };
}

function summariseOutlook(
  appointments: BriefingFacts['appointments'],
  nextRow: BookingRow | null,
  newLeadRows: Array<Record<string, unknown>>,
  decidedRows: DecidedProposalRow[],
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
    /*
     * Somebody wrote in and has still had no reply — whenever they wrote.
     *
     * `newLeads` above counts contacts created TODAY, so an enquiry that
     * arrived on Friday and was never answered was invisible on Monday
     * morning. It is the most actionable thing a briefing can carry, and it is
     * the gap the "reply to enquiries" automation exists to close — the
     * dashboard has counted it all along and the briefing never said it.
     */
    /* The day's good news, ahead of everything that needs chasing. */
    quotesAccepted: summariseDecided(decidedRows, 'accepted'),
    quotesDeclined: summariseDecided(decidedRows, 'declined'),
    unanswered: fromGaps(gaps, ['enquiry_unanswered']),
    /* Money that has gone back out. Also counted by the dashboard, also unsaid. */
    refunded: fromGaps(gaps, ['booking_refunded']),
    quotesWaiting: fromGaps(gaps, ['quote_unwritten', 'quote_unsent']),
    /* Out with the client, who has not answered. News, not an errand. */
    quotesOut: fromGaps(gaps, ['quote_awaiting_client']),
    /*
     * Named explicitly, because `fromGaps` is the only route a gap has into the
     * briefing. Adding a definition to the registry does NOT surface it here —
     * the narrator reads these groups, not the gap list — so a new gap that is
     * not mapped is found, counted by the dashboard, and never mentioned.
     */
    stagesToBill: fromGaps(gaps, ['stage_awaiting_completion']),
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

  const count = matching.reduce((sum, gap) => sum + gap.count, 0);

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE COUNT AND THE MONEY HAVE TO DESCRIBE THE SAME ROWS.
   *
   * `count` is the truth about how many — `findGaps` keeps it uncapped on
   * purpose. `items` is NOT: it is `stale.slice(0, named)`, capped at the few
   * the briefing will print names for.
   *
   * Summing the money over `items` while taking the count from `gap.count`
   * reports N things worth the value of a handful. A real briefing on
   * 2026-10-02 said "6 stages waiting, ₪224.97" about six stages of ₪74.99 —
   * the count of all six beside the sum of three. Six of them come to ₪449.94,
   * and neither number was wrong on its own.
   *
   * So the total is published only when `items` covers every row the count
   * includes. Fewer names than rows means no figure rather than a partial one
   * presented as a total: a count with no money attached is incomplete, while a
   * count with the WRONG money attached is false, and an owner cannot tell.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const itemsCoverAll = items.length === count;
  const reportTotal = byCurrency.size === 1 && dominant && itemsCoverAll;

  return {
    count,
    people: items
      .slice(0, NEW_LEAD_NAMES)
      .map(item => ({ name: item.name, note: item.note })),
    ...(reportTotal ? { value: Math.round(dominant[1] * 100) / 100, currency: dominant[0] } : {}),
  };
}


/**
 * How many names the briefing will print before it just counts.
 *
 * Three is a sentence; six is a list nobody reads in a summary card.
 */
const NEW_LEAD_NAMES = 3;

/**
 * How many rows per gap the briefing reads, as opposed to names it prints.
 *
 * Fifty. The money has to be summed over everything the count includes or the
 * two disagree, and a business with sixty stages waiting is one whose figure
 * matters most. Above this the total is withheld rather than understated — see
 * `fromGaps` — which is the honest direction for a number an owner will act on.
 */
const BRIEFING_GAP_ITEMS = 50;

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

/** One settled row, reduced to what the day's total needs. */
interface SettledRow {
  id?: unknown;
  amount?: number | string | null;
  refunded_amount?: number | string | null;
  currency?: string | null;
  invoice_id?: unknown;
}

/**
 * What arrived today, counted once.
 *
 * A card payment and the invoice it settles are the same money in two tables.
 * Summing both would report £500 as £1,000 on exactly the days an owner is
 * most likely to check — so an invoice already referenced by one of today's
 * transactions is dropped, which is the rule the stats route applies to the
 * same pair.
 *
 * Net of refunds, because a refunded payment is money that came and went.
 */
function takingsFor(
  transactions: SettledRow[],
  invoices: SettledRow[]
): { total: number; count: number; currency?: string } {
  const settledByTransaction = new Set(
    transactions.map(t => (t.invoice_id ? String(t.invoice_id) : '')).filter(Boolean)
  );

  const counted = [
    ...transactions,
    ...invoices.filter(i => !settledByTransaction.has(String(i.id))),
  ];

  let total = 0;
  let count = 0;
  for (const row of counted) {
    const net = toNumber(row.amount) - toNumber(row.refunded_amount);
    if (net <= 0) continue;
    total += net;
    count += 1;
  }

  return {
    total: Math.round(total * 100) / 100,
    count,
    currency: counted.find(r => r.currency)?.currency ?? undefined,
  };
}

/** One row of `payment_plan_installments`, as the briefing reads it. */
interface InstalmentRow {
  amount?: number | string | null;
  currency?: string | null;
  due_date?: string | null;
  status?: string | null;
  contact_id?: string | null;
  booking_id?: string | null;
  retry_count?: number | null;
  next_retry_at?: string | null;
}

/**
 * The earlier of two due dates, either of which may be absent.
 *
 * An absent date is not "far away" — it is unknown, and must never win over a
 * real one, or a debt due today disappears from a morning briefing behind a
 * sibling invoice that carries no date at all.
 */
function earliest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
}

/**
 * Exported for the tests that hold the per-person grouping. Not part of the
 * module's contract — `buildBriefingFacts` is.
 */
export function summariseMoney(
  rows: InvoiceRow[],
  paidTodayTransactions: SettledRow[],
  paidTodayInvoices: SettledRow[],
  /** Plan instalments already due and unpaid. Money owed on a schedule. */
  instalments: InstalmentRow[]
): BriefingFacts['money'] {
  const perInvoice: OwedAmount[] = rows
    .map(row => {
      const gross = toNumber(row.amount);
      const refunded = toNumber(row.refunded_amount);
      const outstanding = gross - refunded;

      return {
        name: (row.contact_name || row.client_name || '').trim(),
        amount: outstanding,
        currency: (row.currency || 'USD').toUpperCase(),
        overdue: row.status === 'overdue',
        dueDate: row.due_date ?? null,
      };
    })
    .filter(entry => entry.amount > 0 && entry.name.length > 0);

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * ONE ENTRY PER PERSON, NOT PER INVOICE.
   *
   * `owed` was a list of invoices, and everything downstream read it as a list
   * of people. A real account on 2026-09-27 had two unpaid invoices for דויד
   * המלך (₪4,250 each) and one for אופיר עומר (₪300), and the briefing said
   * "3 clients owe you ₪8,800" about TWO clients. The sum was right; the noun
   * was wrong, which is worse — the owner reads the number and trusts it.
   *
   * It fixed the list form too: naming two debts individually printed דויד
   * המלך twice, on consecutive lines, differing in nothing a reader could see.
   *
   * Grouped by person AND currency, because a client billed in two currencies
   * is two amounts that must never be added — the same rule the totals below
   * follow.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const byPerson = new Map<string, OwedAmount>();
  for (const entry of perInvoice) {
    const key = `${entry.name}\u0000${entry.currency}`;
    const seen = byPerson.get(key);

    if (!seen) {
      byPerson.set(key, { ...entry });
      continue;
    }

    seen.amount += entry.amount;
    // Late anywhere is late: one overdue invoice makes the person overdue.
    seen.overdue = seen.overdue || entry.overdue;
    // The SOONEST date, so a debt half of which falls due today is not filtered
    // out of the briefing as "not for six weeks".
    seen.dueDate = earliest(seen.dueDate, entry.dueDate);
  }

  const owed = [...byPerson.values()];

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

  const takings = takingsFor(paidTodayTransactions, paidTodayInvoices);

  return {
    owed: owed.sort((a, b) => b.amount - a.amount),
    totalOwed: dominant?.[1] ?? 0,
    // The day's takings name their own currency where there is one, so a
    // business owed nothing still reports what came in with the right symbol.
    currency: dominant?.[0] ?? takings.currency ?? 'USD',
    mixedCurrency: byCurrency.size > 1,
    receivedToday: takings.total,
    receivedCount: takings.count,
    /*
     * Instalments are money owed too, and on a different clock.
     *
     * Kept apart from `owed` rather than merged into it: an invoice is chased
     * as a whole, an instalment is one step of an arrangement the client is
     * keeping to. Telling an owner "Dana owes ₪1,200" when Dana is three
     * payments into a four-payment plan misrepresents a client who is paying.
     */
    instalmentsDue: instalments
      .filter(i => (Number(i.amount) || 0) > 0)
      .map(i => ({
        amount: Number(i.amount) || 0,
        currency: (i.currency || 'USD').toUpperCase(),
        dueDate: i.due_date ?? null,
      })),
    // A card that failed and is queued to try again. A count: what the owner
    // does about it is the same however many there are.
    retrying: instalments.filter(i => (Number(i.retry_count) || 0) > 0).length,
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
