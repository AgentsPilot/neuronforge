/**
 * What an hour costs, asserted.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The owner's dialog offers a free-text time field beside a banner of opening
 * hours. These are the rules that replace it: of the hours that ARE free, which
 * one leaves the day whole.
 *
 * `strands` is the rule with money in it, and it is the one most easily got
 * wrong — a 90-minute gap and a 60-minute service leaves 30 minutes nobody can
 * book. Each side of the slot is judged on its own and only then summed: a
 * two-hour window booked through the middle leaves 30 before and 30 after, a
 * total that passes a test against a 60-minute service while neither half can
 * ever be sold. Both cases are below; the second caught the first draft.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  analyseSlots,
  suggestSlots,
  bookingWarnings,
  type Slot,
  type AnalysedSlot,
} from '@/lib/scheduling/slotIntelligence';

const ZONE = 'Asia/Jerusalem';

/** A slot on 2026-10-19, given as the business's wall clock. */
const at = (hhmm: string, durationMinutes = 60): Slot => {
  const [h, m] = hhmm.split(':').map(Number);
  /* +03:00 is Jerusalem in October, so the fixture reads as the owner sees it. */
  const start = new Date(`2026-10-19T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+03:00`);
  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + durationMinutes * 60_000).toISOString(),
    available: true,
  };
};

const busyAt = (from: string, to: string) => ({
  start: at(from).start,
  end: at(to).start,
});

const taken = (slot: Slot): Slot => ({ ...slot, available: false });

const kindOf = (slots: AnalysedSlot[], hhmm: string) =>
  slots.find(s => s.start === at(hhmm).start)?.consequence?.kind ?? null;

describe('the hour that wastes nothing', () => {
  it('a slot filling its gap exactly closes the window', () => {
    /*
     * 09:00 and 11:00 are booked; 10:00 is the only hour between them. Taking
     * it leaves no remainder at all.
     */
    const slots = [at('10:00')];
    const busy = [busyAt('09:00', '10:00'), busyAt('11:00', '12:00')];

    const analysed = analyseSlots({ slots, busy, durationMinutes: 60, dayIsEmpty: false });

    expect(kindOf(analysed, '10:00')).toBe('closes_window');
  });

  it('is found across a day of several gaps', () => {
    const slots = [at('10:00'), at('14:00'), at('15:00')];
    const busy = [busyAt('09:00', '10:00'), busyAt('11:00', '12:00'), busyAt('16:00', '17:00')];

    const analysed = analyseSlots({ slots, busy, durationMinutes: 60, dayIsEmpty: false });

    expect(kindOf(analysed, '10:00')).toBe('closes_window');
  });
});

describe('the hour that strands time', () => {
  it('reports the minutes nobody can sell', () => {
    /*
     * A 90-minute gap between 10:00 and 11:30, with a 60-minute service.
     * Whichever end is taken, 30 minutes are left that cannot be booked.
     */
    const slots = [at('10:00'), at('10:30')];
    const busy = [busyAt('09:00', '10:00'), busyAt('11:30', '12:30')];

    const analysed = analyseSlots({ slots, busy, durationMinutes: 60, dayIsEmpty: false });
    const first = analysed.find(s => s.start === at('10:00').start)!;

    expect(first.consequence).toEqual({ kind: 'strands', minutes: 30 });
  });

  it('sums both sides, because neither half is sellable alone', () => {
    /*
     * The case a naive check misses. A two-hour gap with a one-hour service
     * taken from the MIDDLE leaves 30 before and 30 after — an hour of lost
     * time, in two pieces that each look harmless.
     */
    const slots = [at('09:00'), at('09:30'), at('10:00')];
    const busy = [busyAt('08:00', '09:00'), busyAt('11:00', '12:00')];

    const analysed = analyseSlots({ slots, busy, durationMinutes: 60, dayIsEmpty: false });
    const middle = analysed.find(s => s.start === at('09:30').start)!;

    expect(middle.consequence).toEqual({ kind: 'strands', minutes: 60 });
  });

  it('a remainder long enough to sell is not stranded', () => {
    /* A three-hour gap: taking the first hour leaves two, which is a booking. */
    const slots = [at('09:00'), at('10:00'), at('11:00')];
    const busy = [busyAt('08:00', '09:00'), busyAt('12:00', '13:00')];

    const analysed = analyseSlots({ slots, busy, durationMinutes: 60, dayIsEmpty: false });

    expect(kindOf(analysed, '09:00')).not.toBe('strands');
  });
});

