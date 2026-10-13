/**
 * Every user-facing string of the admin finance page (slices 1a, 1b, 2a and 2b). The render
 * test asserts against these constants, so a wording change is one edit.
 *
 * Tile states reuse Health's `STATUS_STYLES` labels as they are (SA-W7); the
 * headline under each carries the finance-specific reason.
 */

import type { FinanceGroupKey, FinanceTriggerKey, FinanceWindowChoice } from '@/lib/business-os/finance/financeTypes';

export const PAGE_TITLE = 'Finance & business health';
export const PAGE_PURPOSE =
  'How is Business OS doing this month: accounts, AI cost, credits, and what clients paid the businesses through the platform.';

export const PRESET_LABELS: Record<FinanceWindowChoice, string> = {
  today: 'Today',
  '7d': '7d',
  '30d': '30d',
  this_month: 'This month',
  custom: 'Custom',
};

export const FILTER_FROM = 'From (UTC)';
export const FILTER_TO = 'To (UTC)';
export const FILTER_APPLY = 'Apply';
export const SHOW_ALL_BUSINESSES = 'All businesses';
export const BUSINESS_CHIP = 'Business:';
export const REFRESH = 'Refresh';
export const LOADING = 'Loading…';
export const PAGE_LOAD_FAILED = 'The finance page could not be loaded.';
export const RETRY = 'Retry';

export const TILE_LABELS = {
  k1: 'AI cost this month',
  k1Sub: 'This month vs last month, UTC',
  k2: 'Accounts far over allowance',
  k3: 'Founding Partners with no end date',
  k4: 'Gifted credits outstanding',
  k4Sub: 'Credits, now',
  k5: 'Our revenue',
} as const;
/** K-2's subtitle: the line comes from the payload (data, SA-W10), never typed here. */
export function k2Subtitle(percent: number | null): string {
  return percent === null ? 'Line not set' : `At or over ${percent}% of this period's allowance`;
}
export const TILE_PREVIOUS = 'Same days last month:';
export const AT_LEAST = 'At least';

export const SECTION_COULD_NOT_LOAD = 'Could not load this section';
export const SECTION_PARTIAL = 'At least';
export const SECTION_OK = 'Loaded';

export const REVENUE_TITLE = 'Our revenue';
export const REVENUE_NONE_YET =
  'None yet. Plan billing is not live (the payment webhook is not in place) and credit boosts are open to test accounts only.';
export const REVENUE_RECORDED = 'Live revenue has started to arrive; the revenue section is coming in a later update';
export const REVENUE_COULD_NOT_CHECK = 'Could not check';
export const REVENUE_SUBTITLE = 'Live-mode plan invoices and paid boosts, all businesses';

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

export const AI_TITLE = 'AI cost in the window';
export const AI_SOURCE = 'Credit ledger, charges and corrections';
export const AI_TOTAL = 'AI cost (USD)';
export const AI_CREDITS = 'Credits charged';
export const AI_ACTIONS = 'Charged actions';
export const AI_BY_TRIGGER = 'By trigger';
export const AI_BY_GROUP = 'By current plan group';
export const AI_BY_GROUP_NOTE = 'By the plan each account is on now, not the plan it was on when charged.';
export const AI_BY_GROUP_PARTIAL = 'At least: the plan rows were read only up to their limit, so some accounts may sit in the wrong group.';
export const AI_BY_GROUP_UNKNOWN = 'Unknown: the plan rows could not be read.';
export const AI_TOP = 'Top 10 businesses by AI cost';
export const AI_BUSINESS = 'Business';
export const AI_COST = 'Cost (USD)';
export const AI_DELETED = 'Deleted accounts';
export const AI_NO_ROWS = 'No AI actions charged in this window';
export const AI_LINK = 'AI cost & usage';
export const AI_LINK_HREF = '/admin/analytics';
export const AI_LINK_NOTE = 'For the provider-side token measure, see';
export const AI_UNRESOLVED = 'corrections whose charge could not be found';
export const AI_UNREADABLE = 'amounts could not be read and count as 0';

export const NAME_PLATFORM = 'Platform account';
export const NAME_MISSING = 'No business name';
export const NAME_UNAVAILABLE = 'Name unavailable';

export const TRIGGER_LABELS: Record<FinanceTriggerKey, string> = {
  owner: 'Owner',
  scheduled: 'Scheduled',
  external: 'External',
  unattributed: 'Unattributed',
};

export const NOTICE_LABEL = 'Note:';

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
