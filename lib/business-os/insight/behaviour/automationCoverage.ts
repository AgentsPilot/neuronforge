/**
 * Of everything the owner did, how much could the platform have done instead?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This is the only number that measures the product's actual promise. Revenue
 * and bookings describe the business; this describes whether the platform is
 * taking work off the person running it.
 *
 * It is deliberately NOT an owner-facing score. On the reporting account it
 * comes out near zero, and "we can automate 0.4% of your work" is a demoralising
 * thing to put on somebody's dashboard. Its value is the INVERSE: the ranked
 * list of what nothing covers, which says which automation to build next.
 *
 * Pure, with no database and no imports beyond types, for the same reason
 * `funnelGap` and `dominantReason` are: this is where the judgement lives and it
 * should be testable without fixtures.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * The automations that exist (`lib/business-os/gaps/automations.ts`).
 *
 * Adding one here is half the job: `AUTOMATABLE` below has to map the audit
 * action it performs, or coverage keeps reporting that work as uncovered.
 */
export type AutomationId =
  | 'reply_to_enquiries'
  | 'chase_invoices'
  | 'chase_intake'
  | 'remind_about_meeting'
  | 'auto_complete_meetings';

export interface ActionTally {
  action: string;
  count: number;
}

export interface CoverageLine {
  action: string;
  count: number;
  /** The automation that could do this, or null when nothing can. */
  automation: AutomationId | null;
  /** Whether that automation is switched on for this owner. */
  enabled: boolean;
}

/**
 * What this measures, precisely: POTENTIAL, not hand-over.
 *
 * Every figure here is counted from work the OWNER did. So an action that an
 * enabled automation could have performed still appears -- the owner did it, by
 * hand, while something that could have done it was switched on. That is a
 * finding in itself (the automation did not get there in time, or never fired),
 * and it is emphatically NOT the platform having taken the work.
 *
 * An earlier version of this called that field `covered`, which reads as "the
 * platform did this" and would have overstated the product's reach the moment
 * anybody built on it. Measuring ACTUAL hand-over needs the other side of the
 * ledger -- what the automations did, which lives in `lead_responses` and
 * `payment_reminders` -- and is a separate piece of work.
 */
export interface CoverageReport {
  /** Work actions the owner performed in the window. */
  ownerActions: number;
  /** Of those, how many an existing automation could perform, on or off. */
  automatable: number;
  /** Of those, how many an automation that is SWITCHED ON could perform. */
  automatableNow: number;
  /** Nothing the platform has can do these, ranked by how often they happen. */
  uncovered: CoverageLine[];
  lines: CoverageLine[];
}

/**
 * Which audit action each automation could perform.
 *
 * Deliberately narrow. The temptation is to map `PAYMENT_INVOICE_SENT` to
 * `chase_invoices` and claim a big number, but sending an invoice for the first
 * time is not chasing it -- `chase_invoices` only pursues one already overdue.
 * Counting the first send would inflate coverage with work the platform cannot
 * actually take, which makes the number flattering and useless.
 *
 * An action absent from this map is NOT an oversight: it means no automation
 * exists that performs it, which is exactly what the uncovered list reports.
 */
const AUTOMATABLE: Record<string, AutomationId> = {
  INTAKE_EMAIL_RESENT: 'chase_intake',
  INTAKE_REMINDER_SENT: 'chase_intake',
  PAYMENT_REMINDER_SENT: 'chase_invoices',
  PAYMENT_INVOICE_REMINDER_SENT: 'chase_invoices',
  BOOKING_REMINDER_SENT: 'remind_about_meeting',
  /*
   * Automation #5, added 2026-10-06 because this was third by volume among the
   * work nothing could take (52 actions across accounts). Coverage for any
   * account that switches it on moves the moment this line exists.
   */
  SCHEDULING_BOOKING_COMPLETED: 'auto_complete_meetings',
  LEAD_REPLY_SENT: 'reply_to_enquiries',
  LEAD_FOLLOWUP_SENT: 'reply_to_enquiries',
};

/**
 * Actions that are not WORK, so counting them as uncovered would be noise.
 *
 * Logging in is not a task anybody wants taken off them, and asking the
 * assistant a question is the platform working rather than the owner toiling.
 * Both are interesting behavioural signals in their own right and neither
 * belongs in a measure of "work that could be handed over".
 */
const NOT_WORK = new Set([
  'USER_LOGIN',
  'USER_LOGOUT',
  'BUSINESS_CHAT_QUERY',
  'BUSINESS_AI_ACTION_COMPLETED',
  'BUSINESS_AI_ACTION_FAILED',
  'BUSINESS_CHAT_WRITE',
]);

/**
 * Score one owner's month.
 *
 * `enabledAutomations` is the set switched on, so a distinction can be drawn
 * between "nothing can do this" and "something can and it is off" -- opposite
 * problems calling for opposite responses, and the gap registry already keeps
 * three states (on / declined / never asked) for exactly this reason.
 */
export function automationCoverage(
  tallies: ActionTally[],
  enabledAutomations: Set<AutomationId>
): CoverageReport {
  const lines: CoverageLine[] = [];

  for (const tally of tallies) {
    if (NOT_WORK.has(tally.action)) continue;

    const automation = AUTOMATABLE[tally.action] ?? null;
    lines.push({
      action: tally.action,
      count: tally.count,
      automation,
      enabled: automation ? enabledAutomations.has(automation) : false,
    });
  }

  lines.sort((a, b) => b.count - a.count);

  const ownerActions = lines.reduce((n, l) => n + l.count, 0);
  const automatable = lines.filter(l => l.automation).reduce((n, l) => n + l.count, 0);
  const automatableNow = lines
    .filter(l => l.automation && l.enabled)
    .reduce((n, l) => n + l.count, 0);

  return {
    ownerActions,
    automatable,
    automatableNow,
    uncovered: lines.filter(l => !l.automation),
    lines,
  };
}

/**
 * The share of the owner's work that something switched on COULD have taken.
 *
 * Not "the share the platform did" -- see the note on `CoverageReport`. On the
 * reporting account this is 0.4%, which says the other 99.6% of what the owner
 * did has nothing that could do it. That is the useful reading and it is an
 * upper bound on hand-over, never a measure of it.
 *
 * Returns null rather than 0 when there is nothing to measure: a month with no
 * recorded work has no ratio, and 0% would read as the platform failing rather
 * than as an absence of data. The distinction `funnelGap` draws for two
 * incomparable periods.
 */
export function automatableNowPercent(report: CoverageReport): number | null {
  if (report.ownerActions === 0) return null;
  return Math.round((report.automatableNow / report.ownerActions) * 1000) / 10;
}
