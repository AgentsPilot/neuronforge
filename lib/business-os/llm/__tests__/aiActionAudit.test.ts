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

// Slice 3b-ii: the recorder is REAL here; only its repository is faked, so no
// charge write can leave the process (SA Q-7 / SF-3).
const mockRecordCharge = jest.fn();
jest.mock('@/lib/repositories/BusinessOsCreditChargeRepository', () => ({
  businessOsCreditChargeRepository: { recordCharge: (...args: unknown[]) => mockRecordCharge(...args) },
}));
// Slice 8b (SA condition 4): setup only — the low-line hook is proven in the recorder's suite (NI-6 to NI-8).
jest.mock('@/lib/business-os/credits/creditLowLine', () => ({ checkCreditLowLine: jest.fn().mockResolvedValue(undefined) }));

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
  AI_ACTION_DECLARATIONS,
  buildAiAuditEntry,
  platformActorId,
  resetPlatformActorForTests,
  resolveActionFailure,
  runAiAction,
  type AiActionDeclaration,
  type AiActionHandle,
  type AiActionSpec,
  type AiActionType,
} from '../aiActionAudit';
import { BOS_LLM_AREAS, buildBosCallContext, type BosLlmArea } from '../callCatalog';
import * as chargeClassification from '../chargeClassification';
import * as chargePricing from '../chargePricing';
import * as aiChargeRecorder from '../aiChargeRecorder';
import { BOS_AI_CHARGE_WRITE_BUDGET_MS } from '../aiChargeRecorder';
import { BaseAIProvider } from '@/lib/ai/providers/baseProvider';
import type { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';
import { AUDIT_EVENTS, getEventMetadata } from '@/lib/audit/events';
import { AI_ACTION_ENTITY_TYPE, AI_ACTION_EVENT_PREFIX } from '@/lib/audit/requestSchemas';
import { ALL_ZERO_UUID } from '@/lib/platformAccount';
import { currentCreditValue } from '@/lib/business-os/entitlements/config/creditValue';

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
  mockRecordCharge.mockReset();
  mockRecordCharge.mockResolvedValue({ data: { recorded: true, periodStart: '2026-09-23T19:55:01.28632+00:00', anchorSource: 'plan' }, error: null });
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
      // 10 dp since deduction slice 2 (SQ-14): the 0.0000024 embedding is no longer rounded away.
      estimatedCostUsd: 0.0035024,
      callNames: ['planner', 'analysis', 'plan_cache_lookup_embedding'],
      models: ['gpt-4o-mini', 'gpt-4o', 'text-embedding-3-small'],
      outcome: 'succeeded',
    });
  });

  // SA CR-2 / DV-10, amended by deduction slice 2 (SQ-14): the entry's cost is
  // rounded to 10 decimal places, so it may differ from the exact ledger sum by
  // at most 5e-11. Tokens and counts are exact.
  it('matches the exact cost sum within 5e-11 when calls cost less than a micro-dollar (CR-2, SQ-14)', async () => {
    const costs = [0.00000013, 0.00000027, 0.00000041, 0.0012345678];
    await runAiAction(spec(), async () => {
      for (const cost of costs) {
        await llmCall({ callName: 'plan_cache_lookup_embedding', tokens: [7, 0], cost, model: 'text-embedding-3-small' });
      }
    });
    const details = onlyEntry().details as { estimatedCostUsd: number; inputTokens: number; outputTokens: number; callCount: number };
    const exact = costs.reduce((n, c) => n + c, 0);
    expect(Math.abs(details.estimatedCostUsd - exact)).toBeLessThanOrEqual(5e-11);
    // Every sub-micro-dollar call survives: a micro-dollar rounding would have stored 0.001236.
    expect(details.estimatedCostUsd).toBe(0.0012353778);
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
        'schema', 'actionId', 'area', 'areas', 'actionType', 'groupId', 'trigger', 'callCount', 'failedCallCount',
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
    // 17 since deduction slice 3a (`actionId`, SA-B1).
    expect(Object.keys(details)).toHaveLength(17);
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
      actionId: '55555555-5555-4555-8555-555555555555',
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

/**
 * Deduction layer slice 1 (FR-4): the per-type facts. The enforced guard is the
 * `satisfies Record<AiActionType, AiActionDeclaration>` under typecheck:bos-llm;
 * this block is a local/QA-only bonus (no CI job runs this suite).
 */
describe('AI_ACTION_DECLARATIONS', () => {
  // Widened on purpose so the runtime checks below see the declared shape, not
  // the narrowed literals (and no implicit any from Object.entries).
  const declarations: Record<AiActionType, AiActionDeclaration> = AI_ACTION_DECLARATIONS;
  const types = Object.keys(declarations) as AiActionType[];
  const typesWhere = (predicate: (d: AiActionDeclaration) => boolean): AiActionType[] =>
    types.filter((t) => predicate(declarations[t])).sort();

  it('declares exactly the members of the AiActionType union (source parse)', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'aiActionAudit.ts'), 'utf8');
    const start = source.indexOf('export type AiActionType =');
    expect(start).toBeGreaterThanOrEqual(0);
    const body = source.slice(start, source.indexOf(';', start));
    // Quoted literals only: two members carry trailing `// dormant (…)` comments.
    const members = Array.from(body.matchAll(/'([a-z_]+)'/g), (m) => m[1]);
    expect(members.length).toBeGreaterThanOrEqual(16);
    expect(new Set(members).size).toBe(members.length);
    expect([...types].sort()).toEqual([...members].sort());
  });

  it('every entry is well-formed', () => {
    const areas: readonly string[] = BOS_LLM_AREAS;
    for (const type of types) {
      const d = declarations[type];
      expect(areas).toContain(d.area);
      expect(['owner', 'client']).toContain(d.audience);
      expect(typeof d.isSetup).toBe('boolean');
      expect(typeof d.isCharged).toBe('boolean');
      for (const lang of ['en', 'he', 'es'] as const) {
        expect(d.diaryLabels[lang].trim().length).toBeGreaterThan(0);
      }
      expect(d.templateFallback === 'n/a').toBe(d.audience === 'owner');
    }
  });

  it('no two types share a label in any language', () => {
    for (const lang of ['en', 'he', 'es'] as const) {
      const labels = types.map((t) => declarations[t].diaryLabels[lang].trim().toLowerCase());
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  it('pins the known facts', () => {
    // SQ-12 + SA C-1: lead reply is the only client-facing type, and its no-AI fallback exists.
    expect(typesWhere((d) => d.audience === 'client')).toEqual(['lead_reply_recommendation']);
    expect(declarations.lead_reply_recommendation.templateFallback).toBe('exists');
    // KI-4: exactly the two dormant types.
    expect(typesWhere((d) => d.isDormant === true)).toEqual(['website_block_enrichment', 'website_section_field_rewrite']);
    // Option B: every action is charged.
    expect(typesWhere((d) => !d.isCharged)).toEqual([]);
    // Setup AI, by class.
    expect(typesWhere((d) => d.isSetup)).toEqual(
      ['intake_form_generation', 'onboarding_build', 'onboarding_turn', 'website_full_site'].sort()
    );
  });
});

/**
 * Deduction layer slice 2 (SQ-14, AC-29): the stored cost keeps small costs.
 * `schema: 2` since slice 3a (the action id); old entries are not backfilled.
 */
describe('the stored cost keeps sub-micro-dollar costs (slice 2, AC-29)', () => {
  it('a lone ~2e-7 USD embedding call stores a non-zero cost', async () => {
    await runAiAction(spec(), async () => {
      await llmCall({ callName: 'plan_cache_lookup_embedding', tokens: [10, 0], cost: 2.0000000000000002e-7, model: 'text-embedding-3-small' });
    });
    const details = onlyEntry().details as { estimatedCostUsd: number; schema: number };
    expect(details.estimatedCostUsd).toBe(0.0000002);
    expect(details.estimatedCostUsd).toBeGreaterThan(0);
    expect(details.schema).toBe(2);
  });

  it('a sub-micro-dollar action total is non-zero (a micro-dollar rounding stored 0)', async () => {
    await runAiAction(spec(), async () => {
      await llmCall({ callName: 'plan_cache_lookup_embedding', tokens: [7, 0], cost: 0.00000013, model: 'text-embedding-3-small' });
      await llmCall({ callName: 'plan_cache_lookup_embedding', tokens: [7, 0], cost: 0.00000027, model: 'text-embedding-3-small' });
    });
    expect((onlyEntry().details as { estimatedCostUsd: number }).estimatedCostUsd).toBe(0.0000004);
  });

  it('still clears float noise', async () => {
    await runAiAction(spec(), async () => {
      await llmCall({ cost: 0.1 });
      await llmCall({ callName: 'analysis', cost: 0.2 });
    });
    expect((onlyEntry().details as { estimatedCostUsd: number }).estimatedCostUsd).toBe(0.3);
  });
});

/**
 * Deduction layer slice 2 (AC-3, SA Q-1, S-1): `runAiAction` makes an unpriced
 * call fail loudly, after the entry is queued, in its own try.
 */
describe('unpriced calls fail loudly (slice 2, AC-3)', () => {
  afterEach(() => jest.restoreAllMocks());

  const unpricedErrors = () => mockLogged.filter((l) => l.level === 'error' && l.fields.event === 'bos_llm_call_unpriced');

  it('logs one error per unpriced call, naming provider, model, area, action, group and account', async () => {
    await runAiAction(spec(), async () => {
      await llmCall({ callName: 'planner', model: 'gpt-imaginary', cost: 0 });
      await llmCall({ callName: 'analysis', cost: 0.001 });
    });
    const errors = unpricedErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0].fields).toEqual({
      event: 'bos_llm_call_unpriced',
      provider: 'openai',
      model: 'gpt-imaginary',
      area: 'chat',
      actionType: 'chat_turn',
      groupId: GROUP,
      accountId: OWNER,
      callName: 'planner',
      kind: 'text',
      reason: 'unpriced_on_recheck',
    });
    // The records disagree VISIBLY: the entry still stores the measured $0 (SQ-13).
    expect(onlyEntry().details).toMatchObject({ estimatedCostUsd: 0.001, schema: 2 });
  });

  it('is silent for an action whose calls are all priced or failed', async () => {
    await runAiAction(spec(), async () => {
      await llmCall();
      await llmCall({ callName: 'analysis', fail: true }).catch(() => undefined);
    });
    expect(unpricedErrors()).toHaveLength(0);
  });

  it('a throwing check changes neither the value nor the queued entry', async () => {
    jest.spyOn(chargeClassification, 'reportUnpricedCalls').mockImplementation(() => {
      throw new Error('classifier exploded');
    });
    await expect(runAiAction(spec(), async () => (await llmCall()).text)).resolves.toContain('answer');
    expect(mockLog).toHaveBeenCalledTimes(1);
    expect(mockLogged.some((l) => l.level === 'error' && l.msg === 'Checking the AI action for unpriced calls failed')).toBe(true);
  });

  it('a throwing check does not change the error the action throws, and the entry is still queued', async () => {
    jest.spyOn(chargeClassification, 'reportUnpricedCalls').mockImplementation(() => {
      throw new Error('classifier exploded');
    });
    const boom = new Error('action failed');
    await expect(
      runAiAction(spec(), async () => {
        await llmCall();
        throw boom;
      })
    ).rejects.toBe(boom);
    expect(mockLog).toHaveBeenCalledTimes(1);
  });

  it('runs after the entry is queued (a fault in it can never skip the entry)', async () => {
    const order: string[] = [];
    mockLog.mockImplementation(async () => {
      order.push('audit');
    });
    jest.spyOn(chargeClassification, 'reportUnpricedCalls').mockImplementation(() => {
      order.push('check');
    });
    await runAiAction(spec(), async () => llmCall());
    expect(order).toEqual(['audit', 'check']);
  });
});

