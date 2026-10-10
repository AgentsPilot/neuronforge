/**
 * Every user-facing string of the admin finance page (slice 1a). The render
 * test asserts against these constants, so a wording change is one edit.
 *
 * Tile states reuse Health's `STATUS_STYLES` labels as they are (SA-W7); the
 * headline under each carries the finance-specific reason.
 */

import type { FinanceGroupKey, FinanceTriggerKey, FinanceWindowChoice } from '@/lib/business-os/finance/financeTypes';

export const PAGE_TITLE = 'Finance & business health';
export const PAGE_PURPOSE = 'How is Business OS doing this month: accounts, AI cost and credits.';

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
  k3: 'Founding Partners with no end date',
  k5: 'Our revenue',
} as const;
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
