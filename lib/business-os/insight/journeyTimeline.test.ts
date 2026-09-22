import { buildJourney, type JourneyInput, type JourneyNodeKey } from './journeyTimeline';

const DAY = 24 * 60 * 60 * 1000;

/** Thresholds as VECTOR_THRESHOLDS defines them. */
const VECTORS = [
  { key: 'conv', dataPoints: 0, threshold: 25 },
  { key: 'price', dataPoints: 0, threshold: 42 },
  { key: 'ret', dataPoints: 0, threshold: 60 },
];

const at = (iso: string) => new Date(iso).getTime();

const node = (journey: ReturnType<typeof buildJourney>, key: JourneyNodeKey) =>
  journey.nodes.find(n => n.key === key)!;

/** The slow-start business from the mockup: 1 Aug account, day 34 today. */
function slowStart(overrides: Partial<JourneyInput> = {}) {
  return buildJourney({
    accountCreatedAt: '2026-08-01T09:00:00Z',
    firstVisitorAt: '2026-08-11T14:00:00Z',  // day 10
    firstEnquiryAt: '2026-08-20T10:00:00Z',  // day 19
    firstBookingAt: '2026-08-28T16:00:00Z',  // day 27
    firstClientAt: null,
    vectors: [
      { key: 'conv', dataPoints: 18, threshold: 25 },
      { key: 'price', dataPoints: 6, threshold: 42 },
      { key: 'ret', dataPoints: 0, threshold: 60 },
    ],
    now: at('2026-09-04T09:00:00Z'), // day 34
    /*
     * Stated, not inherited.
     *
     * Day numbers count which DATE an instant fell on, so they depend on a
     * zone. Leaving it to the machine running the suite made these assertions
     * pass in London and fail in Auckland, where 14:00Z is the next morning.
     * The literals below are UTC instants; UTC is the zone that reads them.
     */
    timezone: 'UTC',
    ...overrides,
  });
}

