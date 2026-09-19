/**
 * POST /api/onboarding/chat — ledger attribution (Layer 1.5 FR-1, FR-4, AC-3).
 *
 * The account comes from the session, the grouping id from the persisted
 * state (backfilled for a pre-Layer-1.5 snapshot BEFORE it is persisted), and
 * never from the request body's `conversationId`.
 */

import { NextRequest } from 'next/server';

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

/** Every log call, serialized at call time as Pino would (OI-7 test below). */
const mockLogged: Array<{ level: string; fields: Record<string, unknown>; msg: string }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      logger[level] = (first: unknown, second?: unknown) => {
        const fields = typeof first === 'object' && first !== null ? JSON.parse(JSON.stringify(first)) : {};
        const msg = typeof first === 'string' ? first : String(second ?? '');
        mockLogged.push({ level, fields, msg });
      };
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

// Layer 3: the AI audit entry is observed at AuditTrail.log.
const mockAuditLog = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrail: { log: (...a: unknown[]) => mockAuditLog(...a) },
}));

// No LLM runs in this test: processUserMessage is spied on below.
jest.mock('@/lib/ai/providerFactory', () => ({
  getProviderFactory: () => ({ complete: jest.fn().mockResolvedValue({ content: '{}' }) }),
}));

type Row = Record<string, unknown>;
let lastMessages: Row[] = [];
const inserts: Row[] = [];

// A minimal stand-in for the three onboarding_conversations calls the route makes.
jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => Promise.resolve({ data: lastMessages, error: null }),
        insert: (row: Row) => {
          inserts.push(row);
          return Promise.resolve({ error: null });
        },
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
      return chain;
    },
  },
}));

