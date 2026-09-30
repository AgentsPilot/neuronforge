/**
 * The Health landing's evaluator (admin reorganisation slice 4).
 *
 * PURE (SA C-6): numbers in, tiles out. No I/O, no clock (the windows arrive in
 * the inputs), nothing from `app/**`, nothing server-only, and it never names
 * the admin ledger repository. The route does the reads and hands over numbers.
 *
 * NEVER THROWS (SA C-20). Each tile is evaluated on its own: a rule list that
 * fails its checks makes THAT tile `unavailable` (reported through `onRuleError`,
 * which the route logs at `error`), never `neutral`, and never fails the page.
 *
 * Colour: the FIRST matching rule, in list order (see `rules.ts`). When no
 * rule matches, ONE predicate decides (SA C-10R, admin reorganisation slice 5):
 *
 *   provenClear = the tile is in GREEN_ELIGIBLE
 *              ∧ the measurement is complete
 *              ∧ every metric AND every figure is exact
 *
 *   - proven clear                         → green "All clear"
 *   - not eligible but exact and complete  → neutral "for information"
 *                                            (only the entitlements mode)
 *   - inexact on a LOWER_BOUND_TILES tile  → amber (SA C-18, now over the
 *                                            figures as well as the metrics)
 *   - completeness 'not_measured'          → not_measured
 *   - otherwise inexact or incomplete      → unavailable
 *
 * Inexact or incomplete can never reach green or neutral. Eligibility is code,
 * here, not data in `rules.ts`, so no rule edit can make a tile green.
 *
 * @module lib/admin/health/evaluateHealth
 */

import type {
  HealthFigure,
  HealthPageLink,
  HealthRuleView,
  HealthSummary,
  HealthTile,
  HealthTileId,
  TileStatus,
} from './healthTypes';
import {
  FLAG_LABELS,
  HEALTH_RULES,
  METRIC_LABELS,
  TILE_VOCABULARY,
  type FlagId,
  type HealthCondition,
  type HealthRule,
  type HealthRuleSet,
  type MeasuredTileId,
  type MetricId,
} from './rules';
import { toAuditDateParam, type HealthWindows, type Measured, type SpendSums } from './windows';
import type { JobsTileFacts, QueuesTileFacts } from '@/lib/admin/jobs/jobsQueuesTypes';

// ── Fixed texts ────────────────────────────────────────────────────────────

/** The headline of a tile that is proven clear (SA C-10R). */
export const GREEN_HEADLINE = 'All clear';
export const NOT_MEASURED_HEADLINE = 'Not measured yet';
export const UNAVAILABLE_HEADLINE = 'Could not check just now';
/** The SA C-18 invariant's headline: a lower bound is never clear. */
export const LOWER_BOUND_HEADLINE = 'Total is a minimum; not all calls counted';
export const OI_P1_NOTE =
  'AI cost & usage reads at most 1,000 calls per period (known issue OI-P1), so it will show less than this.';
/** The closing line of a rule list when the tile's figures are always exact. */
export const OTHERWISE_GREEN = `Otherwise: green, "${GREEN_HEADLINE}".`;
/**
 * The closing line for a tile whose figures can be a lower bound (SA C-18): the
 * evaluator makes such a tile amber when no rule matches, so "green" alone
 * would be untrue.
 */
export const OTHERWISE_GREEN_UNLESS_LOWER_BOUND =
  `Otherwise: green, "${GREEN_HEADLINE}", unless a figure is only a minimum; then amber: "${LOWER_BOUND_HEADLINE}".`;
/** The closing line of a tile that may never be green (OQ-9). */
export const OTHERWISE_INFORMATION = 'Otherwise: shown for information only (never green).';
/** Tile 6's closing line: green needs every job to have a recorded run. */
export const OTHERWISE_JOBS = `Otherwise: green, "${GREEN_HEADLINE}", once every job has a recorded run; grey until then.`;
/** Tile 7's closing line: green needs every queue to have been read. */
export const OTHERWISE_QUEUES = `Otherwise: green, "${GREEN_HEADLINE}", when every queue was read; grey if one could not be.`;
/** Where tiles 6 and 7 lead. */
export const JOBS_QUEUES_PAGE_LINK: HealthPageLink = {
  href: '/admin/jobs-queues',
  text: 'Open Scheduled jobs & queues',
};
/** Tiles whose metrics can arrive as a lower bound (only spend is read with a ceiling). */
const LOWER_BOUND_TILES: ReadonlySet<MeasuredTileId> = new Set<MeasuredTileId>(['bos_ai_spend']);

