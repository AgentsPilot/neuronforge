import { findUnsupportedFigures, findUntranslatedWords, composeFallback } from '../BriefingNarrator';
import type { BriefingFacts } from '../BriefingFactsService';

/*
 * Layer 2 (Step 2): the call sites take their model, temperature and on/off
 * switch from `resolveBosLlmSettings`. Pinned to the CODE DEFAULTS — today's
 * values — so this file keeps asserting exactly what it asserted before, with
 * no configuration read and no I/O.
 */
jest.mock('@/lib/business-os/llm/modelSettings', () => {
  const actual = jest.requireActual('@/lib/business-os/llm/modelSettings');
  return {
    ...actual,
    resolveBosLlmSettings: async (area: string, callName: string) => actual.bosLlmCodeDefaults(area, callName),
  };
});

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
      completed: 0,
      ready: 5,
      awaitingIntake: [{ name: 'Sarah', timeLocal: '11:00' }],
      awaitingPayment: [],
      first: { name: 'Michael', timeLocal: '09:00', serviceName: 'Assessment 1' },
      cancelled: [{ name: 'Dana', timeLocal: '15:00' }],
    },
    money: {
      owed: [{ name: 'John', amount: 250, currency: 'USD', overdue: true }],
      totalOwed: 250,
      currency: 'USD',
      mixedCurrency: false, receivedToday: 0, receivedCount: 0,
    },
    isQuiet: false,
    ...overrides,
    // After the spread, so a `Partial` that names no outlook cannot widen the
    // field to `undefined` — most cases in this file only care about today.
    outlook: overrides.outlook ?? { newLeads: { count: 0, people: [] }, quotesWaiting: { count: 0, people: [] }, quotesOut: { count: 0, people: [] } },
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

  it('does NOT license every number just because the date contains it', () => {
    /*
     * This used to assert the opposite, and the opposite was a hole.
     *
     * Permitting the date "in every shape it might be written" allowed each of
     * its components through for the whole briefing: on the 17th of September,
     * 17 and 9 became valid figures anywhere in the prose. A real account was
     * told it had "9 new enquiries" on a day with one, and this check passed it
     * — the 9 came from the month.
     *
     * A guard that permits 1-31 and 1-12 all month is not a guard. The cost of
     * the swap is small and safe: the model is told not to write a date at all
     * (no headings, no greeting), and if it does anyway the briefing falls back
     * to the deterministic composer rather than shipping something wrong.
     */
    const day = facts();
    expect(findUnsupportedFigures(`Today is 8 September ${day.day.date.slice(0, 4)}.`, day))
      .not.toEqual([]);
  });

  it('still allows figures that really are in the facts', () => {
    // The other half of the trade: tightening the date must not start flagging
    // counts the facts genuinely support.
    expect(findUnsupportedFigures('You have 6 appointments.', facts())).toEqual([]);
  });

  it('tolerates thousands separators and decimals on a real amount', () => {
    const large = facts({
      money: {
        owed: [{ name: 'John', amount: 1250.5, currency: 'USD', overdue: false }],
        totalOwed: 1250.5,
        currency: 'USD',
        mixedCurrency: false, receivedToday: 0, receivedCount: 0,
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
      appointments: { total: 1, completed: 0, ready: 1, awaitingIntake: [],
      awaitingPayment: [], cancelled: [], first: undefined },
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
      appointments: { total: 0, completed: 0, ready: 0, awaitingIntake: [],
      awaitingPayment: [], cancelled: [], first: undefined },
      money: { owed: [], totalOwed: 0, currency: 'USD', mixedCurrency: false, receivedToday: 0, receivedCount: 0 },
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
        completed: 0,
        ready: 2,
        awaitingIntake: [],
      awaitingPayment: [],
        cancelled: [],
        first: { name: 'דויד המלך', timeLocal: '09:00' },
      },
      money: {
        owed: [{ name: 'דויד המלך', amount: 200, currency: 'USD', overdue: false }],
        totalOwed: 200,
        currency: 'USD',
        mixedCurrency: false, receivedToday: 0, receivedCount: 0,
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
      money: { owed: [], totalOwed: 0, currency: 'USD', mixedCurrency: false, receivedToday: 0, receivedCount: 0 },
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

/**
 * The briefing used to say "2 new people got in touch today" — true, and an
 * errand rather than an answer: the owner still had to open the CRM to find out
 * who. These cover the names it now carries instead.
 */
describe('naming the people who got in touch', () => {
  const leads = (count: number, people: Array<{ name: string; note?: string }>) =>
    facts({ outlook: { newLeads: { count, people }, quotesWaiting: { count: 0, people: [] }, quotesOut: { count: 0, people: [] } } });

  it('names one person, and says what they asked about', () => {
    const line = composeFallback(
      leads(1, [{ name: 'Dana Levi', note: 'the intro call' }]),
      'en'
    );
    expect(line).toContain('Dana Levi');
    expect(line).toContain('the intro call');
  });

  it('joins a handful of names rather than counting them', () => {
    const line = composeFallback(
      leads(2, [{ name: 'Dana Levi' }, { name: 'Ben Cohen' }]),
      'en'
    );
    expect(line).toContain('Dana Levi and Ben Cohen');
    expect(line).not.toContain('2 new people');
  });

  it('drops the note once there is a list, so the line stays a summary', () => {
    const line = composeFallback(
      leads(2, [{ name: 'Dana Levi', note: 'a quote' }, { name: 'Ben Cohen' }]),
      'en'
    );
    expect(line).not.toContain('a quote');
  });

  it('accounts for everyone when it can only name a few', () => {
    // Three names held, six people arrived. The total must survive.
    const line = composeFallback(
      leads(6, [{ name: 'A' }, { name: 'B' }, { name: 'C' }]),
      'en'
    );
    expect(line).toContain('3 more');
  });

  it('falls back to counting when nobody left a name', () => {
    expect(composeFallback(leads(2, []), 'en')).toContain('2 new people');
    expect(composeFallback(leads(1, []), 'en')).toContain('Someone new');
  });

  it('says nothing at all on a day when nobody got in touch', () => {
    const line = composeFallback(leads(0, []), 'en');
    expect(line).not.toContain('got in touch');
  });

  it('names them in Spanish and Hebrew too', () => {
    const people = [{ name: 'Dana Levi' }];
    expect(composeFallback(leads(1, people), 'es')).toContain('Dana Levi');
    expect(composeFallback(leads(1, people), 'he')).toContain('Dana Levi');
  });

  it('lets a name through the invented-number guard', () => {
    // The guard exists to catch figures the model made up. A person's name is
    // not a figure, and a name that came from the facts must not trip it.
    const withLeads = leads(1, [{ name: 'Dana Levi', note: '2 sessions a week' }]);
    const narrative = composeFallback(withLeads, 'en');
    expect(findUnsupportedFigures(narrative, withLeads)).toEqual([]);
  });
});
