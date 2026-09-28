/**
 * GET /api/cron/insight-detect — one Layer 3 audit entry per business per run
 * (FR-10, D-3, WC-8; AC-9), keyed on a group id that is unique PER BUSINESS
 * (F-13).
 *
 * Detection, prioritising and correlation are faked; the repository's insight
 * and correlation writes are faked to make real tracked LLM calls through
 * BaseAIProvider.callWithTracking under the business's group, so the real usage
 * scope and entry builder run for each business.
 *
 * ── WHY THE MOCKS BELOW TAKE `InsightRunIds`, NOT A STRING ─────────────────
 *
 * These mocks stand in for repository methods whose third/fourth argument used
 * to be a bare `runId: string` and is now `{ runId, groupId }`. They are
 * declared `(...a: unknown[])`, so TypeScript cannot police them — this comment
 * and the assertions in the first test are what police them instead.
 *
 * If a mock fed the whole object to `buildBosCallContext` as `groupId`, the
 * context's `sessionId` would be an object, `notifyUsage` would find it
 * different from the scope's string `groupId` and EXCLUDE the call, and
 * `emitAiAuditEntry` writes no entry at all for an action with zero calls. The
 * harness would then be manufacturing the exact silent-attribution failure the
 * object type exists to prevent. Hence `callCount` is asserted on EVERY entry.
 */

import { NextRequest } from 'next/server';

const mockAuditLog = jest.fn();
/*
 * Layer 2 (Step 2): the call sites take their model, temperature and on/off
 * switch from `resolveBosLlmSettings`. Pinned to the CODE DEFAULTS — today's
 * values — so this file keeps asserting exactly what it asserted before, with
 * no configuration read and no I/O.
 */
jest.mock('@/lib/business-os/llm/modelSettings', () => {
  const actual = jest.requireActual('@/lib/business-os/llm/modelSettings');
  return {
    ...actual,
    resolveBosLlmSettings: async (area: string, callName: string) => actual.bosLlmCodeDefaults(area, callName),
  };
});

jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrail: { log: (...a: unknown[]) => mockAuditLog(...a) },
}));

/*
 * `info` is captured rather than discarded: the A-2 per-business log line is the
 * ONLY record tying a run to the group ids it produced (the ids are random by
 * SA's Q-1 ruling, so nothing derives one from the other and nothing stores them
 * together). It was the one load-bearing thing in this change that no test
 * touched — deleting it left the suite green while the forensic capability
 * accepted in exchange for dropping a deterministic id disappeared silently.
 */
const mockLogInfo = jest.fn();
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {
    info: (...a: unknown[]) => mockLogInfo(...a),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

const A = '2f734ed5-3681-4049-880d-3de7b096bea3';
const B = '6b1f7d1c-2222-4222-8222-222222222222';
const C = '7c2e8e2d-3333-4333-8333-333333333333';

jest.mock('@/lib/supabaseServer', () => {
  const rows: Record<string, Array<{ user_id: string }>> = {
    payment_invoices: [{ user_id: '2f734ed5-3681-4049-880d-3de7b096bea3' }, { user_id: '6b1f7d1c-2222-4222-8222-222222222222' }],
    crm_contacts: [{ user_id: '7c2e8e2d-3333-4333-8333-333333333333' }],
  };
  return {
    supabaseServer: {
      from: (table: string) => {
        const builder: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'gte']) builder[m] = () => builder;
        builder.limit = async () => ({ data: rows[table] ?? [], error: null });
        builder.single = async () => ({ data: null, error: null });
        return builder;
      },
    },
  };
});

const mockRunForUser = jest.fn();
jest.mock('@/lib/business-os/insight/detectors', () => ({
  DetectorEngine: jest.fn().mockImplementation(() => ({
    runForUser: (...a: unknown[]) => mockRunForUser(...a),
    getLastEvaluatedCount: () => 1,
  })),
}));
jest.mock('@/lib/business-os/insight/prioritizer', () => ({
  InsightPrioritizer: jest.fn().mockImplementation(() => ({
    getTopInsights: async (_u: string, detections: unknown[]) => detections,
  })),
}));
const mockCreateBatch = jest.fn();
const mockSaveCorrelationResults = jest.fn();
jest.mock('@/lib/business-os/insight/repository', () => ({
  InsightRepository: jest.fn().mockImplementation(() => ({
    createBatch: (...a: unknown[]) => mockCreateBatch(...a),
    saveCorrelationResults: (...a: unknown[]) => mockSaveCorrelationResults(...a),
    findActive: async () => ({ data: [] }),
    // The stale-insight sweep the route runs for every business, after the
    // audited action. Absent, it threw for every user and the run reported
    // three errors where the test had arranged exactly one.
    resolveStaleInsights: async () => ({ data: 0 }),
  })),
}));
/*
 * One matched pattern, so the route calls `saveCorrelationResults` as well as
 * `createBatch`. That is what gives a business TWO tracked calls in one group —
 * the anti-fragmentation property (one entry, callCount 2) cannot be tested
 * with a single call.
 */
