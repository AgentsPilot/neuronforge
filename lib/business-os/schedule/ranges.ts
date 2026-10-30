/**
 * What an agent may be set to run on. The same answer for every agent.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE SCHEDULE VOCABULARY, NO EXCEPTIONS
 *
 * This module used to derive a different range per automation from its
 * `cadenceChoices` and `stopAfterChoices`, so the invoice chaser could be set
 * between one and fourteen days, the win-back agent between fourteen and
 * thirty, and the mailbox in minutes. Three agents on one screen offered three
 * different controls, and an owner reading that screen could only conclude that
 * two of them were missing something.
 *
 * It is one question — how often should this run, and when should it give up —
 * and the answer does not depend on which agent is being asked. Changing a
 * schedule is not changing what an agent DOES: the plan, the audience and every
 * safeguard inside it are untouched by moving a run from Tuesday to Wednesday.
 *
 * So the bounds here are the PLATFORM's, and they are the only two facts that
 * are actually true of every agent:
 *
 *   five minutes   the scheduler's own cron fires every five, so anything
 *                  faster is a promise that cannot be kept — the run would wait
 *                  for the next tick while the list claimed otherwise.
 *
 *   ninety days    past this an agent is not on a schedule, it is switched off,
 *                  and there is a control for that.
 *
 * The stop rule starts at twelve hours rather than five minutes because "give
 * up on this person after thirty minutes" is not a bound anybody means, and
 * runs to two years because a win-back agent legitimately waits that long.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE CATALOGUE'S OWN LISTS STILL DO
 *
 * `cadenceChoices` and `defaultStopAfterDays` have not gone anywhere. They are
 * what an agent OPENS on — our recommendation, the number we would have chosen
 * — and the install dialog still shows it first. What they no longer do is
 * forbid: an owner who wants their chaser twice a day may have it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { CADENCE_CRON, type AutomationCadence } from '@/lib/business-os/automations/types';
import {
  type IntervalRange,
  type ScheduleInterval,
  intervalMinutes,
} from './interval';

/**
 * The interval each named cadence meant.
 *
 * Written out rather than parsed back from `CADENCE_CRON`, because two of those
 * expressions do not state an interval at all: `0 9 * * 1` is "Mondays" and
 * `0 9 1,15 * *` is "the 1st and the 15th". The interval an owner understood
 * them AS is seven and fourteen days, and that is what a number-and-unit
 * control has to show when it opens on an agent installed under the old
 * vocabulary.
 *
 * `monthly` is thirty days for the same reason. An owner who chose it meant
 * "about once a month", and an agent writing to clients quiet for a year does
 * not care whether that lands on the 1st.
 */
export const CADENCE_INTERVAL: Record<AutomationCadence, ScheduleInterval> = {
  daily: { every: 1, unit: 'days' },
  every_3_days: { every: 3, unit: 'days' },
  weekly: { every: 7, unit: 'days' },
  fortnightly: { every: 14, unit: 'days' },
  monthly: { every: 30, unit: 'days' },
};

/** Just the fields a range needs, so this module does not import the catalogue. */
export interface RangeableAgent {
  cadenceChoices: AutomationCadence[];
  stopAfterChoices: number[];
  defaultCron: string;
  defaultStopAfterDays: number;
}

/**
 * How often any agent may run: five minutes to ninety days.
 *
 * Offers all three units, because at a five-minute floor every one of them is a
 * number somebody would say out loud.
 */
export const SCHEDULE_RANGE: IntervalRange = {
  min: { every: 5, unit: 'minutes' },
  max: { every: 90, unit: 'days' },
};

/**
 * How long any agent keeps trying: twelve hours to two years.
 *
 * Hours and days, not minutes: a bound measured in minutes is not a bound
 * anybody means by "give up on this person after".
 */
export const STOP_RANGE: IntervalRange = {
  min: { every: 12, unit: 'hours' },
  max: { every: 730, unit: 'days' },
};

/**
 * How often this agent may be set to run.
 *
 * Takes the agent and ignores it, deliberately: the signature stays so every
 * call site reads the same, and the day somebody wants a per-agent rule back
 * there is one place to put it rather than six call sites to find.
 */
export function cadenceRangeOf(_agent?: RangeableAgent): IntervalRange {
  return SCHEDULE_RANGE;
}

/** How long this agent may keep trying. The same for every agent. */
export function stopAfterRangeOf(_agent?: RangeableAgent): IntervalRange {
  return STOP_RANGE;
}
