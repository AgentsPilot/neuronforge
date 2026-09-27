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
 * Colour: the FIRST matching rule, in list order (see `rules.ts`). No match →
 * grey "Normal" — unless any of the tile's figures is a lower bound, in which
 * case the tile is amber whatever the rules say (SA C-18).
 *
 * @module lib/admin/health/evaluateHealth
 */

import type {
  HealthFigure,
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

// ── Fixed texts ────────────────────────────────────────────────────────────

export const NORMAL_HEADLINE = 'Normal';
export const NOT_MEASURED_HEADLINE = 'Not measured yet';
export const UNAVAILABLE_HEADLINE = 'Could not check just now';
/** The SA C-18 invariant's headline: a lower bound is never "Normal". */
export const LOWER_BOUND_HEADLINE = 'Total is a minimum; not all calls counted';
export const OI_P1_NOTE =
  'AI cost & usage reads at most 1,000 calls per period (known issue OI-P1), so it will show less than this.';
/** The closing line of a rule list when the tile's figures are always exact. */
export const OTHERWISE_NORMAL = 'Otherwise: Normal.';
/**
 * The closing line for a tile whose figures can be a lower bound (SA C-18): the
 * evaluator makes such a tile amber when no rule matches, so "Normal" alone
 * would be untrue.
 */
export const OTHERWISE_NORMAL_UNLESS_LOWER_BOUND =
  `Otherwise: Normal, unless a figure is only a minimum; then amber: "${LOWER_BOUND_HEADLINE}".`;
/** Tiles whose metrics can arrive as a lower bound (only spend is read with a ceiling). */
const LOWER_BOUND_TILES: ReadonlySet<MeasuredTileId> = new Set<MeasuredTileId>(['bos_ai_spend']);

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

interface Measurement {
  metrics: MetricValues;
  flags: FlagValues;
  figures: HealthFigure[];
  footnote: string | null;
}

function colourTile(
  id: MeasuredTileId,
  rules: unknown,
  measurement: Measurement | null,
  onRuleError?: (report: RuleErrorReport) => void
): HealthTile {
  const base = { id, title: TITLES[id] };
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
    const otherwise = LOWER_BOUND_TILES.has(id) ? OTHERWISE_NORMAL_UNLESS_LOWER_BOUND : OTHERWISE_NORMAL;

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
    } else if (Object.values(measurement.metrics).some((m) => m?.exact === false)) {
      // SA C-18: a lower bound is never "Normal", whatever the rule list says.
      status = 'amber';
      headline = LOWER_BOUND_HEADLINE;
    } else {
      status = 'neutral';
      headline = NORMAL_HEADLINE;
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

function settingsMeasurement(facts: SettingsFacts): Measurement {
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
  };
}

function failuresMeasurement(facts: FailureFacts, w: HealthWindows): Measurement {
  const total24h = facts.failed24h + facts.completed24h;
  return {
    metrics: { failed24h: exact(facts.failed24h), completed24h: exact(facts.completed24h) },
    flags: {},
    figures: [
      {
        label: 'Failed, last 24 h',
        value: `${formatCount(facts.failed24h)} of ${formatCount(total24h)} actions`,
        exact: true,
        href: auditLink({ action: AI_FAILED_ACTION }, w.last24hStart, w.end),
        linkLabel: `Failed AI actions, last 24 hours: ${formatCount(facts.failed24h)}, open in audit trail`,
        note: null,
      },
      {
        label: 'Failed, last 7 days',
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
  };
}

function money(m: Measured): string {
  return m.exact ? formatUsd(m.value) : `at least ${formatUsd(m.value)}`;
}

function callsText(m: Measured): string {
  return `${m.exact ? '' : 'at least '}${formatCount(m.value)} calls`;
}

function spendMeasurement(facts: SpendFacts, w: HealthWindows): Measurement {
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
      figure('Last 24 h', sums.spend24h, sums.spendPrev24h, 'previous 24 h', sums.calls24h, w.last24hStart, 'last 24 hours'),
      figure('Last 7 days', sums.spend7d, sums.spendPrev7d, 'previous 7 days', sums.calls7d, w.last7dStart, 'last 7 days'),
    ],
    footnote:
      'USD, estimated from the model pricing table; never mixed with a business currency. ' +
      'The comparison with the previous period is computed here from one read; AI cost & usage ' +
      'computes its own "vs previous period" differently (known issue OI-P2).',
  };
}

function criticalMeasurement(facts: CriticalFacts, w: HealthWindows): Measurement {
  return {
    metrics: { critical24h: exact(facts.last24h) },
    flags: {},
    figures: [
      {
        label: 'Last 24 h',
        value: formatCount(facts.last24h),
        exact: true,
        href: auditLink({ severity: 'critical' }, w.last24hStart, w.end),
        linkLabel: `Critical audit events, last 24 hours: ${formatCount(facts.last24h)}, open in audit trail`,
        note: null,
      },
      {
        label: 'Last 7 days',
        value: formatCount(facts.last7d),
        exact: true,
        href: auditLink({ severity: 'critical' }, w.last7dStart, w.end),
        linkLabel: `Critical audit events, last 7 days: ${formatCount(facts.last7d)}, open in audit trail`,
        note: null,
      },
    ],
    footnote:
      'All products. "Critical" is the severity an event is recorded with; it includes routine events ' +
      'such as password changes and refunds.',
  };
}

const MODE_WORDS: Record<EntitlementFacts['effective'], { word: string; meaning: string }> = {
  off: { word: 'Off', meaning: 'Nothing is resolved, recorded or refused.' },
  shadow: { word: 'Shadow', meaning: 'Everything is resolved and recorded; nothing is refused.' },
  enforce: { word: 'Enforce', meaning: 'Plan limits are acted on.' },
};

function entitlementsMeasurement(facts: EntitlementFacts): Measurement {
  const mode = MODE_WORDS[facts.effective];
  return {
    metrics: {},
    flags: { entitlementEnforceRefused: facts.refused },
    figures: [
      {
        label: 'Mode',
        value: mode.word,
        exact: true,
        href: '/admin/business-os-tiers',
        linkLabel: `Entitlements mode: ${mode.word}, open Plans & entitlements`,
        note: facts.refused
          ? 'BOS_ENTITLEMENTS_MODE on Vercel asks for enforce, but the launch gate refused it, so it runs in ' +
            'shadow (see the error log). The linked page shows only the mode in effect.'
          : mode.meaning,
      },
    ],
    footnote: null,
  };
}

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
    footnote:
      id === 'scheduled_jobs'
        ? 'Job runs are not recorded anywhere yet (roadmap R-2). No page yet.'
        : 'Queue depth (payment reminders, automations) is not recorded anywhere yet (roadmap R-2). No page yet.',
  };
}

function measureOrNull<T>(read: HealthRead<T>, build: (value: T) => Measurement): Measurement | null {
  return read.ok ? build(read.value) : null;
}

/** Every tile, in display order. Never throws. */
export function evaluateHealth(inputs: HealthInputs, options: EvaluateOptions = {}): HealthTile[] {
  const rules = options.rules ?? HEALTH_RULES;
  const w = inputs.windows;
  const safe = <T>(read: HealthRead<T>, build: (value: T) => Measurement): Measurement | null => {
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
    notMeasuredTile('scheduled_jobs'),
    notMeasuredTile('queues'),
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
