/**
 * Every user-facing string of the admin finance page (slices 1a, 1b, 1c, 2a, 2b and 4a). The
 * render test asserts against these constants, so a wording change is one edit.
 *
 * Slice 1c (BD-14, S1C-FR-7): our revenue counts test and real payments together, with
 * no mode wording anywhere on the page; a tier group names its Founding Partners (BD-15).
 *
 * Tile states use the shared admin tile's status words (Finance F-5; equal to
 * Health's, as SA-W7 required); the headline under each carries the
 * finance-specific reason.
 */

import type { FinanceGroupKey, FinanceTriggerKey } from '@/lib/business-os/finance/financeTypes';

// Finance F-2 (user decision 2026-10-15): the h1 equals the sidebar label (Admin Layout Standard §5.3).
export const PAGE_TITLE = 'Finance';
export const PAGE_PURPOSE =
  'How is Business OS doing this month: accounts, AI cost, credits, and what clients paid the businesses through the platform.';

/**
 * Money M-1 (SA-W70 b): the picker's standing note, now a page-owned help line
 * under the bar, wired to the shared picker through `describedBy`. The sentence
 * the deleted original picker carried, unchanged.
 */
export const FILTER_BUSINESS_HELP =
  'Only accounts with a business profile can be found by name. Paste a full account id to filter by any other account.';
// Finance F-2 (SA F2-R2): the standard's word (§5.10), so the page error and every section's own button say the same.
export const RETRY = 'Try again';
/** Finance F-2: the Accounts tab's waiting state reads "Reading the accounts…" (shared `AdminLoading`). */
export const ACCOUNTS_WHAT = 'the accounts';

export const TILE_LABELS = {
  k1: 'Charged AI cost this month',
  k1Sub: 'This month vs last month, UTC',
  k2: 'Accounts far over allowance',
  k3: 'Founding Partners with no end date',
  k4: 'Gifted credits outstanding',
  k4Sub: 'Credits, now',
  k5: 'Our revenue',
  /** K-5's caption (S4-FR-7); the window is appended. */
  k5Sub: 'Credit boosts and plans',
} as const;
/** K-2's subtitle: the line comes from the payload (data, SA-W10), never typed here. */
export function k2Subtitle(percent: number | null): string {
  return percent === null ? 'Line not set' : `At or over ${percent}% of this period's allowance`;
}
export const TILE_PREVIOUS = 'Same days last month:';
/**
 * Finance F-5 (SA-W4): K-1's sub-line. The same-days-last-month figure, when
 * there is one, joins the caption, so the tile keeps one sub-line and its
 * headline is the shared tile's second line.
 */
export function k1SubLine(previous: string | null): string {
  return previous === null ? TILE_LABELS.k1Sub : `${TILE_LABELS.k1Sub} · ${TILE_PREVIOUS} ${previous}`;
}
export const AT_LEAST = 'At least';

export const SECTION_COULD_NOT_LOAD = 'Could not load this section';
export const SECTION_PARTIAL = 'At least';
export const SECTION_OK = 'Loaded';

// ── Our revenue (slice 4a, S4-FR-1 to S4-FR-13; slice 5a, M2-FR-1 to M2-FR-13) ──
// Our own money: plan payments received and credit boosts paid in the window,
// per currency, never a total across currencies. No mode wording.
export const REVENUE_TITLE = 'Our revenue';
export const REVENUE_SUBTITLE_ALL = (windowLabel: string) => `Plan payments and credit boosts received, all businesses · ${windowLabel}`;
export const REVENUE_SUBTITLE_ONE = (windowLabel: string) => `Plan payments and credit boosts received, this business · ${windowLabel}`;
/** K-5's caption with the window (SA-Q25: K-5 follows the filter window). */
export const k5Caption = (windowLabel: string) => `${TILE_LABELS.k5Sub} · ${windowLabel}`;
/** S4-FR-7: K-5 with several currencies, never a sum. */
export const k5SeveralCurrencies = (count: number) => `${count} currencies, see Our revenue`;
export const K5_UNKNOWN = 'Unknown';

// ── Plans received (slice 5a, M2-FR-1 to M2-FR-4, M2-FR-8). Received is what
// Stripe recorded as paid: tax included, Stripe fees not deducted, before any
// refund (plan refunds are not recorded yet). Never a "0.00" for an empty window.
export const REVENUE_PLANS_HEADING = 'Plans';
export const REVENUE_BOOSTS_HEADING = 'Credit boosts';
export const REVENUE_PLANS_FAILED = 'Could not load';
export const REVENUE_PLANS_EMPTY = 'No plan payments received in this window';
/** M2-W-6: always shown with the plans part. */
export const REVENUE_PLANS_REFUNDS_NOTE = 'Plan refunds and disputes are not recorded yet';
/** M2-W-5, SA-Q39: zero-amount invoices are not payments; said in a note. */
export const REVENUE_PLANS_ZERO_NOTE = (count: number) =>
  `${count} paid ${count === 1 ? 'invoice' : 'invoices'} had nothing to charge`;
