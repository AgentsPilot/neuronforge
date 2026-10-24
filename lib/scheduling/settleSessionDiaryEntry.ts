/**
 * What becomes of a session's diary entry once somebody says what happened.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE RULE, AND IT IS NOT ABOUT THE OUTCOME
 *
 * The question that decides it is whether the hour can still be SOLD, not what
 * the outcome was called:
 *
 *   · called off, hour still ahead  → DELETE the entry.
 *     This is the only case that costs money to get wrong. The hour is now
 *     genuinely free and bookable, so a leftover entry has the owner turning
 *     down another client for a meeting that is not happening. Availability is
 *     computed from our own rows and never reads the connected calendar, so the
 *     two would disagree in the one direction that loses work. Nothing is lost
 *     by deleting: the cancellation is on the session row, on the client's
 *     timeline, and in the email they were sent.
 *
 *   · called off, hour already past → KEEP it, labelled.
 *     Nothing can be booked into a past hour, so deleting only erases the
 *     owner's own record of the day.
 *
 *   · missed (`no_show`)            → KEEP it, labelled.
 *     The most useful of the three. It is a true record that someone booked
 *     the time and did not come, sitting where the owner naturally looks, and
 *     it makes a repeat no-show obvious without opening the CRM.
 *
 *   · held                          → LEAVE IT ALONE.
 *     An ordinary appointment that happened. Nothing to say.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS A MODULE
 *
 * Two callers apply it: the per-session outcome route, and stopping a whole
 * package, which runs it once per session. Written twice they would drift, and
 * the expensive half of the rule is the future/past test rather than the call
 * to the calendar.
 *
 * NEVER THROWS. Every caller has already recorded the outcome by the time it
 * runs. A stale diary entry is visible and fixable by hand; a thrown error
 * would tell the owner the cancellation itself had failed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { defaultLocale, isValidLocale, type Locale } from '@/lib/i18n/config';
import { createLogger } from '@/lib/logger';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import type { CalendarEventRow } from '@/lib/services/CalendarSyncService';
import type { SchedulingBooking, SchedulingService } from '@/lib/repositories/SchedulingRepository';

const logger = createLogger({ module: 'SettleSessionDiaryEntry' });

/** What the owner reads in front of the title, in the business's own language. */
const OUTCOME_LABEL: Record<'cancelled' | 'no_show', Record<Locale, string>> = {
  cancelled: { en: 'Cancelled', he: 'בוטל', es: 'Cancelada' },
  no_show: { en: 'No-show', he: 'לא הגיע', es: 'No asistió' },
};

export type SettledOutcome = 'cancelled' | 'no_show' | 'held';

export interface SettleSessionDiaryEntryInput {
  /** The job the session belongs to. For a package this is the purchase. */
  booking: SchedulingBooking;
  /** Needed to rebuild the title when the entry is kept. */
  service: SchedulingService;
  userId: string;
  /**
   * The session's own row, which is where a package's event id lives.
   *
   * Required: this module exists for sessions. An ordinary booking's event is
   * handled by the booking paths that have always handled it.
   */
  meeting: CalendarEventRow & { start_time?: string | null; end_time?: string | null };
  outcome: SettledOutcome;
  /**
   * The business's language, for the label.
   *
   * Optional, and resolved here when it is absent. Both callers would
   * otherwise have reached for `getBusinessLocale`, which lives in
   * `BookingEmailService` — a module that statically imports the scheduling
   * repository, so one of those callers would have been importing its own
   * importer to read one column. The profile is where the answer is.
   */
  locale?: Locale;
  /** Injected in tests; `now` everywhere else. */
  now?: Date;
}

export type SettleSessionDiaryEntryResult =
  | { action: 'deleted' | 'labelled'; ok: boolean; error?: string }
  | { action: 'left'; ok: true };

/**
 * The business's own language, which is whose calendar this is.
 *
 * Not the client's: the label is read by the owner, in their diary. A clinic
 * working in Hebrew with an English-speaking client wants "לא הגיע", because
 * that is the word they scan for.
 */
async function businessLocale(input: SettleSessionDiaryEntryInput): Promise<Locale> {
  if (input.locale) return input.locale;

  try {
    const { data } = await businessProfileRepository.findByUserId(input.userId);
    const language = data?.language;
    return language && isValidLocale(language) ? (language as Locale) : defaultLocale;
  } catch (err) {
    /* A label in the wrong language is worth far less than a thrown error on a
       cancellation, so the default stands in silently. */
    logger.warn({ err, userId: input.userId }, 'Could not read the business language for a label');
    return defaultLocale;
  }
}

export async function settleSessionDiaryEntry(
  input: SettleSessionDiaryEntryInput
): Promise<SettleSessionDiaryEntryResult> {
  const { booking, service, userId, meeting, outcome } = input;

  /* No entry, nothing to settle. The common case for a business with no
     calendar connected, and not a failure. */
  if (!meeting.external_calendar_event_id) return { action: 'left', ok: true };

  if (outcome === 'held') return { action: 'left', ok: true };

  const now = input.now ?? new Date();
  const startsAt = meeting.start_time ? new Date(meeting.start_time) : null;
  /*
   * A session with no time cannot be in the future, so it is treated as past
   * and labelled rather than deleted. Deleting on missing data would be the
   * destructive reading of an unknown.
   */
  const stillAhead = Boolean(
    startsAt && !Number.isNaN(startsAt.getTime()) && startsAt.getTime() > now.getTime()
  );

  const event: CalendarEventRow = {
    id: meeting.id,
    external_calendar_event_id: meeting.external_calendar_event_id,
    calendar_sync_provider: meeting.calendar_sync_provider,
  };

  try {
    const { CalendarSyncService } = await import('@/lib/services/CalendarSyncService');

    if (outcome === 'cancelled' && stillAhead) {
      const sync = await CalendarSyncService.deleteCalendarEvent(booking, userId, event);

      if (!sync.success) {
        logger.warn(
          { bookingId: booking.id, meetingId: meeting.id, error: sync.error },
          'A session was called off but its diary entry is still there'
        );
      }

      return { action: 'deleted', ok: sync.success, error: sync.error };
    }

    /*
     * Kept, and retitled. The times are the SESSION's: the update reads them
     * off the booking it is handed, and a package's purchase carries no clock
     * at all, so without this the entry would be rewritten to nothing.
     */
    const sync = await CalendarSyncService.updateCalendarEvent(
      {
        ...booking,
        start_time: meeting.start_time ?? booking.start_time,
        end_time: meeting.end_time ?? booking.end_time,
      },
      service,
      userId,
      event,
      OUTCOME_LABEL[outcome][await businessLocale(input)] ?? OUTCOME_LABEL[outcome].en
    );

    if (!sync.success) {
      logger.warn(
        { bookingId: booking.id, meetingId: meeting.id, outcome, error: sync.error },
        "A session's diary entry still reads as though nothing happened"
      );
    }

    return { action: 'labelled', ok: sync.success, error: sync.error };
  } catch (err) {
    logger.error(
      { err, bookingId: booking.id, meetingId: meeting.id, outcome },
      "Settling a session's diary entry threw"
    );
    return { action: stillAhead && outcome === 'cancelled' ? 'deleted' : 'labelled', ok: false };
  }
}