describe('buildJourney', () => {
  describe('milestones are dated by the event, not by the calendar', () => {
    it('reports the day the first visitor actually arrived, not day 4', () => {
      expect(node(slowStart(), 'visitor')).toMatchObject({ state: 'reached', day: 10 });
    });

    it('reports the day the first booking actually happened, not day 18', () => {
      expect(node(slowStart(), 'booking')).toMatchObject({ state: 'reached', day: 27 });
    });

    it('puts an event on the same day it happened, however many hours in', () => {
      // 09:00 account, 23:00 booking the same day: day 0, not day 1.
      const journey = buildJourney({
        accountCreatedAt: '2026-08-01T09:00:00Z',
        firstVisitorAt: null,
        firstEnquiryAt: null,
        firstBookingAt: '2026-08-01T23:00:00Z',
        firstClientAt: null,
        vectors: VECTORS,
        now: at('2026-08-02T09:00:00Z'),
      });
      expect(node(journey, 'booking').day).toBe(0);
    });
  });

  describe('an unlock with an anchor states a computable date', () => {
    it('dates pricing insights at first booking + the vector threshold', () => {
      const price = node(slowStart(), 'price');
      // 28 Aug + 42 days = 9 Oct, which is day 69 of an account opened 1 Aug.
      expect(price.state).toBe('counting');
      expect(price.day).toBe(69);
      expect(price.date?.slice(0, 10)).toBe('2026-10-09');
    });

    it('reads the threshold off the vector rather than hardcoding it', () => {
      const journey = slowStart({
        vectors: [
          { key: 'conv', dataPoints: 18, threshold: 25 },
          { key: 'price', dataPoints: 6, threshold: 30 },
          { key: 'ret', dataPoints: 0, threshold: 60 },
        ],
      });
      expect(node(journey, 'price').day).toBe(27 + 30);
    });

    it('turns the same node to reached once the date has passed', () => {
      const journey = slowStart({ now: at('2026-10-10T09:00:00Z') });
      expect(node(journey, 'price')).toMatchObject({ state: 'reached', day: 69 });
    });
  });

  describe('no anchor means no date and no promise', () => {
    it('leaves retention waiting with nothing stated while there is no client', () => {
      expect(node(slowStart(), 'ret')).toMatchObject({
        state: 'waiting',
        day: null,
        date: null,
      });
    });

    it('leaves an unreached milestone undated rather than overdue', () => {
      const journey = buildJourney({
        accountCreatedAt: '2026-08-31T09:00:00Z',
        firstVisitorAt: null,
        firstEnquiryAt: null,
        firstBookingAt: null,
        firstClientAt: null,
        vectors: VECTORS,
        now: at('2026-09-03T09:00:00Z'), // day 3
      });
      const waiting = journey.nodes.filter(n => n.state === 'waiting').map(n => n.key);
      expect(waiting).toEqual([
        'visitor', 'enquiry', 'booking', 'conv', 'price', 'ret', 'handover',
      ]);
      expect(journey.nodes.every(n => n.state === 'reached' || n.date === null)).toBe(true);
      expect(journey.lastReachedIndex).toBe(0); // only the account itself
      expect(journey.todayDay).toBe(3);
    });
  });

  describe('the counted unlock', () => {
    it('shows progress and no date while it is still counting', () => {
      expect(node(slowStart(), 'conv')).toMatchObject({
        state: 'counting',
        date: null,
        day: null,
        progress: { current: 18, threshold: 25 },
      });
    });

    it('carries the crossing date once the threshold is met', () => {
      const journey = slowStart({
        vectors: [
          { key: 'conv', dataPoints: 31, threshold: 25 },
          { key: 'price', dataPoints: 6, threshold: 42 },
          { key: 'ret', dataPoints: 0, threshold: 60 },
        ],
        convCrossedAt: '2026-08-22T12:00:00Z', // day 21
      });
      expect(node(journey, 'conv')).toMatchObject({ state: 'reached', day: 21 });
    });

    it('stays reached without a day when the crossing date could not be read', () => {
      const journey = slowStart({
        vectors: [
          { key: 'conv', dataPoints: 31, threshold: 25 },
          { key: 'price', dataPoints: 6, threshold: 42 },
          { key: 'ret', dataPoints: 0, threshold: 60 },
        ],
        convCrossedAt: null,
      });
      expect(node(journey, 'conv')).toMatchObject({ state: 'reached', day: null, date: null });
    });
  });

  describe('the mature business — where day 60 and day 90 were meant to be', () => {
    it('unlocks on the dates its own events produced, not on 60 and 90', () => {
      const journey = buildJourney({
        accountCreatedAt: '2026-05-08T09:00:00Z',
        firstVisitorAt: '2026-05-10T09:00:00Z',
        firstEnquiryAt: '2026-05-13T09:00:00Z',
        firstBookingAt: '2026-05-17T09:00:00Z', // day 9
        firstClientAt: '2026-06-11T09:00:00Z',      // day 34
        convCrossedAt: '2026-05-29T09:00:00Z',      // day 21
        firstAutomationAt: '2026-08-20T09:00:00Z',  // day 104 — handed over
        vectors: [
          { key: 'conv', dataPoints: 400, threshold: 25 },
          { key: 'price', dataPoints: 118, threshold: 42 },
          { key: 'ret', dataPoints: 93, threshold: 60 },
        ],
        now: at('2026-09-03T09:00:00Z'), // day 118
      });

      expect(journey.nodes.every(n => n.state === 'reached')).toBe(true);
      expect(node(journey, 'conv').day).toBe(21);
      expect(node(journey, 'price').day).toBe(9 + 42);   // 51
      expect(node(journey, 'ret').day).toBe(34 + 60);    // 94
      expect(node(journey, 'handover').day).toBe(104);
      expect(journey.lastReachedIndex).toBe(7);
      expect(journey.todayDay).toBe(118);
    });
  });

  /*
   * Six weeks and one booking is not six weeks of pricing data.
   *
   * `days_with_bookings` is elapsed time since the first booking and says
   * nothing about how many there have been, so the clock alone used to unlock
   * pricing on a sample of one. These pin the second condition.
   */
  describe('a time-based unlock also needs the volume behind it', () => {
    /** 100 days past the first booking — the 42-day clock is long since done. */
    const longEnough = (bookings: number) =>
      buildJourney({
        accountCreatedAt: '2026-06-01T09:00:00Z',
        firstVisitorAt: null,
        firstEnquiryAt: null,
        firstBookingAt: '2026-06-10T09:00:00Z',
        firstClientAt: null,
        vectors: [
          {
            key: 'price',
            dataPoints: 100,
            threshold: 42,
            also: { metric: 'total_bookings', current: bookings, threshold: 20 },
          },
        ],
        now: at('2026-09-18T09:00:00Z'),
      });

    it('states the count and NO date while the volume is short', () => {
      expect(node(longEnough(6), 'price')).toMatchObject({
        state: 'counting',
        date: null,
        day: null,
        progress: { current: 6, threshold: 20 },
      });
    });

    it('waits silently when the clock has run but nothing has happened', () => {
      expect(node(longEnough(0), 'price')).toMatchObject({
        state: 'waiting',
        date: null,
        progress: { current: 0, threshold: 20 },
      });
    });

    it('reaches once BOTH the days and the volume are there', () => {
      expect(node(longEnough(20), 'price')).toMatchObject({ state: 'reached' });
      expect(node(longEnough(20), 'price').date).not.toBeNull();
    });

    it('leaves a vector with no volume condition on the clock alone', () => {
      const journey = buildJourney({
        accountCreatedAt: '2026-06-01T09:00:00Z',
        firstVisitorAt: null,
        firstEnquiryAt: null,
        firstBookingAt: '2026-06-10T09:00:00Z',
        firstClientAt: null,
        vectors: [{ key: 'price', dataPoints: 100, threshold: 42 }],
        now: at('2026-09-18T09:00:00Z'),
      });
      expect(node(journey, 'price')).toMatchObject({ state: 'reached' });
    });
  });

  describe('a missing or unreadable day zero', () => {
    it('states no day numbers rather than treating today as day zero', () => {
      const journey = buildJourney({
        accountCreatedAt: null,
        firstVisitorAt: '2026-08-11T14:00:00Z',
        firstEnquiryAt: null,
        firstBookingAt: null,
        firstClientAt: null,
        vectors: VECTORS,
        now: at('2026-09-04T09:00:00Z'),
      });
      expect(journey.todayDay).toBeNull();
      // The event still happened; only the day number is unknown.
      expect(node(journey, 'visitor')).toMatchObject({ state: 'reached', day: null });
      expect(node(journey, 'visitor').date).not.toBeNull();
    });

    it('ignores an unparseable date rather than rendering NaN', () => {
      const journey = buildJourney({
        accountCreatedAt: '2026-08-01T09:00:00Z',
        firstVisitorAt: 'not a date',
        firstEnquiryAt: null,
        firstBookingAt: null,
        firstClientAt: null,
        vectors: VECTORS,
        now: at('2026-09-04T09:00:00Z'),
      });
      expect(node(journey, 'visitor')).toMatchObject({ state: 'waiting', day: null });
    });
  });

  describe('handover — what day 90 was reaching for', () => {
    it('is reached on the day the first standing automation was turned on', () => {
      const journey = slowStart({ firstAutomationAt: '2026-08-30T09:00:00Z' }); // day 29
      expect(node(journey, 'handover')).toMatchObject({ state: 'reached', day: 29 });
    });

    it('offers a count when jobs are eligible and nobody has taken them', () => {
      const journey = slowStart({ automatableNow: 3 });
      expect(node(journey, 'handover')).toMatchObject({
        state: 'counting',
        offered: 3,
        day: null,
        date: null,
      });
    });

    it('waits silently when there is nothing to hand over', () => {
      expect(node(slowStart(), 'handover')).toMatchObject({
        state: 'waiting',
        offered: null,
        date: null,
      });
    });

    it('stays reached once handed over, even if nothing is pending now', () => {
      // An automation later paused was still handed over on the day it began.
      const journey = slowStart({
        firstAutomationAt: '2026-08-30T09:00:00Z',
        automatableNow: 0,
      });
      expect(node(journey, 'handover').state).toBe('reached');
    });

    it('never states a date it cannot know', () => {
      // The old node promised "Day 90 · Automated". Nothing here predicts one.
      const journey = slowStart({ automatableNow: 5 });
      expect(node(journey, 'handover').date).toBeNull();
    });
  });

  /*
   * The rail drawn across the journey is a sequence. The journey is not.
   *
   * Handover sits at the end of the row and can be reached at any time — an
   * owner switching on invoice chasing in their first week reaches it long
   * before they have the client history for retention insights. Filling the
   * rail to the last REACHED node drew an unbroken orange line through a
   * retention node still rendered as a grey hollow circle, and moved the
   * "today" marker onto a node with no date.
   */
  describe('how far the rail is allowed to fill', () => {
    it('stops at the first thing that has not happened', () => {
      const journey = slowStart({ runningAutomations: 2 });

      // Reached in its own right: two automations really are running.
      expect(node(journey, 'handover').state).toBe('reached');
      expect(journey.lastReachedIndex).toBe(7);

      // But the rail stops at the booking, because conv/price/ret have not
      // been reached and a filled rail claims everything behind it.
      expect(journey.contiguousReachedIndex).toBe(3);
    });

    it('agrees with the last reached index when nothing is skipped', () => {
      const journey = buildJourney({
        accountCreatedAt: '2026-05-01T09:00:00Z',
        firstVisitorAt: '2026-05-02T09:00:00Z',
        firstEnquiryAt: '2026-05-03T09:00:00Z',
        firstBookingAt: '2026-05-10T09:00:00Z',
        firstClientAt: '2026-06-04T09:00:00Z',
        convCrossedAt: '2026-05-22T09:00:00Z',
        firstAutomationAt: '2026-08-13T09:00:00Z',
        vectors: [
          { key: 'conv', dataPoints: 400, threshold: 25 },
          { key: 'price', dataPoints: 118, threshold: 42 },
          { key: 'ret', dataPoints: 93, threshold: 60 },
        ],
        now: at('2026-09-03T09:00:00Z'),
      });

      expect(journey.contiguousReachedIndex).toBe(journey.lastReachedIndex);
    });

    it('fills nothing when even the account node is not reached', () => {
      // No day zero: the account milestone itself cannot be dated.
      const journey = slowStart({ accountCreatedAt: null, runningAutomations: 1 });

      expect(journey.contiguousReachedIndex).toBeLessThan(1);
    });
  });

  /*
   * A day number counts dates, not elapsed hours.
   *
   * The reported case: the anchor was a first page view at 21:08 and the today
   * marker read DAY 3 on the fifth calendar date of the journey. Every node
   * carries a calendar date, so a reader counting Sep 14, 15, 16, 17, 18 got
   * four and the card said three.
   *
   * Local times throughout, built from parts rather than from UTC strings, so
   * these assertions do not change with the machine running them — the day
   * boundary under test is the local one.
   */
  describe('day numbers count dates, not elapsed hours', () => {
    /** The reported account: anchored on a 21:08 page view. */
    const lateEvening = (overrides: Partial<JourneyInput> = {}) =>
      buildJourney({
        accountCreatedAt: '2026-09-14T21:08:00Z',
        firstVisitorAt: '2026-09-14T21:08:00Z',
        firstEnquiryAt: '2026-09-16T20:53:00Z',
        firstBookingAt: '2026-09-16T20:53:00Z',
        firstClientAt: null,
        vectors: VECTORS,
        now: at('2026-09-18T12:00:00Z'),
        timezone: 'UTC',
        ...overrides,
      });

    it('calls the fifth date day 4, not day 3', () => {
      // 14th to 18th is four dates. Elapsed time is 3 days and 15 hours, which
      // floored to 3 and was the number on the card.
      expect(lateEvening().todayDay).toBe(4);
    });

    it('still calls an event later the same evening day 0', () => {
      // What the old flooring was protecting, and it survives: same date, same
      // day number, however many hours after the anchor.
      const journey = lateEvening({ firstVisitorAt: '2026-09-14T23:59:00Z' });

      expect(node(journey, 'visitor').day).toBe(0);
    });

    it('calls the next morning day 1, where flooring called it day 0', () => {
      // Nine hours after a 21:08 anchor is the next date. This is the case the
      // elapsed rule got wrong in both directions.
      const journey = lateEvening({ firstVisitorAt: '2026-09-15T06:00:00Z' });

      expect(node(journey, 'visitor').day).toBe(1);
    });

    it('agrees with the dates the row prints beside it', () => {
      const journey = lateEvening();

      expect(node(journey, 'visitor').day).toBe(0);   // Sep 14
      expect(node(journey, 'enquiry').day).toBe(2);   // Sep 16
      expect(node(journey, 'booking').day).toBe(2);   // Sep 16
      expect(journey.todayDay).toBe(4);               // Sep 18
    });

    it('answers for the business, not for the machine reading it', () => {
      /*
       * The same instants, two zones, two different answers.
       *
       * 21:08 UTC on the 14th is already 00:08 on the 15th in Jerusalem, so
       * that business's journey starts a date later — while 12:00 UTC on the
       * 18th is still the 18th there. One date lost at the start and none
       * gained at the end: three, where the same instants are four in UTC.
       *
       * Both are right for their own business. Neither may depend on where the
       * dashboard happens to be open.
       */
      expect(lateEvening({ timezone: 'UTC' }).todayDay).toBe(4);
      expect(lateEvening({ timezone: 'Asia/Jerusalem' }).todayDay).toBe(3);
    });

    it('defaults to UTC rather than to whichever machine is rendering', () => {
      // A caller with no timezone must still get the same answer everywhere.
      const { timezone: _dropped, ...noZone } = {
        accountCreatedAt: '2026-09-14T21:08:00Z',
        firstVisitorAt: null,
        firstEnquiryAt: null,
        firstBookingAt: null,
        firstClientAt: null,
        vectors: VECTORS,
        now: at('2026-09-18T12:00:00Z'),
        timezone: 'UTC',
      };

      expect(buildJourney(noZone).todayDay).toBe(4);
    });
  });

  it('always returns the eight nodes in a stable order', () => {
    expect(slowStart().nodes.map(n => n.key)).toEqual([
      'account', 'visitor', 'enquiry', 'booking', 'conv', 'price', 'ret', 'handover',
    ]);
  });
});
