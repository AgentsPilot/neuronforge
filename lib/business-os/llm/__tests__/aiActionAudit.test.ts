/**
 * Business OS Layer 3, steps 1-2: the AI audit entry (FR-1 to FR-8, FR-16 to
 * FR-18; AC-1 to AC-7, AC-15 to AC-17; workplan T-E1 to T-E7, T-W1, T-W2, T-S1).
 *
 * Calls go through the REAL BaseAIProvider.callWithTracking and the real usage
 * scope; only the ledger tracker and AuditTrailService.log are faked. Nothing
 * here is wired into a route yet: that is steps 3-4.
 */

import * as fs from 'fs';
import * as path from 'path';

const mockLog = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrail: { log: (...args: unknown[]) => mockLog(...args) },
}));

const mockLogged: Array<{ level: string; fields: Record<string, unknown>; msg: string }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      logger[level] = (first: unknown, second?: unknown) => {
        const fields =
          typeof first === 'object' && first !== null
            ? JSON.parse(JSON.stringify(first, (_k, v) => (v instanceof Error ? { name: v.name, message: v.message } : v)))
            : {};
        mockLogged.push({ level, fields, msg: typeof first === 'string' ? first : String(second ?? '') });
      };
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import {
  buildAiAuditEntry,
  platformActorId,
  resetPlatformActorForTests,
  runAiAction,
  type AiActionSpec,
} from '../aiActionAudit';
import { buildBosCallContext, type BosLlmArea } from '../callCatalog';
import { BaseAIProvider } from '@/lib/ai/providers/baseProvider';
import type { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';
import { AUDIT_EVENTS, getEventMetadata } from '@/lib/audit/events';
import { AI_ACTION_ENTITY_TYPE, AI_ACTION_EVENT_PREFIX } from '@/lib/audit/requestSchemas';
import { ALL_ZERO_UUID } from '@/lib/platformAccount';

const OWNER = '2f734ed5-3681-4049-880d-3de7b096bea3';
const PLATFORM = '11111111-1111-4111-8111-111111111111';
const GROUP = '33333333-3333-4333-8333-333333333333';
const NESTED = '44444444-4444-4444-8444-444444444444';

const MARKER_PROMPT = 'PROMPT-MARKER-q1';
const MARKER_OWNER = 'OWNER-TEXT-MARKER-q2';
const MARKER_OUTPUT = 'MODEL-OUTPUT-MARKER-q3';
const MARKER_ERROR = 'ERROR-TEXT-MARKER-q4';

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
const provider = new TestProvider({ trackAICall: async () => undefined } as unknown as AIAnalyticsService);

interface CallOpts {
  area?: BosLlmArea;
  callName?: string;
  groupId?: string;
  fail?: boolean;
  tokens?: [number, number];
  cost?: number;
  model?: string;
  prompt?: string;
}

/** One LLM call through the real provider layer, attributed as a Business OS call. */
function llmCall(opts: CallOpts = {}): Promise<{ text: string }> {
  const area = opts.area ?? 'chat';
  // Test-only widening: the attribution type ties each call name to its area,
  // and these tests pick both at run time.
  const attribution = { userId: OWNER, area, callName: opts.callName ?? 'planner', groupId: opts.groupId ?? GROUP };
  const context = buildBosCallContext(attribution as Parameters<typeof buildBosCallContext>[0]);
  const [input, output] = opts.tokens ?? [100, 20];
  return provider.callWithTracking(
    context,
    'openai',
    opts.model ?? 'gpt-4o-mini',
    'chat/completions',
    async () => {
      void (opts.prompt ?? MARKER_PROMPT); // the prompt the "model" receives
      if (opts.fail) throw Object.assign(new Error(MARKER_ERROR), { code: 'rate_limit_exceeded' });
      return { text: `${MARKER_OUTPUT} answer` };
    },
    () => ({ inputTokens: input, outputTokens: output, cost: opts.cost ?? 0.001 })
  );
}

function spec(overrides: Partial<AiActionSpec> = {}): AiActionSpec {
  return { area: 'chat', actionType: 'chat_turn', groupId: GROUP, trigger: 'user', accountId: OWNER, ...overrides };
}

function onlyEntry() {
  expect(mockLog).toHaveBeenCalledTimes(1);
  return mockLog.mock.calls[0][0] as Record<string, unknown> & { details: Record<string, unknown> };
}

let savedPlatform: string | undefined;

beforeEach(() => {
  mockLog.mockReset();
  mockLog.mockResolvedValue(undefined);
  mockLogged.length = 0;
  savedPlatform = process.env.SYSTEM_ADMIN_USER_ID;
  process.env.SYSTEM_ADMIN_USER_ID = PLATFORM;
  resetPlatformActorForTests();
});

afterEach(() => {
  if (savedPlatform === undefined) delete process.env.SYSTEM_ADMIN_USER_ID;
  else process.env.SYSTEM_ADMIN_USER_ID = savedPlatform;
  resetPlatformActorForTests();
});

describe('one entry per action, with its totals (T-E1, AC-1)', () => {
  it('three calls produce exactly one log() call whose totals equal the three calls', async () => {
    const answer = await runAiAction(spec(), async () => {
      await llmCall({ callName: 'planner', tokens: [100, 20], cost: 0.001 });
      await llmCall({ callName: 'analysis', tokens: [300, 80], cost: 0.0025, model: 'gpt-4o' });
      await llmCall({ callName: 'plan_cache_lookup_embedding', tokens: [12, 0], cost: 0.0000024, model: 'text-embedding-3-small' });
      return 'the answer';
    });
    expect(answer).toBe('the answer');
    const entry = onlyEntry();
    expect(entry.details).toMatchObject({
      callCount: 3,
      failedCallCount: 0,
      inputTokens: 412,
      outputTokens: 100,
      totalTokens: 512,
      estimatedCostUsd: 0.003502,
      callNames: ['planner', 'analysis', 'plan_cache_lookup_embedding'],
      models: ['gpt-4o-mini', 'gpt-4o', 'text-embedding-3-small'],
      outcome: 'succeeded',
    });
  });

  // SA CR-2 / DV-10: the entry's cost is rounded to a micro-dollar, so it may
  // differ from the exact ledger sum by at most 5e-7. Tokens and counts are exact.
  it('matches the exact cost sum within 5e-7 when calls cost less than a micro-dollar (CR-2)', async () => {
    const costs = [0.00000013, 0.00000027, 0.00000041, 0.0012345678];
    await runAiAction(spec(), async () => {
      for (const cost of costs) {
        await llmCall({ callName: 'plan_cache_lookup_embedding', tokens: [7, 0], cost, model: 'text-embedding-3-small' });
      }
    });
    const details = onlyEntry().details as { estimatedCostUsd: number; inputTokens: number; outputTokens: number; callCount: number };
    const exact = costs.reduce((n, c) => n + c, 0);
    expect(Math.abs(details.estimatedCostUsd - exact)).toBeLessThanOrEqual(5e-7);
    expect(details.estimatedCostUsd).not.toBe(exact); // it IS rounded, so the tolerance is doing work
    expect(details.inputTokens).toBe(28);
    expect(details.outputTokens).toBe(0);
    expect(details.callCount).toBe(4);
  });

  it('leaves out a call made under another group (and a nested action writes its own entry)', async () => {
    await runAiAction(spec(), async () => {
      await llmCall();
      await runAiAction(spec({ area: 'website', actionType: 'chat_website_operation', groupId: NESTED }), async () => {
        await llmCall({ area: 'website', callName: 'landing_page', groupId: NESTED });
      });
      await llmCall({ groupId: NESTED }); // wired to the wrong group: excluded, warned
    });
    expect(mockLog).toHaveBeenCalledTimes(2);
    const [nested, turn] = mockLog.mock.calls.map((c) => c[0]);
    expect(nested.entityId).toBe(NESTED);
    expect(nested.details).toMatchObject({ area: 'website', areas: ['website'], callCount: 1 });
    expect(turn.entityId).toBe(GROUP);
    expect(turn.details).toMatchObject({ callCount: 1, callNames: ['planner'] });
    expect(mockLogged.some((l) => l.level === 'warn' && /different grouping id/.test(l.msg))).toBe(true);
  });
});

describe('events, entity and severity (T-E2, AC-2, AC-6, AC-17)', () => {
  it('registers the two events with info / warning and SOC2, never "Unknown event", never critical', () => {
    for (const [event, severity] of [
      [AUDIT_EVENTS.BUSINESS_AI_ACTION_COMPLETED, 'info'],
      [AUDIT_EVENTS.BUSINESS_AI_ACTION_FAILED, 'warning'],
    ] as const) {
      expect(event.startsWith(AI_ACTION_EVENT_PREFIX)).toBe(true);
      const meta = getEventMetadata(event);
      expect(meta.severity).toBe(severity);
      expect(meta.complianceFlags).toEqual(['SOC2']);
      expect(meta.description).not.toMatch(/^Unknown event/);
    }
  });

  it('uses entity ai_action with the grouping id, and passes no severity, flags, resource name, changes or request', async () => {
    await runAiAction(spec(), async () => llmCall());
    const entry = onlyEntry();
    expect(entry).toMatchObject({ action: 'BUSINESS_AI_ACTION_COMPLETED', entityType: AI_ACTION_ENTITY_TYPE, entityId: GROUP });
    for (const key of ['severity', 'complianceFlags', 'resourceName', 'changes', 'request']) {
      expect(entry).not.toHaveProperty(key);
    }
  });
});

describe('account and actor, with the poison-pill guard (T-E3, AC-3, RC-3)', () => {
  it('user trigger: account and actor are the owner', async () => {
    await runAiAction(spec(), async () => llmCall());
    expect(onlyEntry()).toMatchObject({ userId: OWNER, actorId: OWNER, details: expect.objectContaining({ trigger: 'user' }) });
  });

  it('scheduled trigger: account is the business, actor is the platform', async () => {
    await runAiAction(spec({ area: 'insights', actionType: 'insight_run', trigger: 'scheduled' }), async () =>
      llmCall({ area: 'insights', callName: 'insight_content' })
    );
    expect(onlyEntry()).toMatchObject({ userId: OWNER, actorId: PLATFORM, details: expect.objectContaining({ trigger: 'scheduled' }) });
  });

  it('a platform id that is not a UUID becomes the all-zero actor, with one warning per process (WC-9)', async () => {
    process.env.SYSTEM_ADMIN_USER_ID = 'not-a-uuid';
    resetPlatformActorForTests();
    expect(platformActorId()).toBe(ALL_ZERO_UUID);
    expect(platformActorId()).toBe(ALL_ZERO_UUID);
    expect(mockLogged.filter((l) => l.level === 'warn')).toHaveLength(1);
  });

  it('the account can be set once known (a route that authenticates inside the action)', async () => {
    await runAiAction(spec({ accountId: undefined }), async (h) => {
      h.setAccount(OWNER);
      await llmCall();
    });
    expect(onlyEntry().userId).toBe(OWNER);
  });

  it.each([
    ['a non-UUID account', { accountId: 'not-a-uuid' }],
    ['the platform account', { accountId: PLATFORM }],
    ['the all-zero account', { accountId: ALL_ZERO_UUID }],
    ['no account at all', { accountId: undefined }],
    ['a non-UUID grouping id', { groupId: 'turn-1' }],
  ])('writes nothing for %s, and logs an error naming area, action, group and account', async (_n, override) => {
    const s = spec(override);
    await runAiAction(s, async () => llmCall({ groupId: s.groupId }));
    expect(mockLog).not.toHaveBeenCalled();
    const error = mockLogged.find((l) => l.level === 'error');
    expect(error?.fields).toMatchObject({ area: 'chat', actionType: 'chat_turn', groupId: s.groupId });
    expect(error?.fields).toHaveProperty('accountId');
  });
});

describe('the fields (T-E4, AC-4) and privacy (T-E5, AC-5)', () => {
  it('details carries exactly the agreed keys', async () => {
    await runAiAction(spec({ correlationId: '7d2f0c1e-1111-4111-8111-222222222222' }), async () => llmCall());
    expect(Object.keys(onlyEntry().details).sort()).toEqual(
      [
        'schema', 'area', 'areas', 'actionType', 'groupId', 'trigger', 'callCount', 'failedCallCount',
        'inputTokens', 'outputTokens', 'totalTokens', 'estimatedCostUsd', 'callNames', 'models', 'outcome',
        'correlationId',
      ].sort()
    );
  });

  it('a failed entry adds only errorCode', async () => {
    await runAiAction(spec(), async () => {
      await llmCall({ fail: true }).catch(() => undefined);
    });
    const details = onlyEntry().details;
    expect(details.errorCode).toBe('rate_limit_exceeded');
    expect(Object.keys(details)).toHaveLength(16);
  });

  it('no prompt, owner text, model output or error text reaches the entry or any log line', async () => {
    const result = await runAiAction(spec({ correlationId: `${MARKER_OWNER} typed into a header` }), async () => {
      const ok = await llmCall({ prompt: `${MARKER_PROMPT} ${MARKER_OWNER}` });
      await llmCall({ callName: 'analysis', fail: true }).catch(() => undefined);
      await llmCall({ callName: 'analysis' }); // repaired
      return ok.text;
    });
    expect(result).toContain(MARKER_OUTPUT); // the action still returns its output

    const everything = JSON.stringify({ entries: mockLog.mock.calls, logs: mockLogged });
    for (const marker of [MARKER_PROMPT, MARKER_OWNER, MARKER_OUTPUT, MARKER_ERROR]) {
      expect(everything).not.toContain(marker);
    }
    expect(onlyEntry().details).not.toHaveProperty('correlationId'); // free text is never kept
  });

  it('multi-area actions: areas come from the calls, in catalog order; area is the declared one (WC-4)', async () => {
    await runAiAction(spec({ area: 'intake', actionType: 'onboarding_build' }), async () => {
      await llmCall({ area: 'intake', callName: 'form_generation' });
      await llmCall({ area: 'website', callName: 'full_site' });
    });
    // Called intake-second, listed in catalog order (website before intake).
    expect(onlyEntry().details).toMatchObject({ area: 'intake', areas: ['website', 'intake'] });
  });
});

describe('the outcome rule (T-E6, AC-6)', () => {
  it('a failed call that was repaired leaves the action COMPLETED, with failedCallCount 1', async () => {
    await runAiAction(spec(), async () => {
      await llmCall({ fail: true }).catch(() => undefined);
      await llmCall();
    });
    expect(onlyEntry()).toMatchObject({ action: 'BUSINESS_AI_ACTION_COMPLETED', details: expect.objectContaining({ failedCallCount: 1, outcome: 'succeeded' }) });
  });

  it('a call name whose last attempt failed makes it FAILED, with the code only', async () => {
    await runAiAction(spec(), async () => {
      await llmCall({ callName: 'planner' });
      await llmCall({ callName: 'analysis', fail: true }).catch(() => undefined);
    });
    expect(onlyEntry()).toMatchObject({
      action: 'BUSINESS_AI_ACTION_FAILED',
      details: expect.objectContaining({ outcome: 'failed', errorCode: 'rate_limit_exceeded' }),
    });
  });

  it('an action that throws after a call is FAILED, and the error still reaches the caller unchanged', async () => {
    const boom = Object.assign(new Error(`${MARKER_ERROR} with owner text`), { code: 'ECONNRESET' });
    await expect(
      runAiAction(spec(), async () => {
        await llmCall();
        throw boom;
      })
    ).rejects.toBe(boom);
    expect(onlyEntry()).toMatchObject({ action: 'BUSINESS_AI_ACTION_FAILED', details: expect.objectContaining({ errorCode: 'ECONNRESET' }) });
    expect(JSON.stringify(mockLog.mock.calls)).not.toContain(MARKER_ERROR);
  });

  it('a thrown error with no usable code records its class name, never its message', async () => {
    await runAiAction(spec(), async () => {
      await llmCall();
      throw new TypeError(`${MARKER_OWNER} broke it`);
    }).catch(() => undefined);
    expect(onlyEntry().details.errorCode).toBe('TypeError');
  });

  it('an action that signals a fallback is FAILED with that code', async () => {
    await runAiAction(spec({ area: 'briefing', actionType: 'briefing_narration', trigger: 'scheduled' }), async (h) => {
      await llmCall({ area: 'briefing', callName: 'daily_narration', fail: true }).catch(() => undefined);
      h.markFailed('briefing_fallback');
    });
    expect(onlyEntry()).toMatchObject({ action: 'BUSINESS_AI_ACTION_FAILED', details: expect.objectContaining({ errorCode: 'briefing_fallback' }) });
  });
});

describe('no LLM call, no entry (T-E7, AC-7)', () => {
  it('an action that made no call writes nothing, even if it failed', async () => {
    await runAiAction(spec(), async () => 'served from cache');
    await runAiAction(spec(), async () => {
      throw new Error('failed before any call');
    }).catch(() => undefined);
    await runAiAction(spec(), async (h) => h.markFailed('image_failed'));
    expect(mockLog).not.toHaveBeenCalled();
  });
});

describe('the write path (T-W1, T-W2, AC-15, AC-16)', () => {
  it('does not wait for the audit service', async () => {
    mockLog.mockReturnValue(new Promise(() => undefined)); // never settles
    await expect(runAiAction(spec(), async () => (await llmCall()).text)).resolves.toContain('answer');
    expect(mockLog).toHaveBeenCalledTimes(1);
  });

  it('a rejecting audit service never fails the action, and is logged with ids only', async () => {
    mockLog.mockRejectedValue(new Error('queue broken'));
    await expect(runAiAction(spec(), async () => (await llmCall()).text)).resolves.toContain('answer');
    await new Promise((r) => setImmediate(r));
    const error = mockLogged.find((l) => l.msg === 'AI audit entry could not be queued');
    expect(error?.fields).toMatchObject({ area: 'chat', actionType: 'chat_turn', groupId: GROUP, accountId: OWNER });
  });

  it('never awaits, flushes or modifies the audit service (T-S1, static)', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'aiActionAudit.ts'), 'utf8');
    expect(source).not.toMatch(/await\s+AuditTrail\.log\(/);
    expect(source).not.toMatch(/\b(flush|shutdown|auditFlush)\s*\(/);
    expect(source).toMatch(/void AuditTrail\.log\(entry\)\.catch\(/);
  });
});

describe('buildAiAuditEntry is pure', () => {
  it('builds the same entry for the same summary', () => {
    const summary = {
      spec: spec(),
      accountId: OWNER,
      actorId: OWNER,
      calls: [
        { feature: 'business-os-chat', component: 'planner', provider: 'openai', model: 'm', sessionId: GROUP, inputTokens: 1, outputTokens: 2, costUsd: 0.1, success: true },
        { feature: 'business-os-chat', component: 'planner', provider: 'openai', model: 'm', sessionId: GROUP, inputTokens: 1, outputTokens: 2, costUsd: 0.2, success: true },
      ],
    };
    expect(buildAiAuditEntry(summary)).toEqual(buildAiAuditEntry(summary));
    expect(buildAiAuditEntry(summary).details).toMatchObject({ estimatedCostUsd: 0.3 });
  });
});