/**
 * The ONLY tiles that may ever be green (SA C-10R.3). Code, not data: moving a
 * tile in or out is a code change that SA reviews. `entitlements_mode` is
 * deliberately absent: a chosen mode is not a health signal (OQ-9), so it is
 * shown "for information" and never green. `scheduled_jobs` is green only when
 * every registered job has a recorded Vercel cron run and the run read succeeded;
 * `queues` only when all five queue reads succeeded (their measurements say
 * `completeness: 'complete'` exactly then).
 */
export const GREEN_ELIGIBLE: ReadonlySet<HealthTileId> = new Set<HealthTileId>([
  'bos_ai_settings',
  'bos_ai_failures',
  'bos_ai_spend',
  'critical_audit',
  'scheduled_jobs',
  'queues',
]);

/** Above this many calls in a window, Cost Analytics' figure is truncated (OI-P1). */
export const COST_ANALYTICS_ROW_CAP = 1000;

// ── Inputs ─────────────────────────────────────────────────────────────────

/** A read that worked, or one that did not (its tile becomes `unavailable`). */
export type HealthRead<T> = { ok: true; value: T } | { ok: false };

export interface SettingsFacts {
  areasOff: number;
  callsOff: number;
  ignored: number;
  adjusted: number;
  /** Area names (platform labels, never owner text). */
  offAreas: string[];
  ignoredAreas: string[];
}

export interface FailureFacts {
  failed24h: number;
  failed7d: number;
  completed24h: number;
}

export interface SpendFacts {
  sums: SpendSums;
  /** False when only the exact count failed: no "N calls" and no OI-P1 note (SA C-4). */
  callsKnown: boolean;
}

export interface CriticalFacts {
  last24h: number;
  last7d: number;
}

export interface EntitlementFacts {
  effective: 'off' | 'shadow' | 'enforce';
  refused: boolean;
}

export interface HealthInputs {
  windows: HealthWindows;
  settings: HealthRead<SettingsFacts>;
  failures: HealthRead<FailureFacts>;
  spend: HealthRead<SpendFacts>;
  critical: HealthRead<CriticalFacts>;
  entitlements: HealthRead<EntitlementFacts>;
  /**
   * Tiles 6 and 7 (slice 5), from the same computation as the jobs & queues
   * page (A-8). Absent = that tile was not measured on this call: it shows
   * "Not measured yet", never a colour.
   */
  jobs?: HealthRead<JobsTileFacts>;
  queues?: HealthRead<QueuesTileFacts>;
}

export interface RuleErrorReport {
  tile: MeasuredTileId;
  ruleId: string | null;
  reason: string;
}

export interface EvaluateOptions {
  rules?: HealthRuleSet;
  /** Called once per tile whose rule list is invalid. The route logs it at `error`. */
  onRuleError?: (report: RuleErrorReport) => void;
}

export type MetricValues = Partial<Record<MetricId, Measured>>;
export type FlagValues = Partial<Record<FlagId, boolean>>;

// ── Rule list validation (SA C-19, C-20, C-22) ─────────────────────────────

const OK_WORD = /\bOK\b/;
const KINDS = new Set(['atLeast', 'ratioAtLeast', 'shareAtLeast', 'anyLowerBound', 'flag']);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function conditionProblem(tile: MeasuredTileId, condition: unknown): string | null {
  if (!condition || typeof condition !== 'object') return 'condition missing';
  const c = condition as Record<string, unknown>;
  if (typeof c.kind !== 'string' || !KINDS.has(c.kind)) return 'unknown condition kind';
  const vocab = TILE_VOCABULARY[tile];
  const ownMetric = (m: unknown) => typeof m === 'string' && (vocab.metrics as readonly string[]).includes(m);

  switch (c.kind) {
    case 'atLeast':
      if (!ownMetric(c.metric)) return 'metric not measured for this tile';
      if (!isFiniteNumber(c.value)) return 'value is not a number';
      return null;
    case 'ratioAtLeast':
      if (!ownMetric(c.metric) || !ownMetric(c.baseline)) return 'metric not measured for this tile';
      if (!isFiniteNumber(c.factor) || c.factor <= 0) return 'factor must be a positive number';
      if (!isFiniteNumber(c.floor)) return 'floor is not a number';
      return null;
    case 'shareAtLeast':
      if (!ownMetric(c.numerator) || !ownMetric(c.other)) return 'metric not measured for this tile';
      if (!isFiniteNumber(c.rate) || c.rate < 0 || c.rate > 1) return 'rate must be between 0 and 1';
      if (!isFiniteNumber(c.minTotal) || c.minTotal < 0) return 'minTotal must be a non-negative number';
      return null;
    case 'anyLowerBound':
      if (!Array.isArray(c.metrics) || c.metrics.length === 0) return 'metrics list is empty';
      if (!c.metrics.every(ownMetric)) return 'metric not measured for this tile';
      return null;
    case 'flag':
      if (typeof c.flag !== 'string' || !(vocab.flags as readonly string[]).includes(c.flag)) {
        return 'flag not measured for this tile';
      }
      return null;
    default:
      return 'unknown condition kind';
  }
}

