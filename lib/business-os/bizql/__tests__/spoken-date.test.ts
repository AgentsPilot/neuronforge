/**
 * Reading a date out of the way a person answers "when?".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Mid-write the next message is a value, and for a date field that value used
 * to be stored as the literal text: "9 בספטמבר" went into a date column as five
 * characters, was rejected, and the user was asked the same question again for
 * an answer that could not have been clearer.
 *
 * The refusals matter as much as the reads. A date nobody is sure of must come
 * back as null so the user is asked again — a wrong date written silently into
 * a reminder is the worse outcome.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { parseSpokenDate } from '../mutate/spokenDate';

/** A Tuesday, mid-month, so no two readings coincide by accident. */
const TUESDAY = new Date('2026-09-08T10:00:00Z');

describe('with the clock on Tuesday 8 September 2026', () => {
  beforeAll(() => jest.useFakeTimers().setSystemTime(TUESDAY));
  afterAll(() => jest.useRealTimers());

  it('reads a day and a month name in Hebrew', () => {
    // The exact answer that failed in production.
    expect(parseSpokenDate('9 בספטמבר', 'he')).toEqual({ $date: '2026-09-09' });
  });

  it('reads the same thing in English and Spanish', () => {
    expect(parseSpokenDate('September 9', 'en')).toEqual({ $date: '2026-09-09' });
    expect(parseSpokenDate('9 de septiembre', 'es')).toEqual({ $date: '2026-09-09' });
  });

  it('takes next year when the day has already passed', () => {
    /*
     * Someone answering "3 March" in September means the coming March. Taking
     * this year would put a reminder in the past, where nothing will ever fire.
     */
    expect(parseSpokenDate('3 March', 'en')).toEqual({ $date: '2027-03-03' });
  });

  it('reads "tomorrow" as the anchor, not as a date', () => {
    // An anchor stays right when a parked write is finished the next morning.
    expect(parseSpokenDate('מחר', 'he')).toEqual({ $date: 'tomorrow' });
    expect(parseSpokenDate('tomorrow', 'en')).toEqual({ $date: 'tomorrow' });
    expect(parseSpokenDate('mañana', 'es')).toEqual({ $date: 'tomorrow' });
  });

  it('reads a weekday as the weekday anchor', () => {
    // Which resolves to the NEXT one — what "on Thursday" means to anyone
    // who says it.
    expect(parseSpokenDate('ביום חמישי', 'he')).toEqual({ $date: 'thursday' });
    expect(parseSpokenDate('on Thursday', 'en')).toEqual({ $date: 'thursday' });
  });

  it('reads an explicit date whatever the punctuation', () => {
    expect(parseSpokenDate('2026-10-30', 'en')).toEqual({ $date: '2026-10-30' });
    expect(parseSpokenDate('2026/10/30', 'he')).toEqual({ $date: '2026-10-30' });
  });

  it('reads a bare day/month as day first', () => {
    expect(parseSpokenDate('30/10', 'he')).toEqual({ $date: '2026-10-30' });
  });

  describe('what it refuses to guess', () => {
    it('a sentence with no date in it', () => {
      expect(parseSpokenDate('לוודא שהוחזר הכסף', 'he')).toBeNull();
      expect(parseSpokenDate('call the client back', 'en')).toBeNull();
    });

    it('a month with no day', () => {
      // "in September" is not a date. Asking again beats picking the 1st.
      expect(parseSpokenDate('בספטמבר', 'he')).toBeNull();
    });

    it('a day number that cannot be one', () => {
      expect(parseSpokenDate('45 September', 'en')).toBeNull();
    });

    it('an empty answer', () => {
      expect(parseSpokenDate('   ', 'en')).toBeNull();
    });
  });
});