describe('a day with nothing on it', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * "Opens a day" used to be checked FIRST here and to outrank everything, so
   * every hour of an empty day came back with the same three words — on
   * exactly the day where the owner has the most freedom to choose well and
   * most needs the hours told apart.
   *
   * It is a fact about the DAY. It is said once beside the day now, in a
   * sentence that explains what it costs, and these hours are free to say what
   * they each do to the day's shape.
   * ───────────────────────────────────────────────────────────────────────────
   */
  it('lets each hour say what it does, rather than answering for all of them', () => {
    const analysed = analyseSlots({
      slots: [at('09:00'), at('10:00'), at('11:00')],
      busy: [],
      durationMinutes: 60,
      dayIsEmpty: true,
    });

    /* Room on both sides of each, so none of them wastes anything. */
    expect(analysed.slice(0, 2).every(s => s.consequence === null)).toBe(true);
  });

  it('and the last one still closes the day', () => {
    const analysed = analyseSlots({
      slots: [at('09:00'), at('10:00')],
      busy: [],
      durationMinutes: 60,
      dayIsEmpty: true,
    });

    expect(kindOf(analysed, '10:00')).toBe('closes_day');
  });

  it('while an hour that strands a remainder still says so', () => {
    /*
     * Two starts, so the gap they span is 09:00–10:30. Taking 09:00 leaves
     * half an hour nobody can book an hour into.
     *
     * One start would NOT show this: `freeGaps` derives the gap from the
     * SLOTS, so a lone 09:00 makes a gap of exactly 09:00–10:00 and the hour
     * closes it perfectly. That is what this fixture used to assert by
     * accident, and the mistake is worth keeping written down.
     */
    const analysed = analyseSlots({
      slots: [at('09:00'), at('09:30')],
      busy: [],
      durationMinutes: 60,
    });

    expect(kindOf(analysed, '09:00')).toBe('strands');
  });
});

describe('the last hour of the day', () => {
  it('closes it', () => {
    const slots = [at('15:00'), at('16:00')];
    const busy = [busyAt('09:00', '15:00')];

    const analysed = analyseSlots({ slots, busy, durationMinutes: 60, dayIsEmpty: false });

    expect(kindOf(analysed, '16:00')).toBe('closes_day');
  });
});

describe('a taken hour has no consequence', () => {
  it('because the grid has already struck it through', () => {
    const slots = [taken(at('09:00')), at('10:00')];
    const busy = [busyAt('09:00', '10:00')];

    const analysed = analyseSlots({ slots, busy, durationMinutes: 60, dayIsEmpty: false });

    expect(analysed[0].consequence).toBeNull();
  });
});