/** Null when the list is usable; otherwise the first problem found. */
export function validateRuleList(tile: MeasuredTileId, rules: unknown): RuleErrorReport | null {
  if (!Array.isArray(rules)) return { tile, ruleId: null, reason: 'rule list is not a list' };
  const ids = new Set<string>();
  let previousPriority = Number.NEGATIVE_INFINITY;

  for (const rule of rules as unknown[]) {
    if (!rule || typeof rule !== 'object') return { tile, ruleId: null, reason: 'rule is not an object' };
    const r = rule as Record<string, unknown>;
    const ruleId = typeof r.id === 'string' && r.id.trim() !== '' ? r.id : null;
    const fail = (reason: string): RuleErrorReport => ({ tile, ruleId, reason });

    if (!ruleId) return fail('rule id missing');
    if (ids.has(ruleId)) return fail('duplicate rule id');
    ids.add(ruleId);
    if (!isFiniteNumber(r.priority)) return fail('priority is not a number');
    if (r.priority <= previousPriority) return fail('priorities must be unique and ascending in list order');
    previousPriority = r.priority;
    if (r.colour !== 'red' && r.colour !== 'amber') return fail('colour must be red or amber');
    if (typeof r.description !== 'string' || r.description.trim() === '') return fail('description missing');
    if (OK_WORD.test(r.description)) return fail('a description may not say "OK"');
    const problem = conditionProblem(tile, r.condition);
    if (problem) return fail(problem);
  }
  return null;
}

// ── Matching ───────────────────────────────────────────────────────────────

/**
 * Comparisons run in integer MICRO-units (millionths: micro-dollars for spend,
 * millionths of a count otherwise), never on raw floats (QA E-1).
 *
 * Spend arrives as a sum of float `cost_usd` values, so an exact multiple can
 * miss by one ulp: $2.39 + $2.75 sums to 5.140000000000001, and $15.42 is then
 * NOT >= 3 x that, although it is exactly triple. Rounding both sides to whole
 * micro-dollars first makes an at-the-threshold value match. The resolution is
 * $0.000001, below anything the tile displays, and the counts are integers, so
 * nothing else changes.
 */
const MICRO = 1_000_000;
const micros = (value: number): number => Math.round(value * MICRO);

/** Never throws. A missing metric never matches. */
export function matchCondition(
  condition: HealthCondition<MetricId, FlagId>,
  metrics: MetricValues,
  flags: FlagValues
): boolean {
  switch (condition.kind) {
    case 'atLeast': {
      // Monotone: a lower bound at or above the value proves the value is reached.
      const m = metrics[condition.metric];
      return !!m && micros(m.value) >= micros(condition.value);
    }
    case 'ratioAtLeast': {
      const m = metrics[condition.metric];
      const b = metrics[condition.baseline];
      // SA C-2: a comparison needs both sides exact.
      if (!m || !b || !m.exact || !b.exact) return false;
      const current = micros(m.value);
      if (current < micros(condition.floor)) return false;
      if (micros(b.value) <= 0) return current > 0; // "new spend": unbounded ratio, the floor decides
      // The THRESHOLD (factor x baseline) is rounded to whole micro-units, not
      // the baseline alone: rounding the baseline first would scale its
      // rounding error by the factor and could push an exact multiple out again.
      return current >= micros(condition.factor * b.value);
    }
    case 'shareAtLeast': {
      const n = metrics[condition.numerator];
      const o = metrics[condition.other];
      if (!n || !o || !n.exact || !o.exact) return false;
      const num = micros(n.value);
      const total = num + micros(o.value);
      if (total <= 0 || total < micros(condition.minTotal)) return false;
      // num / total >= rate, without a division: num x 10^6 >= rate(in millionths) x total.
      return num * MICRO >= micros(condition.rate) * total;
    }
    case 'anyLowerBound':
      return condition.metrics.some((id) => metrics[id]?.exact === false);
    case 'flag':
      return flags[condition.flag] === true;
    default:
      return false;
  }
}

/** The first rule, in list order, whose condition matches; null = none. */
export function firstMatchingRule<R extends HealthRule<MetricId, FlagId>>(
  rules: readonly R[],
  metrics: MetricValues,
  flags: FlagValues
): R | null {
  for (const rule of rules) {
    if (matchCondition(rule.condition, metrics, flags)) return rule;
  }
  return null;
}

