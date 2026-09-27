/**
 * The Health landing's colour rules, as data (admin reorganisation slice 4,
 * user decision U-1).
 *
 * ── How a tile is coloured ────────────────────────────────────────────────
 * Each measured tile has an ORDERED list of rules. They are evaluated top to
 * bottom; the FIRST rule whose condition matches sets the tile's colour, and its
 * description is what the tile says. A rule's colour can only be red or amber.
 * GREEN IS NEVER DATA (SA C-10R): when no rule matches, the evaluator alone
 * decides between green "All clear" (proven clear), grey "For information"
 * and the honest greys, from a code constant in `evaluateHealth.ts`.
 *
 * Three things are NOT decided here, on purpose, so no data edit can break them:
 *   - which tiles may ever be green (`GREEN_ELIGIBLE` in the evaluator; the
 *     entitlements mode never is, OQ-9);
 *   - a figure that is only a lower bound is never green or "for information"
 *     (SA C-18): the evaluator makes such a tile amber even if every rule
 *     below were deleted;
 *   - a comparison ("x times the previous period", "a share of all actions")
 *     never fires on a lower bound (SA C-2): that is built into the condition
 *     kinds, not left to each rule.
 *
 * ── What is a data edit, and what is not (SA C-11) ────────────────────────
 * DATA (no SA re-review): change a value, factor, floor, colour, description or
 * order, or add a rule that uses an existing condition kind and this tile's own
 * metrics. Keep `priority` ascending and unique; the config test checks it.
 *
 * ⚠️ EDITING A VALUE MEANS RE-READING ITS DESCRIPTION IN THE SAME DIFF (SA C-22).
 * "Over $20 in the last 24 hours" next to `value: 30` is a lie on screen. The
 * page also shows a condition summary generated from the rule itself, so the
 * applied rule is always visible, but the description must still be true.
 *
 * CODE (and back to SA): a new condition kind, a new metric (it needs a new
 * read) or a new flag. Every condition kind here is MONOTONE INCREASING in its
 * metric, which is why "at least" may fire on a lower bound. A future
 * non-monotone kind ("at most", "dropped below") is by definition a new kind,
 * and SA must then decide how lower bounds behave for it.
 *
 * A tile's rules may name only THAT tile's metrics and flags (SA C-19): the
 * types below enforce it, and so does the runtime check in the evaluator.
 * Descriptions must never say "OK" (the page's honesty rule).
 *
 * @module lib/admin/health/rules
 */

// ── Metrics and flags, per tile (SA C-19) ──────────────────────────────────

export type SettingsMetric = 'settingsIgnored' | 'settingsOff';
export type FailureMetric = 'failed24h' | 'completed24h';
export type SpendMetric = 'spend24h' | 'spendPrev24h' | 'spend7d' | 'spendPrev7d';
export type CriticalMetric = 'critical24h';
/** Tile 6 (slice 5): counts of jobs in each status, from the jobs & queues computation. */
export type JobsMetric = 'jobsStopped' | 'jobsKeepFailing' | 'jobsLate' | 'jobsLastRunFailed' | 'jobsPartlyDone';
/** Tile 7 (slice 5): items summed over the queues read, or queues over a threshold. */
export type QueuesMetric =
  | 'queueItemsStuck'
  | 'queuesStoppedDraining'
  | 'queueDeadLettered24h'
  | 'queuesBehind'
  | 'queueDeadLettered7d'
  | 'queueFailed24h';
export type EntitlementsFlag = 'entitlementEnforceRefused';

export type MetricId = SettingsMetric | FailureMetric | SpendMetric | CriticalMetric | JobsMetric | QueuesMetric;
export type FlagId = EntitlementsFlag;

