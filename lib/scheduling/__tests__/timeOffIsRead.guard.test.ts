/**
 * Every surface that publishes a bookable hour must read time off.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `scheduling_availability_exceptions` sat in the schema from July 2026 with
 * full RLS and nothing read it — so a business closed for a holiday went on
 * offering slots for it, and the owner's only defence was to notice and cancel.
 * The fix was to make `windowsForDate` the one answer to "what are this date's
 * hours" and route every surface through it.
 *
 * This is a source-level guard because each of these bodies needs a request, a
 * profile, a service and a timezone before it says anything — and what went
 * wrong was a missing argument, which is exactly what a reader can check.
 *
 * `windowsForDay` is deliberately still exported and still used by
 * `publicBranding` for the WEEKLY opening hours a website displays. That is a
 * pattern, not a date, so it has no time off to apply.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THE SURFACES THAT TAKE A BOOKING — added 2026-10-01.
 *
 * The first round covered everything that PUBLISHES an hour and nothing that
 * takes one, so the owner could close 7 October and then book a client into it
 * from their own calendar. The three below are that other half: the grid that
 * draws the day, the dialog that offers the times, and the service that writes
 * the row.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');

const website = read('app', 'api', 'website', 'booking', 'availability', 'route.ts');
const smartLink = read('app', 'api', 'conversion', '[userCode]', 'availability', 'route.ts');
const openTime = read('lib', 'scheduling', 'openTime.ts');
const windows = read('lib', 'scheduling', 'availabilityWindows.ts');
const calendar = read('components', 'scheduling', 'SchedulingCalendarView.tsx');
const dialog = read('components', 'scheduling', 'SchedulingBookingModal.tsx');
const lifecycle = read('lib', 'services', 'BookingLifecycleService.ts');
const ownerUpdate = read('app', 'api', 'scheduling', 'bookings', '[id]', 'route.ts');
const publicCreate = read('app', 'api', 'website', 'booking', 'create', 'route.ts');
const quoteRequest = read('app', 'api', 'website', 'proposal-request', 'route.ts');
const rescheduleSlots = read('app', 'api', 'website', 'scheduling', 'availability', 'route.ts');
const clientReschedule = read('app', 'api', 'book', 'manage', '[token]', 'reschedule', 'route.ts');

describe('the public booking page', () => {
  it('resolves hours per DATE, not per weekday', () => {
    expect(website).toContain('windowsForDate(availabilitySettings, dateStr, timeOff)');
  });

  it('reads the closed days once, outside the day loop', () => {
    // One request, not `daysAhead` of them: the answer is the same for every
    // day the loop walks.
    expect(website).toContain('schedulingTimeOffRepository.list(ownerId');
  });

  it('publishes the ordinary hours when the table cannot be read', () => {
    // The safer of the two wrongs for a page whose job is to take bookings.
    expect(website).toContain('Time off unreadable');
  });
});

describe('the smart-link booking page', () => {
  it('resolves hours per DATE too', () => {
    expect(smartLink).toContain('windowsForDate(availability, dateKey, timeOff)');
  });

  it('reads them once for the window it walks', () => {
    expect(smartLink).toContain('schedulingTimeOffRepository.list(userId');
  });

  it('builds the date key from local parts, not toISOString', () => {
    // `toISOString()` names the UTC day, which for a business ahead of UTC
    // subtracts a day from every closed-day comparison.
    expect(smartLink).toContain('currentDate.getFullYear()');
    expect(smartLink).not.toMatch(/const dateKey = .*toISOString/);
  });
});

describe('the chat, asked whether a day is free', () => {
  it('computes open time from the date', () => {
    expect(openTime).toContain('windowsForDate(availability, date, timeOff ?? [])');
  });

  it('treats an absent list as none recorded, not as none existing', () => {
    expect(openTime).toContain('timeOff?: TimeOffEntry[]');
  });
});

describe('the resolver itself', () => {
  it('closes a date before it considers short hours', () => {
    const body = windows.slice(windows.indexOf('export function windowsForDate'));
    expect(body.indexOf("'unavailable'")).toBeLessThan(body.indexOf("'custom_hours'"));
  });

  it('still exports the weekday resolver, which the website’s opening hours use', () => {
    expect(windows).toContain('export function windowsForDay');
    expect(read('lib', 'branding', 'publicBranding.ts')).toContain('windowsForDay(availability, day)');
  });
});

describe("the owner's calendar grid", () => {
  it('reads the closed days', () => {
    expect(calendar).toContain("fetch('/api/scheduling/time-off')");
  });

  it('resolves each column by DATE, so a short day shows its real hours', () => {
    expect(calendar).toContain('windowsForDate(availability, columnDateKey(date), timeOff)');
  });

  it('draws the closure rather than only honouring it', () => {
    // An owner on holiday seeing an ordinary open week is the bug; a greyed
    // cell with no explanation is the next one.
    expect(calendar).toContain('closedFor(date)');
    expect(calendar).toContain('isHourClosedByTimeOff');
  });
});

describe("the owner's booking dialog", () => {
  it('reads the closed days', () => {
    expect(dialog).toContain("fetch('/api/scheduling/time-off')");
  });

  it('never SUGGESTS a time on a closed day', () => {
    expect(dialog).toContain('windowsForDate(availability, dateKey, timeOff)');
  });

  it('warns before Save, and asks rather than refusing', () => {
    expect(dialog).toContain('closedDayVerdict(');
    expect(dialog).toContain("t('scheduling.closed_book_anyway')");
    // The confirmation is sent only when the warning was shown.
    expect(dialog).toContain('closedDay.closed ? { allow_closed_day: true }');
  });
});

describe('the service that writes the booking', () => {
  it('checks the day, whoever is asking — dialog, chat or bizql', () => {
    expect(lifecycle).toContain('closedDayCheck(userId');
  });

  it('only when the owner has not already answered', () => {
    expect(lifecycle).toContain('!params.allowClosedDay');
  });

  it('allows the booking when the list cannot be read', () => {
    // Stated at the source because the alternative — an owner unable to book
    // anyone because a table is unreadable — is worse than the thing being
    // guarded against.
    expect(lifecycle).toContain('Time off unreadable; the booking is allowed');
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * EVERY OTHER WAY A BOOKED HOUR GETS WRITTEN.
 *
 * Four paths do not go through `createBooking`, and each of them is a way the
 * same bug comes back. They are listed here rather than trusted, because the
 * one thing that made the original fault invisible was that nobody knew how
 * many writers there were.
 *
 * Deliberately NOT gated, and why:
 *   · `website/booking/confirm` and `website/booking/finalize` — the client has
 *     already paid. Refusing there takes the money and gives nothing back.
 *   · the Stripe webhook — same money, arriving later.
 * ─────────────────────────────────────────────────────────────────────────── */