export const REVENUE_PLANS_PER_CURRENCY = 'Plan payments per currency';
export const REVENUE_PLANS_PAYMENTS = 'Payments';
/** M2-W-3: what received is, and what it is not. */
export const REVENUE_PLANS_RECEIVED = 'Received (Stripe fees not deducted; includes any tax; before any refund)';
export const REVENUE_PLANS_RECEIVED_SHORT = 'Received';
export const REVENUE_PLANS_BUSINESSES = 'Businesses that paid';
export const REVENUE_PLANS_BY_BUSINESS = 'Plan payments by business';
export const REVENUE_PLANS_BUSINESS = 'Business';
export const REVENUE_PLANS_NOT_LISTED = (count: number) =>
  `${count} more ${count === 1 ? 'business' : 'businesses'} not listed`;
export const REVENUE_PLANS_DELETED_NONE = 'No plan payments from deleted accounts';
export const revenuePlansDeletedLine = (payments: number, received: string) =>
  `Deleted accounts: ${payments} ${payments === 1 ? 'payment' : 'payments'}, received ${received}`;
export const REVENUE_PLANS_LIST = 'Plan payments of this business';
export const REVENUE_PLANS_PAID_AT = 'Paid at';
export const REVENUE_PLANS_PLAN = 'Plan';
export const REVENUE_PLANS_PERIOD = 'Period';
export const REVENUE_PLANS_UNKNOWN_PLAN = 'Unknown plan';
/** SA-W64: a period that was not stored says so, never a dash. */
export const REVENUE_PLANS_PERIOD_NOT_RECORDED = 'Not recorded';
export const revenuePlansPeriod = (from: string, to: string) => `${from} to ${to}`;
export const REVENUE_PLANS_PAYMENTS_NOT_LISTED = (count: number) =>
  `${count} more ${count === 1 ? 'payment' : 'payments'} not listed`;
export const REVENUE_PLANS_NOTICE_CUT =
  'The plan payments were read only up to their limit: payments, received and tax are "at least".';
export const REVENUE_PLANS_NOTICE_UNREADABLE = (count: number) =>
  `${count} paid ${count === 1 ? 'invoice has an amount' : 'invoices have amounts'} that could not be read: left out of the sums, that line is "at least".`;
export const REVENUE_PLANS_OTHER_KIND = (count: number) =>
  `${count} ${count === 1 ? 'row' : 'rows'} of another kind not counted`;

export const REVENUE_BOOSTS = 'Credit boosts per currency';
export const REVENUE_BY_PACKAGE = 'Credit boosts by package';
export const REVENUE_CURRENCY = 'Currency';
export const REVENUE_PACKAGE = 'Package';
export const REVENUE_PURCHASES = 'Purchases';
export const REVENUE_GROSS = 'Gross charged';
export const REVENUE_TAX = 'Of which tax';
export const REVENUE_REFUNDED = 'Refunded';
export const REVENUE_HELD = 'Held in open disputes';
export const REVENUE_LOST = 'Lost in disputes';
/** S4-W-6: what net is, and what it is not. */
export const REVENUE_NET = 'Net of refunds and disputes (Stripe fees not deducted; includes any tax)';
export const REVENUE_NET_SHORT = 'Net';
export const REVENUE_CREDITS_SOLD = 'Credits sold';
export const REVENUE_PACKAGE_NOT_RECORDED = 'Not recorded';
export const revenuePackageLabel = (packageId: string, version: number) => `${packageId} v${version}`;
export const REVENUE_NO_BOOSTS = 'No credit boosts paid in this window';
export const REVENUE_BOOSTS_FAILED = 'Could not load';
export const REVENUE_UNKNOWN = 'Unknown';
export const REVENUE_CUT_OFF = 'Unknown (a read was cut off)';
export const REVENUE_EXCLUDES_UNREADABLE = (count: number) => `excludes ${count} unreadable`;
export const REVENUE_DELETED_NONE = 'No purchases from deleted accounts';
export const revenueDeletedLine = (purchases: number, net: string) =>
  `Deleted accounts: ${purchases} ${purchases === 1 ? 'purchase' : 'purchases'}, net ${net}`;
export const REVENUE_OTHER_STATUS = (count: number) =>
  `${count} ${count === 1 ? 'purchase' : 'purchases'} with another status not counted`;
export const REVENUE_NOTICE_CUT =
  'The boost purchases were read only up to their limit: counts and amounts are "at least", and net and the dispute amounts are unknown.';
export const REVENUE_NOTICE_UNREADABLE = (count: number) =>
  `${count} ${count === 1 ? 'purchase has an amount' : 'purchases have amounts'} that could not be read: left out of the sums, net unknown on that line.`;
export const REVENUE_NOTICE_UNREADABLE_CREDITS = (count: number) =>
  `${count} ${count === 1 ? 'purchase has credits' : 'purchases have credits'} that could not be read: credits sold is "at least".`;
