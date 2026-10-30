/**
 * Hours and days, in one control, for every agent an owner creates.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * Two vocabularies that did not overlap: the mailbox wizard offered five,
 * fifteen or thirty minutes and hourly; an adopted agent offered daily through
 * monthly. Nothing on the platform could say "every four hours", neither
 * control could express the other's range, and "when to stop" was days-only in
 * both.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THEN ONE VOCABULARY FOR EVERY AGENT, NOT ONE PER AGENT
 *
 * The first fix replaced each list with a RANGE derived from it, which kept a
 * different range per automation — so the chaser offered one to fourteen days,
 * the win-back agent fourteen to thirty, and the mailbox minutes. Three agents
 * on one screen, three different controls, and the only conclusion an owner can
 * draw from that is that two of them are missing something.
 *
 * So the bounds are the PLATFORM's now, identical everywhere: five minutes
 * because the scheduler's cron fires every five, ninety days because past that
 * an agent is switched off rather than scheduled.
 *
 * What this suite holds:
 *
 * 1. Every agent is offered the same units and the same limits.
 * 2. The one remaining wall is a fact, not a policy — nothing may be set to run
 *    faster than the platform can run it.
 * 3. A picker always has at least one unit to show.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  parseInterval,
  formatInterval,
  intervalMinutes,
  inUnit,
  clampInterval,
  withinRange,
  unitsForRange,
  boundsForUnit,
  intervalToCron,
  nextTickAfter,
  type IntervalRange,
} from '../interval';
import {
  cadenceRangeOf,
  stopAfterRangeOf,
  CADENCE_INTERVAL,
  SCHEDULE_RANGE,
  STOP_RANGE,
} from '../ranges';
import { AUTOMATION_AGENTS } from '@/lib/business-os/automations/catalog';
import { CADENCE_CRON } from '@/lib/business-os/automations/types';

describe('the stored form survives a round trip', () => {
  it.each([
    ['5m', { every: 5, unit: 'minutes' }],
    ['2h', { every: 2, unit: 'hours' }],
    ['30d', { every: 30, unit: 'days' }],
  ] as const)('%s', (text, interval) => {
    expect(parseInterval(text)).toEqual(interval);
    expect(formatInterval(interval)).toBe(text);
  });

  it('reads the object form too, which is what a dialog posts', () => {
    expect(parseInterval({ every: 4, unit: 'hours' })).toEqual({ every: 4, unit: 'hours' });
  });

  it.each([
    ['', 'empty'],
    ['0d', 'zero is not a cadence'],
    ['-3d', 'nor is a negative one'],
    ['1.5d', 'nor half a day'],
    ['3w', 'weeks are counted in days'],
    ['later', 'words'],
    [null, 'absent'],
    [{ every: 3 }, 'an object with no unit'],
    [{ every: 0, unit: 'days' }, 'an object that is zero'],
  ])('refuses %p (%s)', (value, _why) => {
    expect(parseInterval(value)).toBeNull();
  });
});

describe('changing the unit keeps the meaning', () => {
  it('one day offers twenty four hours, not one', () => {
    expect(inUnit({ every: 1, unit: 'days' }, 'hours')).toEqual({ every: 24, unit: 'hours' });
  });

  it('never offers zero on the way back up', () => {
    /* Truncating would turn "every 30 minutes" into "every 0 days", and a zero
       cadence is either an error or an agent running continuously. */
    expect(inUnit({ every: 30, unit: 'minutes' }, 'days')).toEqual({ every: 1, unit: 'days' });
  });

  it('rounds to the nearest rather than down', () => {
    expect(inUnit({ every: 90, unit: 'minutes' }, 'hours')).toEqual({ every: 2, unit: 'hours' });
  });
});