describe("the owner's update route, which writes start_time itself", () => {
  it('asks the same question through the same function', () => {
    expect(ownerUpdate).toContain('closedDayCheck(');
  });

  it('only when the time is actually changing', () => {
    // A note written up after the session must not be refused because the day
    // it happened on was a holiday.
    expect(ownerUpdate).toContain('timeIsChanging && !allow_closed_day');
  });

  it('answers with a code the dialog can act on', () => {
    expect(ownerUpdate).toContain("code: 'closed_day'");
  });
});

describe('the public booking page', () => {
  it('refuses a closed day at the write, not only in the slot list', () => {
    expect(publicCreate).toContain('closedDayVerdict(');
    expect(publicCreate).toContain('Public booking refused: the day is closed');
  });

  it('says what it says about a taken slot — a client is told nothing about a holiday', () => {
    const refusal = publicCreate.slice(publicCreate.indexOf('Public booking refused'));
    expect(refusal).toContain('This time slot is no longer available');
  });
});

describe('a quote request that books a consultation', () => {
  it('refuses a closed day too', () => {
    expect(quoteRequest).toContain('closedDayVerdict(');
    expect(quoteRequest).toContain('Quote request refused a time on a closed day');
  });
});

describe("the client's reschedule", () => {
  it('is offered slots that already exclude the closed days', () => {
    // Without this the client picks a time and is then refused, which is a dead
    // end rather than a rule.
    expect(rescheduleSlots).toContain('windowsForDate(availability, date, timeOff ?? [])');
  });

  it('refuses one that slipped through, in the wording the page already has', () => {
    expect(clientReschedule).toContain('BookingOnClosedDayError');
    const branch = clientReschedule.slice(clientReschedule.indexOf('BookingOnClosedDayError)'));
    expect(branch).toContain("code: 'slot_taken'");
  });
});

describe('the dialog, when the server knew about a closure it did not', () => {
  it('turns the 409 into the same question rather than a red sentence', () => {
    expect(dialog).toContain("data.code === 'closed_day'");
    expect(dialog).toContain('setServerClosedDay(data.closed)');
  });
});
