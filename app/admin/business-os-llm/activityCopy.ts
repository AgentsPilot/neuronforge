/**
 * The words of the Activity tab (admin AI Activity view, Gap B slice B1a), in
 * one place so the render tests assert the same strings the screen shows.
 */

import type { ActivityOutcome, ActivitySort, ActivityTrigger } from './activityTypes';
import type { ActivityPreset } from './activityPresets';

export const ACTIVITY_TAB_LABEL = 'Activity';

export const ACTIVITY_INTRO =
  'One row per Business OS AI action: what ran, for which business, whether it worked and what it cost. ' +
  'Read from the credit ledger; nothing here changes it.';

export const TIMES_ARE_UTC = 'Times are UTC.';

export const PRESET_LABELS: Record<ActivityPreset, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  this_week: 'This week',
  last_week: 'Last week',
  this_month: 'This month',
  last_month: 'Last month',
};

export const SORT_LABELS: Record<ActivitySort, string> = {
  time: 'Newest first',
  cost: 'Most expensive first',
};

export const OUTCOME_LABELS: Record<ActivityOutcome, string> = {
  succeeded: 'Succeeded',
  failed: 'Failed',
};

export const TRIGGER_LABELS: Record<ActivityTrigger, string> = {
  owner: 'Owner',
  scheduled: 'Scheduled',
  external: 'External',
};

export const AREA_NOT_DECLARED = 'Not declared';
export const NAME_UNAVAILABLE = 'Name unavailable';

// ---- The count line (FR-B10) ----

export const COUNT_LINE = (total: string) => `${total} actions`;

/** The order is part of the sentence: "the top 100" means nothing without it. */
export const COUNT_LINE_CAPPED = (shown: string, total: string, sort: ActivitySort) =>
  `Showing the top ${shown} of ${total} for the current filter, ${sort === 'cost' ? 'most expensive first' : 'newest first'}`;

/** Only when the count could not be read AND the page is full. Never a made-up number. */
export const COUNT_LINE_UNKNOWN_CAPPED = (shown: string, sort: ActivitySort) =>
  `Showing the first ${shown}, ${sort === 'cost' ? 'most expensive first' : 'newest first'}. More may match; the total could not be read.`;

// ---- The cut-over (FR-B13) ----

export const CUTOVER_LINE =
  'Charging went live on 29 September 2026 at 16:50 UTC, so this list starts there. ' +
  'For AI activity before then, see the audit trail’s AI action entries or Cost Analytics.';

export const CUTOVER_ENTIRELY_BEFORE =
  'This window ends before charging went live, so there are no rows to show here.';

export const CUTOVER_AUDIT_LINK = 'AI action entries in the audit trail';
export const CUTOVER_ANALYTICS_LINK = 'Cost Analytics (Business OS)';

/**
 * Audit-trail `date_to` for "before the cut-over". The audit page's field is a
 * `datetime-local` and its route compares `created_at <=` the value, so a bare
 * `2026-09-29` would stop at that day's midnight and miss the hours before
 * 16:50. One minute past the cut-over overlaps by seconds rather than leaving
 * a gap.
 */
export const CUTOVER_AUDIT_DATE_TO = '2026-09-29T16:51';

// ---- States ----

export const ACTIVITY_EMPTY = 'No AI actions match this window and these filters.';
export const ACTIVITY_LOADING = 'Reading the AI activity…';
export const ACTIVITY_ERROR_FALLBACK = 'Could not read the AI activity';

/** SA-B1-5: the picker can offer a platform account; the route refuses it with 409. */
export const PLATFORM_ACCOUNT_ERROR =
  'That is a platform account, not a business, so it has no rows in this list. ' +
  'Platform AI calls are counted by the leak check on the Costs & credits tab.';

export const NAMES_FAILED = 'Business names could not be read; accounts are shown by id.';
export const ADJUSTMENTS_FAILED =
  'Corrections could not be read, so costs and credits below are as charged, before any correction.';
export const UNRESOLVED_ADJUSTMENTS = (n: number) =>
  `${n} correction${n === 1 ? '' : 's'} could not be matched to the charge it points at and ${n === 1 ? 'was' : 'were'} not applied.`;
export const UNREADABLE_AMOUNTS = (n: number) =>
  `${n} amount${n === 1 ? '' : 's'} could not be read and ${n === 1 ? 'is' : 'are'} counted as 0.`;

// ---- Record-state markers (AC-B17: text, never colour alone) ----

/** OQ-13: no direction is claimed until B2/B3 can read the measured price. */
export const MARKER_FALLBACK = 'Priced from a fallback rate — pending reconciliation';
export const MARKER_CORRECTED = 'Corrected';
export const MARKER_NONE = 'None';

// ---- The deleted-account bucket (FR-B8) ----

export const DELETED_BUCKET_LABEL = 'Account deleted';
export const DELETED_BUCKET_NOTE = 'not audit loss: the accounts were deleted after these actions ran, so they belong to no business';
export const DELETED_BUCKET_FAILED = 'Actions of deleted accounts could not be read.';
export const DELETED_BUCKET_AT_LEAST = 'at least';

// ---- Columns ----

export const COLUMNS = {
  when: 'When (UTC)',
  business: 'Business',
  area: 'Area',
  actionType: 'Action type',
  trigger: 'Trigger',
  outcome: 'Outcome',
  cost: 'Cost (USD)',
  credits: 'Credits charged',
  groupId: 'Grouping id',
  state: 'Record state',
} as const;

export const SHOW_ALL_BUSINESSES = 'Show all businesses';
