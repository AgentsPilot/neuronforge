/**
 * The words of the Activity tab (admin AI Activity view, Gap B slices B1a and
 * B1b), in one place so the render tests assert the same strings the screen
 * shows.
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

// ---- B1b: the audit entry (FR-B5 question 1, AC-B17: text, never colour alone) ----

/** OQ-5: the boundary is stated on screen, from the payload's own figure. */
export const MARKER_TOO_RECENT = (minutes: number | null) =>
  minutes === null ? 'No audit entry — too recent' : `No audit entry — too recent (under ${minutes} min)`;
export const MARKER_MAY_BE_ARCHIVED = 'No audit entry — may be archived';
export const MARKER_LOST = 'No audit entry — lost';
/** Neutral for every reason (SA-CR-B-3); the reason follows as visible text. */
export const MARKER_ENTRY_UNKNOWN = 'Audit entry unknown';
export const MARKER_ACCOUNT_MISMATCH = 'Audit entry on another account — defect';

/** The reason, short, shown as visible text in the chip (QA E-B3: never hover-only). */
export const ENTRY_UNKNOWN_SHORT = {
  audit_read_failed: 'audit read failed',
  audit_read_incomplete: 'audit read cut short',
  archive_unread: 'archive cutoff unreadable',
  charge_time_unreadable: 'charge time unreadable',
} as const;

/** The reason, in full, as hover text. The short form above is always visible too. */
export const ENTRY_UNKNOWN_REASONS = {
  audit_read_failed: 'The audit trail could not be read.',
  audit_read_incomplete: 'The audit read reached its row limit, so this entry may be in the part not read.',
  archive_unread: 'The audit archive cutoff could not be read, so "may be archived" and "lost" cannot be told apart.',
  charge_time_unreadable: 'The charge time could not be read, so its age cannot be judged.',
} as const;

/** An entry field that is not known: never blank, never "none" (FR-B1). */
export const ENTRY_FIELD_UNKNOWN = 'Unknown';
export const ENTRY_MODELS_NONE = 'None recorded';
export const ENTRY_ERROR_NONE = 'None';

export const AUDIT_SUMMARY_LABEL = (shown: string) => `Audit entries, over the ${shown} rows shown:`;
export const AUDIT_SUMMARY_COUNTS = (c: {
  lost: string;
  mayBeArchived: string;
  tooRecent: string;
  unknown: string;
  accountMismatch: string;
}) =>
  `${c.lost} lost, ${c.mayBeArchived} may be archived, ${c.tooRecent} too recent, ${c.unknown} unknown, ` +
  `${c.accountMismatch} with an entry on another account.`;
export const AUDIT_SETTLE_NOTE = (minutes: number) =>
  `“Too recent” means under ${minutes} minutes old: audit entries are written in batches, so a newer action may not have one yet.`;
export const AUDIT_READ_FAILED = 'The audit trail could not be read, so every row shows its audit entry as unknown.';
export const AUDIT_READ_INCOMPLETE =
  'The audit read reached its row limit, so rows without a matched entry show it as unknown rather than lost.';
/** SA-CR-B-2: what "may be archived" means, as a date. */
export const AUDIT_ARCHIVE_CUTOFF_NOTE = (cutoff: string) =>
  `Audit entries from before ${cutoff} may have been archived, so an older action without one is “may be archived”, not lost.`;
export const AUDIT_ARCHIVE_FAILED =
  'The audit archive cutoff could not be read, so older rows without an entry show it as unknown.';

// ---- The deleted-account bucket (FR-B8) ----

export const DELETED_BUCKET_LABEL = 'Account deleted';
export const DELETED_BUCKET_NOTE = 'not audit loss: the accounts were deleted after these actions ran, so they belong to no business';
export const DELETED_BUCKET_FAILED = 'Actions of deleted accounts could not be read.';
export const DELETED_BUCKET_AT_LEAST = 'at least';

// ---- Columns ----

export const COLUMNS = {
  /** B2a: the row's button that opens the drill-down. First, so a keyboard reaches it first. */
  details: 'Details',
  when: 'When (UTC)',
  business: 'Business',
  area: 'Area',
  actionType: 'Action type',
  trigger: 'Trigger',
  outcome: 'Outcome',
  cost: 'Cost (USD)',
  credits: 'Credits charged',
  calls: 'Calls / failed',
  tokens: 'Tokens',
  models: 'Models',
  errorCode: 'Error code',
  groupId: 'Grouping id',
  state: 'Record state',
} as const;

export const SHOW_ALL_BUSINESSES = 'Show all businesses';

// ---- B2a: the drill-down drawer (FR-B2, AC-B17: text, never colour alone) ----

/** The row button's visible text; its accessible name is `OPEN_DETAILS_LABEL`. */
export const OPEN_DETAILS = 'Open';
/** The button's accessible name: which action, and when, so a screen reader can tell rows apart. */
export const OPEN_DETAILS_LABEL = (actionType: string, when: string | null) =>
  `Open details for ${actionType || 'this action'}${when ? ` at ${when}` : ''}`;

export const DRILL_DOWN_TITLE = 'AI action';
export const DRILL_DOWN_LOADING = 'Reading the AI action…';
/** The route's one 404 body for every "not found": the screen says the same, and nothing more. */
export const DRILL_DOWN_NOT_FOUND = 'This AI action could not be found.';
export const DRILL_DOWN_ERROR_FALLBACK = 'Could not read the AI action';

export const DRILL_DOWN_SECTIONS = {
  action: 'Action',
  corrections: 'Corrections',
  entry: 'Audit entry',
  group: 'Grouping id',
} as const;

export const DRILL_DOWN_FIELDS = {
  business: 'Business',
  when: 'When (UTC)',
  area: 'Area',
  actionType: 'Action type',
  trigger: 'Trigger',
  outcome: 'Outcome',
  cost: 'Cost (USD)',
  credits: 'Credits charged',
  state: 'Record state',
  calls: 'Calls',
  failedCalls: 'Failed calls',
  inputTokens: 'Input tokens',
  outputTokens: 'Output tokens',
  totalTokens: 'Total tokens',
  models: 'Models',
  errorCode: 'Error code',
} as const;

export const CORRECTIONS_NONE = 'No corrections.';
export const CORRECTIONS_UNREAD = 'Corrections could not be read, so none are listed and the figures above are as charged.';
export const CORRECTION_COLUMNS = {
  when: 'When (UTC)',
  reason: 'Reason',
  cost: 'Cost (USD)',
  credits: 'Credits',
} as const;
export const CORRECTION_REASON_NONE = 'No reason recorded';

/** The entry state when there are no fields to show; the chip beside it says why. */
export const ENTRY_NO_FIELDS = 'No audit entry fields to show for this action:';

/** FR-B2, requirement `:326`: the calls of a shared group are never split between its actions. */
export const GROUP_SHARED = (count: string, atLeast: boolean) =>
  `This grouping id holds ${atLeast ? 'at least ' : ''}${count} charged actions on this account. ` +
  'Its AI calls cannot be attributed to one of them.';
export const GROUP_SINGLE = 'This grouping id holds only this charged action on this account.';
export const GROUP_FAILED = 'The other actions of this grouping id could not be read, so only this action is shown.';
export const GROUP_THIS_ACTION = 'This action';
export const GROUP_CHARGES_CAPTION = 'Charged actions of this grouping id on this account, newest first';