jest.mock('@/lib/business-os/insight/correlation', () => ({
  getCorrelationEngine: () => ({
    setLocale: () => undefined,
    correlate: () => ({
      patternsMatched: 1,
      correlatedInsights: [{ patternId: 'cash_crunch' }],
    }),
  }),
}));

import { GET } from '../route';
import { BaseAIProvider } from '@/lib/ai/providers/baseProvider';
import type { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';
import { buildBosCallContext, isUuid } from '@/lib/business-os/llm/callCatalog';
import { resetPlatformActorForTests } from '@/lib/business-os/llm/aiActionAudit';

const PLATFORM = '55555555-5555-4555-8555-555555555555';
const BUSINESS_DATA = 'BUSINESS-DATA-MARKER-n2 unpaid invoice for Dana';

class FakeProvider extends BaseAIProvider {
  readonly defaultModel = 'm';
  readonly defaultMaxTokens = 1;
  readonly supportsResponseFormat = false;
  getMaxOutputTokens(): number {
    return 1;
  }
  async chatCompletion(): Promise<unknown> {
    throw new Error('unused');
  }
}
const provider = new FakeProvider({ trackAICall: async () => undefined } as unknown as AIAnalyticsService);

let savedPlatform: string | undefined;

/**
 * The cron authenticates now.
 *
 * It used to treat a missing `CRON_SECRET` as "let everyone in" — a public URL
 * with no gate — and these tests called it bare. All four insight crons were
 * moved to fail closed on 2026-09-23, so the request has to carry the bearer
 * token the way Vercel sends it.
 */
const CRON_SECRET = 'test-cron-secret';

/** A request signed the way a Vercel cron invocation is. */
function cronRequest() {
  return new NextRequest('http://localhost/api/cron/insight-detect', {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

/**
 * The ids one repository call receives, as the route now passes them.
 *
 * `runId` is run-level and SHARED by every business; `groupId` is this
 * business's AI usage group and must not be. Asserted, not assumed: a mock that
 * quietly accepted a bare string again would take the suite straight back to
 * asserting the defect.
 */
interface RunIds {
  runId: string;
  groupId: string;
}

function asRunIds(value: unknown, where: string): RunIds {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof (value as RunIds).runId !== 'string' ||
    typeof (value as RunIds).groupId !== 'string'
  ) {
    throw new Error(`${where} expected { runId, groupId }, got ${JSON.stringify(value)}`);
  }
  return value as RunIds;
}

beforeEach(() => {
  mockAuditLog.mockReset();
  mockLogInfo.mockReset();
  mockAuditLog.mockResolvedValue(undefined);
  mockCreateBatch.mockReset();
  mockSaveCorrelationResults.mockReset();
  process.env.CRON_SECRET = CRON_SECRET;
  savedPlatform = process.env.SYSTEM_ADMIN_USER_ID;
  process.env.SYSTEM_ADMIN_USER_ID = PLATFORM;
  resetPlatformActorForTests();

  // A and B have detections; C has none (so it makes no LLM call).
  mockRunForUser.mockImplementation(async (userId: string) => (userId === C ? [] : [{ detector_id: 'd1', summary: BUSINESS_DATA }]));

  /*
   * The insight write makes one tracked call under THIS BUSINESS'S group; B's
   * then throws.
   *
   * `ids.groupId` — not `ids`, and not `ids.runId`. Feeding the object would
   * make `sessionId` an object and `notifyUsage` would drop the call; feeding
   * `ids.runId` would be a valid UUID that is nonetheless the wrong group, and
   * because `runAiAction` opens its scope on `businessGroupId`, notifyUsage
   * would drop that too. Either way the entry disappears.
   */
  mockCreateBatch.mockImplementation(async (userId: string, _prioritized: unknown, third: unknown) => {
    const ids = asRunIds(third, 'createBatch');
    await provider.callWithTracking(
      buildBosCallContext({ userId, area: 'insights', callName: 'insight_content', groupId: ids.groupId }),
      'openai',
      'gpt-test',
      'chat/completions',
      async () => ({}),
      () => ({ inputTokens: 200, outputTokens: 50, cost: 0.0012 })
    );
    if (userId === B) throw Object.assign(new Error(`insert failed for ${BUSINESS_DATA}`), { code: '23505' });
    return { data: [] };
  });

  /*
   * A SECOND tracked call for the same business, in the same group. This is the
   * sharing the fix must preserve: two calls, one audit entry, callCount 2.
   */
  mockSaveCorrelationResults.mockImplementation(
    async (userId: string, _summary: unknown, _map: unknown, fourth: unknown) => {
      const ids = asRunIds(fourth, 'saveCorrelationResults');
      await provider.callWithTracking(
        buildBosCallContext({ userId, area: 'insights', callName: 'correlated_insight', groupId: ids.groupId }),
        'openai',
        'gpt-test',
        'chat/completions',
        async () => ({}),
        () => ({ inputTokens: 100, outputTokens: 20, cost: 0.0004 })
      );
      return { data: { correlatedInsights: [], healthSummary: null } };
    }
  );
});

afterEach(() => {
  if (savedPlatform === undefined) delete process.env.SYSTEM_ADMIN_USER_ID;
  else process.env.SYSTEM_ADMIN_USER_ID = savedPlatform;
  resetPlatformActorForTests();
});

describe('insight-detect — one AI audit entry per business per run', () => {
  it('writes one entry per business that made a call, on the platform actor, each counting its calls', async () => {
    const res = await GET(cronRequest());
    expect(res.status).toBe(200);

    const entries = mockAuditLog.mock.calls.map((c) => c[0]);
    expect(entries).toHaveLength(2); // A and B; C made no call
    expect(entries.map((e) => e.userId).sort()).toEqual([A, B].sort());

    for (const entry of entries) {
      expect(entry).toMatchObject({
        entityType: 'ai_action',
        actorId: PLATFORM,
        details: expect.objectContaining({
          area: 'insights',
          actionType: 'insight_run',
          trigger: 'scheduled',
        }),
      });
      /*
       * On EVERY entry, not just A's (A-5).
       *
       * A zero here is the silent-attribution failure: a group id that does not
       * match the scope's makes `notifyUsage` exclude the call, and an action
       * with no calls writes no entry at all. `callCount` is therefore the one
       * assertion that proves the group was wired end to end.
       */
      expect(entry.details.callCount).toBeGreaterThan(0);
      expect(entry.details.estimatedCostUsd).toBeGreaterThan(0);
      expect(JSON.stringify(entry)).not.toContain('BUSINESS-DATA-MARKER-n2');
    }
  });

  it('two businesses in one run get DIFFERENT entity ids, each a UUID (F-13)', async () => {
    await GET(cronRequest());

    const entries = mockAuditLog.mock.calls.map((c) => c[0]);
    const forA = entries.find((e) => e.userId === A)!;
    const forB = entries.find((e) => e.userId === B)!;

    /*
     * The regression assertion. This file used to read
     * `expect(entry).toMatchObject({ entityId: runId })` for BOTH businesses —
     * a green test asserting that two tenants share one `audit_trail.entity_id`
     * (and one `token_usage.session_id`). That is the defect, not the contract.
     */
    expect(forA.entityId).not.toBe(forB.entityId);

    // Both must be UUIDs, or `validateIdentities` refuses the entry and the
    // ledger's `session_id` is nulled by the analytics write guard.
    for (const entry of [forA, forB]) {
      expect(isUuid(entry.entityId)).toBe(true);
      // `entityId` and `details.groupId` are the same value by construction;
      // asserting it keeps the two in step if either ever moves.
      expect(entry.details.groupId).toBe(entry.entityId);
    }
  });

  it("one business's calls still SHARE its group: two calls, one entry, callCount 2", async () => {
    await GET(cronRequest());

    const entries = mockAuditLog.mock.calls.map((c) => c[0]);
    const forA = entries.filter((e) => e.userId === A);

    // Not fragmented into one entry per call — the explicit anti-goal.
    expect(forA).toHaveLength(1);
    expect(forA[0].details.callCount).toBe(2);
    expect(forA[0].details.callNames.sort()).toEqual(['correlated_insight', 'insight_content']);

    // Both calls reached the SAME group, which is what `callCount: 2` proves:
    // a mismatched one would have been excluded rather than counted.
    const groups = [
      ...mockCreateBatch.mock.calls.filter((c) => c[0] === A).map((c) => (c[2] as RunIds).groupId),
      ...mockSaveCorrelationResults.mock.calls.filter((c) => c[0] === A).map((c) => (c[3] as RunIds).groupId),
    ];
    expect(groups).toHaveLength(2);
    expect(new Set(groups).size).toBe(1);
    expect(groups[0]).toBe(forA[0].entityId);
  });

  it('the run id stays run-level and is NOT the group: A and B share it (T5)', async () => {
    const body = await (await GET(cronRequest())).json();

    const idsA = mockCreateBatch.mock.calls.find((c) => c[0] === A)![2] as RunIds;
    const idsB = mockCreateBatch.mock.calls.find((c) => c[0] === B)![2] as RunIds;

    /*
     * The mirror image of the regression test, and the reason this fix is not a
     * rename. `runId` is destined for `insights.detection_run_id`, whose
     * declared meaning is run-level, so the two businesses MUST share it — while
     * their groups must differ. Proves the ids were separated, not swapped.
     */
    expect(idsA.runId).toBe(idsB.runId);
    expect(idsA.groupId).not.toBe(idsB.groupId);
    expect(idsA.runId).not.toBe(idsA.groupId);
    for (const value of [idsA.runId, idsA.groupId, idsB.groupId]) expect(isUuid(value)).toBe(true);

    /*
     * The response reports THIS run, not a group and not some other id.
     * `toBeDefined()` would also have passed for a body that reported a
     * different value from the one the repository was handed.
     */
    expect(JSON.parse(JSON.stringify(body)).data.runId).toBe(idsA.runId);
  });

  it('logs the per-business group id once per business, with all three ids on ONE record (A-2)', async () => {
    await GET(cronRequest());

    const lines = mockLogInfo.mock.calls.filter(
      (c) => c[1] === 'Business AI usage group for this detection run'
    );

    /*
     * THREE lines, not two. The id is minted before the route knows whether a
     * business will make an LLM call, so C — which has no detections, makes no
     * call and gets no audit entry — still gets a logged group id. That is
     * correct, and the trap for anyone running the manual check by hand: three
     * log lines against two audit entries is the expected result.
     */
    expect(lines).toHaveLength(3);

    const records = lines.map((c) => c[0] as { runId: string; userId: string; businessGroupId: string });

    // All three ids on ONE record — a line carrying only two of them cannot
    // correlate a run to a group, which is the whole job.
    for (const record of records) {
      expect(isUuid(record.runId)).toBe(true);
      expect(isUuid(record.businessGroupId)).toBe(true);
      expect(record.businessGroupId).not.toBe(record.runId);
    }

    expect(records.map((r) => r.userId).sort()).toEqual([A, B, C].sort());
    expect(new Set(records.map((r) => r.runId)).size).toBe(1);
    expect(new Set(records.map((r) => r.businessGroupId)).size).toBe(3);

    /*
     * The log is only forensically useful if it names the group that actually
     * reached the ledger and the audit trail. Pinned against the entries.
     */
    const entries = mockAuditLog.mock.calls.map((c) => c[0]);
    for (const userId of [A, B]) {
      const logged = records.find((r) => r.userId === userId)!;
      expect(entries.find((e) => e.userId === userId)!.entityId).toBe(logged.businessGroupId);
    }
  });

  it('a business that throws after its call gets exactly one FAILED entry, and the loop continues (WC-8)', async () => {
    const res = await GET(cronRequest());
    const body = await res.json();

    const entries = mockAuditLog.mock.calls.map((c) => c[0]);
    const forB = entries.filter((e) => e.userId === B);
    const forA = entries.filter((e) => e.userId === A);
    expect(forB).toHaveLength(1);
    expect(forB[0]).toMatchObject({ action: 'BUSINESS_AI_ACTION_FAILED', details: expect.objectContaining({ errorCode: '23505' }) });
    expect(forA).toHaveLength(1);
    expect(forA[0].action).toBe('BUSINESS_AI_ACTION_COMPLETED');
    // The existing catch still counted the error and the run carried on.
    expect(JSON.stringify(body)).toMatch(/"errors":1/);
  });
});
