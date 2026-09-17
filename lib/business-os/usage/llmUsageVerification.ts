/**
 * Business OS LLM usage verification — the pure logic (Layer 1.1).
 *
 * Request validation, the report window, row classification, the five checks
 * and the area totals. No I/O: `llmUsageReport.ts` does the reads and passes
 * their results in, so every rule here is unit-tested without a database.
 *
 * Every feature value, area, call name, known component and helper label comes
 * from `lib/business-os/llm/callCatalog.ts`; nothing is hand-typed here.
 *
 * STATUS PRECEDENCE (every check): a read error → Fail; a failing finding →
 * Fail; the paged read hit its ceiling → Incomplete (never Pass); no data →
 * Info; otherwise Pass. Pass/Fail is computed from ALL rows read; only the
 * lists returned for display are capped.
 *
 * @module lib/business-os/usage/llmUsageVerification
 */

import { z } from 'zod';
import {
  BOS_KNOWN_NON_CATALOG_COMPONENTS,
  BOS_LEGACY_FEATURES,
  BOS_LEGACY_HELPER_LABEL,
  BOS_LLM_AREAS,
  BOS_LLM_CALLS,
  bosFeature,
  isBusinessOsFeature,
  isPlatformAccount,
  type BosLlmArea,
  type BosRowFlagExemption,
} from '@/lib/business-os/llm/callCatalog';
import type { LedgerCallRow, LedgerLabelRow } from '@/lib/repositories/TokenUsageRepository';
import { summariseUsageByCategory, usageCategoryForFeature, OTHER_USAGE_CATEGORY } from './usageCategories';
import { toCredits, type UsageSummary, type UsageSummedBy } from './usageSummary';
import type {
  ActionGroup,
  AreaTotals,
  AreaTotalsLine,
  CallsCheck,
  CheckStatus,
  GroupsCheck,
  LegacyLabelsCheck,
  LlmUsageCallRow,
  PlatformAccountCheck,
  RowFlag,
  UngroupedCallRow,
  UsageCardCheck,
} from './llmUsageReportTypes';

// ─── Limits ──────────────────────────────────────────────────────────────────

export const LLM_USAGE_LIMITS = {
  PAGE_SIZE: 1000,
  READ_CEILING: 5000,
  DISPLAY_ROWS: 500,
  DISPLAY_GROUPS: 500,
  PLATFORM_BREAKDOWN_ROWS: 500,
  HELPER_TIMESTAMPS: 50,
  BUSINESS_LIST: 50,
  SEARCH_MAX_CHARS: 100,
  MAX_WINDOW_MS: 7 * 24 * 60 * 60 * 1000,
  CLOCK_SKEW_MS: 60 * 1000,
} as const;

// ─── Messages (fixed strings; never echo input or raw errors) ────────────────

export const PLATFORM_ACCOUNT_MESSAGE =
  'This is the platform account; its Business OS rows are shown in Check 2';

export const READ_FAILED_MESSAGE = 'Could not read the usage ledger for this check';

export const INCOMPLETE_MESSAGE = 'more than 5,000 Business OS calls in this window; narrow the start time';

// ─── Request validation (FR-3) ───────────────────────────────────────────────

/**
 * Built per request so the 60 s clock-skew allowance and the 7-day bound are
 * measured from that request's own receipt time.
 */
export function buildReportQuerySchema(receivedAt: Date) {
  const now = receivedAt.getTime();

  return z.object({
    accountId: z
      .string({ required_error: 'Account id is required', invalid_type_error: 'Account id is required' })
      .uuid('Account id must be a UUID')
      .transform((id) => id.toLowerCase())
      .refine((id) => !isPlatformAccount(id), PLATFORM_ACCOUNT_MESSAGE),
    since: z
      .string({ required_error: 'Start time is required', invalid_type_error: 'Start time is required' })
      .datetime({ offset: true, message: 'Start time must be an ISO 8601 timestamp' })
      .superRefine((iso, ctx) => {
        const ms = Date.parse(iso);
        if (ms > now + LLM_USAGE_LIMITS.CLOCK_SKEW_MS) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Start time is in the future' });
        } else if (ms < now - LLM_USAGE_LIMITS.MAX_WINDOW_MS - LLM_USAGE_LIMITS.CLOCK_SKEW_MS) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Start time is more than 7 days ago; the maximum window is 7 days',
          });
        }
      }),
    trigger: z.enum(['manual', 'auto']).default('manual'),
  });
}

export type ReportQuery = z.infer<ReturnType<typeof buildReportQuerySchema>>;

