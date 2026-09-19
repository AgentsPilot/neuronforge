/**
 * POST /api/onboarding/build — ONE Layer 3 audit entry for the whole build,
 * listing both areas it touched (FR-12, OQ-5, WC-4; AC-11).
 *
 * Every repository is a permissive fake; the intake and website services are
 * faked to make real tracked LLM calls through BaseAIProvider.callWithTracking
 * under the build's group, so the real usage scope and entry builder run.
 */

import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockAuditLog = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrail: { log: (...a: unknown[]) => mockAuditLog(...a) },
}));

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

/** A repository whose every method answers "nothing there, no error". */
function mockRepo(overrides: Record<string, unknown> = {}): unknown {
  return new Proxy(overrides, {
    get(target, prop) {
      if (prop in target) return target[prop as string];
      if (prop === 'then') return undefined;
      return async () => ({ data: [], error: null, count: 0 });
    },
  });
}

jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: mockRepo({
    findByUserId: async () => ({ data: null, error: null }),
    upsert: async () => ({ data: { id: 'p1' }, error: null }),
    getUserCode: async () => ({ data: 'abc123', error: null }),
  }),
}));
jest.mock('@/lib/repositories/OnboardingConversationRepository', () => ({ onboardingConversationRepository: mockRepo() }));
jest.mock('@/lib/repositories/CRMPipelineStagesRepository', () => ({ crmPipelineStagesRepository: mockRepo() }));
jest.mock('@/lib/repositories/SchedulingRepository', () => ({ schedulingServiceRepository: mockRepo() }));
jest.mock('@/lib/repositories/SmartLinkRepository', () => ({ smartLinkRepository: mockRepo() }));
jest.mock('@/lib/repositories/PaymentPlanRepository', () => ({ paymentPlanRepository: mockRepo() }));
jest.mock('@/lib/services/CapabilityActivationService', () => ({
  capabilityActivationService: mockRepo({ activateFromProfile: async () => ({ success: true, activated: [], errors: [] }) }),
}));
jest.mock('@/lib/services/CapabilityConditionEvaluator', () => ({
  capabilityConditionEvaluator: mockRepo({ activateBlocksForProfile: async () => ({ success: true, activated: [], errors: [] }) }),
}));
jest.mock('@/lib/business-os/currency', () => ({ resolveBusinessCurrency: async () => 'USD' }));
jest.mock('@/lib/supabaseServer', () => {
  const builder: Record<string, unknown> = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') return (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null });
        return () => builder;
      },
    }
  );
  return { supabaseServer: { from: () => builder, rpc: async () => ({ data: null, error: null }) } };
});

const mockGenerateIntake = jest.fn();
jest.mock('@/lib/services/IntakeGenerationService', () => ({
  intakeGenerationService: { generateIntakeForm: (...a: unknown[]) => mockGenerateIntake(...a) },
}));
const mockGenerateWebsite = jest.fn();
jest.mock('@/lib/services/WebsiteGenerationService', () => ({
  WebsiteGenerationService: jest.fn().mockImplementation(() => ({
    generateWebsite: (...a: unknown[]) => mockGenerateWebsite(...a),
  })),
}));

import { POST } from '../route';
import { BaseAIProvider } from '@/lib/ai/providers/baseProvider';
import type { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';
import { buildBosCallContext } from '@/lib/business-os/llm/callCatalog';

const USER = { id: '2f734ed5-3681-4049-880d-3de7b096bea3', email: 'owner@example.com' };
const OWNER_TEXT = 'OWNER-TEXT-MARKER-k8 we teach calm';

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

function trackedCall(userId: string, area: 'website' | 'intake', callName: string, groupId: string) {
  return provider.callWithTracking(
    buildBosCallContext({ userId, area, callName, groupId } as Parameters<typeof buildBosCallContext>[0]),
    'openai',
    'gpt-4o',
    'chat/completions',
    async () => ({}),
    () => ({ inputTokens: 500, outputTokens: 200, cost: 0.004 })
  );
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    language: 'en',
    configuration: {
      company_name: 'Calm Studio',
      vertical: 'coach',
      description: OWNER_TEXT,
      clients_per_week: 5,
      pain_points: [],
      goals: [],
      tools: [],
      services: [],
      online_presence_mode: 'full_website',
      payment_mode: 'none',
      needs_stripe_connect: false,
      needs_intake: true,
      pipeline_stages: [],
      capabilities: [],
      building_blocks: {},
      ...overrides,
    },
  };
}

function post(b: unknown): NextRequest {
  return new NextRequest('http://localhost/api/onboarding/build', {
    method: 'POST',
    body: JSON.stringify(b),
    headers: { 'content-type': 'application/json' },
  });
}

const aiEntries = () => mockAuditLog.mock.calls.map((c) => c[0]).filter((e) => e.entityType === 'ai_action');

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue(USER);
  mockAuditLog.mockResolvedValue(undefined);
  mockGenerateIntake.mockImplementation(async (userId: string, opts: { groupId: string }) => {
    await trackedCall(userId, 'intake', 'form_generation', opts.groupId);
    return { success: true, formId: 'f1', questionCount: 4, contentSource: 'llm' };
  });
  mockGenerateWebsite.mockImplementation(async (userId: string, opts: { groupId: string }) => {
    await trackedCall(userId, 'website', 'full_site', opts.groupId);
    return { success: true, homepageId: 'h1', blocksCreated: 6 };
  });
});

describe('onboarding build — one AI audit entry for the whole build', () => {
  it('intake and website under one group become ONE entry listing both areas (WC-4)', async () => {
    await POST(post(body()));

    const entries = aiEntries();
    expect(entries).toHaveLength(1);
    const groupId = mockGenerateIntake.mock.calls[0][1].groupId;
    expect(mockGenerateWebsite.mock.calls[0][1].groupId).toBe(groupId);
    expect(entries[0]).toMatchObject({
      action: 'BUSINESS_AI_ACTION_COMPLETED',
      entityId: groupId,
      userId: USER.id,
      actorId: USER.id,
      details: expect.objectContaining({
        area: 'website',
        areas: ['website', 'intake'],
        actionType: 'onboarding_build',
        callCount: 2,
        callNames: ['form_generation', 'full_site'],
      }),
    });
    expect(JSON.stringify(entries[0])).not.toContain('OWNER-TEXT-MARKER-k8');
  });

  it('a website that did not generate makes the build FAILED (generation_failed)', async () => {
    mockGenerateWebsite.mockImplementation(async (userId: string, opts: { groupId: string }) => {
      await trackedCall(userId, 'website', 'full_site', opts.groupId);
      return { success: false, error: 'No sections could be saved' };
    });
    await POST(post(body()));
    expect(aiEntries()).toHaveLength(1);
    expect(aiEntries()[0]).toMatchObject({ action: 'BUSINESS_AI_ACTION_FAILED', details: expect.objectContaining({ errorCode: 'generation_failed' }) });
  });

  it('a build that asks for neither intake nor a website writes no entry', async () => {
    await POST(post(body({ needs_intake: false, online_presence_mode: 'booking_only' })));
    expect(mockGenerateIntake).not.toHaveBeenCalled();
    expect(aiEntries()).toHaveLength(0);
  });
});