/**
 * DF-5 / S4-W-3 (SA-W53): the ONE sentence about when a refund or dispute
 * counts. Shown only by the revenue panel, whenever a refund or dispute amount
 * is non-zero. Pinned by the finance source guard (SA-WR-35).
 */
export const REVENUE_REFUND_TIMING_NOTE =
  'Refunds and disputes are counted in the month of the purchase, as recorded today, so a past month can still change.';
export const REVENUE_CANNOT_TITLE = 'Not shown here';
/** M2-FR-13: what this section cannot produce yet. */
export const REVENUE_CANNOT: readonly string[] = [
  'MRR and active subscriptions (a later update)',
  'Plan refunds and disputes (not recorded yet)',
  'Real Stripe fees (none are recorded for our payments yet)',
  'The date of a refund or dispute',
  'One total across currencies',
];

export const ACCOUNTS_TITLE = 'Accounts by plan';
export const ACCOUNTS_SUBTITLE_ALL = 'Business OS plan rows, all businesses, now';
export const ACCOUNTS_SUBTITLE_ONE = 'Business OS plan row, this business, now';
export const ACCOUNTS_TOTAL = 'Total';
export const ACCOUNTS_GROUP = 'Group';
export const ACCOUNTS_COUNT = 'Accounts';
export const ACCOUNTS_GRACE = 'In grace';
export const ACCOUNTS_PAST_DUE = 'Past due';
export const ACCOUNTS_BY_STATE = 'By lifecycle state';
export const ACCOUNTS_NO_END_DATE = 'Founding Partners with no end date';
export const ACCOUNTS_DORMANT = 'Dormant Founding Partners (no business built)';
export const ACCOUNTS_NEW = 'New in the window';
export const ACCOUNTS_ENDING = 'Ending in the next 30 days';
/** BD-15, SA-Q24: the note on a tier group row that holds paying Founding Partners (all businesses). */
export function accountsFoundingNote(count: number): string {
  return count === 1 ? 'including 1 Founding Partner' : `including ${count} Founding Partners`;
}
/** BD-15, SA-Q24: the neutral chip on the picked business's tier group row. */
export const ACCOUNTS_FOUNDING_CHIP = 'Founding Partner';
/**
 * Notes shown beside a plan row's `origin`, keyed by the stored value. A
 * backfilled row's created_at is the backfill date, not a signup.
 */
export const ORIGIN_NOTES: Readonly<Record<string, string>> = { backfill: 'backfilled' };
export const ACCOUNTS_NO_PLAN_ROW_LINK = 'Businesses without a plan row: see Plans & entitlements';
export const PLANS_PAGE = '/admin/business-os-tiers';

export const GROUP_LABELS: Record<Exclude<FinanceGroupKey, `tier:${string}`>, string> = {
  trial: 'Trial',
  founding_partner: 'Founding Partner',
  comped: 'Comped',
  unknown_held: 'Unknown/held',
  tier_set: 'Tier set (paying vs comped not available)',
};
export const DELETED_GROUP = 'Deleted accounts';

export const AI_TITLE = 'Charged AI cost in the window';
export const AI_SOURCE =
  'Credit ledger: what Business OS actions were charged for, with corrections, from 29 Sep 2026. AI calls that were never charged are not in it.';
export const AI_TOTAL = 'Charged AI cost (USD)';
export const AI_CREDITS = 'Credits charged';
export const AI_ACTIONS = 'Charged actions';
export const AI_BY_TRIGGER = 'By trigger';
export const AI_BY_GROUP = 'By current plan group';
export const AI_BY_GROUP_NOTE = 'By the plan each account is on now, not the plan it was on when charged.';
export const AI_BY_GROUP_PARTIAL = 'At least: the plan rows were read only up to their limit, so some accounts may sit in the wrong group.';
export const AI_BY_GROUP_UNKNOWN = 'Unknown: the plan rows could not be read.';
export const AI_TOP = 'Top 10 businesses by charged AI cost';
export const AI_BUSINESS = 'Business';
export const AI_COST = 'Cost (USD)';
export const AI_DELETED = 'Deleted accounts';
export const AI_NO_ROWS = 'No AI actions charged in this window';
export const AI_LINK = 'AI calls & usage';
export const AI_LINK_NOTE = 'Every recorded AI call, charged or not:';
export const AI_UNRESOLVED = 'corrections whose charge could not be found';
export const AI_UNREADABLE = 'amounts could not be read and count as 0';

