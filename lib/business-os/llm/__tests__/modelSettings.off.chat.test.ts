/**
 * T3-G / T3-O (Layer 2 Step 3) — what happens when chat, analysis or image
 * generation is switched off (FR-14, AC-9).
 *
 * The chat area switch is the one an operator reaches for when a model is
 * misbehaving or the bill is running away, so this suite is about proving the
 * two things that make it worth having:
 *
 *   1. **The spend actually stops.** No planner, no analysis, no embedding, no
 *      data-layer or intent-parser call, on ANY of the three chat routes — not
 *      just the one the dashboard happens to use today. And no ledger row and
 *      no AI audit entry follow, because no call was made.
 *   2. **The owner is told, in their own language,** in the route's normal
 *      success shape, so no client needs a new branch to understand it.
 *
 * Plus the two placement decisions SA ruled on (RC-W2, Q-10), which are only
 * visible as tests: a write the owner already parked can still be confirmed or
 * cancelled while chat is off, and chat-off beats the budget refusal.
 *
 * @see docs/workplans/BUSINESS_OS_LLM_MODEL_SETTINGS_LAYER2_WORKPLAN.md §7.3
 */

const logged: Array<{ level: string; fields: Record<string, unknown>; msg: unknown }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) {
      logger[level] = (fields: unknown, msg?: unknown) =>
        logged.push({
          level,
          fields: (typeof fields === 'object' && fields !== null ? fields : {}) as Record<string, unknown>,
          msg: typeof fields === 'string' ? fields : msg,
        });
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
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
  calculateCost: async () => 0,
  calculateCostSync: () => 0,
}));

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockAuditLog = jest.fn(async () => undefined);
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrail: { log: (...a: unknown[]) => mockAuditLog(...(a as [])) },
  AuditTrailService: { getInstance: () => ({ log: (...a: unknown[]) => mockAuditLog(...(a as [])) }) },
}));

const mockDbResult: { data: unknown[]; error: null; count: number } = { data: [], error: null, count: 0 };
jest.mock('@/lib/supabaseServer', () => {
  const builder: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') return (resolve: (v: unknown) => unknown) => resolve(mockDbResult);
        return () => builder;
      },
    }
  );
  return { supabaseServer: { from: () => builder, rpc: () => builder } };
});

/** The owner's language, so the sentence can be checked in all three. */
const mockProfile: { language: string } = { language: 'en' };
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: {
    findByUserId: async () => ({ data: { ...mockProfile, timezone: 'UTC' }, error: null }),
  },
  BusinessProfileRepository: class {
    async findByUserId() {
      return { data: { ...mockProfile, timezone: 'UTC' }, error: null };
    }
  },
}));

/*
 * The three things the chat routes must NOT reach. Mocked as spies that throw
 * if called: a silent `undefined` would let a missing gate look like a pass.
 */
const mockPlan = jest.fn(() => {
  throw new Error('the planner must not run with chat off');
});
jest.mock('@/lib/business-os/bizql/planner/Planner', () => ({
  ...jest.requireActual('@/lib/business-os/bizql/planner/Planner'),
  getBizQLPlanner: () => ({ plan: mockPlan }),
}));

const mockAnalyse = jest.fn(() => {
  throw new Error('analysis must not run with chat off');
});
jest.mock('@/lib/business-os/bizql/analyse/AnalysisService', () => ({
  analyse: (...a: unknown[]) => mockAnalyse(...(a as [])),
}));

const mockAiDataLayer = jest.fn(() => {
  throw new Error('the AI data layer must not run with chat off');
});
jest.mock('@/lib/business-os/ai-data-layer/AIDataLayerService', () => ({
  createAIDataLayerService: () => ({ processMessage: mockAiDataLayer }),
}));