// ── Condition summaries (SA C-22) ──────────────────────────────────────────

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatMetricValue(metric: MetricId, value: number): string {
  return METRIC_LABELS[metric].unit === 'usd' ? formatUsd(value) : formatCount(value);
}

/** Plain words for what a condition tests, built from the condition itself. */
export function describeCondition(condition: HealthCondition<MetricId, FlagId>): string {
  switch (condition.kind) {
    case 'atLeast':
      return `${METRIC_LABELS[condition.metric].label} ≥ ${formatMetricValue(condition.metric, condition.value)}`;
    case 'ratioAtLeast':
      return (
        `${METRIC_LABELS[condition.metric].label} ≥ ${condition.factor}× ${METRIC_LABELS[condition.baseline].label}` +
        ` and ≥ ${formatMetricValue(condition.metric, condition.floor)} (both figures complete)`
      );
    case 'shareAtLeast':
      return (
        `${METRIC_LABELS[condition.numerator].label} ≥ ${Math.round(condition.rate * 100)}% of ` +
        `${METRIC_LABELS[condition.numerator].label} + ${METRIC_LABELS[condition.other].label}, ` +
        `once there are ≥ ${formatCount(condition.minTotal)} (both figures complete)`
      );
    case 'anyLowerBound':
      return `any of ${condition.metrics.map((m) => METRIC_LABELS[m].label).join(', ')} is a minimum`;
    case 'flag':
      return FLAG_LABELS[condition.flag];
    default:
      return 'unknown condition';
  }
}

function ruleViews(rules: readonly HealthRule<MetricId, FlagId>[]): HealthRuleView[] {
  return rules.map((rule) => ({
    colour: rule.colour,
    description: rule.description,
    condition: describeCondition(rule.condition),
  }));
}

// ── Links ──────────────────────────────────────────────────────────────────

function auditLink(filter: { action?: string; severity?: string }, start: Date, end: Date): string {
  const params = new URLSearchParams();
  if (filter.action) params.set('action', filter.action);
  if (filter.severity) params.set('severity', filter.severity);
  params.set('date_from', toAuditDateParam(start));
  params.set('date_to', toAuditDateParam(end));
  return `/admin/audit-trail?${params.toString()}`;
}

function analyticsLink(start: Date, end: Date): string {
  const params = new URLSearchParams({ scope: 'bos', dateFrom: start.toISOString(), dateTo: end.toISOString() });
  return `/admin/analytics?${params.toString()}`;
}

// ── Tile assembly ──────────────────────────────────────────────────────────

/** The audit event the failures tile counts. Mirrors AUDIT_EVENTS.BUSINESS_AI_ACTION_FAILED (pinned by test). */
export const AI_FAILED_ACTION = 'BUSINESS_AI_ACTION_FAILED';

const TITLES: Record<HealthTileId, string> = {
  bos_ai_settings: 'Business OS AI settings',
  bos_ai_failures: 'Failed AI actions (audited)',
  bos_ai_spend: 'Business OS AI spend (USD, estimated)',
  critical_audit: 'Critical audit events',
  entitlements_mode: 'Entitlements mode',
  scheduled_jobs: 'Scheduled jobs',
  queues: 'Queues',
};

/**
 * Whether a measurement covers everything its tile is about (SA C-10R).
 * 'complete' = every read behind the tile succeeded; 'not_measured' = some part
 * has not been measured yet; 'partial' = some part could not be read. Only
 * 'complete' can be green. The five slice 4 tiles are 'complete' whenever their
 * read succeeded (a failed read has no measurement at all).
 */
export type Completeness = 'complete' | 'not_measured' | 'partial';

export interface TileMeasurement {
  metrics: MetricValues;
  flags: FlagValues;
  figures: HealthFigure[];
  footnote: string | null;
  completeness: Completeness;
  /** The headline when the tile is shown "for information" (a tile outside GREEN_ELIGIBLE). */
  informationHeadline?: string;
  pageLink?: HealthPageLink | null;
}

/** The single "proven clear" predicate (SA C-10R.2, SC-7(b)): metrics AND figures. */
export function isProvenClearMeasurement(measurement: {
  metrics: MetricValues;
  figures: HealthFigure[];
  completeness: Completeness;
}): boolean {
  return (
    measurement.completeness === 'complete' &&
    Object.values(measurement.metrics).every((m) => m?.exact !== false) &&
    measurement.figures.every((f) => f.exact)
  );
}