describe('what is put in front of the owner', () => {
  const now = new Date('2026-10-19T05:00:00+03:00');

  it('leads with the soonest hour that works for this service', () => {
    /*
     * It used to lead with whichever hour wasted nothing, anywhere in the
     * window — which put TOMORROW at the top while today still had hours
     * free, and the top row is read as the recommendation. "When can I see
     * this person" is answered soonest-first; a later hour needs a reason to
     * outrank it, and "it tidies the diary" is not one the owner asked for.
     *
     * What the hour costs is still said, as a mark on the row.
     */
    const analysed = analyseSlots({
      slots: [at('09:00'), at('10:00'), at('14:00')],
      busy: [busyAt('08:00', '09:00'), busyAt('11:00', '12:00')],
      durationMinutes: 60,
    });

    const [first] = suggestSlots({ slots: analysed, now, timeZone: ZONE });

    /*
     * 14:00 is the hour that wastes nothing: it sits in a gap exactly its own
     * length, so taking it leaves no remainder. That is the one piece of
     * advice the owner cannot reach by reading a list of times, and it is what
     * the mockup's lead row shows.
     *
     * Not 09:00, even though 09:00 is earlier and free: it leaves an hour
     * dangling behind it. Not 10:00 either — that one has an hour in front of
     * it, so it does not close its gap, it only ends it.
     *
     * The lead is still on the SOONEST DAY, which is the part that matters:
     * it used to range over the whole week and put tomorrow above a today
     * with eight hours free.
     */
    expect(first.reason).toBe('closes_window');
    expect(first.slot.start).toBe(at('14:00').start);
  });

  it('offers the hour this client keeps choosing', () => {
    /* Two bookings at 16:00 is a habit; one would be a coincidence. */
    const analysed = analyseSlots({
      slots: [at('09:00'), at('16:00')],
      busy: [],
      durationMinutes: 60,
      dayIsEmpty: false,
    });

    const out = suggestSlots({
      slots: analysed,
      now,
      timeZone: ZONE,
      clientHistory: [
        '2026-09-07T16:00:00+03:00',
        '2026-09-21T16:00:00+03:00',
      ],
    });

    expect(out.some(s => s.reason === 'client_usual_hour')).toBe(true);
  });

  it('does not call a single past booking a habit', () => {
    const analysed = analyseSlots({
      slots: [at('09:00'), at('16:00')],
      busy: [],
      durationMinutes: 60,
      dayIsEmpty: false,
    });

    const out = suggestSlots({
      slots: analysed,
      now,
      timeZone: ZONE,
      clientHistory: ['2026-09-07T16:00:00+03:00'],
    });

    expect(out.some(s => s.reason === 'client_usual_hour')).toBe(false);
  });

  it('two bookings at different hours are not a habit either', () => {
    /*
     * The count has to BEAT one, not merely reach it. Two bookings at two
     * different hours is a client with no pattern, and offering one of them as
     * "their usual" is an invention.
     */
    /*
     * 09:00 is the slot the first suggestion takes, so neither history hour can
     * be consumed by it — otherwise this passes for the wrong reason, which is
     * exactly what the first draft of this test did.
     */
    const analysed = analyseSlots({
      slots: [at('09:00'), at('14:00'), at('16:00')],
      busy: [busyAt('08:00', '09:00'), busyAt('10:00', '11:00')],
      durationMinutes: 60,
      dayIsEmpty: false,
    });

    const out = suggestSlots({
      slots: analysed,
      now,
      timeZone: ZONE,
      clientHistory: ['2026-09-07T14:00:00+03:00', '2026-09-21T16:00:00+03:00'],
    });

    expect(out.some(s => s.reason === 'client_usual_hour')).toBe(false);
  });

  it('offers ONE row when only one thing is true', () => {
    /*
     * A filler used to pad this to three with the next hours in order, each
     * announcing itself as a find — hours the owner could already see in the
     * grid below. Three rows saying one thing is worse than one row.
     */
    const analysed = analyseSlots({
      slots: [at('09:00'), at('10:00'), at('11:00')],
      busy: [],
      durationMinutes: 60,
    });

    const out = suggestSlots({ slots: analysed, now, timeZone: ZONE });

    expect(out).toHaveLength(1);
    expect(out[0].reason).toBe('soonest');
  });

  it('and adds the hour that uses a gap up exactly, when there is one', () => {
    /* Distinct from the soonest, and the one thing the owner cannot see by
       looking at a list of hours. */
    const analysed = analyseSlots({
      slots: [at('09:00'), at('13:00')],
      busy: [busyAt('12:00', '13:00'), busyAt('14:00', '15:00')],
      durationMinutes: 60,
    });

    const out = suggestSlots({ slots: analysed, now, timeZone: ZONE });

    /* Both hours close their own gap; the earlier one leads. There is no
       second day in this fixture, so there is nothing else to say. */
    expect(out.map(s => s.reason)).toEqual(['closes_window']);
  });

  it('never suggests an hour in the past', () => {
    const analysed = analyseSlots({
      slots: [at('04:00'), at('09:00')],
      busy: [],
      durationMinutes: 60,
      dayIsEmpty: false,
    });

    const out = suggestSlots({ slots: analysed, now, timeZone: ZONE });

    expect(out.every(s => new Date(s.slot.start) > now)).toBe(true);
  });

  it('never repeats one slot across two reasons', () => {
    const analysed = analyseSlots({
      slots: [at('16:00')],
      busy: [],
      durationMinutes: 60,
      dayIsEmpty: false,
    });

    const out = suggestSlots({
      slots: analysed,
      now,
      timeZone: ZONE,
      clientHistory: ['2026-09-07T16:00:00+03:00', '2026-09-21T16:00:00+03:00'],
    });

    expect(new Set(out.map(s => s.slot.start)).size).toBe(out.length);
  });

  it('returns nothing when the day is full', () => {
    const analysed = analyseSlots({
      slots: [taken(at('09:00'))],
      busy: [busyAt('09:00', '10:00')],
      durationMinutes: 60,
      dayIsEmpty: false,
    });

    expect(suggestSlots({ slots: analysed, now, timeZone: ZONE })).toEqual([]);
  });

  it('stops at three, so it does not become a second grid', () => {
    const analysed = analyseSlots({
      slots: [at('09:00'), at('10:00'), at('11:00'), at('12:00'), at('13:00')],
      busy: [],
      durationMinutes: 60,
      dayIsEmpty: false,
    });

    expect(suggestSlots({ slots: analysed, now, timeZone: ZONE }).length).toBeLessThanOrEqual(3);
  });
});

