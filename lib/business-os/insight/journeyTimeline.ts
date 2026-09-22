/**
 * The journey timeline: what happened to this business, and when.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The strip this replaces had five fixed nodes — day 1, 4, 18, 60, 90 — lit by
 * nothing but `now − business_profiles.created_at`. So "Day 4 · First visitors"
 * went past on day four whether or not anyone had visited, and a business whose
 * first booking landed on day 27 was shown "Day 18 · First booking" sitting
 * behind it in the past. The nodes described the calendar and claimed to
 * describe the business.
 *
 * They were also the last thing gated on account age, which is a number that
 * resets: re-running the onboarding chat recreates the profile row and the
 * journey started again from day 1 for a business months old.
 *
 * Every node here is anchored to an event instead. That is not a new idea in
 * this codebase — it is what the insight engine already does. `VECTOR_THRESHOLDS`
 * measures retention in `days_with_clients` counted from the FIRST CLIENT, and
 * pricing in `days_with_bookings` counted from the FIRST BOOKING. The timeline
 * was the only part of the system still counting from signup.
 *
 * Three states, and the distinction between the last two is the whole point:
 *
 *   reached   it happened; the date is the record and the day number is
 *             arithmetic on it
 *   counting  the anchor event exists, so the unlock date is COMPUTABLE —
 *             `first booking + 42 days` — rather than predicted
 *   waiting   no anchor, so no date is offered at all. It names the condition
 *             and stops. Nothing is greyed out as overdue.
 *
 * No imports: this runs inside the dashboard bundle.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type JourneyNodeState = 'reached' | 'counting' | 'waiting';

/** A milestone is something the business did. An unlock is something we start doing. */
export type JourneyNodeKind = 'milestone' | 'unlock';

export type JourneyNodeKey =
  | 'account'
  | 'visitor'
  | 'enquiry'
  | 'booking'
  | 'conv'
  | 'price'
  | 'ret'
  | 'handover';

export interface JourneyNode {
  key: JourneyNodeKey;
  kind: JourneyNodeKind;
  state: JourneyNodeState;
  /** Days since the account was created. Null when there is no date to measure. */
  day: number | null;
  /** ISO date of the event, or of the computed unlock. Null while waiting. */
  date: string | null;
  /**
   * Progress toward a threshold counted in things rather than days.
   * Only the conversion vector uses one; the rest are dated.
   */
  /**
   * How far along a counted unlock is, and WHAT is being counted.
   *
   * `metric` is carried because the dashboard cannot otherwise tell: it used
   * one hardcoded label, "visitors so far", for every node with progress — so
   * the pricing node, which counts BOOKINGS, told the owner it was counting
   * visitors. The vector always knew; this shape was dropping it.
   */
  progress: { current: number; threshold: number; metric: string } | null;
  /**
   * Jobs the platform could take over right now, for the handover node.
   *
   * Not a threshold — there is nothing to reach. It is the answer to "is there
   * anything to hand over today", which is the only useful thing that node can
   * say before the owner has handed over anything.
   */
  offered: number | null;
  /**
   * Standing automations actually switched on right now.
   *
   * Distinct from `offered`, which counts what COULD be handed over. The node
   * is named "working on its own", and that phrase is only true of something
   * running — showing the offer under it said the platform was doing work
   * nobody had asked it to do.
   */
  running: number | null;
}

/**
 * What a counted unlock is counting, where the vector does not say.
 *
 * A vector names a metric only for its `also` volume condition. The `conv`
 * node counts the contacts the conversion vector has seen, and without this it
 * would fall back to the generic word — which is how "visitors so far" ended up
 * under a node counting bookings.
 */
const DEFAULT_METRIC: Partial<Record<JourneyNodeKey, string>> = {
  conv: 'total_contacts',
  price: 'total_bookings',
  ret: 'total_clients',
};

export interface JourneyVector {
  key: string;
  dataPoints: number;
  threshold: number;
  /**
   * The volume condition behind a time-based vector, when it has one.
   *
   * `price` and `ret` unlock on elapsed days AND on having enough behind them.
   * The date alone is arithmetic and can be promised; the volume cannot, so a
   * node whose volume is still short must not print a date it may not honour.
   */
  also?: { metric: string; current: number; threshold: number };
}