/**
 * Colour one measured tile. Exported so the C-10R biconditional can be tested
 * over measurements the five slice 4 reads cannot produce yet (a figure that is
 * inexact while its metrics are exact, an incomplete measurement).
 */
export function colourTile(
  id: MeasuredTileId,
  rules: unknown,
  measurement: TileMeasurement | null,
  onRuleError?: (report: RuleErrorReport) => void
): HealthTile {
  // A tile's page link is a fact about the tile, not about its read: it stays
  // when the read fails, so an admin can still open the page (QA-3).
  const base = { id, title: TITLES[id], pageLink: measurement?.pageLink ?? tilePageLink(id) };
  try {
    const problem = validateRuleList(id, rules);
    if (problem) {
      onRuleError?.(problem);
      return {
        ...base,
        status: 'unavailable',
        headline: UNAVAILABLE_HEADLINE,
        matchedRuleId: null,
        figures: measurement?.figures ?? [],
        rules: [],
        otherwise: null,
        footnote: 'This tile\'s rules could not be applied, so it is not coloured.',
      };
    }
    const valid = rules as readonly HealthRule<MetricId, FlagId>[];
    const views = ruleViews(valid);
    const otherwise = !GREEN_ELIGIBLE.has(id)
      ? OTHERWISE_INFORMATION
      : LOWER_BOUND_TILES.has(id)
        ? OTHERWISE_GREEN_UNLESS_LOWER_BOUND
        : id === 'scheduled_jobs'
          ? OTHERWISE_JOBS
          : id === 'queues'
            ? OTHERWISE_QUEUES
            : OTHERWISE_GREEN;

    if (!measurement) {
      return {
        ...base,
        status: 'unavailable',
        headline: UNAVAILABLE_HEADLINE,
        matchedRuleId: null,
        figures: [],
        rules: views,
        otherwise,
        footnote: null,
      };
    }

    const match = firstMatchingRule(valid, measurement.metrics, measurement.flags);
    let status: TileStatus;
    let headline: string;
    if (match) {
      status = match.colour;
      headline = match.description;
    } else if (!isProvenClearMeasurement(measurement)) {
      const inexact =
        Object.values(measurement.metrics).some((m) => m?.exact === false) ||
        measurement.figures.some((f) => !f.exact);
      if (inexact && LOWER_BOUND_TILES.has(id)) {
        // SA C-18: a lower bound is never clear, whatever the rule list says.
        status = 'amber';
        headline = LOWER_BOUND_HEADLINE;
      } else if (measurement.completeness === 'not_measured') {
        status = 'not_measured';
        headline = NOT_MEASURED_HEADLINE;
      } else {
        status = 'unavailable';
        headline = UNAVAILABLE_HEADLINE;
      }
    } else if (GREEN_ELIGIBLE.has(id)) {
      status = 'green';
      headline = GREEN_HEADLINE;
    } else {
      // Exact and complete, but a tile that may never be green (OQ-9).
      status = 'neutral';
      headline = measurement.informationHeadline ?? TITLES[id];
    }

    return {
      ...base,
      status,
      headline,
      matchedRuleId: match?.id ?? null,
      figures: measurement.figures,
      rules: views,
      otherwise,
      footnote: measurement.footnote,
    };
  } catch {
    // Unreachable by construction; kept so one tile can never take the page down.
    onRuleError?.({ tile: id, ruleId: null, reason: 'evaluation threw' });
    return {
      ...base,
      status: 'unavailable',
      headline: UNAVAILABLE_HEADLINE,
      matchedRuleId: null,
      figures: [],
      rules: [],
      otherwise: null,
      footnote: null,
    };
  }
}

function exact(value: number): Measured {
  return { value, exact: true };
}

function settingsMeasurement(facts: SettingsFacts): TileMeasurement {
  const href = '/admin/business-os-llm';
  const figure = (label: string, n: number, note: string | null): HealthFigure => ({
    label,
    value: formatCount(n),
    exact: true,
    href,
    linkLabel: `${label}: ${formatCount(n)}, open Business OS AI settings`,
    note,
  });
  return {
    metrics: {
      settingsIgnored: exact(facts.ignored),
      settingsOff: exact(facts.areasOff + facts.callsOff),
    },
    flags: {},
    figures: [
      figure('Areas configured off', facts.areasOff, facts.offAreas.length ? facts.offAreas.join(', ') : null),
      figure('Calls configured off', facts.callsOff, null),
      figure(
        'Settings not being applied',
        facts.ignored,
        facts.ignoredAreas.length ? facts.ignoredAreas.join(', ') : null
      ),
      figure('Adjusted by a model rule (information)', facts.adjusted, null),
    ],
    footnote:
      '"Configured off" is what the settings say. The AI switch fails open, so a call may still run.',
    completeness: 'complete',
  };
}

