/**
 * The words of the cost report (credit deduction slice 4a), in one place so
 * the render tests assert the same strings the screen shows. Money M-5 moved
 * the report from the Business OS AI "Costs & credits" tab to its own page,
 * Charge checks (`/admin/finance/charges`); the tab label became the page's h1
 * (S-6), renamed rather than removed (SA-W4).
 */

/** The Charge checks page's h1, equal to its sidebar label (LAY D-3 (a)). */
export const CHARGE_CHECKS_TITLE = 'Charge checks';
export const SETTINGS_TAB_LABEL = 'Settings';

export const COSTS_INTRO =
  'Charged AI cost: what Business OS actions cost us (USD, priced from the model price table) and what we charged ' +
  '(credits), per account and billing period. Read from the credit ledger; nothing here changes it. ' +
  'Monthly totals are on Finance.';

export const COSTS_EMPTY = 'No charges recorded in this window';

export const COSTS_EMPTY_HINT =
  'Charges appear here once Business OS AI actions run after charging went live.';

export const COSTS_INCOMPLETE =
  'Incomplete — a read stopped at its limit, so some figures below are lower bounds and the ' +
  'period check is skipped. Narrow the window or choose one account.';

export const COSTS_PERIOD_RULE = (lookbackDays: number) =>
  `Whole billing periods are shown: every period that started on or before the window’s last day ` +
  `and at most ${lookbackDays} days before its first day. A period’s figures never depend on the window edge.`;

/**
 * Money MK-2 (SA-1): the period table is whole billing periods and no longer
 * feeds the cost tile; it says so in these words (§2 "Approved fix").
 */
export const COSTS_WHOLE_PERIODS_LABEL = 'Whole billing periods: can include charges from before the window';

/** The cost tile's own block: charges created in the window, Finance's computation. */
export const CHARGED_IN_WINDOW_TITLE = 'Charged AI cost in this window';
export const CHARGED_IN_WINDOW_NOTE =
  'Charges created in the window, deleted accounts included: the same figure Finance shows for the same window. ' +
  'The billing periods below are whole periods, so their totals can differ.';
export const CHARGED_DELETED_NONE = 'No charges from deleted accounts';
export const chargedDeletedLine = (costUsd: string, rows: number) =>
  `Deleted accounts: ${costUsd} (${rows} ledger ${rows === 1 ? 'row' : 'rows'})`;
export const CHARGED_READ_FAILED = 'The charged AI cost for this window could not be read. The other sections are unaffected.';

export const NET_INCLUDING_CORRECTIONS = 'net, including corrections';

export const BREAKDOWN_NOTE =
  'Each correction is counted under the charge it corrects, so these lines are net figures and ' +
  'the trigger lines are not the stored owner / scheduled / external split above.';

export const SPREAD_NOTE = (fewBelow: number) =>
  `p50 and p90 over succeeded charges only; failed charges are counted beside them, and ` +
  `fallback-priced charges are left out. Below ${fewBelow} examples the figures are marked “few examples”.`;

export const FALLBACK_NOTE =
  'Charged from a fallback price because the model had no price in the price table: a deliberate ' +
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

// ── Admin Layout Standard L-9a ──────────────────────────────────────────

/** The noun phrase for "Refresh …" and the loading state (D-15): "Reading the cost report…". */
export const COSTS_WHAT = 'the cost report';

/** A failed read with no reason of the route's own (the shared sentence shape, §5.10). */
export const COSTS_ERROR_FALLBACK = 'Could not read the cost report. Try again in a moment.';

/**
 * SA M-2: the report and the leak check both refuse a platform account (409
 * `platform_account`). One sentence for both reads; it does not point at the
 * leak check below, which follows the picked business and refuses it too.
 */
export const COSTS_PLATFORM_ACCOUNT =
  'That is a platform account, not a business, so it has no charges here. ' +
  'Clear the business to see every business; a leak check over every business counts platform AI calls.';

// The KPI strip (§2.5, K-1 to K-10).
export const KPI_CREDITS = 'Credits charged';
export const KPI_COST_USD = 'Charged AI cost (USD)';
export const KPI_CHARGES = 'Charges';
export const KPI_FALLBACK = 'Fallback-priced';
export const KPI_PERIODS = 'Periods not matching';
export const KPI_UNKNOWN = 'Unknown';
export const KPI_NOT_CHECKED = 'Not checked';
/** K-8: a read stopped at its ceiling, so the figure is a lower bound. */
export const KPI_MAY_BE_INCOMPLETE = 'may be incomplete';
export const KPI_RECONCILED = (count: string) => `${count} reconciled`;
/** MK-2: a ceiling or an unreadable amount, so the window figure is a lower bound (Finance's rule). */
export const KPI_AT_LEAST = 'at least';
/** MK-2 (D-1): the two tiles still read from the stored period totals say so. */
export const KPI_WHOLE_PERIODS = 'whole billing periods';
export const KPI_OF_CHECKED = (count: string) => `of ${count} checked`;