export const BusinessListQuerySchema = z.object({
  search: z
    .string()
    .max(LLM_USAGE_LIMITS.SEARCH_MAX_CHARS, 'Search must be at most 100 characters')
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    }),
});

/** The first issue's message: fixed strings from the schemas above. */
export function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid query';
}

export interface ReportWindow {
  start: Date;
  end: Date;
  /** The start was up to 60 s ahead of the server clock and was moved to now. */
  startClamped: boolean;
}

/** start = min(since, receivedAt); end = receivedAt, the one fixed end for every windowed read. */
export function resolveReportWindow(sinceIso: string, receivedAt: Date): ReportWindow {
  const since = new Date(sinceIso);
  const startClamped = since.getTime() > receivedAt.getTime();
  return {
    start: startClamped ? new Date(receivedAt.getTime()) : since,
    end: new Date(receivedAt.getTime()),
    startClamped,
  };
}

// ─── Read results passed in from the orchestrator ────────────────────────────

export type ReadResult<T> = { ok: true; value: T } | { ok: false };

export function readOk<T>(value: T): ReadResult<T> {
  return { ok: true, value };
}

export const READ_FAILED: ReadResult<never> = { ok: false };

// ─── Row classification (FR-6, FR-12, RC-2, RC-4) ────────────────────────────

type KnownComponent = (typeof BOS_KNOWN_NON_CATALOG_COMPONENTS)[keyof typeof BOS_KNOWN_NON_CATALOG_COMPONENTS];

const KNOWN_COMPONENTS: ReadonlyMap<string, KnownComponent> = new Map(
  Object.values(BOS_KNOWN_NON_CATALOG_COMPONENTS).map((entry) => [entry.component, entry])
);

function areaOfFeature(feature: string): { kind: 'current' | 'legacy'; area: BosLlmArea } | null {
  for (const area of BOS_LLM_AREAS) {
    if (feature === bosFeature(area)) return { kind: 'current', area };
  }
  for (const area of BOS_LLM_AREAS) {
    if ((BOS_LEGACY_FEATURES[area] as readonly string[]).includes(feature)) return { kind: 'legacy', area };
  }
  return null;
}

