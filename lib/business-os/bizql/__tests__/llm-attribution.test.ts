/**
 * Chat LLM attribution (rows 1, 2, 3a, 3b, 4, 4b).
 *
 * Every chat call must be recorded as `business-os-chat` with its catalog call
 * name and the turn id as its group. The planner, analysis, plan cache and
 * verified questions run for real; only the provider, config and database are
 * faked. No network, no DB.
 */

const mockLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };

jest.mock('@/lib/logger', () => ({
  createLogger: () => mockLogger,
}));

/** Per-key overrides for config reads; everything else returns its default. */
const mockConfig = new Map<string, unknown>();

jest.mock('@/lib/services/SystemConfigService', () => ({
  SystemConfigService: {
    getString: jest.fn(async (_s: unknown, key: string, fallback: string) =>
      mockConfig.has(key) ? mockConfig.get(key) : fallback
    ),
    getNumber: jest.fn(async (_s: unknown, key: string, fallback: number) =>
      mockConfig.has(key) ? mockConfig.get(key) : fallback
    ),
    getBoolean: jest.fn(async (_s: unknown, key: string, fallback: boolean) =>
      mockConfig.has(key) ? mockConfig.get(key) : fallback
    ),
  },
}));

/** What every awaited Supabase query resolves to. `count` drives VerifiedQuestions.has. */
const mockDbResult: { data: unknown[]; error: null; count: number } = {
  data: [],
  error: null,
  count: 0,
};

jest.mock('@/lib/supabaseServer', () => {
  // A chainable query builder: every method returns the builder, and awaiting
  // it resolves to the shared result.
  const builder: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown) => resolve(mockDbResult);
        }
        return () => builder;
      },
    }
  );
  return { supabaseServer: { from: () => builder, rpc: () => builder } };
});

/*
 * The Layer 2 resolver, pinned to the code defaults (D-38 shape).
 *
 * Without it the planner and the analysis service would each make a REAL
 * `getByKeys` call against the configured Supabase project during a unit run.
 * They would still pass — the resolver degrades to the code defaults after its
 * 3-second budget — but slowly, and with a live network attempt inside a unit
 * suite. The defaults are exactly what these assertions are written against.
 */
jest.mock('@/lib/business-os/llm/modelSettings', () => {
  const actual = jest.requireActual('@/lib/business-os/llm/modelSettings');
  return {
    ...actual,
    resolveBosLlmSettings: async (area: string, callName: string) => actual.bosLlmCodeDefaults(area, callName),
    isBosLlmAreaEnabled: async () => true,
  };
});

jest.mock('@/lib/business-os/bizql/planner/catalogPrompt', () => ({
  ...jest.requireActual('@/lib/business-os/bizql/planner/catalogPrompt'),
  renderUserVocabulary: jest.fn(async () => ''),
}));

import { ProviderFactory } from '@/lib/ai/providerFactory';
import type { BaseAIProvider } from '@/lib/ai/providers/baseProvider';
import { BizQLPlanner } from '@/lib/business-os/bizql/planner/Planner';
import { analyse } from '@/lib/business-os/bizql/analyse/AnalysisService';
import { PlanCache, resetPlanCache } from '@/lib/business-os/bizql/cache/PlanCache';
import type { Plan } from '@/lib/business-os/bizql/planner/Planner';
import {
  VerifiedQuestions,
  resetVerifiedQuestions,
} from '@/lib/business-os/bizql/planner/VerifiedQuestions';
import type { Query, QueryResult } from '@/lib/business-os/bizql/types';

const U1 = '11111111-1111-4111-8111-111111111111';
const T1 = '44444444-4444-4444-8444-444444444444';
const T2 = '55555555-5555-4555-8555-555555555555';

const chatCompletion = jest.fn();
const createEmbedding = jest.fn();

const VALID_PLAN_ARGS = JSON.stringify({
  steps: [{ id: 's1', op: 'find', entity: 'contacts' }],
  answer: { text: 'You have {s1.count} contacts.', primary_step: 's1' },
});

