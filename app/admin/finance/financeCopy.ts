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

// ── Money MK-5: the KPI strip F-K1 to F-K5 (KPI restructure review §3.1, §5, §5.1, LL-4, FC-1, FC-2) ──
// One copy constant per KPI: the label, the caption and the tooltip's definition
// (line 1 of the leading / lagging icon). Money is `$` with the US-dollar line
// only (§3.4); other currencies are a count in a note, never an amount.
export const FINANCE_KPIS = {
  revenue: {
    label: 'Revenue received',
    sub: (windowLabel: string) => `Plans and credit boosts · ${windowLabel}`,
    definition:
      'Money owners paid us in the window, for plans and credit boosts, after refunds and lost disputes. Test and live payments count together.',
  },
  mrr: {
    label: 'MRR now',
    sub: 'Monthly, at list price, today',
    definition:
      'The monthly price of every paying subscription today. Past due is counted but shown apart; plans with no list price, or a founder discount with no amount, are not counted and say so.',
  },
  aiCost: {
    label: 'Charged AI cost this month',
    definition:
      'What Business OS AI actions cost us that we charged credits for, this month, against the same days of last month.',
  },
  aiMargin: {
    label: 'AI margin',
    sub: (windowLabel: string) => `Revenue after tax minus Charged AI cost · ${windowLabel}`,
    /** FC-2 (§14, Q-13): it says what it deducts; the second sentence is the approved line, word for word. */
    definition:
      'Revenue after tax, net of refunds and disputes, minus Charged AI cost, in the window. A partial gross margin: only AI cost is deducted so far. Stripe fees are an estimate beside it.',
  },
  paying: {
    label: 'Paying accounts',
    definition:
      'What share of our accounts pay us for a plan: accounts paying now, out of every account with a plan, trials, Founding Partners and comped accounts included.',
  },
  /** Money MK-5b (§5.1 F-K5b): F-K5's second figure, with its own leading pill (LL-4: one constant). */
  converted: {
    label: 'Converted this month',
    definition:
      'Of the accounts paying now, how many paid us for a plan for the first time this month. Always the current calendar month in UTC, whatever window the page shows.',
  },
} as const;
/** USD-3 / USD-5: a count, never an amount, never part of the tile's value. */
export const kpiOtherPayments = (count: number) =>
  `plus ${count} ${count === 1 ? 'payment' : 'payments'} in other currencies, not converted`;
export const kpiOtherSubscriptions = (count: number) =>
  `plus ${count} ${count === 1 ? 'subscription' : 'subscriptions'} in other currencies, not converted`;
export const KPI_NONE_IN_DOLLARS = 'None in US dollars';
export const KPI_UNKNOWN = 'Unknown';
export const KPI_MRR_NONE = 'None';
export const kpiMrrPastDue = (amount: string) => `of which past due ${amount} (still counted)`;
export const kpiMarginAfterFees = (amount: string) => `After Stripe fees (estimate): ${amount}`;
export const KPI_MARGIN_WORDS = {
  not_available: 'Not available',
  other_currency: 'n/a, different currency',
  unknown: 'Unknown',
} as const;
export const kpiPayingCount = (paying: string, accounts: string) => `${paying} of ${accounts} accounts`;
export const kpiPayingPartial = (paying: string, accounts: string) =>
  `At least ${paying} of at least ${accounts} accounts: the plan read was cut off`;
export const KPI_PAYING_ONE = { yes: 'Paying', no: 'Not paying' } as const;
export const KPI_PAYING_ONE_SUB = 'This business, now';
/** Money MK-5b (§5.1): "Converted this month: 2 of 9 paying"; "at least" when cut off; Unknown, never 0. */
export const kpiConverted = (converted: string, paying: string) => `${FINANCE_KPIS.converted.label}: ${converted} of ${paying} paying`;
export const kpiConvertedPartial = (converted: string, paying: string) =>
  `${FINANCE_KPIS.converted.label}: at least ${converted}, of at least ${paying} paying`;
