/**
 * Insight LLM attribution (rows 7, 8, 9).
 *
 * Insight content and correlated insights were recorded on the literal account
 * 'system'. They must be recorded against the business being analysed, and
 * every call in one detection run must share the run id as its group.
 * Provider mocked; no network, no DB.
 */

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));

import type { SupabaseClient } from '@supabase/supabase-js';
import { ProviderFactory } from '@/lib/ai/providerFactory';
import type { BaseAIProvider } from '@/lib/ai/providers/baseProvider';
import { isUuid } from '@/lib/business-os/llm/callCatalog';
import { InsightRepository } from '@/lib/business-os/insight/repository/InsightRepository';
import type { Insight } from '@/lib/business-os/insight/repository/InsightRepository';
import type { DetectionResult } from '@/lib/business-os/insight/detectors/types';
import type { CorrelatedInsight, CorrelationSummary } from '@/lib/business-os/insight/correlation/types';
import type { PrioritizedInsight } from '@/lib/business-os/insight/prioritizer/InsightPrioritizer';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const R1 = '66666666-6666-4666-8666-666666666666';
const R2 = '77777777-7777-4777-8777-777777777777';

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
  it('is recorded against the analysed business, never system, grouped by the run', async () => {
    await repository()['generateLocalizedContent'](detection, U1, businessContext, R1);

    expect(contexts()).toEqual([
      { userId: U1, feature: 'business-os-insights', component: 'insight_content', sessionId: R1 },
    ]);
    expect(contexts()[0].userId).not.toBe('system');
  });
});

describe('row 8 — correlated insight', () => {
  it('is recorded against the analysed business, never system, grouped by the run', async () => {
    await repository()['generateCorrelatedContent'](correlated, U1, businessContext, R1);

    expect(contexts()).toEqual([
      { userId: U1, feature: 'business-os-insights', component: 'correlated_insight', sessionId: R1 },
    ]);
    expect(contexts()[0].userId).not.toBe('system');
  });
});

describe('row 9 — health summary', () => {
  it('is recorded under health_summary, grouped by the run', async () => {
    await repository()['generateHealthNarrative'](U1, 72, 3, { cash_flow: 60 }, summary, [] as Insight[], 'en', R1);

    expect(contexts()).toEqual([
      { userId: U1, feature: 'business-os-insights', component: 'health_summary', sessionId: R1 },
    ]);
  });
});

describe('grouping across a run', () => {
  it('two businesses in one run share the group and differ by account; another run differs', async () => {
    const repo = repository();
    await repo['generateLocalizedContent'](detection, U1, businessContext, R1);
    await repo['generateLocalizedContent'](detection, U2, businessContext, R1);
    await repo['generateLocalizedContent'](detection, U1, businessContext, R2);

    const [first, second, third] = contexts();
    expect(first.sessionId).toBe(second.sessionId);
    expect(first.userId).not.toBe(second.userId);
    expect(third.sessionId).not.toBe(first.sessionId);
    for (const context of contexts()) expect(isUuid(context.sessionId)).toBe(true);
  });
});

describe('the run id reaches the generators', () => {
  it('createBatch forwards the run id to create', async () => {
    const repo = repository();
    const create = jest.spyOn(repo, 'create').mockResolvedValue({ data: null, error: null });

    await repo.createBatch(U1, [{ detection, score: 80 } as unknown as PrioritizedInsight], R1);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ userId: U1, runId: R1 }));
  });

  it('saveCorrelationResults forwards the run id to correlated insights and the health summary', async () => {
    const repo = repository();
    const createCorrelated = jest
      .spyOn(repo, 'createCorrelatedInsight')
      .mockResolvedValue({ data: { id: 'i1' } as Insight, error: null });
    jest.spyOn(repo, 'findActive').mockResolvedValue({ data: [{ id: 'i1' } as Insight], error: null });
    const health = jest
      .spyOn(repo, 'createOrUpdateHealthSummary')
      .mockResolvedValue({ data: null, error: null });

    await repo.saveCorrelationResults(U1, summary, new Map([['cash_ar_overdue', 'i0']]), R1);

    expect(createCorrelated).toHaveBeenCalledWith(U1, correlated, ['i0'], R1);
    expect(health).toHaveBeenCalledWith(U1, summary, [{ id: 'i1' }], R1);
  });
});
