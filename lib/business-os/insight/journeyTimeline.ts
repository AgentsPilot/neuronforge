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
  progress: { current: number; threshold: number } | null;
  /**
   * Jobs the platform could take over right now, for the handover node.
   *
   * Not a threshold — there is nothing to reach. It is the answer to "is there
   * anything to hand over today", which is the only useful thing that node can
   * say before the owner has handed over anything.
   */
  offered: number | null;
}

export interface JourneyVector {
  key: string;
  dataPoints: number;
  threshold: number;
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
  /** From `vectorMaturity.vectors` — needs `conv` for the count threshold. */
  vectors: JourneyVector[];
  /** Injectable so the tests are not a function of the day they run. */
  now?: number;
}

export interface Journey {
  nodes: JourneyNode[];
  /**
   * Index of the last node in the `reached` state, or -1.
   * The rail fills to here and the "today" marker sits just past it.
   */
  lastReachedIndex: number;
  /** Today, as a day number, when day zero is known. */
  todayDay: number | null;
}

const parse = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
};

/**
 * Whole days from day zero — 0 on the day the account was created.
 *
 * Floored, so an event four hours after signup is day 0 rather than day 1.
 * That is the honest reading: it happened on the first day.
 */
const dayNumber = (at: number | null, zero: number | null): number | null =>
  at === null || zero === null ? null : Math.max(0, Math.floor((at - zero) / DAY_MS));

/**
 * Whole days from day zero to now — the "today" marker's number.
 *
 * Exported so the dashboard can compute it OUTSIDE the memo that builds the
 * nodes. Everything else in a journey is a fact about the past and changes only
 * when the data does; today is the one value that goes stale on its own, and
 * behind a memo keyed on the data it froze at whatever it read when the page
 * was opened. A tab left open over a weekend went on insisting it was Friday.
 */
export function daysSince(iso: string | null | undefined, now: number = Date.now()): number | null {
  // `dayNumber` already answers null for an absent or unparseable anchor.
  return dayNumber(now, parse(iso));
}

/** A milestone: reached the moment the event has a date, waiting until then. */
function milestone(
  key: JourneyNodeKey,
  at: number | null,
  zero: number | null
): JourneyNode {
  return {
    key,
    kind: 'milestone',
    state: at === null ? 'waiting' : 'reached',
    day: dayNumber(at, zero),
    date: at === null ? null : new Date(at).toISOString(),
    progress: null,
    offered: null,
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
  now: number
): JourneyNode {
  if (anchor === null) {
    return {
      key, kind: 'unlock', state: 'waiting',
      day: null, date: null, progress: null, offered: null,
    };
  }
  const unlocksAt = anchor + thresholdDays * DAY_MS;
  return {
    key,
    kind: 'unlock',
    state: now >= unlocksAt ? 'reached' : 'counting',
    day: dayNumber(unlocksAt, zero),
    date: new Date(unlocksAt).toISOString(),
    progress: null,
    offered: null,
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
  zero: number | null
): JourneyNode {
  const current = vector?.dataPoints ?? 0;
  const threshold = vector?.threshold ?? 0;
  const reached = threshold > 0 && current >= threshold;
  const state: JourneyNodeState = reached ? 'reached' : current > 0 ? 'counting' : 'waiting';

  return {
    key,
    kind: 'unlock',
    state,
    day: reached ? dayNumber(crossedAt, zero) : null,
    date: reached && crossedAt !== null ? new Date(crossedAt).toISOString() : null,
    progress: { current, threshold },
    offered: null,
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
  zero: number | null
): JourneyNode {
  if (firstAutomationAt !== null) {
    return {
      key: 'handover',
      kind: 'unlock',
      state: 'reached',
      day: dayNumber(firstAutomationAt, zero),
      date: new Date(firstAutomationAt).toISOString(),
      progress: null,
      offered: null,
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

  const nodes: JourneyNode[] = [
    milestone('account', zero, zero),
    milestone('visitor', parse(input.firstVisitorAt), zero),
    milestone('enquiry', parse(input.firstEnquiryAt), zero),
    milestone('booking', firstBooking, zero),
    countedUnlock('conv', vector('conv'), parse(input.convCrossedAt), zero),
    // 42 and 60 are not chosen here — they are read off the vector, which is
    // the one place a threshold is allowed to live. See VECTOR_THRESHOLDS.
    datedUnlock('price', firstBooking, vector('price')?.threshold ?? 42, zero, now),
    datedUnlock('ret', firstClient, vector('ret')?.threshold ?? 60, zero, now),
    handoverUnlock(parse(input.firstAutomationAt), input.automatableNow ?? 0, zero),
  ];

  let lastReachedIndex = -1;
  nodes.forEach((node, index) => {
    if (node.state === 'reached') lastReachedIndex = index;
  });

  return {
    nodes,
    lastReachedIndex,
    todayDay: dayNumber(now, zero),
  };
}
