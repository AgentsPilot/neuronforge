/**
 * The days past due on which a business chases an unpaid invoice.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE SOURCE, BECAUSE TWO DEFAULTS DISAGREE AND THE COPY QUOTES A THIRD.
 *
 * The list lives in three places: this module's default, the column default
 * `{1,3,7}` from `20260723_enhance_payments.sql`, and owner-facing copy that
 * states "days 1, 3 and 7" as a fact.
 *
 * The two defaults do NOT agree — the service's was `[3,7,14]`. That has cost
 * nothing so far because every profile on the platform carries the column value
 * `{1,3,7}`, which is what the copy quotes. The harm is latent: the first
 * account created without that column would be shown a schedule it is not on.
 * Worth closing by making the two defaults the same; left alone here because
 * changing a send cadence is a behaviour change and this module is not the
 * place to smuggle one in.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY ITS OWN MODULE, AND NOT A FUNCTION ON THE SERVICE
 *
 * The Needs-you gap has to ask the same question, and importing
 * `PaymentReminderService` to ask it pulls the whole email stack — branding,
 * theme resolution, templates — into `lib/business-os/gaps`, which runs on every
 * dashboard load. Two pure functions and a number do not need any of that.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Five touches over seventeen days, never two inside three. */
export const DEFAULT_OVERDUE_DAYS = [3, 7, 14];

/** This business's milestones, lowest first. Empty or absent means the default. */
export function overdueMilestones(fromProfile: number[] | null | undefined): number[] {
  const days = fromProfile?.length ? fromProfile : DEFAULT_OVERDUE_DAYS;
  return [...days].sort((a, b) => a - b);
}

/**
 * Can the chaser still reach this invoice?
 *
 * `processOverdueItems` sends only when the day count EQUALS a milestone, so an
 * invoice already past the last one can never be chased again — not today, not
 * ever. That is not a bug being papered over here: it is the reason the
 * Needs-you card has to pick the invoice up instead, and this is the test it
 * uses to know when.
 */
export function chaserCanStillReach(
  daysOverdue: number,
  fromProfile: number[] | null | undefined
): boolean {
  const milestones = overdueMilestones(fromProfile);
  return daysOverdue <= milestones[milestones.length - 1];
}
