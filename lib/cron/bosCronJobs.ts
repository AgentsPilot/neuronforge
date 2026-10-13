/**
 * The Business OS scheduled jobs and the queues they drain, as data (admin
 * reorganisation slice 5; workplan §5.3).
 *
 * THE ONE SOURCE for: which jobs exist, their schedule, when a job counts as
 * late or stopped, its time limit, which numbers from its response are
 * recorded, and when a finished run counts as "partly done". The recorder
 * (`lib/cron/cronRunRecorder.ts`), the admin page and the Health tiles all read
 * it; `lib/cron/__tests__/bosCronJobs.test.ts` pins it to `vercel.json`, to
 * each route's `maxDuration`, and to the database's key rule.
 *
 * NO IMPORTS, on purpose (SA SC-8): it is imported by the pure admin
 * evaluator and, through types only, by the client page. A source test pins
 * that this file imports nothing.
 *
 * ── Late and stopped (requirement §S5.7) ──────────────────────────────────
 *   late    = more than  interval + grace   since the last Vercel cron start
 *   stopped = more than 2×interval + grace
 *   grace   = 10 min for jobs that run hourly or more often, 60 min for daily
 *
 * ── Counts (SA SC-11) ─────────────────────────────────────────────────────
 * Only finite numbers are kept (a true/false flag becomes 1/0); anything else
 * is dropped. NO MONEY: no key or path segment may name a value, amount, price,
 * cost, revenue or impact (the test enforces it). Keys must satisfy the
 * database's rule `^[a-zA-Z][a-zA-Z0-9]{0,39}$`.
 *
 * @module lib/cron/bosCronJobs
 */

export type BosCronJobId =
  | 'calendar-sync'
  | 'lead-response'
  | 'insight-automations'
  | 'insight-actions'
  | 'payment-retry'
  | 'daily-briefing'
  | 'intake-reminders'
  | 'abandoned-proposal-invoices'
  | 'channel-metrics-sync'
  | 'insight-metrics'
  | 'insight-detect'
  | 'insight-hypotheses'
  | 'insight-measure'
  | 'credit-leak-check'
  | 'stripe-settlement-gap'
  | 'bos-billing-reconcile'
  | 'payment-reminders';

export type BosQueueId =
  | 'payment_reminders'
  | 'payment_automations'
  | 'daily_briefing_sends'
  | 'lead_responses'
  | 'insight_actions';

/** One number taken from a job's JSON response. */
export interface CronCountSpec {
  /** Stored key, `^[a-zA-Z][a-zA-Z0-9]{0,39}$`. */
  key: string;
  /** Where it sits in the response body. */
  path: readonly string[];
  /** Plain words for the page. */
  label: string;
}

/** When a run that succeeded still counts as "partly done" (amber). */
export type PartlyDoneCondition =
  | { kind: 'atLeast'; key: string; value: number }
  | { kind: 'exceeds'; key: string; other: string };

export interface BosCronJob {
  id: BosCronJobId;
  path: string;
  /** Byte for byte as in vercel.json. */
  schedule: string;
  intervalMinutes: number;
  graceMinutes: number;
  /** Runs in a row that must be bad for "keeps failing" (3; daily jobs 2). */
  keepsFailingAfter: number;
  /**
   * An upper bound on how long the platform lets one run live (SA SC-6). A run
   * still "running" after this plus RUN_DEADLINE_MARGIN_SECONDS did not finish.
   */
  timeLimitSeconds: number;
  /**
   * Where `timeLimitSeconds` comes from. `'maxDuration'` = the route's own
   * export. `'assumed_pending_L-5.10'` = the route exports none, so 300 s is
   * ASSUMED as the platform default until live check L-5.10 (Vercel project
   * settings, asked of Offir) confirms it. L-5.10 is a pre-merge gate.
   */
  timeLimitSource: 'maxDuration' | 'assumed_pending_L-5.10';
  label: string;
  description: string;
  scheduleWords: string;
  drainsQueue: BosQueueId | null;
  counts: readonly CronCountSpec[];
  partlyDoneWhen: readonly PartlyDoneCondition[];
  /**
   * The UTC day (`YYYY-MM-DD`) this job was deployed, for jobs added AFTER run
   * recording began (QA4b-B1). A job with no Vercel cron run is otherwise timed
   * from the first run of ANY job (F-6), so a job added days later would read
   * "Stopped" on its first page load. With this set, a job with no run is timed
   * from the END of that day (the deploy can land at any hour, and a daily
   * job's first run is the next morning) or the global baseline, whichever is
   * later: "No run yet" through its first expected period, then late and
   * stopped by the usual rules. Omitted = the global baseline (unchanged).
   * Must be the real deploy day: a date earlier than the deploy brings the
   * false "Stopped" back.
   */
  addedOn?: string;
}

