/**
 * A schedule the editor cannot say must not be offered for editing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DAMAGE THIS PREVENTS
 *
 * Editing a schedule from the agents list hands the owner a number and a unit.
 * That control can say "every three days". It cannot say "Mondays, Wednesdays
 * and Fridays at half past two" — and `/v2/agents/new` emits exactly that, from
 * a builder with a weekday picker, because somebody chose those days.
 *
 * Opening an interval control on such an expression and pressing save would
 * flatten a deliberate choice into "every N days", silently, on an agent that
 * writes to a business's clients. So the editor asks this function first and
 * draws no control when the answer is null.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THE ONE JUDGEMENT IN IT
 *
 * `0 9 * * 1` is Mondays at nine. Whether that may be read as "every 7 days"
 * depends on what the owner was TOLD, not on the bytes:
 *
 *   adopted from the catalogue   they were offered the word "weekly" and never
 *                                the word "Monday", so seven days keeps the
 *                                promise actually made to them.
 *
 *   built in the prompt flow     they picked Monday in a builder that showed
 *                                them the days. Same expression, and we may not
 *                                reinterpret it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { intervalFromCron } from '../interval';
import { CADENCE_INTERVAL } from '../ranges';
import { CADENCE_CRON } from '@/lib/business-os/automations/types';

/** The catalogue's own expressions, keyed for the lookup. */
const NAMED = Object.fromEntries(
  Object.entries(CADENCE_CRON).map(([name, cron]) => [
    cron,
    CADENCE_INTERVAL[name as keyof typeof CADENCE_INTERVAL],
  ])
);

describe('expressions that genuinely are intervals', () => {
  it.each([
    ['* * * * *', { every: 1, unit: 'minutes' }],
    ['*/5 * * * *', { every: 5, unit: 'minutes' }],
    ['*/15 * * * *', { every: 15, unit: 'minutes' }],
    ['*/30 * * * *', { every: 30, unit: 'minutes' }],
    ['0 * * * *', { every: 1, unit: 'hours' }],
    ['0 */4 * * *', { every: 4, unit: 'hours' }],
    ['0 */12 * * *', { every: 12, unit: 'hours' }],
    /* A step on the hour with a minute other than zero is still that interval:
       00:30, 04:30, 08:30 … is four-hourly. */
    ['30 */4 * * *', { every: 4, unit: 'hours' }],
    /* One fixed time of day. The only daily form cron states exactly. */
    ['0 9 * * *', { every: 1, unit: 'days' }],
    ['45 17 * * *', { every: 1, unit: 'days' }],
  ] as const)('%s', (cron, expected) => {
    expect(intervalFromCron(cron)).toEqual(expected);
  });
});

describe('expressions an interval cannot hold', () => {
  it.each([
    ['0 9 * * 1', 'Mondays — a weekday, not a gap'],
    ['0 9 * * 1,3,5', 'three named weekdays'],
    ['0 9 * * 1-5', 'weekdays only'],
    ['0 9 * * 0,6', 'weekends only'],
    ['0 9 1 * *', 'the 1st of the month'],
    ['0 9 1,15 * *', 'the 1st and the 15th'],
    ['0 9 */3 * *', 'a step on day-of-month, which is not every third day'],
    ['0 9 1 1 *', 'one date a year'],
    ['0 9,17 * * *', 'twice a day at two named times'],
    ['0-30 9 * * *', 'a range of minutes'],
  ])('refuses %s (%s)', (cron) => {
    expect(intervalFromCron(cron)).toBeNull();
  });

  it('refuses a step that does not divide its field', () => {
    /*
     * The gap would be uneven, so no single number describes it. A 25-minute
     * step fires at :00, :25, :50 and then :00 — ten minutes later, not
     * twenty-five. Showing "every 25 minutes" over that would be a lie the
     * owner could not check.
     */
    expect(intervalFromCron('*/25 * * * *')).toBeNull();
    expect(intervalFromCron('*/7 * * * *')).toBeNull();
    expect(intervalFromCron('0 */5 * * *')).toBeNull();
    expect(intervalFromCron('0 */7 * * *')).toBeNull();
  });

  it.each([
    [null, 'absent'],
    ['', 'empty'],
    ['0 9 * *', 'four fields'],
    ['0 9 * * * *', 'six fields'],
    ['every morning', 'words'],
  ])('refuses %p (%s)', (cron) => {
    expect(intervalFromCron(cron as string | null)).toBeNull();
  });
});

describe('the named cadences, for an agent that was offered words', () => {
  it.each(Object.entries(CADENCE_CRON))(
    '%s reads back as the interval the owner was promised',
    (name, cron) => {
      expect(intervalFromCron(cron, { allowNamedCadence: NAMED })).toEqual(
        CADENCE_INTERVAL[name as keyof typeof CADENCE_INTERVAL]
      );
    }
  );

  it('reads the same bytes as nothing without that permission', () => {
    /*
     * THE JUDGEMENT, as a test. `0 9 * * 1` is our `weekly` and also what the
     * prompt builder emits for "Mondays". The caller says which it is holding,
     * and an agent somebody built keeps its Monday.
     */
    expect(intervalFromCron(CADENCE_CRON.weekly, { allowNamedCadence: NAMED })).toEqual({
      every: 7,
      unit: 'days',
    });

    expect(intervalFromCron(CADENCE_CRON.weekly)).toBeNull();
    expect(intervalFromCron(CADENCE_CRON.fortnightly)).toBeNull();
    expect(intervalFromCron(CADENCE_CRON.monthly)).toBeNull();
  });

  it('matches a named cadence on the whole expression', () => {
    /* So a lookup cannot half-match something it does not mean: this shares
       four fields with `weekly` and is a different schedule. */
    expect(intervalFromCron('0 9 * * 2', { allowNamedCadence: NAMED })).toBeNull();
  });

  it('still reads a plain daily time without the lookup', () => {
    /* `daily` is in the named set AND is a form cron states exactly, so it must
       come back either way — an agent built in the prompt flow at 09:00 is
       editable here. */
    expect(intervalFromCron('0 9 * * *')).toEqual({ every: 1, unit: 'days' });
  });
});
