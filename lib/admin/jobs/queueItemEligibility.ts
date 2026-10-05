/**
 * Can this queue item be re-sent, and can it be cancelled? (ADMIN_BOS_CLEANUP
 * slice 7a; SA C7-1, C7-2, C7-5, C7-7, C7-9, §C and §E; workplan W7A-1, W7A-7.)
 *
 * THE ONE FUNCTION for this question. The read-only list (7a) uses it to mark
 * each row, and the action routes (7b cancel, 7c re-send) call it on the server
 * before their compare-and-set. They import it; they never copy or "adjust" it.
 * The §C matrix is held here as data, so 7b/7c's check that `expected.status`
 * is an allowed "from" state reads the same table.
 *
 * ── Rules ──────────────────────────────────────────────────────────────────
 *   Re-send (retry), in this order:
 *     1. Payment automations: never (`retry_not_offered`, C7-5), whatever the
 *        status. This queue rule comes FIRST (W7A-1).
 *     2. Status not in RETRY_FROM_STATUSES (a leased or orphaned in-progress
 *        row, a terminal row, an unrecognised status): `not_retryable_state`.
 *     3. The queue rule. Briefing: only while `briefing_date` is today in the
 *        ROW's own timezone (`briefing_not_today`). The others: within 72 h of
 *        the §E anchor, inclusive (`retry_window_passed`).
 *   A missing or unparseable anchor fails closed (`no_due_time`). An invalid
 *   `now` or `retryAt` (not a finite time) fails closed too, as
 *   `retry_window_passed`: the window cannot be proved (CR7A-1).
 *   Cancel: status in CANCEL_FROM_STATUSES; an in-progress status only when
 *   `claimed_at` IS NULL (C7-2). Anything else, unrecognised statuses included,
 *   is `not_cancellable_state`, or `leased` for a claimed in-progress row.
 *
 * ── The 72-hour boundary ───────────────────────────────────────────────────
 * Inclusive: `retryAt <= anchor + 72 h`, the same inequality as 7c's CAS
 * predicate `.gte(anchor, now - 72 h)`. `Date.parse` truncates Postgres
 * microseconds to milliseconds, so the parsed anchor is never later than the
 * stored one: this function can only refuse a hair earlier than the CAS, never
 * allow what the CAS will reject.
 *
 * ── The clock ──────────────────────────────────────────────────────────────
 * PURE: no clock, no I/O, no logger. The caller passes `now`. The list passes
 * its minute-floored clock (so its stuck cut-off equals the card's); 7c must
 * pass the REAL clock. `options.retryAt` is 7c's hook for the payment
 * reminder's next sending-hours time (C7-8); it defaults to `now`, and it is
 * ignored for the briefing (today is judged on `now`) and for automations.
 *
 * The client never imports this module: the server sends the result.
 *
 * @module lib/admin/jobs/queueItemEligibility
 */

import { businessDayFor } from '@/lib/business-os/businessDay';
import type { BosQueueId } from '@/lib/cron/bosCronJobs';
import type {
  QueueItemCancelView,
  QueueItemRetryRefusal,
  QueueItemRetryView,
} from '@/lib/admin/jobs/jobsQueuesTypes';

export const RETRY_WINDOW_HOURS = 72;
const RETRY_WINDOW_MS = RETRY_WINDOW_HOURS * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

/** §C, "Retry" column. Dead-lettered rows are status `failed` on these four tables. */
export const RETRY_FROM_STATUSES: Readonly<Record<BosQueueId, readonly string[]>> = {
  payment_reminders: ['failed'],
  payment_automations: [],
  daily_briefing_sends: ['failed'],
  lead_responses: ['failed'],
  insight_actions: ['failed'],
};

/** §C, "Cancel" column. The in-progress status only when `claimed_at` IS NULL (C7-2). */
export const CANCEL_FROM_STATUSES: Readonly<Record<BosQueueId, readonly string[]>> = {
  payment_reminders: ['pending', 'failed', 'processing'],
  payment_automations: ['pending', 'failed', 'dead_letter', 'running'],
  daily_briefing_sends: ['pending', 'failed', 'processing'],
  lead_responses: ['pending', 'failed', 'processing'],
  insight_actions: ['pending', 'failed', 'processing'],
};

export const IN_PROGRESS_STATUS: Readonly<Record<BosQueueId, 'processing' | 'running'>> = {
  payment_reminders: 'processing',
  payment_automations: 'running',
  daily_briefing_sends: 'processing',
  lead_responses: 'processing',
  insight_actions: 'processing',
};

export interface QueueItemFacts {
  status: string;
  claimedAt: string | null;
  /** Payment tables only. */
  scheduledAt: string | null;
  createdAt: string;
  /** daily_briefing_sends only, 'YYYY-MM-DD'. */
  briefingDate: string | null;
  /** daily_briefing_sends only: the zone its `briefing_date` was written in (OP-2). */
  timezone: string | null;
}