export interface BosQueue {
  id: BosQueueId;
  label: string;
  drainedBy: BosCronJobId;
  /**
   * Failed and dead-lettered items are counted by when they were DUE (the two
   * payment tables) or QUEUED (the other three): no queue table records when
   * a row failed (workplan V-10, fork F-8).
   */
  windowBasis: 'due' | 'queued';
  /** One fixed line shown under the queue, or null. */
  note: string | null;
}

/** Added to a job's time limit before a running row counts as "did not finish". */
export const RUN_DEADLINE_MARGIN_SECONDS = 60;

/** Days of run history kept (OQ-6). */
export const RUN_HISTORY_DAYS = 30;

/** The five routes that export no `maxDuration`: assumed platform default, pending L-5.10. */
const ASSUMED_PLATFORM_LIMIT_SECONDS = 300;

const EVERY_5 = { intervalMinutes: 5, graceMinutes: 10, keepsFailingAfter: 3 } as const;
const EVERY_15 = { intervalMinutes: 15, graceMinutes: 10, keepsFailingAfter: 3 } as const;
const HOURLY = { intervalMinutes: 60, graceMinutes: 10, keepsFailingAfter: 3 } as const;
const DAILY = { intervalMinutes: 1440, graceMinutes: 60, keepsFailingAfter: 2 } as const;
/*
 * A weekly job gets a wider grace and a shorter patience than a daily one: it
 * has six more days of slack before anyone notices a miss, so waiting two
 * misses would be a fortnight of silence. One failure is worth surfacing.
 */
const WEEKLY = { intervalMinutes: 10_080, graceMinutes: 180, keepsFailingAfter: 1 } as const;

const ASSUMED = {
  timeLimitSeconds: ASSUMED_PLATFORM_LIMIT_SECONDS,
  timeLimitSource: 'assumed_pending_L-5.10',
} as const;
const MAX_60 = { timeLimitSeconds: 60, timeLimitSource: 'maxDuration' } as const;

