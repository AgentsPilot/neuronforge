/**
 * The fingerprint has to move whenever the words would.
 *
 * The briefing is cached per business day, and the cached text is reused for
 * the whole day unless this hash changes. So a fact the narrator reads but the
 * hash ignores is invisible: the card keeps showing the version written this
 * morning, with no error anywhere to say why.
 *
 * That has now happened three times on this file — `outlook`, then the business
 * type, then the day's takings. The last one was the worst of them: an invoice
 * settled at 14:49 produced a "$500 came in today" line that no one ever saw,
 * because the fingerprint had not moved. These tests exist so the fourth time
 * fails here instead.
 *
 * Each case changes exactly ONE fact and asserts the hash follows. Anyone
 * adding a fact to the narrator should add a case; if they forget, the
 * catch-all at the bottom is the backstop.
 */

import { hashFacts } from '../BriefingStore';
import type { BriefingFacts } from '../BriefingFactsService';

const BASE: BriefingFacts = {
  day: {
    timezone: 'UTC',
    date: '2026-09-16',
    startUtc: '2026-09-16T00:00:00.000Z',
    endUtc: '2026-09-17T00:00:00.000Z',
    localHour: 9,
  },
  appointments: {
    total: 2,
    ready: 0,
    completed: 2,
    awaitingIntake: [],
    awaitingPayment: [],
    cancelled: [],
    first: { name: 'John Dou', timeLocal: '14:30' },
  },
  money: {
    owed: [],
    totalOwed: 0,
    currency: 'USD',
    mixedCurrency: false,
    receivedToday: 0,
    receivedCount: 0,
  },
  outlook: {
    newLeads: { count: 0, people: [] },
    quotesWaiting: { count: 0, people: [] },
    quotesOut: { count: 0, people: [] },
  },
  isQuiet: false,
} as unknown as BriefingFacts;

/** The same facts with one branch swapped, so each test changes one thing. */
function withMoney(overrides: Partial<BriefingFacts['money']>): BriefingFacts {
  return { ...BASE, money: { ...BASE.money, ...overrides } };
}

function withAppointments(overrides: Partial<BriefingFacts['appointments']>): BriefingFacts {
  return { ...BASE, appointments: { ...BASE.appointments, ...overrides } };
}

const hash = (facts: BriefingFacts) => hashFacts(facts, 'en', {});

describe('hashFacts', () => {
  it('is stable for facts that have not moved', () => {
    // Without this the cache would never hit and every reload would pay for a
    // model call — the cost the cache exists to avoid.
    expect(hash(BASE)).toBe(hash({ ...BASE }));
  });

  it('moves when money arrives', () => {
    // The failure that prompted this file.
    expect(hash(withMoney({ receivedToday: 500, receivedCount: 1 }))).not.toBe(hash(BASE));
  });

  it('moves when the same total arrives across a different number of payments', () => {
    // "$500 came in today" and "$500 came in today, across 2 payments" are
    // different sentences, so the count is part of the text, not just the sum.
    const one = withMoney({ receivedToday: 500, receivedCount: 1 });
    const two = withMoney({ receivedToday: 500, receivedCount: 2 });
    expect(hash(one)).not.toBe(hash(two));
  });

  it('moves when an appointment completes', () => {
    expect(hash(withAppointments({ completed: 1 }))).not.toBe(hash(BASE));
  });

  it('moves when someone is newly waiting to pay', () => {
    const waiting = withAppointments({
      awaitingPayment: [{ name: 'John Dou', timeLocal: '14:30' }],
    } as Partial<BriefingFacts['appointments']>);
    expect(hash(waiting)).not.toBe(hash(BASE));
  });

  it('moves when an invoice goes unpaid', () => {
    const owed = withMoney({
      owed: [{ name: 'John Dou', amount: 500, currency: 'USD', overdue: false }],
      totalOwed: 500,
    });
    expect(hash(owed)).not.toBe(hash(BASE));
  });

  it('moves when someone gets in touch', () => {
    const leads = {
      ...BASE,
      outlook: { ...BASE.outlook, newLeads: { count: 1, people: [{ name: 'Dana Levi' }] } },
    };
    expect(hash(leads)).not.toBe(hash(BASE));
  });

  it('separates languages', () => {
    // Same day told in two languages is two different pieces of text; a user
    // switching language must not be served the previous one.
    expect(hashFacts(BASE, 'en', {})).not.toBe(hashFacts(BASE, 'he', {}));
  });

  it('separates business types', () => {
    // The vertical decides the vocabulary — a trainer's "trainees" against a
    // clinic's "patients" — so a corrected profile has to re-narrate.
    expect(hashFacts(BASE, 'en', { vertical: 'fitness' })).not.toBe(
      hashFacts(BASE, 'en', { vertical: 'legal' })
    );
  });

  it('covers every field of the facts the narrator reads', () => {
    /*
     * The backstop for a fact added without a case above.
     *
     * It walks every field of every branch, changes it, and requires the
     * fingerprint to notice. A named test above is always the better failure —
     * it says what broke — but this is what catches the field nobody wrote a
     * test for, which is how all three of the bugs in the header got in.
     */
    const unhashed: string[] = [];

    for (const branch of BRANCHES) {
      const source = BASE[branch] as Record<string, unknown>;

      for (const key of Object.keys(source)) {
        if (DERIVED.has(`${branch}.${key}`)) continue;

        const flipped = flip(source[key]);
        if (flipped === undefined) continue; // nothing meaningful to change

        const mutated = {
          ...BASE,
          [branch]: { ...source, [key]: flipped },
        } as BriefingFacts;

        if (hash(mutated) === hash(BASE)) unhashed.push(`${branch}.${key}`);
      }
    }

    expect(unhashed).toEqual([]);
  });

  it('excuses only fields that cannot move on their own', () => {
    /*
     * A guard on the exemption list. Every name in `DERIVED` has to still be a
     * real field — otherwise a rename turns a deliberate exemption into a
     * silent hole, which is the same class of bug all over again.
     */
    const stale = [...DERIVED].filter(path => {
      const [branch, key] = path.split('.') as [keyof BriefingFacts, string];
      return !(key in (BASE[branch] as object));
    });

    expect(stale).toEqual([]);
  });
});

const BRANCHES: Array<keyof BriefingFacts> = ['appointments', 'money', 'outlook'];

/**
 * Fields the hash may leave out, each because it is computed from something
 * the hash already covers and so cannot change while that stays still.
 *
 * Nothing goes in here to make a test pass. `money.currency` looked like it
 * belonged and did not: with nothing owed it is taken from the day's takings,
 * so it can change while every amount stays identical. It is hashed.
 */
const DERIVED = new Set([
  // A sum of `money.owed`, which is hashed entry by entry.
  'money.totalOwed',
  // True exactly when `money.owed` holds more than one currency — same source.
  'money.mixedCurrency',
]);

/** A different value of the same shape, or undefined when there isn't one. */
function flip(value: unknown): unknown {
  if (typeof value === 'number') return value + 1;
  if (typeof value === 'string') return `${value}-changed`;
  if (typeof value === 'boolean') return !value;
  if (Array.isArray(value)) return [...value, { name: 'Probe', amount: 1, currency: 'USD', timeLocal: '10:00' }];
  // `name` rather than an invented key: the hash reads named sub-fields out of
  // these objects, so probing with something it never looks at would report a
  // covered field as a gap.
  if (value && typeof value === 'object') return { ...(value as object), name: 'Probe' };
  if (value === null) return { name: 'Probe', timeLocal: '10:00', dateLocal: 'Wednesday' };
  return undefined;
}
