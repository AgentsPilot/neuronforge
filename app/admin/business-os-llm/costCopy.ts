/**
 * The words of the Costs & credits tab (credit deduction slice 4a), in one
 * place so the render tests assert the same strings the screen shows.
 */

export const COSTS_TAB_LABEL = 'Costs & credits';
export const SETTINGS_TAB_LABEL = 'Settings';

export const COSTS_INTRO =
  'What Business OS actions cost us (USD, the provider’s measured cost) and what we charged ' +
  '(credits), per account and billing period. Read from the credit ledger; nothing here changes it.';

export const COSTS_EMPTY = 'No charges recorded in this window';

export const COSTS_EMPTY_HINT =
  'Charges appear here once Business OS AI actions run after charging went live.';

export const COSTS_INCOMPLETE =
  'Incomplete — a read stopped at its limit, so some figures below are lower bounds and the ' +
  'period check is skipped. Narrow the window or choose one account.';

export const COSTS_PERIOD_RULE = (lookbackDays: number) =>
  `Whole billing periods are shown: every period that started on or before the window’s last day ` +
  `and at most ${lookbackDays} days before its first day. A period’s figures never depend on the window edge.`;

export const NET_INCLUDING_CORRECTIONS = 'net, including corrections';

export const BREAKDOWN_NOTE =
  'Each correction is counted under the charge it corrects, so these lines are net figures and ' +
  'the trigger lines are not the stored owner / scheduled / external split above.';

export const SPREAD_NOTE = (fewBelow: number) =>
  `p50 and p90 over succeeded charges only; failed charges are counted beside them, and ` +
  `fallback-priced charges are left out. Below ${fewBelow} examples the figures are marked “few examples”.`;

export const FALLBACK_NOTE =
  'Charged from a fallback price because the measured price was missing — a deliberate ' +
  'over-estimate. Reconciling them is a later part of this work.';

export const SECTION_FAILED = 'This section could not be read. The other sections are unaffected.';

export const NAMES_FAILED = 'Business names could not be read; accounts are shown by id.';

export const UNREADABLE_AMOUNTS = (count: number) =>
  `${count} stored amount${count === 1 ? '' : 's'} could not be read and ${count === 1 ? 'was' : 'were'} ` +
  'counted as 0, so the figures below may be low. This should never happen: report it.';

/** QA Low 3: a failed read of the corrected charges is a READ failure, not a ledger break. */
export const ORIGINALS_FAILED = (count: number, credits: string) =>
  `The charges that corrections point at could not be read, so ${count} correction` +
  `${count === 1 ? '' : 's'} (${credits} credits) ${count === 1 ? 'is' : 'are'} counted on their own line. ` +
  'This is a failed read, not a gap in the ledger; re-read to try again.';

export const UNRESOLVED_LABEL = 'correction, charge not found';

export const NOT_DECLARED_LABEL = 'not declared';

export const INCOMPLETE_REASON_TEXT: Record<string, string> = {
  totals_ceiling: 'too many billing periods',
  rows_ceiling: 'too many ledger rows',
  originals_ceiling: 'too many corrections from other periods',
};