/** In the order the page lists them: most frequent first (requirement §S5.7). */
export const BOS_CRON_JOBS: readonly BosCronJob[] = [
  {
    id: 'calendar-sync',
    path: '/api/cron/calendar-sync',
    schedule: '*/5 * * * *',
    ...EVERY_5,
    ...ASSUMED,
    label: 'Calendar sync',
    description: 'Pulls external calendar events for businesses with sync on',
    scheduleWords: 'Every 5 minutes',
    drainsQueue: null,
    counts: [
      { key: 'total', path: ['total'], label: 'businesses due' },
      { key: 'synced', path: ['synced'], label: 'synced' },
      { key: 'failed', path: ['failed'], label: 'failed' },
    ],
    partlyDoneWhen: [{ kind: 'atLeast', key: 'failed', value: 1 }],
  },
  {
    id: 'lead-response',
    path: '/api/cron/lead-response',
    schedule: '*/5 * * * *',
    ...EVERY_5,
    ...MAX_60,
    label: 'Lead replies',
    description: 'Sends queued replies to new enquiries',
    scheduleWords: 'Every 5 minutes',
    drainsQueue: 'lead_responses',
    counts: [
      { key: 'reaped', path: ['reaped'], label: 'recovered from a dead run' },
      { key: 'enqueued', path: ['enqueued'], label: 'queued' },
      { key: 'claimed', path: ['claimed'], label: 'picked up' },
      { key: 'sent', path: ['sent'], label: 'sent' },
      { key: 'skipped', path: ['skipped'], label: 'skipped' },
    ],
    partlyDoneWhen: [],
  },
  {
    id: 'insight-automations',
    path: '/api/cron/insight-automations',
    schedule: '*/5 * * * *',
    ...EVERY_5,
    ...ASSUMED,
    label: 'Insight automations',
    description: 'Checks standing insight automations and queues their actions',
    scheduleWords: 'Every 5 minutes',
    drainsQueue: null,
    counts: [
      { key: 'automationsChecked', path: ['data', 'automationsChecked'], label: 'checked' },
      { key: 'automationsExecuted', path: ['data', 'automationsExecuted'], label: 'ran' },
      { key: 'automationsSkipped', path: ['data', 'automationsSkipped'], label: 'skipped' },
      { key: 'automationsFailed', path: ['data', 'automationsFailed'], label: 'failed' },
      { key: 'itemsProcessed', path: ['data', 'totalItemsProcessed'], label: 'items processed' },
    ],
    partlyDoneWhen: [{ kind: 'atLeast', key: 'automationsFailed', value: 1 }],
  },
  {
    id: 'insight-actions',
    path: '/api/cron/insight-actions',
    schedule: '*/15 * * * *',
    ...EVERY_15,
    ...MAX_60,
    label: 'Insight actions',
    description: 'Sends actions that insight automations queued',
    scheduleWords: 'Every 15 minutes',
    drainsQueue: 'insight_actions',
    counts: [
      { key: 'reaped', path: ['reaped'], label: 'recovered from a dead run' },
      { key: 'claimed', path: ['claimed'], label: 'picked up' },
      { key: 'sent', path: ['sent'], label: 'sent' },
      { key: 'skipped', path: ['skipped'], label: 'skipped' },
      { key: 'failed', path: ['failed'], label: 'failed' },
    ],
    partlyDoneWhen: [{ kind: 'atLeast', key: 'failed', value: 1 }],
  },
  {
    id: 'payment-retry',
    path: '/api/cron/payment-retry',
    schedule: '0 * * * *',
    ...HOURLY,
    ...MAX_60,
    label: 'Payment retry',
    description: 'Retries failed payments; runs scheduled payment automations',
    scheduleWords: 'Hourly at :00',
    drainsQueue: 'payment_automations',
    counts: [
      { key: 'processedInvoices', path: ['data', 'retryStats', 'processedInvoices'], label: 'invoices retried' },
      { key: 'processedInstallments', path: ['data', 'retryStats', 'processedInstallments'], label: 'instalments retried' },
      { key: 'retriesSucceeded', path: ['data', 'retryStats', 'successCount'], label: 'retries that went through' },
      // User decision Q-U2: a declined card is a business outcome, not a job
      // fault. Shown as a number; never colours the job (no partlyDoneWhen).
      { key: 'retriesDeclined', path: ['data', 'retryStats', 'failureCount'], label: 'retries declined or failed' },
    ],
    partlyDoneWhen: [],
  },
  {
    id: 'daily-briefing',
    path: '/api/cron/daily-briefing',
    schedule: '10 * * * *',
    ...HOURLY,
    ...MAX_60,
    label: 'Morning briefing',
    description: 'Queues and sends morning briefing emails, per business timezone',
    scheduleWords: 'Hourly at :10',
    drainsQueue: 'daily_briefing_sends',
    counts: [
      { key: 'enqueued', path: ['data', 'enqueued'], label: 'queued' },
      { key: 'sent', path: ['data', 'sent'], label: 'sent' },
      { key: 'skipped', path: ['data', 'skipped'], label: 'skipped (a quiet day)' },
      { key: 'failed', path: ['data', 'failed'], label: 'failed' },
    ],
    partlyDoneWhen: [{ kind: 'atLeast', key: 'failed', value: 1 }],
  },
  {
    id: 'intake-reminders',
    path: '/api/cron/intake-reminders',
    schedule: '15 * * * *',
    ...HOURLY,
    ...MAX_60,
    label: 'Intake reminders',
    description: "Reminds clients to fill in intake forms before tomorrow's meeting",
    scheduleWords: 'Hourly at :15',
    drainsQueue: null,
    counts: [
      { key: 'considered', path: ['considered'], label: 'bookings considered' },
      { key: 'sent', path: ['sent'], label: 'sent' },
      { key: 'skipped', path: ['skipped'], label: 'skipped' },
      { key: 'failed', path: ['failed'], label: 'failed' },
    ],
    partlyDoneWhen: [{ kind: 'atLeast', key: 'failed', value: 1 }],
  },
  {
    id: 'abandoned-proposal-invoices',
    path: '/api/cron/abandoned-proposal-invoices',
    schedule: '20 * * * *',
    ...HOURLY,
    ...ASSUMED,
    label: 'Abandoned quote invoices',
    description: 'Emails the invoice to clients who accepted a quote and left',
    scheduleWords: 'Hourly at :20',
    drainsQueue: null,
    counts: [
      { key: 'considered', path: ['considered'], label: 'invoices considered' },
      { key: 'sent', path: ['sent'], label: 'sent' },
    ],
    partlyDoneWhen: [{ kind: 'exceeds', key: 'considered', other: 'sent' }],
  },
  {
    id: 'channel-metrics-sync',
    path: '/api/cron/channel-metrics-sync',
    schedule: '30 * * * *',
    ...HOURLY,
    ...ASSUMED,
    label: 'Channel stats sync',
    description: 'Pulls Facebook, Instagram, Google Business and GA4 stats',
    scheduleWords: 'Hourly at :30',
    drainsQueue: null,
    counts: [
      { key: 'processed', path: ['processed'], label: 'connections synced' },
      { key: 'failed', path: ['failed'], label: 'failed' },
      { key: 'hitLimit', path: ['hitLimit'], label: 'stopped at its per-run limit (1 = yes)' },
    ],
    partlyDoneWhen: [
      { kind: 'atLeast', key: 'failed', value: 1 },
      { kind: 'atLeast', key: 'hitLimit', value: 1 },
    ],
  },
  {
    id: 'insight-metrics',
    path: '/api/cron/insight-metrics',
    schedule: '0 3 * * *',
    ...DAILY,
    ...ASSUMED,
    label: 'Insight metrics',
    description: 'Rebuilds the metrics the insight detectors read',
    scheduleWords: 'Daily at 03:00 UTC',
    drainsQueue: null,
    counts: [
      { key: 'usersProcessed', path: ['data', 'usersProcessed'], label: 'businesses processed' },
      { key: 'metricsComputed', path: ['data', 'metricsComputed'], label: 'metrics computed' },
      { key: 'errors', path: ['data', 'errors'], label: 'businesses that failed' },
    ],
    partlyDoneWhen: [{ kind: 'atLeast', key: 'errors', value: 1 }],
  },
  {
    id: 'insight-detect',
    path: '/api/cron/insight-detect',
    schedule: '30 3 * * *',
    ...DAILY,
    timeLimitSeconds: 300,
    timeLimitSource: 'maxDuration',
    label: 'Insight detection',
    description: 'Runs the insight detectors for every active business',
    scheduleWords: 'Daily at 03:30 UTC',
    drainsQueue: null,
    counts: [
      { key: 'usersProcessed', path: ['data', 'usersProcessed'], label: 'businesses processed' },
      { key: 'insightsCreated', path: ['data', 'insightsCreated'], label: 'insights created' },
      { key: 'insightsResolved', path: ['data', 'insightsResolved'], label: 'insights resolved' },
      { key: 'errors', path: ['data', 'errors'], label: 'businesses that failed' },
      { key: 'usersRemaining', path: ['data', 'usersRemaining'], label: 'businesses left for the next run' },
    ],
    partlyDoneWhen: [
      { kind: 'atLeast', key: 'errors', value: 1 },
      { kind: 'atLeast', key: 'usersRemaining', value: 1 },
    ],
  },
  {
    id: 'insight-measure',
    path: '/api/cron/insight-measure',
    /*
     * 04:55, and the minute is chosen rather than inherited.
     *
     * After `insight-metrics` (03:00) and `insight-detect` (03:30), because
     * both of this job's readings come from `derived_metrics` and measuring
     * first would read yesterday's series. Not 04:30, which is
     * `insight-hypotheses` every Sunday, and not 04:45, which is the credit
     * leak check — the file's convention is one job per tick.
     */
    schedule: '55 4 * * *',
    ...DAILY,
    timeLimitSeconds: 300,
    timeLimitSource: 'maxDuration',
    label: 'Insight measurement',
    description: 'Re-reads the metric behind each acted-on insight, 30 and 90 days later',
    scheduleWords: 'Daily at 04:55 UTC',
    drainsQueue: null,
    counts: [
      { key: 'failed', path: ['data', 'failed'], label: 'insights that could not be measured' },
    ],
    /*
     * `unmeasurable` is NOT a partly-done condition. The engine aggregates
     * events while most detector metrics are states, so only 2 of 11 live
     * insight metric keys have a series at all — a sweep of entirely
     * unmeasurable rows is a true report of that, not a degraded run, and
     * amber for it would train the operator to ignore the one colour that
     * matters. `failed` means the sweep itself broke, which is different.
     */
    partlyDoneWhen: [{ kind: 'atLeast', key: 'failed', value: 1 }],
  },
  {
    id: 'insight-hypotheses',
    path: '/api/cron/insight-hypotheses',
    /*
     * Weekly, and the only job on that cadence.
     *
     * It was scheduled in `vercel.json` without a row here, which broke the
     * registry-is-vercel.json invariant: `BOS_CRON_JOBS` had 14 entries
     * against 15 scheduled jobs, so the operator page could not show it and
     * `withCronRunRecord` could not name it. Two tests had been failing on it.
     */
    schedule: '30 4 * * 0',
    ...WEEKLY,
    timeLimitSeconds: 300,
    timeLimitSource: 'maxDuration',
    label: 'Insight hypotheses',
    description: 'Asks the model for findings no detector was written for, then verifies them',
    scheduleWords: 'Weekly, Sunday at 04:30 UTC',
    drainsQueue: null,
    counts: [
      { key: 'asked', path: ['data', 'asked'], label: 'businesses asked' },
      { key: 'confirmed', path: ['data', 'confirmed'], label: 'confirmed by a query' },
      { key: 'rejected', path: ['data', 'rejected'], label: 'turned away' },
      { key: 'skipped', path: ['data', 'skipped'], label: 'too little data to ask' },
      { key: 'failed', path: ['data', 'failed'], label: 'businesses that failed' },
      {
        key: 'usersRemaining',
        path: ['data', 'usersRemaining'],
        label: 'businesses left for the next run',
      },
    ],
    /*
     * Nothing confirmed is NOT partly-done. The reject pile is the expected
     * output early on and the more useful half — it is the record of what the
     * generator gets wrong, and amber for it would train the operator to
     * ignore the one colour that matters. A failure or an unfinished sweep is
     * a different thing, and both are amber — matching `insight-detect`.
     */
    partlyDoneWhen: [
      { kind: 'atLeast', key: 'failed', value: 1 },
      { kind: 'atLeast', key: 'usersRemaining', value: 1 },
    ],
  },
  {
    /*
     * Credit deduction slice 4b (workplan §5.4). Read-only: compares
     * yesterday's Business OS AI calls in token_usage with the credit ledger.
     * Drains nothing. Counts only, never money (SC-11). A leak is a FINDING,
     * not a job fault, so it is shown as a number and does not colour the job
     * (the Q-U2 precedent); the `bos_credit_leak_found` error log is the
     * alert. The job is "partly done" only when it could not look everywhere.
     */
    id: 'credit-leak-check',
    path: '/api/cron/credit-leak-check',
    schedule: '45 4 * * *',
    ...DAILY,
    ...MAX_60,
    label: 'Credit leak check',
    description: "Checks that yesterday's Business OS AI spend was all charged",
    scheduleWords: 'Daily at 04:45 UTC',
    // QA4b-B1: added after run recording began (2026-09-27/28); the deploy day.
    addedOn: '2026-09-30',
    drainsQueue: null,
    counts: [
      { key: 'accountsChecked', path: ['data', 'accountsChecked'], label: 'businesses checked' },
      { key: 'accountsWithLeak', path: ['data', 'accountsWithLeak'], label: 'businesses with uncharged AI spend' },
      { key: 'unchargedGroups', path: ['data', 'unchargedGroups'], label: 'AI actions with no charge' },
      { key: 'ungroupedCalls', path: ['data', 'ungroupedCalls'], label: 'AI calls with no grouping id' },
      { key: 'underchargedGroups', path: ['data', 'underchargedGroups'], label: 'AI actions charged less than they cost' },
      { key: 'pendingReconciliation', path: ['data', 'pendingReconciliation'], label: 'fallback-priced, pending reconciliation' },
      { key: 'knownPathCalls', path: ['data', 'knownPathCalls'], label: 'calls on known uncharged paths' },
      { key: 'accountsIncomplete', path: ['data', 'accountsIncomplete'], label: 'businesses only partly read' },
      { key: 'accountsNotChecked', path: ['data', 'accountsNotChecked'], label: 'businesses that could not be read' },
      { key: 'accountsRemaining', path: ['data', 'accountsRemaining'], label: 'businesses left when time ran out' },
      { key: 'listingFailed', path: ['data', 'listingFailed'], label: 'business list could not be read (1 = yes)' },
    ],
    partlyDoneWhen: [
      { kind: 'atLeast', key: 'accountsRemaining', value: 1 },
      { kind: 'atLeast', key: 'accountsIncomplete', value: 1 },
      { kind: 'atLeast', key: 'accountsNotChecked', value: 1 },
      { kind: 'atLeast', key: 'listingFailed', value: 1 },
    ],
  },
  {
    /*
     * Read-only: compares the invoices Stripe reports as paid in the last 48
     * hours, on the platform account and on every connected account, with what
     * our tables record as settled. Drains nothing. Counts only, never money.
     *
     * Exists because production spent ten days holding a `stripe listen`
     * signing secret, refusing every real Stripe delivery with a 400, and
     * nothing noticed: fourteen payments were taken and recorded nowhere. An
     * error alarm could not have caught it, since for most of that time no
     * destination existed and production received nothing at all.
     *
     * A gap is a FINDING, not a job fault, so it is shown as a number and does
     * not colour the job (the credit leak check's precedent); the
     * `stripe_settlement_gap_found` error log is the alert. The job is "partly
     * done" only when it could not look everywhere.
     */
    id: 'stripe-settlement-gap',
    path: '/api/cron/stripe-settlement-gap',
    schedule: '17 5 * * *',
    ...DAILY,
    ...MAX_60,
    label: 'Stripe settlement gap check',
    description: 'Checks that every payment Stripe took in the last 48 hours is recorded',
    scheduleWords: 'Daily at 05:17 UTC',
    addedOn: '2026-10-05',
    drainsQueue: null,
    counts: [
      { key: 'targetsChecked', path: ['data', 'targetsChecked'], label: 'Stripe accounts checked' },
      { key: 'invoicesChecked', path: ['data', 'invoicesChecked'], label: 'paid invoices examined' },
      { key: 'gapsFound', path: ['data', 'gapsFound'], label: 'payments not recorded as settled' },
      { key: 'gapsWithNoLocalInvoice', path: ['data', 'gapsWithNoLocalInvoice'], label: 'paid with no invoice of ours' },
      { key: 'gapsUnsettledLocally', path: ['data', 'gapsUnsettledLocally'], label: 'our invoice still unsettled' },
      { key: 'targetsIncomplete', path: ['data', 'targetsIncomplete'], label: 'accounts only partly read' },
      { key: 'targetsNotChecked', path: ['data', 'targetsNotChecked'], label: 'accounts left when time ran out' },
      { key: 'listingFailed', path: ['data', 'listingFailed'], label: 'a Stripe listing was refused (1 = yes)' },
      { key: 'lookupFailed', path: ['data', 'lookupFailed'], label: 'a local lookup was refused (1 = yes)' },
      { key: 'accountListingFailed', path: ['data', 'accountListingFailed'], label: 'account list unreadable (1 = yes)' },
    ],
    partlyDoneWhen: [
      { kind: 'atLeast', key: 'targetsIncomplete', value: 1 },
      { kind: 'atLeast', key: 'targetsNotChecked', value: 1 },
      { kind: 'atLeast', key: 'listingFailed', value: 1 },
      { kind: 'atLeast', key: 'lookupFailed', value: 1 },
      { kind: 'atLeast', key: 'accountListingFailed', value: 1 },
    ],
  },
  {
    /*
     * Credits boost slice 4b.2 (FR-43; plan payments SA-P4 / PF-5): ONE cron
     * with pluggable passes (`lib/business-os/billing/reconcilePasses.ts`). The
     * boost pass re-reads Stripe for purchases a webhook missed: stuck ones are
     * credited, expired or failed, open disputes are re-read (SA C-9) and
     * missing receipt links are filled. NOT a queue drain: its writes are
     * row-locked, idempotent SQL functions (SA Q-5). Counts only, never money.
     *
     * A finding (a purchase a person must look at) is shown as a number and
     * does not colour the job, following the settlement gap check: the
     * `bos_boost_reconcile_finding` error log is the alert. The job is "partly
     * done" only when it could not finish its work: a row deferred to the next
     * run, the deadline, an unreadable list, no usable Stripe key, or a pass
     * that failed. P-8b adds its pass's counts here.
     */
    id: 'bos-billing-reconcile',
    path: '/api/cron/bos-billing-reconcile',
    schedule: '41 5 * * *',
    ...DAILY,
    ...MAX_60,
    label: 'Billing reconcile',
    description: 'Recovers credit top-ups a Stripe webhook missed: credits, expires or fails them, re-reads open disputes and fills missing receipts',
    scheduleWords: 'Daily at 05:41 UTC',
    addedOn: '2026-10-09',
    drainsQueue: null,
    counts: [
      { key: 'boostExamined', path: ['data', 'boostExamined'], label: 'stuck top-ups examined' },
      { key: 'boostCredited', path: ['data', 'boostCredited'], label: 'top-ups credited' },
      { key: 'boostExpired', path: ['data', 'boostExpired'], label: 'top-ups expired' },
      { key: 'boostFailed', path: ['data', 'boostFailed'], label: 'top-ups marked failed' },
      { key: 'boostStillProcessing', path: ['data', 'boostStillProcessing'], label: 'payments still processing' },
      { key: 'boostStillOpen', path: ['data', 'boostStillOpen'], label: 'checkouts still open' },
      { key: 'boostFlagged', path: ['data', 'boostFlagged'], label: 'top-ups needing a person' },
      { key: 'boostRaced', path: ['data', 'boostRaced'], label: 'already settled by a webhook' },
      { key: 'boostReversalsApplied', path: ['data', 'boostReversalsApplied'], label: 'refunds or disputes recorded' },
      { key: 'boostDisputesExamined', path: ['data', 'boostDisputesExamined'], label: 'open disputes re-read' },
      { key: 'boostDisputesConcluded', path: ['data', 'boostDisputesConcluded'], label: 'disputes concluded' },
      { key: 'boostDisputesStillOpen', path: ['data', 'boostDisputesStillOpen'], label: 'disputes still open' },
      { key: 'boostReceiptsExamined', path: ['data', 'boostReceiptsExamined'], label: 'missing receipts examined' },
      { key: 'boostReceiptsFilled', path: ['data', 'boostReceiptsFilled'], label: 'receipts filled' },
      { key: 'boostReceiptsNotFilled', path: ['data', 'boostReceiptsNotFilled'], label: 'receipts still missing' },
      { key: 'boostDeferred', path: ['data', 'boostDeferred'], label: 'left for the next run' },
      { key: 'boostDeadlineHit', path: ['data', 'boostDeadlineHit'], label: 'stopped at the time limit (1 = yes)' },
      { key: 'boostRowsLeft', path: ['data', 'boostRowsLeft'], label: 'top-ups left when time ran out' },
      { key: 'boostBatchFull', path: ['data', 'boostBatchFull'], label: 'a batch was full (1 = yes)' },
      { key: 'boostListFailed', path: ['data', 'boostListFailed'], label: 'a list read was refused' },
      { key: 'boostStripeUnavailable', path: ['data', 'boostStripeUnavailable'], label: 'Stripe could not be read (1 = yes)' },
      { key: 'passesRun', path: ['data', 'passesRun'], label: 'passes run' },
      { key: 'passesFailed', path: ['data', 'passesFailed'], label: 'passes failed' },
    ],
    partlyDoneWhen: [
      { kind: 'atLeast', key: 'boostDeferred', value: 1 },
      { kind: 'atLeast', key: 'boostDeadlineHit', value: 1 },
      { kind: 'atLeast', key: 'boostListFailed', value: 1 },
      { kind: 'atLeast', key: 'boostStripeUnavailable', value: 1 },
      { kind: 'atLeast', key: 'passesFailed', value: 1 },
    ],
  },
  {
    id: 'payment-reminders',
    path: '/api/cron/payment-reminders',
    /*
     * Hourly, not daily at 08:00.
     *
     * This route is a queue DRAIN: it finds what is due, stamps a reminder row
     * `scheduled_at`, and sends what is due. Running it once a day meant a debt
     * that came due at 09:00 was not noticed until the next morning, and the
     * owner's own cadence — days 1, 3 and 7 past due — was pushed a day late.
     *
     * The 08:00 was never a schedule; it was a quiet-hours rule enforced by
     * running the job once a day. That rule now lives in
     * `PaymentReminderService.sendableAt`, which holds any reminder falling
     * outside 08:00-20:00 in the business's own timezone. So the drain can run
     * often without anybody being chased at four in the morning.
     */
    schedule: '40 * * * *',
    ...HOURLY,
    ...MAX_60,
    label: 'Payment reminders',
    description: 'Finds overdue invoices, queues and sends payment reminders',
    scheduleWords: 'Hourly at :40',
    drainsQueue: 'payment_reminders',
    counts: [
      { key: 'remindersProcessed', path: ['data', 'reminders', 'processed'], label: 'reminders picked up' },
      { key: 'remindersSent', path: ['data', 'reminders', 'sent'], label: 'reminders sent' },
      { key: 'remindersFailed', path: ['data', 'reminders', 'failed'], label: 'reminders failed' },
      { key: 'remindersScheduled', path: ['data', 'overdue', 'remindersScheduled'], label: 'reminders queued' },
      { key: 'invoicesMarkedOverdue', path: ['data', 'invoicesMarkedOverdue'], label: 'invoices marked overdue' },
    ],
    partlyDoneWhen: [{ kind: 'atLeast', key: 'remindersFailed', value: 1 }],
  },
];

