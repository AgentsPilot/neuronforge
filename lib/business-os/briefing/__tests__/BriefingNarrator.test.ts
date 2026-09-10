import { findUnsupportedFigures, findUntranslatedWords, composeFallback } from '../BriefingNarrator';
import type { BriefingFacts } from '../BriefingFactsService';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

function facts(overrides: Partial<BriefingFacts> = {}): BriefingFacts {
  return {
    day: {
      timezone: 'Asia/Jerusalem',
      date: '2026-09-08',
      startUtc: '2026-09-07T21:00:00.000Z',
      endUtc: '2026-09-08T21:00:00.000Z',
      localHour: 9,
    },
    appointments: {
      total: 6,
      ready: 5,
      awaitingIntake: [{ name: 'Sarah', timeLocal: '11:00' }],
      first: { name: 'Michael', timeLocal: '09:00', serviceName: 'Assessment 1' },
      cancelled: [{ name: 'Dana', timeLocal: '15:00' }],
    },
    money: {
      owed: [{ name: 'John', amount: 250, currency: 'USD', overdue: true }],
      totalOwed: 250,
      currency: 'USD',
      mixedCurrency: false,
    },
    isQuiet: false,
    ...overrides,
  };
}

/**
 * The guardrail is the feature's safety property: the model may phrase, never
 * compute. A fabricated figure reaching the card would undermine every real
 * number beside it.
 */
describe('findUnsupportedFigures', () => {
  it('passes a briefing that only restates the facts', () => {
    const text =
      'You have 6 appointments today. 5 clients are ready. Sarah hasn\'t completed intake. ' +
      'John still owes $250. Your 15:00 appointment was cancelled. First is Michael at 09:00.';

    expect(findUnsupportedFigures(text, facts())).toEqual([]);
  });

  it('catches a total the model invented', () => {
    // Nothing in the facts sums to 1340. This is the failure mode the whole
    // fact/phrase split exists to prevent.
    expect(findUnsupportedFigures('You have 6 appointments worth $1,340 today.', facts()))
      .toEqual(['1340']);
  });

  it('catches a plausible but wrong amount owed', () => {
    // 350 is close enough to 250 to look right at a glance, which is exactly
    // why a human reviewer would miss it.
    expect(findUnsupportedFigures('John still owes $350.', facts())).toEqual(['350']);
  });

  it('allows digits that live inside a name or service, not a calculation', () => {
    // Regression: an earlier version permitted only numeric FIELDS, so a
    // service called "Assessment 1" or a client called "Studio 54" tripped the
    // guard and sent a correct briefing to the fallback.
    expect(findUnsupportedFigures('First is Michael at 09:00 for Assessment 1.', facts())).toEqual([]);

    const studio = facts({
      appointments: { ...facts().appointments, first: { name: 'Studio 54', timeLocal: '09:00' } },
    });
    expect(findUnsupportedFigures('Your first appointment is Studio 54 at 09:00.', studio)).toEqual([]);
  });

  it('allows the date written out', () => {
    expect(findUnsupportedFigures('Today is 8 September 2026. You have 6 appointments.', facts()))
      .toEqual([]);
  });

  it('tolerates thousands separators and decimals on a real amount', () => {
    const large = facts({
      money: {
        owed: [{ name: 'John', amount: 1250.5, currency: 'USD', overdue: false }],
        totalOwed: 1250.5,
        currency: 'USD',
        mixedCurrency: false,
      },
    });

    expect(findUnsupportedFigures('John still owes $1,250.50.', large)).toEqual([]);
  });
});

describe('composeFallback', () => {
  it('states the facts without a model, in English', () => {
    const text = composeFallback(facts(), 'en');

    expect(text).toContain('6 appointments');
    expect(text).toContain('Sarah');
    expect(text).toContain('John');
    expect(text).toContain('$250');
    expect(text).toContain('Michael');
  });

  it('never contains a figure the guardrail would reject', () => {
    // The fallback is the path taken when the model misbehaves, so it must
    // itself be beyond reproach.
    expect(findUnsupportedFigures(composeFallback(facts(), 'en'), facts())).toEqual([]);
  });

  it('gets Hebrew singular and plural right', () => {
    const one = facts({
      appointments: { total: 1, ready: 1, awaitingIntake: [], cancelled: [], first: undefined },
    });

    // "1 פגישות" would read as machine output to any Hebrew speaker.
    expect(composeFallback(one, 'he')).toContain('פגישה אחת');
    expect(composeFallback(facts(), 'he')).toContain('6 פגישות');
  });

  it('keeps names in their own script', () => {
    const hebrew = facts({
      appointments: {
        ...facts().appointments,
        first: { name: 'דויד המלך', timeLocal: '16:00' },
      },
    });

    // Transliterating would describe someone the owner does not recognise.
    expect(composeFallback(hebrew, 'he')).toContain('דויד המלך');
    expect(composeFallback(hebrew, 'en')).toContain('דויד המלך');
  });

  it('says something rather than nothing on a quiet day', () => {
    const quiet = facts({
      appointments: { total: 0, ready: 0, awaitingIntake: [], cancelled: [], first: undefined },
      money: { owed: [], totalOwed: 0, currency: 'USD', mixedCurrency: false },
      isQuiet: true,
    });

    for (const lang of ['en', 'es', 'he'] as const) {
      expect(composeFallback(quiet, lang).length).toBeGreaterThan(0);
    }
  });
});

/**
 * The model reused an English field name inside a Hebrew sentence — "יש לך
 * תשלום outstanding" — through both a renamed key and an explicit instruction
 * not to. Hebrew is a different script, so the leak is mechanically detectable
 * where it would not be for Spanish.
 */
describe('findUntranslatedWords', () => {
  const hebrewFacts = () =>
    facts({
      appointments: {
        total: 2,
        ready: 2,
        awaitingIntake: [],
        cancelled: [],
        first: { name: 'דויד המלך', timeLocal: '09:00' },
      },
      money: {
        owed: [{ name: 'דויד המלך', amount: 200, currency: 'USD', overdue: false }],
        totalOwed: 200,
        currency: 'USD',
        mixedCurrency: false,
      },
    });

  it('catches an English label wedged into Hebrew prose', () => {
    const leaked = 'יש לך תשלום outstanding מדויד המלך.';
    expect(findUntranslatedWords(leaked, hebrewFacts(), 'he')).toEqual(['outstanding']);
  });

  it('passes clean Hebrew', () => {
    expect(findUntranslatedWords('דויד המלך חייב $200.', hebrewFacts(), 'he')).toEqual([]);
  });

  it('allows a Latin name, which must survive verbatim', () => {
    const latinName = facts({
      appointments: { ...facts().appointments, first: { name: 'Studio 54', timeLocal: '09:00' } },
      money: { owed: [], totalOwed: 0, currency: 'USD', mixedCurrency: false },
    });
    // Transliterating a client's name would describe someone the owner does
    // not recognise, so names are exempt from the check.
    expect(findUntranslatedWords('הפגישה הראשונה היא Studio 54.', latinName, 'he')).toEqual([]);
  });

  it('allows a currency code that came from the facts', () => {
    expect(findUntranslatedWords('דויד המלך חייב 200 USD.', hebrewFacts(), 'he')).toEqual([]);
  });

  it('does not police Spanish or English, where Latin script is expected', () => {
    expect(findUntranslatedWords('Tienes 2 citas hoy.', hebrewFacts(), 'es')).toEqual([]);
    expect(findUntranslatedWords('You have 2 appointments.', hebrewFacts(), 'en')).toEqual([]);
  });
});
