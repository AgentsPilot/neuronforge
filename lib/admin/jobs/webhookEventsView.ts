import 'server-only';

/**
 * Builds the "Stripe webhook events" payload from the read rows (plan
 * payments P-8b.3b, AM-4; workplan "Plan: P-8b.3" D3-2, SA rulings P3-SA-2
 * items 1 to 3 and 7, P3-SA-6, P3-SA-7).
 *
 * Pure: no I/O and no logging. Field by field, an allow-list: a row's
 * `failure_message` is read ONLY by `classifyWebhookFailure`, and nothing of
 * it, nor of the raw `metadata`, reaches the payload.
 *
 * The order is Stripe's creation time (`metadata.created`, epoch SECONDS,
 * converted here once), not the last attempt, which a reclaim rewrites. The
 * read is up to 200 per state, so when a state holds more, the Oldest tile is
 * a lower bound and says "at least" (P3-SA-2 item 2).
 *
 * @module lib/admin/jobs/webhookEventsView
 */

import { stripeDashboardUrl } from '@/lib/business-os/boost/boostAdminView';
import type {
  AdminWebhookEventCounts,
  AdminWebhookEventLists,
  AdminWebhookEventRow,
} from '@/lib/repositories/AdminWebhookEventReadRepository';
import type {
  WebhookEventRowView,
  WebhookEventState,
  WebhookEventsPayload,
  WebhookFailureClass,
} from '@/lib/admin/jobs/webhookEventsTypes';

/** The most rows the block lists (D3-2). */
export const WEBHOOK_EVENTS_SHOWN_LIMIT = 50;

/**
 * Q-P3-3: the one timeout pattern. A killed function leaves its claim
 * `processing` (stuck), so a `failed` row is a timeout only when the thrown
 * error said so: "timed out", "timeout", "time out", `ETIMEDOUT`,
 * `ESOCKETTIMEDOUT`, or "deadline exceeded".
 */
export const WEBHOOK_TIMEOUT_PATTERN = /\b(?:timed?[\s_-]?out|E(?:SOCKET)?TIMEDOUT|deadline exceeded)\b/i;

/**
 * The class of a row's failure (Q-P3-3). The message never leaves this
 * function: the caller keeps only the class.
 */
export function classifyWebhookFailure(state: WebhookEventState, message: string | null | undefined): WebhookFailureClass {
  if (state === 'stuck') return 'stuck';
  if (typeof message !== 'string' || message.trim() === '') return 'unknown';
  return WEBHOOK_TIMEOUT_PATTERN.test(message) ? 'timeout' : 'handler_error';
}

function metadataField(metadata: unknown, key: 'created' | 'livemode'): unknown {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
  return (metadata as Record<string, unknown>)[key];
}

/**
 * The latest instant shown as a creation time: the end of the year 9999. A
 * later value (or one past what `Date` can hold, where `toISOString` throws)
 * is treated as not recorded, so one bad row never fails the block (QA Low 2).
 */
const MAX_CREATED_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

/**
 * Stripe's `created` (epoch SECONDS, as the webhook stores it) in
 * milliseconds; null when absent, not a positive finite number, or out of
 * range (after the year 9999). A null makes the row count its age from the
 * last attempt and say "Created time not recorded".
 */
export function stripeCreatedMs(metadata: unknown): number | null {
  const created = metadataField(metadata, 'created');
  if (typeof created !== 'number' || !Number.isFinite(created) || created <= 0) return null;
  const ms = created * 1000;
  return ms <= MAX_CREATED_MS ? ms : null;
}

function isoMs(iso: string | null): number | null {
  if (typeof iso !== 'string') return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

interface SortableRow {
  view: WebhookEventRowView;
  basisMs: number | null;
}

function toRow(row: AdminWebhookEventRow, state: WebhookEventState, nowMs: number): SortableRow {
  const createdMs = stripeCreatedMs(row.metadata);
  const lastAttemptMs = isoMs(row.processed_at);
  const basisMs = createdMs ?? lastAttemptMs;
  // The row's own mode decides the dashboard path (SA C-4); a row with no
  // boolean mode gets no link (it is never listed: Q-P3-7).
  const livemode = metadataField(row.metadata, 'livemode');
  return {
    basisMs,
    view: {
      eventId: row.event_id,
      eventType: typeof row.event_type === 'string' && row.event_type !== '' ? row.event_type : null,
      state,
      failureClass: classifyWebhookFailure(state, row.failure_message),
      createdAt: createdMs === null ? null : new Date(createdMs).toISOString(),
      lastAttemptAt: lastAttemptMs === null ? null : new Date(lastAttemptMs).toISOString(),
      ageMinutes: basisMs === null ? null : Math.max(0, Math.floor((nowMs - basisMs) / 60_000)),
      dashboardUrl: typeof livemode === 'boolean' ? stripeDashboardUrl('event', row.event_id, livemode) : null,
    },
  };
}

/** Oldest first; a row with no time at all goes last; the event id breaks ties. */
function oldestFirst(a: SortableRow, b: SortableRow): number {
  if (a.basisMs !== b.basisMs) {
    if (a.basisMs === null) return 1;
    if (b.basisMs === null) return -1;
    return a.basisMs - b.basisMs;
  }
  return a.view.eventId < b.view.eventId ? -1 : a.view.eventId > b.view.eventId ? 1 : 0;
}

export interface WebhookEventsInput {
  mode: 'test' | 'live';
  now: Date;
  counts: AdminWebhookEventCounts;
  lists: AdminWebhookEventLists;
  noMode: AdminWebhookEventCounts;
  readPerState: number;
  staleAfterMs: number;
}

export function buildWebhookEventsView(input: WebhookEventsInput): WebhookEventsPayload {
  const nowMs = input.now.getTime();
  const all = [
    ...input.lists.failed.map((row) => toRow(row, 'failed', nowMs)),
    ...input.lists.stuck.map((row) => toRow(row, 'stuck', nowMs)),
  ].sort(oldestFirst);

  const rows = all.slice(0, WEBHOOK_EVENTS_SHOWN_LIMIT).map((row) => row.view);
  const oldest = all.find((row) => row.view.ageMinutes !== null);
  // A state whose read was cut at the limit while its count is higher: the
  // true oldest may be unread. The count and the list are two concurrent
  // reads, so a row changing between them must not read as a cut below the
  // limit (QA Low 1): a list shorter than the limit was never cut.
  const cut = (count: number, read: number) => read >= input.readPerState && count > read;
  const oldestAtLeast =
    cut(input.counts.failed, input.lists.failed.length) || cut(input.counts.stuck, input.lists.stuck.length);
  // The same race the other way (a row completing between the reads) must
  // never say "Showing 2 of 1": the total is at least what was read.
  const matching = Math.max(input.counts.failed + input.counts.stuck, all.length);

  return {
    generatedAt: input.now.toISOString(),
    mode: input.mode,
    tiles: {
      failed: input.counts.failed,
      stuck: input.counts.stuck,
      oldestAgeMinutes: oldest ? oldest.view.ageMinutes : null,
      oldestAtLeast,
    },
    rows,
    listed: rows.length,
    matching,
    shownLimit: WEBHOOK_EVENTS_SHOWN_LIMIT,
    readPerState: input.readPerState,
    staleAfterMinutes: Math.round(input.staleAfterMs / 60_000),
    noMode: input.noMode.failed + input.noMode.stuck,
  };
}
