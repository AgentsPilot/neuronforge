/**
 * Which step of the booking dialog is open, and what the answered ones say.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A MODULE AND NOT A FEW TERNARIES IN THE DIALOG
 *
 * `SchedulingBookingModal` is 3,130 lines. The ordering rule is small but it
 * has four cases that are easy to get wrong and impossible to see in a diff
 * once they are inlined:
 *
 *   · a service sold as a product has NO date step at all, so "the step after
 *     the client" is not always the date one;
 *   · picking a slot for a package inherits its service and its client, so the
 *     first two steps are answered before the dialog opens;
 *   · editing a settled booking answers everything, and nothing should be open;
 *   · reopening an earlier step must not send the ones after it back to
 *     "pending" when they already have answers.
 *
 * Pure, so each of those is a test rather than a thing to click through.
 *
 * It decides ORDER and STATE only. The summary lines are passed in already
 * formatted: money needs the service's own currency and hours need the
 * business's zone, and both of those have their own history of being read from
 * the wrong place.
 */

/** The four questions, in the order they are asked. */
export type BookingStepKey = 'service' | 'client' | 'when' | 'details';

export type BookingStepState = 'done' | 'open' | 'pending';

export interface BookingStepFacts {
  /** The chosen service, summarised. Null until one is chosen. */
  service: string | null;
  /** The client, summarised. Null until there is a name and a way to reach them. */
  client: string | null;
  /**
   * The chosen hour, summarised. Null until one is chosen.
   *
   * Ignored entirely when `needsSchedule` is false — a course is bought, not
   * booked into an hour, and the dialog used to demand a date for it.
   */
  when: string | null;
  /** Notes, intake — summarised, or null when the owner has added neither. */
  details: string | null;
  /** False for a service with no date step. The "when" step is then absent. */
  needsSchedule: boolean;
  /**
   * A settled booking is read, not filled. Every step shows its answer and
   * none opens by itself.
   */
  settled?: boolean;
  /**
   * Steps the dialog is refusing to accept, and why they cannot collapse.
   *
   * An answer can be present and still wrong — a malformed email, a start in
   * the past, a service whose booking surface is not published. All three
   * leave a summary to collapse to and Save disabled, which is the worst
   * combination the collapsing design can produce: the owner sees a tick, a
   * dead button, and no message anywhere, because the message is inside the
   * step that just closed over it.
   */
  errors?: Partial<Record<BookingStepKey, boolean>>;
}

export interface PlannedStep {
  key: BookingStepKey;
  /** Its position among the steps that apply, from 1. */
  index: number;
  state: BookingStepState;
  /** What it says once answered. Carried through so the caller cannot lose it. */
  summary: string | null;
}

const ORDER: BookingStepKey[] = ['service', 'client', 'when', 'details'];

/**
 * @param facts    what is answered so far
 * @param opened   a step the owner reopened, which wins over the natural order
 */
export function planBookingSteps(
  facts: BookingStepFacts,
  opened?: BookingStepKey | null
): PlannedStep[] {
  const applies = ORDER.filter(key => key !== 'when' || facts.needsSchedule);

  const summaryOf = (key: BookingStepKey): string | null => {
    const value = facts[key];

    /*
     * An empty string is not an answer. A collapsed row reading "שירות ✓" and
     * nothing else tells the owner less than the picker it replaced, so the
     * two are deliberately not distinguished here: both mean "no summary".
     */
    return value ? value : null;
  };

  /*
   * Details is the one step nothing can answer FOR the owner — notes and an
   * intake toggle are optional, so it would stay open for ever on the
   * first-unanswered rule, which is exactly right: it is last, and it is where
   * the dialog should rest once the facts above it are settled.
   */
  /*
   * A step the dialog is refusing is never answered, whatever it has to show —
   * so it opens, and its message is on screen next to the field it is about.
   */
  const answered = (key: BookingStepKey) =>
    Boolean(summaryOf(key)) && !facts.errors?.[key];

  const reopened = opened && applies.includes(opened) ? opened : null;
  const natural = applies.find(key => !answered(key)) ?? null;

  const open = facts.settled ? null : (reopened ?? natural);

  return applies.map((key, position) => ({
    key,
    index: position + 1,
    state: key === open ? 'open' : answered(key) ? 'done' : 'pending',
    summary: summaryOf(key),
  }));
}

/**
 * The one line the footer carries: where the booking stands, in the order a
 * person reads it. Absent parts are dropped rather than left as placeholders.
 */
export function bookingFooterSummary(facts: BookingStepFacts): string {
  return [facts.service, facts.when, facts.client].filter(Boolean).join(' · ');
}
