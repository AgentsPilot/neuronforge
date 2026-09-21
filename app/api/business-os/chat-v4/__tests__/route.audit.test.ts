/**
 * POST /api/business-os/chat-v4 — one Layer 3 audit entry per chat turn
 * (FR-9, Q-8; AC-8).
 *
 * The turn itself (`handleChatTurn`) is unchanged; `POST` only opens the AI
 * action. These tests drive the real route with its early dependencies faked:
 * one of them makes a real tracked LLM call through
 * BaseAIProvider.callWithTracking under the turn id (taken, as in production,
 * from a UUID `x-correlation-id`), so the real usage scope and entry builder run.
 */

import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockAuditLog = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrail: { log: (...a: unknown[]) => mockAuditLog(...a) },
  AuditTrailService: { getInstance: () => ({ log: (...a: unknown[]) => mockAuditLog(...a) }) },
}));

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
jest.mock('@/lib/business-os/userCurrency', () => ({ resolveUserCurrency: async () => 'USD' }));
/*
 * Layer 2: the chat area switch is read at route entry (Step 3). Mocked ON so
 * these audit cases keep testing what they were written to test, and so the
 * suite makes no real settings read. The off path has its own suite,
 * `lib/business-os/llm/__tests__/modelSettings.off.chat.test.ts`.
 */
jest.mock('@/lib/business-os/llm/modelSettings', () => {
  const actual = jest.requireActual('@/lib/business-os/llm/modelSettings');
  return { ...actual, isBosLlmAreaEnabled: async () => true };
});
jest.mock('@/lib/business-os/bizql/telemetry/ChatBudget', () => ({
  checkBudget: async () => ({ allowed: true, turnsUsed: 1, turnsLimit: 100, turnsRemaining: 99, warn: false, resetsAt: null }),
}));
jest.mock('@/lib/business-os/bizql/mutate/ConfirmationStore', () => ({
  getConfirmationStore: () => ({}),
  readConfirmationReply: () => null,
}));
jest.mock('@/lib/business-os/bizql/mutate/PendingFillStore', () => ({
  ...jest.requireActual('@/lib/business-os/bizql/mutate/PendingFillStore'),
  // A write is parked, and the message cancels it: the turn ends early, successfully.
  getPendingFillStore: () => ({
    take: async () => ({ remaining: [{ key: 'title' }], step: {}, utterance: '' }),
    clear: async () => undefined,
  }),
}));

const mockFindProfile = jest.fn();
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: { findByUserId: (...a: unknown[]) => mockFindProfile(...a) },
}));

import { POST } from '../route';
import { BaseAIProvider } from '@/lib/ai/providers/baseProvider';
import type { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';
import { buildBosCallContext } from '@/lib/business-os/llm/callCatalog';

const USER = { id: '2f734ed5-3681-4049-880d-3de7b096bea3', email: 'owner@example.com' };
const TURN = '9c7a0c55-1111-4111-8111-111111111111';
const OWNER_TEXT = 'OWNER-TEXT-MARKER-c1 cancel';

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

function plannerCall(groupId: string, fail = false) {
  return provider.callWithTracking(
    buildBosCallContext({ userId: USER.id, area: 'chat', callName: 'planner', groupId }),
    'openai',
    'gpt-4o-mini',
    'chat/completions',
    async () => {
      if (fail) throw Object.assign(new Error(`planner failed on ${OWNER_TEXT}`), { code: 'server_error' });
      return {};
    },
    () => ({ inputTokens: 900, outputTokens: 120, cost: 0.0007 })
  );
}

function turn(message: string, correlationId = TURN): NextRequest {
  return new NextRequest('http://localhost/api/business-os/chat-v4', {
    method: 'POST',
    body: JSON.stringify({ message }),
    headers: { 'content-type': 'application/json', 'x-correlation-id': correlationId },
  });
}

const aiEntries = () => mockAuditLog.mock.calls.map((c) => c[0]).filter((e) => e?.entityType === 'ai_action');

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue(USER);
  mockAuditLog.mockResolvedValue(undefined);
});

describe('chat-v4 — one AI audit entry per turn', () => {
  it('a turn with an LLM call writes one entry, on the owner, grouped by the turn id; the response is unchanged', async () => {
    mockFindProfile.mockImplementation(async () => {
      await plannerCall(TURN);
      return { data: { language: 'en' } };
    });
    const res = await POST(turn('cancel'));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);

    const entries = aiEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'BUSINESS_AI_ACTION_COMPLETED',
      entityId: TURN,
      userId: USER.id,
      actorId: USER.id,
      details: expect.objectContaining({ area: 'chat', actionType: 'chat_turn', trigger: 'user', callCount: 1, callNames: ['planner'], correlationId: TURN }),
    });
  });

  it('a turn that fails after its call is FAILED with chat_error; the route still answers 500 with no error text', async () => {
    mockFindProfile.mockImplementation(async () => {
      await plannerCall(TURN);
      throw new Error(`profile read failed for ${OWNER_TEXT}`);
    });
    const res = await POST(turn(OWNER_TEXT));
    expect(res.status).toBe(500);
    const entries = aiEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'BUSINESS_AI_ACTION_FAILED', details: expect.objectContaining({ errorCode: 'chat_error' }) });
    expect(JSON.stringify(entries[0])).not.toContain('OWNER-TEXT-MARKER-c1');
  });

  it('a turn that made no LLM call writes nothing (FR-7)', async () => {
    mockFindProfile.mockResolvedValue({ data: { language: 'en' } });
    const res = await POST(turn('cancel'));
    expect(res.status).toBe(200);
    expect(aiEntries()).toHaveLength(0);
  });

  it('a call carrying another group (a non-UUID correlation id gets a fresh turn id) is left out: no entry', async () => {
    mockFindProfile.mockImplementation(async () => {
      await plannerCall(TURN); // not this turn's group: the route minted its own
      return { data: { language: 'en' } };
    });
    const res = await POST(turn('cancel', 'free text id'));
    expect(res.status).toBe(200);
    expect(aiEntries()).toHaveLength(0);
  });

  it('an unauthenticated turn writes nothing', async () => {
    mockGetUser.mockResolvedValue(null);
    const res = await POST(turn('hello'));
    expect(res.status).toBe(401);
    expect(aiEntries()).toHaveLength(0);
  });
});
