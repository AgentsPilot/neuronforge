/**
 * When an invoice counts as late, on the business's own calendar.
 *
 * The previous form subtracted a UTC midnight from `Date.now()`, which mixes
 * an instant with a date. Under the old daily 08:00 UTC cron that told a
 * business in Honolulu its invoice was overdue while it was still 22:00 on the
 * due date there — a client chased for a debt that was not yet late.
 */

import { overdueCalendarDays } from '../PaymentReminderService';

describe('overdueCalendarDays', () => {
  it('is 0 on the due date itself — not late', () => {
    expect(overdueCalendarDays('2026-09-24', '2026-09-24')).toBe(0);
  });

  it('is negative before the due date', () => {
    expect(overdueCalendarDays('2026-09-24', '2026-09-22')).toBe(-2);
  });

  it('counts whole days once the date has passed', () => {
    expect(overdueCalendarDays('2026-09-24', '2026-09-25')).toBe(1);
    expect(overdueCalendarDays('2026-09-24', '2026-10-01')).toBe(7);
  });

  it('crosses a month boundary without drifting', () => {
    expect(overdueCalendarDays('2026-08-31', '2026-09-01')).toBe(1);
  });

  it('is unaffected by a DST change in between', () => {
    // 1 Nov 2026 is a US DST change; the count is calendar days, not hours.
    expect(overdueCalendarDays('2026-10-30', '2026-11-03')).toBe(4);
  });

  it('tolerates a full timestamp in the due-date column', () => {
    expect(overdueCalendarDays('2026-09-24T00:00:00.000Z', '2026-09-26')).toBe(2);
  });
});
