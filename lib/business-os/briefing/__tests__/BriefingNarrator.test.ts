import { findUnsupportedFigures, findUntranslatedWords, composeFallback, dropUnsupportedLines } from '../BriefingNarrator';
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

/**
 * Nested objects MERGE with the defaults rather than replacing them.
 *
 * A test that overrides one appointment field used to have to restate every
 * other, so adding a fact to `BriefingFacts` broke every fixture in the file at
 * once. Merging means a case says only what it is about.
 */
type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };

function facts(overrides: DeepPartial<BriefingFacts> = {}): BriefingFacts {
  const base = {
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
      noShows: [],
      syncFailures: 0,
    },
    money: {
      owed: [{ name: 'John', amount: 250, currency: 'USD', overdue: true, dueDate: null }],
      totalOwed: 250,
      currency: 'USD',
      mixedCurrency: false, receivedToday: 0, receivedCount: 0,
      instalmentsDue: [], retrying: 0,
    },
    isQuiet: false,
    outlook: { unanswered: { count: 0, people: [] }, refunded: { count: 0, people: [] }, newLeads: { count: 0, people: [] }, quotesWaiting: { count: 0, people: [] }, quotesOut: { count: 0, people: [] } },
  };

  return {
    ...base,
    ...overrides,
    day: { ...base.day, ...overrides.day },
    appointments: { ...base.appointments, ...overrides.appointments },
    money: { ...base.money, ...overrides.money },
    outlook: { ...base.outlook, ...overrides.outlook },
  } as BriefingFacts;
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
        owed: [{ name: 'John', amount: 1250.5, currency: 'USD', overdue: false, dueDate: null }],
        totalOwed: 1250.5,
        currency: 'USD',
        mixedCurrency: false, receivedToday: 0, receivedCount: 0,
      instalmentsDue: [], retrying: 0,
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
        owed: [{ name: 'דויד המלך', amount: 200, currency: 'USD', overdue: false, dueDate: null }],
        totalOwed: 200,
        currency: 'USD',
        mixedCurrency: false, receivedToday: 0, receivedCount: 0,
      instalmentsDue: [], retrying: 0,
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