function toolCall(args: string) {
  return {
    choices: [{ message: { tool_calls: [{ function: { name: 'emit_plan', arguments: args } }] } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
}

/** The second argument of every provider call of the given kind. */
const chatContexts = () => chatCompletion.mock.calls.map((call) => call[1]);
const embeddingContexts = () => createEmbedding.mock.calls.map((call) => call[1]);

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  mockConfig.clear();
  mockDbResult.data = [];
  mockDbResult.count = 0;
  resetPlanCache();
  resetVerifiedQuestions();

  createEmbedding.mockResolvedValue({ data: [{ embedding: [0.1, 0.2] }], usage: { total_tokens: 4 } });
  jest
    .spyOn(ProviderFactory, 'getProvider')
    .mockReturnValue({ chatCompletion, createEmbedding } as unknown as BaseAIProvider);
});

describe('row 1 — planner', () => {
  it('records the planner under business-os-chat / planner with the turn id', async () => {
    chatCompletion.mockResolvedValueOnce(toolCall(VALID_PLAN_ARGS));

    const outcome = await new BizQLPlanner().plan({ message: 'show my contacts', userId: U1, turnId: T1 });

    expect(outcome.ok).toBe(true);
    expect(chatContexts()).toEqual([
      {
        userId: U1,
        feature: 'business-os-chat',
        component: 'planner',
        sessionId: T1,
        activity_type: 'plan',
      },
    ]);
  });

  it('keeps the repair marking on a repair attempt, under the same call name and turn', async () => {
    chatCompletion
      .mockResolvedValueOnce(toolCall('{not json'))
      .mockResolvedValueOnce(toolCall(VALID_PLAN_ARGS));

    const outcome = await new BizQLPlanner().plan({ message: 'show my contacts', userId: U1, turnId: T1 });

    expect(outcome.ok).toBe(true);
    const contexts = chatContexts();
    expect(contexts).toHaveLength(2);
    expect(contexts[0]).toMatchObject({ component: 'planner', activity_type: 'plan', sessionId: T1 });
    expect(contexts[1]).toMatchObject({ component: 'planner', activity_type: 'repair', sessionId: T1 });
  });

  it('gives a second turn a different group', async () => {
    chatCompletion.mockResolvedValue(toolCall(VALID_PLAN_ARGS));

    await new BizQLPlanner().plan({ message: 'show my contacts', userId: U1, turnId: T1 });
    await new BizQLPlanner().plan({ message: 'show my contacts please', userId: U1, turnId: T2 });

    const [first, second] = chatContexts();
    expect(first.sessionId).toBe(T1);
    expect(second.sessionId).toBe(T2);
  });

  it('passes the turn id to the plan cache store (row 3b source)', async () => {
    chatCompletion.mockResolvedValueOnce(toolCall(VALID_PLAN_ARGS));
    const store = jest.spyOn(PlanCache.prototype, 'store').mockResolvedValue();

    await new BizQLPlanner().plan({ message: 'show my contacts', userId: U1, turnId: T1 });

    expect(store).toHaveBeenCalledTimes(1);
    expect(store.mock.calls[0][0]).toMatchObject({ userId: U1, turnId: T1 });
  });
});

describe('row 2 — analysis', () => {
  it('records analysis under business-os-chat / analysis with the request turn id', async () => {
    chatCompletion.mockResolvedValueOnce({ choices: [{ message: { content: 'You have {s1.value} contacts.' } }] });

    await analyse({
      question: 'how many contacts do I have',
      language: 'en',
      currency: 'USD',
      userId: U1,
      steps: [{ id: 's1' }],
      results: [
        { op: 'compute', entity: 'contacts', agg: { fn: 'count', field: 'id' }, value: 3, approximate: false } as unknown as QueryResult,
      ],
      turnId: T1,
    });

    expect(chatContexts()).toEqual([
      { userId: U1, feature: 'business-os-chat', component: 'analysis', sessionId: T1 },
    ]);
  });
});

describe('row 3a — plan cache lookup embedding', () => {
  it('records the lookup under plan_cache_lookup_embedding with the turn id', async () => {
    mockConfig.set('bizchat_plan_semantic_cache_enabled', true);

    await new PlanCache().lookup('show my contacts', 'en', U1, T1);

    expect(embeddingContexts()).toHaveLength(1);
    expect(embeddingContexts()[0]).toMatchObject({
      userId: U1,
      feature: 'business-os-chat',
      component: 'plan_cache_lookup_embedding',
      sessionId: T1,
      category: 'embedding_generation',
      activity_type: 'embedding',
    });
  });
});

describe('row 3b — plan cache store embedding', () => {
  it('records the store under the turn account and turn id, never the help bot', async () => {
    const plan = {
      steps: [{ id: 's1', op: 'find', entity: 'contacts' }],
      answer: { text: 'Here are your contacts.' },
    } as unknown as Plan;

    await new PlanCache().store({
      normalized: 'show my contacts',
      literals: [],
      language: 'en',
      userId: U1,
      turnId: T1,
      plan,
    });

    expect(embeddingContexts()).toHaveLength(1);
    const context = embeddingContexts()[0];
    expect(context).toMatchObject({
      userId: U1,
      feature: 'business-os-chat',
      component: 'plan_cache_store_embedding',
      sessionId: T1,
    });
    expect(context.feature).not.toBe('helpbot');
  });
});

describe('rows 4 and 4b — verified questions', () => {
  const steps = [
    { id: 's1', op: 'find', entity: 'quotes', where: [{ field: 'status', op: 'eq', value: 'sent' }] },
  ] as unknown as Query[];

  it('records the lookup (similar) under verified_question_embedding', async () => {
    mockDbResult.count = 1;

    await new VerifiedQuestions().similar({ userId: U1, question: 'open quotes', language: 'en', turnId: T1 });

    expect(embeddingContexts()).toHaveLength(1);
    expect(embeddingContexts()[0]).toMatchObject({
      userId: U1,
      feature: 'business-os-chat',
      component: 'verified_question_embedding',
      sessionId: T1,
    });
  });

  it('records the store (remember) under verified_question_store_embedding', async () => {
    await new VerifiedQuestions().remember({
      userId: U1,
      question: 'open quotes',
      language: 'en',
      steps,
      source: 'correction',
      turnId: T1,
    });

    expect(embeddingContexts()).toHaveLength(1);
    expect(embeddingContexts()[0]).toMatchObject({
      userId: U1,
      feature: 'business-os-chat',
      component: 'verified_question_store_embedding',
      sessionId: T1,
    });
  });
});

describe('all chat rows', () => {
  it('never logs an invalid-account error for a real account', async () => {
    chatCompletion.mockResolvedValueOnce(toolCall(VALID_PLAN_ARGS));

    await new BizQLPlanner().plan({ message: 'show my contacts', userId: U1, turnId: T1 });

    expect(mockLogger.error).not.toHaveBeenCalledWith(
      expect.objectContaining({ area: 'chat' }),
      expect.any(String)
    );
  });
});