function failuresMeasurement(facts: FailureFacts, w: HealthWindows): TileMeasurement {
  const total24h = facts.failed24h + facts.completed24h;
  return {
    metrics: { failed24h: exact(facts.failed24h), completed24h: exact(facts.completed24h) },
    flags: {},
    figures: [
      {
        label: 'Failed AI actions, last 24 h',
        value: `${formatCount(facts.failed24h)} of ${formatCount(total24h)} actions`,
        exact: true,
        href: auditLink({ action: AI_FAILED_ACTION }, w.last24hStart, w.end),
        linkLabel: `Failed AI actions, last 24 hours: ${formatCount(facts.failed24h)}, open in audit trail`,
        note: null,
      },
      {
        label: 'Failed AI actions, last 7 days',
        value: formatCount(facts.failed7d),
        exact: true,
        href: auditLink({ action: AI_FAILED_ACTION }, w.last7dStart, w.end),
        linkLabel: `Failed AI actions, last 7 days: ${formatCount(facts.failed7d)}, open in audit trail`,
        note: null,
      },
    ],
    footnote:
      'AI actions that failed after at least one AI call, as recorded in the audit trail. ' +
      'Share = failed ÷ (failed + completed).',
    completeness: 'complete',
  };
}

function money(m: Measured): string {
  return m.exact ? formatUsd(m.value) : `at least ${formatUsd(m.value)}`;
}

function callsText(m: Measured): string {
  return `${m.exact ? '' : 'at least '}${formatCount(m.value)} calls`;
}

function spendMeasurement(facts: SpendFacts, w: HealthWindows): TileMeasurement {
  const { sums, callsKnown } = facts;
  const figure = (
    label: string,
    current: Measured,
    previous: Measured,
    previousLabel: string,
    calls: Measured,
    start: Date,
    windowWords: string
  ): HealthFigure => ({
    label,
    value:
      `${money(current)} (${previousLabel}: ${money(previous)})` + (callsKnown ? ` · ${callsText(calls)}` : ''),
    exact: current.exact && previous.exact,
    href: analyticsLink(start, w.end),
    linkLabel: `Business OS AI spend, ${windowWords}: ${money(current)}, open in AI cost & usage`,
    note: callsKnown && calls.value > COST_ANALYTICS_ROW_CAP ? OI_P1_NOTE : null,
  });

  return {
    metrics: {
      spend24h: sums.spend24h,
      spendPrev24h: sums.spendPrev24h,
      spend7d: sums.spend7d,
      spendPrev7d: sums.spendPrev7d,
    },
    flags: {},
    figures: [
      figure('AI spend, last 24 h (USD)', sums.spend24h, sums.spendPrev24h, 'previous 24 h', sums.calls24h, w.last24hStart, 'last 24 hours'),
      figure('AI spend, last 7 days (USD)', sums.spend7d, sums.spendPrev7d, 'previous 7 days', sums.calls7d, w.last7dStart, 'last 7 days'),
    ],
    footnote:
      'USD, estimated from the model pricing table; never mixed with a business currency. ' +
      'The comparison with the previous period is computed here from one read; AI cost & usage ' +
      'computes its own "vs previous period" differently (known issue OI-P2).',
    completeness: 'complete',
  };
}

function criticalMeasurement(facts: CriticalFacts, w: HealthWindows): TileMeasurement {
  return {
    metrics: { critical24h: exact(facts.last24h) },
    flags: {},
    figures: [
      {
        label: 'Critical events, last 24 h',
        value: formatCount(facts.last24h),
        exact: true,
        href: auditLink({ severity: 'critical' }, w.last24hStart, w.end),
        linkLabel: `Critical audit events, last 24 hours: ${formatCount(facts.last24h)}, open in audit trail`,
        note: null,
      },
      {
        label: 'Critical events, last 7 days',
        value: formatCount(facts.last7d),
        exact: true,
        href: auditLink({ severity: 'critical' }, w.last7dStart, w.end),
        linkLabel: `Critical audit events, last 7 days: ${formatCount(facts.last7d)}, open in audit trail`,
        note: null,
      },
    ],
    footnote:
      'All products. "Critical" is the severity an event is recorded with, whatever the event was — ' +
      'security events, destructive operations and platform malfunctions. Normal business operations ' +
      'such as refunds and password changes are recorded at a lower severity and are not counted here.',
    completeness: 'complete',
  };
}

