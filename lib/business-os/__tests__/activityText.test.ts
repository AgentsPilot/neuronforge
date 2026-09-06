/**
 * What an activity says, and in whose language.
 *
 * These sentences are written into the database once and never re-translated,
 * so a wrong one is wrong forever — which is exactly why they are worth testing
 * rather than eyeballing in a drawer.
 */

import {
  activitySentence,
  activityMoment,
  activityFieldName,
} from '../activityText';

describe('the sentence is written in the business language', () => {
  it('writes Hebrew for a Hebrew business', () => {
    expect(
      activitySentence('booking_rescheduled', { from: 'א', to: 'ב' }, 'he')
    ).toBe('המועד הועבר מ־א ל־ב');
  });

  it('writes Spanish for a Spanish business', () => {
    expect(activitySentence('contact_updated', { fields: 'teléfono' }, 'es'))
      .toBe('Datos actualizados: teléfono');
  });

  it('falls back to English rather than printing the key', () => {
    // An unknown locale must still produce a sentence somebody can read.
    expect(activitySentence('contact_updated', { fields: 'phone' }, 'fr'))
      .toBe('Details updated: phone');
  });

  it('returns the key when the sentence does not exist, rather than a broken string', () => {
    expect(activitySentence('no_such_event', {}, 'he')).toBe('no_such_event');
  });
});

describe('a booking time is stated in the business timezone', () => {
  /**
   * The whole reason times were wrong on screen: an instant rendered in the
   * viewer's zone rather than the one the appointment was agreed in.
   */
  it('renders an instant in the zone it belongs to, not the reader\'s', () => {
    // 13:00 UTC is 09:00 in New York and 16:00 in Israel.
    const instant = '2026-09-15T13:00:00+00:00';
    expect(activityMoment(instant, 'en', 'America/New_York')).toContain('9:00');
    expect(activityMoment(instant, 'en', 'Asia/Jerusalem')).toContain('4:00'); // 4 PM
  });

  it('uses 24-hour time outside English', () => {
    const shown = activityMoment('2026-09-15T13:00:00+00:00', 'he', 'Asia/Jerusalem');
    expect(shown).toContain('16:00');
  });

  it('says nothing about a booking that has no time', () => {
    // A course or a product: `start_time` is null, and `new Date(null)` is the
    // epoch — which is how every one of them came to read "12/31/1969".
    expect(activityMoment(null, 'he')).toBeNull();
    expect(activityMoment(undefined, 'he')).toBeNull();
    expect(activityMoment(new Date(0).toISOString(), 'he')).toBeNull();
  });

  it('says nothing rather than throwing on a malformed value', () => {
    expect(activityMoment('not a date', 'he')).toBeNull();
  });
});

describe('field names', () => {
  it('names a field the way a person would', () => {
    expect(activityFieldName('first_name', 'he')).toBe('שם פרטי');
    expect(activityFieldName('phone', 'es')).toBe('teléfono');
  });

  it('degrades to a readable name for a field it does not know', () => {
    expect(activityFieldName('some_new_column', 'he')).toBe('some new column');
  });
});