/**
 * Deduction layer slice 3a (SA-B1, FR-9): one action id per invocation, carried
 * by the entry as `details.actionId` with `schema: 2`. `entityId` stays the
 * grouping id. The outcome is decided once, by `resolveActionFailure`.
 */
describe('one action id per invocation (slice 3a, SA-B1)', () => {
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const detailsOf = (n: number) => (mockLog.mock.calls[n][0] as { details: { actionId: string; schema: number } }).details;

  it('the entry carries schema 2 and a UUID action id, and entityId stays the grouping id', async () => {
    await runAiAction(spec(), async () => llmCall());
    const entry = onlyEntry();
    expect(entry.details.schema).toBe(2);
    expect(entry.details.actionId).toMatch(UUID_V4);
    expect(entry.details.actionId).not.toBe(GROUP);
    expect(entry.entityId).toBe(GROUP);
    expect(entry.details.groupId).toBe(GROUP);
  });

  it('two invocations with the same group write two entries with two different action ids (AC-8, FR-9)', async () => {
    await runAiAction(spec(), async () => llmCall());
    await runAiAction(spec(), async () => llmCall());
    expect(mockLog).toHaveBeenCalledTimes(2);
    const [first, second] = [detailsOf(0), detailsOf(1)];
    expect(first.actionId).toMatch(UUID_V4);
    expect(second.actionId).toMatch(UUID_V4);
    expect(first.actionId).not.toBe(second.actionId);
    expect(mockLog.mock.calls.map((c) => c[0].entityId)).toEqual([GROUP, GROUP]);
  });

  it('a nested action mints its own id', async () => {
    await runAiAction(spec(), async () => {
      await llmCall();
      await runAiAction(spec({ area: 'website', actionType: 'chat_website_operation', groupId: NESTED }), async () => {
        await llmCall({ area: 'website', callName: 'landing_page', groupId: NESTED });
      });
    });
    expect(mockLog).toHaveBeenCalledTimes(2);
    const [nested, outer] = [detailsOf(0), detailsOf(1)];
    expect(nested.actionId).not.toBe(outer.actionId);
  });

  it('the id is not exposed on the handle: no call site needs it', async () => {
    await runAiAction(spec(), async (h) => {
      expect(Object.keys(h).sort()).toEqual(['markFailed', 'setAccount']);
      await llmCall();
    });
  });
});

