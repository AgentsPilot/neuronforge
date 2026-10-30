/**
 * How often, and for how long: one vocabulary for every agent an owner creates.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * The platform had two scheduling vocabularies and they did not overlap.
 *
 *   the mailbox wizard   five, fifteen or thirty minutes, or hourly
 *   an adopted agent     daily, every three days, weekly, fortnightly, monthly
 *
 * So nothing on the platform could say "every four hours": the mailbox stopped
 * at the hour and the adopted agents started at the day. Neither control could
 * express the other's range, and "when to stop" was days-only in both.
 *
 * A number and a unit covers the whole span in one control, which is also the
 * only shape that scales: offering minutes through months as a list of chips is
 * about ten rungs per question, and it still cannot say "every four hours"
 * until somebody adds that rung too.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY DAYS ARE NOT A CRON EXPRESSION
 *
 * `every_3_days` was `0 9 * / 3 * *` (spaced to keep this comment open), and a
 * step on the DAY-OF-MONTH field does not mean "every third day". It means days
 * 1, 4, 7 … 28, 31, and then back to 1 — so the gap across the end of a month
 * is one day, not three. February makes it worse.
 *
 * Minutes and hours have no such problem: a step on those fields divides a
 * period that is actually a multiple of the step. So this module compiles
 * minutes and hours to cron, and carries days as an interval the runner adds to
 * the tick — which is exact, and preserves the time of day because the tick is
 * already at it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE UNITS ON OFFER COME FROM THE RANGE, AND THAT IS A SAFETY RULE
 *
 * `win_back_quiet_clients` offers fortnightly and monthly and nothing faster,
 * because it writes to people who have not been in touch for months. A free
 * number box would let an owner mail a dormant client hourly. So every caller
 * passes a range, the picker only offers units that range can reach, and a
 * value outside it is clamped rather than honoured.
 *
 * It also keeps one invariant the plans depend on: an adopted agent's stop rule
 * reaches BizQL as `{{input.stop_after_days}}`, a whole number of days in a
 * `$date` offset. Their ranges start at days, so hours can never be chosen
 * there and no fractional day can ever be produced. The mailbox, whose window
 * is an ISO instant rather than a filter offset, is the only surface that
 * offers hours.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The three grains an owner thinks in. Weeks and months are counts of days. */
export type IntervalUnit = 'minutes' | 'hours' | 'days';

export interface ScheduleInterval {
  every: number;
  unit: IntervalUnit;
}

/** Inclusive bounds, as intervals. Both ends are real choices. */
export interface IntervalRange {
  min: ScheduleInterval;
  max: ScheduleInterval;
}

const MINUTES_PER: Record<IntervalUnit, number> = {
  minutes: 1,
  hours: 60,
  days: 1440,
};

/** Coarsest first, so a range's own unit reads naturally. */
export const INTERVAL_UNITS: readonly IntervalUnit[] = ['minutes', 'hours', 'days'];

/** One interval in minutes, which is how two of them are compared. */
export function intervalMinutes(interval: ScheduleInterval): number {
  return interval.every * MINUTES_PER[interval.unit];
}

/**
 * `"15m"`, `"2h"`, `"3d"` — the stored and declared form.
 *
 * Compact on purpose: it goes in `agent_config` and in range declarations, and
 * a two-field object in both places reads as ceremony. One letter per unit, and
 * the parser is the only thing that needs to know it.
 */
export function formatInterval(interval: ScheduleInterval): string {
  return `${interval.every}${interval.unit[0]}`;
}

export function parseInterval(value: unknown): ScheduleInterval | null {
  if (value && typeof value === 'object') {
    const candidate = value as { every?: unknown; unit?: unknown };
    if (
      typeof candidate.every === 'number' &&
      Number.isInteger(candidate.every) &&
      candidate.every > 0 &&
      typeof candidate.unit === 'string' &&
      (INTERVAL_UNITS as readonly string[]).includes(candidate.unit)
    ) {
      return { every: candidate.every, unit: candidate.unit as IntervalUnit };
    }
    return null;
  }

  if (typeof value !== 'string') return null;

  const match = value.trim().match(/^(\d+)\s*([mhd])$/i);
  if (!match) return null;

  const every = Number(match[1]);
  if (!Number.isInteger(every) || every <= 0) return null;

  const unit = ({ m: 'minutes', h: 'hours', d: 'days' } as const)[
    match[2].toLowerCase() as 'm' | 'h' | 'd'
  ];

  return { every, unit };
}