export interface JourneyInput {
  /** Day zero. Null when the profile row is missing — day numbers then go unstated. */
  accountCreatedAt: string | null;
  firstVisitorAt: string | null;
  firstEnquiryAt: string | null;
  firstBookingAt: string | null;
  firstClientAt: string | null;
  /** When the conversion vector's visitor threshold was crossed, if it has been. */
  convCrossedAt?: string | null;
  /** The first standing automation the owner handed over. */
  firstAutomationAt?: string | null;
  /**
   * Pending insights the kernel could take over right now.
   *
   * Counted by the caller, which is the only place that holds both the pending
   * insights and the per-detector eligibility flag.
   */
  automatableNow?: number;
  /** Standing automations switched on right now. Drives "working on its own". */
  runningAutomations?: number;
  /** From `vectorMaturity.vectors` — needs `conv` for the count threshold. */
  vectors: JourneyVector[];
  /** Injectable so the tests are not a function of the day they run. */
  now?: number;
  /**
   * The business's own zone, for counting which date each event fell on.
   *
   * Defaults to UTC, which keeps a caller that has not got one deterministic
   * rather than quietly using whichever machine is rendering. See `dayNumber`
   * for why this is the business's zone and not the reader's.
   */
  timezone?: string;
}

export interface Journey {
  nodes: JourneyNode[];
  /**
   * Index of the last node in the `reached` state, or -1.
   *
   * NOT what the rail fills to — see `contiguousReachedIndex`.
   */
  lastReachedIndex: number;
  /**
   * Index of the last node in an unbroken run of `reached` from the start,
   * or -1.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * This exists because the journey is NOT a strict sequence, and the rail
   * drawn across it is.
   *
   * Handover is the last node and it can be reached at any time: an owner can
   * switch on invoice chasing in their first week, long before they have the
   * client history that unlocks retention insights. The moment that happened,
   * `lastReachedIndex` jumped to the end, the rail filled the whole way, and
   * the orange line ran straight THROUGH a retention node still drawn as a grey
   * hollow circle — the line saying done, the circle saying not yet, about the
   * same thing. The "today" marker went to the far right with it, landing on a
   * node that has no date at all.
   *
   * A filled rail means everything up to here has happened. So it stops at the
   * first thing that has not, and a later milestone still shows as reached in
   * its own right, just without claiming the ones before it.
   * ───────────────────────────────────────────────────────────────────────────
   */
  contiguousReachedIndex: number;
  /** Today, as a day number, when day zero is known. */
  todayDay: number | null;
}

const parse = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
};

/**
 * Which calendar date an instant falls on, in a given zone. `YYYY-MM-DD`.
 *
 * Formatters are not free to build, and a journey asks for a dozen of them in
 * one render, so they are kept.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function dateKey(ms: number, timezone: string): string {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatters.set(timezone, formatter);
  }
  // en-CA gives ISO order, which is what makes the parts safe to reassemble.
  return formatter.format(new Date(ms));
}

/**
 * Whole days from day zero — 0 on the day the journey started.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CALENDAR DATES, NOT ELAPSED TIME.
 *
 * This floored elapsed milliseconds: `Math.floor((at - zero) / DAY_MS)`. The
 * reasoning was that an event four hours after signup happened on the first day
 * and should read day 0, which is right — but it only holds when day zero falls
 * near the start of a day.
 *
 * On a real account the anchor was a first page view at 21:08. From there,
 * anything before 21:08 the NEXT date still floored to 0, and the today marker
 * read DAY 3 on the fifth date of a journey whose first node was labelled
 * Sep 14: a reader counting Sep 14, 15, 16, 17, 18 gets four. Every node in
 * that row carries a calendar date, and the day number beside it was not
 * counting them.
 *
 * IN THE BUSINESS'S ZONE, WHICH IS WHY IT IS A PARAMETER
 *
 * Not the reader's. The journey is a set of facts about a business, and an
 * owner in New Jersey opening the dashboard from a hotel in Tel Aviv must not
 * see their first booking move to a different day. A parameter also makes this
 * function total: same arguments, same answer, on any machine.
 *
 * Both instants are reduced to their calendar date first and only then
 * subtracted, so the arithmetic is exact across daylight-saving changes, where
 * two midnights are 23 or 25 hours apart.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const dayNumber = (at: number | null, zero: number | null, timezone: string): number | null => {
  if (at === null || zero === null) return null;

  const midnightUtc = (ms: number) => {
    const [year, month, day] = dateKey(ms, timezone).split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };

  return Math.max(0, Math.round((midnightUtc(at) - midnightUtc(zero)) / DAY_MS));
};

/**
 * Whole days from day zero to now — the "today" marker's number.
 *
 * Exported so the dashboard can compute it OUTSIDE the memo that builds the
 * nodes. Everything else in a journey is a fact about the past and changes only
 * when the data does; today is the one value that goes stale on its own, and
 * behind a memo keyed on the data it froze at whatever it read when the page
 * was opened. A tab left open over a weekend went on insisting it was Friday.
 */
