/**
 * BriefingStore.getBriefing — the Layer 3 audit entry for a briefing narration
 * (FR-11, RC-8, WC-3; AC-10).
 *
 * The narrator is faked to make a real tracked call through
 * BaseAIProvider.callWithTracking under the briefing's group, so the real usage
 * scope and entry builder run. The cache table is faked in memory.
 *
 * The name puts this file in `npm run typecheck:bos-llm`'s scope, which is what
 * enforces the `@ts-expect-error` below: `getBriefing` does not compile without
 * a trigger.
 */

const mockAuditLog = jest.fn();
/*
 * Layer 2 (Step 2): the call sites take their model, temperature and on/off
 * switch from `resolveBosLlmSettings`. Pinned to the CODE DEFAULTS — today's
 * values — so this file keeps asserting exactly what it asserted before, with
 * no configuration read and no I/O.
 */
jest.mock('@/lib/business-os/llm/modelSettings', () => {
  const actual = jest.requireActual('@/lib/business-os/llm/modelSettings');
  return {
    ...actual,
    resolveBosLlmSettings: async (area: string, callName: string) => actual.bosLlmCodeDefaults(area, callName),
  };
});

jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrail: { log: (...a: unknown[]) => mockAuditLog(...a) },
}));

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

/** The cached row, per test: null = nothing cached. */
let mockCached: { facts_hash: string; narrative: string; source: string } | null = null;
jest.mock('@/lib/supabaseServer', () => {
  const read = {
    select: () => read,
    eq: () => read,
    maybeSingle: async () => ({ data: mockCached, error: null }),
    upsert: async () => ({ error: null }),
  };
  return { supabaseServer: { from: () => read } };
});

const mockNarrate = jest.fn();
jest.mock('../BriefingNarrator', () => ({
  ...jest.requireActual('../BriefingNarrator'),
  narrateBriefing: (...a: unknown[]) => mockNarrate(...a),
}));

