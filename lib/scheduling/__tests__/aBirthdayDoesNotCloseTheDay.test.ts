/**
 * A birthday in the owner's Google calendar does not close their working day.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Reported 2026-11-13: Monday 16 November read as fully busy for an owner whose
 * Monday is open 09:00 to 19:00, with no bookings, no meetings and no
 * availability exception. The cause was a single synced event:
 *
 *   title       יום הולדת שמח!
 *   start       2026-11-16 00:00      end  2026-11-17 00:00
 *   is_all_day  true
 *
 * Google sends birthdays from Contacts as all-day events, and an all-day event
 * covers every slot in the day. `external_calendar_events` answers exactly one
 * question — is this hour free — so an event that shows as FREE has no business
 * in it.
 *
 * The asymmetry these cases encode: an unknown event blocks. Wrongly blocking
 * an hour costs a booking the owner can still take by hand; wrongly freeing one
 * double-books them in front of a client.
 */

import { blocksTime } from '../externalEventBlocksTime';

describe('what Google says is free', () => {
  it('a birthday does not block', () => {
    expect(blocksTime({ event_type: 'birthday', transparency: 'transparent' })).toBe(false);
  });

  it('transparent alone is enough, whatever the type', () => {
    expect(blocksTime({ transparency: 'transparent' })).toBe(false);
    expect(blocksTime({ transparency: 'TRANSPARENT' })).toBe(false);
  });

  it('a working-location or focus-time marker does not block', () => {
    expect(blocksTime({ event_type: 'workingLocation' })).toBe(false);
    expect(blocksTime({ event_type: 'focusTime' })).toBe(false);
  });

  it('reads the camelCase twin the executors also emit', () => {
    expect(blocksTime({ eventType: 'birthday' })).toBe(false);
  });
});

describe('what still blocks', () => {
  it('an ordinary meeting, which carries no transparency at all', () => {
    expect(blocksTime({ start: '2026-11-16T09:00:00Z' } as never)).toBe(true);
  });

  it('an event explicitly marked opaque', () => {
    expect(blocksTime({ transparency: 'opaque' })).toBe(true);
  });

  it('OUT OF OFFICE, which is the one marker that means do not book me', () => {
    expect(blocksTime({ event_type: 'outOfOffice' })).toBe(true);
  });

  it('a default event type', () => {
    expect(blocksTime({ event_type: 'default' })).toBe(true);
  });

  it('anything unrecognised, because the default must be busy', () => {
    expect(blocksTime({ event_type: 'somethingNew', transparency: 'maybe' })).toBe(true);
    expect(blocksTime({})).toBe(true);
    expect(blocksTime(null)).toBe(true);
    expect(blocksTime(undefined)).toBe(true);
  });
});

describe('Microsoft, for the day the executor selects showAs', () => {
  it('free and working elsewhere do not block', () => {
    expect(blocksTime({ showAs: 'free' })).toBe(false);
    expect(blocksTime({ showAs: 'workingElsewhere' })).toBe(false);
  });

  it('busy, tentative and out of office do', () => {
    expect(blocksTime({ showAs: 'busy' })).toBe(true);
    expect(blocksTime({ showAs: 'tentative' })).toBe(true);
    expect(blocksTime({ showAs: 'oof' })).toBe(true);
  });
});

describe('the live event that caused this', () => {
  it('is let through as free', () => {
    const birthday = {
      id: 'cvkudpu2sb7r58mk08l37u96h4_20261116',
      summary: 'יום הולדת שמח!',
      start: '2026-11-16',
      end: '2026-11-17',
      transparency: 'transparent',
      event_type: 'birthday',
    };

    expect(blocksTime(birthday)).toBe(false);
  });

  it('while the daily meeting beside it still takes its hour', () => {
    const daily = {
      id: '52dkb70f17njpdea70fkbmep28_20261116T170000Z',
      summary: 'AgentsPilot Daily if needed',
      start: '2026-11-16T17:00:00Z',
      end: '2026-11-16T18:00:00Z',
    };

    expect(blocksTime(daily)).toBe(true);
  });
});
