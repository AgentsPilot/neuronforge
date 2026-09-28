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
    id: 'payment-reminders',
    path: '/api/cron/payment-reminders',
    schedule: '0 8 * * *',
    ...DAILY,
    ...MAX_60,
    label: 'Payment reminders',
    description: 'Finds overdue invoices, queues and sends payment reminders',
    scheduleWords: 'Daily at 08:00 UTC',
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