/** How a metric is written in a generated condition summary (SA C-22). */
export const METRIC_LABELS: Readonly<Record<MetricId, { label: string; unit: 'usd' | 'count' }>> = {
  settingsIgnored: { label: 'settings not being applied', unit: 'count' },
  settingsOff: { label: 'AI areas or calls configured off', unit: 'count' },
  failed24h: { label: 'failed AI actions in 24 h', unit: 'count' },
  completed24h: { label: 'completed AI actions in 24 h', unit: 'count' },
  spend24h: { label: '24 h spend', unit: 'usd' },
  spendPrev24h: { label: 'previous 24 h spend', unit: 'usd' },
  spend7d: { label: '7-day spend', unit: 'usd' },
  spendPrev7d: { label: 'previous 7-day spend', unit: 'usd' },
  critical24h: { label: 'critical events in 24 h', unit: 'count' },
  jobsStopped: { label: 'jobs stopped', unit: 'count' },
  jobsKeepFailing: { label: 'jobs failing run after run', unit: 'count' },
  jobsLate: { label: 'jobs late', unit: 'count' },
  jobsLastRunFailed: { label: 'jobs whose last run failed or did not finish', unit: 'count' },
  jobsPartlyDone: { label: 'jobs whose last run was partly done', unit: 'count' },
  queueItemsStuck: { label: 'items stuck in progress', unit: 'count' },
  queuesStoppedDraining: { label: 'queues with a due item waiting over 2 drain intervals', unit: 'count' },
  queueDeadLettered24h: { label: 'items dead-lettered (due or queued in 24 h)', unit: 'count' },
  queuesBehind: { label: 'queues with a due item waiting over 1 drain interval', unit: 'count' },
  queueDeadLettered7d: { label: 'items dead-lettered (due or queued in 7 days)', unit: 'count' },
  queueFailed24h: { label: 'items failed (due or queued in 24 h)', unit: 'count' },
};

export const FLAG_LABELS: Readonly<Record<FlagId, string>> = {
  entitlementEnforceRefused: 'enforcement requested but refused by the launch gate',
};

// ── Condition kinds (a closed union; a new kind is code, SA C-11) ──────────

export type HealthCondition<M extends MetricId, F extends FlagId> =
  /** metric >= value. May fire on a lower bound (a bound above the value proves it). */
  | { kind: 'atLeast'; metric: M; value: number }
  /**
   * metric >= factor x baseline AND metric >= floor. Fires ONLY when both are
   * exact (SA C-2). A baseline of 0 with a positive metric counts as an
   * unbounded ratio, so only the floor decides ("new spend").
   */
  | { kind: 'ratioAtLeast'; metric: M; baseline: M; factor: number; floor: number }
  /**
   * numerator / (numerator + other) >= rate, only when numerator + other >=
   * minTotal. Fires ONLY when both are exact (SA C-2).
   */
  | { kind: 'shareAtLeast'; numerator: M; other: M; rate: number; minTotal: number }
  /** Any listed metric is a lower bound (not every call was counted). */
  | { kind: 'anyLowerBound'; metrics: readonly M[] }
  /** A yes/no fact the route measured. */
  | { kind: 'flag'; flag: F };

export interface HealthRule<M extends MetricId = MetricId, F extends FlagId = never> {
  /** Stable id, e.g. 'spend.ceiling24h'. Logged when it matches. */
  id: string;
  /** Unique within the tile; the list must already be in ascending priority order. */
  priority: number;
  colour: 'red' | 'amber';
  /** Shown on the tile when this rule is the first to match. Never "OK". */
  description: string;
  condition: HealthCondition<M, F>;
}

/** Every tile's rules (slice 5 made the scheduled-jobs and queues tiles measured). */
export interface HealthRuleSet {
  bos_ai_settings: readonly HealthRule<SettingsMetric>[];
  bos_ai_failures: readonly HealthRule<FailureMetric>[];
  bos_ai_spend: readonly HealthRule<SpendMetric>[];
  critical_audit: readonly HealthRule<CriticalMetric>[];
  entitlements_mode: readonly HealthRule<never, EntitlementsFlag>[];
  scheduled_jobs: readonly HealthRule<JobsMetric>[];
  queues: readonly HealthRule<QueuesMetric>[];
}

