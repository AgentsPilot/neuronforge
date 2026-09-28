/**
 * Insight LLM attribution (rows 7, 8, 9).
 *
 * Insight content and correlated insights were recorded on the literal account
 * 'system'. They must be recorded against the business being analysed, and
 * every call made for ONE business in a run must share that business's group.
 *
 * The group used to be the RUN id, shared by every business in the run (F-13):
 * one `token_usage.session_id` and one `ai_action.entity_id` spanning N
 * tenants. The repository now takes an `InsightRunIds` object and must feed
 * `buildBosCallContext` from `.groupId` — never from `.runId`, which every
 * business still shares because it is the `detection_run_id` column.
 *
 * Provider mocked; no network, no DB.
 */

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

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));

import type { SupabaseClient } from '@supabase/supabase-js';
import { ProviderFactory } from '@/lib/ai/providerFactory';
import type { BaseAIProvider } from '@/lib/ai/providers/baseProvider';
import { isUuid } from '@/lib/business-os/llm/callCatalog';
import { InsightRepository } from '@/lib/business-os/insight/repository/InsightRepository';
import type { Insight, InsightRunIds } from '@/lib/business-os/insight/repository/InsightRepository';
import type { DetectionResult } from '@/lib/business-os/insight/detectors/types';
import type { CorrelatedInsight, CorrelationSummary } from '@/lib/business-os/insight/correlation/types';
import type { PrioritizedInsight } from '@/lib/business-os/insight/prioritizer/InsightPrioritizer';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

/** Run ids: one per cron invocation, SHARED by every business in the run. */
const R1 = '66666666-6666-4666-8666-666666666666';
const R2 = '77777777-7777-4777-8777-777777777777';

/** Group ids: one per (run, business). Never shared across businesses. */
const G_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const G_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const G_A2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

/** The two ids one business carries through one run. */
const ids = (runId: string, groupId: string): InsightRunIds => ({ runId, groupId });

const chatCompletion = jest.fn();

const businessContext = {
  language: 'en',
  currency: 'USD',
  vertical: 'therapy',
  sub_vertical: null,
  company_size: 'solo',
};

const detection = {
  detectorId: 'cash_ar_overdue',
  detectedAt: new Date('2026-09-17T08:00:00Z'),
  category: 'cash',
  severity: 'high',
  metricKey: 'ar_overdue_amount',
  currentValue: 1200,
  baselineValue: 400,
  thresholdValue: 500,
  percentChange: 200,
  affectedEntityIds: [],
  affectedCount: 3,
  estimatedImpactUsd: 1200,
  processParameters: {},
} as unknown as DetectionResult;

const correlated = {
  id: 'c1',
  patternId: 'cash_crunch',
  patternName: 'Cash crunch',
  category: 'cash',
  severity: 'high',
  story: 'Invoices are overdue while bookings fall.',
  action: 'Follow up on overdue invoices.',
  totalImpactUsd: 1500,
  contributingInsights: [{ detectorId: 'cash_ar_overdue', detectorName: 'Overdue', summary: '3 overdue' }],
} as unknown as CorrelatedInsight;

const summary = {
  correlatedInsights: [correlated],
  standaloneInsights: [],
  patternsChecked: 5,
  patternsMatched: 1,
  totalImpactUsd: 1500,
} as unknown as CorrelationSummary;

function repository(): InsightRepository {
  return new InsightRepository({} as unknown as SupabaseClient);
}

const contexts = () => chatCompletion.mock.calls.map((call) => call[1]);

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  chatCompletion.mockResolvedValue({
    choices: [{ message: { content: '{"title":"t","description":"d","recommendation":"r","story":"s","narrative":"n","highlights":[],"priorities":[]}' } }],
  });
  jest
    .spyOn(ProviderFactory, 'getProvider')
    .mockReturnValue({ chatCompletion } as unknown as BaseAIProvider);
});

describe('row 7 — insight content', () => {
  it("is recorded against the analysed business, never system, grouped by that business's group", async () => {
    await repository()['generateLocalizedContent'](detection, U1, businessContext, ids(R1, G_A));

    expect(contexts()).toEqual([
      { userId: U1, feature: 'business-os-insights', component: 'insight_content', sessionId: G_A },
    ]);
    expect(contexts()[0].userId).not.toBe('system');
    // The run id is NOT the ledger group: it is shared by every business.
    expect(contexts()[0].sessionId).not.toBe(R1);
  });
});