describe('a range is a wall, not a suggestion', () => {
  const fortnightly: IntervalRange = {
    min: { every: 14, unit: 'days' },
    max: { every: 30, unit: 'days' },
  };

  it('replaces a value below the floor with the floor', () => {
    expect(clampInterval({ every: 2, unit: 'minutes' }, fortnightly)).toEqual(fortnightly.min);
  });

  it('replaces a value above the ceiling with the ceiling', () => {
    expect(clampInterval({ every: 2, unit: 'days' }, fortnightly)).toEqual(fortnightly.min);
    expect(clampInterval({ every: 400, unit: 'days' }, fortnightly)).toEqual(fortnightly.max);
  });

  it('leaves a value between the ends exactly as chosen', () => {
    /* THE POINT OF THE CHANGE. Ten days was not on the old list of chips and is
       inside the same walls. */
    expect(clampInterval({ every: 20, unit: 'days' }, fortnightly)).toEqual({
      every: 20,
      unit: 'days',
    });
    expect(withinRange({ every: 20, unit: 'days' }, fortnightly)).toBe(true);
  });

  it('offers every unit whose count is a number somebody would say', () => {
    /*
     * A fortnight genuinely IS 20,160 minutes, so some cap is needed or every
     * agent would offer minutes. Hours at 336 is a number somebody says; this
     * range earns hours and days and not minutes.
     */
    expect(unitsForRange(fortnightly)).toEqual(['hours', 'days']);
  });

  it('never drops the coarsest unit, however large its count', () => {
    /*
     * THE HOLE THE CAP OPENED. For every unit but the coarsest there is a
     * better way to say a big number — 20,160 minutes is a fortnight. For days
     * there is not, so a range floored at 500 days had its only unit removed
     * and the control rendered with no unit at all: a number standing alone
     * with nothing saying what it counted.
     */
    const wide: IntervalRange = {
      min: { every: 500, unit: 'days' },
      max: { every: 700, unit: 'days' },
    };

    expect(unitsForRange(wide)).toEqual(['days']);
  });

  it('always returns at least one unit', () => {
    /* A picker with nothing to show is not a narrower control, it is a broken
       one. Asserted across every range this codebase actually uses. */
    for (const range of [
      fortnightly,
      SCHEDULE_RANGE,
      STOP_RANGE,
      { min: { every: 500, unit: 'days' as const }, max: { every: 700, unit: 'days' as const } },
      { min: { every: 90, unit: 'minutes' as const }, max: { every: 300, unit: 'minutes' as const } },
    ]) {
      expect(unitsForRange(range).length).toBeGreaterThan(0);
    }
  });

  it('gives a number input bounds that are inside the range', () => {
    const { min, max } = boundsForUnit(fortnightly, 'days');
    expect(min).toBe(14);
    expect(max).toBe(30);

    /* Rounded INWARD, both ends: a spinner that let somebody reach 4 hours on a
       5-minute-to-7-day range would be offering a value outside it. */
    const hours = boundsForUnit(
      { min: { every: 90, unit: 'minutes' }, max: { every: 300, unit: 'minutes' } },
      'hours'
    );
    expect(hours.min).toBe(2);
    expect(hours.max).toBe(5);
  });
});

describe('what becomes a cron and what does not', () => {
  it('compiles minutes and hours, which step a field they divide', () => {
    expect(intervalToCron({ every: 15, unit: 'minutes' })).toBe('*/15 * * * *');
    expect(intervalToCron({ every: 1, unit: 'hours' })).toBe('0 * * * *');
    expect(intervalToCron({ every: 4, unit: 'hours' })).toBe('0 */4 * * *');
  });

  it('refuses days, because a day-of-month step is not an interval', () => {
    /*
     * THE LIVE DEFECT THIS REPLACES. `every_3_days` was a step on day-of-month,
     * which means days 1, 4, 7 … 28, 31 and then 1 — a one-day gap across the
     * end of every month, and worse in February. Returning null is what sends
     * days down the interval path instead.
     */
    expect(intervalToCron({ every: 3, unit: 'days' })).toBeNull();
    expect(intervalToCron({ every: 1, unit: 'days' })).toBeNull();
  });

  it('refuses a step larger than the field it would step', () => {
    /* A 90-minute step on a 60-minute field is the same bug one field over.
       (Spelled out in words: a literal step expression closes this comment.) */
    expect(intervalToCron({ every: 90, unit: 'minutes' })).toBeNull();
    expect(intervalToCron({ every: 36, unit: 'hours' })).toBeNull();
  });
});