/**
 * The same interval expressed in `unit`, rounded to a whole number.
 *
 * Rounds rather than truncating, and never below one: switching the unit from
 * days to hours on "every 1 day" must offer 24 hours, and switching back must
 * not offer zero days.
 */
export function inUnit(interval: ScheduleInterval, unit: IntervalUnit): ScheduleInterval {
  const every = Math.max(1, Math.round(intervalMinutes(interval) / MINUTES_PER[unit]));
  return { every, unit };
}

/**
 * The interval moved inside the range, keeping its own unit where it can.
 *
 * A value outside the range is replaced by the bound it crossed, expressed in
 * whichever unit the caller was using — so an owner who typed 2 minutes into a
 * fortnightly agent is shown 14 days, not 20160 minutes.
 */
export function clampInterval(
  interval: ScheduleInterval,
  range: IntervalRange
): ScheduleInterval {
  const minutes = intervalMinutes(interval);

  if (minutes < intervalMinutes(range.min)) return range.min;
  if (minutes > intervalMinutes(range.max)) return range.max;

  return interval;
}

/** Whether this interval is one the range admits. */
export function withinRange(interval: ScheduleInterval, range: IntervalRange): boolean {
  const minutes = intervalMinutes(interval);
  return minutes >= intervalMinutes(range.min) && minutes <= intervalMinutes(range.max);
}

/**
 * How many of a unit stops being a number anybody reads.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A READABILITY BOUND, NOT A SAFETY ONE. THE CLAMP IS THE SAFETY.
 *
 * A fortnightly floor IS 20,160 minutes, which is true and useless — so some
 * cap is needed or every agent would offer minutes. But the first version of
 * this rule was much stricter: it dropped a unit unless the floor was FINER
 * than the next grain up, which meant any agent whose floor was a whole day
 * offered days and nothing else.
 *
 * That turned a presentation rule into an apparent capability difference. On
 * one screen the mailbox showed three units to choose between and the invoice
 * chaser showed the bare word "ימים", and the honest reading of that is "this
 * agent is missing its control".
 *
 * Four hundred — about a fortnight counted in hours — is high enough that every
 * agent in the catalogue can be set in hours as well as days, and low enough
 * that none of them offers minutes. Nothing about the WALLS moves: a chaser
 * whose floor is one day offers hours from 24, so the floor is expressed in the
 * new unit rather than escaped through it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const READABLE_COUNT = 400;

/**
 * The units a picker should offer for this range.
 *
 * Two tests a unit has to pass:
 *
 *   IT FITS. A whole number of it lands between the ends. Without this a picker
 *   offers days on a range of 90 to 300 minutes and every value is clamped.
 *
 *   IT IS READABLE. The floor expressed in it is a count somebody would say out
 *   loud. Without this a fortnightly agent offers minutes, because a fortnight
 *   genuinely is 20,160 of them.
 *
 * What it does NOT do is enforce policy. A unit being offered never widens what
 * can be set: `clampInterval` holds the range whichever unit it is expressed
 * in, so "hours" on a daily-floored agent starts at 24.
 */
export function unitsForRange(range: IntervalRange): IntervalUnit[] {
  const min = intervalMinutes(range.min);
  const max = intervalMinutes(range.max);

  /* Every unit a whole value of which lands between the ends. */
  const fits = INTERVAL_UNITS.filter(unit => {
    const step = MINUTES_PER[unit];
    return Math.max(1, Math.ceil(min / step)) <= Math.floor(max / step);
  });

  const readable = fits.filter(
    unit => Math.max(1, Math.ceil(min / MINUTES_PER[unit])) <= READABLE_COUNT
  );

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE COARSEST FITTING UNIT IS NEVER DROPPED.
   *
   * The cap asks "would anybody say this number out loud", and for every unit
   * BUT the coarsest there is a better way to say it — 20,160 minutes is a
   * fortnight. For the coarsest there is not: days is the largest grain this
   * vocabulary has, so a range floored at 500 days has no coarser unit to be
   * expressed in and the cap simply removed it.
   *
   * The result was a control with no unit at all. Caught by a test using a
   * deliberately wide day range, which rendered an empty track — the number
   * stood alone with nothing saying what it counted.
   * ───────────────────────────────────────────────────────────────────────────
   */
  if (readable.length > 0) return readable;

  return fits.length > 0 ? [fits[fits.length - 1]] : [range.min.unit];
}