export const KPI_CONVERTED_UNKNOWN = `${FINANCE_KPIS.converted.label}: Unknown`;
/** With a business picked (§5.1 is silent there; the recorded decision): that business, yes or no. */
export const KPI_CONVERTED_ONE = {
  converted: `${FINANCE_KPIS.converted.label}: Yes`,
  stopped: `${FINANCE_KPIS.converted.label}: Yes, no longer paying`,
  not_converted: `${FINANCE_KPIS.converted.label}: No`,
} as const;

// ── Money MK-5b: the Converted this month list (Plans & subscriptions, §5.1 breakdown) ──
export const CONVERTED_TITLE = FINANCE_KPIS.converted.label;
export const convertedSubtitle = (month: string) =>
  `Accounts whose first plan payment was in ${month} (UTC). Always this month, whatever window is picked.`;
export const CONVERTED_COLUMNS = {
  business: 'Business',
  plan: 'Plan',
  firstPaid: 'First payment',
  source: 'Came from',
  status: 'Status',
} as const;
/** The lineage `source` in words (G-2: no lineage row is "Not recorded"; a failed read is "Unknown"). */
export const CONVERTED_SOURCE = { admin_invite: 'Admin invite', account_invite: 'Friend invite', organic: 'Organic' } as const;
export const CONVERTED_SOURCE_MISSING = 'Not recorded';
export const CONVERTED_SOURCE_UNKNOWN = 'Unknown';
export const CONVERTED_PLAN_UNKNOWN = 'Unknown plan';
export const CONVERTED_STATUS = { paying: 'Paying', stopped: 'Converted, no longer paying' } as const;
export const CONVERTED_EMPTY = 'No account paid us for a plan for the first time this month.';
export const CONVERTED_PARTIAL = 'Not every account could be read, so these counts are "at least".';
export const convertedCountLine = (converted: string, stopped: string) =>
  `${converted} converted and paying · ${stopped} converted, no longer paying`;
export const convertedShowing = (shown: string, total: string) => `Showing the newest ${shown} of ${total}`;
/** MK-5: K-3 leaves the strip; its BD-11 rule is a chip on Plan mix, with the payload's own status and headline. */
export const accountsK3Chip = (count: string) => `${count} Founding Partners with no end date`;

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
/** Slice 4b.2 (S4-FR-17, SA-W120): the dispute rule's headline, the number filled in by the builder. */
export const k5DisputeHeadline = (count: number) =>
  `${count} boost ${count === 1 ? 'payment' : 'payments'} in dispute`;
export const K5_DISPUTE_CHECK_FAILED = 'Dispute check failed';

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
/** Slice 4b.2 (FR-4B-4, E-104): held is a NOW figure, its own table, never in a window's net. */
export const REVENUE_HELD = 'Held in open disputes now (not taken off any month)';
export const REVENUE_HELD_DISPUTES = 'Open disputes';
export const REVENUE_HELD_NONE = 'No boost payment is in an open dispute now';
export const REVENUE_HELD_FAILED = 'Open disputes could not be checked.';
export const REVENUE_LOST = 'Lost in disputes';
/** FR-4B-5: what net is, and what it is not. */
export const REVENUE_NET = 'Net of refunds and lost disputes (Stripe fees not deducted; includes any tax)';
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
  'The boost purchases or their refunds were read only up to their limit: counts and amounts are "at least", and net is unknown.';
/** FR-4B-16 / §7: the event read failed, or the table is not there yet. No purchase-month fallback. */
export const REVENUE_EVENTS_FAILED =
  'Refund and dispute dates could not be loaded, so refunded, lost and net are unknown.';
export const REVENUE_EVENTS_NOT_AVAILABLE =
  'Refund and dispute dates are not available yet, so refunded, lost and net are unknown.';
export const REVENUE_EVENTS_UNREADABLE = (count: number) =>
  `${count} ${count === 1 ? 'refund or dispute has an amount' : 'refunds or disputes have amounts'} that could not be read: net unknown on that line.`;
/** SA-Q74: counted as recorded, never clamped. */
export const REVENUE_EVENTS_OVER_TOTAL = (count: number) =>
  `${count} ${count === 1 ? 'purchase has' : 'purchases have'} refunds and lost disputes above its total in this window; each is counted as recorded.`;
