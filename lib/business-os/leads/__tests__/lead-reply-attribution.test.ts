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

import { ProviderFactory } from '@/lib/ai/providerFactory';
import type { BaseAIProvider } from '@/lib/ai/providers/baseProvider';
import { isUuid } from '@/lib/business-os/llm/callCatalog';
import { recommendLeadReply } from '@/lib/business-os/leads/LeadReplyRecommender';
import type { LeadReplyCandidate } from '@/lib/business-os/leads/leadReplyCandidates';
import { notifyOwnerOfLead } from '@/lib/services/LeadAlertService';

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
