/**
 * Layer 1.1 check logic — pure functions, no database.
 * AC-3 (schema, window), AC-4 (derived coverage), AC-6 to AC-12.
 *
 * Fixtures are built from the catalog constants, so adding an area or a call
 * name to the catalog extends these cases automatically.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

import {
  BOS_KNOWN_NON_CATALOG_COMPONENTS,
  BOS_LEGACY_FEATURES,
  BOS_LEGACY_FEATURES_FLAT,
  BOS_LLM_AREAS,
  BOS_LLM_CALLS,
  bosFeature,
} from '@/lib/business-os/llm/callCatalog';
import type { LedgerCallRow, LedgerLabelRow } from '@/lib/repositories/TokenUsageRepository';
import {
  BusinessListQuerySchema,
  LLM_USAGE_LIMITS,
  PLATFORM_ACCOUNT_MESSAGE,
  READ_FAILED,
  buildReportQuerySchema,
  classifyCallRow,
  computeAreaTotals,
  evaluateCallsCheck,
  evaluateGroupsCheck,
  evaluateLegacyLabelsCheck,
  evaluatePlatformAccountCheck,
  evaluateUsageCardCheck,
  firstIssueMessage,
  readOk,
  resolveReportWindow,
  summariseCalls,
  type LegacyLabelsInputs,
  type PagedCalls,
} from '../llmUsageVerification';
import { summariseUsageByCategory } from '../usageCategories';
import type { UsageSummary } from '../usageSummary';

const ACCOUNT = '2f734ed5-3681-4049-880d-3de7b096bea3';
const ZERO = '00000000-0000-0000-0000-000000000000';
const SYS = '22222222-2222-4222-8222-222222222222';
const RECEIVED = new Date('2026-09-17T12:00:00.000Z');
const S1 = '33333333-3333-4333-8333-333333333333';
const S2 = '44444444-4444-4444-8444-444444444444';

const CHAT = bosFeature('chat');
const WEBSITE = bosFeature('website');
const PLAN_CACHE = BOS_KNOWN_NON_CATALOG_COMPONENTS.BizQLPlanCache.component;
const INTENT_PARSER = BOS_KNOWN_NON_CATALOG_COMPONENTS.IntentParser.component;
const PLANNER = BOS_LLM_CALLS.chat[0];
const ANALYSIS = BOS_LLM_CALLS.chat[1];

let seq = 0;
function ledger(overrides: Partial<LedgerCallRow> = {}): LedgerCallRow {
  seq++;
  return {
    id: `row-${seq}`,
    created_at: new Date(RECEIVED.getTime() - seq * 1000).toISOString(),
    feature: CHAT,
    component: PLANNER,
    session_id: S1,
    input_tokens: 100,
    output_tokens: 20,
    cost_usd: '0.0012',
    success: true,
    error_code: null,
    ...overrides,
  };
}

function paged(rows: LedgerCallRow[], incomplete = false) {
  return readOk<PagedCalls>({ rows: rows.map(classifyCallRow), incomplete });
}

beforeEach(() => {
  seq = 0;
  delete process.env.SYSTEM_ADMIN_USER_ID;
});

// ─── AC-3: request schema and window ─────────────────────────────────────────

describe('report query schema (AC-3)', () => {
  const schema = () => buildReportQuerySchema(RECEIVED);
  const iso = (offsetMs: number) => new Date(RECEIVED.getTime() + offsetMs).toISOString();

  function parse(query: Record<string, unknown>) {
    return schema().safeParse({ accountId: ACCOUNT, since: iso(-3600_000), ...query });
  }

  function message(query: Record<string, unknown>) {
    const result = parse(query);
    expect(result.success).toBe(false);
    return result.success ? '' : firstIssueMessage(result.error);
  }

  it('accepts a valid query and defaults trigger to manual', () => {
    const result = parse({});
    expect(result.success && result.data).toEqual({ accountId: ACCOUNT, since: iso(-3600_000), trigger: 'manual' });
  });

  it('lower-cases the account id', () => {
    const result = parse({ accountId: ACCOUNT.toUpperCase() });
    expect(result.success && result.data.accountId).toBe(ACCOUNT);
  });

  it('rejects a missing or non-UUID account id', () => {
    expect(message({ accountId: undefined })).toBe('Account id is required');
    expect(message({ accountId: 'abc' })).toBe('Account id must be a UUID');
  });

  it('rejects the all-zero platform account with the platform message', () => {
    expect(message({ accountId: ZERO })).toBe(PLATFORM_ACCOUNT_MESSAGE);
  });

  it('rejects SYSTEM_ADMIN_USER_ID (any case) with the platform message', () => {
    process.env.SYSTEM_ADMIN_USER_ID = SYS;
    expect(message({ accountId: SYS.toUpperCase() })).toBe(PLATFORM_ACCOUNT_MESSAGE);
  });

  it('rejects a malformed start time', () => {
    expect(message({ since: 'yesterday' })).toBe('Start time must be an ISO 8601 timestamp');
    expect(message({ since: undefined })).toBe('Start time is required');
  });

  it('allows up to 60 s of clock skew into the future, not more', () => {
    expect(parse({ since: iso(59_000) }).success).toBe(true);
    expect(parse({ since: iso(60_000) }).success).toBe(true);
    expect(message({ since: iso(61_000) })).toBe('Start time is in the future');
  });

  it('allows 7 days plus 60 s into the past, not more', () => {
    const week = LLM_USAGE_LIMITS.MAX_WINDOW_MS;
    expect(parse({ since: iso(-week - 59_000) }).success).toBe(true);
    expect(message({ since: iso(-week - 61_000) })).toBe(
      'Start time is more than 7 days ago; the maximum window is 7 days'
    );
  });

  it('accepts a start time with a zone offset', () => {
    expect(parse({ since: '2026-09-17T13:30:00+02:00' }).success).toBe(true);
  });

  it('accepts manual and auto triggers only', () => {
    expect(parse({ trigger: 'auto' }).success).toBe(true);
    expect(message({ trigger: 'bogus' })).toMatch(/Invalid enum value/);
  });
});

describe('business list query schema (AC-3)', () => {
  it('accepts up to 100 characters and trims', () => {
    expect(BusinessListQuerySchema.safeParse({ search: 'x'.repeat(100) }).success).toBe(true);
    const result = BusinessListQuerySchema.safeParse({ search: '  acme  ' });
    expect(result.success && result.data.search).toBe('acme');
  });

  it('rejects 101 characters', () => {
    const result = BusinessListQuerySchema.safeParse({ search: 'x'.repeat(101) });
    expect(result.success).toBe(false);
    expect(!result.success && firstIssueMessage(result.error)).toBe('Search must be at most 100 characters');
  });

  it('treats a missing or blank search as no search', () => {
    const blank = BusinessListQuerySchema.safeParse({ search: '   ' });
    expect(blank.success && blank.data.search).toBeUndefined();
    const none = BusinessListQuerySchema.safeParse({});
    expect(none.success && none.data.search).toBeUndefined();
  });
});

describe('resolveReportWindow', () => {
  it('uses the request receipt as the fixed end', () => {
    const w = resolveReportWindow('2026-09-17T11:00:00.000Z', RECEIVED);
    expect(w).toEqual({ start: new Date('2026-09-17T11:00:00.000Z'), end: RECEIVED, startClamped: false });
    expect(w.end).not.toBe(RECEIVED);
  });

  it('clamps a start slightly in the future to the end', () => {
    const w = resolveReportWindow('2026-09-17T12:00:30.000Z', RECEIVED);
    expect(w.start).toEqual(RECEIVED);
    expect(w.startClamped).toBe(true);
  });
});

// ─── AC-6: classification and Check 1 ────────────────────────────────────────

describe('classifyCallRow (AC-6)', () => {
  it('does not flag any catalog call with a grouping id, for every area (derived from the catalog)', () => {
    for (const area of BOS_LLM_AREAS) {
      for (const callName of BOS_LLM_CALLS[area]) {
        const row = classifyCallRow(ledger({ feature: bosFeature(area), component: callName }));
        expect({ area, callName, flags: row.flags }).toEqual({ area, callName, flags: [] });
        expect(row.areaLabel).toBe(area);
        expect(row.areaKind).toBe('current');
      }
    }
  });

  it('flags every legacy value as legacy and resolves its area', () => {
    for (const area of BOS_LLM_AREAS) {
      for (const legacy of BOS_LEGACY_FEATURES[area]) {
        const row = classifyCallRow(ledger({ feature: legacy, component: 'daily-briefing' }));
        expect(row.flags).toEqual(['legacy_feature']);
        expect(row.area).toBe(area);
        expect(row.areaLabel).toBe('legacy');
      }
    }
  });

  it('flags an unknown business-os area', () => {
    const row = classifyCallRow(ledger({ feature: 'business-os-webiste', component: 'full_site' }));
    expect(row.flags).toEqual(['unknown_area']);
    expect(row.areaLabel).toBe('unknown');
    expect(row.area).toBeNull();
  });

  it('flags a call name that is not in the catalog for its area', () => {
    expect(classifyCallRow(ledger({ feature: WEBSITE, component: PLANNER })).flags).toEqual(['unknown_call_name']);
    expect(classifyCallRow(ledger({ component: null })).flags).toEqual(['unknown_call_name']);
  });

  it('flags a missing grouping id', () => {
    expect(classifyCallRow(ledger({ session_id: null })).flags).toEqual(['missing_group_id']);
  });

  it('exempts the plan-cache row from the call-name flag only', () => {
    const withGroup = classifyCallRow(ledger({ component: PLAN_CACHE }));
    expect(withGroup.flags).toEqual([]);
    expect(withGroup.knownComponent?.component).toBe(PLAN_CACHE);
    expect(classifyCallRow(ledger({ component: PLAN_CACHE, session_id: null })).flags).toEqual(['missing_group_id']);
  });

  it('exempts the intent parser from both flags, but only under chat', () => {
    expect(classifyCallRow(ledger({ component: INTENT_PARSER, session_id: null })).flags).toEqual([]);
    expect(classifyCallRow(ledger({ feature: WEBSITE, component: INTENT_PARSER, session_id: null })).flags).toEqual([
      'unknown_call_name',
      'missing_group_id',
    ]);
  });

  it('carries tokens, cost and the error code only for a failed call', () => {
    const ok = classifyCallRow(ledger({ input_tokens: 7, output_tokens: 3, cost_usd: '0.5', error_code: 'X' }));
    expect(ok).toMatchObject({ tokens: 10, estimatedCostUsd: 0.5, success: true, errorCode: null });
    const failed = classifyCallRow(ledger({ success: false, error_code: 'rate_limited', input_tokens: null }));
    expect(failed).toMatchObject({ success: false, errorCode: 'rate_limited', inputTokens: 0 });
  });
});

describe('Check 1: calls (AC-6, AC-12)', () => {
  it('passes when every row is clean', () => {
    const check = evaluateCallsCheck(paged([ledger(), ledger({ component: ANALYSIS })]));
    expect(check).toMatchObject({ status: 'pass', flaggedRows: 0, rowsRead: 2, rowsTruncated: false });
  });

  it('is info with no rows', () => {
    expect(evaluateCallsCheck(paged([])).status).toBe('info');
  });

  it('fails and counts each flag', () => {
    const check = evaluateCallsCheck(
      paged([ledger(), ledger({ feature: 'lead-reply' }), ledger({ session_id: null }), ledger({ feature: 'business-os-x' })])
    );
    expect(check.status).toBe('fail');
    expect(check.flaggedRows).toBe(3);
    expect(check.flagCounts).toEqual({ legacy_feature: 1, unknown_area: 1, unknown_call_name: 0, missing_group_id: 1 });
  });

  it('fails for a flagged row OUTSIDE the displayed 500, and marks the list truncated', () => {
    const rows = Array.from({ length: 700 }, (_, i) => (i === 650 ? ledger({ session_id: null }) : ledger()));
    const check = evaluateCallsCheck(paged(rows));
    expect(check.status).toBe('fail');
    expect(check.rows).toHaveLength(500);
    expect(check.rows.every((r) => r.flags.length === 0)).toBe(true);
    expect(check.rowsTruncated).toBe(true);
    expect(check.rowsRead).toBe(700);
    const times = check.rows.map((r) => r.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('is incomplete, never pass, at the ceiling; still fail when a row is flagged', () => {
    expect(evaluateCallsCheck(paged([ledger()], true)).status).toBe('incomplete');
    expect(evaluateCallsCheck(paged([ledger({ session_id: null })], true)).status).toBe('fail');
  });

  it('fails with a safe error when the read failed', () => {
    const check = evaluateCallsCheck(READ_FAILED);
    expect(check.status).toBe('fail');
    expect(check.error).toBe('Could not read the usage ledger for this check');
    expect(check.rowsRead).toBe(0);
  });
});

// ─── AC-7: Check 2 ───────────────────────────────────────────────────────────

describe('Check 2: platform account (AC-7)', () => {
  const label = (feature: string, component: string | null): LedgerLabelRow => ({
    created_at: RECEIVED.toISOString(),
    feature,
    component,
  });

  it('passes for a count of 0', () => {
    const check = evaluatePlatformAccountCheck(readOk(0), readOk([]));
    expect(check).toMatchObject({ status: 'pass', count: 0, breakdown: [], breakdownTruncated: false });
  });

  it('fails for any count, with a breakdown that sums to the count', () => {
    const rows = [label(WEBSITE, 'full_site'), label(WEBSITE, 'full_site'), label('lead-reply', null)];
    const check = evaluatePlatformAccountCheck(readOk(3), readOk(rows));
    expect(check.status).toBe('fail');
    expect(check.breakdown).toEqual([
      { feature: WEBSITE, component: 'full_site', calls: 2 },
      { feature: 'lead-reply', component: null, calls: 1 },
    ]);
    expect(check.breakdown.reduce((s, b) => s + b.calls, 0)).toBe(3);
    expect(check.breakdownTruncated).toBe(false);
  });

  it('marks the breakdown truncated when fewer rows were read than counted', () => {
    const check = evaluatePlatformAccountCheck(readOk(900), readOk(Array.from({ length: 500 }, () => label(CHAT, PLANNER))));
    expect(check.breakdownTruncated).toBe(true);
    expect(check.breakdownRowsRead).toBe(500);
  });

  it('fails when the count or the breakdown cannot be read', () => {
    expect(evaluatePlatformAccountCheck(READ_FAILED, readOk([]))).toMatchObject({ status: 'fail', count: null });
    const noBreakdown = evaluatePlatformAccountCheck(readOk(0), READ_FAILED);
    expect(noBreakdown.status).toBe('fail');
    expect(noBreakdown.error).toMatch(/breakdown/);
  });
});

// ─── AC-8: Check 3 ───────────────────────────────────────────────────────────

describe('Check 3: legacy labels (AC-8)', () => {
  function inputs(overrides: Partial<LegacyLabelsInputs> = {}): LegacyLabelsInputs {
    return {
      selectedCalls: paged([ledger()]),
      legacyOnPlatformCount: readOk(0),
      helperLabelOnSelectedCount: readOk(0),
      helperLabelOnPlatformCount: readOk(0),
      helperLabelOnPlatformRows: readOk([]),
      ...overrides,
    };
  }

  it('passes when nothing is found, including with no rows at all', () => {
    expect(evaluateLegacyLabelsCheck(inputs()).status).toBe('pass');
    expect(evaluateLegacyLabelsCheck(inputs({ selectedCalls: paged([]) })).status).toBe('pass');
  });

  it('fails for a legacy value on the selected account', () => {
    const check = evaluateLegacyLabelsCheck(
      inputs({ selectedCalls: paged([ledger({ feature: BOS_LEGACY_FEATURES_FLAT[0] }), ledger()]) })
    );
    expect(check.status).toBe('fail');
    expect(check.legacyOnSelected).toMatchObject({ count: 1, byFeature: [{ feature: BOS_LEGACY_FEATURES_FLAT[0], calls: 1 }] });
  });

  it('fails for a legacy value on the platform account', () => {
    expect(evaluateLegacyLabelsCheck(inputs({ legacyOnPlatformCount: readOk(2) })).status).toBe('fail');
  });

  it('fails for the helper label on the selected account (a mislabelled call)', () => {
    expect(evaluateLegacyLabelsCheck(inputs({ helperLabelOnSelectedCount: readOk(1) })).status).toBe('fail');
  });

  it('reports the helper label on the platform account as info only, with at most 50 timestamps', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      created_at: new Date(RECEIVED.getTime() - i * 1000).toISOString(),
      feature: 'onboarding',
      component: 'simple-complete',
    }));
    const check = evaluateLegacyLabelsCheck(
      inputs({ helperLabelOnPlatformCount: readOk(120), helperLabelOnPlatformRows: readOk(rows) })
    );
    expect(check.status).toBe('pass');
    expect(check.helperLabelOnPlatform).toMatchObject({ count: 120, timestampsTruncated: true, timestampCap: 50 });
    expect(check.helperLabelOnPlatform?.timestamps).toHaveLength(50);
    expect(check.helperLabel).toEqual({ feature: 'onboarding', component: 'simple-complete' });
  });

  it('is incomplete when the selected read hit its ceiling and nothing failed', () => {
    expect(evaluateLegacyLabelsCheck(inputs({ selectedCalls: paged([ledger()], true) })).status).toBe('incomplete');
  });

  it('fails when any part cannot be read, and names the part (including the info-only (c))', () => {
    const c = evaluateLegacyLabelsCheck(inputs({ helperLabelOnPlatformRows: READ_FAILED }));
    expect(c.status).toBe('fail');
    expect(c.error).toBe('Could not be read: (c) platform helper-label timestamps');

    const a = evaluateLegacyLabelsCheck(inputs({ selectedCalls: READ_FAILED, helperLabelOnSelectedCount: READ_FAILED }));
    expect(a.status).toBe('fail');
    expect(a.error).toBe('Could not be read: (a) selected-account calls; (b) selected-account helper-label count');
    expect(a.legacyOnSelected).toBeNull();
  });
});

// ─── AC-9: Check 4 ───────────────────────────────────────────────────────────

describe('Check 4: grouped by action (AC-9)', () => {
  it('groups by session with ordered call names, repeat counts, totals and first/last times', () => {
    const t = (s: number) => new Date(RECEIVED.getTime() - s * 1000).toISOString();
    const rows = [
      ledger({ session_id: S1, component: PLANNER, created_at: t(10), input_tokens: 10, output_tokens: 0, cost_usd: 0.1 }),
      ledger({ session_id: S1, component: ANALYSIS, created_at: t(20), input_tokens: 5, output_tokens: 5, cost_usd: 0.2 }),
      ledger({ session_id: S1, component: PLANNER, created_at: t(30), input_tokens: 1, output_tokens: 1, cost_usd: 0.3 }),
      ledger({ session_id: S2, feature: WEBSITE, component: 'full_site', created_at: t(5) }),
    ];
    const check = evaluateGroupsCheck(paged(rows));

    expect(check.status).toBe('pass');
    expect(check.groups.map((g) => g.sessionId)).toEqual([S2, S1]);
    const chat = check.groups[1];
    expect(chat).toMatchObject({
      areaLabel: 'chat',
      callCount: 3,
      calls: [
        { component: PLANNER, count: 2 },
        { component: ANALYSIS, count: 1 },
      ],
      callSummary: `${PLANNER} ×2, ${ANALYSIS}`,
      tokens: 22,
      firstAt: t(30),
      lastAt: t(10),
    });
    expect(chat.estimatedCostUsd).toBeCloseTo(0.6);
  });

  it('labels a group with more than one area as mixed', () => {
    const check = evaluateGroupsCheck(paged([ledger(), ledger({ feature: WEBSITE, component: 'full_site' })]));
    expect(check.groups[0].areaLabel).toBe('mixed');
  });

  it('lists and flags ungrouped rows; the intent parser is expected, the plan cache is not', () => {
    const intent = evaluateGroupsCheck(paged([ledger(), ledger({ component: INTENT_PARSER, session_id: null })]));
    expect(intent.status).toBe('pass');
    expect(intent.ungrouped).toHaveLength(1);
    expect(intent.ungrouped[0].expected).toBe(true);
    expect(intent.ungroupedFlagged).toBe(0);

    const cache = evaluateGroupsCheck(paged([ledger({ component: PLAN_CACHE, session_id: null })]));
    expect(cache.status).toBe('fail');
    expect(cache.ungrouped[0].expected).toBe(false);
    expect(cache.ungroupedFlagged).toBe(1);
  });

  it('caps displayed groups at 500 and still fails for a flagged ungrouped row beyond the cap', () => {
    const rows = Array.from({ length: 600 }, (_, i) =>
      ledger({ session_id: `55555555-5555-4555-8555-${String(i).padStart(12, '0')}` })
    );
    rows.push(ledger({ session_id: null }));
    const check = evaluateGroupsCheck(paged(rows));
    expect(check.groups).toHaveLength(500);
    expect(check.groupsTotal).toBe(600);
    expect(check.groupsTruncated).toBe(true);
    expect(check.status).toBe('fail');
  });

  it('is info with no rows, incomplete at the ceiling, fail on a read error', () => {
    expect(evaluateGroupsCheck(paged([])).status).toBe('info');
    expect(evaluateGroupsCheck(paged([ledger()], true)).status).toBe('incomplete');
    expect(evaluateGroupsCheck(READ_FAILED)).toMatchObject({ status: 'fail', error: expect.any(String) });
  });

  it('summarises call lists', () => {
    expect(summariseCalls([{ component: 'a', count: 1 }])).toBe('a');
    expect(summariseCalls([{ component: 'a', count: 3 }, { component: 'b', count: 1 }])).toBe('a ×3, b');
  });
});

// ─── AC-10: Check 5 ──────────────────────────────────────────────────────────

describe('Check 5: usage card view (AC-10, AC-12c)', () => {
  function summary(entries: Array<[string, number, number]>): UsageSummary {
    const byFeature = new Map(entries.map(([f, tokens, calls]) => [f, { tokens, calls }]));
    return {
      byFeature,
      byDay: new Map(),
      totalTokens: entries.reduce((s, [, t]) => s + t, 0),
      totalCalls: entries.reduce((s, [, , c]) => s + c, 0),
    };
  }

  it('produces the same category totals as summariseUsageByCategory, with the card rounding', () => {
    const usage = summary([
      [CHAT, 1000, 4],
      ['landing-page-generation', 250, 1],
      [bosFeature('leads'), 0, 1],
      ['onboarding', 40, 2],
    ]);
    const check = evaluateUsageCardCheck({ summary: readOk({ summary: usage, summedBy: 'database' }), tokensPerCredit: 25 });

    const expected = summariseUsageByCategory(usage.byFeature);
    expect(check.categories).toHaveLength(expected.size);
    for (const category of check.categories) {
      expect({ tokens: category.tokens, calls: category.calls }).toEqual(expected.get(category.key));
      expect(category.credits).toBe(Math.round(category.tokens / 25));
    }
    expect(check.categories.find((c) => c.key === 'leads')?.shownOnCard).toBe(false);
    expect(check.totals).toEqual({ tokens: 1290, calls: 8, credits: 52 });
    expect(check).toMatchObject({ status: 'pass', summedBy: 'database', windowEnd: 'open', tokensPerCredit: 25 });
  });

  it('fails when an observed Business OS value maps to other', () => {
    const usage = summary([
      [CHAT, 10, 1],
      ['business-os-unmapped', 5, 1],
    ]);
    const check = evaluateUsageCardCheck({ summary: readOk({ summary: usage, summedBy: 'rows' }), tokensPerCredit: 10 });
    expect(check.status).toBe('fail');
    expect(check.otherFeatures).toEqual([{ feature: 'business-os-unmapped', tokens: 5, calls: 1, isBusinessOs: true }]);
  });

  it('passes when only non-Business OS values map to other', () => {
    const usage = summary([['something-else', 5, 1]]);
    const check = evaluateUsageCardCheck({ summary: readOk({ summary: usage, summedBy: 'rows' }), tokensPerCredit: 10 });
    expect(check.status).toBe('pass');
    expect(check.otherFeatures[0].isBusinessOs).toBe(false);
  });

  it('is info with no usage and fail when it cannot be read', () => {
    expect(
      evaluateUsageCardCheck({ summary: readOk({ summary: summary([]), summedBy: 'database' }), tokensPerCredit: 10 }).status
    ).toBe('info');
    expect(evaluateUsageCardCheck({ summary: READ_FAILED, tokensPerCredit: 10 })).toMatchObject({
      status: 'fail',
      totals: null,
      windowEnd: 'open',
    });
  });
});

// ─── AC-11: area totals ──────────────────────────────────────────────────────

describe('area totals (AC-11)', () => {
  it('has a line per area, a legacy line, an unknown line only when present, and sums to the total', () => {
    const rows = [
      ledger({ input_tokens: 10, output_tokens: 0, cost_usd: 0.01 }),
      ledger({ feature: WEBSITE, component: 'full_site', input_tokens: 20, output_tokens: 5, cost_usd: 0.02 }),
      ledger({ feature: 'lead-reply', input_tokens: 3, output_tokens: 0, cost_usd: 0.003 }),
    ];
    const clean = computeAreaTotals(paged(rows));
    expect(clean.lines.map((l) => l.key)).toEqual([...BOS_LLM_AREAS, 'legacy']);
    expect(clean.status).toBe('complete');

    const withUnknown = computeAreaTotals(paged([...rows, ledger({ feature: 'business-os-typo', input_tokens: 1, output_tokens: 1, cost_usd: 0 })]));
    expect(withUnknown.lines.map((l) => l.key)).toEqual([...BOS_LLM_AREAS, 'legacy', 'unknown']);

    const sum = withUnknown.lines.reduce(
      (acc, l) => ({ calls: acc.calls + l.calls, tokens: acc.tokens + l.tokens, cost: acc.cost + l.estimatedCostUsd }),
      { calls: 0, tokens: 0, cost: 0 }
    );
    expect(sum.calls).toBe(withUnknown.total.calls);
    expect(sum.tokens).toBe(withUnknown.total.tokens);
    expect(sum.cost).toBeCloseTo(withUnknown.total.estimatedCostUsd);
    expect(withUnknown.total).toMatchObject({ calls: 4, tokens: 40 });
    expect(withUnknown.lines.find((l) => l.key === 'website')).toMatchObject({ calls: 1, tokens: 25 });
  });

  it('is incomplete at the ceiling and error on a failed read', () => {
    expect(computeAreaTotals(paged([ledger()], true)).status).toBe('incomplete');
    expect(computeAreaTotals(READ_FAILED)).toMatchObject({ status: 'error', lines: [] });
  });
});

// ─── Layer 1.5: onboarding and images (FR-20, FR-21, AC-15, AC-16) ───────────

describe('Layer 1.5 areas flow through every check with no check-logic change', () => {
  const ONBOARDING = bosFeature('onboarding');
  const IMAGES = bosFeature('images');
  const t = (s: number) => new Date(RECEIVED.getTime() - s * 1000).toISOString();

  function onboardingConversation(): LedgerCallRow[] {
    return [
      ledger({ feature: ONBOARDING, component: 'business_story_extraction', session_id: S1, created_at: t(40) }),
      ledger({ feature: ONBOARDING, component: 'client_workflow_extraction', session_id: S1, created_at: t(30) }),
      // The workflow extraction legitimately fires twice in one conversation (SA Q-1).
      ledger({ feature: ONBOARDING, component: 'client_workflow_extraction', session_id: S1, created_at: t(20) }),
    ];
  }

  function imageRow(overrides: Partial<LedgerCallRow> = {}): LedgerCallRow {
    return ledger({
      feature: IMAGES,
      component: 'image_generation',
      session_id: S2,
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: '0.25',
      created_at: t(10),
      ...overrides,
    });
  }

  it('Check 1 classifies onboarding and image rows with no flags', () => {
    const check = evaluateCallsCheck(paged([...onboardingConversation(), imageRow()]));
    expect(check.status).toBe('pass');
    expect(check.flaggedRows).toBe(0);
    expect(check.rows.map((r) => [r.area, r.areaKind])).toEqual([
      ['onboarding', 'current'],
      ['onboarding', 'current'],
      ['onboarding', 'current'],
      ['images', 'current'],
    ]);
    const image = check.rows[3];
    expect(image).toMatchObject({ tokens: 0, estimatedCostUsd: 0.25, flags: [] });
  });

  it('Check 4 groups one onboarding conversation, with the workflow extraction ×2', () => {
    const check = evaluateGroupsCheck(paged([...onboardingConversation(), imageRow()]));
    const onboarding = check.groups.find((g) => g.sessionId === S1);
    expect(onboarding).toMatchObject({
      areaLabel: 'onboarding',
      callCount: 3,
      callSummary: 'business_story_extraction, client_workflow_extraction ×2',
    });
    const image = check.groups.find((g) => g.sessionId === S2);
    expect(image).toMatchObject({ areaLabel: 'images', callCount: 1, tokens: 0, callSummary: 'image_generation' });
    expect(image?.estimatedCostUsd).toBeCloseTo(0.25);
  });

  it('area totals carry separate onboarding and images lines, the image cost on its own line', () => {
    const totals = computeAreaTotals(paged([...onboardingConversation(), imageRow(), imageRow({ success: false, cost_usd: 0 })]));
    const images = totals.lines.find((l) => l.key === 'images');
    const onboarding = totals.lines.find((l) => l.key === 'onboarding');
    expect(images).toMatchObject({ kind: 'area', calls: 2, tokens: 0 });
    expect(images?.estimatedCostUsd).toBeCloseTo(0.25);
    expect(onboarding).toMatchObject({ kind: 'area', calls: 3, tokens: 360 });
    expect(totals.total.calls).toBe(5);
  });

  it('Check 5 keeps both out of other; the tokenless images category is not shown on the card', () => {
    const byFeature = new Map([
      [CHAT, { tokens: 1000, calls: 4 }],
      [ONBOARDING, { tokens: 360, calls: 3 }],
      [IMAGES, { tokens: 0, calls: 2 }],
    ]);
    const usage: UsageSummary = { byFeature, byDay: new Map(), totalTokens: 1360, totalCalls: 9 };
    const check = evaluateUsageCardCheck({ summary: readOk({ summary: usage, summedBy: 'database' }), tokensPerCredit: 10 });

    expect(check.status).toBe('pass');
    expect(check.otherFeatures).toEqual([]);
    expect(check.categories.find((c) => c.key === 'images')).toMatchObject({ tokens: 0, calls: 2, credits: 0, shownOnCard: false });
    expect(check.categories.find((c) => c.key === 'onboarding')).toMatchObject({ shownOnCard: true, credits: 36 });
    // No credit comes from the image rows.
    expect(check.totals?.credits).toBe(136);
  });

  it('a failed image row is classified and grouped like any other call', () => {
    const failed = imageRow({ success: false, cost_usd: 0, error_code: 'model_not_found' });
    const check = evaluateCallsCheck(paged([failed]));
    expect(check.rows[0]).toMatchObject({ area: 'images', success: false, tokens: 0, estimatedCostUsd: 0, flags: [] });
  });
});