describe('the next tick is counted from the tick', () => {
  const nine = (day: number) => new Date(Date.UTC(2026, 9, day, 9, 0, 0));

  it('keeps the time of day when a pass runs late', () => {
    /*
     * An agent due at 09:00 whose pass ran at 09:12 must next be due at 09:00.
     * Counting from the clock instead would walk the send time forward twelve
     * minutes every run until it was writing to clients at midnight.
     */
    const next = nextTickAfter(nine(1), { every: 3, unit: 'days' }, new Date(Date.UTC(2026, 9, 1, 9, 12)));

    expect(next.toISOString()).toBe(nine(4).toISOString());
  });

  it('is exactly N days later, across the end of a month', () => {
    /* What the cron step got wrong. 29 October plus three days is 1 November. */
    const next = nextTickAfter(nine(29), { every: 3, unit: 'days' }, nine(29));

    expect(next.toISOString()).toBe(new Date(Date.UTC(2026, 10, 1, 9, 0, 0)).toISOString());
  });

  it('clears the present in one step, however far behind it is', () => {
    /*
     * A dormant agent must not come back due, run, and be due again — a month
     * of back-dated messages to one client, one per pass. The returned tick is
     * in the future and still on the owner's time of day.
     */
    const dormant = nine(1);
    const now = new Date(Date.UTC(2026, 11, 20, 14, 30));

    const next = nextTickAfter(dormant, { every: 3, unit: 'days' }, now);

    expect(next.getTime()).toBeGreaterThan(now.getTime());
    expect(next.getUTCHours()).toBe(9);
    expect(next.getUTCMinutes()).toBe(0);
    /* And only one step past, not a long jump: the gap is under one interval. */
    expect(next.getTime() - now.getTime()).toBeLessThanOrEqual(3 * 86_400_000);
  });

  it('handles a tick that is still in the future', () => {
    const next = nextTickAfter(nine(10), { every: 7, unit: 'days' }, nine(1));
    expect(next.toISOString()).toBe(nine(17).toISOString());
  });
});

describe('every agent is offered the same schedule', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE RULE CHANGED HERE, DELIBERATELY, AND THIS SUITE RECORDS WHY.
   *
   * These ranges were derived per automation from its `cadenceChoices`, so the
   * invoice chaser could be set between one and fourteen days, the win-back
   * agent between fourteen and thirty, and the mailbox in minutes. On one
   * screen that is three agents offering three different controls, and the only
   * conclusion an owner can draw is that two of them are missing something.
   *
   * Changing a schedule is not changing what an agent DOES. The plan, the
   * audience, the send guards and the stop rule inside the plan are all
   * untouched by moving a run from Tuesday to Wednesday — so the bounds are the
   * platform's, not the catalogue's.
   *
   * The catalogue's lists did not go anywhere: they are what the control OPENS
   * on, which is the recommendation. What they no longer do is forbid.
   * ───────────────────────────────────────────────────────────────────────────
   */

  it.each(AUTOMATION_AGENTS.map(a => [a.id, a] as const))(
    '%s gets the platform range, not its own',
    (_id, agent) => {
      expect(cadenceRangeOf(agent)).toEqual(SCHEDULE_RANGE);
      expect(stopAfterRangeOf(agent)).toEqual(STOP_RANGE);
    }
  );

  it('offers the same units on every agent', () => {
    const cadenceUnits = AUTOMATION_AGENTS.map(a => unitsForRange(cadenceRangeOf(a)));
    const stopUnits = AUTOMATION_AGENTS.map(a => unitsForRange(stopAfterRangeOf(a)));

    /* Identical lists, agent to agent — which is the whole point of the
       change: no row on the agents list may look like it is missing a
       control another row has. */
    for (const units of cadenceUnits) expect(units).toEqual(cadenceUnits[0]);
    for (const units of stopUnits) expect(units).toEqual(stopUnits[0]);

    expect(cadenceUnits[0]).toEqual(['minutes', 'hours', 'days']);
    expect(stopUnits[0]).toEqual(['hours', 'days']);
  });

  it('still admits every cadence the catalogue ever listed', () => {
    /* Widening must not have dropped an answer an owner already has stored. */
    for (const agent of AUTOMATION_AGENTS) {
      for (const choice of agent.cadenceChoices) {
        expect(withinRange(CADENCE_INTERVAL[choice], SCHEDULE_RANGE)).toBe(true);
      }
      for (const days of agent.stopAfterChoices) {
        expect(withinRange({ every: days, unit: 'days' }, STOP_RANGE)).toBe(true);
      }
      expect(
        withinRange({ every: agent.defaultStopAfterDays, unit: 'days' }, STOP_RANGE)
      ).toBe(true);
    }
  });

  it('refuses a cadence faster than the platform can run', () => {
    /*
     * The one bound that is still a wall, and it is a fact rather than a
     * policy: the scheduler's own cron fires every five minutes, so anything
     * faster is a promise the platform cannot keep.
     */
    expect(clampInterval({ every: 1, unit: 'minutes' }, SCHEDULE_RANGE)).toEqual(
      SCHEDULE_RANGE.min
    );
    expect(withinRange({ every: 30, unit: 'seconds' as never }, SCHEDULE_RANGE)).toBe(false);
  });

  it('knows an interval for every named cadence that exists', () => {
    /* A cadence added to the union without an interval here would open the
       control on the wrong value and clamp the owner's real setting away. */
    for (const name of Object.keys(CADENCE_CRON)) {
      expect(CADENCE_INTERVAL[name as keyof typeof CADENCE_INTERVAL]).toBeDefined();
    }
  });
});
