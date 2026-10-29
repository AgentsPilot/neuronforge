/**
 * The words of the "Stripe webhook events" block on the Scheduled jobs &
 * queues page (plan payments P-8b.3b, AM-4; SA rulings P3-SA-2 items 2, 3
 * and 7, P3-SA-7). English only, like the rest of the page.
 *
 * NO imports: the jobs source guard pins that, so these words can never pull
 * code into the client. One definition constant per KPI (LL-4).
 */

/** Noun phrase for the shared parts: "Reading {what}…", "Could not read {what}…". */
export const WEBHOOK_EVENTS_WHAT = 'the webhook events';

export const WEBHOOK_EVENTS_TITLE = 'Stripe webhook events';

export const WEBHOOK_EVENTS_INTRO =
  'Events Stripe sent to our webhook that failed or are stuck, in the current Stripe mode. Read-only: each event links to its page in Stripe.';

/** The KPI labels. */
export const WEBHOOK_KPI_LABELS = {
  failed: 'Failed',
  stuck: 'Stuck',
  oldest: 'Oldest unfinished',
} as const;

/** The KPI definitions, the indicator tooltip's first line (LL-4: one each). */
export const WEBHOOK_KPI_DEFINITIONS = {
  failed:
    'Webhook events in the current Stripe mode whose last attempt failed and that nothing has completed since. Red at 1 or more.',
  stuck: (minutes: number) =>
    `Webhook events in the current Stripe mode still marked as processing more than ${minutes} minutes after their last attempt started, so that attempt has died. Red at 1 or more.`,
  oldest:
    'How long ago Stripe created the oldest failed or stuck event. Stripe keeps an event for 30 days; after that it can no longer be resent or replayed.',
} as const;

/** The chip on a red tile, in words (the page legend: red needs action). */
export const WEBHOOK_KPI_NEEDS_ACTION = 'Needs action';

/** The Oldest tile with nothing unfinished. */
export const WEBHOOK_OLDEST_NONE = 'None';

/** The Oldest tile when a state holds more rows than were read (the BlockKpi "at least" convention). */
export const WEBHOOK_AT_LEAST = (value: string) => `At least ${value}`;

export const WEBHOOK_STATE_WORDS = {
  failed: 'Failed',
  stuck: 'Stuck',
} as const;

/** Q-P3-3: the failure class in words; the message itself never reaches the page. */
export const WEBHOOK_FAILURE_WORDS = {
  handler_error: 'Our handler raised an error',
  timeout: 'Timed out',
  unknown: 'No reason recorded',
  stuck: (minutes: number) => `Still processing after ${minutes} minutes`,
} as const;

export const WEBHOOK_COLUMNS = {
  eventType: 'Event type',
  state: 'State',
  failure: 'What went wrong',
  created: 'Created at Stripe',
  lastAttempt: 'Last attempt',
  age: 'Age',
  event: 'Event',
} as const;

/** A row whose Stripe creation time was not recorded: its age counts from the last attempt. */
export const WEBHOOK_CREATED_NOT_RECORDED = 'Created time not recorded';

export const WEBHOOK_NO_EVENT_TYPE = '—';

/** The empty list, per mode. */
export const WEBHOOK_EMPTY = (modeWords: string) => `No failed or stuck webhook events in ${modeWords}.`;

/** "Showing 5 of 5 unfinished events, oldest first." */
export const WEBHOOK_COUNT_LINE = (listed: string, matching: string) =>
  `Showing ${listed} of ${matching} unfinished ${matching === '1' ? 'event' : 'events'}, oldest first.`;

/** Added to the count line when a state holds more rows than were read (P3-SA-2 item 2). */
export const WEBHOOK_ORDER_PARTIAL = (perState: string) =>
  `The order covers the first ${perState} read for each state.`;

/** Q-P3-7: unfinished events with no recorded mode; shown in either mode, never in a tile or the list. */
export const WEBHOOK_NO_MODE_LINE = (count: number, formatted: string) =>
  count === 1
    ? `${formatted} unfinished event has no recorded mode and is not counted above.`
    : `${formatted} unfinished events have no recorded mode and are not counted above.`;

/** The link's accessible name; the visible text is the event id. */
export const WEBHOOK_EVENT_LINK_LABEL = (eventId: string) => `Open ${eventId} in Stripe (opens in a new tab)`;
