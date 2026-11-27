/**
 * The drawer's "What happens next" lines (account deletion lifecycle DL-2b;
 * workplan docs/workplans/BUSINESS_OS_DELETION_DL2_WORKPLAN.md §6.3, §9.2,
 * D-6, D-12; SA W-13).
 *
 *   paid   plan end (the trial variant when `trialing`, W-13), then "no
 *          refund" (left out for a trial), then what the account is on for the
 *          grace days, then the lock date
 *   free   the grace days, then the lock date
 *   null   one general line
 *   bookings  count > 1 → `bookings`; 1 → `bookings_one`; null → "we couldn't
 *          count" (never a 0, D-12); 0 → nothing
 *
 * Every date is formatted with `formatAccountDay(iso, language,
 * timeline.timezone)`: on the owner's clock, never the browser's (D-6). A date
 * that will not format turns the whole timeline into the general line rather
 * than a sentence with a hole in it. That includes a THROW while formatting
 * (QA note 2): `toLocaleDateString` throws a RangeError for a zone this
 * runtime's Intl does not know, which the server's Node may accept and an
 * older browser may not. `formatAccountDay` is PLAN PAYMENTS' and stays as is;
 * the catch is here.
 *
 * Pure and client-safe (SA W-5): no repository, no deps file, no date helper
 * of the server's; `formatAccountDay` is PLAN PAYMENTS' client-safe
 * formatter (import only) and `GRACE_DAYS` comes from the import-free
 * lifecycle file.
 *
 * @module components/business-os/account-deletion/whatHappens
 */

import { formatAccountDay } from '@/components/business-os/settings/planUpgradeCopy';
import { GRACE_DAYS } from '@/lib/business-os/account-deletion/closureLifecycle';
import type { ClosureTimeline, FutureBookings } from '@/lib/business-os/account-deletion/schemas';

const PREFIX = 'settings.account_delete.what_happens.';

/** Every key this section may render (the copy parity tests read this list). */
export const WHAT_HAPPENS_KEYS = [
  `${PREFIX}heading`,
  `${PREFIX}paid_plan_end`,
  `${PREFIX}paid_plan_end_trial`,
  `${PREFIX}during_free_plan`,
  `${PREFIX}during_back_to_plan`,
  `${PREFIX}during_unknown`,
  `${PREFIX}free_grace`,
  `${PREFIX}lock`,
  `${PREFIX}general`,
  `${PREFIX}bookings`,
  `${PREFIX}bookings_one`,
  `${PREFIX}bookings_unknown`,
] as const;

/** Reused from the plan cancel (Q-16): the request stops renewal the same way. */
export const NO_REFUND_KEY = 'settings.plan_cancel.review.no_refund';

export interface WhatHappensLine {
  key: string;
  vars?: Record<string, string | number>;
}

/** `formatAccountDay`, with a throw (an unknown zone) read as "cannot be formatted". */
function formatDaySafely(iso: string, language: string, timeZone: string): string | null {
  try {
    return formatAccountDay(iso, language, timeZone);
  } catch {
    return null;
  }
}

function timelineLines(timeline: ClosureTimeline | null, language: string): { lines: WhatHappensLine[]; lockDate: string | null } {
  const general: WhatHappensLine[] = [{ key: `${PREFIX}general`, vars: { days: timeline?.graceDays ?? GRACE_DAYS } }];
  if (!timeline) return { lines: general, lockDate: null };

  const lockDate = formatDaySafely(timeline.lockAt, language, timeline.timezone);
  if (!lockDate) return { lines: general, lockDate: null };
  const days = timeline.graceDays;

  if (timeline.kind === 'free') {
    return { lines: [{ key: `${PREFIX}free_grace`, vars: { days } }, { key: `${PREFIX}lock`, vars: { lockDate } }], lockDate };
  }

  const planEnd = formatDaySafely(timeline.planEndsAt, language, timeline.timezone);
  if (!planEnd) return { lines: general, lockDate };
  const lines: WhatHappensLine[] = [];
  // W-13: a trial was never charged, so neither "charged again" nor "no refund" is true.
  lines.push({ key: timeline.trialing ? `${PREFIX}paid_plan_end_trial` : `${PREFIX}paid_plan_end`, vars: { planEnd } });
  if (!timeline.trialing) lines.push({ key: NO_REFUND_KEY });
  if (timeline.during === 'free_plan' && timeline.planName) {
    lines.push({ key: `${PREFIX}during_free_plan`, vars: { days, plan: timeline.planName } });
  } else if (timeline.during === 'back_to_plan' && timeline.planName) {
    lines.push({ key: `${PREFIX}during_back_to_plan`, vars: { days, plan: timeline.planName } });
  } else {
    lines.push({ key: `${PREFIX}during_unknown`, vars: { days } });
  }
  lines.push({ key: `${PREFIX}lock`, vars: { lockDate } });
  return { lines, lockDate };
}

function bookingLines(futureBookings: FutureBookings | undefined, lockDate: string | null): WhatHappensLine[] {
  // Absent: a server from before DL-2b does not say, so nothing is claimed.
  if (!futureBookings) return [];
  const { count } = futureBookings;
  if (count === 0) return [];
  // A count with no date to name cannot be said truthfully as a number; say we could not.
  if (count === null || lockDate === null) return [{ key: `${PREFIX}bookings_unknown` }];
  if (count === 1) return [{ key: `${PREFIX}bookings_one`, vars: { lockDate } }];
  return [{ key: `${PREFIX}bookings`, vars: { n: count, lockDate } }];
}

/**
 * The section's lines, or null when the section is not shown: the server did
 * not send either field (an answer from before DL-2b).
 */
export function whatHappensLines(
  check: { timeline?: ClosureTimeline | null; futureBookings?: FutureBookings },
  language: string
): WhatHappensLine[] | null {
  if (check.timeline === undefined && check.futureBookings === undefined) return null;
  const { lines, lockDate } = timelineLines(check.timeline ?? null, language);
  return [...lines, ...bookingLines(check.futureBookings, lockDate)];
}