// ── Money M-4 (OV-5, §11F.5, §11F.6): the recorded AI cost beside the charged one ──
// Two measures, never added (BD-18). "Recorded above charged" is a difference of the two, named
// as one (E-54); the Leak check keeps its own per-call "Recorded, not charged". The server
// decides every value and state (M4-FR-11); the page only formats.
export const RECORDED_CAPTION = 'Beside the charged cost, never added';
export const RECORDED_LABEL = 'Recorded AI cost (USD)';
export const RECORDED_SOURCE = 'Usage log: every Business OS AI call, charged or not, priced from the model price table';
export const ABOVE_LABEL = 'Recorded above charged (USD)';
export const ABOVE_SOURCE = 'Recorded AI cost minus charged AI cost, for the same window. Which calls: run the';
export const ABOVE_LEAK_LINK = 'Leak check';
export const ABOVE_NONE = 'None';
/** R4-6: charged is above recorded; `usd` is already formatted ("USD 0.33"). */
export const aboveChargedAboveLine = (usd: string) => `Charged is ${usd} above recorded (fallback prices or corrections)`;
export const ABOVE_NOT_AVAILABLE = 'Not available: AI charging began 29 Sep 2026';
export const RECORDED_UNKNOWN = 'Unknown';
/** R4-9: one notice for a failed read and a passed deadline (the log tells them apart, SA-W101). */
export const RECORDED_NOTICE = 'The recorded AI cost could not be read in time. The charged figures above are unaffected.';
/** Fix round 1 (SA low follow-up): the same notice when no charged figure is shown above it. */
export const RECORDED_NOTICE_PLAIN = 'The recorded AI cost could not be read in time.';
/** R4-4: with no business picked only. */
export const RECORDED_DELETED_NOTE = 'Deleted accounts are left out: their recorded calls are deleted with the account.';
/** R4-10 (with E-54's closing sentence): the stated distortions, one sentence each. */
export const RECORDED_DISTORTIONS: readonly string[] = [
  'Fallback-priced charges are above their recorded cost, so the difference can be lower than the true uncharged cost.',
  'A call and its charge can fall either side of a window edge: a charge is written when its action ends, up to 5 minutes later.',
  'A failed provider call is recorded at USD 0 in both.',
  'By design, Recorded above charged includes chat turns outside the call catalog, platform-account calls and cache-served turns at USD 0.',
  "Recorded above charged is not 'not charged' call by call; the Leak check matches calls.",
];
/** M4-FR-2: the account summary's line, the same value as Section 3's (AC-158). */
export const ACCOUNT_RECORDED_ABOVE = 'Recorded above charged';

export const NAME_PLATFORM = 'Platform account';
export const NAME_MISSING = 'No business name';
export const NAME_UNAVAILABLE = 'Name unavailable';

export const TRIGGER_LABELS: Record<FinanceTriggerKey, string> = {
  owner: 'Owner',
  scheduled: 'Scheduled',
  external: 'External',
  unattributed: 'Unattributed',
};

// ── Section 4, credits (slice 1b) ───────────────────────────────────────────
export const CREDITS_TITLE = 'Credits';
export const CREDITS_SOURCE = 'Credit totals and admin grants; credit period per account; grants in the window, UTC';
export const CREDITS_OVER = 'Accounts over allowance';
export const CREDITS_FAR_OVER = 'At or over the far line';
export const CREDITS_GIFTED = 'Gifted credits outstanding';
export const CREDITS_GRANTED = 'Granted in the window';
export const CREDITS_TAKEN_BACK = 'Taken back in the window';
export const CREDITS_GRANTING_ADMINS = 'admins granted';
export const CREDITS_GRANTS = 'grants';
export const CREDITS_BUSINESS = 'Business';
export const CREDITS_PLAN = 'Plan group';
export const CREDITS_ALLOWANCE = 'Allowance';
export const CREDITS_USED = 'Used';
export const CREDITS_USED_PERCENT = '% used';
export const CREDITS_OVER_COLUMN = 'Over allowance';
export const CREDITS_GIFTED_COLUMN = 'Gifted outstanding';
export const CREDITS_TRIAL = 'trial';
export const CREDITS_YES = 'Yes';
export const CREDITS_NO = 'No';
export const CREDITS_UNKNOWN = 'Unknown';
export const CREDITS_NO_ALLOWANCE = 'No allowance';
export const CREDITS_LESS_THAN_TENTH = '<0.1%';
export const CREDITS_NO_ACCOUNTS = 'No accounts to show';
export const CREDITS_SHOWING = (shown: number, total: number) => `Showing ${shown} of ${total}`;
export const CREDITS_UNKNOWN_NOTE = (count: number) =>
  `${count} ${count === 1 ? 'account' : 'accounts'} could not be read; the counts leave them out.`;
/** §8.4: until credit deduction draws from lots, "outstanding" is what remains available, not "unused". */
export const CREDITS_GIFTED_NOTE =
  'Gifted credits are not drawn down by usage yet: outstanding means granted, not taken back and not expired.';
export const CREDITS_DELETED_NOTE = (credits: string) => `${credits} credits on deleted accounts, not counted.`;
export const CREDITS_NOT_LISTED_NOTE = (count: number) =>
  `${count} ${count === 1 ? 'account holds' : 'accounts hold'} gifted credits but has no plan row; included in the total.`;
export const CREDITS_INCONSISTENT_NOTE = (count: number) =>
  `${count} ${count === 1 ? 'account has' : 'accounts have'} a lot that gave back more than it granted (shown as 0).`;
export const CREDITS_GIFTED_UNKNOWN = 'Gifted credits could not be read.';

