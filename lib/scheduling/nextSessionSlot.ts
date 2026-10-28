/**
 * Where a replacement session goes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS FOR
 *
 * Calling off or missing a session of a package offers the owner a replacement,
 * and the agreed rule is that it lands "after the last one". A block is a
 * rhythm — weekly, fortnightly, monthly — so the honest reading of "after the
 * last one" is one more interval of that rhythm past the final session.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE MOST COMMON GAP, NOT THE LAST ONE
 *
 * Reading the gap between the final two sessions is the obvious thing and it is
 * wrong on exactly the packages this feature exists for. A block whose third
 * session was rescheduled from the 13th to the 9th has gaps of 4 days and 11
 * days in a series that is plainly weekly; taking the last pair would propose a
 * date eleven days out and call it the rhythm.
 *
 * So the gaps are counted and the one that occurs most often wins. A series
 * with no repeated gap at all has no rhythm to read, and falls back to a week.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE OWNER ALWAYS SEES IT FIRST
 *
 * This proposes; it never books. The date is shown on the dialog beside the
 * toggle, so an owner whose block has no sensible rhythm can decline and place
 * the session by hand — the "Add another meeting" control does exactly that and
 * is available the moment a place frees.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const WEEK = 7 * DAY;

/**
 * A gap outside this range is not a rhythm.
 *
 * Under a day means two sessions on the same morning — true of a workshop, not
 * of a series, and repeating it would propose an hour later today. Over ninety
 * days is a block so sparse that "one more interval" is a guess about next
 * quarter.
 */
const SHORTEST = DAY;
const LONGEST = 90 * DAY;

/** An hour that is already spoken for. Half-open: `end` is free. */
export interface BusyInterval {
  start: string;
  end: string;
}

export interface NextSlotOptions {
  /** How long the replacement runs. Decides what "overlaps" means. */
  durationMinutes?: number;
  /** Hours already taken — other bookings, and an external calendar's events. */
  busy?: BusyInterval[];
  /** Now, injected so this stays a pure function and can be tested. */
  now?: Date;
  /**
   * How many rhythms to try before giving up.
   *
   * A block whose next twelve weeks are solid has no obvious answer, and
   * walking forward for ever to find one would propose a date months past
   * anything the owner was thinking about. Null is the honest result: the
   * toggle is hidden and the owner places the session by hand.
   */
  maxTries?: number;
  /**
   * How many free hours to return from `nextSessionSlots`.
   *
   * Ignored by `nextSessionSlot`, which always answers with one.
   */
  count?: number;
}

/**
 * @param starts every session's start, in any order. Rows that are not real
 *               dates are ignored rather than throwing — one bad row must not
 *               cost the owner the offer.
 * @returns the proposed start as an ISO instant, or null when there is nothing
 *          to read a rhythm from — or nothing free within reach.
 */