export function daysSince(
  iso: string | null | undefined,
  timezone: string = 'UTC',
  now: number = Date.now()
): number | null {
  // `dayNumber` already answers null for an absent or unparseable anchor.
  return dayNumber(now, parse(iso), timezone);
}

/** A milestone: reached the moment the event has a date, waiting until then. */
function milestone(
  key: JourneyNodeKey,
  at: number | null,
  zero: number | null,
  timezone: string
): JourneyNode {
  return {
    key,
    kind: 'milestone',
    state: at === null ? 'waiting' : 'reached',
    day: dayNumber(at, zero, timezone),
    date: at === null ? null : new Date(at).toISOString(),
    progress: null,
    offered: null,
    running: null,
  };
}

/**
 * An unlock measured in days from an anchor event.
 *
 * Once the anchor exists the unlock date is arithmetic, so it is stated whether
 * it has arrived or not — that is what separates `counting` from a prediction.
 */
function datedUnlock(
  key: JourneyNodeKey,
  anchor: number | null,
  thresholdDays: number,
  zero: number | null,
  now: number,
  timezone: string,
  vector?: JourneyVector
): JourneyNode {
  if (anchor === null) {
    return {
      key, kind: 'unlock', state: 'waiting',
      day: null, date: null, progress: null, offered: null, running: null,
    };
  }

  const unlocksAt = anchor + thresholdDays * DAY_MS;
  const dayReached = now >= unlocksAt;

  /*
   * The clock is necessary and not sufficient.
   *
   * These vectors also need enough behind them — twenty bookings before the
   * platform says anything about price, ten clients before a lapse is a rate.
   * While that side is short, the node shows the COUNT and no date: the date
   * would be a promise about the calendar for an unlock the calendar does not
   * control, and this rail's whole discipline is never printing a date it
   * cannot keep. Once the volume is there, the date is arithmetic again.
   */
  const also = vector?.also;
  const volumeShort = !!also && also.current < also.threshold;

  if (volumeShort) {
    return {
      key,
      kind: 'unlock',
      state: also!.current > 0 ? 'counting' : 'waiting',
      day: null,
      date: null,
      progress: { current: also!.current, threshold: also!.threshold, metric: also!.metric },
      offered: null,
      running: null,
    };
  }

  return {
    key,
    kind: 'unlock',
    state: dayReached ? 'reached' : 'counting',
    day: dayNumber(unlocksAt, zero, timezone),
    date: new Date(unlocksAt).toISOString(),
    progress: null,
    offered: null,
    running: null,
  };
}

/**
 * An unlock measured in a count rather than in days.
 *
 * Asymmetric, and deliberately so. Once it is reached the crossing date is a
 * fact and the repository reads it, so the node carries a date like any other.
 * Before then it cannot: no arithmetic predicts when a 25th visitor arrives. So
 * until it is crossed the node shows the count and nothing else — a progress
 * bar in words, with no date to be wrong about.
 */
function countedUnlock(
  key: JourneyNodeKey,
  vector: JourneyVector | undefined,
  crossedAt: number | null,
  zero: number | null,
  timezone: string
): JourneyNode {
  const current = vector?.dataPoints ?? 0;
  const threshold = vector?.threshold ?? 0;
  const reached = threshold > 0 && current >= threshold;
  const state: JourneyNodeState = reached ? 'reached' : current > 0 ? 'counting' : 'waiting';

  return {
    key,
    kind: 'unlock',
    state,
    day: reached ? dayNumber(crossedAt, zero, timezone) : null,
    date: reached && crossedAt !== null ? new Date(crossedAt).toISOString() : null,
    progress: { current, threshold, metric: vector?.also?.metric ?? DEFAULT_METRIC[key] ?? 'items' },
    offered: null,
    running: null,
  };
}