import { POST } from '../route';
import { OnboardingConversationManager, type OnboardingState } from '@/lib/services/OnboardingConversationManager';
import { buildBosCallContext, isUuid, type BosLlmOwner } from '@/lib/business-os/llm/callCatalog';
import { BaseAIProvider } from '@/lib/ai/providers/baseProvider';
import type { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';

const USER = { id: '2f734ed5-3681-4049-880d-3de7b096bea3', email: 'owner@example.com' };
const BODY_CONVERSATION_ID = '99999999-9999-4999-8999-999999999999';
const EXISTING_GROUP = '33333333-3333-4333-8333-333333333333';

function req(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/onboarding/chat', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function snapshotRow(state: Partial<OnboardingState>): Row {
  return { message_sequence: 3, metadata: { state_snapshot: JSON.stringify(state) } };
}

let processSpy: jest.SpyInstance;

beforeEach(() => {
  getUser.mockResolvedValue(USER);
  lastMessages = [];
  inserts.length = 0;
  processSpy = jest
    .spyOn(OnboardingConversationManager.prototype, 'processUserMessage')
    .mockImplementation(async (_owner: BosLlmOwner, _message: string, currentState: OnboardingState) => ({
      response: 'ok',
      updatedState: currentState,
    }));
});

afterEach(() => processSpy.mockRestore());

function ownerPassed(): BosLlmOwner {
  return processSpy.mock.calls[0][0] as BosLlmOwner;
}

function persistedUserState(): OnboardingState {
  const userInsert = inserts.find((r) => r.role === 'user') as { metadata: { state_snapshot: string } };
  return JSON.parse(userInsert.metadata.state_snapshot) as OnboardingState;
}

describe('POST /api/onboarding/chat — attribution', () => {
  it('a new conversation: the owner is the session user with a freshly minted group', async () => {
    const res = await POST(req({ message: 'hello', conversationId: BODY_CONVERSATION_ID }));
    expect(res.status).toBe(200);

    const owner = ownerPassed();
    expect(owner.userId).toBe(USER.id);
    expect(isUuid(owner.groupId)).toBe(true);
    expect(owner.groupId).not.toBe(BODY_CONVERSATION_ID);
    expect(persistedUserState().attributionGroupId).toBe(owner.groupId);
  });

  it('a resumed conversation keeps its group', async () => {
    lastMessages = [snapshotRow({ currentStep: 'business_story', collectedData: {}, language: 'en', attributionGroupId: EXISTING_GROUP })];

    await POST(req({ message: 'We run a studio', conversationId: BODY_CONVERSATION_ID }));

    expect(ownerPassed()).toEqual({ userId: USER.id, groupId: EXISTING_GROUP });
    expect(persistedUserState().attributionGroupId).toBe(EXISTING_GROUP);
  });

  it('a pre-Layer-1.5 snapshot is backfilled before it is persisted and before any call', async () => {
    lastMessages = [snapshotRow({ currentStep: 'business_story', collectedData: {}, language: 'en' })];

    await POST(req({ message: 'We run a studio', conversationId: BODY_CONVERSATION_ID }));

    const owner = ownerPassed();
    expect(isUuid(owner.groupId)).toBe(true);
    expect(owner.groupId).not.toBe(BODY_CONVERSATION_ID);
    // The user-message row written BEFORE processing already carries the group.
    expect(persistedUserState().attributionGroupId).toBe(owner.groupId);
  });

  it('never takes the grouping id from the body, even when the body sends one', async () => {
    lastMessages = [snapshotRow({ currentStep: 'business_story', collectedData: {}, language: 'en' })];
    await POST(req({ message: 'x', conversationId: BODY_CONVERSATION_ID }));
    expect(ownerPassed().groupId).not.toBe(BODY_CONVERSATION_ID);
    expect(JSON.stringify(inserts)).not.toContain(BODY_CONVERSATION_ID);
  });

  it('refuses an anonymous request before any attribution', async () => {
    getUser.mockResolvedValue(null);
    const res = await POST(req({ message: 'x' }));
    expect(res.status).toBe(401);
    expect(processSpy).not.toHaveBeenCalled();
  });
});

describe('POST /api/onboarding/chat — the owner\'s text is never logged (OI-7)', () => {
  const SENTINEL = 'OWNER-SENTINEL-kqxz private words the owner typed';

  it('logs the message length, never the message, on a new and a resumed conversation', async () => {
    const resumed = snapshotRow({ currentStep: 'business_story', collectedData: {}, language: 'en', attributionGroupId: EXISTING_GROUP });
    for (const snapshot of [[], [resumed]]) {
      mockLogged.length = 0;
      lastMessages = snapshot;
      const res = await POST(req({ message: SENTINEL }));
      expect(res.status).toBe(200);

      expect(JSON.stringify(mockLogged)).not.toContain(SENTINEL);
      const processing = mockLogged.find((l) => l.msg === 'Processing onboarding message');
      expect(processing).toMatchObject({ level: 'info', fields: { userId: USER.id, messageLength: SENTINEL.length } });
    }
  });
});

/**
 * Layer 3 (FR-14, AC-13): one audit entry per onboarding turn that made an LLM
 * call, every turn of a conversation sharing its group, each with only its own
 * calls. The manager is faked to make real tracked calls through
 * BaseAIProvider.callWithTracking under the owner it is handed.
 */
describe('POST /api/onboarding/chat — AI audit entry per turn (Layer 3)', () => {
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
  const OWNER_TEXT = 'OWNER-TEXT-MARKER-o7 we sell private yoga';

  function turnMakes(calls: number) {
    processSpy.mockImplementation(async (owner: BosLlmOwner, _message: string, currentState: OnboardingState) => {
      for (let i = 0; i < calls; i++) {
        await provider.callWithTracking(
          buildBosCallContext({ userId: owner.userId, area: 'onboarding', callName: 'business_story_extraction', groupId: owner.groupId }),
          'openai',
          'gpt-test',
          'chat/completions',
          async () => ({}),
          () => ({ inputTokens: 100, outputTokens: 30, cost: 0.002 })
        );
      }
      return { response: 'ok', updatedState: currentState };
    });
  }

  const aiEntries = () => mockAuditLog.mock.calls.map((c) => c[0]).filter((e) => e.entityType === 'ai_action');

  beforeEach(() => {
    mockAuditLog.mockReset();
    mockAuditLog.mockResolvedValue(undefined);
  });

  it('writes one entry per turn, on the owner, grouped by the conversation, with only that turn\'s calls', async () => {
    lastMessages = [snapshotRow({ currentStep: 'business_story', collectedData: {}, language: 'en', attributionGroupId: EXISTING_GROUP })];
    turnMakes(2);
    await POST(req({ message: OWNER_TEXT }));
    turnMakes(1);
    await POST(req({ message: OWNER_TEXT }));

    const entries = aiEntries();
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry).toMatchObject({
        action: 'BUSINESS_AI_ACTION_COMPLETED',
        entityId: EXISTING_GROUP,
        userId: USER.id,
        actorId: USER.id,
        details: expect.objectContaining({ area: 'onboarding', actionType: 'onboarding_turn', trigger: 'user' }),
      });
    }
    expect(entries.map((e) => e.details.callCount)).toEqual([2, 1]);
    expect(JSON.stringify(entries)).not.toContain('OWNER-TEXT-MARKER-o7');
  });

  it('writes nothing for a turn that made no LLM call', async () => {
    turnMakes(0);
    await POST(req({ message: 'English' }));
    expect(aiEntries()).toHaveLength(0);
  });
});
