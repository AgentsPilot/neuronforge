/**
 * The day as statements: what the model is sent, and what the composer writes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The prompt used to carry a JSON object plus a 261-token dictionary explaining
 * what each key meant, and the model had to infer what was true from which keys
 * were present. On 2026-09-27 it inferred, in three runs out of three, that a
 * client had not returned an intake form. Nobody had ever sent one —
 * `awaitingIntake` was an empty array. The absence of a key is not a fact, but
 * it reads like one.
 *
 * Statements cannot be misread that way: a thing is in the list or it is not.
 * These tests hold the three properties that follow from the change —
 *
 *   the list is SHORT (aggregated in code, never capped),
 *   the list is COMPLETE (six facts the platform knew and never said),
 *   and BOTH PATHS read from it, so the model and the composer cannot tell the
 *   same day differently.
 * ─────────────────────────────────────────────────────────────────────────────
 */

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { buildStatements, composeFallback, buildPrompt } from '../BriefingNarrator';
import type { BriefingFacts } from '../BriefingFactsService';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };

function facts(overrides: DeepPartial<BriefingFacts> = {}): BriefingFacts {
  const base = {
    day: {
      timezone: 'Asia/Jerusalem',
      date: '2026-09-27',
      startUtc: '2026-09-26T21:00:00.000Z',
      endUtc: '2026-09-27T21:00:00.000Z',
      localHour: 7,
    },
    appointments: {
      total: 0,
      completed: 0,
      ready: 0,
      awaitingIntake: [],
      awaitingPayment: [],
      cancelled: [],
      noShows: [],
      syncFailures: 0,
    },
    money: {
      owed: [],
      totalOwed: 0,
      currency: 'USD',
      mixedCurrency: false,
      receivedToday: 0,
      receivedCount: 0,
      instalmentsDue: [],
      retrying: 0,
    },
    isQuiet: false,
    outlook: {
      quotesAccepted: { count: 0, people: [] },
      quotesDeclined: { count: 0, people: [] },
      unanswered: { count: 0, people: [] },
      refunded: { count: 0, people: [] },
      newLeads: { count: 0, people: [] },
      quotesWaiting: { count: 0, people: [] },
      quotesOut: { count: 0, people: [] },
    },
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

const person = (name: string) => ({ name, timeLocal: '10:00' });

describe('an empty day', () => {
  it('produces no statements at all', () => {
    // What makes the free gate possible: `narrateBriefing` can refuse to spend
    // a model call on a day that has nothing to say, without judging anything.
    expect(buildStatements(facts(), 'en')).toEqual([]);
  });

  it('still reads as a briefing from the composer', () => {
    // Zero statements is not zero output. Somebody opening the card is owed a
    // sentence saying the day is empty, not an empty card.
    expect(composeFallback(facts(), 'en')).toBe('No activity we could see for today.');
  });
});

describe('aggregation', () => {
  /**
   * The day that produced seventeen lines.
   *
   * Eight appointments, three missing intake, two unpaid, two cancellations and
   * four debts — every one of which used to get its own line while the card
   * asks for six. Nothing here is dropped; the people are counted instead of
   * listed once a list stops helping.
   */
  const busy = () =>
    facts({
      appointments: {
        total: 8,
        completed: 2,
        ready: 3,
        first: { name: 'Michael', timeLocal: '09:00' },
        awaitingIntake: [person('Sarah'), person('Dana'), person('Noa')],
        awaitingPayment: [person('Yossi'), person('Tal')],
        cancelled: [person('Eli'), person('Ron'), person('Gil')],
      },
      money: {
        owed: [
          { name: 'John', amount: 250, currency: 'USD', overdue: true, dueDate: null },
          { name: 'Ana', amount: 400, currency: 'USD', overdue: false, dueDate: null },
          { name: 'Ben', amount: 900, currency: 'USD', overdue: false, dueDate: null },
          { name: 'Cara', amount: 120, currency: 'USD', overdue: false, dueDate: null },
        ],
        totalOwed: 1670,
        currency: 'USD',
      },
    });

  it('holds a crowded day inside six statements', () => {
    expect(buildStatements(busy(), 'en').length).toBeLessThanOrEqual(6);
  });

  it('loses nothing to the shortening', () => {
    const lines = buildStatements(busy(), 'en').join('\n');

    // Every subject still present, every person still named where a name
    // fits, and every count still true.
    expect(lines).toContain('You have 8 appointments today, the first with Michael at 09:00.');
    expect(lines).toContain('2 are already done and 3 are ready.');
    expect(lines).toContain("Sarah, Dana and Noa haven't returned their intake forms.");
    expect(lines).toContain("Yossi and Tal haven't paid for today yet.");
    expect(lines).toContain('4 clients owe you $1,670, Ben the most.');
    expect(lines).toContain('3 appointments were cancelled, leaving openings.');
  });

  it('names people, in ONE line rather than one line each', () => {
    // Two lines differing only in a name is the shape that made a busy day
    // seventeen lines long. Both names survive; the second line does not.
    const two = facts({
      appointments: { total: 2, awaitingIntake: [person('Sarah'), person('Dana')] },
    });

    expect(buildStatements(two, 'en')).toContain(
      "Sarah and Dana haven't returned their intake forms."
    );
  });

  it('still gives one person their own sentence', () => {
    const one = facts({ appointments: { total: 1, awaitingIntake: [person('Sarah')] } });
    expect(buildStatements(one, 'en')).toContain("Sarah hasn't completed intake.");
  });

  it('counts the people past the names it holds', () => {
    // `people` is capped upstream; `count` covers the rest. Nothing is lost to
    // a cap — it becomes a number.
    const crowd = facts({
      appointments: {
        total: 9,
        awaitingIntake: [person('Sarah'), person('Dana'), person('Noa'), person('Tal'), person('Gil')],
      },
    });

    expect(buildStatements(crowd, 'en').join('\n')).toContain(
      "Sarah, Dana, Noa, Tal and Gil haven't returned their intake forms."
    );
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SIX FACTS THE PLATFORM KNEW AND NEVER SAID.
 *
 * The gap registry tracks ten gaps and the briefing consumed four. Each of
 * these was live data, reaching no surface the owner reads in the morning.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('facts the briefing used to be silent about', () => {
  const only = (f: BriefingFacts) => buildStatements(f, 'en').join('\n');

  describe('an enquiry nobody has answered', () => {
    it('is reported however long ago it arrived', () => {
      /*
       * The reason this one matters most. `newLeads` counts contacts created
       * TODAY, so an enquiry that arrived on Friday and was never replied to
       * did not exist on Monday morning — while the "reply to enquiries"
       * automation exists for precisely that gap.
       */
      const friday = facts({
        outlook: { unanswered: { count: 1, people: [{ name: 'Rivka' }] } },
      });

      expect(only(friday)).toContain('Rivka wrote in and are still waiting for a reply.');
    });

    it('counts them once there are more than we name', () => {
      const many = facts({
        outlook: { unanswered: { count: 5, people: [{ name: 'Rivka' }, { name: 'Tom' }] } },
      });

      expect(only(many)).toContain('Rivka, Tom and 3 more');
    });

    it('says nothing when everyone has had a reply', () => {
      expect(only(facts())).not.toContain('waiting for a reply');
    });
  });

  describe('somebody who did not turn up', () => {
    it('is not folded into the cancellations', () => {
      // A cancellation frees the slot; a no-show cost the hour. One line each.
      const missed = facts({
        appointments: { total: 1, noShows: [person('Yossi')] },
      });

      expect(only(missed)).toContain("Yossi didn't turn up.");
    });

    it('is counted past a name', () => {
      const missed = facts({
        appointments: { total: 3, noShows: [person('A'), person('B'), person('C')] },
      });

      expect(only(missed)).toContain("3 people didn't turn up.");
    });

    it('says nothing when everybody came', () => {
      expect(only(facts())).not.toContain("didn't turn up");
    });
  });

  describe('an appointment that never reached the calendar', () => {
    it('is reported, because nothing else tells them', () => {
      // The first sign of a failed sync is otherwise a client arriving for a
      // slot the owner had already given away.
      const broken = facts({ appointments: { total: 2, syncFailures: 1 } });
      expect(only(broken)).toContain("One appointment didn't reach your calendar.");
    });

    it('says nothing when the diary is in sync', () => {
      expect(only(facts())).not.toContain('calendar');
    });
  });

  describe('a plan instalment falling due', () => {
    it('is reported, though no invoice exists for it', () => {
      /*
       * Money owed on a SCHEDULE rather than against an invoice, so invisible
       * to `owed`, which reads invoices only. A client paying a course over
       * four months showed the owner nothing.
       */
      const due = facts({
        money: {
          instalmentsDue: [{ name: 'Noa', amount: 300, currency: 'USD', dueDate: '2026-09-27' }],
        },
      });

      expect(only(due)).toContain('A plan payment of $300 is due.');
    });

    it('never sums across currencies', () => {
      // There is no FX rate anywhere in this platform, so one combined total
      // would be invented. One line per currency instead.
      const mixed = facts({
        money: {
          instalmentsDue: [
            { name: 'Noa', amount: 300, currency: 'USD', dueDate: null },
            { name: 'Dan', amount: 200, currency: 'USD', dueDate: null },
            { name: 'Lea', amount: 150, currency: 'ILS', dueDate: null },
          ],
        },
      });

      const lines = buildStatements(mixed, 'en');
      expect(lines).toContain('2 plan payments are due, $500 in total.');
      expect(lines.join('\n')).toContain('₪150');
      expect(lines.join('\n')).not.toContain('650');
    });

    it('says nothing when no instalment is due', () => {
      expect(only(facts())).not.toContain('plan payment');
    });
  });

  describe('a payment that keeps failing', () => {
    it('is reported', () => {
      expect(only(facts({ money: { retrying: 2 } }))).toContain(
        '2 payments failed and are being retried.'
      );
    });

    it('says nothing when nothing is retrying', () => {
      expect(only(facts())).not.toContain('retried');
    });
  });

  describe('a refunded booking', () => {
    it('is reported with its value when the group shares a currency', () => {
      const refund = facts({
        outlook: { refunded: { count: 1, people: [{ name: 'Gil' }], value: 180, currency: 'USD' } },
      });

      expect(only(refund)).toContain('A booking was refunded, $180.');
    });

    it('is reported without a figure when it has none', () => {
      const refund = facts({ outlook: { refunded: { count: 2, people: [] } } });
      expect(only(refund)).toContain('2 bookings were refunded.');
    });

    it('says nothing when nothing was refunded', () => {
      expect(only(facts())).not.toContain('refunded');
    });
  });
});

describe('the ready line', () => {
  it('counts appointments, not people', () => {
    /*
     * "1 client is ready" beside "you have 2 appointments today" reads as a
     * fact about a different set of things — and on a day with two bookings
     * for the same client it is simply false. The model always got this right;
     * the templates said "client" in all three languages.
     */
    const day = facts({ appointments: { total: 2, ready: 1 } });

    expect(buildStatements(day, 'en')).toContain('One appointment is ready.');
    expect(buildStatements(day, 'es')).toContain('Una cita está lista.');
    expect(buildStatements(day, 'he')).toContain('פגישה אחת מוכנה.');
  });
});

describe('both paths', () => {
  it('report the same day in the same order', () => {
    /*
     * They did not, and that is why this exists: the same facts read as seven
     * flat bullets through the composer and five grouped lines through the
     * model, so the card depended on whether the provider was reachable.
     */
    const day = facts({
      appointments: {
        total: 3,
        ready: 2,
        first: { name: 'Michael', timeLocal: '09:00' },
        awaitingIntake: [person('Sarah')],
      },
      money: {
        owed: [{ name: 'John', amount: 250, currency: 'USD', overdue: true, dueDate: null }],
        totalOwed: 250,
      },
    });

    expect(composeFallback(day, 'en')).toBe(buildStatements(day, 'en').join('\n'));
  });

  it('keeps the quiet line for a day whose only content is ahead of it', () => {
    /*
     * The outlook is not today. A card whose single line was next Wednesday's
     * appointment read as though Wednesday were today, so the composer says
     * the day itself was empty first.
     */
    const ahead = facts({
      outlook: { next: { name: 'Michael', timeLocal: '09:00', dateLocal: '2026-09-30' } },
    });

    const composed = composeFallback(ahead, 'en').split('\n');
    expect(composed[0]).toBe('No activity we could see for today.');
    expect(composed.slice(1)).toEqual(buildStatements(ahead, 'en'));
  });
});

describe('the prompt', () => {
  const business = { vertical: 'coach' };

  it('is one stable prefix up to the language line', () => {
    /*
     * The provider bills a shared opening at half rate, and only from the first
     * token that differs. `LANGUAGE:` used to be the THIRD line, so a Hebrew
     * and an English briefing shared 110 characters out of 8,600 and neither
     * was ever discounted.
     */
    const en = buildPrompt(facts(), 'en', business);
    const he = buildPrompt(facts(), 'he', business);

    let shared = 0;
    while (shared < en.length && en[shared] === he[shared]) shared++;

    // Everything above `LANGUAGE:` is identical, in every language.
    expect(en.slice(0, shared)).toContain('STYLE: a trusted assistant');
    expect(en.indexOf('LANGUAGE:')).toBeLessThan(shared);
  });

  it('stays under the size a daily call can justify', () => {
    /*
     * 8,600 characters before this work, of which 2,050 tokens were static
     * instruction text re-sent to every business every morning. A quarter of
     * that was a dictionary explaining JSON field names that no longer appear.
     */
    const prompt = buildPrompt(facts(), 'en', business);
    expect(Math.round(prompt.length / 4)).toBeLessThan(900);
  });

  it('carries the day as sentences, not as a data structure', () => {
    const day = facts({ appointments: { total: 2, ready: 1 } });
    const prompt = buildPrompt(day, 'en', business);

    expect(prompt).toContain('You have 2 appointments today.');
    // The dictionary and the JSON payload are both gone.
    expect(prompt).not.toContain('awaitingIntake');
    expect(prompt).not.toContain('WHAT THE FIELDS MEAN');
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * QUOTES THE CLIENT ANSWERED TODAY.
 *
 * The briefing reported appointments, money owed and money in, and never once
 * said that a client had agreed to the work. An owner who won ₪8,500 that
 * morning read a summary about unpaid invoices.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('a quote answered today', () => {
  const lines = (f: BriefingFacts) => buildStatements(f, 'en');

  it('leads the outlook when it was accepted', () => {
    /*
     * Ahead of the unanswered enquiries, which are the most actionable thing
     * but not the best. Ordering good news below chores takes the order from
     * the database rather than from the person reading it.
     */
    const day = facts({
      outlook: {
        quotesAccepted: { count: 1, people: [{ name: 'אופיר עומר' }], value: 8500, currency: 'ILS' },
        unanswered: { count: 2, people: [{ name: 'Rivka' }, { name: 'Tom' }] },
      },
    });

    const out = lines(day);
    expect(out[0]).toBe('אופיר עומר accepted your quote, ₪8,500.');
    expect(out[1]).toContain('waiting for a reply');
  });

  it('names two and counts more, like every other fact here', () => {
    const two = facts({
      outlook: { quotesAccepted: { count: 2, people: [{ name: 'Ana' }, { name: 'Ben' }] } },
    });

    expect(lines(two)[0]).toBe('Ana and Ben accepted your quote.');
  });

  it('still says it when no name came back', () => {
    const anon = facts({ outlook: { quotesAccepted: { count: 1, people: [] } } });
    expect(lines(anon)[0]).toBe('A client accepted your quote.');
  });

  it('reports a decline without naming the client', () => {
    /*
     * Deliberate. Being named in your supplier's morning summary for saying
     * no is not something the client agreed to, and the count is the whole
     * content of the line.
     */
    const turned = facts({
      outlook: {
        quotesDeclined: { count: 1, people: [{ name: 'Ana' }], value: 2000, currency: 'ILS' },
      },
    });

    const out = lines(turned).join('\n');
    expect(out).toContain('One quote was turned down, ₪2,000.');
    expect(out).not.toContain('Ana');
  });

  it('gives the reason only when every decline today agrees on it', () => {
    /*
     * One day is not a sample. Two declines, one on price and one on timing,
     * are two anecdotes and picking the first would be arbitrary — whether
     * declines form a PATTERN is `ConvDeclineReasonDetector`'s question, and
     * it has a quarter of evidence behind it.
     */
    const agreed = facts({
      outlook: { quotesDeclined: { count: 2, people: [], topReason: 'too_expensive' } },
    });
    expect(lines(agreed).join('\n')).toContain('(too_expensive)');

    const split = facts({ outlook: { quotesDeclined: { count: 2, people: [] } } });
    expect(lines(split).join('\n')).toContain('2 quotes were turned down.');
  });

  it('says nothing when no quote was answered', () => {
    const out = lines(facts()).join('\n');
    expect(out).not.toContain('quote');
  });

  it('carries both in the languages the owner may read', () => {
    const won = facts({
      outlook: { quotesAccepted: { count: 1, people: [{ name: 'אופיר' }], value: 8500, currency: 'ILS' } },
    });

    expect(buildStatements(won, 'he')[0]).toBe('אופיר אישר את הצעת המחיר, ₪8,500.');
    expect(buildStatements(won, 'es')[0]).toBe('אופיר aceptó tu presupuesto, ₪8,500.');
  });
});
