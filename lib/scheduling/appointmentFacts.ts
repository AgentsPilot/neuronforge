/**
 * How many appointments there are, and how they turned out.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE REPORTS COULD NOT ANSWER THIS
 *
 * A booking used to BE an appointment, so counting bookings counted
 * appointments. A package is now one booking with N rows in
 * `scheduling_meetings`, and the container carries no hour of its own —
 * `start_time` is NULL.
 *
 * Every count in `/api/business-os/stats` still asked the bookings, filtered by
 * `start_time`. In SQL `start_time >= X` is FALSE for NULL, so every package
 * dropped out silently. Measured 2026-10-29 on one account: the dashboard
 * reported 4 upcoming appointments where 13 were really open — nine of them
 * sessions the owner was expected to attend.
 *
 * Nothing was missing from the database. The reporting layer had never learned
 * to ask the table that holds the answer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO RULES, AND THEY ARE THE WHOLE CORRECTNESS STORY
 *
 * 1. UNION, NEVER A SWAP.
 *
 *    Counting from `scheduling_meetings` alone is the obvious fix and it is
 *    wrong. Platform-wide, 26 dated bookings have no meeting row at all —
 *    legacy rows from before the split. On the account this was developed
 *    against there are none, so a meetings-only count looks perfect here and
 *    quietly loses 26 real appointments elsewhere.
 *
 *    So: every meeting, PLUS every dated booking that has no meeting row. The
 *    orphan half is found the way `busyMeetings` finds it — an embedded
 *    `scheduling_meetings(id)` and a filter on the result, one round trip
 *    rather than two.
 *
 *    A booking with no date AND no meeting is not an appointment at all. Those
 *    are unscheduled services — work sold without an hour — and 16 of the 19
 *    undated bookings on that account are exactly that. They belong in revenue,
 *    never in an appointment count.
 *
 * 2. `moved` IS NOT AN APPOINTMENT.
 *
 *    A moved row is a superseded attempt, and its replacement is on the table
 *    beside it: `session#1 occurrence#1 moved` sits next to
 *    `session#1 occurrence#2 held`. Counting both turns one appointment into
 *    two.
 *
 *    `bookingStatus.ts` states the other half of this hazard where `moved` is
 *    defined: collapsing it into `cancelled` "reports every moved appointment
 *    as a lost one". So it is excluded from the totals and never tallied as an
 *    outcome — a reschedule is neither a loss nor an extra booking.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'appointmentFacts' });

/**
 * Bookings whose hour is real enough to count as an appointment.
 *
 * The same three the overlap constraint uses (`SLOT_HOLDING_STATUSES`), minus
 * nothing: a cancelled or no-show booking still HAPPENED in the period and
 * belongs in "appointments in the last 30 days". Callers that want only live
 * ones ask `upcomingAppointments`, which is explicit about it.
 */
const COUNTABLE_BOOKING_STATUSES = ['confirmed', 'pending', 'completed', 'cancelled', 'no_show'];

/** One appointment, however it is stored. */
interface AppointmentRow {
  /** `null` when nobody has said what happened yet. */
  status: string | null;
  start_time: string;
  /** The meeting's own id, absent for a booking counted without one. */
  meetingId: string | null;
}

export interface AppointmentOutcomes {
  /** Nobody has said what happened yet — the normal state of a future hour. */
  open: number;
  held: number;
  no_show: number;
  cancelled: number;
  /**
   * Missed appointments that a later one stands in for, and those still
   * waiting on somebody.
   *
   * No count can separate these without `replaces_meeting_id` (migration
   * 20261095): on a package with two missed sessions, one made up and one not,
   * both read identically through any aggregate. That is the distinction the
   * column exists to make, and this is the first reader to use it.
   */
  no_show_made_up: number;
  no_show_outstanding: number;
}

/**
 * Every appointment for `userId` whose hour falls in `[from, to)`.
 *
 * Fails SOFT: an unreadable half logs and contributes nothing, because a
 * reporting number that is low is better than a dashboard that will not load.
 * That is the opposite of the choice `busyMeetings` makes for the same shape of
 * query, and deliberately so — there, a missing row double-books a room; here
 * it understates a figure.
 *
 * @param userId CLAUDE.md rule 4. Never optional on either half.
 */
