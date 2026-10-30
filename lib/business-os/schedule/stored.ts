/**
 * Reading an owner's schedule back off the agent row.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE READER, TWO FAMILIES, AND EVERYTHING INSTALLED BEFORE EITHER
 *
 * The interval lives under whichever family created the agent —
 * `agent_config.business_os_automation.schedule` or
 * `agent_config.inbox_channel.schedule` — because that is where each family
 * already keeps its own answers and a third top-level key would make three
 * places to look instead of two.
 *
 * The important case is the THIRD one: an agent installed before any of this
 * existed, which has no interval at all. Those are not migrated. They keep
 * running on `schedule_cron` exactly as they did, and the dialogs open on the
 * interval their named cadence meant. A migration would have to rewrite every
 * live owner's schedule to gain nothing: the cron for `weekly` is exact, and
 * the one case that is NOT exact — a step on day-of-month — is the one the
 * interval path exists to replace, so it is worth converting only when an owner
 * next touches it.
 *
 * So: an interval if there is one, and silence otherwise. Never a guess.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { parseInterval, type ScheduleInterval } from './interval';

/** The two places a family stores its owner's answers. */
const FAMILY_KEYS = ['business_os_automation', 'inbox_channel'] as const;

/**
 * The interval this agent runs on, or null if it still runs on its cron.
 *
 * Null is a real answer and not a failure: see the header. A caller that
 * treated it as "fall back to a default interval" would silently reschedule
 * every agent installed before this change.
 */
export function scheduleIntervalOf(
  agentConfig: Record<string, unknown> | null | undefined
): ScheduleInterval | null {
  if (!agentConfig) return null;

  for (const key of FAMILY_KEYS) {
    const family = agentConfig[key] as { schedule?: unknown } | undefined;
    if (!family || typeof family !== 'object') continue;

    const interval = parseInterval(family.schedule);
    if (interval) return interval;
  }

  return null;
}

/**
 * The stop rule as an INTERVAL, which is the only form that can hold hours.
 *
 * `stopAfterDays` cannot: twelve hours rounds to one day in it, and the mailbox
 * channel genuinely offers twelve — an unread message from before this morning
 * has been dealt with. So the exact answer lives in `stopAfter` and the day
 * count beside it is the lossy copy every older reader still uses.
 *
 * Falls back to that copy, so a channel installed before the question had a
 * number in it still opens its control on the right value.
 */
export function stopAfterOf(
  agentConfig: Record<string, unknown> | null | undefined
): ScheduleInterval | null {
  if (!agentConfig) return null;

  for (const key of FAMILY_KEYS) {
    const family = agentConfig[key] as { stopAfter?: unknown; stopAfterDays?: unknown } | undefined;
    if (!family || typeof family !== 'object') continue;

    const exact = parseInterval(family.stopAfter);
    if (exact) return exact;

    const days = family.stopAfterDays;
    if (typeof days === 'number' && Number.isInteger(days) && days > 0) {
      return { every: days, unit: 'days' };
    }
  }

  return null;
}

/**
 * The stop rule this agent was given, in days, or null for the default.
 *
 * Days because that is what both families already store and what the plans
 * read as `{{input.stop_after_days}}`. Kept beside the interval reader so the
 * two questions an owner answers are read by one module rather than two.
 */
export function stopAfterDaysOf(
  agentConfig: Record<string, unknown> | null | undefined
): number | null {
  if (!agentConfig) return null;

  for (const key of FAMILY_KEYS) {
    const family = agentConfig[key] as { stopAfterDays?: unknown } | undefined;
    if (!family || typeof family !== 'object') continue;

    const days = family.stopAfterDays;
    if (typeof days === 'number' && Number.isInteger(days) && days > 0) return days;
  }

  return null;
}
