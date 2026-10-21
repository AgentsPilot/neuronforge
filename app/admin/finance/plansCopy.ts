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
import { isSubscriptionStatus, type SubscriptionStatus } from '@/lib/admin/billing/subscriptionsTypes';

export type SubscriptionsFilter = 'all' | SubscriptionStatus;

export function toSubscriptionsFilter(raw: string): SubscriptionsFilter {
  return isSubscriptionStatus(raw) ? raw : 'all';
}

export const SUBSCRIPTIONS_FILTER_SPEC = {
  status: textFilter({ key: 'status', defaultValue: 'all', isValid: (raw: string) => raw === 'all' || isSubscriptionStatus(raw) }),
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

export function countLine(shown: number, matching: number): string {
  if (shown === matching) return `${matching} subscription${matching === 1 ? '' : 's'}`;
  return `Showing ${shown} of ${matching} subscriptions`;
}

export const NO_ACCOUNT = 'Deleted account';
export const NO_NAME = 'No business name';
export const NONE = 'None';