export const REVENUE_NOTICE_UNREADABLE = (count: number) =>
  `${count} ${count === 1 ? 'purchase has an amount' : 'purchases have amounts'} that could not be read: left out of the sums, net unknown on that line.`;
export const REVENUE_NOTICE_UNREADABLE_CREDITS = (count: number) =>
  `${count} ${count === 1 ? 'purchase has credits' : 'purchases have credits'} that could not be read: credits sold is "at least".`;
/**
 * BD-17 / FR-4B-6 (slice 4b.2, replaces the S4-W-3 sentence): the ONE sentence
 * about when a refund or dispute counts. Shown whenever a refund, lost or held
 * figure is non-zero. Pinned by the finance source guard (SA-WR-35).
 */
export const REVENUE_REFUND_TIMING_NOTE =
  'Refunds and lost disputes count in the month we recorded them, so a finished month does not change. A refund we learn of late counts in the month we learned of it. Open disputes are shown as held now.';
// ── Money MK-4: "Recurring now" in the Revenue section (§3.2, F-K2, BQ-P8a-4) ──
// MRR now beside the cash received in the window; never added to it.
export const REVENUE_RECURRING_HEADING = 'Recurring now (MRR)';
/**
 * C-4 / SA-CR-MK4 CR-2: the MRR line says which Stripe key it was read with, in
 * test only. The ONE Finance copy constant on the mode-wording allow-list (the
 * finance source guard strips exactly this declaration); MK-5's MRR tile reuses
 * it. Revenue received is never labelled (BD-20).
 */
export const REVENUE_RECURRING_TEST_KEY_LABEL = 'Stripe test mode';
export const REVENUE_RECURRING_NOTE =
  'The monthly value of paying subscriptions today, at list price, excluding tax. Not cash received: it is never added to the figures above.';