function isExempt(known: KnownComponent | null, flag: BosRowFlagExemption): boolean {
  return !!known && (known.exemptFrom as readonly BosRowFlagExemption[]).includes(flag);
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Classify one Business OS row: its area, and which of the four flags it
 * carries. A known non-catalog component is exempt only under its own area.
 * Legacy and unknown-area rows are already flagged, so their call names are
 * not judged against the catalog as well.
 */
export function classifyCallRow(row: LedgerCallRow): LlmUsageCallRow {
  const feature = row.feature ?? '';
  const resolved = areaOfFeature(feature);
  const flags: RowFlag[] = [];

  let known: KnownComponent | null = null;
  if (resolved?.kind === 'current' && row.component) {
    const candidate = KNOWN_COMPONENTS.get(row.component) ?? null;
    if (candidate && candidate.area === resolved.area) known = candidate;
  }

  if (!resolved) {
    flags.push('unknown_area');
  } else if (resolved.kind === 'legacy') {
    flags.push('legacy_feature');
  } else {
    const calls = BOS_LLM_CALLS[resolved.area] as readonly string[];
    if (!(row.component && calls.includes(row.component)) && !isExempt(known, 'unknown_call_name')) {
      flags.push('unknown_call_name');
    }
  }

  if (!row.session_id && !isExempt(known, 'missing_group_id')) {
    flags.push('missing_group_id');
  }

  const inputTokens = toNumber(row.input_tokens);
  const outputTokens = toNumber(row.output_tokens);
  const success = row.success !== false;

  return {
    createdAt: row.created_at,
    feature,
    areaKind: resolved?.kind ?? 'unknown',
    area: resolved?.area ?? null,
    areaLabel: !resolved ? 'unknown' : resolved.kind === 'legacy' ? 'legacy' : resolved.area,
    component: row.component,
    sessionId: row.session_id,
    inputTokens,
    outputTokens,
    tokens: inputTokens + outputTokens,
    estimatedCostUsd: toNumber(row.cost_usd),
    success,
    errorCode: success ? null : row.error_code,
    flags,
    knownComponent: known ? { component: known.component, reason: known.reason } : null,
  };
}

function statusOf(opts: { readFailed: boolean; failing: boolean; incomplete: boolean; empty: boolean }): CheckStatus {
  if (opts.readFailed || opts.failing) return 'fail';
  if (opts.incomplete) return 'incomplete';
  if (opts.empty) return 'info';
  return 'pass';
}

function emptyFlagCounts(): Record<RowFlag, number> {
  return { legacy_feature: 0, unknown_area: 0, unknown_call_name: 0, missing_group_id: 0 };
}

export interface PagedCalls {
  rows: LlmUsageCallRow[];
  incomplete: boolean;
}

// ─── Check 1: Calls (FR-12) ──────────────────────────────────────────────────

export function evaluateCallsCheck(read: ReadResult<PagedCalls>): CallsCheck {
  if (!read.ok) {
    return {
      status: 'fail',
      error: READ_FAILED_MESSAGE,
      rowsRead: 0,
      incomplete: false,
      flaggedRows: 0,
      flagCounts: emptyFlagCounts(),
      rows: [],
      rowsTruncated: false,
      displayCap: LLM_USAGE_LIMITS.DISPLAY_ROWS,
    };
  }

  const { rows, incomplete } = read.value;
  const flagCounts = emptyFlagCounts();
  let flaggedRows = 0;
  for (const row of rows) {
    if (row.flags.length) flaggedRows++;
    for (const flag of row.flags) flagCounts[flag]++;
  }

  return {
    status: statusOf({ readFailed: false, failing: flaggedRows > 0, incomplete, empty: rows.length === 0 }),
    error: null,
    rowsRead: rows.length,
    incomplete,
    flaggedRows,
    flagCounts,
    // Already newest first (the read's order).
    rows: rows.slice(0, LLM_USAGE_LIMITS.DISPLAY_ROWS),
    rowsTruncated: rows.length > LLM_USAGE_LIMITS.DISPLAY_ROWS,
    displayCap: LLM_USAGE_LIMITS.DISPLAY_ROWS,
  };
}

// ─── Check 2: Nothing on the platform account (FR-13) ────────────────────────

export function evaluatePlatformAccountCheck(
  count: ReadResult<number>,
  breakdownRows: ReadResult<LedgerLabelRow[]>
): PlatformAccountCheck {
  const base = {
    breakdownCap: LLM_USAGE_LIMITS.PLATFORM_BREAKDOWN_ROWS,
  };

  if (!count.ok) {
    return {
      ...base,
      status: 'fail',
      error: 'Platform-account count could not be read',
      count: null,
      breakdown: [],
      breakdownRowsRead: 0,
      breakdownTruncated: false,
    };
  }

  const breakdownMap = new Map<string, { feature: string; component: string | null; calls: number }>();
  const rows = breakdownRows.ok ? breakdownRows.value : [];
  for (const row of rows) {
    const feature = row.feature ?? '';
    const key = JSON.stringify([feature, row.component ?? null]);
    const entry = breakdownMap.get(key) ?? { feature, component: row.component, calls: 0 };
    entry.calls++;
    breakdownMap.set(key, entry);
  }
  const breakdown = [...breakdownMap.values()].sort(
    (a, b) => b.calls - a.calls || a.feature.localeCompare(b.feature)
  );

  return {
    ...base,
    status: count.value > 0 || !breakdownRows.ok ? 'fail' : 'pass',
    error: breakdownRows.ok ? null : 'Platform-account breakdown could not be read',
    count: count.value,
    breakdown,
    breakdownRowsRead: rows.length,
    breakdownTruncated: rows.length < count.value,
  };
}

// ─── Check 3: No legacy labels (FR-14) ───────────────────────────────────────

export interface LegacyLabelsInputs {
  selectedCalls: ReadResult<PagedCalls>;
  legacyOnPlatformCount: ReadResult<number>;
  helperLabelOnSelectedCount: ReadResult<number>;
  helperLabelOnPlatformCount: ReadResult<number>;
  helperLabelOnPlatformRows: ReadResult<LedgerLabelRow[]>;
}

export function evaluateLegacyLabelsCheck(inputs: LegacyLabelsInputs): LegacyLabelsCheck {
  const failedParts: string[] = [];

  let legacyOnSelected: LegacyLabelsCheck['legacyOnSelected'] = null;
  if (inputs.selectedCalls.ok) {
    const byFeature = new Map<string, number>();
    for (const row of inputs.selectedCalls.value.rows) {
      if (row.areaKind === 'legacy') byFeature.set(row.feature, (byFeature.get(row.feature) ?? 0) + 1);
    }
    legacyOnSelected = {
      count: [...byFeature.values()].reduce((a, b) => a + b, 0),
      byFeature: [...byFeature.entries()].map(([feature, calls]) => ({ feature, calls })),
      incomplete: inputs.selectedCalls.value.incomplete,
    };
  } else {
    failedParts.push('(a) selected-account calls');
  }

  const legacyOnPlatform = inputs.legacyOnPlatformCount.ok ? { count: inputs.legacyOnPlatformCount.value } : null;
  if (!inputs.legacyOnPlatformCount.ok) failedParts.push('(a) platform-account legacy count');

  const helperLabelOnSelected = inputs.helperLabelOnSelectedCount.ok
    ? { count: inputs.helperLabelOnSelectedCount.value }
    : null;
  if (!inputs.helperLabelOnSelectedCount.ok) failedParts.push('(b) selected-account helper-label count');

  let helperLabelOnPlatform: LegacyLabelsCheck['helperLabelOnPlatform'] = null;
  if (!inputs.helperLabelOnPlatformCount.ok) failedParts.push('(c) platform helper-label count');
  if (!inputs.helperLabelOnPlatformRows.ok) failedParts.push('(c) platform helper-label timestamps');
  if (inputs.helperLabelOnPlatformCount.ok) {
    const timestamps = inputs.helperLabelOnPlatformRows.ok
      ? inputs.helperLabelOnPlatformRows.value.slice(0, LLM_USAGE_LIMITS.HELPER_TIMESTAMPS).map((r) => r.created_at)
      : [];
    helperLabelOnPlatform = {
      count: inputs.helperLabelOnPlatformCount.value,
      timestamps,
      timestampsTruncated: inputs.helperLabelOnPlatformCount.value > timestamps.length,
      timestampCap: LLM_USAGE_LIMITS.HELPER_TIMESTAMPS,
    };
  }

  // (c) is Info only: it never makes the check fail, except when it could not be read.
  const failing =
    (legacyOnSelected?.count ?? 0) > 0 ||
    (legacyOnPlatform?.count ?? 0) > 0 ||
    (helperLabelOnSelected?.count ?? 0) > 0;

  return {
    // No data is still Pass here: no legacy labels were found (FR-14).
    status: statusOf({
      readFailed: failedParts.length > 0,
      failing,
      incomplete: legacyOnSelected?.incomplete ?? false,
      empty: false,
    }),
    error: failedParts.length ? `Could not be read: ${failedParts.join('; ')}` : null,
    legacyOnSelected,
    legacyOnPlatform,
    helperLabelOnSelected,
    helperLabelOnPlatform,
    helperLabel: { feature: BOS_LEGACY_HELPER_LABEL.feature, component: BOS_LEGACY_HELPER_LABEL.component },
  };
}

// ─── Check 4: Grouped by action (FR-15) ──────────────────────────────────────

export function summariseCalls(calls: Array<{ component: string; count: number }>): string {
  return calls.map((c) => (c.count > 1 ? `${c.component} ×${c.count}` : c.component)).join(', ');
}

export function evaluateGroupsCheck(read: ReadResult<PagedCalls>): GroupsCheck {
  const base = { displayCap: LLM_USAGE_LIMITS.DISPLAY_GROUPS };

  if (!read.ok) {
    return {
      ...base,
      status: 'fail',
      error: READ_FAILED_MESSAGE,
      incomplete: false,
      groups: [],
      groupsTotal: 0,
      groupsTruncated: false,
      ungrouped: [],
      ungroupedTotal: 0,
      ungroupedFlagged: 0,
      ungroupedTruncated: false,
    };
  }

  const { rows, incomplete } = read.value;
  const bySession = new Map<string, LlmUsageCallRow[]>();
  const ungroupedAll: UngroupedCallRow[] = [];

  for (const row of rows) {
    if (row.sessionId) {
      const list = bySession.get(row.sessionId) ?? [];
      list.push(row);
      bySession.set(row.sessionId, list);
    } else {
      ungroupedAll.push({ ...row, expected: !row.flags.includes('missing_group_id') });
    }
  }

  const groups: ActionGroup[] = [...bySession.entries()].map(([sessionId, groupRows]) => {
    const ascending = [...groupRows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const calls: Array<{ component: string; count: number }> = [];
    for (const row of ascending) {
      const component = row.component ?? '(none)';
      const existing = calls.find((c) => c.component === component);
      if (existing) existing.count++;
      else calls.push({ component, count: 1 });
    }
    const labels = new Set(groupRows.map((r) => r.areaLabel));
    return {
      sessionId,
      areaLabel: labels.size === 1 ? [...labels][0] : 'mixed',
      callCount: groupRows.length,
      calls,
      callSummary: summariseCalls(calls),
      tokens: groupRows.reduce((sum, r) => sum + r.tokens, 0),
      estimatedCostUsd: groupRows.reduce((sum, r) => sum + r.estimatedCostUsd, 0),
      firstAt: ascending[0].createdAt,
      lastAt: ascending[ascending.length - 1].createdAt,
    };
  });
  groups.sort((a, b) => b.lastAt.localeCompare(a.lastAt));

  const ungroupedFlagged = ungroupedAll.filter((r) => !r.expected).length;

  return {
    ...base,
    status: statusOf({ readFailed: false, failing: ungroupedFlagged > 0, incomplete, empty: rows.length === 0 }),
    error: null,
    incomplete,
    groups: groups.slice(0, LLM_USAGE_LIMITS.DISPLAY_GROUPS),
    groupsTotal: groups.length,
    groupsTruncated: groups.length > LLM_USAGE_LIMITS.DISPLAY_GROUPS,
    ungrouped: ungroupedAll.slice(0, LLM_USAGE_LIMITS.DISPLAY_ROWS),
    ungroupedTotal: ungroupedAll.length,
    ungroupedFlagged,
    ungroupedTruncated: ungroupedAll.length > LLM_USAGE_LIMITS.DISPLAY_ROWS,
  };
}

// ─── Check 5: Usage card view (FR-16) ────────────────────────────────────────

export interface UsageCardInputs {
  summary: ReadResult<{ summary: UsageSummary; summedBy: UsageSummedBy }>;
  tokensPerCredit: number;
}

export function evaluateUsageCardCheck({ summary, tokensPerCredit }: UsageCardInputs): UsageCardCheck {
  if (!summary.ok) {
    return {
      status: 'fail',
      error: READ_FAILED_MESSAGE,
      summedBy: null,
      tokensPerCredit,
      windowEnd: 'open',
      totals: null,
      categories: [],
      otherFeatures: [],
    };
  }

  const { summary: usage, summedBy } = summary.value;
  const categories = [...summariseUsageByCategory(usage.byFeature).entries()]
    .map(([key, v]) => ({
      key,
      tokens: v.tokens,
      calls: v.calls,
      credits: toCredits(v.tokens, tokensPerCredit),
      shownOnCard: v.tokens > 0,
    }))
    .sort((a, b) => b.tokens - a.tokens || a.key.localeCompare(b.key));

  const otherFeatures = [...usage.byFeature.entries()]
    .filter(([feature]) => usageCategoryForFeature(feature) === OTHER_USAGE_CATEGORY)
    .map(([feature, v]) => ({ feature, tokens: v.tokens, calls: v.calls, isBusinessOs: isBusinessOsFeature(feature) }))
    .sort((a, b) => b.tokens - a.tokens || a.feature.localeCompare(b.feature));

  return {
    status: statusOf({
      readFailed: false,
      failing: otherFeatures.some((f) => f.isBusinessOs),
      incomplete: false,
      empty: usage.totalCalls === 0,
    }),
    error: null,
    summedBy,
    tokensPerCredit,
    windowEnd: 'open',
    totals: {
      tokens: usage.totalTokens,
      calls: usage.totalCalls,
      credits: toCredits(usage.totalTokens, tokensPerCredit),
    },
    categories,
    otherFeatures,
  };
}

// ─── Area totals (FR-17) ─────────────────────────────────────────────────────

export function computeAreaTotals(read: ReadResult<PagedCalls>): AreaTotals {
  const empty = { calls: 0, tokens: 0, estimatedCostUsd: 0 };

  if (!read.ok) {
    return { status: 'error', error: READ_FAILED_MESSAGE, lines: [], total: { ...empty } };
  }

  const lines = new Map<string, AreaTotalsLine>();
  for (const area of BOS_LLM_AREAS) lines.set(area, { key: area, kind: 'area', ...empty });
  lines.set('legacy', { key: 'legacy', kind: 'legacy', ...empty });

  const total = { ...empty };
  for (const row of read.value.rows) {
    const key = row.areaKind === 'current' ? (row.area as string) : row.areaKind;
    if (!lines.has(key)) lines.set(key, { key, kind: 'unknown', ...empty });
    const line = lines.get(key) as AreaTotalsLine;
    line.calls++;
    line.tokens += row.tokens;
    line.estimatedCostUsd += row.estimatedCostUsd;
    total.calls++;
    total.tokens += row.tokens;
    total.estimatedCostUsd += row.estimatedCostUsd;
  }

  return {
    status: read.value.incomplete ? 'incomplete' : 'complete',
    error: null,
    lines: [...lines.values()],
    total,
  };
}