// ── Section 2 block B, takings through the platform (slice 2a) ─────────────
// The businesses' client payments: NOT our revenue (BD-1). No test-mode
// wording anywhere (BD-13): test and real client payments are shown together.
export const TAKINGS_TITLE = 'Takings through the platform';
export const TAKINGS_CHIP = 'Not our revenue';
export const TAKINGS_SUBTITLE = (windowLabel: string) =>
  `Client payments recorded by the businesses · ${windowLabel} · Covers businesses that still exist`;
export const TAKINGS_PER_CURRENCY = 'Takings per currency';
export const TAKINGS_CURRENCY = 'Currency';
export const TAKINGS_PAYMENTS = 'Payments';
export const TAKINGS_GROSS = 'Gross';
export const TAKINGS_REFUNDED = 'Refunded';
export const TAKINGS_NET = 'Net of refunds (fees not deducted)';
export const TAKINGS_NET_SHORT = 'Net of refunds';
export const TAKINGS_BUSINESSES_COLUMN = 'Businesses';
export const TAKINGS_UNKNOWN_CURRENCY = 'Unknown currency';
export const TAKINGS_UNKNOWN = 'Unknown';
/** Net when a read stopped at its limit: a lower bound minus a figure is not a bound (S2-FR-8). */
export const TAKINGS_NET_CUT_OFF = 'Unknown (a read was cut off)';
export const TAKINGS_EXCLUDES_UNREADABLE = (count: number) => `excludes ${count} unreadable`;
export const TAKINGS_NO_PAYMENTS = 'No client payments recorded in this window';
export const TAKINGS_OTHER_STATUS = (count: number) =>
  `${count} ${count === 1 ? 'payment' : 'payments'} with another status not counted`;

export const TAKINGS_REFUNDS = 'Refunds';
export const TAKINGS_REFUNDS_COUNT = 'Refunds';
export const TAKINGS_AMOUNT_REFUNDED = 'Amount refunded';
export const TAKINGS_NO_REFUNDS = 'No refunds in this window';
export const TAKINGS_REFUNDS_NOT_COMPLETED = (count: number) =>
  `${count} ${count === 1 ? 'refund' : 'refunds'} not completed; ${count === 1 ? 'its amount is' : 'their amounts are'} not counted`;
export const TAKINGS_REFUND_NOTE = 'A refund counts in the month it was made, which may differ from the month of its payment.';
export const TAKINGS_REFUNDS_FAILED = 'Refunds could not be read';

export const TAKINGS_FEES = 'Recorded processor fees';
export const TAKINGS_FEE_CURRENCY = 'Fee currency';
export const TAKINGS_FEES_COLUMN = 'Fees';
export const TAKINGS_FEES_RECORDED_ON = (recorded: number, of: number) => `Fees recorded on ${recorded} of ${of} payments in this window`;
export const TAKINGS_FEE_NOTE = 'A fee can be charged in another currency than its payment, so fees are never deducted from takings.';
export const TAKINGS_NO_FEES = 'No processor fees recorded in this window';

export const TAKINGS_PROCESSORS = 'Payments by processor';
export const TAKINGS_PROCESSOR = 'Processor';
/** SA-W21: labels by the stored value (trimmed, lower-cased). Any other value is shown as stored. */
export const PROCESSOR_LABELS: Readonly<Record<string, string>> = {
  stripe: 'Stripe',
  manual: 'Manual: recorded by the business; no processor fee',
};
export const PROCESSOR_NOT_RECORDED = 'Not recorded';

export const TAKINGS_BUSINESSES = 'Businesses with takings';
export const TAKINGS_BY_BUSINESS = 'Takings by business';
export const TAKINGS_BUSINESS = 'Business';
export const NAME_UNKNOWN_BUSINESS = 'Unknown business';
export const TAKINGS_SHOWING = (shown: number, total: number) => `Showing ${shown} of ${total}`;

export const TAKINGS_CANNOT_TITLE = 'Not shown here';
export const TAKINGS_CANNOT: readonly string[] = [
  'Failed client payments: not stored; shown in a later update',
  'Refund fees: not recorded',
  'Net after fees: a fee can be in another currency than its payment',
  'One total across currencies: currencies are never added together',
];

export const TAKINGS_NOTICE_PAYMENTS_CUT =
  'The client payments were read only up to their limit: payments, gross and businesses are "at least", and net is unknown.';
export const TAKINGS_NOTICE_REFUNDS_CUT = 'The refunds were read only up to their limit: refunded is "at least", and net is unknown.';
export const TAKINGS_NOTICE_UNREADABLE = (count: number) =>
  `${count} ${count === 1 ? 'amount' : 'amounts'} could not be read and ${count === 1 ? 'is' : 'are'} not counted; net is unknown where ${count === 1 ? 'it' : 'they'} fell.`;
export const TAKINGS_NOTICE_UNREADABLE_FEES = (count: number) =>
  `${count} recorded ${count === 1 ? 'fee' : 'fees'} could not be read and ${count === 1 ? 'is' : 'are'} not counted in the fee lines.`;