/** The whole-number bounds for one unit inside a range, for a number input. */
export function boundsForUnit(
  range: IntervalRange,
  unit: IntervalUnit
): { min: number; max: number } {
  const step = MINUTES_PER[unit];

  return {
    min: Math.max(1, Math.ceil(intervalMinutes(range.min) / step)),
    max: Math.max(1, Math.floor(intervalMinutes(range.max) / step)),
  };
}

/**
 * The cron expression this interval means, or null when it has none.
 *
 * Null for days, and that is the point rather than a gap: see the header. The
 * caller stores the interval and the runner adds it.
 *
 * Minutes above 59 and hours above 23 also return null — a step larger than the
 * field it steps is the same month-end bug in a different field, so those are
 * carried as intervals too. `inUnit` would normally have turned them into the
 * coarser unit already.
 */
export function intervalToCron(interval: ScheduleInterval): string | null {
  const { every, unit } = interval;

  if (unit === 'minutes') {
    if (every >= 60) return null;
    return every === 1 ? '* * * * *' : `*/${every} * * * *`;
  }

  if (unit === 'hours') {
    if (every >= 24) return null;
    return every === 1 ? '0 * * * *' : `0 */${every} * * *`;
  }

  return null;
}

/**
 * The interval this cron expression means, or null when it means more than one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE QUESTION BEHIND THIS IS "MAY WE OFFER TO EDIT THIS?"
 *
 * An owner editing a schedule from the agents list is handed a number and a
 * unit. That control can say "every three days" and cannot say "Mondays,
 * Wednesdays and Fridays at half past two" — which is exactly what the prompt
 * flow's own builder emits, and what it stored because somebody chose it.
 *
 * Opening an interval control on such an expression and saving would flatten a
 * deliberate choice into "every N days" with nothing said. So the editor asks
 * this first and offers no control at all when the answer is null, pointing at
 * the full builder instead. A control that can only lose information should not
 * be drawn.
 *
 * Reads only the forms that genuinely ARE intervals:
 *
 *     every minute / N minutes      a step on a field it divides
 *     every hour / N hours          likewise
 *     one fixed time of day         "every day at 09:00", which is one day
 *
 * Everything else — a weekday list, a day-of-month list, a range, a step on a
 * field it does not divide — returns null, because an interval cannot hold it.
 *
 * `allowNamedCadence` is the one place this is a judgement rather than
 * arithmetic, and it turns on WHAT THE OWNER WAS TOLD. An agent adopted from
 * the catalogue was offered the word "weekly" and never the word "Monday", so
 * reading `0 9 * * 1` back as seven days keeps the promise they were actually
 * made. An agent they built themselves picked that expression in a builder that
 * shows the days, so the same bytes mean something we must not reinterpret.
 * Same expression, two meanings, decided by which door it came through.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function intervalFromCron(
  cron: string | null | undefined,
  options: { allowNamedCadence?: Record<string, ScheduleInterval> } = {}
): ScheduleInterval | null {
  if (!cron) return null;

  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return null;

  const [minute, hour, dom, month, dow] = fields;

  /* A named cadence is matched on the WHOLE expression, before it is taken
     apart, so a lookup can never half-match something it does not mean. */
  const named = options.allowNamedCadence?.[cron.trim()];
  if (named) return named;

  /* Anything that narrows the month, the day of the month or the weekday is not
     an interval. Checked before the numbers, because `0 9 * * 1` differs from
     `0 9 * * *` in this field alone. */
  if (month !== '*' || dom !== '*' || dow !== '*') return null;

  if (hour === '*') {
    /* Every minute of every hour. */
    if (minute === '*') return { every: 1, unit: 'minutes' };

    const step = minute.match(/^\*\/(\d+)$/);
    if (step) {
      const every = Number(step[1]);
      /* A step must divide its field or the last gap of every hour is short: a
         25-minute step fires at :00, :25, :50 and then :00, ten minutes later.
         No single number describes that, so it is not an interval. */
      if (!Number.isInteger(every) || every < 1 || every > 59 || 60 % every !== 0) return null;

      return { every, unit: 'minutes' };
    }

    /*
     * ONE FIXED MINUTE OF EVERY HOUR, WHICH IS HOURLY.
     *
     * `0 * * * *` is the mailbox channel's own `hourly`, and the first version
     * of this function returned null for it: the minute was neither a star nor
     * a step, so it fell out of this branch, and the hourly check further down
     * could never be reached because this branch had already claimed `hour`.
     * An hourly agent would have been told its schedule was uneditable.
     */
    if (/^\d+$/.test(minute)) return { every: 1, unit: 'hours' };

    return null;
  }

  /* From here the hour is named or stepped, so the minute must be a single
     number — a star or a range there is more than one firing per hour. */
  if (!/^\d+$/.test(minute)) return null;

  const hourStep = hour.match(/^\*\/(\d+)$/);
  if (hourStep) {
    const every = Number(hourStep[1]);
    if (!Number.isInteger(every) || every < 1 || every > 23 || 24 % every !== 0) return null;
    /* The minute need not be zero: 00:30, 04:30, 08:30 … is still four-hourly. */
    return { every, unit: 'hours' };
  }

  /* One fixed time, every day. The only daily form cron states exactly. */
  if (/^\d+$/.test(hour)) return { every: 1, unit: 'days' };

  return null;
}

