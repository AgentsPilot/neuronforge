/**
 * The words of the cost report (credit deduction slice 4a), in one place so
 * the render tests assert the same strings the screen shows. Money M-5 moved
 * the report from the Business OS AI "Costs & credits" tab to its own page,
 * Charge checks (`/admin/finance/charges`); the tab label became the page's h1
 * (S-6), renamed rather than removed (SA-W4). Money MK-3 merged Charge checks
 * into the AI cost page (`/admin/ai-cost`, its Summary & checks tab); the
 * page's own words (title, purpose, legend) are in `app/admin/ai-cost/aiCostCopy.ts`,
 * and the strip's words, with one definition per KPI (LL-4), are here.
 */

export const SETTINGS_TAB_LABEL = 'Settings';

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

// The KPI strip of the AI cost page, A-K1 to A-K5 (Money MK-3, KPI restructure review §4.1 and §5).
// Labels name no currency code: every amount shows as `$` (USD-1). "Credits charged" and "Charges"
// left the strip (§6 item 23); they are figures of the charged block, for the window.
export const KPI_CHARGED = 'Charged AI cost';
export const KPI_RECORDED = 'Recorded AI cost';
/** A-K2 is always the Business OS scope, whatever the Calls tab shows. */
export const KPI_RECORDED_SCOPE = 'Business OS calls';
export const KPI_ABOVE = 'Recorded above charged';
export const KPI_PERIODS = 'Billing periods not matching';
export const KPI_FALLBACK = 'Fallback-priced charges';
/** A-K3 before the cut-over (Finance's words, R4-5). */
export const KPI_ABOVE_NOT_AVAILABLE = 'Not available';
export const KPI_ABOVE_NOT_AVAILABLE_SUB = 'AI charging began 29 Sep 2026';
export const KPI_ABOVE_NONE = 'None';
/** R4-6: charged is above recorded, so there is no difference to show; `usd` is already formatted. */
export const chargedAboveLine = (usd: string) => `Charged is ${usd} above recorded (fallback prices or corrections)`;

/**
 * LL-4: one definition per KPI, the tooltip's first line (§5 "Definition in
 * plain words"). A-K1 says in one line why it can read "at least" where
 * Finance's tile reads Unknown (SA-CR-MK2 Q-R1).
 */
export const AI_COST_KPI_DEFINITIONS = {
  charged:
    "What Business OS AI actions cost us that we charged credits for, in this window. Equal to Finance's Charged AI cost for the same window. If an amount cannot be read this shows 'at least'; Finance's tile shows Unknown, because it compares months.",
  recorded:
    'Every Business OS AI call the usage log recorded in this window, charged or not, priced from the model price table.',
  above: 'Recorded AI cost minus Charged AI cost for the same window. Recorded AI cost we did not charge is a leak before it is a loss.',
  periods:
    'Billing periods whose stored total disagrees with the sum of their rows. A ledger error shows here before a customer sees a wrong balance.',
  fallback: 'Charges priced from a fallback because the model had no price in the price table.',
} as const;

export const KPI_UNKNOWN = 'Unknown';
export const KPI_NOT_CHECKED = 'Not checked';
/** K-8: a read stopped at its ceiling, so the figure is a lower bound. */
export const KPI_MAY_BE_INCOMPLETE = 'may be incomplete';
export const KPI_RECONCILED = (count: string) => `${count} reconciled`;
/** MK-2: a ceiling or an unreadable amount, so the window figure is a lower bound (Finance's rule). */
export const KPI_AT_LEAST = 'at least';
export const KPI_OF_CHECKED = (count: string) => `of ${count} checked`;

// ── Money MK-3 (C-7): the recorded AI cost block, moved here from Finance ──
// Two measures BESIDE each other, never added (BD-18). The words are Finance's M-4 words, unchanged
// (§11F.5, R4-4, R4-10), now shown on the AI cost page. The value words of "Recorded above charged"
// are the strip's (`KPI_ABOVE_*` above); Finance keeps its own for its one remaining line.
export const RECORDED_BLOCK_TITLE = 'Recorded AI cost beside the charged cost';
export const RECORDED_CAPTION = 'Beside the charged cost, never added';
export const RECORDED_LABEL = 'Recorded AI cost';
export const RECORDED_SOURCE = 'Usage log: every Business OS AI call, charged or not, priced from the model price table';
export const ABOVE_LABEL = 'Recorded above charged';
export const ABOVE_SOURCE = 'Recorded AI cost minus charged AI cost, for the same window. Which calls: run the Leak check below.';
/** R4-9: one notice for a failed read and a passed deadline. */
export const RECORDED_NOTICE = 'The recorded AI cost could not be read in time. The charged figures above are unaffected.';
/** R4-4: with no business picked only. */
export const RECORDED_DELETED_NOTE = 'Deleted accounts are left out: their recorded calls are deleted with the account.';
/** R4-10 (with E-54's closing sentence): the stated distortions, one sentence each. */
export const RECORDED_DISTORTIONS: readonly string[] = [
  'Fallback-priced charges are above their recorded cost, so the difference can be lower than the true uncharged cost.',
  'A call and its charge can fall either side of a window edge: a charge is written when its action ends, up to 5 minutes later.',
  'A failed provider call is recorded at $0 in both.',
  'By design, Recorded above charged includes chat turns outside the call catalog, platform-account calls and cache-served turns at $0.',
  "Recorded above charged is not 'not charged' call by call; the Leak check matches calls.",
];
