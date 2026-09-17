/**
 * buildLlmUsageReport — the reads behind the report (Layer 1.1 AC-7, AC-12(d), AC-13, WC-6, WC-9).
 *
 * Repositories are injected mocks: this proves WHICH account each read is
 * scoped to, that every windowed read gets the same fixed end, that one failed
 * read never hides another check, and that the business name is looked up on
 * manual refreshes only.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

import {
  BOS_LEGACY_FEATURES_FLAT,
  BOS_LEGACY_HELPER_LABEL,
  bosFeature,
  bosRowFilter,
} from '@/lib/business-os/llm/callCatalog';
import type { LedgerCallRow } from '@/lib/repositories/TokenUsageRepository';
import { buildLlmUsageReport, type LlmUsageReportDeps } from '../llmUsageReport';
import type { ReportWindow } from '../llmUsageVerification';

const ACCOUNT = '2f734ed5-3681-4049-880d-3de7b096bea3';
const ZERO = '00000000-0000-0000-0000-000000000000';
const SYS = '22222222-2222-4222-8222-222222222222';
const WINDOW: ReportWindow = {
  start: new Date('2026-09-17T11:00:00.000Z'),
  end: new Date('2026-09-17T12:00:00.000Z'),
  startClamped: false,
};

function call(overrides: Partial<LedgerCallRow> = {}): LedgerCallRow {
  return {
    id: 'r1',
    created_at: '2026-09-17T11:30:00.000Z',
    feature: bosFeature('chat'),
    component: 'planner',
    session_id: '33333333-3333-4333-8333-333333333333',
    input_tokens: 10,
    output_tokens: 5,
    cost_usd: 0.001,
    success: true,
    error_code: null,
    ...overrides,
  };
}

function makeDeps() {
  const deps = {
    tokenUsage: {
      listCallsInWindow: jest.fn().mockResolvedValue({ data: { rows: [call()], reachedCeiling: false }, error: null }),
      countInWindow: jest.fn().mockResolvedValue({ data: 0, error: null }),
      listLabelsInWindow: jest.fn().mockResolvedValue({ data: [], error: null }),
    },
    profiles: {
      findByUserId: jest.fn().mockResolvedValue({ data: { company_name: 'Acme Test Co' }, error: null }),
    },
    readUsageSummary: jest.fn().mockResolvedValue({
      summary: {
        totalTokens: 15,
        totalCalls: 1,
        byFeature: new Map([[bosFeature('chat'), { tokens: 15, calls: 1 }]]),
        byDay: new Map(),
      },
      summedBy: 'database',
    }),
    readTokensPerCredit: jest.fn().mockResolvedValue(10),
  };
  return deps;
}

function log() {
  return { warn: jest.fn(), error: jest.fn() };
}

function asDeps(deps: ReturnType<typeof makeDeps>): LlmUsageReportDeps {
  return deps as unknown as LlmUsageReportDeps;
}

beforeEach(() => {
  delete process.env.SYSTEM_ADMIN_USER_ID;
});

describe('buildLlmUsageReport', () => {
  it('scopes every read: the selected account, or exactly the platform ids', async () => {
    process.env.SYSTEM_ADMIN_USER_ID = SYS;
    const deps = makeDeps();

    const report = await buildLlmUsageReport({ accountId: ACCOUNT, window: WINDOW, trigger: 'manual' }, log(), asDeps(deps));

    const [r1Account, , r1Filter, r1Opts] = deps.tokenUsage.listCallsInWindow.mock.calls[0];
    expect(r1Account).toBe(ACCOUNT);
    expect(r1Filter).toEqual(bosRowFilter());
    expect(r1Opts).toEqual({ pageSize: 1000, ceiling: 5000 });

    const counts = deps.tokenUsage.countInWindow.mock.calls;
    expect(counts).toHaveLength(4);
    // Check 2 count
    expect(counts[0][0]).toEqual([ZERO, SYS]);
    expect(counts[0][2]).toEqual({ kind: 'row_filter', filter: bosRowFilter() });
    // Check 3(a) platform part
    expect(counts[1][0]).toEqual([ZERO, SYS]);
    expect(counts[1][2]).toEqual({ kind: 'features', features: BOS_LEGACY_FEATURES_FLAT });
    // Check 3(b): the selected account only
    expect(counts[2][0]).toEqual([ACCOUNT]);
    expect(counts[2][2]).toEqual({ kind: 'label', ...BOS_LEGACY_HELPER_LABEL });
    // Check 3(c)
    expect(counts[3][0]).toEqual([ZERO, SYS]);
    expect(counts[3][2]).toEqual({ kind: 'label', ...BOS_LEGACY_HELPER_LABEL });

    const labels = deps.tokenUsage.listLabelsInWindow.mock.calls;
    expect(labels.map((c) => c[0])).toEqual([
      [ZERO, SYS],
      [ZERO, SYS],
    ]);
    expect(labels.map((c) => c[3])).toEqual([500, 50]);

    // No platform-scoped match is ever run against the selected account, and vice versa.
    expect(counts.filter((c) => c[0].includes(ACCOUNT))).toHaveLength(1);

    expect(report.platformAccountIdsChecked).toEqual([ZERO, SYS]);
    expect(deps.readUsageSummary).toHaveBeenCalledWith(ACCOUNT, WINDOW.start, expect.anything());
    expect(deps.profiles.findByUserId).toHaveBeenCalledWith(ACCOUNT);
  });

  it('gives every windowed read the same fixed end (Check 5 has an open end)', async () => {
    const deps = makeDeps();
    await buildLlmUsageReport({ accountId: ACCOUNT, window: WINDOW, trigger: 'manual' }, log(), asDeps(deps));

    const windows = [
      deps.tokenUsage.listCallsInWindow.mock.calls[0][1],
      ...deps.tokenUsage.countInWindow.mock.calls.map((c) => c[1]),
      ...deps.tokenUsage.listLabelsInWindow.mock.calls.map((c) => c[1]),
    ];
    expect(windows).toHaveLength(7);
    for (const w of windows) {
      expect(w.start.toISOString()).toBe(WINDOW.start.toISOString());
      expect(w.end.toISOString()).toBe(WINDOW.end.toISOString());
    }
  });

  it('returns all five checks, area totals and the window for a clean account', async () => {
    const report = await buildLlmUsageReport({ accountId: ACCOUNT, window: WINDOW, trigger: 'manual' }, log(), asDeps(makeDeps()));

    expect(report.account).toEqual({ userId: ACCOUNT, companyName: 'Acme Test Co', profileLookup: 'found' });
    expect(report.window).toEqual({ start: WINDOW.start.toISOString(), end: WINDOW.end.toISOString(), startClamped: false });
    expect(report.incomplete).toBe(false);
    expect(report.trigger).toBe('manual');
    expect(Object.fromEntries(Object.entries(report.checks).map(([k, v]) => [k, v.status]))).toEqual({
      calls: 'pass',
      platformAccount: 'pass',
      legacyLabels: 'pass',
      groups: 'pass',
      usageCard: 'pass',
    });
    expect(report.areaTotals.status).toBe('complete');
    expect(report.platformAccountEnvIgnored).toBe(false);
  });

  it('skips the business name lookup on an automatic refresh (WC-6)', async () => {
    const deps = makeDeps();
    const report = await buildLlmUsageReport({ accountId: ACCOUNT, window: WINDOW, trigger: 'auto' }, log(), asDeps(deps));
    expect(deps.profiles.findByUserId).not.toHaveBeenCalled();
    expect(report.account).toEqual({ userId: ACCOUNT, companyName: null, profileLookup: 'skipped' });
  });

  it('reports no profile and a failed profile lookup without failing the report', async () => {
    const none = makeDeps();
    none.profiles.findByUserId.mockResolvedValue({ data: null, error: null });
    expect((await buildLlmUsageReport({ accountId: ACCOUNT, window: WINDOW, trigger: 'manual' }, log(), asDeps(none))).account.profileLookup).toBe('none');

    const failed = makeDeps();
    failed.profiles.findByUserId.mockRejectedValue(new Error('db down'));
    const report = await buildLlmUsageReport({ accountId: ACCOUNT, window: WINDOW, trigger: 'manual' }, log(), asDeps(failed));
    expect(report.account.profileLookup).toBe('failed');
    expect(report.checks.calls.status).toBe('pass');
  });

  it('marks the report incomplete when the paged read hit its ceiling', async () => {
    const deps = makeDeps();
    deps.tokenUsage.listCallsInWindow.mockResolvedValue({ data: { rows: [call()], reachedCeiling: true }, error: null });
    const report = await buildLlmUsageReport({ accountId: ACCOUNT, window: WINDOW, trigger: 'manual' }, log(), asDeps(deps));
    expect(report.incomplete).toBe(true);
    expect(report.checks.calls.status).toBe('incomplete');
    expect(report.checks.legacyLabels.status).toBe('incomplete');
    expect(report.checks.groups.status).toBe('incomplete');
    expect(report.areaTotals.status).toBe('incomplete');
    // Exact counts and Check 5 are unaffected.
    expect(report.checks.platformAccount.status).toBe('pass');
    expect(report.checks.usageCard.status).toBe('pass');
  });

  it('surfaces a non-UUID SYSTEM_ADMIN_USER_ID as a flag, never its value (WC-9)', async () => {
    process.env.SYSTEM_ADMIN_USER_ID = 'system-admin-secret-ish';
    const report = await buildLlmUsageReport({ accountId: ACCOUNT, window: WINDOW, trigger: 'manual' }, log(), asDeps(makeDeps()));
    expect(report.platformAccountEnvIgnored).toBe(true);
    expect(report.platformAccountIdsChecked).toEqual([ZERO]);
    expect(JSON.stringify(report)).not.toContain('system-admin-secret-ish');
  });

  describe('one failed read never hides the others (AC-12d)', () => {
    type Case = [string, (d: ReturnType<typeof makeDeps>) => void, Record<string, string>];
    const cases: Case[] = [
      [
        'R1 selected calls (error result)',
        (d) => d.tokenUsage.listCallsInWindow.mockResolvedValue({ data: null, error: new Error('x') }),
        { calls: 'fail', legacyLabels: 'fail', groups: 'fail', platformAccount: 'pass', usageCard: 'pass' },
      ],
      [
        'R2 platform count (throws)',
        (d) => d.tokenUsage.countInWindow.mockImplementationOnce(() => Promise.reject(new Error('x'))),
        { calls: 'pass', platformAccount: 'fail', legacyLabels: 'pass', groups: 'pass', usageCard: 'pass' },
      ],
      [
        'R3 platform breakdown',
        (d) => d.tokenUsage.listLabelsInWindow.mockResolvedValueOnce({ data: null, error: new Error('x') }),
        { calls: 'pass', platformAccount: 'fail', legacyLabels: 'pass', groups: 'pass', usageCard: 'pass' },
      ],
      [
        'R7 platform helper-label timestamps',
        (d) =>
          d.tokenUsage.listLabelsInWindow
            .mockResolvedValueOnce({ data: [], error: null })
            .mockResolvedValueOnce({ data: null, error: new Error('x') }),
        { calls: 'pass', platformAccount: 'pass', legacyLabels: 'fail', groups: 'pass', usageCard: 'pass' },
      ],
      [
        'R8 usage summary',
        (d) => d.readUsageSummary.mockRejectedValue(new Error('x')),
        { calls: 'pass', platformAccount: 'pass', legacyLabels: 'pass', groups: 'pass', usageCard: 'fail' },
      ],
    ];

    it.each(cases)('%s', async (_name, breakIt, expected) => {
      const deps = makeDeps();
      breakIt(deps);
      const logger = log();

      const report = await buildLlmUsageReport({ accountId: ACCOUNT, window: WINDOW, trigger: 'manual' }, logger, asDeps(deps));

      expect(Object.fromEntries(Object.entries(report.checks).map(([k, v]) => [k, v.status]))).toEqual(expected);
      for (const [key, status] of Object.entries(expected)) {
        const check = report.checks[key as keyof typeof report.checks];
        if (status === 'fail') {
          expect(check.error).toEqual(expect.any(String));
          expect(check.error).not.toMatch(/^x$/);
        }
      }
      expect(logger.error).toHaveBeenCalled();
      expect(JSON.stringify(report)).not.toContain('"x"');
    });

    it('R1 failure also marks area totals as an error, not zero', async () => {
      const deps = makeDeps();
      deps.tokenUsage.listCallsInWindow.mockResolvedValue({ data: null, error: new Error('x') });
      const report = await buildLlmUsageReport({ accountId: ACCOUNT, window: WINDOW, trigger: 'manual' }, log(), asDeps(deps));
      expect(report.areaTotals.status).toBe('error');
      expect(report.incomplete).toBe(false);
    });
  });
});