describe('row 8 — correlated insight', () => {
  it("is recorded against the analysed business, never system, grouped by that business's group", async () => {
    await repository()['generateCorrelatedContent'](correlated, U1, businessContext, ids(R1, G_A));

    expect(contexts()).toEqual([
      { userId: U1, feature: 'business-os-insights', component: 'correlated_insight', sessionId: G_A },
    ]);
    expect(contexts()[0].userId).not.toBe('system');
    expect(contexts()[0].sessionId).not.toBe(R1);
  });
});

describe('row 9 — health summary', () => {
  it('is recorded under health_summary, grouped by the run', async () => {
    /*
     * `health` sits between the category scores and the correlation summary.
     * It carries the measured rates that replaced the old insight-count score;
     * an empty one is the shape for a business with nothing measurable yet,
     * which is what this attribution test cares about least and must still
     * handle.
     */
    const health = { categories: [], movingUp: null, improved: 0, declined: 0, steady: 0, measured: 0, unavailable: 0 };

    await repository()['generateHealthNarrative'](U1, 72, 3, { cash_flow: 60 }, health, summary, [] as Insight[], 'en', ids(R1, G_A));

    expect(contexts()).toEqual([
      { userId: U1, feature: 'business-os-insights', component: 'health_summary', sessionId: G_A },
    ]);
    expect(contexts()[0].sessionId).not.toBe(R1);
  });
});

describe('grouping across a run (F-13)', () => {
  it("every call for ONE business shares that business's group", async () => {
    const repo = repository();
    await repo['generateLocalizedContent'](detection, U1, businessContext, ids(R1, G_A));
    await repo['generateCorrelatedContent'](correlated, U1, businessContext, ids(R1, G_A));

    const [content, correlatedContent] = contexts();
    // The anti-fragmentation property: three calls, ONE audit entry upstream.
    expect(content.sessionId).toBe(correlatedContent.sessionId);
    expect(content.component).not.toBe(correlatedContent.component);
  });

  it('two businesses in the SAME run never share a group', async () => {
    const repo = repository();
    await repo['generateLocalizedContent'](detection, U1, businessContext, ids(R1, G_A));
    await repo['generateLocalizedContent'](detection, U2, businessContext, ids(R1, G_B));

    const [first, second] = contexts();
    /*
     * This is the regression assertion. It used to read
     * `expect(first.sessionId).toBe(second.sessionId)` — a green test on the
     * defect, describing the shared-id behaviour as correct.
     */
    expect(first.sessionId).not.toBe(second.sessionId);
    expect(first.userId).not.toBe(second.userId);
    for (const context of contexts()) expect(isUuid(context.sessionId)).toBe(true);
  });

  it('the same business in two runs gets two groups', async () => {
    const repo = repository();
    await repo['generateLocalizedContent'](detection, U1, businessContext, ids(R1, G_A));
    await repo['generateLocalizedContent'](detection, U1, businessContext, ids(R2, G_A2));

    const [first, second] = contexts();
    expect(first.sessionId).not.toBe(second.sessionId);
  });
});

describe('both ids reach the generators, and neither is substituted for the other', () => {
  it('createBatch forwards runId AND groupId to create', async () => {
    const repo = repository();
    const create = jest.spyOn(repo, 'create').mockResolvedValue({ data: null, error: null });

    await repo.createBatch(U1, [{ detection, score: 80 } as unknown as PrioritizedInsight], ids(R1, G_A));

    /*
     * Both, and distinct. `create` writes `runId` to the `detection_run_id`
     * column and hands `groupId` to the LLM calls; a transposition here is the
     * silent failure the object type exists to prevent.
     */
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ userId: U1, runId: R1, groupId: G_A }));
  });

  it('saveCorrelationResults forwards both ids to correlated insights and the health summary', async () => {
    const repo = repository();
    const createCorrelated = jest
      .spyOn(repo, 'createCorrelatedInsight')
      .mockResolvedValue({ data: { id: 'i1' } as Insight, error: null });
    jest.spyOn(repo, 'findActive').mockResolvedValue({ data: [{ id: 'i1' } as Insight], error: null });
    const health = jest
      .spyOn(repo, 'createOrUpdateHealthSummary')
      .mockResolvedValue({ data: null, error: null });

    await repo.saveCorrelationResults(U1, summary, new Map([['cash_ar_overdue', 'i0']]), ids(R1, G_A));

    expect(createCorrelated).toHaveBeenCalledWith(U1, correlated, ['i0'], { runId: R1, groupId: G_A });
    expect(health).toHaveBeenCalledWith(U1, summary, [{ id: 'i1' }], { runId: R1, groupId: G_A });
  });
});