// ── Section 6 block B, client payment problems (slice 2b) ──────────────────
// Where the businesses' clients are not paying: the businesses' problem, not
// ours (BD-2). No test-mode wording (BD-13). Every amount is the FULL invoice
// or instalment amount, never what is still owed (S2-F7).
export const PROBLEMS_TITLE = 'Client payment problems';
export const PROBLEMS_CHIP = "The businesses' problem, not ours";
export const PROBLEMS_SUBTITLE = (today: string, windowLabel: string) =>
  `Problems with clients paying the businesses · As of now, UTC (${today}); plans cancelled or completed: ${windowLabel} · Covers businesses that still exist`;

/** A part's own status, in words (SA-W31): the block frame is never "Could not load". */
export const PART_OK = 'OK';
export const PART_PARTIAL = 'Partial';
export const PART_COULD_NOT_LOAD = 'Could not load this part';
export const PROBLEMS_UNKNOWN = 'Unknown';
export const PROBLEMS_UNKNOWN_CURRENCY = 'Unknown currency';

export const PROBLEMS_FAILED_TITLE = 'Failed client payments';
export const PROBLEMS_FAILED_NOT_STORED =
  'Not available: a failed client payment is not stored anywhere, so it cannot be counted here.';
export const PROBLEMS_FAILED_PLAN_CHARGES = 'Failed client plan charges';
export const PROBLEMS_FAILED_NOT_RECORDED = 'Not recorded: no failure has ever been stored';
/** QA-1: the read stopped at its limit or was partial, so "never" cannot be claimed. */
export const PROBLEMS_FAILED_NONE_IN_READ = 'No failure found in the rows read (not every plan was read)';
export const PROBLEMS_FAILED_IN_WINDOW = (count: string) => `${count} with a failure time in this window`;
export const PROBLEMS_FAILED_COULD_NOT_CHECK = 'Could not check';
export const PROBLEMS_INSTALMENT_RETRIES = 'Instalment retries: not recorded (no retry time is stored)';

export interface OverdueCopy {
  title: string;
  perCurrency: string;
  pastDueColumn: string;
  amountColumn: string;
  idColumn: string;
  oldest: string;
  pastDueChip: string;
  empty: string;
  amountNote: string;
  ceilingNotice: string;
}

export const PROBLEMS_INVOICES: OverdueCopy = {
  title: 'Overdue invoices',
  perCurrency: 'Overdue invoices per currency',
  pastDueColumn: 'Past due date, not marked',
  amountColumn: 'Invoice amount',
  idColumn: 'Invoice',
  oldest: 'Oldest overdue invoices',
  pastDueChip: 'Past due, not marked',
  empty: 'No overdue invoices',
  amountNote: 'This is the full amount of each invoice, not the amount still owed: part payments and refunds are not deducted.',
  ceilingNotice: 'The overdue invoices were read only up to their limit: every count and amount is "at least".',
};

export const PROBLEMS_INSTALMENTS: OverdueCopy = {
  title: 'Overdue instalments',
  perCurrency: 'Overdue instalments per currency',
  pastDueColumn: 'Past due date, still pending',
  amountColumn: 'Instalment amount',
  idColumn: 'Instalment',
  oldest: 'Oldest overdue instalments',
  pastDueChip: 'Past due, still pending',
  empty: 'No overdue instalments',
  amountNote: 'This is the full amount of each instalment, not the amount still owed: part payments are not deducted.',
  ceilingNotice: 'The overdue instalments were read only up to their limit: every count and amount is "at least".',
};

export const OVERDUE_CURRENCY = 'Currency';
export const OVERDUE_MARKED = 'Marked overdue';
export const OVERDUE_BUSINESSES = 'Businesses';
export const OVERDUE_OLDEST_DUE = 'Oldest due date (UTC)';
export const OVERDUE_BUSINESS = 'Business';
export const OVERDUE_DUE_DATE = 'Due date (UTC)';
export const OVERDUE_DAYS = 'Days past due';
export const OVERDUE_AMOUNT = 'Amount';
export const OVERDUE_STATUS = 'Status';
export const OVERDUE_MARKED_CHIP = 'Overdue';
export const OVERDUE_SHOWING = (shown: number, total: number) => `Showing ${shown} of ${total}`;
export const OVERDUE_AMONG_READ = 'Lists the oldest among the rows read';
export const OVERDUE_TOTAL = (count: string, businesses: string) => `${count} overdue in total, at ${businesses} businesses`;
export const OVERDUE_UNREADABLE = (count: number) =>
  `${count} ${count === 1 ? 'amount' : 'amounts'} could not be read and ${count === 1 ? 'is' : 'are'} not counted; that line's amount is "at least".`;
export const OVERDUE_EXCLUDES_UNREADABLE = (count: number) => `excludes ${count} unreadable`;