/**
 * Handover: the platform holding a recurring job instead of the owner.
 *
 * This is what "Day 90 · Automated / Takes over" was reaching for, and it was
 * the least defensible node on the old rail — the calendar cannot know when a
 * business is ready to delegate, or whether it ever will. There is no time gate
 * on automation today and there is no plausible one: a practice with three
 * standing automations in week two has handed over, and one with none in month
 * six has not.
 *
 * So the node reports the two things that are true:
 *
 *   reached   the owner turned on a standing automation, on this date
 *   counting  N jobs are eligible right now and nobody has taken them —
 *             the actionable state, and the reason this beats a countdown:
 *             "3 ready to hand over" is something to do today
 *   waiting   nothing to hand over yet
 *
 * When automation gating is built, it lands here: the gate becomes another
 * anchor and `counting` narrows to what the gate actually permits.
 */
function handoverUnlock(
  firstAutomationAt: number | null,
  offered: number,
  zero: number | null,
  running: number,
  timezone: string
): JourneyNode {
  /*
   * Two different questions, and the node answers both.
   *
   * REACHED is a milestone: the owner handed something over, on this date. A
   * timeline does not un-happen, so this stays true even if every automation is
   * later paused — which is what the tests below pin down.
   *
   * RUNNING is the live count, and it is what the node's name actually claims.
   * "Working on its own" is only true of something switched on right now, so
   * the headline number comes from `running` rather than from the offer. An
   * account that handed over in March and paused in April is still a business
   * that reached the milestone, and it is not a business working on its own.
   */
  if (firstAutomationAt !== null || running > 0) {
    return {
      key: 'handover',
      kind: 'unlock',
      state: 'reached',
      day: dayNumber(firstAutomationAt, zero, timezone),
      date: firstAutomationAt === null ? null : new Date(firstAutomationAt).toISOString(),
      progress: null,
      offered: null,
      running: running > 0 ? running : null,
    };
  }

  return {
    key: 'handover',
    kind: 'unlock',
    state: offered > 0 ? 'counting' : 'waiting',
    day: null,
    date: null,
    progress: null,
    offered: offered > 0 ? offered : null,
    running: null,
  };
}

/**
 * The eight nodes, in a fixed order.
 *
 * Fixed rather than sorted by date: a node that moved along the rail between
 * two dashboard loads would be unreadable, and the two undated unlocks have no
 * position to be sorted into anyway. Milestones run in the order they can
 * happen, then the unlocks in the order they typically arrive.
 */
export function buildJourney(input: JourneyInput): Journey {
  const now = input.now ?? Date.now();
  const zero = parse(input.accountCreatedAt);
  const firstBooking = parse(input.firstBookingAt);
  const firstClient = parse(input.firstClientAt);

  const vector = (key: string) => input.vectors.find(v => v.key === key);

  /*
   * UTC when the caller has none. A wrong-but-fixed zone is off by at most a
   * day at the edges; falling back to the rendering machine's zone would make
   * the same business's timeline read differently on two screens.
   */
  const timezone = input.timezone || 'UTC';

  const nodes: JourneyNode[] = [
    milestone('account', zero, zero, timezone),
    milestone('visitor', parse(input.firstVisitorAt), zero, timezone),
    milestone('enquiry', parse(input.firstEnquiryAt), zero, timezone),
    milestone('booking', firstBooking, zero, timezone),
    countedUnlock('conv', vector('conv'), parse(input.convCrossedAt), zero, timezone),
    // 42 and 60 are not chosen here — they are read off the vector, which is
    // the one place a threshold is allowed to live. See VECTOR_THRESHOLDS.
    datedUnlock('price', firstBooking, vector('price')?.threshold ?? 42, zero, now, timezone, vector('price')),
    datedUnlock('ret', firstClient, vector('ret')?.threshold ?? 60, zero, now, timezone, vector('ret')),
    handoverUnlock(parse(input.firstAutomationAt), input.automatableNow ?? 0, zero, input.runningAutomations ?? 0, timezone),
  ];

  let lastReachedIndex = -1;
  nodes.forEach((node, index) => {
    if (node.state === 'reached') lastReachedIndex = index;
  });

  // Stops at the first gap. See `contiguousReachedIndex`.
  let contiguousReachedIndex = -1;
  for (const node of nodes) {
    if (node.state !== 'reached') break;
    contiguousReachedIndex += 1;
  }

  return {
    nodes,
    lastReachedIndex,
    contiguousReachedIndex,
    todayDay: dayNumber(now, zero, timezone),
  };
}