export type MeasuredTileId = keyof HealthRuleSet;

/** The runtime copy of the per-tile metric typing, checked by the evaluator (SA C-19, C-20). */
export const TILE_VOCABULARY: Readonly<
  Record<MeasuredTileId, { metrics: readonly MetricId[]; flags: readonly FlagId[] }>
> = {
  bos_ai_settings: { metrics: ['settingsIgnored', 'settingsOff'], flags: [] },
  bos_ai_failures: { metrics: ['failed24h', 'completed24h'], flags: [] },
  bos_ai_spend: { metrics: ['spend24h', 'spendPrev24h', 'spend7d', 'spendPrev7d'], flags: [] },
  critical_audit: { metrics: ['critical24h'], flags: [] },
  entitlements_mode: { metrics: [], flags: ['entitlementEnforceRefused'] },
  scheduled_jobs: {
    metrics: ['jobsStopped', 'jobsKeepFailing', 'jobsLate', 'jobsLastRunFailed', 'jobsPartlyDone'],
    flags: [],
  },
  queues: {
    metrics: [
      'queueItemsStuck',
      'queuesStoppedDraining',
      'queueDeadLettered24h',
      'queuesBehind',
      'queueDeadLettered7d',
      'queueFailed24h',
    ],
    flags: [],
  },
};

// ── The rules (the user's starting rules, 2026-09-26: "we can change later") ─

