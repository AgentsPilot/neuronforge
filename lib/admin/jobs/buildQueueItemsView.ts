/**
 * The queue item list, as the page shows it (ADMIN_BOS_CLEANUP slice 7a; SA
 * C7-9, C7-13; workplan §2.4, §2.5 and condition W7A-4).
 *
 * PURE: no clock (the route passes `now`), no I/O, no logger. `lib/admin/**`
 * never names an admin repository (slice 4 C-6), so the input row type is
 * declared here, structurally; the repository's rows satisfy it.
 *
 * ── What reaches the page (C7-13) ─────────────────────────────────────────
 * Each item is built FIELD BY FIELD from an allow-list, never a spread. The
 * account id (`userId`), the briefing's `timezone`, `claimed_at`, the raw kind
 * value and anything else on the input row are used for the computation only
 * and never copied out. Kinds and statuses become fixed labels; a value with no
 * label is "Other" or "Unrecognised status", so a new CHECK value cannot leak
 * through as text. Business names: `company_name` only (OP-1), or one of three
 * fixed sentences.
 *
 * ── Age (W7A-4) ───────────────────────────────────────────────────────────
 * No queue table records when a row failed, so a failed or dead-lettered age is
 * counted from the §E anchor, and the basis says which: `since_due` (payment
 * tables, `scheduled_at`), `since_queued` (lead replies and insight actions,
 * `created_at`), `since_day_start` (the briefing's business day, in its zone).
 *
 * @module lib/admin/jobs/buildQueueItemsView
 */

import { queueItemEligibility } from '@/lib/admin/jobs/queueItemEligibility';
import type { BosQueueId } from '@/lib/cron/bosCronJobs';
import type {
  QueueItemAction,
  QueueItemAge,
  QueueItemDue,
  QueueItemState,
  QueueItemView,
  QueueItemsView,
} from '@/lib/admin/jobs/jobsQueuesTypes';

/**
 * The queue ids the list accepts: the one list the route's Zod enum is built
 * from (the W7D-4 pattern). `satisfies` refuses an id that is not a queue; the
 * set-equality test refuses a missing one.
 */
export const QUEUE_ITEM_QUEUE_IDS = [
  'payment_reminders',
  'payment_automations',
  'daily_briefing_sends',
  'lead_responses',
  'insight_actions',
] as const satisfies readonly BosQueueId[];

/**
 * The actions `POST /api/admin/jobs-queues/items/action` performs (slice 7b
 * cancel, slice 7c retry), the one list its Zod enum is built from. Each has
 * one `case` in the route's exhaustive switch (OP-16).
 */
export const QUEUE_ITEM_ACTIONS = ['cancel', 'retry'] as const satisfies readonly QueueItemAction[];

/** The list's states, in tab order. Equal to the repository's (pinned by test). */
export const QUEUE_ITEM_STATES = ['stuck', 'failed', 'dead_lettered', 'waiting'] as const satisfies readonly QueueItemState[];

/** One queue row, as the route passes it in. Structurally the repository's RawQueueItem. */
export interface QueueItemInput {
  id: string;
  /** SERVER-ONLY: the name lookup key. Never copied into the view. */
  userId: string;
  status: string;
  attempts: number;
  claimedAt: string | null;
  createdAt: string;
  scheduledAt: string | null;
  nextAttemptAt: string | null;
  kind: string | null;
  briefingDate: string | null;
  /** SERVER-ONLY (OP-2). Never copied into the view. */
  timezone: string | null;
}

/** Fixed kind labels per queue (C7-13). A string means the queue has one kind. */
export const QUEUE_ITEM_KIND_LABELS: Readonly<Record<BosQueueId, string | Readonly<Record<string, string>>>> = {
  payment_reminders: {
    upcoming_due: 'Reminder before the due date',
    due_today: 'Due-today reminder',
    overdue: 'Overdue reminder',
    retry_failed: 'Failed-payment notice',
    payment_received: 'Payment receipt',
  },
  payment_automations: 'Payment automation',
  daily_briefing_sends: 'Morning briefing',
  // Every kind of the live CHECK (20260923_meeting_reminder.sql); a test reads
  // that migration, so a new kind fails a test instead of showing "Other" (W7B-11).
  lead_responses: {
    invite: 'Booking invite to a new lead',
    chase: 'Follow-up to a lead',
    invoice_chase: 'Invoice chase to a client',
    intake_chase: 'Intake form reminder',
    meeting_reminder: 'Meeting reminder',
  },
  insight_actions: {
    chase_invoice: 'Invoice chase',
    followup_nudge: 'Follow-up nudge',
    booking_reminder: 'Booking reminder',
  },
};

const OTHER_KIND = 'Other';

/** Fixed status labels; an unknown status reads "Unrecognised status". */
export const QUEUE_ITEM_STATUS_LABELS: Readonly<Record<string, string>> = {
  pending: 'Waiting',
  processing: 'In progress',
  running: 'In progress',
  failed: 'Failed',
  dead_letter: 'Dead-lettered',
  sent: 'Sent',
  completed: 'Completed',
  skipped: 'Skipped',
  cancelled: 'Cancelled',
};

const DEAD_LETTERED_LABEL = 'Dead-lettered';
const UNRECOGNISED_STATUS = 'Unrecognised status';

export const BUSINESS_NAME_EMPTY = 'Business without a name';
export const BUSINESS_NAME_NO_PROFILE = 'No business profile';
export const BUSINESS_NAME_UNAVAILABLE = 'Name not available';

const own = (table: Readonly<Record<string, string>>, key: string): string | undefined =>
  Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;

