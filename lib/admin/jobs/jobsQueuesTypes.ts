/**
 * Wire types of `GET /api/admin/jobs-queues` and the facts the Health tiles 6
 * and 7 are built from (admin reorganisation slice 5, parts C and D).
 *
 * RUNTIME-FREE on purpose: only `export type` / `export interface`, no values
 * and no imports. The page is a client component and imports these with
 * `import type` only (the C-21 pattern), so no registry, rule or read code
 * reaches the browser.
 *
 * @module lib/admin/jobs/jobsQueuesTypes
 */

/** A job's status, first match wins (requirement §S5.7). */
export type JobStatus =
  | 'stopped'
  | 'keeps_failing'
  | 'late'
  | 'last_run_failed'
  | 'partly_done'
  | 'no_run_yet'
  | 'could_not_check'
  | 'healthy';

/** A queue's status, first match wins (requirement §S5.8). */
export type QueueStatus =
  | 'stuck'
  | 'stopped_draining'
  | 'dead_lettered_24h'
  | 'behind'
  | 'dead_lettered_7d'
  | 'failures_24h'
  | 'could_not_check'
  | 'clear';

/** "did_not_finish" = still running after its deadline, or its finish could not be recorded. */
export type RunOutcomeView = 'running' | 'succeeded' | 'partial' | 'failed' | 'did_not_finish';

export interface RunView {
  startedAt: string;
  finishedAt: string | null;
  outcome: RunOutcomeView;
  /** Plain words, e.g. "did not finish (or its finish could not be recorded)". */
  outcomeWords: string;
  durationMs: number | null;
  httpStatus: number | null;
  /** A class, never a message: 'http_error' | 'exception' | 'timeout' | null. */
  errorClass: string | null;
  /** 'vercel_cron' (the schedule) or 'other' (a manual authorised call). */
  source: 'vercel_cron' | 'other';
}

export interface JobView {
  id: string;
  label: string;
  description: string;
  scheduleWords: string;
  status: JobStatus;
  statusWords: string;
  lastRun: RunView | null;
  /** The newest start by Vercel's own scheduler (the only kind that resets "late"). */
  lastCronStartedAt: string | null;
  expectedBy: string | null;
  lateAt: string | null;
  stoppedAt: string | null;
  runs24h: number | null;
  bad24h: number | null;
  runs7d: number | null;
  bad7d: number | null;
  /** The last run's own counts, with their labels. Numbers only. */
  counts: Array<{ key: string; label: string; value: number }>;
  recentFailures: RunView[];
  /** Shown when the time limit is an assumption (pending live check L-5.10). */
  timeLimitNote: string | null;
  drainsQueueLabel: string | null;
}

export interface QueueFiguresView {
  dueNow: number;
  later: number;
  noDueTime: number | null;
  inProgress: number;
  stuck: number;
  failed24h: number;
  failed7d: number;
  deadLettered24h: number;
  deadLettered7d: number;
  skipped7d: number | null;
  guardrailSkips7d: number | null;
  unrecognisedStatus: number;
  oldestDueAt: string | null;
  oldestDueMinutes: number | null;
}

export interface QueueView {
  id: string;
  label: string;
  drainedByLabel: string;
  status: QueueStatus;
  statusWords: string;
  /** Null when the read failed. */
  figures: QueueFiguresView | null;
  /** "due" or "queued": what the 24 h / 7 d failure windows are measured by. */
  windowWords: string;
  note: string | null;
}

/** 'not_installed' = the run-record migration has not been applied yet. */
export type RunsReadState = 'ok' | 'not_installed' | 'failed';

export interface JobsQueuesView {
  generatedAt: string;
  /** The single clock reading every figure is measured against. */
  now: string;
  runsRead: RunsReadState;
  /** One fixed sentence when runsRead is not 'ok'. */
  runsReadMessage: string | null;
  jobs: JobView[];
  queues: QueueView[];
}

/** What tile 6 is coloured from: the same computation as the page (A-8). */
export interface JobsTileFacts {
  runsRead: RunsReadState;
  total: number;
  healthy: number;
  stopped: number;
  keepsFailing: number;
  late: number;
  lastRunFailed: number;
  partlyDone: number;
  noRunYet: number;
  /** The label of the worst job, or null when all are healthy. */
  worstJob: string | null;
}

/** What tile 7 is coloured from. */
export interface QueuesTileFacts {
  total: number;
  readOk: number;
  dueNow: number;
  stuck: number;
  stoppedDraining: number;
  behind: number;
  deadLettered24h: number;
  deadLettered7d: number;
  failed24h: number;
  oldestDueMinutes: number | null;
  oldestDueQueue: string | null;
}

/**
 * One number a "Drain now" run reported (ADMIN_BOS_CLEANUP slice 7d), from the
 * fixed per-queue allow-list in `drainCounts.ts`. Numbers only (C7-13).
 */
export interface DrainCount {
  key: string;
  label: string;
  value: number;
}

