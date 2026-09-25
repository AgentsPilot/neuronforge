/**
 * T2-R / T2-M / T2-M-I (Layer 2 Step 2) — the configured model at the sites.
 *
 *   T2-R   A configured model the provider will not serve is retried ONCE on
 *          the code default, at the site, inside its own call — one per
 *          mechanism: `chatCompletion` (insights) and `complete()` (intake).
 *   T2-M   Intake records the model that RAN in `generated_from.model`
 *          (FR-13), which after a retry is the default, not the one that was
 *          refused.
 *   T2-M-I The insights ledger row's `model_name` is the model that ran, taken
 *          through the REAL `callWithTracking` rather than a mocked tracker —
 *          the path that actually writes `token_usage` (RC-W11).
 */

jest.mock('@/lib/logger', () => {
  const logger = {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    child: () => logger,
  };
  return { createLogger: () => logger };
});

const mockGetByKeys = jest.fn();
jest.mock('@/lib/repositories/SystemConfigRepository', () => {
  const actual = jest.requireActual('@/lib/repositories/SystemConfigRepository');
  return {
    ...actual,
    systemConfigRepository: {
      ...actual.systemConfigRepository,
      getByKeys: (...args: unknown[]) => mockGetByKeys(...args),
      getImageGenerationConfig: async () => ({ ...actual.IMAGE_GENERATION_CONFIG_DEFAULTS, pricesUsd: {} }),
    },
  };
});

jest.mock('@/lib/ai/pricing', () => ({
  getPricing: async () => ({ input: 0.0025, output: 0.01 }),
  hasPricing: async () => true,
  calculateCost: async () => 0.0001,
  calculateCostSync: () => 0.0001,
}));

const profile = {
  user_id: '11111111-1111-4111-8111-111111111111',
  company_name: 'Studio',
  vertical: 'events',
  sub_vertical: null,
  language: 'en',
};

jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: { findByUserId: async () => ({ data: profile, error: null }) },
}));
jest.mock('@/lib/repositories/SchedulingRepository', () => ({
  schedulingServiceRepository: { listAll: async () => ({ data: [], error: null }) },
}));

const savedDrafts: Array<{ questions: unknown[]; meta: Record<string, unknown> }> = [];
jest.mock('@/lib/repositories/IntakeFormRepository', () => ({
  intakeFormRepository: {
    getDraft: async () => ({ data: null, error: null }),
    saveDraft: async (_userId: string, questions: unknown[], meta: Record<string, unknown>) => {
      savedDrafts.push({ questions, meta });
      return { data: { id: 'form-1', questions }, error: null };
    },
  },
}));