export const PROBLEMS_PLANS_TITLE = 'Client plans';
export const PLANS_BY_STATUS = 'Client plans by status';
export const PLANS_STATUS = 'Status';
export const PLANS_COUNT = 'Plans';
/** By the stored status (S2-FR-19). Any other value is shown as stored and marked unrecognised. */
export const PLAN_STATUS_LABELS: Readonly<Record<string, string>> = {
  pending: 'Pending',
  active: 'Active',
  past_due: 'Past due',
  paused: 'Paused',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
export const PLAN_STATUS_NONE = '(none)';
export const PLAN_STATUS_UNRECOGNISED = 'unrecognised';
export const PLANS_ACTIVE_NOW = 'Active now';
export const PLANS_CANCELLED = 'Cancelled in this window';
export const PLANS_COMPLETED = 'Completed in this window';
export const PLANS_NEXT_CHARGE_OVERDUE = 'Next charge overdue';
export const PLANS_EMPTY = 'No client payment plans';
export const PLANS_CEILING_NOTICE = 'The client plans were read only up to their limit: every count is "at least".';
export const PLANS_UNREADABLE_TIMES = (count: number) =>
  `${count} stored ${count === 1 ? 'time' : 'times'} could not be read and ${count === 1 ? 'is' : 'are'} left out of the counts.`;

export const PROBLEMS_REMINDERS_TITLE = 'Reminder health';
export const REMINDERS_LABELS = {
  dueNow: 'Due now',
  inProgress: 'In progress',
  stuck: 'Stuck',
  failed24h: 'Failed (24 h)',
  failed7d: 'Failed (7 d)',
  deadLettered24h: 'Dead-lettered (24 h)',
  deadLettered7d: 'Dead-lettered (7 d)',
  oldestDueAt: 'Oldest due time',
} as const;
export const REMINDERS_SOURCE = 'The payment reminder queue, all businesses, as Jobs & queues counts it.';
export const REMINDERS_FAILED = 'Could not check reminders';
export const REMINDERS_NOT_NARROWED = 'Reminder health is platform-wide and is not narrowed to one business';
export const REMINDERS_LINK = 'Open Jobs & queues';
export const REMINDERS_LINK_LABEL = 'Open Jobs & queues, the Queues section, for the payment reminder queue';
export const JOBS_QUEUES_HREF = '/admin/jobs-queues#queues';

// ── One account, one screen (Money M-1, finance health §11D.3) ─────────────
// Shown only with a business picked (M1-FR-10). Every figure is selected from
// the payload and formatted; nothing here adds, subtracts or converts money.
export const ACCOUNT_HEADER_LABEL = 'Business';
export const ACCOUNT_SCOPE_NOTE = 'Every section below is for this business only.';
export const ACCOUNT_PLAN_GROUP = 'Plan group';
export const ACCOUNT_PAYING_LABEL = 'Paying state';
/** E-35: the paying state in words, never a colour (no green: the slice does not judge it). */
export const ACCOUNT_PAYING_TEXT = { paying: 'Paying', not_paying: 'Not paying', unknown: 'Unknown' } as const;
export const ACCOUNT_UNKNOWN = 'Unknown';

export const ACCOUNT_SUMMARY_TITLE = 'Account summary';
/** BD-18: the AI cost we charged (the credit ledger), USD. */
export const ACCOUNT_AI_COST = 'Charged AI cost';
export const ACCOUNT_CUTOVER_NOTE = 'The window starts before AI charging went live: see Charged AI cost in the window below.';
export const ACCOUNT_CUTOVER_ENTIRELY = 'The whole window is before AI charging went live: nothing was charged in it.';
export const ACCOUNT_PAID_BOOSTS = 'Paid us: credit boosts';
export const ACCOUNT_PAID_PLAN = 'Paid us: plan';
export const ACCOUNT_PAID_TOTAL = 'Paid us, total';
export const ACCOUNT_NONE_IN_WINDOW = 'None in this window';
export const ACCOUNT_CREDITS = 'Credits';
export const accountCreditsLine = (allowance: string, used: string, percent: string, gifted: string) =>
  `Allowance ${allowance} · used ${used} (${percent}) · gifted outstanding ${gifted}`;
export const accountCreditsNoAllowance = (gifted: string) => `No allowance · gifted outstanding ${gifted}`;

/** M1-FR-7 / SA-W56: every link carries this business and the window. Only the account id travels. */
export const ACCOUNT_LINKS_TITLE = 'Open this business in';
export const ACCOUNT_LINK_ACTIVITY = 'Business OS AI Activity';
export const ACCOUNT_LINK_COSTS = 'Charge checks';
export const ACCOUNT_LINK_ANALYTICS = 'AI calls & usage';
export const ACCOUNT_LINK_BUSINESSES = 'Businesses';

// ── The Accounts tab: account economics and AI margin (slice 6a, Money M-3, §11E) ──
// Every figure is decided on the server (M3-FR-13); these strings only label it.
export const TABS_LABEL = 'Finance views';
export const TAB_OVERVIEW = 'Overview';
export const TAB_ACCOUNTS = 'Accounts';

export const ECON_TITLE = 'Accounts';
export const ECON_SUBTITLE = 'Every account: what it paid us, what its AI cost us, and the AI margin';
/** M3-FR-9: shown on the tab at all times. */
export const ECON_NOTES: readonly string[] = [
  'Paid us is after tax, net of refunds and disputes. The AI margin does not deduct Stripe fees.',
  'AI cost is the charged AI cost (credits we billed); the recorded AI cost is not used here.',
  'AI margin is shown only for accounts paid in USD. No exchange rate is used.',
  'Plan refunds and disputes are not recorded yet.',
];
export const ECON_PLATFORM_TITLE = 'All accounts, before any filter';
export const econPlatformCovers = (accounts: string, withDeleted: boolean) =>
  withDeleted ? `Covers every account (${accounts}) and deleted accounts.` : `Covers every account (${accounts}).`;
export const ECON_PAID = 'Paid us, after tax';
export const ECON_COST = 'Charged AI cost (USD)';
export const ECON_MARGIN = 'AI margin (USD)';
export const ECON_BUSINESS = 'Business';
export const ECON_GROUP = 'Plan group';
export const ECON_GROUP_NOTE = 'Plan is the current one';
export const ECON_CREDITS = 'Credits used';
export const ECON_CREDITS_NOTE = 'own credit period';
export const ECON_OPEN = 'Open';
export const econOpenLabel = (business: string) => `Open ${business} on its own, same window`;
export const econPaidParts = (plan: string, boosts: string) => `plan ${plan} · boosts ${boosts}`;
export const ECON_NONE = 'None';
export const ECON_UNKNOWN = 'Unknown';
export const ECON_NO_PLAN_ROW = 'No plan row';
export const ECON_NO_ALLOWANCE = 'No allowance';
export const econCreditsUsed = (percent: string, used: string, allowance: string) => `${percent} · ${used} / ${allowance}`;
/** M3-W-7: the margin before the charging cut-over. */
export const ECON_MARGIN_NOT_AVAILABLE = 'Not available: AI cost is charged only from 29 Sep 2026';
/** M3-W-5: another currency, never converted. */
export const ECON_MARGIN_OTHER_CURRENCY = 'n/a, different currency';
export const ECON_NO_REVENUE = 'No revenue in this window';
export const ECON_COST_BEFORE_CUTOVER = 'Before AI charging went live';
export const ECON_CUTOVER_NOTICE =
  'The window starts before AI charging went live on 29 Sep 2026: AI cost covers only the charged part, and no margin is shown.';
export const ECON_DELETED = 'Deleted accounts';
export const ECON_SORT = 'Sort';
export const ECON_SHOW = 'Show';
export const ECON_ALL_GROUPS = 'All plan groups';
export const ECON_SORT_LABELS = {
  ai_cost: 'Charged AI cost, highest first',
  margin: 'AI margin, lowest first',
  paid: 'Paid us, highest first',
  credits: 'Credits used, highest first',
} as const;
export const ECON_SHOW_LABELS = {
  all: 'All accounts',
  active: 'Paid us or used AI in this window',
  negative: 'Negative AI margin',
} as const;
export const econShowing = (shown: string, total: string) => `Showing ${shown} of ${total} accounts`;
export const econNotListed = (count: string) => `${count} more accounts not listed; narrow with a filter`;
export const ECON_EMPTY = 'No accounts match this filter';
/** M3-FR-2 / M3-FR-10: a notice naming the part that is missing. */
export const ECON_WALK_INCOMPLETE = 'Accounts with no money or AI use in this window may be missing.';
export const ECON_LEDGER_FAILED = 'AI cost could not be loaded.';
export const ECON_BOOSTS_FAILED = 'Boost payments could not be loaded.';
export const ECON_PLANS_FAILED = 'Plan payments could not be loaded.';
export const ECON_CREDITS_FAILED = 'Credits could not be loaded.';

// Slice 6b (§11K.5, FE-11, FE-12): the margin after the ESTIMATED card fees.
// Every string says "estimate" (the vocabulary guard forbids the other form).
export const ECON_AFTER_FEES = 'Margin after Stripe fees (estimate, USD)';
export const ECON_PLATFORM_AFTER_FEES = 'Margin after Stripe fees (estimate)';
export const ECON_FEES = 'Stripe fees, estimate';
export const econFeesLine = (amount: string) => `Stripe fees, estimate: ${amount}`;
/** Always shown on the tab; the numbers come from the payload (FE-16). */
export const econFeeNote = (percent: string, fixed: string) =>
  `Stripe fees are an estimate: none are recorded for plan or boost payments. Assumed ${percent}% + ${fixed} per card charge. A refunded charge keeps its fee. Dispute fees are not included.`;
/** E-73: the fee config could not be read. */
export const ECON_FEE_NOTE_UNREADABLE =
  'Stripe fees are an estimate: none are recorded for plan or boost payments. The assumed fee could not be read, so no margin after Stripe fees is shown.';

/** M3-FR-8: the account summary's margin line, under "Paid us, total". */
export const ACCOUNT_MARGIN = 'AI margin (USD)';
/** Slice 6b (FE-14): directly under the AI margin line. */
export const ACCOUNT_AFTER_FEES = 'Margin after Stripe fees (estimate, USD)';