/** The mode in plain words (RC-5.2, FR-E1). */
export const MODE_WORDS: Record<EntitlementFacts['effective'], { word: string; meaning: string }> = {
  off: { word: 'Off', meaning: 'Plans are not checked.' },
  shadow: { word: 'Shadow', meaning: 'Plans are checked and logged; nothing is blocked.' },
  enforce: { word: 'Enforce', meaning: 'Plan limits are applied to customers.' },
};

/** Where the entitlements tile leads, in words that say so (RC-5.2, FR-E2). */
export const ENTITLEMENTS_PAGE_LINK: HealthPageLink = {
  href: '/admin/business-os-tiers',
  text: 'Open Plans & entitlements (plans and account lookup)',
};

/**
 * Static page links, by tile: shown whatever the read returned, including when
 * it failed or the rule list was invalid (QA-3).
 */
function tilePageLink(id: MeasuredTileId): HealthPageLink | null {
  if (id === 'entitlements_mode') return ENTITLEMENTS_PAGE_LINK;
  if (id === 'scheduled_jobs' || id === 'queues') return JOBS_QUEUES_PAGE_LINK;
  return null;
}

function entitlementsMeasurement(facts: EntitlementFacts): TileMeasurement {
  const mode = MODE_WORDS[facts.effective];
  return {
    metrics: {},
    flags: { entitlementEnforceRefused: facts.refused },
    figures: [
      {
        label: 'Mode in effect',
        value: mode.word,
        exact: true,
        // The tile's own visible link says where it goes; the word itself is not a link.
        href: null,
        linkLabel: null,
        note: facts.refused
          ? 'BOS_ENTITLEMENTS_MODE on Vercel asks for enforce, but the launch gate refused it, so it runs in ' +
            'shadow (see the error log). The linked page shows only the mode in effect.'
          : null,
      },
    ],
    footnote: null,
    completeness: 'complete',
    informationHeadline: `${mode.word} mode: ${mode.meaning}`,
  };
}

/** Tile 6 or 7 when the caller did not measure it on this call (input absent). */
function notMeasuredTile(id: 'scheduled_jobs' | 'queues'): HealthTile {
  return {
    id,
    title: TITLES[id],
    status: 'not_measured',
    headline: NOT_MEASURED_HEADLINE,
    matchedRuleId: null,
    figures: [],
    rules: [],
    otherwise: null,
    pageLink: null,
    footnote: 'Not measured on this load.',
  };
}

/** "3 h 10 min", "45 min", "2 d 4 h". */
export function formatMinutes(total: number): string {
  const minutes = Math.max(0, Math.floor(total));
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  return h ? `${d} d ${h} h` : `${d} d`;
}

/** Fixed words for a run read that did not succeed (the page says the same). */
export const JOBS_NOT_INSTALLED_FOOTNOTE = 'Could not check: run recording is not installed yet.';
export const JOBS_READ_FAILED_FOOTNOTE = 'Could not check: the run record could not be read just now.';

function jobsMeasurement(facts: JobsTileFacts): TileMeasurement {
  const href = `${JOBS_QUEUES_PAGE_LINK.href}#jobs`;
  if (facts.runsRead !== 'ok') {
    return {
      metrics: {},
      flags: {},
      figures: [],
      footnote: facts.runsRead === 'not_installed' ? JOBS_NOT_INSTALLED_FOOTNOTE : JOBS_READ_FAILED_FOOTNOTE,
      completeness: 'partial',
    };
  }
  // A job with no recorded run yet makes every count a lower bound, and the
  // tile "not measured" rather than clear (C-10R).
  const exactMetrics = facts.noRunYet === 0;
  const m = (value: number): Measured => ({ value, exact: exactMetrics });
  const figure = (label: string, value: string): HealthFigure => ({
    label,
    value,
    exact: true,
    href,
    linkLabel: `${label}: ${value}, open Scheduled jobs & queues`,
    note: null,
  });
  const figures = [
    figure('Jobs healthy', `${formatCount(facts.healthy)} of ${formatCount(facts.total)}`),
    figure('Jobs late', formatCount(facts.late)),
    figure('Jobs stopped', formatCount(facts.stopped)),
    figure('Jobs failing (last run, or run after run)', formatCount(facts.lastRunFailed + facts.keepsFailing)),
  ];
  if (facts.noRunYet > 0) figures.push(figure('Jobs with no run recorded yet', formatCount(facts.noRunYet)));
  if (facts.worstJob) figures.push(figure('Worst job', facts.worstJob));
  return {
    metrics: {
      jobsStopped: m(facts.stopped),
      jobsKeepFailing: m(facts.keepsFailing),
      jobsLate: m(facts.late),
      jobsLastRunFailed: m(facts.lastRunFailed),
      jobsPartlyDone: m(facts.partlyDone),
    },
    flags: {},
    figures,
    footnote:
      'Late and stopped are measured from the last start by Vercel\'s own scheduler; ' +
      'a job with no run yet is measured from when recording began.',
    completeness: facts.noRunYet > 0 ? 'not_measured' : 'complete',
  };
}

