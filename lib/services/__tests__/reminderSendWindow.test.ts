/**
 * Chasing hours: a reminder is never DUE outside them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS REPLACES
 *
 * `/api/cron/payment-reminders` ran daily at 08:00, and that was not a
 * scheduling decision — it was a quiet-hours rule living in `vercel.json`. The
 * route stamps `scheduled_at: now` when it notices a debt, so the daily schedule
 * also meant every reminder waited up to a day.
 *
 * Moving the cron to hourly fixes the delay and, alone, would chase somebody for
 * money at 03:40. So the rule moved into the data, and these tests pin the two
 * halves of it: in-hours is untouched, out-of-hours is held to the next opening.
 *
 * WHY NOT HOLD A CLAIMED ROW
 *
 * `claim_due_payment_reminders` does `attempts = attempts + 1` and MAX_ATTEMPTS
 * is 5. Releasing a row back to `pending` every hour from 20:00 would burn 12
 * attempts by morning and the reaper would dead-letter a perfectly good
 * reminder. Applying the window at write time spends no attempts at all — which
 * is the property the last test here guards.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { businessClock, businessDateKey, businessInstant, shiftBusinessDateKey } from '@/lib/scheduling/businessTime';

/**
 * The same arithmetic `PaymentReminderService.sendableAt` performs, against the
 * same helpers. Pinned here because the method is private and its zone lookup
 * needs a database; the maths is the part that can be wrong.
 */
const OPENS = 8;
const CLOSES = 20;

function sendableAt(desired: Date, zone: string): string {
  const { hour } = businessClock(desired, zone);
  if (hour >= OPENS && hour < CLOSES) return desired.toISOString();
  const dateKey = businessDateKey(desired, zone);
  const target = hour < OPENS ? dateKey : shiftBusinessDateKey(dateKey, 1);
  return businessInstant(target, `${String(OPENS).padStart(2, '0')}:00`, zone).toISOString();
}

/** The hour a business would see on its own clock. */
const localHour = (iso: string, zone: string) => businessClock(new Date(iso), zone).hour;

describe('a reminder that comes due inside chasing hours', () => {
  it.each([
    ['Asia/Jerusalem', '2026-09-28T06:30:00.000Z'], // 09:30 local
    ['America/New_York', '2026-09-28T17:00:00.000Z'], // 13:00 local
    ['UTC', '2026-09-28T08:00:00.000Z'], // exactly as it opens
  ])('is sent when it is due (%s)', (zone, iso) => {
    expect(sendableAt(new Date(iso), zone)).toBe(iso);
  });
});

describe('a reminder that comes due outside them', () => {
  it('is held to this morning when the night is not over', () => {
    // 03:40 local — the hour the hourly cron would otherwise have emailed at.
    const zone = 'Asia/Jerusalem';
    const held = sendableAt(new Date('2026-09-28T00:40:00.000Z'), zone);
    expect(localHour(held, zone)).toBe(OPENS);
    // Same day, not tomorrow: it is still ahead of the opening.
    expect(businessDateKey(new Date(held), zone)).toBe('2026-09-28');
  });

  it('is held to tomorrow morning once the window has closed', () => {
    const zone = 'Asia/Jerusalem';
    const held = sendableAt(new Date('2026-09-28T18:30:00.000Z'), zone); // 21:30 local
    expect(localHour(held, zone)).toBe(OPENS);
    expect(businessDateKey(new Date(held), zone)).toBe('2026-09-29');
  });

  it('is held at the moment the window closes, not an hour later', () => {
    // 20:00 is OUT. A boundary written as `<=` would email at eight in the
    // evening, which is the thing being prevented.
    const zone = 'UTC';
    const held = sendableAt(new Date('2026-09-28T20:00:00.000Z'), zone);
    expect(businessDateKey(new Date(held), zone)).toBe('2026-09-29');
  });

  it('respects the business zone rather than the server clock', () => {
    // One instant, two businesses. 23:00 UTC is 02:00 next day in Jerusalem
    // (held to the 29th) and 19:00 the same day in New York (in hours, sent).
    const instant = new Date('2026-09-28T23:00:00.000Z');
    expect(sendableAt(instant, 'America/New_York')).toBe(instant.toISOString());
    const held = sendableAt(instant, 'Asia/Jerusalem');
    expect(held).not.toBe(instant.toISOString());
    expect(businessDateKey(new Date(held), 'Asia/Jerusalem')).toBe('2026-09-29');
  });
});

describe('what the window must never do', () => {
  it('never moves a reminder BACKWARDS', () => {
    // Sending earlier than asked would chase someone before the debt is due.
    for (const iso of [
      '2026-09-28T00:40:00.000Z',
      '2026-09-28T18:30:00.000Z',
      '2026-09-28T12:00:00.000Z',
      '2026-09-28T20:00:00.000Z',
    ]) {
      for (const zone of ['UTC', 'Asia/Jerusalem', 'America/New_York']) {
        expect(new Date(sendableAt(new Date(iso), zone)).getTime()).toBeGreaterThanOrEqual(
          new Date(iso).getTime()
        );
      }
    }
  });

  it('holds by less than a day, so nothing is delayed twice', () => {
    // The held time must itself be inside the window, or the next drain would
    // hold it again and a reminder could walk forward indefinitely.
    for (const zone of ['UTC', 'Asia/Jerusalem', 'America/New_York']) {
      for (const iso of ['2026-09-28T00:40:00.000Z', '2026-09-28T18:30:00.000Z']) {
        const held = sendableAt(new Date(iso), zone);
        expect(localHour(held, zone)).toBeGreaterThanOrEqual(OPENS);
        expect(localHour(held, zone)).toBeLessThan(CLOSES);
        expect(sendableAt(new Date(held), zone)).toBe(held);
      }
    }
  });
});