describe('what the hour will quietly cost', () => {
  const now = new Date('2026-10-19T09:00:00+03:00');

  it('warns that the 24-hour reminder will never send', () => {
    /*
     * The reminder cron stamps `reminder_24hr_sent`. A meeting booked less than
     * 24 hours out passes that point before the row exists, so the client gets
     * the two-hour reminder and nothing else.
     */
    const out = bookingWarnings({
      start: at('14:00').start,
      now,
      requiresIntake: false,
    });

    expect(out.map(w => w.kind)).toContain('no_24h_reminder');
  });

  it('stays quiet when there is time for it', () => {
    const out = bookingWarnings({
      start: new Date('2026-10-23T14:00:00+03:00').toISOString(),
      now,
      requiresIntake: false,
    });

    expect(out).toEqual([]);
  });

  it('says how long the client has to return the intake form', () => {
    const out = bookingWarnings({
      start: at('14:00').start,
      now,
      requiresIntake: true,
    });

    const intake = out.find(w => w.kind === 'intake_lead_time');

    expect(intake?.hoursAhead).toBe(5);
  });

  it('does not mention intake for a service that asks for none', () => {
    const out = bookingWarnings({ start: at('14:00').start, now, requiresIntake: false });

    expect(out.some(w => w.kind === 'intake_lead_time')).toBe(false);
  });

  it('says nothing about an hour already past', () => {
    const out = bookingWarnings({
      start: at('08:00').start,
      now,
      requiresIntake: true,
    });

    expect(out).toEqual([]);
  });
});