export function nextSessionSlot(
  starts: Array<string | null | undefined>,
  options: NextSlotOptions = {}
): string | null {
  const times = starts
    .map(value => (value ? new Date(value).getTime() : NaN))
    .filter(time => Number.isFinite(time))
    .sort((a, b) => a - b);

  if (times.length === 0) return null;

  const last = times[times.length - 1];

  /*
   * ── THE HOUR HAS TO BE FREE, AND IT HAS TO BE AHEAD ─────────────────────
   *
   * One rhythm past the last session is where a replacement BELONGS; it is not
   * necessarily where it can go. The hour may already be sold to somebody
   * else, and on a block whose sessions are in the past it may be behind us
   * altogether — cancelling a session that was never held is exactly when an
   * owner reaches for this.
   *
   * So the rhythm is a step, not an answer: walk it forward until a candidate
   * is both in the future and clear of everything already booked. Each step
   * keeps the series' own weekday and time of day, which is the point of
   * reading the rhythm at all.
   */
  const duration = Math.max(1, options.durationMinutes ?? 60) * MINUTE;
  const nowMs = (options.now ?? new Date()).getTime();
  const tries = Math.max(1, options.maxTries ?? 12);
  const wanted = Math.max(1, options.count ?? 1);

  const busy = (options.busy ?? [])
    .map(interval => ({
      start: new Date(interval.start).getTime(),
      end: new Date(interval.end).getTime(),
    }))
    .filter(interval => Number.isFinite(interval.start) && Number.isFinite(interval.end));

  /* Half-open, the same test the database constraint makes: a meeting ending
     exactly when this one starts is not a clash. */
  const clashes = (start: number) =>
    busy.some(interval => start < interval.end && start + duration > interval.start);

  /**
   * Every free hour the rhythm reaches, in order, up to `tries` steps.
   *
   * The proposal is the first of these. The rest exist because the rhythm's
   * next beat can be right about the pattern and wrong about the week: the
   * owner is away, the room is taken by something this app cannot see, or the
   * client simply cannot make it. Offering only one date forced them to
   * decline the replacement entirely and place it by hand, which is the long
   * way round for "not that Tuesday, the one after".
   */
  const freeFrom = (step: number): string[] => {
    const found: string[] = [];
    for (let attempt = 1; attempt <= tries; attempt += 1) {
      const candidate = last + step * attempt;
      if (candidate > nowMs && !clashes(candidate)) {
        found.push(new Date(candidate).toISOString());
        if (found.length >= wanted) break;
      }
    }
    return found;
  };

  const firstFree = (step: number): string | null => freeFrom(step)[0] ?? null;

  /* One session tells you when, never how often. */
  if (times.length === 1) return firstFree(WEEK);

  const gaps: number[] = [];
  for (let index = 1; index < times.length; index += 1) {
    const gap = times[index] - times[index - 1];
    if (gap >= SHORTEST && gap <= LONGEST) gaps.push(gap);
  }

  if (gaps.length === 0) return firstFree(WEEK);

  /*
   * The most common gap. Counted to the DAY rather than the millisecond: a
   * series moved across a daylight-saving boundary is an hour out, and a
   * fortnightly block whose gaps differ by that hour has no repeated value at
   * all unless they are rounded first.
   */
  const tally = new Map<number, number>();
  for (const gap of gaps) {
    const days = Math.round(gap / DAY);
    tally.set(days, (tally.get(days) ?? 0) + 1);
  }

  let bestDays = Math.round(gaps[gaps.length - 1] / DAY);
  let bestCount = 0;

  for (const [days, count] of tally) {
    /*
     * Ties go to the SHORTER gap. Two readings are equally supported and the
     * shorter one puts the replacement sooner, which is the direction an owner
     * making up a missed session is going.
     */
    if (count > bestCount || (count === bestCount && days < bestDays)) {
      bestDays = days;
      bestCount = count;
    }
  }

  return firstFree(bestDays * DAY);
}

/**
 * The same proposal, plus the next few after it.
 *
 * One function, one set of rules: the rhythm is read the same way, the clash
 * test is the same half-open comparison the database constraint makes, and a
 * series with nothing to read from still answers with nothing. The only
 * difference is how many of the free hours it keeps.
 *
 * Returned oldest first, so the caller can offer the first as the proposal and
 * the rest as alternatives without re-sorting.
 */
export function nextSessionSlots(
  starts: Array<string | null | undefined>,
  options: NextSlotOptions = {}
): string[] {
  const wanted = Math.max(1, options.count ?? 3);
  const found: string[] = [];

  /*
   * Walked by asking the singular function for one more each time rather than
   * duplicating the rhythm logic: each round excludes the hours already
   * offered, so the second answer is the rhythm's next free beat after the
   * first, not the first again.
   */
  let busy = options.busy ?? [];
  const duration = Math.max(1, options.durationMinutes ?? 60);

  for (let round = 0; round < wanted; round += 1) {
    const next = nextSessionSlot(starts, { ...options, busy, count: 1 });
    if (!next) break;
    found.push(next);
    const start = new Date(next);
    busy = [
      ...busy,
      {
        start: next,
        end: new Date(start.getTime() + duration * 60_000).toISOString(),
      },
    ];
  }

  return found;
}