/**
 * What to write on the agent row for this interval.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AN INTERVAL IS STORED ONLY WHEN CRON CANNOT SAY IT
 *
 * Minutes and hours compile to an exact expression, so those agents carry a
 * cron and no interval: one clock, and the per-owner offset correctly leaves
 * them alone. Days cannot be compiled, so those carry BOTH — the interval,
 * which is authoritative, and a cron that states the time of day and nothing
 * else.
 *
 * The carrier is not redundancy for its own sake. The scheduler selects due
 * agents with `schedule_cron IS NOT NULL`, so an agent with no expression at
 * all would never be selected: active, correct, and permanently invisible. It
 * also keeps `agent_executions.cron_expression` meaning something, and gives
 * every reader that only understands cron a true statement about when the agent
 * fires, rather than a null it has to explain.
 *
 * What the carrier must NOT be is a second opinion about the CADENCE. It says
 * `0 9 * * *` whatever the interval is, so anything describing the schedule to
 * an owner has to read the interval first. `scheduleInWords` does.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function storageFor(
  interval: ScheduleInterval,
  timeOfDay: { hour: number; minute: number } = { hour: 9, minute: 0 }
): { cron: string; interval: ScheduleInterval | null } {
  const exact = intervalToCron(interval);

  if (exact) return { cron: exact, interval: null };

  return {
    cron: `${timeOfDay.minute} ${timeOfDay.hour} * * *`,
    interval,
  };
}

/**
 * The next time after `tick` that an interval-scheduled agent is due.
 *
 * Counted from the TICK and not from the clock, so a pass that runs late does
 * not move the send time: an agent due at 09:00 whose pass ran at 09:12 is next
 * due at 09:00, not 09:12. The tick is already at the owner's time of day, so
 * adding whole days preserves it.
 *
 * Advances past `now` rather than returning one step, because an agent dormant
 * for a month would otherwise be due immediately and then again, and again,
 * catching up one run per pass — a month of back-dated messages to a client.
 * The cron path gets this for free, since a parser always returns a future
 * occurrence.
 */
export function nextTickAfter(
  tick: Date,
  interval: ScheduleInterval,
  now: Date = new Date()
): Date {
  const stepMs = intervalMinutes(interval) * 60_000;

  /* Whole steps needed to clear `now`, computed rather than looped: a dormant
     agent could be thousands of steps behind and a loop would be the only
     unbounded thing in the pass. */
  const behind = now.getTime() - tick.getTime();
  const steps = behind < 0 ? 1 : Math.floor(behind / stepMs) + 1;

  return new Date(tick.getTime() + steps * stepMs);
}