describe('resolveActionFailure decides the outcome once (slice 3a)', () => {
  const call = (component: string, success: boolean, errorCode?: string) => ({
    feature: 'business-os-chat', component, provider: 'openai', model: 'm', sessionId: GROUP,
    inputTokens: 1, outputTokens: 1, costUsd: 0.001, success, ...(errorCode ? { errorCode } : {}),
  });

  it('a signalled code wins over a throw and over the calls', () => {
    expect(resolveActionFailure([call('planner', false, 'rate_limit_exceeded')], 'briefing_fallback', { error: { code: 'ECONNRESET' } }))
      .toEqual({ code: 'briefing_fallback' });
  });

  it('a throw wins over the calls, and records a code, never the message', () => {
    expect(resolveActionFailure([call('planner', true)], undefined, { error: Object.assign(new Error(MARKER_ERROR), { code: 'ECONNRESET' }) }))
      .toEqual({ code: 'ECONNRESET' });
  });

  it('otherwise the last-attempt rule: a repaired call succeeds, an unrepaired one fails', () => {
    expect(resolveActionFailure([call('planner', false, 'x'), call('planner', true)], undefined, undefined)).toBeUndefined();
    expect(resolveActionFailure([call('planner', true), call('analysis', false, 'rate_limit_exceeded')], undefined, undefined))
      .toEqual({ code: 'rate_limit_exceeded' });
  });

  it('agrees with the entry runAiAction writes', async () => {
    await runAiAction(spec(), async () => {
      await llmCall({ callName: 'planner' });
      await llmCall({ callName: 'analysis', fail: true }).catch(() => undefined);
    });
    expect(onlyEntry().details).toMatchObject({ outcome: 'failed', errorCode: 'rate_limit_exceeded' });
  });
});

