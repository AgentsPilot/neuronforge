/**
 * The quick-pick chip must name the day it actually offers.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * The builder decides which day is "today" from the business's zone, and the UI
 * labels its chips "Today" / "Tomorrow" from the resulting `dayOffset`. While
 * the zone was still the `UTC` placeholder, at 10pm in New York it was already
 * the next day in UTC — so a chip stamped `dayOffset: 0` carried a date that
 * was tomorrow. The chip said Today; the Start Time field, correctly zoned,
 * said tomorrow.
 *
 * These assert the invariant the label depends on: `dayOffset` is the number of
 * days between the business's today and the slot's own business date. If that
 * holds, the label cannot lie.
 */

import { getNextAvailableSlots } from '../SchedulingBookingModal';
import { businessDateKey, shiftBusinessDateKey } from '@/lib/scheduling/businessTime';

const NY = 'America/New_York';

/** Mon-Wed and Sunday, nine to five. The shape of the account that reported this. */
const AVAILABILITY = {
  sunday: [{ start: '09:00', end: '17:00' }],
  monday: [{ start: '09:00', end: '17:00' }],
  tuesday: [{ start: '09:00', end: '17:00' }],
  wednesday: [{ start: '09:00', end: '17:00' }],
  thursday: [],
  friday: [],
  saturday: [],
} as never;

/** What the chip would read, from the offset alone — exactly as the UI does. */
const labelFor = (offset: number) => (offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : 'dated');

function atInstant(iso: string, run: () => void) {
  const real = Date.now;
  Date.now = () => new Date(iso).getTime();
  // `new Date()` with no arguments reads the clock too.
  const RealDate = global.Date;
  class Frozen extends RealDate {
    constructor(...args: unknown[]) {
      // @ts-expect-error - passthrough constructor
      super(...(args.length ? args : [iso]));
    }
    static now() { return new RealDate(iso).getTime(); }
  }
  // @ts-expect-error - test double
  global.Date = Frozen;
  try {
    run();
  } finally {
    global.Date = RealDate;
    Date.now = real;
  }
}

describe('quick-pick day labels', () => {
  it('never labels a slot Today unless it falls on the business today', () => {
    // 02:14Z Thursday === 10:14pm WEDNESDAY in New York. Wednesday's window
    // closed at five, and Thu/Fri/Sat are shut, so the first slot is Sunday.
    atInstant('2026-09-17T02:14:00Z', () => {
      const slots = getNextAvailableSlots(AVAILABILITY, 60, NY, 6, [], []);
      const todayKey = businessDateKey(new Date(), NY);

      expect(slots.length).toBeGreaterThan(0);

      for (const slot of slots) {
        const slotKey = businessDateKey(slot.start, NY);
        const expectedKey = shiftBusinessDateKey(todayKey, slot.dayOffset);
        // The invariant the label rests on.
        expect(slotKey).toBe(expectedKey);
      }

      // And specifically: nothing may claim to be today.
      expect(slots.some(s => labelFor(s.dayOffset) === 'Today')).toBe(false);
    });
  });

  it('offers today when today genuinely still has room', () => {
    // 14:00Z Wednesday === 10:00am Wednesday in New York, inside 09:00-17:00.
    atInstant('2026-09-16T14:00:00Z', () => {
      const slots = getNextAvailableSlots(AVAILABILITY, 60, NY, 6, [], []);
      const todayKey = businessDateKey(new Date(), NY);

      expect(slots.length).toBeGreaterThan(0);
      expect(slots[0].dayOffset).toBe(0);
      expect(businessDateKey(slots[0].start, NY)).toBe(todayKey);
    });
  });

  it('keeps offset and date aligned for a business whose day differs from UTC', () => {
    // 23:30Z Wednesday === 7:30pm Wednesday in New York: UTC is still Wednesday
    // here, but the guard and the date must both be the business's.
    atInstant('2026-09-16T23:30:00Z', () => {
      const slots = getNextAvailableSlots(AVAILABILITY, 60, NY, 6, [], []);
      const todayKey = businessDateKey(new Date(), NY);

      for (const slot of slots) {
        expect(businessDateKey(slot.start, NY)).toBe(shiftBusinessDateKey(todayKey, slot.dayOffset));
      }
    });
  });
});
