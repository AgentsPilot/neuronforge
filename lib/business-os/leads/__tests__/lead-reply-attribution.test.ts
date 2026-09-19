/**
 * Lead reply LLM attribution (row 12).
 *
 * The recommender keeps its real account and gains area, call name and a
 * grouping id. The group is one incoming ENQUIRY, not one contact: the same
 * person enquiring twice is two groups. Everything outside the two functions
 * under test is mocked; no network, no DB, no email.
 */

jest.mock('@/lib/logger', () => {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), child: () => logger };
  return { createLogger: () => logger };
});

jest.mock('@/lib/supabaseServer', () => {
  const builder: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null });
        }
        return () => builder;
      },
    }
  );
  return {
    supabaseServer: {
      from: () => builder,
      auth: { admin: { getUserById: async () => ({ data: { user: { email: 'owner@example.com' } } }) } },
    },
  };
});

jest.mock('@/lib/notifications/emailTransport', () => ({
  sendEmail: jest.fn(async () => ({ sent: true, provider: 'test' })),
}));
jest.mock('@/lib/email/branding', () => ({ resolveEmailBranding: jest.fn(async () => ({})) }));
jest.mock('@/lib/email/templates/new-enquiry', () => ({
  generateNewEnquiryEmail: jest.fn(() => ({ subject: 's', html: 'h' })),
}));
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: { findByUserId: jest.fn(async () => ({ data: { language: 'en' } })) },
}));
jest.mock('@/lib/repositories/SchedulingRepository', () => ({
  schedulingServiceRepository: { listAll: jest.fn(async () => ({ data: [] })) },
}));
jest.mock('@/lib/repositories/LeadResponseRepository', () => ({
  leadResponseRepository: { enqueue: jest.fn(async () => ({ data: null, error: null })) },
}));
jest.mock('@/lib/branding/platformSite', () => ({
  resolveBookingUrl: jest.fn(async () => 'https://example.com/book'),
}));
jest.mock('@/lib/business-os/leads/leadReplyCandidates', () => ({
  ...jest.requireActual('@/lib/business-os/leads/leadReplyCandidates'),
  buildLeadReplyCandidates: jest.fn(() => [
    { kind: 'booking_page', label: 'Book a session', url: 'https://example.com/book' },
  ]),
}));
jest.mock('@/lib/business-os/insight/events/BusinessEventService', () => ({
  businessEventService: { emit: jest.fn(async () => undefined), record: jest.fn(async () => undefined) },
}));
jest.mock('@/lib/repositories/SystemConfigRepository', () => ({
  systemConfigRepository: {
    getBoolean: jest.fn(async (_key: string, fallback: boolean) => fallback),
    getString: jest.fn(async (_key: string, fallback: string) => fallback),
  },
}));
jest.mock('@/lib/business-os/leads/LeadReplyRecommender', () => ({
  recommendLeadReply: jest.fn(async () => null),
}));

// Layer 3: the AI audit entry is observed at AuditTrail.log.
const mockAuditLog = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrail: { log: (...a: unknown[]) => mockAuditLog(...a) },
}));