/**
 * Deduction layer slice 3b-ii: the charge, written at the end of every action
 * through the REAL recorder, with only the repository faked (workplan §3.7,
 * §3.8; FR-8, FR-13, FR-15, FR-16; AC-8, AC-12; SA N-7, NI-1 to NI-4).
 */
describe('the charge (slice 3b-ii)', () => {
  type Charge = Record<string, unknown> & { actionId: string; outcome: string };
  const chargeOf = (n = 0) => mockRecordCharge.mock.calls[n][0] as Charge;
  const detailsOf = (n = 0) => (mockLog.mock.calls[n][0] as { details: Record<string, unknown> }).details;
  const chargeErrors = () =>
    mockLogged.filter((l) => l.level === 'error' && String(l.fields.event ?? '').startsWith('bos_ai_charge_'));
  const hang = () => new Promise(() => undefined);

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('what is written', () => {
    it('one charge per action, service "ai", joined to the audit entry by the action id (C-6)', async () => {
      await runAiAction(spec(), async () => llmCall());
      expect(mockRecordCharge).toHaveBeenCalledTimes(1);
      expect(chargeOf()).toMatchObject({
        actionId: detailsOf().actionId,
        accountId: OWNER,
        groupId: GROUP,
        service: 'ai',
        actionType: 'chat_turn',
        trigger: 'owner',
        outcome: 'succeeded',
        credits: 1,
        costUsd: 0.001,
        creditValueVersion: currentCreditValue().version,
        isFallbackPriced: false,
      });
    });

    const outcomes: Array<[string, (h: AiActionHandle) => Promise<unknown>]> = [
      ['all succeeded', async () => llmCall()],
      [
        'a repaired call',
        async () => {
          await llmCall({ fail: true }).catch(() => undefined);
          await llmCall();
        },
      ],
      [
        'an unrepaired call',
        async () => {
          await llmCall();
          await llmCall({ callName: 'analysis', fail: true }).catch(() => undefined);
        },
      ],
      [
        'a signalled fallback',
        async (h) => {
          await llmCall();
          h.markFailed('briefing_fallback');
        },
      ],
      [
        'a throw after a call',
        async () => {
          await llmCall();
          throw Object.assign(new Error(MARKER_ERROR), { code: 'ECONNRESET' });
        },
      ],
    ];

    it.each(outcomes)('the charge and the entry never disagree on the outcome, through runAiAction (N-7): %s', async (_n, action) => {
      await runAiAction(spec(), action).catch(() => undefined);
      expect(chargeOf().outcome).toBe(detailsOf().outcome);
      expect(chargeOf().actionId).toBe(detailsOf().actionId);
    });

    it('a failed action is charged the calls it made, written BEFORE its error is rethrown (FR-8)', async () => {
      const boom = new Error('action failed');
      let chargedBeforeRethrow = false;
      await runAiAction(spec(), async () => {
        await llmCall({ cost: 0.002 });
        throw boom;
      }).catch((err) => {
        expect(err).toBe(boom);
        chargedBeforeRethrow = mockRecordCharge.mock.calls.length === 1;
      });
      expect(chargedBeforeRethrow).toBe(true);
      expect(chargeOf()).toMatchObject({ outcome: 'failed', costUsd: 0.002, credits: 2 });
    });

    it('a scheduled action is charged to the business with trigger "scheduled" (AC-9, FR-10)', async () => {
      await runAiAction(spec({ area: 'insights', actionType: 'insight_run', trigger: 'scheduled' }), async () =>
        llmCall({ area: 'insights', callName: 'detector_narrative' })
      );
      expect(chargeOf()).toMatchObject({ accountId: OWNER, trigger: 'scheduled', actionType: 'insight_run' });
    });

    it('two invocations with one group are two charges with two action ids (AC-8)', async () => {
      await runAiAction(spec(), async () => llmCall());
      await runAiAction(spec(), async () => llmCall());
      expect(mockRecordCharge).toHaveBeenCalledTimes(2);
      expect([chargeOf(0).groupId, chargeOf(1).groupId]).toEqual([GROUP, GROUP]);
      expect(chargeOf(0).actionId).not.toBe(chargeOf(1).actionId);
    });

    it('a nested action is charged on its own; the parent is not charged for its calls', async () => {
      await runAiAction(spec(), async () => {
        await llmCall({ cost: 0.001 });
        await runAiAction(spec({ area: 'website', actionType: 'chat_website_operation', groupId: NESTED }), async () => {
          await llmCall({ area: 'website', callName: 'landing_page', groupId: NESTED, cost: 0.004 });
        });
      });
      expect(mockRecordCharge).toHaveBeenCalledTimes(2);
      const [nested, outer] = [chargeOf(0), chargeOf(1)];
      expect(nested).toMatchObject({ groupId: NESTED, costUsd: 0.004, actionId: detailsOf(0).actionId });
      expect(outer).toMatchObject({ groupId: GROUP, costUsd: 0.001, actionId: detailsOf(1).actionId });
    });

    it('invalid identities: no charge, one bos_ai_charge_not_written (FR-16, N-3)', async () => {
      await runAiAction(spec({ accountId: PLATFORM }), async () => llmCall());
      expect(mockRecordCharge).not.toHaveBeenCalled();
      expect(chargeErrors()).toHaveLength(1);
      expect(chargeErrors()[0].fields).toMatchObject({ event: 'bos_ai_charge_not_written', reason: 'invalid_identity' });
    });

    it('reads isCharged from the declaration (FR-4)', async () => {
      const declaration = AI_ACTION_DECLARATIONS.chat_turn as { isCharged: boolean };
      declaration.isCharged = false;
      try {
        await runAiAction(spec(), async () => llmCall());
      } finally {
        declaration.isCharged = true;
      }
      expect(mockRecordCharge).not.toHaveBeenCalled();
      expect(mockLog).toHaveBeenCalledTimes(1); // the entry is unaffected
    });

    it.each(['off', 'shadow', 'enforce', undefined])(
      'is recorded whatever the entitlements mode (%s): a charge measures, it decides nothing (Q-4)',
      async (mode) => {
        const saved = process.env.BOS_ENTITLEMENTS_MODE;
        if (mode === undefined) delete process.env.BOS_ENTITLEMENTS_MODE;
        else process.env.BOS_ENTITLEMENTS_MODE = mode;
        try {
          await runAiAction(spec(), async () => llmCall());
        } finally {
          if (saved === undefined) delete process.env.BOS_ENTITLEMENTS_MODE;
          else process.env.BOS_ENTITLEMENTS_MODE = saved;
        }
        expect(mockRecordCharge).toHaveBeenCalledTimes(1);
      }
    );

    it('a fallback-priced action: one info per charge, and still exactly one bos_llm_call_unpriced error per call (S2 N-4)', async () => {
      await runAiAction(spec(), async () => llmCall({ model: 'gpt-imaginary', cost: 0 }));
      expect(chargeOf().isFallbackPriced).toBe(true);
      expect(mockLogged.filter((l) => l.fields.event === 'bos_llm_call_unpriced')).toHaveLength(1);
      const info = mockLogged.filter((l) => l.fields.event === 'bos_ai_charge_fallback_priced');
      expect(info).toHaveLength(1);
      expect(info[0]).toMatchObject({ level: 'info', fields: { fallbackCallCount: 1, actionId: detailsOf().actionId } });
    });
  });

  describe('ordering (AC-12, FR-15)', () => {
    it('audit → unpriced check → charge', async () => {
      const order: string[] = [];
      mockLog.mockImplementation(async () => {
        order.push('audit');
      });
      jest.spyOn(chargeClassification, 'reportUnpricedCalls').mockImplementation(() => {
        order.push('check');
      });
      mockRecordCharge.mockImplementation(async () => {
        order.push('charge');
        return { data: { recorded: true, periodStart: 'p', anchorSource: 'plan' }, error: null };
      });
      await runAiAction(spec(), async () => llmCall());
      expect(order).toEqual(['audit', 'check', 'charge']);
    });

    it('with the audit queue failing, the charge is still written (AC-12, first half)', async () => {
      mockLog.mockRejectedValue(new Error('queue broken'));
      await runAiAction(spec(), async () => llmCall());
      expect(mockRecordCharge).toHaveBeenCalledTimes(1);
    });

    it('with the audit queue hanging, the charge is still written and the action still returns', async () => {
      mockLog.mockReturnValue(hang());
      await expect(runAiAction(spec(), async () => (await llmCall()).text)).resolves.toContain('answer');
      expect(mockRecordCharge).toHaveBeenCalledTimes(1);
    });

    it('with the charge failing, the action succeeds, the entry is queued, and one error names the ids (AC-12, second half)', async () => {
      mockRecordCharge.mockResolvedValue({ data: null, error: Object.assign(new Error('x'), { code: '42501' }) });
      await expect(runAiAction(spec(), async () => (await llmCall()).text)).resolves.toContain('answer');
      expect(mockLog).toHaveBeenCalledTimes(1);
      expect(chargeErrors()).toHaveLength(1);
      expect(chargeErrors()[0].fields).toMatchObject({
        event: 'bos_ai_charge_write_failed',
        reason: 'db_error',
        accountId: OWNER,
        area: 'chat',
        actionType: 'chat_turn',
        groupId: GROUP,
        actionId: detailsOf().actionId,
      });
    });
  });

  describe('non-interference (SQ-11 condition 1, workplan §3.8)', () => {
    const VALUE = { answer: 42 };

    const faults: Array<[string, () => void]> = [
      [
        'the repository throws synchronously',
        () =>
          mockRecordCharge.mockImplementation(() => {
            throw new Error('sync');
          }),
      ],
      ['the repository rejects', () => mockRecordCharge.mockRejectedValue(new Error('rejected'))],
      ['the repository returns an error', () => mockRecordCharge.mockResolvedValue({ data: null, error: new Error('db') })],
      [
        'the builder throws (a pricing-table defect)',
        () => {
          jest.spyOn(chargePricing, 'priceActionForCharge').mockImplementation(() => {
            throw new Error('rates');
          });
        },
      ],
      [
        'the recorder itself throws',
        () => {
          jest.spyOn(aiChargeRecorder, 'recordAiCharge').mockImplementation(() => {
            throw new Error('recorder');
          });
        },
      ],
      [
        'the recorder itself rejects',
        () => {
          jest.spyOn(aiChargeRecorder, 'recordAiCharge').mockRejectedValue(new Error('recorder'));
        },
      ],
    ];

    it.each(faults)('NI-1: %s → the same value reference, the entry queued once, one error', async (_n, arrange) => {
      arrange();
      const value = await runAiAction(spec(), async () => {
        await llmCall();
        return VALUE;
      });
      expect(value).toBe(VALUE);
      expect(mockLog).toHaveBeenCalledTimes(1);
      expect(chargeErrors()).toHaveLength(1);
    });

    it.each(faults)('NI-1: %s → the same error object rethrown', async (_n, arrange) => {
      arrange();
      const boom = new Error('the action failed');
      await expect(
        runAiAction(spec(), async () => {
          await llmCall();
          throw boom;
        })
      ).rejects.toBe(boom);
      expect(mockLog).toHaveBeenCalledTimes(1);
    });

    it('NI-2: a write that never settles delays the action by the budget, no more; the call is aborted; no timer left', async () => {
      jest.useFakeTimers();
      let signal: AbortSignal | undefined;
      mockRecordCharge.mockImplementation((_c: unknown, o: { signal: AbortSignal }) => {
        signal = o.signal;
        return hang();
      });
      let result: unknown;
      const run = runAiAction(spec(), async () => {
        await llmCall();
        return VALUE;
      }).then((v) => {
        result = v;
      });
      await jest.advanceTimersByTimeAsync(BOS_AI_CHARGE_WRITE_BUDGET_MS - 1);
      expect(result).toBeUndefined();
      await jest.advanceTimersByTimeAsync(1);
      await run;
      expect(result).toBe(VALUE);
      expect(signal?.aborted).toBe(true);
      expect(chargeErrors()).toHaveLength(1);
      expect(chargeErrors()[0].fields).toMatchObject({ reason: 'timeout', fate: 'unknown' });
      expect(jest.getTimerCount()).toBe(0);
    });

    it('NI-3: succeed, fail and hang give deep-equal results and deep-equal entries (apart from the per-invocation id)', async () => {
      const results: unknown[] = [];
      const entries: unknown[] = [];
      const arrangements: Array<() => void> = [
        () => undefined,
        () => mockRecordCharge.mockResolvedValue({ data: null, error: new Error('db') }),
        () => mockRecordCharge.mockImplementation(() => hang()),
      ];
      jest.useFakeTimers();
      for (const arrange of arrangements) {
        mockLog.mockClear();
        arrange();
        const run = runAiAction(spec(), async () => ({ text: (await llmCall()).text, n: [1, 2] }));
        await jest.advanceTimersByTimeAsync(BOS_AI_CHARGE_WRITE_BUDGET_MS);
        results.push(await run);
        const entry = mockLog.mock.calls[0][0] as { details: Record<string, unknown> };
        entries.push({ ...entry, details: { ...entry.details, actionId: '<per invocation>' } });
      }
      expect(results[1]).toEqual(results[0]);
      expect(results[2]).toEqual(results[0]);
      expect(entries[1]).toEqual(entries[0]);
      expect(entries[2]).toEqual(entries[0]);
    });

    it('NI-4: an action with no call writes nothing, calls no recorder and creates no timer', async () => {
      jest.useFakeTimers();
      const recorder = jest.spyOn(aiChargeRecorder, 'recordAiCharge');
      await expect(runAiAction(spec(), async () => 'served from cache')).resolves.toBe('served from cache');
      await runAiAction(spec(), async () => {
        throw new Error('before any call');
      }).catch(() => undefined);
      expect(recorder).not.toHaveBeenCalled();
      expect(mockRecordCharge).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  it('the charge is the only awaited write, made in one place, never through the repository directly (static)', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'aiActionAudit.ts'), 'utf8');
    expect(source.match(/await recordAiChargeSafely\(/g)).toHaveLength(1);
    expect(source.match(/await recordAiCharge\(/g)).toHaveLength(1);
    expect(source).not.toMatch(/businessOsCreditChargeRepository|BusinessOsCreditChargeRepository/);
  });
});
