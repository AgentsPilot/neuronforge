/**
 * The Subscriptions words (plan payments P-8a.1, AM-2 and AM-3; Admin Layout
 * Standard §5.6). Money MK-4 (SA-CR-MK4 MK4-FU-1): moved here from
 * `app/admin/subscriptions/subscriptionsCopy.ts` when that page became
 * Finance's Plans & subscriptions tab. It names the Stripe mode, so it is on
 * the finance source guard's explicit mode-wording allow-list (SA-4, CR-1).
 * The users drawer's billing panel imports its status words from here too.
 *
 * One key, `status` (`?status=failed`, `all` omitted, an unknown value
 * ignored). Module level, so the filter hook sees a stable spec.
 *
 * Plan names never appear here: they arrive from the server, so this page
 * holds no tier literal.
 */

import { textFilter } from '@/app/admin/components/layout/useAdminFilters';
import type { StatusTone } from '@/app/admin/components/layout/StatusChip';
import {
  isSubscriptionFilter,
  type BillingDisagreement,
  type SubscriptionFilter,
  type SubscriptionStatus,
} from '@/lib/admin/billing/subscriptionsTypes';

/** P-8b.3a (SA P3-SA-2 item 5): a status or `disagrees`, through the ONE `SUBSCRIPTION_FILTERS` constant. */
export type SubscriptionsFilter = 'all' | SubscriptionFilter;

export function toSubscriptionsFilter(raw: string): SubscriptionsFilter {
  return isSubscriptionFilter(raw) ? raw : 'all';
}

export const SUBSCRIPTIONS_FILTER_SPEC = {
  status: textFilter({ key: 'status', defaultValue: 'all', isValid: (raw: string) => raw === 'all' || isSubscriptionFilter(raw) }),
};

/** The page's h1, equal to its sidebar label (Admin Layout D-3 (a)). */
export const SUBSCRIPTIONS_TITLE = 'Subscriptions';

export const SUBSCRIPTIONS_PURPOSE =
  'Business OS plan subscriptions from our own billing records: who pays, who is failing or cancelling, and the monthly recurring revenue (MRR).';

/** Noun phrase for the shared states and Refresh ("Reading subscriptions…"). */
export const SUBSCRIPTIONS_WHAT = 'subscriptions';

/** The labels of the status filter, in the order the select shows them. */
export const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  active: 'Active',
  grace: 'In grace',
  paused: 'Paused',
  cancelling: 'Cancelling',
  failed: 'Failed',
  ended: 'Ended',
  no_stripe: 'No Stripe (admin-assigned)',
  other: 'Other',
};

export const STATUS_FILTER_ORDER: readonly SubscriptionStatus[] = [
  'active',
  'grace',
  'paused',
  'cancelling',
  'failed',
  'ended',
  'no_stripe',
  'other',
];

export const STATUS_TONE: Record<SubscriptionStatus, StatusTone> = {
  active: 'ok',
  grace: 'warn',
  paused: 'danger',
  cancelling: 'warn',
  failed: 'danger',
  ended: 'neutral',
  no_stripe: 'info',
  other: 'unknown',
};

/**
 * P-8b.3a (AM-2; SA P3-SA-4): "Disagrees" means OUR two stored records (the
 * billing record and the plan record) disagree with each other. These words
 * never say "Stripe": the list shows stored records only (ruling 4, option A),
 * and the nightly reconcile's findings "with Stripe" are worded apart.
 */
export const DISAGREES_LABEL = 'Disagrees';

/** The filter option, carrying the count (it ignores the filter, like every total). */
export function disagreesOptionLabel(count: number): string {
  return `${DISAGREES_LABEL} (${count})`;
}

/** One line in the totals (no new tile, KPI-first rule). */
export const DISAGREEING_LABEL = 'Records that disagree';

export const DISAGREEMENT_LIST_COPY: Record<BillingDisagreement, string> = {
  tier_differs: 'the plan bought is not the plan on record',
  paid_through_differs: 'the paid-through date is not the billed period end',
  no_tier_on_plan: 'no plan is set on the account',
};

/** The chip's title: what the rule means, then the kinds. */
export function disagreesTitle(kinds: readonly BillingDisagreement[]): string {
  return `Our billing record and the plan record disagree: ${kinds.map((kind) => DISAGREEMENT_LIST_COPY[kind]).join('; ')}.`;
}

export const MODE_BADGE = { test: 'Stripe test mode', live: 'Stripe live mode' } as const;

/** Under the header when the server's key is a test key (BoostBlock's test-key wording, for plans). */
export const TEST_KEY_NOTE =
  'This server uses a Stripe test key: these are test-mode subscriptions, not real money. Live-mode rows are not shown.';

export const MRR_LABEL = 'MRR';
export const MRR_NONE = 'None';
export const MRR_NONE_SUB = 'No paying subscription in this Stripe mode.';
export const MRR_UNKNOWN_CURRENCY = 'Unknown currency';
export const MRR_PAST_DUE_NOT_COUNTED = 'Past-due subscriptions are not counted.';

/**
 * BQ-P8a-4: a past-due subscription counts in MRR but is shown apart. The ONE
 * wording, used by the Subscriptions tiles and the drawer's Plan billing block.
 */
export const MRR_PAST_DUE_COUNTED = 'past due (still counted)';

export function mrrUnpricedNote(count: number): string {
  return `${count} paying subscription${count === 1 ? '' : 's'} on a plan with no list price, not counted.`;
}

export function mrrDiscountNote(count: number): string {
  return `${count} with a founder discount, amount not recorded yet, not counted.`;
}

export const PAID_ACCOUNTS_LABEL = 'Paid accounts';

export const EMPTY_ALL = 'No subscriptions in this Stripe mode yet.';
export const EMPTY_ALL_HINT = 'A subscription appears here once a business pays for a plan.';
export const EMPTY_FILTERED = 'No subscriptions match this status.';
/** P-8b.3a: the empty line when the filter is `disagrees`. */
export const EMPTY_DISAGREES = 'No subscriptions have records that disagree.';

export function countLine(shown: number, matching: number): string {
  if (shown === matching) return `${matching} subscription${matching === 1 ? '' : 's'}`;
  return `Showing ${shown} of ${matching} subscriptions`;
}

export const NO_ACCOUNT = 'Deleted account';
export const NO_NAME = 'No business name';
export const NONE = 'None';