import { ProviderFactory } from '@/lib/ai/providerFactory';
import { isUuid } from '@/lib/business-os/llm/callCatalog';
import { recommendLeadReply } from '@/lib/business-os/leads/LeadReplyRecommender';
import type { LeadReplyCandidate } from '@/lib/business-os/leads/leadReplyCandidates';
import { notifyOwnerOfLead } from '@/lib/services/LeadAlertService';
import { BaseAIProvider } from '@/lib/ai/providers/baseProvider';
import type { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';
import { buildBosCallContext } from '@/lib/business-os/llm/callCatalog';
import { resetPlatformActorForTests } from '@/lib/business-os/llm/aiActionAudit';

const OWNER = '11111111-1111-4111-8111-111111111111';
const CONTACT = '88888888-8888-4888-8888-888888888888';
const G1 = '33333333-3333-4333-8333-333333333333';

const mockedRecommend = recommendLeadReply as jest.MockedFunction<typeof recommendLeadReply>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('LeadAlertService — one group per enquiry', () => {
  it('gives two enquiries from the same contact different UUID groups', async () => {
    const enquiry = {
      ownerId: OWNER,
      contactId: CONTACT,
      kind: 'enquiry' as const,
      contactName: 'Dana',
      message: 'Do you have availability next week?',
    };

    await notifyOwnerOfLead(enquiry);
    await notifyOwnerOfLead(enquiry);

    expect(mockedRecommend).toHaveBeenCalledTimes(2);
    const [first, second] = mockedRecommend.mock.calls;
    expect(first[2]).toBe(OWNER);
    expect(second[2]).toBe(OWNER);
    expect(isUuid(first[3])).toBe(true);
    expect(isUuid(second[3])).toBe(true);
    expect(first[3]).not.toBe(second[3]);
  });
});

describe('LeadReplyRecommender — naming', () => {
  it('records the call under business-os-leads / reply_recommendation with the enquiry group', async () => {
    const chatCompletion = jest.fn(async () => ({ content: '{"index":0,"reason":"r"}' }));
    const spy = jest
      .spyOn(ProviderFactory, 'getProvider')
      .mockReturnValue({ chatCompletion } as unknown as BaseAIProvider);

    const actual = jest.requireActual<typeof import('@/lib/business-os/leads/LeadReplyRecommender')>(
      '@/lib/business-os/leads/LeadReplyRecommender'
    );

    await actual.recommendLeadReply(
      [{ kind: 'booking_page', label: 'Book a session', url: 'https://example.com/book' } as unknown as LeadReplyCandidate],
      { message: 'Can I book a session?', language: 'en' },
      OWNER,
      G1
    );

    expect(chatCompletion).toHaveBeenCalledTimes(1);
    expect((chatCompletion.mock.calls[0] as unknown[])[1]).toStrictEqual({
      userId: OWNER,
      feature: 'business-os-leads',
      component: 'reply_recommendation',
      sessionId: G1,
    });

    spy.mockRestore();
  });
});

/**
 * Layer 3 (FR-13, AC-12): one audit entry per enquiry whose reply recommendation
 * made an LLM call. The trigger is the visitor, so the actor is the platform;
 * nothing about the visitor is recorded. The recommender is faked to make one
 * real tracked call through BaseAIProvider.callWithTracking.
 */
describe('LeadAlertService — AI audit entry (Layer 3)', () => {
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
  const PLATFORM = '55555555-5555-4555-8555-555555555555';
  const VISITOR_TEXT = 'VISITOR-MARKER-v9 my private question';
  let savedPlatform: string | undefined;

  function fakeRecommend(fail: boolean) {
    mockedRecommend.mockImplementation(async (_c, _ctx, ownerId, groupId) => {
      await provider
        .callWithTracking(
          buildBosCallContext({ userId: ownerId, area: 'leads', callName: 'reply_recommendation', groupId }),
          'openai',
          'gpt-test',
          'chat/completions',
          async () => {
            if (fail) throw Object.assign(new Error(`upstream said ${VISITOR_TEXT}`), { code: 'server_error' });
            return {};
          },
          () => ({ inputTokens: 40, outputTokens: 8, cost: 0.0004 })
        )
        .catch(() => undefined);
      return fail ? null : ({ index: 0, reason: 'r' } as unknown as Awaited<ReturnType<typeof recommendLeadReply>>);
    });
  }

  const enquiry = {
    ownerId: OWNER,
    contactId: CONTACT,
    kind: 'enquiry' as const,
    contactName: 'Dana VisitorName',
    contactEmail: 'dana@visitor.example',
    message: VISITOR_TEXT,
  };

  beforeEach(() => {
    mockAuditLog.mockReset();
    mockAuditLog.mockResolvedValue(undefined);
    savedPlatform = process.env.SYSTEM_ADMIN_USER_ID;
    process.env.SYSTEM_ADMIN_USER_ID = PLATFORM;
    resetPlatformActorForTests();
  });

  afterEach(() => {
    if (savedPlatform === undefined) delete process.env.SYSTEM_ADMIN_USER_ID;
    else process.env.SYSTEM_ADMIN_USER_ID = savedPlatform;
    resetPlatformActorForTests();
    mockedRecommend.mockImplementation(async () => null);
  });

  it('writes exactly one entry per enquiry: the owner account, the platform actor, trigger external', async () => {
    fakeRecommend(false);
    await notifyOwnerOfLead(enquiry);
    expect(mockAuditLog).toHaveBeenCalledTimes(1);
    const entry = mockAuditLog.mock.calls[0][0];
    const groupId = mockedRecommend.mock.calls[0][3];
    expect(entry).toMatchObject({
      action: 'BUSINESS_AI_ACTION_COMPLETED',
      entityType: 'ai_action',
      entityId: groupId,
      userId: OWNER,
      actorId: PLATFORM,
      details: expect.objectContaining({
        area: 'leads',
        areas: ['leads'],
        actionType: 'lead_reply_recommendation',
        trigger: 'external',
        callCount: 1,
        callNames: ['reply_recommendation'],
      }),
    });
  });

  it('records a failed recommendation as FAILED, with a code only and nothing about the visitor', async () => {
    fakeRecommend(true);
    await notifyOwnerOfLead(enquiry);
    expect(mockAuditLog).toHaveBeenCalledTimes(1);
    const entry = mockAuditLog.mock.calls[0][0];
    expect(entry.action).toBe('BUSINESS_AI_ACTION_FAILED');
    // The action's own signal (no recommendation) comes first in the outcome rule (FR-6).
    expect(entry.details.errorCode).toBe('generation_failed');
    expect(entry.details.failedCallCount).toBe(1);
    const all = JSON.stringify(entry);
    for (const visitor of ['VISITOR-MARKER-v9', 'Dana VisitorName', 'dana@visitor.example', CONTACT]) {
      expect(all).not.toContain(visitor);
    }
  });

  it('writes nothing when no recommendation call is made', async () => {
    mockedRecommend.mockImplementation(async () => null);
    await notifyOwnerOfLead(enquiry);
    expect(mockAuditLog).not.toHaveBeenCalled();
  });
});
