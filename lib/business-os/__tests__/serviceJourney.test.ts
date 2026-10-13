/**
 * The journey a service puts a client through, read from the service itself.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The editor shows about fifteen controls and says what none of them add up to.
 * `serviceMoneyLine` answered the money; this answers the rest, and these tests
 * are where its two rules are held:
 *
 *   keys, never prose   the editor is read in three languages
 *   only what differs   a line restating a default is noise, and noise is what
 *                       stops the useful lines being read
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { serviceJourney, JOURNEY_DEFAULTS, type JourneyInput } from '../serviceJourney';

/** An ordinary scheduled service, entirely on the platform's defaults. */
const plain = (over: Partial<JourneyInput> = {}): JourneyInput => ({
  isScheduled: true,
  durationMinutes: 60,
  bufferMinutes: JOURNEY_DEFAULTS.bufferMinutes,
  advanceBookingDays: JOURNEY_DEFAULTS.advanceBookingDays,
  minNoticeHours: JOURNEY_DEFAULTS.minNoticeHours,
  maxBookingsPerDay: JOURNEY_DEFAULTS.maxBookingsPerDay,
  ...over,
});

const keys = (input: JourneyInput) => serviceJourney(input).map(step => step.key);

describe('whether a time is held', () => {
  it('is always said, because every other line depends on it', () => {
    expect(keys(plain())).toContain('holds_time');
    expect(keys(plain({ isScheduled: false }))).toContain('no_time');
  });

  it('an unscheduled service says that and stops', () => {
    /*
     * It has no duration to spend, no window to book in and no day to fill, so
     * every line below would describe a diary it never touches. The reported
     * service is exactly this: a course, bought and begun.
     */
    expect(keys(plain({ isScheduled: false, durationMinutes: 90, maxBookingsPerDay: 3 }))).toEqual(['no_time']);
  });
});

describe('what one booking costs the day', () => {
  it('says how long it runs', () => {
    expect(serviceJourney(plain({ durationMinutes: 45 }))).toContainEqual({
      key: 'runs_for',
      values: { minutes: 45 },
    });
  });

  it('and adds the buffer up for the owner, rather than making them do it', () => {
    // 60 + 15 is the figure that matters, and it is the one nowhere on screen.
    expect(serviceJourney(plain({ durationMinutes: 60, bufferMinutes: 15 }))).toContainEqual({
      key: 'runs_for_with_buffer',
      values: { minutes: 60, buffer: 15, total: 75 },
    });
  });

  it('says nothing about a duration nobody set', () => {
    expect(keys(plain({ durationMinutes: null }))).not.toContain('runs_for');
    expect(keys(plain({ durationMinutes: 0 }))).not.toContain('runs_for');
  });
});

describe('only what the owner actually changed', () => {
  it('a service on every default says just the two that always matter', () => {
    // The whole rule, in one assertion: no window line, no cap line.
    expect(keys(plain())).toEqual(['holds_time', 'runs_for']);
  });

  it('a changed booking window is worth a line', () => {
    expect(serviceJourney(plain({ advanceBookingDays: 3 }))).toContainEqual({
      key: 'books_ahead',
      values: { days: 3 },
    });
  });

  it('a changed notice is worth a line', () => {
    expect(serviceJourney(plain({ minNoticeHours: 48 }))).toContainEqual({
      key: 'books_until',
      values: { hours: 48 },
    });
  });

  it('the defaults themselves are not', () => {
    const k = keys(plain());
    expect(k).not.toContain('books_ahead');
    expect(k).not.toContain('books_until');
    expect(k).not.toContain('caps_per_day');
  });
});

describe('no notice at all', () => {
  it('reads as its own sentence, not as "at least 0 hours"', () => {
    /*
     * Zero is a REAL answer here — book the next slot going — and `positive()`
     * would throw it away as falsy. It is the one number in this module where
     * absent and zero mean different things.
     */
    expect(keys(plain({ minNoticeHours: 0 }))).toContain('books_same_day');
    expect(keys(plain({ minNoticeHours: 0 }))).not.toContain('books_until');
  });

  it('while a missing one says nothing', () => {
    expect(keys(plain({ minNoticeHours: null }))).not.toContain('books_same_day');
    expect(keys(plain({ minNoticeHours: null }))).not.toContain('books_until');
  });
});

describe('a ceiling on the day', () => {
  it('is said whenever there is one, since there is no default to match', () => {
    expect(serviceJourney(plain({ maxBookingsPerDay: 4 }))).toContainEqual({
      key: 'caps_per_day',
      values: { count: 4 },
    });
  });

  it('and nothing when there is not', () => {
    expect(keys(plain({ maxBookingsPerDay: null }))).not.toContain('caps_per_day');
    expect(keys(plain({ maxBookingsPerDay: 0 }))).not.toContain('caps_per_day');
  });
});

describe('the contract the copy depends on', () => {
  it('returns keys and figures, never a sentence', () => {
    // Prose here could not be translated, which is the whole reason this module
    // returns keys at all.
    for (const step of serviceJourney(plain({ durationMinutes: 60, bufferMinutes: 10, maxBookingsPerDay: 2 }))) {
      expect(typeof step.key).toBe('string');
      expect(step.key).not.toMatch(/\s/);
      for (const value of Object.values(step.values ?? {})) {
        expect(typeof value).toBe('number');
      }
    }
  });

  it('every key it can emit has copy in all three languages', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const emitted = new Set<string>();
    // Every branch, driven through the resolver rather than listed by hand.
    for (const input of [
      plain(),
      plain({ isScheduled: false }),
      plain({ bufferMinutes: 10 }),
      plain({ advanceBookingDays: 3 }),
      plain({ minNoticeHours: 48 }),
      plain({ minNoticeHours: 0 }),
      plain({ maxBookingsPerDay: 2 }),
    ]) {
      for (const step of serviceJourney(input)) emitted.add(step.key);
    }

    for (const lang of ['en', 'he', 'es']) {
      const dict = fs.readFileSync(path.join(process.cwd(), `lib/business-os/translations/${lang}.ts`), 'utf8');
      for (const key of emitted) {
        expect(dict).toContain(`'scheduling.journey.${key}'`);
      }
    }
  });

  it('every placeholder in the copy is a figure the step supplies', () => {
    // A `{days}` with no `days` renders the brace at the client-facing owner.
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const dict = fs.readFileSync(path.join(process.cwd(), 'lib/business-os/translations/en.ts'), 'utf8');

    for (const input of [
      plain({ bufferMinutes: 10 }),
      plain({ advanceBookingDays: 3 }),
      plain({ minNoticeHours: 48 }),
      plain({ maxBookingsPerDay: 2 }),
    ]) {
      for (const step of serviceJourney(input)) {
        const line = dict.slice(dict.indexOf(`'scheduling.journey.${step.key}'`));
        const sentence = line.slice(0, line.indexOf('\n'));
        for (const placeholder of sentence.match(/\{(\w+)\}/g) ?? []) {
          const name = placeholder.slice(1, -1);
          expect(Object.keys(step.values ?? {})).toContain(name);
        }
      }
    }
  });
});