import type { SupabaseClient } from '@supabase/supabase-js';
import { ProviderFactory } from '@/lib/ai/providerFactory';
import { BaseAIProvider, type CallContext } from '@/lib/ai/providers/baseProvider';
import type { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';
import { BOS_LLM_AREAS, type BosLlmArea } from '../callCatalog';
import { __resetBosLlmSettingsForTests } from '../modelSettings';
import { bosLlmAreaKey } from '../modelSettingsPolicy';
import { SEEDED_ROWS } from '../__fixtures__/seededRows';
import { __resetModelFallbackForTests } from '../modelFallback';
import { InsightRepository } from '@/lib/business-os/insight/repository/InsightRepository';
import type { InsightRunIds } from '@/lib/business-os/insight/repository/InsightRepository';
import type { DetectionResult } from '@/lib/business-os/insight/detectors/types';
import { IntakeGenerationService } from '@/lib/services/IntakeGenerationService';

const U1 = profile.user_id;
const G1 = '33333333-3333-4333-8333-333333333333';
const R1 = '66666666-6666-4666-8666-666666666666';
/** The insight run's PER-BUSINESS group. Distinct from `R1` so the two cannot be confused. */
const INSIGHT_GROUP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RUN_IDS: InsightRunIds = { runId: R1, groupId: INSIGHT_GROUP };

/** A model that is priced (the mock says so) but that the key cannot serve. */
const CONFIGURED = 'gpt-4o-mini-2099';
const INSIGHTS_DEFAULT = 'gpt-4o-mini';
const INTAKE_DEFAULT = 'gpt-4o';

const chatCompletion = jest.fn();

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

const businessContext = {
  language: 'en',
  currency: 'USD',
  vertical: 'therapy',
  sub_vertical: null,
  company_size: 'solo',
};

const INSIGHT_JSON = '{"title":"t","description":"d","recommendation":"r"}';
const INTAKE_JSON = JSON.stringify({ questions: [{ label: 'What date?', type: 'date', required: true }] });

/** The rows, with one area's model overridden to a model the key will refuse. */
function rowsWithModel(area: BosLlmArea, model: string) {
  return {
    data: BOS_LLM_AREAS.map((a) => ({
      key: bosLlmAreaKey(a),
      value: a === area ? { ...SEEDED_ROWS[a], model } : SEEDED_ROWS[a],
      category: 'business_os_llm',
      updated_at: '2026-10-03T00:00:00.000Z',
    })),
    error: null,
  };
}

/** The provider's "I do not have that model" shape, read by `isModelUnavailableError`. */
function modelNotFound(): Error & { status: number; code: string } {
  return Object.assign(new Error('The model does not exist'), { status: 404, code: 'model_not_found' });
}

/*
 * The insight generators take `InsightRunIds { runId, groupId }`, not a bare run
 * id (F-13): the group must be per business, the run id is shared by the run.
 *
 * The REAL type is imported rather than re-declared. These helpers cast through
 * `never` onto a hand-written signature, which defeats the compiler completely —
 * when the parameter changed, every call here kept compiling and started passing
 * a string where an object was expected, so `ids.groupId` was `undefined` and the
 * ledger row recorded NO group. Only the `session_id` assertion caught it.
 */
function insights() {
  return new InsightRepository({} as unknown as SupabaseClient) as never as {
    generateLocalizedContent(d: unknown, u: string, c: unknown, r: InsightRunIds): Promise<Record<string, string>>;
  };
}

function intake() {
  return new IntakeGenerationService();
}

const models = () => chatCompletion.mock.calls.map((call) => (call[0] as { model: string }).model);

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  savedDrafts.length = 0;
  __resetBosLlmSettingsForTests();
  __resetModelFallbackForTests();
  jest.spyOn(ProviderFactory, 'getProvider').mockReturnValue({ chatCompletion } as unknown as BaseAIProvider);
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('T2-R: a refused model is retried once on the code default (AC-8, at the site)', () => {
  it('insights — the chatCompletion mechanism', async () => {
    mockGetByKeys.mockResolvedValue(rowsWithModel('insights', CONFIGURED));
    chatCompletion
      .mockRejectedValueOnce(modelNotFound())
      .mockResolvedValue({ choices: [{ message: { content: INSIGHT_JSON } }] });

    const result = await insights().generateLocalizedContent(detection, U1, businessContext, RUN_IDS);

    expect(models()).toEqual([CONFIGURED, INSIGHTS_DEFAULT]);
    // The owner still gets the written insight, not the template.
    expect(result.title).toBe('t');
  });

  it('intake — the complete() mechanism', async () => {
    mockGetByKeys.mockResolvedValue(rowsWithModel('intake', CONFIGURED));
    chatCompletion
      .mockRejectedValueOnce(modelNotFound())
      .mockResolvedValue({ choices: [{ message: { content: INTAKE_JSON } }] });

    const result = await intake().generateIntakeForm(U1, { groupId: G1 });

    expect(models()).toEqual([CONFIGURED, INTAKE_DEFAULT]);
    expect(result.contentSource).toBe('llm');
  });

  it('an error that is NOT model-not-found is not retried', async () => {
    mockGetByKeys.mockResolvedValue(rowsWithModel('insights', CONFIGURED));
    chatCompletion.mockRejectedValue(Object.assign(new Error('rate limited'), { status: 429, code: 'rate_limit' }));

    const result = await insights().generateLocalizedContent(detection, U1, businessContext, RUN_IDS);

    expect(models()).toEqual([CONFIGURED]);
    // The site's own catch runs: templates, as it always did.
    expect(result.title).not.toBe('t');
  });
});

describe('T2-M: intake records the model that ran (FR-13, AC-10)', () => {
  it('records the configured model when it served the call', async () => {
    mockGetByKeys.mockResolvedValue(rowsWithModel('intake', CONFIGURED));
    chatCompletion.mockResolvedValue({ choices: [{ message: { content: INTAKE_JSON } }] });

    await intake().generateIntakeForm(U1, { groupId: G1 });

    expect(savedDrafts).toHaveLength(1);
    expect(savedDrafts[0].meta).toMatchObject({ source: 'llm', model: CONFIGURED });
  });

  it('records the DEFAULT after a retry, not the model that was refused', async () => {
    mockGetByKeys.mockResolvedValue(rowsWithModel('intake', CONFIGURED));
    chatCompletion
      .mockRejectedValueOnce(modelNotFound())
      .mockResolvedValue({ choices: [{ message: { content: INTAKE_JSON } }] });

    await intake().generateIntakeForm(U1, { groupId: G1 });

    expect(savedDrafts[0].meta).toMatchObject({ source: 'llm', model: INTAKE_DEFAULT });
  });

  it('records no model at all when the copy came from the fallback', async () => {
    mockGetByKeys.mockResolvedValue(rowsWithModel('intake', CONFIGURED));
    chatCompletion.mockResolvedValue({ choices: [{ message: { content: 'not json' } }] });

    await intake().generateIntakeForm(U1, { groupId: G1 });

    expect(savedDrafts[0].meta).toMatchObject({ source: 'fallback', model: undefined });
  });
});

/**
 * T2-M-I (RC-W11): the ledger row, through the real tracker path.
 *
 * `callWithTracking` is what writes `token_usage`, and it is given the model by
 * the provider's own `chatCompletion`. Mocking the tracker would prove nothing
 * about which model the ledger records, so this drives a real BaseAIProvider
 * subclass with only the analytics service faked.
 */
describe('T2-M-I: the insights ledger row carries the model that ran', () => {
  const tracked: Array<Record<string, unknown>> = [];

  class TrackingProvider extends BaseAIProvider {
    readonly defaultModel = INSIGHTS_DEFAULT;
    readonly defaultMaxTokens = 300;
    readonly supportsResponseFormat = true;
    getMaxOutputTokens(): number {
      return 300;
    }
    async chatCompletion(params: { model: string }, context: CallContext): Promise<unknown> {
      return this.callWithTracking(
        context,
        'openai',
        params.model,
        'chat.completions',
        () => chatCompletion(params, context) as Promise<unknown>,
        () => ({ inputTokens: 10, outputTokens: 20, cost: 0.0001, responseSize: 100 })
      );
    }
  }

  beforeEach(() => {
    tracked.length = 0;
    const analytics = {
      trackAICall: async (row: Record<string, unknown>) => {
        tracked.push(row);
      },
    } as unknown as AIAnalyticsService;
    jest.spyOn(ProviderFactory, 'getProvider').mockReturnValue(new TrackingProvider(analytics));
  });

  it('records the configured model, under the right account, feature and group', async () => {
    mockGetByKeys.mockResolvedValue(rowsWithModel('insights', CONFIGURED));
    chatCompletion.mockResolvedValue({ choices: [{ message: { content: INSIGHT_JSON } }] });

    await insights().generateLocalizedContent(detection, U1, businessContext, RUN_IDS);

    expect(tracked).toHaveLength(1);
    expect(tracked[0]).toMatchObject({
      model_name: CONFIGURED,
      provider: 'openai',
      user_id: U1,
      feature: 'business-os-insights',
      component: 'insight_content',
      session_id: INSIGHT_GROUP, // the per-business GROUP, never the shared run id
      success: true,
    });
  });

  it('after a retry, the successful row carries the DEFAULT and the failed one the refused model', async () => {
    mockGetByKeys.mockResolvedValue(rowsWithModel('insights', CONFIGURED));
    chatCompletion
      .mockRejectedValueOnce(modelNotFound())
      .mockResolvedValue({ choices: [{ message: { content: INSIGHT_JSON } }] });

    await insights().generateLocalizedContent(detection, U1, businessContext, RUN_IDS);

    // Two rows: the 0-token failure on the refused model, then the real call.
    expect(tracked.map((row) => [row.model_name, row.success])).toEqual([
      [CONFIGURED, false],
      [INSIGHTS_DEFAULT, true],
    ]);
    expect(tracked[0]).toMatchObject({ input_tokens: 0, output_tokens: 0, cost_usd: 0 });
  });
});