const mockParseIntent = jest.fn(() => {
  throw new Error('the intent parser must not run with chat off');
});
jest.mock('@/lib/business-os/IntentParser', () => ({ parseIntent: (...a: unknown[]) => mockParseIntent(...(a as [])) }));
jest.mock('@/lib/business-os/ChatCommandExecutor', () => ({
  executeIntent: async () => ({ response: 'done', suggestions: [] }),
}));
jest.mock('@/lib/repositories/SchedulingRepository', () => ({
  schedulingServiceRepository: { listAll: async () => ({ data: [], error: null }) },
}));
jest.mock('@/lib/repositories/CRMContactRepository', () => ({
  crmContactRepository: { list: async () => ({ data: [], error: null }) },
}));

/** Budget: allowed unless a test says otherwise. */
const mockBudget: { allowed: boolean } = { allowed: true };
jest.mock('@/lib/business-os/bizql/telemetry/ChatBudget', () => ({
  checkBudget: async () => ({
    allowed: mockBudget.allowed,
    exceeded: mockBudget.allowed ? null : 'turns',
    turnsUsed: 5,
    turnsLimit: 50,
    turnsRemaining: mockBudget.allowed ? 45 : 0,
    tokensUsed: 0,
    warn: false,
    resetsAt: '2026-09-22T00:00:00.000Z',
  }),
}));

/** A parked write, so the confirm/cancel branch can be driven (RC-W2). */
const mockPending: { value: unknown } = { value: null };
jest.mock('@/lib/business-os/bizql/mutate/PendingFillStore', () => ({
  // Spread the real module: the route also imports `isCancelMessage` from it,
  // and a mock that replaces the whole module leaves that undefined — a
  // TypeError inside the handler, answered as a 500 that looks exactly like a
  // missing gate. (It cost the first run of this suite one false failure.)
  ...jest.requireActual('@/lib/business-os/bizql/mutate/PendingFillStore'),
  getPendingFillStore: () => ({
    take: async () => mockPending.value,
    clear: async () => undefined,
    put: async () => undefined,
  }),
}));
/** A write already previewed and awaiting a yes/no, when a test parks one. */
const mockConfirmation: { value: unknown } = { value: null };
jest.mock('@/lib/business-os/bizql/mutate/ConfirmationStore', () => ({
  // Same: `readConfirmationReply` is imported alongside `getConfirmationStore`.
  ...jest.requireActual('@/lib/business-os/bizql/mutate/ConfirmationStore'),
  getConfirmationStore: () => ({
    take: async () => mockConfirmation.value,
    clear: async () => undefined,
    put: async () => undefined,
  }),
}));

/**
 * The frozen-write replay, spied rather than executed.
 *
 * What the confirm-branch test needs to know is whether the route REACHES it
 * with chat off. Running it for real would drag in every repository the
 * confirmed steps touch, and would prove something the next test proves
 * properly and at the right level.
 */
const mockApplyFrozenWrites = jest.fn(async () => ({ applied: ['created contact'] }));
jest.mock('@/lib/business-os/bizql/mutate/applyWrites', () => ({
  applyFrozenWrites: (...a: unknown[]) => mockApplyFrozenWrites(...(a as [])),
}));

/**
 * The landing-page generator, spied at the boundary `pages.create` calls it.
 *
 * This is the second joint of the chain SA found: chat off does not stop a
 * CONFIRMED landing-page write from making a `website/full_site` call.
 */
/**
 * Typed with its real parameters, and — importantly — it DERIVES its outcome
 * from the settings row instead of being told what to return.
 *
 * The real `generateWebsite` resolves `website/full_site` inside `callLLM` and,
 * when the area is off and the caller passed `onAiDisabled: 'fail'`, refuses
 * before any write (`WebsiteGenerationService.ts`, RC-W3). Reproduced here
 * through the REAL resolver, so `rows({ website: false })` is what actually
 * drives the refusal. A `mockResolvedValueOnce` would have made the row
 * decorative and let the test claim more than it proved.
 */