export const HEALTH_RULES: HealthRuleSet = {
  bos_ai_settings: [
    {
      id: 'settings.ignored',
      priority: 1,
      colour: 'amber',
      description: "A setting isn't being applied",
      condition: { kind: 'atLeast', metric: 'settingsIgnored', value: 1 },
    },
    {
      id: 'settings.off',
      priority: 2,
      colour: 'amber',
      description: 'AI switched off somewhere',
      condition: { kind: 'atLeast', metric: 'settingsOff', value: 1 },
    },
  ],

  bos_ai_failures: [
    {
      id: 'failures.count24h',
      priority: 1,
      colour: 'red',
      description: '5+ AI failures in the last 24 hours',
      condition: { kind: 'atLeast', metric: 'failed24h', value: 5 },
    },
    {
      id: 'failures.share24h',
      priority: 2,
      colour: 'red',
      description: '1 in 5 AI actions failing',
      condition: { kind: 'shareAtLeast', numerator: 'failed24h', other: 'completed24h', rate: 0.2, minTotal: 10 },
    },
    {
      id: 'failures.any24h',
      priority: 3,
      colour: 'amber',
      description: 'AI failures in the last 24 hours',
      condition: { kind: 'atLeast', metric: 'failed24h', value: 1 },
    },
  ],

  bos_ai_spend: [
    {
      id: 'spend.ceiling24h',
      priority: 1,
      colour: 'red',
      description: 'Over $20 in the last 24 hours',
      condition: { kind: 'atLeast', metric: 'spend24h', value: 20 },
    },
    {
      id: 'spend.tripled24h',
      priority: 2,
      colour: 'red',
      description: 'Spend tripled vs yesterday',
      condition: { kind: 'ratioAtLeast', metric: 'spend24h', baseline: 'spendPrev24h', factor: 3, floor: 5 },
    },
    {
      id: 'spend.doubled24h',
      priority: 3,
      colour: 'amber',
      description: 'Spend doubled vs yesterday',
      condition: { kind: 'ratioAtLeast', metric: 'spend24h', baseline: 'spendPrev24h', factor: 2, floor: 1 },
    },
    {
      id: 'spend.week50',
      priority: 4,
      colour: 'amber',
      description: 'Week up 50% or more',
      condition: { kind: 'ratioAtLeast', metric: 'spend7d', baseline: 'spendPrev7d', factor: 1.5, floor: 5 },
    },
    {
      // Redundant with the evaluator's lower-bound invariant (SA C-18), and
      // harmless: kept so the reason is visible in the tile's own rule list.
      id: 'spend.lowerBound',
      priority: 5,
      colour: 'amber',
      description: 'Total is a minimum; not all calls counted',
      condition: { kind: 'anyLowerBound', metrics: ['spend24h', 'spendPrev24h', 'spend7d', 'spendPrev7d'] },
    },
  ],

  critical_audit: [
    {
      id: 'critical.any24h',
      priority: 1,
      colour: 'amber',
      description: 'Critical events in the last 24 hours',
      condition: { kind: 'atLeast', metric: 'critical24h', value: 1 },
    },
  ],

  entitlements_mode: [
    {
      id: 'entitlements.refused',
      priority: 1,
      colour: 'amber',
      description: 'Enforcement requested but not active',
      condition: { kind: 'flag', flag: 'entitlementEnforceRefused' },
    },
  ],

  // Slice 5 starting rules (requirement §S5.8; OQ-7 accepted them as proposed).
  // What "stopped", "late", "keeps failing" mean per job is data in
  // lib/cron/bosCronJobs.ts; these rules count the jobs in each state.
  scheduled_jobs: [
    {
      id: 'jobs.stopped',
      priority: 1,
      colour: 'red',
      description: 'A job has stopped',
      condition: { kind: 'atLeast', metric: 'jobsStopped', value: 1 },
    },
    {
      id: 'jobs.keepsFailing',
      priority: 2,
      colour: 'red',
      description: 'A job keeps failing',
      condition: { kind: 'atLeast', metric: 'jobsKeepFailing', value: 1 },
    },
    {
      id: 'jobs.late',
      priority: 3,
      colour: 'amber',
      description: 'A job is late',
      condition: { kind: 'atLeast', metric: 'jobsLate', value: 1 },
    },
    {
      id: 'jobs.lastRunFailed',
      priority: 4,
      colour: 'amber',
      description: "A job's last run failed",
      condition: { kind: 'atLeast', metric: 'jobsLastRunFailed', value: 1 },
    },
    {
      id: 'jobs.partlyDone',
      priority: 5,
      colour: 'amber',
      description: 'A job finished with work left or partly failed',
      condition: { kind: 'atLeast', metric: 'jobsPartlyDone', value: 1 },
    },
  ],

  queues: [
    {
      id: 'queues.stuck',
      priority: 1,
      colour: 'red',
      description: 'Items stuck in progress',
      condition: { kind: 'atLeast', metric: 'queueItemsStuck', value: 1 },
    },
    {
      id: 'queues.stoppedDraining',
      priority: 2,
      colour: 'red',
      description: 'A queue has stopped draining',
      condition: { kind: 'atLeast', metric: 'queuesStoppedDraining', value: 1 },
    },
    {
      // OQ-7: red, because a dead-letter is a client message that never went out.
      id: 'queues.deadLettered24h',
      priority: 3,
      colour: 'red',
      description: 'A message was dead-lettered in the last 24 hours',
      condition: { kind: 'atLeast', metric: 'queueDeadLettered24h', value: 1 },
    },
    {
      id: 'queues.behind',
      priority: 4,
      colour: 'amber',
      description: 'A queue is behind',
      condition: { kind: 'atLeast', metric: 'queuesBehind', value: 1 },
    },
    {
      id: 'queues.deadLettered7d',
      priority: 5,
      colour: 'amber',
      description: 'Dead-lettered items this week',
      condition: { kind: 'atLeast', metric: 'queueDeadLettered7d', value: 1 },
    },
    {
      id: 'queues.failed24h',
      priority: 6,
      colour: 'amber',
      description: 'Failures in the last 24 hours',
      condition: { kind: 'atLeast', metric: 'queueFailed24h', value: 1 },
    },
  ],
};
