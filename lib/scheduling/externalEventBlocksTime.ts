/**
 * Does a synced calendar event actually take the time it covers?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * `external_calendar_events` exists to answer one question — is this hour free
 * — and every event the sync saw was treated as a commitment. A BIRTHDAY
 * imported from Google Contacts is an all-day event, and an all-day event runs
 * midnight to midnight, so one birthday closed an entire working day.
 *
 * Found on a live account: "יום הולדת שמח!" on Monday 16 November 2026, all
 * day, against an owner whose Monday is open 09:00 to 19:00 with nothing
 * booked. The owner read the day as fully busy and had no way to see why: the
 * event is not a booking, so it appears nowhere in the product except as an
 * absence of free slots.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE PROVIDERS ACTUALLY SAY
 *
 * Google answers twice, and both answers were being dropped before they
 * reached us:
 *
 *   transparency   'transparent' is Google's word for "shows as Free". The
 *                  field is ABSENT on an ordinary meeting, where the default
 *                  is opaque — so only the explicit value may be trusted, and
 *                  a missing field must never be read as free.
 *   eventType      'birthday', 'workingLocation' and 'focusTime' are markers
 *                  rather than commitments. Google's own UI does not treat
 *                  them as busy, and neither should a booking page.
 *
 * `outOfOffice` is deliberately NOT in that list. It is the one event type
 * that genuinely means "do not book me".
 *
 * Microsoft Graph says the same thing in `showAs`, which the Outlook executor
 * does not currently select. Handled here anyway, so the day it is added this
 * rule already covers it rather than needing to be found again.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DEFAULT IS BUSY
 *
 * Every unknown shape blocks. An event we cannot classify is far more likely
 * to be a real commitment than a marker, and the cost of the two mistakes is
 * not symmetric: wrongly blocking an hour loses a booking the owner can still
 * take by hand, while wrongly freeing one double-books them in front of a
 * client.
 *
 * @module lib/scheduling/externalEventBlocksTime
 */

/** The fields this reads. Any event shape carrying them will do. */
export interface ExternalEventBusyFacts {
  /** Google: 'transparent' means it shows as free. */
  transparency?: string | null;
  /** Google: 'birthday', 'workingLocation', 'focusTime', 'outOfOffice'. */
  event_type?: string | null;
  /** The camelCase twin the executors also emit. */
  eventType?: string | null;
  /** Microsoft Graph: 'free', 'busy', 'tentative', 'oof', 'workingElsewhere'. */
  showAs?: string | null;
}

/**
 * Google event types that mark the calendar rather than claim the time.
 *
 * `outOfOffice` is absent on purpose: it is a commitment, and the one type in
 * this family that must keep blocking.
 */
const MARKER_EVENT_TYPES = new Set(['birthday', 'workingLocation', 'focusTime']);

/** Microsoft `showAs` values that do not take the time. */
const FREE_SHOW_AS = new Set(['free', 'workingelsewhere']);

export function blocksTime(event: ExternalEventBusyFacts | null | undefined): boolean {
  if (!event) return true;

  /* Google, explicitly free. */
  if (String(event.transparency ?? '').toLowerCase() === 'transparent') return false;

  const type = String(event.event_type ?? event.eventType ?? '').trim();
  if (type && MARKER_EVENT_TYPES.has(type)) return false;

  /* Microsoft, when the executor starts selecting it. */
  if (FREE_SHOW_AS.has(String(event.showAs ?? '').toLowerCase())) return false;

  return true;
}