const mockGenerateWebsite = jest.fn(async (_userId: string, options: Record<string, unknown>) => {
  const settings = await resolveBosLlmSettings('website', 'full_site');
  if (!settings.enabled && options.onAiDisabled === 'fail') {
    return {
      success: false,
      code: 'ai_unavailable' as const,
      error: AI_UNAVAILABLE_WEBSITE_WRITING.en,
      contentSource: 'fallback' as const,
    };
  }
  return { success: true, homepageId: 'p1', blocksCreated: 3, contentSource: 'llm' as const };
});
jest.mock('@/lib/services/WebsiteGenerationService', () => ({
  WebsiteGenerationService: class {
    generateWebsite = (userId: string, options: Record<string, unknown>) => mockGenerateWebsite(userId, options);
  },
}));

/** The page row `pages.create` writes before it asks for any copy. */
jest.mock('@/lib/repositories/WebsitePageRepository', () => ({
  WebsitePageRepository: class {
    async create() {
      return { data: { id: '77777777-7777-4777-8777-777777777777' }, error: null };
    }
  },
  getWebsitePageRepository: () => ({
    create: async () => ({ data: { id: '77777777-7777-4777-8777-777777777777' }, error: null }),
  }),
}));

jest.mock('@/lib/business-os/userCurrency', () => ({ resolveUserCurrency: async () => 'USD' }));

const mockMedia = {
  findBySourceRef: jest.fn(async () => null),
  countGeneratedSince: jest.fn(async () => 0),
  record: jest.fn(async () => ({ id: 'm1' })),
};
jest.mock('@/lib/repositories/UserMediaRepository', () => ({ userMediaRepository: mockMedia }));

import { NextRequest } from 'next/server';
import { ProviderFactory } from '@/lib/ai/providerFactory';
import type { BaseAIProvider } from '@/lib/ai/providers/baseProvider';
import { POST as chatV4 } from '@/app/api/business-os/chat-v4/route';
import { POST as chatV2 } from '@/app/api/business-os/chat-v2/route';
import { POST as chatV1 } from '@/app/api/business-os/chat/route';
import { generateImage } from '@/lib/services/GeneratedImageService';
import { executeMutate } from '@/lib/business-os/bizql/mutate/MutateExecutor';

/**
 * The REAL analysis service, reached past this file's own mock.
 *
 * The mock above exists so the chat-route cases can prove that `analyse` is
 * never called with the area off. T3-O needs the opposite: the genuine
 * function, resolving the genuine settings, so that "the call's own switch is
 * off" can be told from "the module was stubbed". Its dependencies still go
 * through the mocked registry, so the resolver still reads the rows below and
 * `ProviderFactory` is still the spied singleton.
 */
const { analyse: realAnalyse } = jest.requireActual<
  typeof import('@/lib/business-os/bizql/analyse/AnalysisService')
>('@/lib/business-os/bizql/analyse/AnalysisService');

import { __resetBosLlmSettingsForTests, resolveBosLlmSettings } from '../modelSettings';
import { bosLlmAreaKey } from '../modelSettingsPolicy';
import { BOS_LLM_AREAS } from '../callCatalog';
import { SEEDED_ROWS } from '../__fixtures__/seededRows';
import { AI_UNAVAILABLE_CHAT, AI_UNAVAILABLE_WEBSITE_WRITING } from '../aiUnavailableMessages';
import { __resetModelFallbackForTests } from '../modelFallback';

const U1 = '11111111-1111-4111-8111-111111111111';
const G1 = '33333333-3333-4333-8333-333333333333';

const chatCompletion = jest.fn();
const generateImageSpy = jest.fn();

function rows(off: Record<string, boolean> = {}) {
  const copy = JSON.parse(JSON.stringify(SEEDED_ROWS)) as Record<string, Record<string, unknown>>;
  for (const [area, enabled] of Object.entries(off)) copy[area].enabled = enabled;
  return {
    data: BOS_LLM_AREAS.map((area) => ({
      key: bosLlmAreaKey(area),
      value: copy[area],
      category: 'business_os_llm',
      updated_at: '2026-10-03T00:00:00.000Z',
    })),
    error: null,
  };
}

