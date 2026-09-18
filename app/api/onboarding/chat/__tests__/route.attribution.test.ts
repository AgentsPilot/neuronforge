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

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

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
import { isUuid, type BosLlmOwner } from '@/lib/business-os/llm/callCatalog';

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