async function appointmentsBetween(
  client: SupabaseClient,
  userId: string,
  from: string,
  to?: string
): Promise<AppointmentRow[]> {
  let meetingQuery = client
    .from('scheduling_meetings')
    .select('id, start_time, meeting_status')
    .eq('user_id', userId)
    .gte('start_time', from)
    /* Rule 2. Never counted, never tallied. */
    .or('meeting_status.is.null,meeting_status.neq.moved');

  if (to) meetingQuery = meetingQuery.lt('start_time', to);

  const { data: meetingRows, error: meetingError } = await meetingQuery;

  if (meetingError) {
    logger.error({ err: meetingError, userId, from, to }, 'Could not read meetings for a count');
  }

  const appointments: AppointmentRow[] = (meetingRows ?? []).map(row => {
    const r = row as { id: string; start_time: string; meeting_status: string | null };
    return { status: r.meeting_status, start_time: r.start_time, meetingId: r.id };
  });

  /*
   * Rule 1. The embedded child is how `busyMeetings` asks the same question —
   * the rows with an empty `scheduling_meetings` array are the orphans, and
   * PostgREST answers both halves in one trip.
   */
  let orphanQuery = client
    .from('scheduling_bookings')
    .select('id, start_time, status, meeting_status, scheduling_meetings(id)')
    .eq('user_id', userId)
    .gte('start_time', from)
    .in('status', COUNTABLE_BOOKING_STATUSES);

  if (to) orphanQuery = orphanQuery.lt('start_time', to);

  const { data: bookingRows, error: bookingError } = await orphanQuery;

  if (bookingError) {
    logger.error({ err: bookingError, userId, from, to }, 'Could not read bookings for a count');
    return appointments;
  }

  const orphans = (bookingRows ?? []).filter(
    row => !((row as { scheduling_meetings?: unknown[] }).scheduling_meetings ?? []).length
  );

  for (const row of orphans) {
    const r = row as { start_time: string; status: string; meeting_status: string | null };
    appointments.push({
      /*
       * The booking's own outcome where it has one. A legacy row records what
       * happened on `meeting_status` when the owner marked it and on `status`
       * otherwise, so the mirror is read first and the job status second.
       */
      status: r.meeting_status ?? (r.status === 'completed' ? 'held' : r.status),
      start_time: r.start_time,
      meetingId: null,
    });
  }

  return appointments;
}

/** How many appointments fall in `[from, to)`. */
export async function appointmentsInRange(
  client: SupabaseClient,
  userId: string,
  from: string,
  to?: string
): Promise<number> {
  return (await appointmentsBetween(client, userId, from, to)).length;
}

/**
 * Appointments still to come that nobody has settled.
 *
 * "Open" is `status === null` — see the note on NULL in `bookingStatus.ts`. It
 * cannot be written as "not cancelled and not no_show", because in SQL
 * `NULL NOT IN (…)` is NULL rather than true and every unmarked future hour
 * would vanish, which is the bug this whole module exists to undo.
 */
export async function upcomingAppointments(
  client: SupabaseClient,
  userId: string,
  nowIso: string
): Promise<number> {
  const ahead = await appointmentsBetween(client, userId, nowIso);
  return ahead.filter(a => a.status === null).length;
}

/**
 * How the appointments in a period turned out.
 *
 * Counts SESSIONS, which is the point: a package whose container reads
 * `confirmed` can hold six cancelled sessions, and the booking-level status the
 * reports used to read said the business was healthy.
 */
export async function appointmentOutcomes(
  client: SupabaseClient,
  userId: string,
  from: string,
  to?: string
): Promise<AppointmentOutcomes> {
  const appointments = await appointmentsBetween(client, userId, from, to);

  const outcomes: AppointmentOutcomes = {
    open: 0,
    held: 0,
    no_show: 0,
    cancelled: 0,
    no_show_made_up: 0,
    no_show_outstanding: 0,
  };

  for (const a of appointments) {
    if (a.status === null) outcomes.open++;
    else if (a.status === 'held') outcomes.held++;
    else if (a.status === 'no_show') outcomes.no_show++;
    else if (a.status === 'cancelled') outcomes.cancelled++;
    /* Anything else — `moved` is already filtered — is not an outcome. */
  }

  if (outcomes.no_show === 0) return outcomes;

  /*
   * Which of those misses have been made good.
   *
   * Asked without a date window on purpose: the replacement for a session
   * missed in September may sit in November, and a range here would report it
   * as still outstanding. The set is small — one row per make-up ever made.
   */
  const { data: replacements, error } = await client
    .from('scheduling_meetings')
    .select('replaces_meeting_id')
    .eq('user_id', userId)
    .not('replaces_meeting_id', 'is', null);

  if (error) {
    /*
     * Leave both at zero rather than guess. Reporting every miss as outstanding
     * would invent chasing work; reporting them all as made up would hide it.
     */
    logger.error({ err: error, userId }, 'Could not read make-up sessions');
    return outcomes;
  }

  const madeGood = new Set(
    (replacements ?? [])
      .map(r => (r as { replaces_meeting_id: string | null }).replaces_meeting_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  );

  for (const a of appointments) {
    if (a.status !== 'no_show') continue;
    if (a.meetingId && madeGood.has(a.meetingId)) outcomes.no_show_made_up++;
    else outcomes.no_show_outstanding++;
  }

  return outcomes;
}