export interface QueueItemEligibility {
  /** The §E anchor used, as ISO; for the briefing, its business day's first instant. Null when missing or unparseable. */
  anchorAt: string | null;
  retry: QueueItemRetryView;
  cancel: QueueItemCancelView;
}

function parseInstant(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function dateUtcMs(date: string): number | null {
  const m = ISO_DATE.exec(date);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // Refuse a date that rolled over (e.g. 2026-02-31).
  return new Date(ms).toISOString().slice(0, 10) === date ? ms : null;
}

/** The briefing's anchor: the first instant of its own business day, in its own zone. */
function briefingAnchor(
  briefingDate: string | null,
  timezone: string | null,
  now: Date
): { anchorAt: string; isToday: boolean; todayEndUtc: string } | null {
  if (!briefingDate) return null;
  const rowDay = dateUtcMs(briefingDate);
  if (rowDay === null) return null;
  // An unusable or missing zone falls back to UTC inside businessDayFor, the
  // same fallback the dispatcher gets, so the list and the send agree on today.
  const zone = timezone ?? 'UTC';
  const today = businessDayFor(now, zone);
  const todayMs = dateUtcMs(today.date);
  if (todayMs === null) return null;
  const offset = Math.round((rowDay - todayMs) / DAY_MS);
  return {
    anchorAt: offset === 0 ? today.startUtc : businessDayFor(now, zone, offset).startUtc,
    isToday: offset === 0,
    todayEndUtc: today.endUtc,
  };
}

function cancelFor(queue: BosQueueId, facts: QueueItemFacts): QueueItemCancelView {
  if (!CANCEL_FROM_STATUSES[queue].includes(facts.status)) return { allowed: false, code: 'not_cancellable_state' };
  if (facts.status === IN_PROGRESS_STATUS[queue] && facts.claimedAt !== null) return { allowed: false, code: 'leased' };
  return { allowed: true };
}

const refuse = (code: QueueItemRetryRefusal): QueueItemRetryView => ({ allowed: false, code });

export function queueItemEligibility(
  queue: BosQueueId,
  facts: QueueItemFacts,
  now: Date,
  options: { retryAt?: Date } = {}
): QueueItemEligibility {
  const cancel = cancelFor(queue, facts);
  // CR7A-1: an Invalid Date gives NaN, and `NaN > until` is false, which would
  // ALLOW a re-send. A clock that is not a finite time cannot prove the window,
  // so retry fails closed with `retry_window_passed` (no new code). Cancel does
  // not depend on the clock and is unaffected.
  const isNowValid = Number.isFinite(now.getTime());

  if (queue === 'daily_briefing_sends') {
    if (!isNowValid) {
      const code = RETRY_FROM_STATUSES[queue].includes(facts.status) ? 'retry_window_passed' : 'not_retryable_state';
      return { anchorAt: null, retry: refuse(code), cancel };
    }
    const day = briefingAnchor(facts.briefingDate, facts.timezone, now);
    const anchorAt = day?.anchorAt ?? null;
    if (!RETRY_FROM_STATUSES[queue].includes(facts.status)) return { anchorAt, retry: refuse('not_retryable_state'), cancel };
    if (!day) return { anchorAt, retry: refuse('no_due_time'), cancel };
    if (!day.isToday) return { anchorAt, retry: refuse('briefing_not_today'), cancel };
    // `until` is exclusive: the next day's first instant (W7A-7(c)).
    return { anchorAt, retry: { allowed: true, until: day.todayEndUtc }, cancel };
  }

  const anchorMs = parseInstant(queue === 'payment_reminders' || queue === 'payment_automations' ? facts.scheduledAt : facts.createdAt);
  const anchorAt = anchorMs === null ? null : new Date(anchorMs).toISOString();

  // W7A-1: the queue rule for payment automations comes before the state.
  if (queue === 'payment_automations') return { anchorAt, retry: refuse('retry_not_offered'), cancel };
  if (!RETRY_FROM_STATUSES[queue].includes(facts.status)) return { anchorAt, retry: refuse('not_retryable_state'), cancel };
  if (anchorMs === null) return { anchorAt, retry: refuse('no_due_time'), cancel };

  const until = anchorMs + RETRY_WINDOW_MS;
  const retryAt = (options.retryAt ?? now).getTime();
  if (!isNowValid || !Number.isFinite(retryAt)) return { anchorAt, retry: refuse('retry_window_passed'), cancel };
  if (retryAt > until) return { anchorAt, retry: refuse('retry_window_passed'), cancel };
  return { anchorAt, retry: { allowed: true, until: new Date(until).toISOString() }, cancel };
}