/** The five §8.1 queues (requirement §S5.7). */
export const BOS_QUEUES: readonly BosQueue[] = [
  { id: 'payment_reminders', label: 'Payment reminders', drainedBy: 'payment-reminders', windowBasis: 'due', note: null },
  {
    id: 'payment_automations',
    label: 'Payment automations',
    drainedBy: 'payment-retry',
    windowBasis: 'due',
    note: 'No live producer today, so zeros are expected here.',
  },
  { id: 'daily_briefing_sends', label: 'Morning briefing emails', drainedBy: 'daily-briefing', windowBasis: 'queued', note: null },
  { id: 'lead_responses', label: 'Lead replies', drainedBy: 'lead-response', windowBasis: 'queued', note: null },
  { id: 'insight_actions', label: 'Insight actions', drainedBy: 'insight-actions', windowBasis: 'queued', note: null },
];

/** A job that must never be scheduled, and the decision that says so. */
export interface PermanentlyUnscheduledCron {
  path: string;
  /** Plain words: why it may not run. Shown in the failure if it is scheduled. */
  reason: string;
  /** When the decision was taken (YYYY-MM-DD). */
  decidedOn: string;
}

/**
 * Jobs that are deliberately NOT in `vercel.json`, for good (plan payments
 * P-10, TK-3). `vercel.json` cannot carry a comment, so the decision lives
 * here, next to the list of jobs that do run, and
 * `lib/cron/__tests__/vercelCrons.test.ts` fails if any of these paths is
 * scheduled, printing the reason.
 */
export const PERMANENTLY_UNSCHEDULED_CRONS: readonly PermanentlyUnscheduledCron[] = [
  {
    path: '/api/cron/check-free-tier-expiration',
    reason:
      'It froze every account whose free tier had expired and that never bought credits, and zeroed its balance. ' +
      'A paying Business OS customer never buys credits, so scheduling it would freeze paying customers. ' +
      'Decided for good on 2026-10-02 (BQ-P8: keep RD-9 permanently, F-17). The route is an inert 410 since plan payments P-10.',
    decidedOn: '2026-10-02',
  },
];

/** Minutes since the last Vercel cron start after which a job is late. */
export function lateAfterMinutes(job: Pick<BosCronJob, 'intervalMinutes' | 'graceMinutes'>): number {
  return job.intervalMinutes + job.graceMinutes;
}

/** Minutes since the last Vercel cron start after which a job has stopped. */
export function stoppedAfterMinutes(job: Pick<BosCronJob, 'intervalMinutes' | 'graceMinutes'>): number {
  return 2 * job.intervalMinutes + job.graceMinutes;
}

export function findBosCronJob(id: string): BosCronJob | undefined {
  return BOS_CRON_JOBS.find((job) => job.id === id);
}
