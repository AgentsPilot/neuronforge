/**
 * GET /api/cron/insight-detect — one Layer 3 audit entry per business per run
 * (FR-10, D-3, WC-8; AC-9).
 *
 * Detection, prioritising and correlation are faked; the repository's insight
 * write is faked to make a real tracked LLM call through
 * BaseAIProvider.callWithTracking under the run's group, so the real usage
 * scope and entry builder run for each business.
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

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
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
jest.mock('@/lib/business-os/insight/repository', () => ({
  InsightRepository: jest.fn().mockImplementation(() => ({
    createBatch: (...a: unknown[]) => mockCreateBatch(...a),
    findActive: async () => ({ data: [] }),
    // The stale-insight sweep the route runs for every business, after the
    // audited action. Absent, it threw for every user and the run reported
    // three errors where the test had arranged exactly one.
    resolveStaleInsights: async () => ({ data: 0 }),
  })),
}));
jest.mock('@/lib/business-os/insight/correlation', () => ({
  getCorrelationEngine: () => ({
    setLocale: () => undefined,
    correlate: () => ({ patternsMatched: 0, correlatedInsights: [] }),
  }),
}));

import { GET } from '../route';
import { BaseAIProvider } from '@/lib/ai/providers/baseProvider';
import type { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';
import { buildBosCallContext } from '@/lib/business-os/llm/callCatalog';
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

beforeEach(() => {
  mockAuditLog.mockReset();
  mockAuditLog.mockResolvedValue(undefined);
  process.env.CRON_SECRET = CRON_SECRET;
  savedPlatform = process.env.SYSTEM_ADMIN_USER_ID;
  process.env.SYSTEM_ADMIN_USER_ID = PLATFORM;
  resetPlatformActorForTests();

  // A and B have detections; C has none (so it makes no LLM call).
  mockRunForUser.mockImplementation(async (userId: string) => (userId === C ? [] : [{ detector_id: 'd1', summary: BUSINESS_DATA }]));

  // The insight write makes one tracked call under the run's group; B's then throws.
  mockCreateBatch.mockImplementation(async (userId: string, _prioritized: unknown, runId: string) => {
    await provider.callWithTracking(
      buildBosCallContext({ userId, area: 'insights', callName: 'insight_content', groupId: runId }),
      'openai',
      'gpt-test',
      'chat/completions',
      async () => ({}),
      () => ({ inputTokens: 200, outputTokens: 50, cost: 0.0012 })
    );
    if (userId === B) throw Object.assign(new Error(`insert failed for ${BUSINESS_DATA}`), { code: '23505' });
    return { data: [] };
  });
});

afterEach(() => {
  if (savedPlatform === undefined) delete process.env.SYSTEM_ADMIN_USER_ID;
  else process.env.SYSTEM_ADMIN_USER_ID = savedPlatform;
  resetPlatformActorForTests();
});

describe('insight-detect — one AI audit entry per business per run', () => {
  it('writes one entry per business that made a call, sharing the run id, on the platform actor', async () => {
    const res = await GET(cronRequest());
    expect(res.status).toBe(200);

    const entries = mockAuditLog.mock.calls.map((c) => c[0]);
    expect(entries).toHaveLength(2); // A and B; C made no call
    expect(entries.map((e) => e.userId).sort()).toEqual([A, B].sort());

    const runId = mockCreateBatch.mock.calls[0][2];
    for (const entry of entries) {
      expect(entry).toMatchObject({
        entityType: 'ai_action',
        entityId: runId,
        actorId: PLATFORM,
        details: expect.objectContaining({
          area: 'insights',
          actionType: 'insight_run',
          trigger: 'scheduled',
          callCount: 1,
          callNames: ['insight_content'],
        }),
      });
      expect(JSON.stringify(entry)).not.toContain('BUSINESS-DATA-MARKER-n2');
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
