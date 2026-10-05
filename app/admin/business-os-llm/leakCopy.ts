/**
 * The words of the leak check panel on the Costs & credits tab (credit
 * deduction slice 4b), in one place so the render tests assert the same
 * strings the screen shows.
 */

import type { LeakAccountStatusWire, LeakBlindSpotWire } from './leakTypes';

export const LEAK_TITLE = 'Leak check';

export const LEAK_INTRO =
  'Checks that every Business OS AI call recorded in token_usage was charged, per business and grouping id. ' +
  'It reads only; nothing is corrected. The same check runs every night at 04:45 UTC for the previous day: ' +
  'its counts are on the Scheduled jobs page and each leak is an error in the logs.';

export const LEAK_RUN = 'Run leak check';
export const LEAK_RUNNING = 'Checking…';
export const LEAK_NOT_RUN = 'Not run yet. Choose up to 7 days (UTC) and run the check.';

export const LEAK_SCOPE = (accountLabel: string | null) =>
  accountLabel ? `Checking one business: ${accountLabel}` : 'Checking every Business OS business';

export const LEAK_CLEAN = 'No uncharged AI spend found';

/** CR4b-N2 / QA4b-E2: the end pulled back to the start leaves nothing to examine. Never green. */
export const LEAK_EMPTY_WINDOW = 'Nothing to check yet — the window has not ended';

/**
 * QA4b-E1: why a row is listed when every leak column is zero. Only the
 * non-zero counts, e.g. "2 charged above usage · 1 unresolved correction".
 */
export const LEAK_ROW_NOTE = (counts: { chargedAboveUsage: number; unresolvedCorrections: number; unreadableAmounts: number }) =>
  [
    counts.chargedAboveUsage > 0 ? `${counts.chargedAboveUsage} charged above usage` : null,
    counts.unresolvedCorrections > 0
      ? `${counts.unresolvedCorrections} unresolved correction${counts.unresolvedCorrections === 1 ? '' : 's'}`
      : null,
    counts.unreadableAmounts > 0
      ? `${counts.unreadableAmounts} unreadable amount${counts.unreadableAmounts === 1 ? '' : 's'}`
      : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

export const LEAK_FOUND = (accounts: number, usd: string) =>
  `${accounts} business${accounts === 1 ? '' : 'es'} with uncharged AI spend (${usd} not charged)`;

export const LEAK_PARTIAL =
  'Not everything could be checked, so this is not a clean result. See the reasons below and run it again, ' +
  'or narrow the window.';

export const LEAK_END_CLAMPED =
  'The window’s end was pulled back to 6 minutes ago, so an action that is still running is not reported as uncharged.';

export const LEAK_TWO_NIGHTS =
  'A discrepancy near midnight can be reported on two nights in a row: a reused chat or onboarding group is examined by both.';

export const LEAK_STATUS_TEXT: Record<LeakAccountStatusWire, string> = {
  leak: 'Uncharged spend',
  could_not_check: 'Could not check',
  incomplete: 'Only partly read',
  clean: 'No leak',
};

export const LEAK_REASON_TEXT: Record<string, string> = {
  usage_read_failed: 'token_usage could not be read',
  ledger_read_failed: 'the credit ledger could not be read',
  usage_ceiling: 'too many token_usage rows',
  ledger_ceiling: 'too many ledger rows',
};

export const LEAK_COLUMNS = {
  business: 'Business',
  status: 'Status',
  period: 'Billing period',
  uncharged: 'No charge',
  ungrouped: 'No group id',
  undercharged: 'Charged less',
  pending: 'Pending reconciliation',
  known: 'Known paths',
  usd: 'Not charged (USD)',
} as const;

export const LEAK_EXAMPLES_TITLE = 'Grouping ids (look them up as token_usage.session_id)';

export const LEAK_CASE_TEXT = {
  uncharged: 'No charge',
  undercharged: 'Charged less than recorded',
  pendingReconciliation: 'Fallback-priced, pending reconciliation',
  chargedAboveUsage: 'Charged more than recorded (information)',
} as const;

export const LEAK_DIRECTION_TEXT = {
  over: 'fallback above the real cost',
  under: 'real cost above the fallback: fix the price list',
} as const;

export const LEAK_KNOWN_PATHS_TITLE = 'Known uncharged paths (accepted, not leaks)';

export const LEAK_PLATFORM = (bos: number | null, helper: number | null) =>
  `Platform account (no business can be charged for these): ${bos === null ? 'could not count' : bos} ` +
  `Business OS call${bos === 1 ? '' : 's'}, ${helper === null ? 'could not count' : helper} ` +
  `with the shared helper label onboarding / simple-complete.`;

export const LEAK_PLATFORM_ENV_IGNORED =
  'SYSTEM_ADMIN_USER_ID is set but is not a UUID, so it was left out of the platform count.';

export const LEAK_LISTING_FAILED =
  'The list of businesses could not be read in full, so some businesses were not checked.';

export const LEAK_REMAINING = (n: number) =>
  `Time ran out with ${n} business${n === 1 ? '' : 'es'} not yet checked. Run it again, or choose one business.`;

export const LEAK_BLIND_SPOTS_TITLE = 'What this check cannot see';

export const LEAK_BLIND_SPOT_TEXT: Record<LeakBlindSpotWire, string> = {
  no_plan_no_charge_account:
    'A business with neither a plan nor any charge in the window is not walked, so its spend is not checked.',
  sub_microdollar_reused_group:
    'A lost charge worth less than a micro-dollar, inside a chat or onboarding conversation that has other charges.',
  never_reached_token_usage:
    'Spend that never reached token_usage: a function stopped during a provider call, or a path that calls a provider directly.',
  outside_business_os_filter: 'Spend recorded under a feature value that is not a Business OS one.',
  edge_of_window:
    'A discrepancy at a window edge can be reported on two consecutive nights, or once at the start of a window; check the previous day.',
  fallback_masks_undercharge:
    'A lost charge in a group that also holds a fallback-priced charge shows as pending reconciliation, not as a leak.',
};