import { getBriefing, hashFacts } from '../BriefingStore';
import { bosLlmCodeDefaults } from '@/lib/business-os/llm/modelSettings';
import type { BriefingFacts } from '../BriefingFactsService';
import { BaseAIProvider } from '@/lib/ai/providers/baseProvider';
import type { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';
import { bosBriefingGroupId, buildBosCallContext } from '@/lib/business-os/llm/callCatalog';
import { resetPlatformActorForTests } from '@/lib/business-os/llm/aiActionAudit';

const OWNER = '2f734ed5-3681-4049-880d-3de7b096bea3';
const PLATFORM = '55555555-5555-4555-8555-555555555555';
const OWNER_DATA = 'CLIENT-NAME-MARKER-b4 John Dou';

const FACTS = {
  day: { timezone: 'UTC', date: '2026-09-16', startUtc: '2026-09-16T00:00:00.000Z', endUtc: '2026-09-17T00:00:00.000Z', localHour: 9 },
  appointments: { total: 1, ready: 0, completed: 0, awaitingIntake: [], awaitingPayment: [], cancelled: [], first: { name: OWNER_DATA, timeLocal: '14:30' } },
  money: { owed: [], totalOwed: 0, currency: 'USD', mixedCurrency: false, receivedToday: 0, receivedCount: 0 },
  outlook: { newLeads: { count: 0, people: [] }, quotesWaiting: { count: 0, people: [] }, quotesOut: { count: 0, people: [] } },
  isQuiet: false,
} as unknown as BriefingFacts;

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

/** The narrator makes one tracked call under the briefing's group, then answers. */
function narrationMakes(opts: { fail?: boolean; source: 'llm' | 'fallback'; calls?: number }) {
  mockNarrate.mockImplementation(async (facts: BriefingFacts, _language: string, userId: string) => {
    for (let i = 0; i < (opts.calls ?? 1); i++) {
      await provider
        .callWithTracking(
          buildBosCallContext({ userId, area: 'briefing', callName: 'daily_narration', groupId: bosBriefingGroupId(userId, facts.day.date) }),
          'openai',
          'gpt-test',
          'chat/completions',
          async () => {
            if (opts.fail) throw Object.assign(new Error(`timeout narrating ${OWNER_DATA}`), { code: 'timeout' });
            return {};
          },
          () => ({ inputTokens: 300, outputTokens: 60, cost: 0.0009 })
        )
        .catch(() => undefined);
    }
    return { narrative: `Today: ${OWNER_DATA} at 14:30`, source: opts.source };
  });
}

let savedPlatform: string | undefined;

beforeEach(() => {
  mockAuditLog.mockReset();
  mockAuditLog.mockResolvedValue(undefined);
  mockNarrate.mockReset();
  mockCached = null;
  savedPlatform = process.env.SYSTEM_ADMIN_USER_ID;
  process.env.SYSTEM_ADMIN_USER_ID = PLATFORM;
  resetPlatformActorForTests();
});

afterEach(() => {
  if (savedPlatform === undefined) delete process.env.SYSTEM_ADMIN_USER_ID;
  else process.env.SYSTEM_ADMIN_USER_ID = savedPlatform;
  resetPlatformActorForTests();
});

describe('getBriefing — the trigger is required (RC-8, WC-3)', () => {
  it('does not compile without a trigger', async () => {
    narrationMakes({ source: 'llm', calls: 0 });
    const noop = async () => {
      // @ts-expect-error: the trigger is a required argument, before businessType
      await getBriefing(OWNER, FACTS, 'en');
      // @ts-expect-error: businessType cannot take the trigger's place
      await getBriefing(OWNER, FACTS, 'en', { vertical: 'coach' });
    };
    expect(typeof noop).toBe('function');
  });
});

describe('getBriefing — one AI audit entry per narration (FR-11, AC-10)', () => {
  it('scheduled: the platform is the actor, trigger scheduled, grouped by the briefing day', async () => {
    narrationMakes({ source: 'llm' });
    const briefing = await getBriefing(OWNER, FACTS, 'en', 'scheduled', { vertical: 'coach' });
    expect(briefing.source).toBe('llm');

    expect(mockAuditLog).toHaveBeenCalledTimes(1);
    const entry = mockAuditLog.mock.calls[0][0];
    expect(entry).toMatchObject({
      action: 'BUSINESS_AI_ACTION_COMPLETED',
      entityType: 'ai_action',
      entityId: bosBriefingGroupId(OWNER, '2026-09-16'),
      userId: OWNER,
      actorId: PLATFORM,
      details: expect.objectContaining({ area: 'briefing', actionType: 'briefing_narration', trigger: 'scheduled', callCount: 1 }),
    });
    expect(JSON.stringify(entry)).not.toContain('CLIENT-NAME-MARKER-b4');
  });

  it('My Day: the owner is the actor, trigger user', async () => {
    narrationMakes({ source: 'llm' });
    await getBriefing(OWNER, FACTS, 'en', 'user');
    expect(mockAuditLog.mock.calls[0][0]).toMatchObject({
      userId: OWNER,
      actorId: OWNER,
      details: expect.objectContaining({ trigger: 'user' }),
    });
  });

  it('a same-day re-narration is a second entry in the same group', async () => {
    narrationMakes({ source: 'llm' });
    await getBriefing(OWNER, FACTS, 'en', 'user');
    // The facts changed, so the cached row (different hash) is not reused.
    mockCached = { facts_hash: 'stale', narrative: 'old', source: 'llm' };
    await getBriefing(OWNER, { ...FACTS, money: { ...FACTS.money, receivedToday: 500 } } as BriefingFacts, 'en', 'user');
    expect(mockAuditLog).toHaveBeenCalledTimes(2);
    expect(mockAuditLog.mock.calls[0][0].entityId).toBe(mockAuditLog.mock.calls[1][0].entityId);
  });

  it('a cached briefing makes no call and writes no entry', async () => {
    narrationMakes({ source: 'llm' });
    /*
     * The model is part of the fingerprint, so the expected key has to be built
     * the way `getBriefing` builds it — from the resolved setting, which this
     * suite pins to the code defaults above. Omitting it silently misses the
     * cache and the assertion below reads as a caching bug rather than a key
     * built two different ways.
     */
    const { model } = bosLlmCodeDefaults('briefing', 'daily_narration');
    mockCached = { facts_hash: hashFacts(FACTS, 'en', {}, model), narrative: 'cached words', source: 'llm' };
    const briefing = await getBriefing(OWNER, FACTS, 'en', 'user');
    expect(briefing.narrative).toBe('cached words');
    expect(mockNarrate).not.toHaveBeenCalled();
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  it('a fallback after a failed call is FAILED with briefing_fallback, and the briefing still returns', async () => {
    narrationMakes({ source: 'fallback', fail: true });
    const briefing = await getBriefing(OWNER, FACTS, 'en', 'scheduled');
    expect(briefing.source).toBe('fallback');
    const entry = mockAuditLog.mock.calls[0][0];
    expect(entry).toMatchObject({ action: 'BUSINESS_AI_ACTION_FAILED', details: expect.objectContaining({ errorCode: 'briefing_fallback', failedCallCount: 1 }) });
    expect(JSON.stringify(entry)).not.toContain('CLIENT-NAME-MARKER-b4');
  });

  it('a quiet day (fallback without any call) writes no entry', async () => {
    narrationMakes({ source: 'fallback', calls: 0 });
    await getBriefing(OWNER, FACTS, 'en', 'scheduled');
    expect(mockAuditLog).not.toHaveBeenCalled();
  });
});
