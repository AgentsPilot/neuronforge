/**
 * T1-11 (Layer 2 Step 1) — one retry on a model the provider will not serve.
 *
 * The last case is the important one: it runs a REAL `runAiAction` +
 * `withUsageScope` around a real `BaseAIProvider.callWithTracking`, with only
 * the ledger tracker and `AuditTrail.log` faked, and proves the retry stays
 * inside the audit scope — one entry, `callCount: 2`, `failedCallCount: 1`,
 * both models, outcome `succeeded`, and a 0-token ledger row for the attempt
 * that failed. A retry placed outside the scope would write two entries.
 *
 * AC-8, FR-11, DEC-9 / RC-7.
 */

const mockAuditLog = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrail: { log: (...args: unknown[]) => mockAuditLog(...args) },
}));

const logged: Array<{ level: string; fields: Record<string, unknown>; msg: string }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      logger[level] = (first: unknown, second?: unknown) => {
        logged.push({
          level,
          fields: typeof first === 'object' && first !== null ? (first as Record<string, unknown>) : {},
          msg: typeof first === 'string' ? first : String(second ?? ''),
        });
      };
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import {
  __resetModelFallbackForTests,
  isModelUnavailableError,
  withModelFallback,
} from '../modelFallback';
import { BOS_LLM_SETTINGS_CACHE_MS, type ResolvedBosLlmSettings } from '../modelSettings';
import { buildBosCallContext } from '../callCatalog';
import { resetPlatformActorForTests, runAiAction, type AiActionSpec } from '../aiActionAudit';
import { BaseAIProvider } from '@/lib/ai/providers/baseProvider';
import type { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';

const OWNER = '2f734ed5-3681-4049-880d-3de7b096bea3';
const PLATFORM = '11111111-1111-4111-8111-111111111111';
const GROUP = '33333333-3333-4333-8333-333333333333';

const CONFIGURED = 'gpt-4o-2026-preview';
const DEFAULT_MODEL = 'gpt-4o-mini';

function settings(overrides: Partial<ResolvedBosLlmSettings> = {}): ResolvedBosLlmSettings {
  return {
    area: 'insights',
    callName: 'insight_content',
    enabled: true,
    provider: 'openai',
    model: CONFIGURED,
    temperature: 0.3,
    defaultModel: DEFAULT_MODEL,
    ...overrides,
  };
}

/** What OpenAI returns when the model name is not one it will serve us. */
function modelNotFound(): Error {
  return Object.assign(new Error('The model does not exist'), {
    status: 404,
    code: 'model_not_found',
    param: 'model',
  });
}

beforeEach(() => {
  logged.length = 0;
  mockAuditLog.mockReset().mockResolvedValue(undefined);
  __resetModelFallbackForTests();
});

describe('the classifier reads status and code, never the message (Q-8)', () => {
  it.each([
    [{ status: 404, code: 'model_not_found' }, true],
    [{ status: 403, code: 'model_not_found' }, true],
    [{ status: 403, code: 'unsupported_model' }, true],
    [{ status: 404, param: 'model' }, true],
    [{ status: 429, code: 'rate_limit_exceeded' }, false],
    [{ status: 500, code: 'server_error' }, false],
    [{ status: 408, code: 'timeout' }, false],
    [{ status: 400, code: 'invalid_request_error' }, false],
    [{ message: 'model_not_found' }, false],
  ])('classifies %p as %p', (shape, expected) => {
    expect(isModelUnavailableError(Object.assign(new Error('x'), shape))).toBe(expected);
  });

  it('is false for a non-object', () => {
    expect(isModelUnavailableError('model_not_found')).toBe(false);
    expect(isModelUnavailableError(null)).toBe(false);
  });
});

describe('retry behaviour (T1-11, AC-8)', () => {
  it('retries exactly once with the code default, and says which model was refused', async () => {
    const seen: string[] = [];
    const outcome = await withModelFallback(settings(), async (model) => {
      seen.push(model);
      if (model === CONFIGURED) throw modelNotFound();
      return 'answer';
    });

    expect(seen).toEqual([CONFIGURED, DEFAULT_MODEL]);
    expect(outcome).toEqual({ result: 'answer', modelUsed: DEFAULT_MODEL });
    const error = logged.find((line) => line.level === 'error');
    expect(error?.fields).toMatchObject({
      area: 'insights',
      callName: 'insight_content',
      rejectedModel: CONFIGURED,
      defaultModel: DEFAULT_MODEL,
      errCode: 'model_not_found',
    });
  });

  it('remembers the refusal for the settings window, then tries again after it', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-20T12:00:00.000Z'));
    try {
      const seen: string[] = [];
      const attempt = async (model: string) => {
        seen.push(model);
        if (model === CONFIGURED) throw modelNotFound();
        return 'answer';
      };

      await withModelFallback(settings(), attempt);
      expect(seen).toEqual([CONFIGURED, DEFAULT_MODEL]);

      // Within the window: straight to the default, no failed round trip.
      await withModelFallback(settings(), attempt);
      expect(seen).toEqual([CONFIGURED, DEFAULT_MODEL, DEFAULT_MODEL]);

      jest.setSystemTime(Date.now() + BOS_LLM_SETTINGS_CACHE_MS + 1);
      await withModelFallback(settings(), attempt);
      expect(seen).toEqual([CONFIGURED, DEFAULT_MODEL, DEFAULT_MODEL, CONFIGURED, DEFAULT_MODEL]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not retry the same error on the code default itself', async () => {
    const seen: string[] = [];
    await expect(
      withModelFallback(settings({ model: DEFAULT_MODEL }), async (model) => {
        seen.push(model);
        throw modelNotFound();
      })
    ).rejects.toMatchObject({ code: 'model_not_found' });
    expect(seen).toEqual([DEFAULT_MODEL]);
  });

  it.each([
    ['a rate limit', { status: 429, code: 'rate_limit_exceeded' }],
    ['a timeout', { status: 408, code: 'timeout' }],
    ['a server error', { status: 500, code: 'server_error' }],
  ])('rethrows %s untouched, without a second call', async (_label, shape) => {
    const seen: string[] = [];
    await expect(
      withModelFallback(settings(), async (model) => {
        seen.push(model);
        throw Object.assign(new Error('nope'), shape);
      })
    ).rejects.toMatchObject(shape);
    expect(seen).toEqual([CONFIGURED]);
  });

  it('returns the model that ran, for FR-13', async () => {
    const outcome = await withModelFallback(settings(), async (model) => model.toUpperCase());
    expect(outcome).toEqual({ result: CONFIGURED.toUpperCase(), modelUsed: CONFIGURED });
  });
});

// ---------------------------------------------------------------------------
// The retry inside a real audit scope (AC-8, V-8)
// ---------------------------------------------------------------------------

class TestProvider extends BaseAIProvider {
  readonly defaultModel = 'test-model';
  readonly defaultMaxTokens = 100;
  readonly supportsResponseFormat = false;
  getMaxOutputTokens(): number {
    return 100;
  }
  async chatCompletion(): Promise<unknown> {
    throw new Error('not used');
  }
}

describe('placement: one audit entry, one failed ledger row (T1-11, V-8)', () => {
  let savedPlatform: string | undefined;

  beforeEach(() => {
    savedPlatform = process.env.SYSTEM_ADMIN_USER_ID;
    process.env.SYSTEM_ADMIN_USER_ID = PLATFORM;
    resetPlatformActorForTests();
  });

  afterEach(() => {
    if (savedPlatform === undefined) delete process.env.SYSTEM_ADMIN_USER_ID;
    else process.env.SYSTEM_ADMIN_USER_ID = savedPlatform;
    resetPlatformActorForTests();
  });

  it('records both models, one failure and outcome succeeded', async () => {
    const ledger: Array<Record<string, unknown>> = [];
    const provider = new TestProvider({
      trackAICall: async (row: Record<string, unknown>) => {
        ledger.push(row);
      },
    } as unknown as AIAnalyticsService);

    const spec: AiActionSpec = {
      area: 'insights',
      actionType: 'insight_run',
      groupId: GROUP,
      trigger: 'scheduled',
      accountId: OWNER,
    };

    const answer = await runAiAction(spec, async () => {
      const context = buildBosCallContext({
        userId: OWNER,
        area: 'insights',
        callName: 'insight_content',
        groupId: GROUP,
      });

      // Exactly the shape a Step 2 call site uses: the retry wraps ONLY the
      // provider call, inside the action's scope.
      const { result, modelUsed } = await withModelFallback(settings(), (model) =>
        provider.callWithTracking(
          context,
          'openai',
          model,
          'chat/completions',
          async () => {
            if (model === CONFIGURED) throw modelNotFound();
            return { text: 'insight' };
          },
          () => ({ inputTokens: 120, outputTokens: 30, cost: 0.0004 })
        )
      );
      expect(modelUsed).toBe(DEFAULT_MODEL);
      return (result as { text: string }).text;
    });

    expect(answer).toBe('insight');
    expect(mockAuditLog).toHaveBeenCalledTimes(1);
    expect(mockAuditLog.mock.calls[0][0].details).toMatchObject({
      callCount: 2,
      failedCallCount: 1,
      models: [CONFIGURED, DEFAULT_MODEL],
      callNames: ['insight_content'],
      outcome: 'succeeded',
    });

    expect(ledger).toHaveLength(2);
    expect(ledger[0]).toMatchObject({
      model_name: CONFIGURED,
      success: false,
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
      error_code: 'model_not_found',
    });
    expect(ledger[1]).toMatchObject({ model_name: DEFAULT_MODEL, success: true, input_tokens: 120 });
  });
});