/**
 * The sum of two debts is not a fabrication.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `toPromptShape` sends `totalOwed` only when there are MORE than two debts;
 * with one or two it lists them individually and the total never reaches the
 * payload. But adding two amounts is the most natural thing a narrator does
 * when shown two, so the guard called a correct sum invented and discarded the
 * whole briefing.
 *
 * A business with one or two unpaid invoices is the ordinary case, so this
 * rejected the narration nearly every day. One live account fell back to the
 * templates on every briefing it ever received, while the model was called and
 * paid for each time — the failure was invisible because the fallback reads
 * like a briefing.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('findUnsupportedFigures — money the model may state', () => {
  const twoDebts = {
    day: { date: '2026-09-27', timezone: 'America/New_York', label: 'Sunday, September 27' },
    appointments: {
      total: 2, completed: 0, ready: 2,
      awaitingIntake: [], awaitingPayment: [], cancelled: [],
    },
    money: {
      owed: [
        { name: 'David', amount: 4250, currency: 'ILS', overdue: false, dueDate: '2026-11-09' },
        { name: 'Ofir', amount: 300, currency: 'ILS', overdue: false, dueDate: '2026-09-27' },
      ],
      totalOwed: 4550,
      currency: 'ILS',
      mixedCurrency: false,
      receivedToday: 0,
      receivedCount: 0,
    },
    outlook: {
      newLeads: { count: 0, people: [] },
      quotesWaiting: { count: 0, people: [] },
      quotesOut: { count: 0 },
    },
    isQuiet: false,
  } as unknown as Parameters<typeof findUnsupportedFigures>[1];

  it('permits the total of two debts, which is never sent in the payload', () => {
    // The exact narration that was rejected in production on 2026-09-27.
    expect(findUnsupportedFigures('David and Ofir owe you 4,550.', twoDebts)).toEqual([]);
  });

  it('permits each debt on its own', () => {
    expect(findUnsupportedFigures('David owes 4,250 and Ofir owes 300.', twoDebts)).toEqual([]);
  });

  it('permits the count of people who owe', () => {
    expect(findUnsupportedFigures('2 clients owe you money.', twoDebts)).toEqual([]);
  });

  it('still catches a figure that is genuinely invented', () => {
    // The guard has to keep working: 9,999 is nowhere in the facts.
    expect(findUnsupportedFigures('They owe you 9,999.', twoDebts)).toEqual(['9999']);
  });
});

/**
 * A sentence about something that never happened.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The word and figure guards check HOW a thing is said. Neither can see a
 * perfectly worded, correctly numbered claim about an event that does not
 * exist. On 2026-09-27 the model wrote, in every sample run, that the client
 * had not returned his intake form — when no form had ever been sent.
 *
 * The same rule covers absence-reporting ("no money came in today"), because
 * it is the same fault: a sentence about a subject the day is silent on.
 *
 * Lines are dropped rather than the briefing rejected. Falling back over one
 * bad sentence is how an owner ends up reading the flat template version.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('dropUnsupportedLines', () => {
  const day = (over: Record<string, unknown> = {}) => ({
    day: { date: '2026-09-27', timezone: 'UTC', label: 'Sunday' },
    appointments: {
      total: 2, completed: 0, ready: 1,
      awaitingIntake: [], awaitingPayment: [],
      cancelled: [{ name: 'Ofir', timeLocal: '09:00' }],
      first: { name: 'Ofir', timeLocal: '09:30' },
      ...(over.appointments as object ?? {}),
    },
    money: {
      owed: [{ name: 'Ofir', amount: 300, currency: 'ILS', overdue: false, dueDate: '2026-09-27' }],
      totalOwed: 300, currency: 'ILS', mixedCurrency: false,
      receivedToday: 0, receivedCount: 0,
      ...(over.money as object ?? {}),
    },
    outlook: {
      newLeads: { count: 0, people: [] },
      quotesWaiting: { count: 0, people: [] },
      quotesOut: { count: 0 },
      ...(over.outlook as object ?? {}),
    },
    isQuiet: false,
  } as unknown as BriefingFacts);

  it('drops the intake claim that was invented in production', () => {
    const { kept, dropped } = dropUnsupportedLines(
      'You have 2 appointments today.\nOfir has not returned his intake form.',
      day(),
      'en'
    );

    expect(dropped).toEqual(['Ofir has not returned his intake form.']);
    expect(kept).toBe('You have 2 appointments today.');
  });

  it('drops it in Hebrew, which is where it actually happened', () => {
    const { dropped } = dropUnsupportedLines(
      'יש לך 2 פגישות היום.\nאופיר עומר לא השלים את הטופס.',
      day(),
      'he'
    );

    expect(dropped).toEqual(['אופיר עומר לא השלים את הטופס.']);
  });

  it('drops a line reporting an absence', () => {
    // A briefing is what happened, not an inventory of what did not.
    const { dropped } = dropUnsupportedLines(
      'You have 2 appointments today.\nThere are no new enquiries.',
      day(),
      'en'
    );

    expect(dropped).toEqual(['There are no new enquiries.']);
  });

  it('keeps a subject the day genuinely has', () => {
    // `cancelled` has an entry, so the cancellation line must survive.
    const { kept, dropped } = dropUnsupportedLines('Ofir cancelled the 09:00.', day(), 'en');

    expect(dropped).toEqual([]);
    expect(kept).toBe('Ofir cancelled the 09:00.');
  });

  it('keeps money owed when somebody genuinely owes', () => {
    const { dropped } = dropUnsupportedLines('Ofir owes 300.', day(), 'en');

    expect(dropped).toEqual([]);
  });

  it('drops money owed when nobody does', () => {
    const facts = day({ money: { owed: [], totalOwed: 0, currency: 'ILS', mixedCurrency: false, receivedToday: 0, receivedCount: 0 } });

    expect(dropUnsupportedLines('Nobody owes you anything.', facts, 'en').dropped).toHaveLength(1);
  });

  it('removes only the offending line, never the whole briefing', () => {
    const { kept } = dropUnsupportedLines(
      'You have 2 appointments today.\nThere are no new enquiries.\nOfir cancelled the 09:00.',
      day(),
      'en'
    );

    expect(kept.split('\n')).toEqual([
      'You have 2 appointments today.',
      'Ofir cancelled the 09:00.',
    ]);
  });
});