function post(url: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

/** Nothing reached a model, so nothing may have been recorded. */
function expectNoSpendAndNoAudit(): void {
  expect(chatCompletion).not.toHaveBeenCalled();
  expect(mockPlan).not.toHaveBeenCalled();
  expect(mockAnalyse).not.toHaveBeenCalled();
  expect(mockAiDataLayer).not.toHaveBeenCalled();
  expect(mockParseIntent).not.toHaveBeenCalled();
  expect(mockAuditLog).not.toHaveBeenCalled();
}

beforeEach(() => {
  logged.length = 0;
  jest.clearAllMocks();
  jest.restoreAllMocks();
  __resetBosLlmSettingsForTests();
  __resetModelFallbackForTests();
  mockGetUser.mockResolvedValue({ id: U1 });
  mockProfile.language = 'en';
  mockBudget.allowed = true;
  mockPending.value = null;
  mockConfirmation.value = null;
  mockDbResult.data = [];
  mockDbResult.count = 0;
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.NEXT_PUBLIC_USE_AI_DATA_LAYER = 'true';

  jest.spyOn(ProviderFactory, 'getProvider').mockReturnValue({ chatCompletion } as unknown as BaseAIProvider);
  jest.spyOn(ProviderFactory, 'isProviderAvailable').mockReturnValue(true);
  jest.spyOn(ProviderFactory, 'getOpenAI').mockReturnValue({
    generateImage: (...args: unknown[]) => generateImageSpy(...args),
  } as never);
});

afterEach(() => jest.restoreAllMocks());

/* ------------------------------------------------------------------- T3-G */

describe('T3-G: chat off stops all three chat routes, in all three languages', () => {
  beforeEach(() => {
    mockGetByKeys.mockResolvedValue(rows({ chat: false }));
  });

  it.each(['en', 'he', 'es'] as const)('chat-v4 answers the sentence in %s', async (language) => {
    mockProfile.language = language;
    __resetBosLlmSettingsForTests();

    const response = await chatV4(post('http://localhost/api/business-os/chat-v4', { message: 'how many contacts' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.answer.text).toBe(AI_UNAVAILABLE_CHAT[language]);
    // The turn's normal shape, so the client needs no new branch.
    expect(body.answer).toMatchObject({ rows: [], truncated: false, approximate: false, collapsed: 0 });
    expectNoSpendAndNoAudit();
  });

  it.each(['en', 'he', 'es'] as const)('chat-v2 answers the sentence in %s', async (language) => {
    mockProfile.language = language;
    __resetBosLlmSettingsForTests();

    const response = await chatV2(post('http://localhost/api/business-os/chat-v2', { message: 'how many contacts' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.message).toBe(AI_UNAVAILABLE_CHAT[language]);
    expectNoSpendAndNoAudit();
  });

  it.each(['en', 'he', 'es'] as const)('chat v1 answers the sentence in %s', async (language) => {
    mockProfile.language = language;
    __resetBosLlmSettingsForTests();

    const response = await chatV1(post('http://localhost/api/business-os/chat', { message: 'how many contacts' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.response).toBe(AI_UNAVAILABLE_CHAT[language]);
    expectNoSpendAndNoAudit();
  });

  /*
   * RC-W2 / Q-10, the placement decision.
   *
   * The gate sits AFTER the in-progress fill and confirm/cancel branches, so a
   * write the owner already started can still be finished or abandoned. Those
   * paths make no model call, so letting them run costs nothing — and refusing
   * them would strand a write over a setting the owner did not change.
   */
  it('a parked write can still be cancelled while chat is off, with no model call', async () => {
    mockPending.value = {
      step: { entity: 'contacts', action: 'create' },
      remaining: [{ key: 'first_name' }],
    };

    const response = await chatV4(post('http://localhost/api/business-os/chat-v4', { message: 'cancel' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    // NOT the unavailable sentence: this branch answered before the gate.
    expect(body.answer.text).not.toBe(AI_UNAVAILABLE_CHAT.en);
    expect(chatCompletion).not.toHaveBeenCalled();
    expect(mockPlan).not.toHaveBeenCalled();
  });

  /*
   * The other half of the same promise, and the one that was described but not
   * tested until SA asked for it: a write the owner already CONFIRMED still
   * goes through with chat off.
   *
   * Cancel alone was covered. Cancel is the easy direction — it throws work
   * away. Confirm is the one where refusing would strand a write the owner
   * believes they authorised.
   */
  it('a parked write can still be confirmed while chat is off', async () => {
    mockConfirmation.value = {
      confirmationId: '88888888-8888-4888-8888-888888888888',
      steps: [{ op: 'mutate', entity: 'contacts', action: 'create' }],
      frozenRows: {},
      names: {},
    };

    const response = await chatV4(post('http://localhost/api/business-os/chat-v4', { message: 'yes' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    // The write ran, and the answer is about the write — not the chat-off
    // sentence, which would mean the gate had swallowed a confirmed action.
    expect(mockApplyFrozenWrites).toHaveBeenCalledTimes(1);
    expect(body.answer.text).not.toBe(AI_UNAVAILABLE_CHAT.en);
    expect(body.answer.text).toContain('created contact');
    // The planner and analysis are still never reached.
    expect(mockPlan).not.toHaveBeenCalled();
    expect(mockAnalyse).not.toHaveBeenCalled();
  });

  /**
   * And what that costs, stated as a test rather than as a comment (SA, Step 3).
   *
   * `applyFrozenWrites` replays the frozen steps, and `pages.create` with
   * `page_type: 'landing'` calls `generateWebsite` — a full `website/full_site`
   * LLM call. So confirming a parked landing-page write WHILE CHAT IS OFF does
   * spend. That is defensible: it is website spend, and the WEBSITE switch is
   * what stops it. Both halves are pinned here, so neither can quietly change.
   */
  describe('what the chat switch does NOT stop: a confirmed landing-page write', () => {
    const createLandingPage = () =>
      executeMutate(
        {
          op: 'mutate',
          entity: 'pages',
          action: 'create',
          data: { title: 'Summer course', page_type: 'landing', website_language: 'en' },
        } as never,
        { userId: U1, consumer: 'chat' } as never,
        { language: 'en' }
      );

    it('reaches website/full_site even with chat off — chat is not the switch for it', async () => {
      mockGetByKeys.mockResolvedValue(rows({ chat: false }));
      __resetBosLlmSettingsForTests();

      await createLandingPage();

      expect(mockGenerateWebsite).toHaveBeenCalledTimes(1);
      // And it asks for the refusing behaviour, not the starter-copy one, so
      // the owner is told rather than handed generic text (RC-W3).
      expect(mockGenerateWebsite.mock.calls[0][1]).toMatchObject({ onAiDisabled: 'fail' });
    });

    it('is stopped by the WEBSITE switch, which is the one that owns it', async () => {
      mockGetByKeys.mockResolvedValue(rows({ chat: false, website: false }));
      __resetBosLlmSettingsForTests();

      const result = await createLandingPage();

      // The page is still created — the owner confirmed that write (Q-7
      // reversed) — and the reply carries the sentence beside the link.
      // `executeMutate` answers a MutateResult, so "it worked" is `applied`.
      expect(result.applied).toBe(true);
      expect(result.preview).toContain('website-preview');
      expect(result.preview).toContain('AI writing is unavailable right now.');
    });
  });

  /*
   * And it sits BEFORE the budget refusal, so chat-off wins. The budget
   * message says "you are out of allowance, it resets at X" — sending the owner
   * to wait for a reset that is not the reason would be worse than saying
   * nothing.
   */
  it('chat off beats an exhausted budget', async () => {
    mockBudget.allowed = false;

    const response = await chatV4(post('http://localhost/api/business-os/chat-v4', { message: 'how many contacts' }));
    const body = await response.json();

    expect(body.answer.text).toBe(AI_UNAVAILABLE_CHAT.en);
    expect(body.budget.blocked).toBe(true);
  });

  it('an unauthenticated caller still gets 401, not a sentence', async () => {
    mockGetUser.mockResolvedValue(null);

    const v4 = await chatV4(post('http://localhost/api/business-os/chat-v4', { message: 'hello' }));
    const v2 = await chatV2(post('http://localhost/api/business-os/chat-v2', { message: 'hello' }));
    const v1 = await chatV1(post('http://localhost/api/business-os/chat', { message: 'hello' }));

    expect([v4.status, v2.status, v1.status]).toEqual([401, 401, 401]);
  });

  it('a malformed body still gets 400, not a sentence', async () => {
    const v2 = await chatV2(post('http://localhost/api/business-os/chat-v2', { message: '' }));
    const v1 = await chatV1(post('http://localhost/api/business-os/chat', { message: '' }));

    expect([v2.status, v1.status]).toEqual([400, 400]);
  });
});

/* ------------------------------------------------------------------- T3-O */

describe('T3-O: the per-call off paths', () => {
  it('analysis off keeps the planner sentence, with no provider call', async () => {
    mockGetByKeys.mockResolvedValue(
      rows(),
    );
    // Only the analysis call is off; the area stays on.
    mockGetByKeys.mockResolvedValue({
      data: BOS_LLM_AREAS.map((area) => ({
        key: bosLlmAreaKey(area),
        value:
          area === 'chat'
            ? { ...SEEDED_ROWS.chat, calls: { ...(SEEDED_ROWS.chat.calls as object), analysis: { enabled: false } } }
            : SEEDED_ROWS[area],
        category: 'business_os_llm',
        updated_at: '2026-10-03T00:00:00.000Z',
      })),
      error: null,
    });
    __resetBosLlmSettingsForTests();

    const sentence = await realAnalyse({
      question: 'how much revenue',
      language: 'en',
      currency: 'USD',
      userId: U1,
      steps: [{ id: 's1' }],
      results: [
        {
          id: 's1',
          op: 'compute',
          entity: 'transactions',
          agg: { fn: 'sum', field: 'net_amount' },
          value: 1,
          approximate: false,
        } as never,
      ],
      turnId: G1,
    });

    // null means "keep the planner's own sentence" — the owner sees no change.
    expect(sentence).toBeNull();
    expect(chatCompletion).not.toHaveBeenCalled();
    expect(logged.some((line) => line.fields.reason === 'disabled')).toBe(true);
  });

  it('images off returns the existing `unavailable` outcome and calls no provider', async () => {
    mockGetByKeys.mockResolvedValue(rows({ images: false }));
    __resetBosLlmSettingsForTests();

    await expect(generateImage({ userId: U1, groupId: G1 }, 'a calm studio', 'wide', 'hero')).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });

    expect(generateImageSpy).not.toHaveBeenCalled();
    // The daily count is never read either: nothing was going to be spent.
    expect(mockMedia.countGeneratedSince).not.toHaveBeenCalled();
  });

  /**
   * RC-W4 / N-4: the reuse check runs FIRST, and stays first.
   *
   * A picture this business already generated costs nothing to hand back and is
   * not an AI call. Switching image generation off must not take an owner's own
   * library away from them.
   */
  it('images off still returns a picture the business already has', async () => {
    mockGetByKeys.mockResolvedValue(rows({ images: false }));
    __resetBosLlmSettingsForTests();
    mockMedia.findBySourceRef.mockResolvedValue({
      public_url: 'https://cdn.example/existing.png',
      description: 'a calm studio',
    } as never);

    await expect(generateImage({ userId: U1, groupId: G1 }, 'a calm studio', 'wide', 'hero')).resolves.toEqual({
      ok: true,
      url: 'https://cdn.example/existing.png',
      description: 'a calm studio',
    });

    expect(generateImageSpy).not.toHaveBeenCalled();
  });
});