function queuesMeasurement(facts: QueuesTileFacts): TileMeasurement {
  const href = `${JOBS_QUEUES_PAGE_LINK.href}#queues`;
  const complete = facts.readOk === facts.total;
  if (facts.readOk === 0) {
    return {
      metrics: {},
      flags: {},
      figures: [],
      footnote: 'Could not check: no queue could be read just now.',
      completeness: 'partial',
    };
  }
  const m = (value: number): Measured => ({ value, exact: complete });
  const figure = (label: string, value: string): HealthFigure => ({
    label,
    value,
    exact: complete,
    href,
    linkLabel: `${label}: ${value}, open Scheduled jobs & queues`,
    note: null,
  });
  return {
    metrics: {
      queueItemsStuck: m(facts.stuck),
      queuesStoppedDraining: m(facts.stoppedDraining),
      queueDeadLettered24h: m(facts.deadLettered24h),
      queuesBehind: m(facts.behind),
      queueDeadLettered7d: m(facts.deadLettered7d),
      queueFailed24h: m(facts.failed24h),
    },
    flags: {},
    figures: [
      figure('Items due now, all queues', formatCount(facts.dueNow)),
      figure('Items stuck in progress', formatCount(facts.stuck)),
      figure('Items dead-lettered, last 24 h', formatCount(facts.deadLettered24h)),
      figure('Items failed, last 24 h', formatCount(facts.failed24h)),
      figure(
        'Oldest item due now',
        facts.oldestDueMinutes === null ? 'none' : `${formatMinutes(facts.oldestDueMinutes)} (${facts.oldestDueQueue})`
      ),
    ],
    footnote: complete
      ? 'Failed and dead-lettered items are counted by when they were due (payment queues) or queued ' +
        '(the others): no queue records when an item failed.'
      : `${formatCount(facts.total - facts.readOk)} of ${formatCount(facts.total)} queues could not be read just now.`,
    completeness: complete ? 'complete' : 'partial',
  };
}

function measureOrNull<T>(read: HealthRead<T>, build: (value: T) => TileMeasurement): TileMeasurement | null {
  return read.ok ? build(read.value) : null;
}

/** Every tile, in display order. Never throws. */
export function evaluateHealth(inputs: HealthInputs, options: EvaluateOptions = {}): HealthTile[] {
  const rules = options.rules ?? HEALTH_RULES;
  const w = inputs.windows;
  const safe = <T>(read: HealthRead<T>, build: (value: T) => TileMeasurement): TileMeasurement | null => {
    try {
      return measureOrNull(read, build);
    } catch {
      return null;
    }
  };

  return [
    colourTile('bos_ai_settings', rules.bos_ai_settings, safe(inputs.settings, settingsMeasurement), options.onRuleError),
    colourTile('bos_ai_failures', rules.bos_ai_failures, safe(inputs.failures, (f) => failuresMeasurement(f, w)), options.onRuleError),
    colourTile('bos_ai_spend', rules.bos_ai_spend, safe(inputs.spend, (s) => spendMeasurement(s, w)), options.onRuleError),
    colourTile('critical_audit', rules.critical_audit, safe(inputs.critical, (c) => criticalMeasurement(c, w)), options.onRuleError),
    colourTile('entitlements_mode', rules.entitlements_mode, safe(inputs.entitlements, entitlementsMeasurement), options.onRuleError),
    inputs.jobs
      ? colourTile('scheduled_jobs', rules.scheduled_jobs, safe(inputs.jobs, jobsMeasurement), options.onRuleError)
      : notMeasuredTile('scheduled_jobs'),
    inputs.queues
      ? colourTile('queues', rules.queues, safe(inputs.queues, queuesMeasurement), options.onRuleError)
      : notMeasuredTile('queues'),
  ];
}

/** The whole response body's `data`. */
export function buildHealthSummary(
  inputs: HealthInputs,
  generatedAt: Date,
  options: EvaluateOptions = {}
): HealthSummary {
  const w = inputs.windows;
  return {
    generatedAt: generatedAt.toISOString(),
    windows: {
      end: w.end.toISOString(),
      last24hStart: w.last24hStart.toISOString(),
      previous24hStart: w.previous24hStart.toISOString(),
      last7dStart: w.last7dStart.toISOString(),
      previous7dStart: w.previous7dStart.toISOString(),
    },
    tiles: evaluateHealth(inputs, options),
  };
}