export const REVENUE_RECURRING_NONE = 'None: no paying subscription.';
export const REVENUE_RECURRING_UNKNOWN = 'Unknown: MRR could not be read.';
export const REVENUE_RECURRING_SUBSCRIPTIONS = (count: number, text: string) => `${text} ${count === 1 ? 'subscription' : 'subscriptions'}`;
export const REVENUE_RECURRING_PAST_DUE = (amount: string) => `of which past due (still counted) ${amount}`;
export const REVENUE_RECURRING_CANCELLING = (amount: string) => `of which cancelling ${amount}`;
export const REVENUE_RECURRING_NOT_EXACT = 'not exact';
export const REVENUE_RECURRING_PAST_DUE_NOT_COUNTED = 'Past-due subscriptions are not counted.';
export const REVENUE_RECURRING_UNPRICED = (count: string) => `${count} paying with no list price: not counted.`;
export const REVENUE_RECURRING_DISCOUNT = (count: string) => `${count} paying with a founder discount whose amount is not recorded: not counted.`;
export const REVENUE_CANNOT_TITLE = 'Not shown here';
/** M2-FR-13: what this section cannot produce yet. */
export const REVENUE_CANNOT: readonly string[] = [
  'MRR and active subscriptions (a later update)',
  'Plan refunds and disputes (not recorded yet)',
  'Real Stripe fees (none are recorded for our payments yet)',
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
// Money MK-3b: AI calls & usage is the AI cost page's Calls tab.
export const AI_LINK = 'AI cost: Calls';
export const AI_LINK_NOTE = 'Every recorded AI call, charged or not:';
export const AI_UNRESOLVED = 'corrections whose charge could not be found';
export const AI_UNREADABLE = 'amounts could not be read and count as 0';

// ── Money M-4 (OV-5, §11F.5, §11F.6): the recorded AI cost beside the charged one ──
// Two measures, never added (BD-18). "Recorded above charged" is a difference of the two, named
// as one (E-54); the Leak check keeps its own per-call "Recorded, not charged". The server
// decides every value and state (M4-FR-11); the page only formats.
// Money MK-3a (C-7): the full recorded block (the recorded figure, its source, the notices and the
// distortion sentences) moved to the AI cost page (`app/admin/business-os-llm/costCopy.ts`).
// Finance keeps the value words of its one line, "Recorded above charged", and the line's link.
export const ABOVE_NONE = 'None';
/** R4-6: charged is above recorded; `usd` is already formatted ("$0.33"). */
export const aboveChargedAboveLine = (usd: string) => `Charged is ${usd} above recorded (fallback prices or corrections)`;
export const ABOVE_NOT_AVAILABLE = 'Not available: AI charging began 29 Sep 2026';
export const RECORDED_UNKNOWN = 'Unknown';
/** MK-3a (C-7): the one line's link to the AI cost page's recorded block and Leak check. */
export const RECORDED_ON_AI_COST_LINK = 'Recorded AI cost and the Leak check, on AI cost';
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
export const CREDITS_FAR_OVER = 'At or over the far line';
/** Money MK-1 (§5, LL-4): the Credits block KPI and its one definition constant. */
export const BLOCK_KPI_OVER_ALLOWANCE_LABEL = 'Accounts over allowance';
export const BLOCK_KPI_OVER_ALLOWANCE_DEFINITION = 'Accounts whose credit use this period is above their allowance.';
/** K-2's far-over rule as the block's amber chip (§3.2). */
export const BLOCK_KPI_FAR_OVER_CHIP = (count: string, percent: number | null) =>
  percent === null ? `${count} far over allowance` : `${count} at or over ${percent}% of allowance`;
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
/** Slice 4b.2 (S4-FR-18 to S4-FR-20): bought credits, beside gifted, never added to them. */
export const CREDITS_BOUGHT = 'Bought credits outstanding';
export const CREDITS_BOUGHT_COLUMN = 'Bought outstanding';
export const CREDITS_BOUGHT_IN_WINDOW = 'Bought in the window';
export const CREDITS_BOUGHT_BOOSTS = 'boosts';
export const CREDITS_BOUGHT_DELETED_NOTE = (credits: string) => `${credits} bought credits on deleted accounts, not counted.`;
export const CREDITS_BOUGHT_UNKNOWN = 'Bought credits could not be read.';
/** BQ-13 open: a refunded boost keeps its credits. */
export const CREDITS_NOT_TAKEN_BACK = 'Credits of a refunded boost are not taken back.';

// ── Section 2 block B, takings through the platform (slice 2a) ─────────────
// The businesses' client payments: NOT our revenue (BD-1). No test-mode
// wording anywhere (BD-13): test and real client payments are shown together.
// Money MK-1: renamed "Client payments (the businesses' money, not ours)" and
// moved to the bottom of the Overview; the "Not our revenue" chip stays.
export const TAKINGS_TITLE = "Client payments (the businesses' money, not ours)";
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

/** Money MK-1 (§5, LL-4): the Client payments block KPI and its one definition constant. */
export const BLOCK_KPI_CLIENT_PAYMENTS_LABEL = 'Businesses taking client payments';
export const BLOCK_KPI_CLIENT_PAYMENTS_DEFINITION =
  "Businesses with at least one client payment recorded in the window. Their clients' money, not ours.";
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
/** SA-CR-4b2 CR-1: the Section 6 frame title. It names neither ours nor the clients'; each block says whose. */
/** Money MK-6: no longer rendered (the section was split between Revenue and Client payments). Kept for the words' history. */
export const PAYMENT_PROBLEMS_TITLE = 'Payment problems';
/** Block B's own heading (with PROBLEMS_CHIP), never the frame's. */
export const PROBLEMS_TITLE = 'Client payment problems';

/** Slice 4b.2, block A (FR-4B-12, S4-FR-15): OUR boost problems, as of now, before the clients' blocks. */
export const BOOST_PROBLEMS_TITLE = 'Our payment problems (boosts)';
export const BOOST_PROBLEMS_SUBTITLE = 'As of now, UTC';
export const BOOST_PROBLEMS_NONE = 'No boost payment in dispute and none waiting for credits';
export const BOOST_PROBLEMS_OPEN = 'Open disputes';
export const BOOST_PROBLEMS_HELD = 'Held now';
export const BOOST_PROBLEMS_OPENED = 'Oldest opened';
export const BOOST_PROBLEMS_NOT_CREDITED = 'Not credited';
export const BOOST_PROBLEMS_NOT_CREDITED_HELP = 'Payment received by Stripe, credits not given; check the purchase';
export const BOOST_PROBLEMS_NOT_CREDITED_AMOUNT = 'Amount recorded';
export const BOOST_PROBLEMS_SINCE = 'Oldest since';
export const BOOST_PROBLEMS_NOT_RECORDED = 'Not recorded';
export const BOOST_PROBLEMS_DATES_FAILED = 'The dates the disputes opened could not be read.';
export const BOOST_PROBLEMS_CUT = 'The purchases were read only up to their limit: counts and amounts are "at least".';
export const boostProblemsOnUnpaid = (count: number) =>
  `${count} ${count === 1 ? 'refund or dispute' : 'refunds or disputes'} recorded on purchases not credited (not revenue).`;
export const BOOST_PROBLEMS_LINK = 'Boost purchases of one business';
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
/**
 * DF-6 (DF6-FR-9, E-81): the "Since it started" window line, under the bar and
 * in the account summary. `start` is the payload's start, already formatted.
 */
export const sinceStartWindowLine = (start: string) => `Since it started: ${start} to now (UTC)`;
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
// Money MK-3a: Charge checks is now the AI cost page's Summary & checks tab.
export const ACCOUNT_LINK_COSTS = 'AI cost: Summary & checks';
// Money MK-3b: the AI cost page's Calls tab (the tab's own label, as Summary & checks above).
export const ACCOUNT_LINK_ANALYTICS = 'AI cost: Calls';
export const ACCOUNT_LINK_BUSINESSES = 'Businesses';

// ── The Accounts tab: account economics and AI margin (slice 6a, Money M-3, §11E) ──
// Every figure is decided on the server (M3-FR-13); these strings only label it.
export const TABS_LABEL = 'Finance views';
export const TAB_OVERVIEW = 'Overview';
export const TAB_ACCOUNTS = 'Accounts';
/** Money MK-4: the Subscriptions page as a Finance tab, Plan mix on top (§3.2). */
export const TAB_PLANS = 'Plans & subscriptions';
/** Admin Exchange Rates slice 2a (D-7, "Finance tab only"): the rates view as the fourth and last tab. */
export const TAB_EXCHANGE_RATES = 'Exchange rates';
export const PLANS_SUBSCRIPTIONS_TITLE = 'Subscriptions';
export const PLANS_SUBSCRIPTIONS_SUBTITLE = (asOf: string | null) =>
  `Plan subscriptions from our own billing records, for the server's current Stripe key${asOf ? ` · As of ${asOf}` : ''}`;
export const PLANS_STATUS_LABEL = 'Status';
export const PLANS_STATUS_ALL = 'All';

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

// ── Slice 8.3 (§11M.8 HS-FR-11 to HS-FR-16, E-100, E-101): the History block ──
export const HISTORY_TITLE = 'History';
export const HISTORY_SUBTITLE = 'Each point is the state at the end of that UTC day. Credits are units, not money.';
export const HISTORY_SHOW = 'Show history';
export const HISTORY_HIDE = 'Hide history';
export const HISTORY_ALL_BUSINESSES_ONLY = 'History is kept for all businesses together, not per business.';
export const historyStartsOn = (date: string) => `History starts on ${date} (UTC).`;
export const HISTORY_NONE_YET = 'No history yet: a snapshot is taken every night at 00:07 UTC.';
export const historyNoneInWindow = (date: string) => `No snapshot in this window. History starts on ${date} (UTC).`;
export const HISTORY_NOT_INSTALLED = 'History is not available yet: it starts once the nightly snapshot is installed.';
export const HISTORY_WEEKLY = 'Weekly points';
export const HISTORY_NO_SNAPSHOT = 'No snapshot';
export const HISTORY_NOT_RECORDED = 'Not recorded';
export const HISTORY_CHANGE = 'Change in this window';
export const HISTORY_NOT_AVAILABLE = 'Not available';
export const HISTORY_NO_LONGER_CONFIGURED = '(no longer configured)';
export const HISTORY_PLAN_MIX = 'Plan mix';
export const HISTORY_CREDITS = 'Credits';
export const HISTORY_DATE = 'Date';
export const HISTORY_COLUMN_LABELS = {
  accounts_total: 'Total',
  founding_no_end_date: 'Founding Partners with no end date',
  credit_allowance: 'Included credits',
  credit_used: 'Used this period',
  gifted_outstanding: 'Gifted outstanding',
  bought_outstanding: 'Bought outstanding',
  credit_outstanding_total: 'Outstanding total',
  credit_over_allowance: 'Accounts over allowance',
  credit_far_over_allowance: 'Far over allowance',
} as const;

// ── Money MK-8: the Finance drawers (read-only quick looks, Q-7) ──
export const BUSINESS_DRAWER = {
  /** The drawer title when no name is known (the short id follows it). */
  titleFallback: 'Business',
  /** Noun phrase for the shared reading / error sentences. */
  what: 'this business',
  /** MK-10: the Open button's accessible name and tooltip, the Businesses page's pattern ("Open details for …"). */
  openDetails: (name: string) => `Open details for ${name}`,
  clientPayments: 'Client payments (their money, not ours)',
  clientPaymentsNote: "In this business's own currency. Never added to our revenue.",
  clientPaymentsNone: 'No client payments recorded in this window',
  clientPaymentsUnknown: 'Client payments could not be read.',
  clientPaymentsLine: (payments: string, gross: string, net: string) => `${payments} payments · gross ${gross} · net ${net}`,
  overdue: 'Overdue items, as of now',
  overdueInvoices: 'Overdue invoices',
  overdueInstalments: 'Overdue instalments',
  unknown: 'Unknown',
  openFull: 'Open full view',
} as const;

export const PLAN_DRAWER = {
  what: 'this plan',
  /** The opener's accessible name and tooltip. */
  open: (plan: string) => `Open plan ${plan}`,
  mrr: 'MRR',
  mrrNone: 'None',
  statuses: 'Accounts by status',
  accounts: 'Accounts',
  empty: 'No account on this plan.',
  showing: (shown: string, total: string) => `Showing ${shown} of ${total} accounts`,
} as const;

// ── Money MK-9: F-K5's breakdown on Plans & subscriptions (S5B-FR-8 to FR-16) ──
// No billing-mode word anywhere here (the finance mode guard; MK9-R1).
export const PAYING_BREAKDOWN = {
  subtitle: 'What is behind Paying accounts: who pays, why comped accounts do not, and how trials turn into paying accounts. All businesses.',
  paying: (paying: string, accounts: string) => `Paying: ${paying} of ${accounts} accounts`,
  payingUnknown: 'Paying: Unknown',
  compedHeading: 'Comped',
  compedTotal: (total: string) => `Comped: ${total}`,
  assigned: 'Assigned, no subscription',
  endedOrNotPaying: 'Subscription ended or not paying',
  compedUnknown: 'Comped: Could not check',
  note: 'Paying means a paid plan subscription that is active or past due now. Comped means a plan in force with no paying subscription.',
  trialsHeading: 'Trial to paid',
  endedInWindow: (count: string) => `Trials ended in this window: ${count}`,
  paid: (count: string) => `Paid: ${count}`,
  paidBeforeEnd: (count: string) => `of which before the trial ended: ${count}`,
  paidUnknown: 'Paid: Unknown',
  rate: (paid: string, base: string, percent: string) => `Rate: ${paid} of ${base} (${percent}%)`,
  tooFew: (minimum: string) => `Too few trials for a rate (a rate needs at least ${minimum})`,
  noRateCutOff: 'No rate: not every account could be read',
  stillRunning: (count: string) => `Still running: ${count}`,
  trialsUnknown: 'Trials could not be read.',
  limits: 'Paid means a first plan payment, counted as for Converted this month. Boosts are not a conversion.',
  cutOff: 'Not every account could be read, so these counts are "at least".',
  unknown: 'Unknown',
} as const;
