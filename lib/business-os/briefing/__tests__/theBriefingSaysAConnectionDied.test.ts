/**
 * A dead connection reaches the owner's inbox, not just the dashboard.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE BRIEFING AND NOT ONLY THE READINESS LINE
 *
 * The readiness line is on the dashboard, which is a page somebody has to open.
 * A Gmail grant that lapses on Friday evening stops the lead channel at once,
 * and an owner who does not open the dashboard until Monday loses a weekend of
 * enquiries without being told.
 *
 * The morning briefing is the only surface that reaches them where they are.
 * Both the email and the My Day card render the same narrative, so one fact in
 * one place serves both.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THREE THINGS THAT MAKE IT ACTUALLY ARRIVE
 *
 *   1. it is never a quiet day — `isQuiet` is the only thing standing between a
 *      business and an email, and a broken connection most often happens on a
 *      day with nothing else on it, which is exactly when the old rule would
 *      have suppressed the message;
 *   2. the deterministic composer says it, so the line survives the LLM being
 *      off, failing, or having its output rejected;
 *   3. it is the FIRST line, because every other line is something the owner
 *      can deal with at their own pace.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { isQuietDay } from '../BriefingFactsService';
import type { BriefingFacts } from '../BriefingFactsService';
import { buildStatements } from '../BriefingNarrator';

/**
 * A full empty day, not a thin stub.
 *
 * `isQuietDay` only reads two fields, so a two-field stub passes there — but
 * `buildStatements` walks every collection, and a missing array is a crash
 * rather than a quiet day. Both are exercised here, so the fixture has to
 * satisfy the stricter reader.
 */
const noAppointments = {
  total: 0,
  completed: 0,
  ready: 0,
  awaitingIntake: [],
  awaitingPayment: [],
  cancelled: [],
  noShows: [],
  notOnCalendar: [],
} as unknown as BriefingFacts['appointments'];

const noMoney = {
  owed: [],
  receivedToday: 0,
  currency: 'ILS',
} as unknown as BriefingFacts['money'];

const quietOutlook = (): BriefingFacts['outlook'] => ({
  unanswered: { count: 0, people: [] },
  refunded: { count: 0, people: [] },
  newLeads: { count: 0, people: [] },
  quotesWaiting: { count: 0, people: [] },
  quotesOut: { count: 0, people: [] },
  stagesToBill: { count: 0, people: [] },
} as unknown as BriefingFacts['outlook']);

const gmailDown: BriefingFacts['connections'] = {
  broken: [{ key: 'google-mail', name: 'Gmail' }],
};

describe('it is never a quiet day', () => {
  it('sends the email on a day whose ONLY news is a dead connection', () => {
    /*
     * THE ASSERTION THAT MATTERS. Nothing booked, nothing paid, nobody in
     * touch — the precise shape of day the old rule called quiet, and the
     * precise day on which an owner most needs to hear the lead channel died.
     */
    expect(isQuietDay(noAppointments, noMoney, quietOutlook(), gmailDown)).toBe(false);
  });

  it('is still quiet when nothing is broken', () => {
    /* The control. A rule that always returns false would pass the test above
       and mail every business every morning. */
    expect(isQuietDay(noAppointments, noMoney, quietOutlook(), { broken: [] })).toBe(true);
  });

  it.each([
    ['facts built before the field existed', undefined],
    ['an empty list', { broken: [] }],
  ])('reads %s as nothing broken', (_label, connections) => {
    /*
     * Absent-safe, like every other default in that function. The opposite
     * reading — absent means unknown, so send — would mail every business on
     * the platform daily the moment a caller lagged behind the field.
     */
    expect(
      isQuietDay(noAppointments, noMoney, quietOutlook(), connections as BriefingFacts['connections'])
    ).toBe(true);
  });
});

describe('the deterministic composer says it', () => {
  /*
   * `buildStatements` is what the fallback composes from, AND what decides
   * whether the LLM path runs at all: `narrateBriefing` goes straight to the
   * fallback when it yields nothing. So a fact the statements cannot express
   * is a fact that silently never reaches anybody when the model is off.
   */
  const facts = (overrides: Partial<BriefingFacts> = {}): BriefingFacts =>
    ({
      day: { date: '2026-11-01', timezone: 'Asia/Jerusalem' },
      appointments: noAppointments,
      money: noMoney,
      outlook: quietOutlook(),
      connections: gmailDown,
      isQuiet: false,
      ...overrides,
    } as unknown as BriefingFacts);

  it('names the plugin, in English', () => {
    const lines = buildStatements(facts(), 'en');

    expect(lines[0]).toContain('Gmail');
    expect(lines[0]).toMatch(/reconnect/i);
  });

  it.each([
    ['he', 'לחבר מחדש'],
    ['es', 'volver a conectar'],
  ])('names it in %s too', (language, phrase) => {
    /* A briefing half in another language is how a Hebrew owner learns to
       ignore it. */
    const lines = buildStatements(facts(), language as 'he' | 'es');

    expect(lines[0]).toContain('Gmail');
    expect(lines[0].toLowerCase()).toContain(phrase.toLowerCase());
  });

  it('leads with it, ahead of the day', () => {
    /* Everything else can wait until the owner gets to it. This cannot. */
    const busy = facts({
      appointments: { ...noAppointments, total: 3, ready: 3 } as unknown as BriefingFacts['appointments'],
    });

    const lines = buildStatements(busy, 'en');

    expect(lines[0]).toContain('Gmail');
    expect(lines.length).toBeGreaterThan(1);
  });

  it('says it once however many are broken, and counts the rest', () => {
    /*
     * One line, not one per plugin. Two sentences differing only in a name is
     * the shape that turned a busy day into seventeen lines, which is why this
     * module has a NAME_LIMIT rule at all.
     */
    const two = facts({
      connections: {
        broken: [
          { key: 'google-mail', name: 'Gmail' },
          { key: 'google-calendar', name: 'Google Calendar' },
        ],
      },
    });

    const lines = buildStatements(two, 'en');
    const mentions = lines.filter(line => /reconnect/i.test(line));

    expect(mentions).toHaveLength(1);
    expect(mentions[0]).toContain('Gmail');
    expect(mentions[0]).toMatch(/1 other/);
  });

  it('says nothing when nothing is broken', () => {
    const fine = facts({ connections: { broken: [] } });

    expect(buildStatements(fine, 'en').filter(l => /reconnect/i.test(l))).toEqual([]);
  });

  it('never names the mechanism', () => {
    /*
     * "The OAuth token expired" is our word for our problem. An owner needs to
     * know the thing stopped and that signing in again fixes it.
     */
    const line = buildStatements(facts(), 'en')[0];

    expect(line).not.toMatch(/token|oauth|credential|expired/i);
  });
});