/** The fixed label for a status word; an unknown one is "Unrecognised status" (slice 7b responses). */
export function statusLabelFor(status: string): string {
  return own(QUEUE_ITEM_STATUS_LABELS, status) ?? UNRECOGNISED_STATUS;
}

/** The fixed label for a row's kind on a queue. Never the raw value. */
export function kindLabel(queue: BosQueueId, kind: string | null): string {
  const labels = QUEUE_ITEM_KIND_LABELS[queue];
  if (typeof labels === 'string') return labels;
  if (kind === null) return OTHER_KIND;
  return own(labels, kind) ?? OTHER_KIND;
}

function businessNameFor(userId: string, names: ReadonlyMap<string, string | null> | null): string {
  if (names === null) return BUSINESS_NAME_UNAVAILABLE;
  if (!names.has(userId)) return BUSINESS_NAME_NO_PROFILE;
  const name = names.get(userId)?.trim();
  return name ? name : BUSINESS_NAME_EMPTY;
}

const isPaymentTable = (queue: BosQueueId) => queue === 'payment_reminders' || queue === 'payment_automations';

function parse(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** Whole minutes from `from` to `now`, truncated toward zero; null without a time. */
function minutesSince(from: number | null, now: Date): number | null {
  if (from === null) return null;
  const minutes = Math.trunc((now.getTime() - from) / 60_000);
  return minutes === 0 ? 0 : minutes; // no "-0"
}

function dueOf(queue: BosQueueId, row: QueueItemInput): QueueItemDue {
  if (isPaymentTable(queue)) return { basis: 'scheduled', at: row.scheduledAt };
  if (queue === 'daily_briefing_sends') return { basis: 'business_day', date: row.briefingDate };
  return { basis: 'queued', at: row.createdAt };
}

/** The card's "due now" rule: payment tables the later of the two times, else next_attempt_at ?? created_at. */
function effectiveDue(queue: BosQueueId, row: QueueItemInput): number | null {
  if (isPaymentTable(queue)) {
    const scheduled = parse(row.scheduledAt);
    if (scheduled === null) return null; // automations with no due time are never picked up
    const next = parse(row.nextAttemptAt);
    return next === null ? scheduled : Math.max(scheduled, next);
  }
  return parse(row.nextAttemptAt) ?? parse(row.createdAt);
}

function ageOf(
  queue: BosQueueId,
  state: QueueItemState,
  row: QueueItemInput,
  anchorAt: string | null,
  now: Date
): QueueItemAge {
  if (state === 'stuck') {
    const claimed = parse(row.claimedAt);
    return claimed === null ? { minutes: null, basis: 'no_lease' } : { minutes: minutesSince(claimed, now), basis: 'since_claimed' };
  }
  if (state === 'waiting') return { minutes: minutesSince(effectiveDue(queue, row), now), basis: 'overdue' };
  // failed / dead_lettered: from the §E anchor, which the eligibility function resolved.
  const basis = isPaymentTable(queue) ? 'since_due' : queue === 'daily_briefing_sends' ? 'since_day_start' : 'since_queued';
  return { minutes: minutesSince(parse(anchorAt), now), basis };
}

function itemOf(
  queue: BosQueueId,
  state: QueueItemState,
  row: QueueItemInput,
  names: ReadonlyMap<string, string | null> | null,
  now: Date
): QueueItemView {
  const eligibility = queueItemEligibility(
    queue,
    {
      status: row.status,
      claimedAt: row.claimedAt,
      scheduledAt: row.scheduledAt,
      createdAt: row.createdAt,
      briefingDate: row.briefingDate,
      timezone: row.timezone,
    },
    now
  );
  const errorCategory = state === 'failed' ? 'failed' : state === 'dead_lettered' ? 'dead_lettered' : null;
  const statusLabel =
    errorCategory === 'dead_lettered' ? DEAD_LETTERED_LABEL : (own(QUEUE_ITEM_STATUS_LABELS, row.status) ?? UNRECOGNISED_STATUS);
  return {
    id: row.id,
    businessName: businessNameFor(row.userId, names),
    kindLabel: kindLabel(queue, row.kind),
    status: row.status,
    statusLabel,
    state,
    errorCategory,
    attempts: row.attempts,
    due: dueOf(queue, row),
    nextAttemptAt: state === 'waiting' ? row.nextAttemptAt : null,
    age: ageOf(queue, state, row, eligibility.anchorAt, now),
    lease: state === 'stuck' ? (row.claimedAt === null ? 'none' : 'expired') : null,
    retry: eligibility.retry,
    cancel: eligibility.cancel,
  };
}

export function buildQueueItemsView(input: {
  queue: BosQueueId;
  state: QueueItemState;
  page: number;
  pageSize: number;
  /**
   * The route's page cap, passed in as `pageSize` is: this module must not
   * import the repository that owns it (CR7A-2).
   */
  maxPage: number;
  /** null = the page asked for is past the end (W7A-2). */
  total: number | null;
  rows: readonly QueueItemInput[];
  /** user_id → company_name; `null` = the lookup failed; a missing key = no profile row. */
  names: ReadonlyMap<string, string | null> | null;
  now: Date;
}): QueueItemsView {
  const { queue, state, page, pageSize, maxPage, total, names, now } = input;
  const items = input.rows.slice(0, pageSize).map((row) => itemOf(queue, state, row, names, now));
  return {
    queue,
    state,
    now: now.toISOString(),
    page,
    pageSize,
    maxPage,
    total,
    // CR7A-2 / QA-7A-1: no Next past the cap, or it asks for a page the route rejects.
    hasMore: total !== null && page < maxPage && page * pageSize < total,
    items,
  };
}