/** `data` of a successful `POST /api/admin/jobs-queues/drain`. Exactly these keys. */
export interface DrainResult {
  queue: string;
  /** Empty when the queue's drain reports no counts (payment automations). */
  counts: DrainCount[];
  durationMs: number;
}

// ── The queue item list (ADMIN_BOS_CLEANUP slice 7a) ─────────────────────────

/** Which rows the list shows (workplan §2.1). */
export type QueueItemState = 'stuck' | 'failed' | 'dead_lettered' | 'waiting';

/** Why an item cannot be re-sent (C7-5, C7-7, §E). 7c returns the same codes with a 422. */
export type QueueItemRetryRefusal =
  | 'retry_not_offered'
  | 'not_retryable_state'
  | 'retry_window_passed'
  | 'briefing_not_today'
  | 'no_due_time';

/** Why an item cannot be cancelled (C7-2). */
export type QueueItemCancelRefusal = 'leased' | 'not_cancellable_state';

export type QueueItemRetryView = { allowed: true; until: string } | { allowed: false; code: QueueItemRetryRefusal };
export type QueueItemCancelView = { allowed: true } | { allowed: false; code: QueueItemCancelRefusal };

/**
 * The §E "due" anchor, as shown. `queued` is the queue time of lead replies and
 * insight actions: their real due time is not kept anywhere (§E).
 */
export type QueueItemDue =
  | { basis: 'scheduled'; at: string | null }
  | { basis: 'business_day'; date: string | null }
  | { basis: 'queued'; at: string };

/**
 * What an age is measured from. Failed items keep no failure time, so their age
 * is counted from the §E anchor, and the words say which one (W7A-4).
 */
export type QueueItemAgeBasis =
  | 'since_claimed'
  | 'no_lease'
  | 'since_due'
  | 'since_queued'
  | 'since_day_start'
  | 'overdue';

export interface QueueItemAge {
  /** Whole minutes; negative on a waiting item that is not due yet; null when there is no time to measure from. */
  minutes: number | null;
  basis: QueueItemAgeBasis;
}

/** One row of the list. Metadata only, exactly these keys (C7-13). */
export interface QueueItemView {
  /** The queue row's own id (not an account id): 7b/7c act on it. */
  id: string;
  /** `company_name`, or one of three fixed sentences. */
  businessName: string;
  /** A fixed label; the raw kind value is never sent. */
  kindLabel: string;
  /** The platform's own status word; 7b/7c send it back as `expected.status`. */
  status: string;
  statusLabel: string;
  state: QueueItemState;
  /** From the fixed-marker filter that matched, never from the error text. */
  errorCategory: 'failed' | 'dead_lettered' | null;
  attempts: number;
  due: QueueItemDue;
  /** Waiting items only. */
  nextAttemptAt: string | null;
  age: QueueItemAge;
  /** Stuck items only: 'none' = no claim recorded (orphaned), 'expired' = claimed before the stuck threshold. */
  lease: 'none' | 'expired' | null;
  retry: QueueItemRetryView;
  cancel: QueueItemCancelView;
}

/** `data` of a successful `GET /api/admin/jobs-queues/items`. Exactly these keys. */
export interface QueueItemsView {
  queue: string;
  state: QueueItemState;
  /** The clock every age and mark is measured against. */
  now: string;
  page: number;
  pageSize: number;
  /** The last page the route serves (CR7A-2): only the first `maxPage * pageSize` items can be listed. */
  maxPage: number;
  /** null = the page asked for is past the end of the list (W7A-2). */
  total: number | null;
  /** False on the last servable page even when `total` is larger (CR7A-2 / QA-7A-1). */
  hasMore: boolean;
  items: QueueItemView[];
}

// ── One action on one queue item (ADMIN_BOS_CLEANUP slice 7b) ────────────────

/** What `POST /api/admin/jobs-queues/items/action` can do. 7b: cancel only; 7c widens this union. */
export type QueueItemAction = 'cancel';

/** The body of `POST /api/admin/jobs-queues/items/action`. Exactly these keys (strict on the server). */
export interface QueueItemActionRequest {
  queue: string;
  itemId: string;
  action: QueueItemAction;
  /** What the list showed: the platform's status word and the attempt count. */
  expected: { status: string; attempts: number };
  /** 3 to 500 characters after trimming. Kept in the admin audit trail only. */
  reason: string;
}

/** A status word with its fixed label. */
export interface QueueItemStatusWord {
  status: string;
  statusLabel: string;
}

/** `data` of a successful action. Exactly these keys: no account id, no content. */
export interface QueueItemActionResult {
  queue: string;
  itemId: string;
  action: QueueItemAction;
  before: QueueItemStatusWord;
  after: QueueItemStatusWord;
}

/** The `code` of a refused or failed action. */
export type QueueItemActionRefusal =
  | 'invalid_input'
  | 'not_cancellable_state'
  | 'leased'
  | 'item_not_found'
  | 'item_changed'
  | 'action_failed'
  | 'outcome_unknown';
