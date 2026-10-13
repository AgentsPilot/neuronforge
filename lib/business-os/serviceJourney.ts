/**
 * What actually happens to a client who buys this service, in order.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT EXISTS
 *
 * The service editor shows about fifteen controls and, until `serviceMoneyLine`,
 * never said what any combination of them added up to. That module answered the
 * money half. This answers the rest: whether a time is held, how far ahead and
 * how late a client can book, what the diary gives up for one booking, and what
 * the client is asked for afterwards.
 *
 * The owner's question is never "what is `min_notice_hours`". It is "if someone
 * finds this at nine at night, what happens". A row of numbered fields cannot
 * answer that; a short account of the journey can.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO RULES THIS FOLLOWS, BOTH BORROWED FROM `serviceMoneyLine`
 *
 * 1. KEYS AND FIGURES, NEVER PROSE. The editor is read in three languages, and
 *    a sentence assembled from fragments in code cannot be translated. Every
 *    step returns a key under `scheduling.journey.*` and the numbers to put in
 *    it. Nothing here is a string a human reads.
 *
 * 2. ONLY WHAT IS WORTH SAYING. A line repeating a default is noise, and noise
 *    is what stops the useful lines being read: "clients can book up to 30 days
 *    ahead" is the platform default and tells the owner nothing, while the same
 *    sentence saying 3 is the whole point. Steps that match the default are
 *    dropped, EXCEPT the two that always matter -- whether a time is held, and
 *    how the money arrives -- because those are the questions being asked.
 *
 * Pure, and separate from the component, so the branches can be tested without
 * rendering anything. The ordering is the client's own: find it, book it, pay
 * for it, hear from you.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/serviceJourney
 */

/** The platform's own answers, and therefore the ones not worth a sentence. */
export const JOURNEY_DEFAULTS = {
  advanceBookingDays: 30,
  minNoticeHours: 24,
  bufferMinutes: 0,
  maxBookingsPerDay: null as number | null,
} as const;

export interface JourneyInput {
  /** Whether buying this holds a time in the diary. */
  isScheduled: boolean;
  /** Minutes the appointment itself runs. Null for anything unscheduled. */
  durationMinutes: number | null;
  /** Minutes kept clear after it, on top of the duration. */
  bufferMinutes: number | null;
  /** How far ahead a client may book. */
  advanceBookingDays: number | null;
  /** How close to the start a client may still book. */
  minNoticeHours: number | null;
  /** A ceiling on bookings in one day, or null for none. */
  maxBookingsPerDay: number | null;
}

export interface JourneyStep {
  /** Appended to `scheduling.journey.` to get the copy. */
  key: JourneyKey;
  /** Figures for the sentence. Absent where the sentence takes none. */
  values?: Record<string, number>;
}

export type JourneyKey =
  /** A time is held in the diary. */
  | 'holds_time'
  /** Nothing is held: they buy and begin. */
  | 'no_time'
  /** How long the appointment runs. */
  | 'runs_for'
  /** And what it costs the diary beyond that. */
  | 'runs_for_with_buffer'
  /** How far ahead they may book, when it is not the default. */
  | 'books_ahead'
  /** How late they may still book, when it is not the default. */
  | 'books_until'
  /** Same day booking, which is `minNoticeHours` of zero and reads differently. */
  | 'books_same_day'
  /** A ceiling on how many land in one day. */
  | 'caps_per_day';

/**
 * The journey, as an ordered list of things worth saying.
 *
 * Money is NOT included: `serviceMoneyLine` already answers it and is already
 * rendered. Two modules answering the same question is how they come to
 * disagree.
 */
export function serviceJourney(input: JourneyInput): JourneyStep[] {
  const steps: JourneyStep[] = [];

  /*
   * Whether a time is held is the first thing and is always said, default or
   * not: it decides whether every line after it is even relevant, and it is the
   * one setting an owner can change by accident and not notice.
   */
  if (!input.isScheduled) {
    steps.push({ key: 'no_time' });
    // Nothing below applies to something with no appointment. An unscheduled
    // service has no duration to spend, no window to book in, and no day to
    // fill up -- saying otherwise would describe a diary it never touches.
    return steps;
  }

  steps.push({ key: 'holds_time' });

  const duration = positive(input.durationMinutes);
  const buffer = positive(input.bufferMinutes);

  if (duration) {
    steps.push(
      buffer
        ? { key: 'runs_for_with_buffer', values: { minutes: duration, buffer, total: duration + buffer } }
        : { key: 'runs_for', values: { minutes: duration } }
    );
  }

  const ahead = positive(input.advanceBookingDays);
  if (ahead && ahead !== JOURNEY_DEFAULTS.advanceBookingDays) {
    steps.push({ key: 'books_ahead', values: { days: ahead } });
  }

  /*
   * Notice is the one where zero is a REAL answer rather than an absent one:
   * it means a client can book the next slot going, which is a decision worth
   * reading back. `positive()` would throw it away as falsy, so it is tested
   * for explicitly and gets its own sentence.
   */
  const notice = input.minNoticeHours;
  if (notice === 0) {
    steps.push({ key: 'books_same_day' });
  } else if (positive(notice) && notice !== JOURNEY_DEFAULTS.minNoticeHours) {
    steps.push({ key: 'books_until', values: { hours: notice as number } });
  }

  const cap = positive(input.maxBookingsPerDay);
  if (cap) steps.push({ key: 'caps_per_day', values: { count: cap } });

  /*
   * NOT HERE: the intake form. `scheduling_services` has no column for it --
   * intake is configured for the business, not per service -- so a line about
   * it would be invented rather than read. Verified against the live schema
   * rather than assumed.
   */
  return steps;
}

/** A number only when it is one, and only when it is above zero. */
function positive(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
