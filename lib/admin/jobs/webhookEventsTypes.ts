/**
 * The "Stripe webhook events" block's payload (plan payments P-8b.3b, AM-4;
 * workplan docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P8B_WORKPLAN.md "Plan:
 * P-8b.3" D3-2, SA rulings P3-SA-2 items 1 to 3 and 7, P3-SA-6).
 *
 * Types only, with NO import, so the client block takes them with
 * `import type` and pulls no server code into its bundle (C-21).
 *
 * What is never here: the failure message (it may hold customer text; only
 * its CLASS is sent), a business, a user id, or a flow guess (Q-P3-1: the
 * event type is shown instead).
 *
 * @module lib/admin/jobs/webhookEventsTypes
 */

/**
 * The route's 409 words when the server's Stripe key mode cannot be read
 * (the user's G-5 wording, 2026-10-28). The same sentence as Finance's
 * `STRIPE_MODE_UNKNOWN` except its ending, which names what this page does
 * not show. Never echoes the key. Lives here, in a no-import file, so the
 * route can import it and the client never has to.
 */
export const WEBHOOK_EVENTS_MODE_UNKNOWN =
  'The server’s Stripe key mode could not be read, so no webhook events are shown.';

/** `failed`: the last attempt threw. `stuck`: still `processing` past the stale age. */
export type WebhookEventState = 'failed' | 'stuck';

/**
 * Q-P3-3: what a row's failure was, never the message itself. `refused` does
 * not exist: a refusal completes the claim, so a failed row is never one.
 */
export type WebhookFailureClass = 'handler_error' | 'timeout' | 'unknown' | 'stuck';

export interface WebhookEventRowView {
  eventId: string;
  /** Stripe's event type, e.g. `invoice.paid`; null when the row has none. */
  eventType: string | null;
  state: WebhookEventState;
  failureClass: WebhookFailureClass;
  /** Stripe's creation time (`metadata.created`, epoch seconds, converted); null when not recorded. */
  createdAt: string | null;
  /** The last attempt (`processed_at`, which a reclaim rewrites). */
  lastAttemptAt: string | null;
  /** Minutes since `createdAt`, or since `lastAttemptAt` when the creation time is not recorded. */
  ageMinutes: number | null;
  /** The Stripe dashboard page of the event, in the row's own mode; null renders the id as text. */
  dashboardUrl: string | null;
}

export interface WebhookEventsTiles {
  /** Exact head count, current mode. */
  failed: number;
  /** Exact head count, current mode. */
  stuck: number;
  /** Age of the oldest unfinished event read; null when there is none. */
  oldestAgeMinutes: number | null;
  /** True when a state holds more rows than were read, so the oldest is a lower bound ("at least"). */
  oldestAtLeast: boolean;
}

export interface WebhookEventsPayload {
  generatedAt: string;
  /** The server key's Stripe mode: the list shows only rows of this mode. */
  mode: 'test' | 'live';
  tiles: WebhookEventsTiles;
  /** Oldest first, by Stripe's creation time; at most `shownLimit` rows. */
  rows: WebhookEventRowView[];
  /** `rows.length`. */
  listed: number;
  /** Failed + stuck in this mode, so "50 of N" is honest. */
  matching: number;
  /** The most rows shown. */
  shownLimit: number;
  /** The most rows read per state; the order covers only these when `tiles.oldestAtLeast`. */
  readPerState: number;
  /** How many minutes a `processing` claim must run before it counts as stuck. */
  staleAfterMinutes: number;
  /** Q-P3-7: unfinished events with no recorded mode, in neither list nor tile. */
  noMode: number;
}