describe('suggestions stay on the soonest day that has anything free', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * These rules used to range over the whole window, so the hour that wasted
   * nothing could be found on Thursday while the owner looked at Monday.
   *
   * In practice it put TOMORROW at the top of the list while today still had
   * eight hours free, and the top one is read as the recommendation. "Book it
   * tomorrow" is a strange answer to "when can I see this person".
   *
   * The later day is still reachable through the day strip, with its cost
   * written on every hour. It is simply not put forward ahead of today.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const now = new Date('2026-10-19T05:00:00.000Z'); // 08:00 in Jerusalem

  /** The same wall clock, a day later. */
  const tomorrowAt = (hhmm: string, durationMinutes = 60): Slot => {
    const [h, m] = hhmm.split(':').map(Number);
    const start = new Date(
      `2026-10-20T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+03:00`
    );
    return {
      start: start.toISOString(),
      end: new Date(start.getTime() + durationMinutes * 60_000).toISOString(),
      available: true,
    };
  };

  it('even when a later day holds the only hour that wastes nothing', () => {
    /*
     * Today is wide open, so nothing on it can close a gap. Tomorrow has a
     * meeting that 10:00 fits exactly against — the old top suggestion.
     */
    const today = analyseSlots({
      slots: [at('11:00'), at('12:00')],
      busy: [],
      durationMinutes: 60,
      dayIsEmpty: true,
    });

    const tomorrow = analyseSlots({
      slots: [tomorrowAt('10:00')],
      busy: [{ start: tomorrowAt('11:00').start, end: tomorrowAt('12:00').start }],
      durationMinutes: 60,
      dayIsEmpty: false,
    });

    const out = suggestSlots({ slots: [...today, ...tomorrow], now, timeZone: ZONE });

    /*
     * The LEAD is what is pinned to the soonest day — it is read as the
     * recommendation, and "book it tomorrow" is a strange answer while today
     * has hours free.
     *
     * The rows BELOW it may be elsewhere, and that is the point of them: the
     * client's usual hour can be on Thursday, and the third row is explicitly
     * the first hour of the next day. An owner would never find either by
     * clicking the strip along one day at a time.
     */
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].slot.start.startsWith('2026-10-19')).toBe(true);

    const nextDay = out.find(x => x.reason === 'next_day');
    if (nextDay) expect(nextDay.slot.start.startsWith('2026-10-20')).toBe(true);
  });

  it('and moves to the next day when today has nothing left', () => {
    /* The rule is "the soonest day with anything free", not "today". */
    const tomorrow = analyseSlots({
      slots: [tomorrowAt('10:00')],
      busy: [],
      durationMinutes: 60,
      dayIsEmpty: true,
    });

    const [first] = suggestSlots({ slots: tomorrow, now, timeZone: ZONE });

    expect(first.slot.start).toBe(tomorrowAt('10:00').start);
  });

  it('and an hour already past does not hold the day open', () => {
    /*
     * Today's only slot has gone, so the soonest day is tomorrow — the past
     * filter runs first, or a spent day would suppress every suggestion.
     */
    const spent = analyseSlots({
      slots: [at('07:00')],
      busy: [],
      durationMinutes: 60,
      dayIsEmpty: true,
    });

    const tomorrow = analyseSlots({
      slots: [tomorrowAt('09:00')],
      busy: [],
      durationMinutes: 60,
      dayIsEmpty: true,
    });

    const [first] = suggestSlots({ slots: [...spent, ...tomorrow], now, timeZone: ZONE });

    expect(first.slot.start).toBe(tomorrowAt('09:00').start);
  });

  it('the day is the business’s, not UTC', () => {
    /*
     * New York: 19:00 and 20:00 on one working day are 23:00 and 00:00 UTC, so
     * a UTC day key would split them and strand the 20:00 on "tomorrow".
     */
    const NY = 'America/New_York';
    const nyAt = (iso: string): Slot => ({
      start: iso,
      end: new Date(new Date(iso).getTime() + 3_600_000).toISOString(),
      available: true,
    });

    /*
     * Both of these are the EVENING of the 19th in New York — 20:00 and 21:00
     * — and both carry a UTC date of the 20th. Chosen so that the FIRST one
     * does too: a day key taken from `start.slice(0, 10)` would then read
     * "2026-10-20", match neither slot's real day, and suppress every
     * suggestion the owner should have been given.
     */
    const slots = analyseSlots({
      slots: [nyAt('2026-10-20T00:00:00.000Z'), nyAt('2026-10-20T01:00:00.000Z')],
      busy: [],
      durationMinutes: 60,
      dayIsEmpty: true,
    });

    const out = suggestSlots({
      slots,
      now: new Date('2026-10-19T22:00:00.000Z'),
      timeZone: NY,
    });

    expect(out.map(s => s.slot.start)).toContain('2026-10-20T00:00:00.000Z');
  });
});
