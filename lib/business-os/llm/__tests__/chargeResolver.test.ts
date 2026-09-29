/**
 * Business OS credit deduction, slice 3a: the one cost → credits conversion and
 * the charge record builder (workplan §2.3 rules 1-5; FR-2, FR-4 to FR-8,
 * FR-10 to FR-13; AC-5 storage half, AC-6, AC-7, AC-10, AC-11, AC-30; SQ-8).
 *
 * Pricing is slice 2's real `priceActionForCharge`; only the logger, the audit
 * service (reached through `aiActionAudit`) and the DB price loader are faked.
 */

import * as fs from 'fs';
import * as path from 'path';

const mockLogged: Array<{ level: string; fields: Record<string, unknown>; msg: string }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      logger[level] = (first: unknown, second?: unknown) => {
        const fields = typeof first === 'object' && first !== null ? (first as Record<string, unknown>) : {};
        mockLogged.push({ level, fields, msg: typeof first === 'string' ? first : String(second ?? '') });
      };
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

jest.mock('@/lib/services/AuditTrailService', () => ({ AuditTrail: { log: jest.fn() } }));

jest.mock('@/lib/repositories/AiModelPricingRepository', () => ({
  aiModelPricingRepository: { listActive: jest.fn().mockResolvedValue({ data: [], error: null }) },
}));

import type { UsageCallRecord } from '@/lib/ai/usageScope';
import { CREDIT_VALUE_HISTORY, currentCreditValue } from '@/lib/business-os/entitlements/config/creditValue';
import { ALL_ZERO_UUID } from '@/lib/platformAccount';
import {
  AI_ACTION_DECLARATIONS,
  buildAiAuditEntry,
  resetPlatformActorForTests,
  resolveActionFailure,
  validateIdentities,
  type AiActionSpec,
  type AiTrigger,
} from '../aiActionAudit';
import * as chargePricing from '../chargePricing';
import {
  buildAiChargeRecord,
  resetCreditValueLogForTests,
  resolveActionCharge,
  toChargeTrigger,
  type AiChargeRecord,
  type AiChargeRecordInput,
} from '../chargeResolver';

const OWNER = '2f734ed5-3681-4049-880d-3de7b096bea3';
const PLATFORM = '11111111-1111-4111-8111-111111111111';
const GROUP = '33333333-3333-4333-8333-333333333333';
const ACTION = '55555555-5555-4555-8555-555555555555';

const PRICED = { status: 'priced', unit: 'token' } as const;

function rec(overrides: Partial<UsageCallRecord> = {}): UsageCallRecord {
  return {
    feature: 'business-os-chat',
    component: 'planner',
    provider: 'openai',
    model: 'gpt-4o-mini',
    sessionId: GROUP,
    inputTokens: 100,
    outputTokens: 20,
    costUsd: 0.001,
    success: true,
    pricing: PRICED,
    ...overrides,
  };
}

/** A plan-cache lookup embedding: ~2e-7 USD. */
const EMBEDDING = rec({
  component: 'plan_cache_lookup_embedding',
  model: 'text-embedding-3-small',
  inputTokens: 10,
  outputTokens: 0,
  costUsd: 2.0000000000000002e-7,
});

function spec(overrides: Partial<AiActionSpec> = {}): AiActionSpec {
  return { area: 'chat', actionType: 'chat_turn', groupId: GROUP, trigger: 'user', accountId: OWNER, ...overrides };
}

/**
 * The builder takes identities `runAiAction` already validated (SA C-5); the
 * tests validate them the same way, with the one rule, so rule 3's cases below
 * still speak of accounts rather than of a pre-made `null`.
 */
function input(
  overrides: Partial<AiChargeRecordInput> & { accountId?: string | undefined } = {}
): AiChargeRecordInput {
  const { accountId: _ignored, ...rest } = overrides;
  // An explicit `accountId: undefined` means "no account", not "the default".
  const accountId = 'accountId' in overrides ? overrides.accountId : OWNER;
  const s = rest.spec ?? spec();
  return {
    spec: s,
    actionId: ACTION,
    identities: validateIdentities(s, accountId),
    isCharged: AI_ACTION_DECLARATIONS[s.actionType].isCharged,
    calls: [rec()],
    failure: undefined,
    ...rest,
  };
}

/** The record, or a failure naming the skip reason. */
function recordOf(result: ReturnType<typeof buildAiChargeRecord>): AiChargeRecord {
  if (!('record' in result)) throw new Error(`expected a record, got skipped: ${result.skipped}`);
  return result.record;
}

let savedPlatform: string | undefined;

beforeEach(() => {
  mockLogged.length = 0;
  resetCreditValueLogForTests();
  savedPlatform = process.env.SYSTEM_ADMIN_USER_ID;
  process.env.SYSTEM_ADMIN_USER_ID = PLATFORM;
  resetPlatformActorForTests();
});

afterEach(() => {
  jest.restoreAllMocks();
  if (savedPlatform === undefined) delete process.env.SYSTEM_ADMIN_USER_ID;
  else process.env.SYSTEM_ADMIN_USER_ID = savedPlatform;
  resetPlatformActorForTests();
});

describe('resolveActionCharge: the one conversion (FR-2, SQ-8)', () => {
  const USD_PER_CREDIT = currentCreditValue().usdPerCredit;

  it('uses the current credit value, version 0 today', () => {
    expect(resolveActionCharge([rec()])).toMatchObject({ creditValueVersion: CREDIT_VALUE_HISTORY.length - 1 });
    expect(resolveActionCharge([rec()]).creditValueVersion).toBe(0);
  });

  it('a lone ~2e-7 USD embedding is 0.0002 credits at v0: non-zero, and not rounded up to 1 (AC-5 storage)', () => {
    const charge = resolveActionCharge([EMBEDDING]);
    expect(charge.costUsd).toBe(0.0000002);
    expect(charge.credits).toBe(0.0002);
    expect(charge.credits).toBeGreaterThan(0);
    expect(charge.isFallbackPriced).toBe(false);
  });

  it('cost is rounded to 10 dp and credits to 6 dp, credits from the UNROUNDED cost', () => {
    // 0.00000000014 + 0.00000000014 = 2.8e-10 → 10 dp keeps 3e-10; credits from the raw 2.8e-10 → 2.8e-7 → 0 at 6 dp.
    const tiny = [rec({ costUsd: 1.4e-10 }), rec({ component: 'analysis', costUsd: 1.4e-10 })];
    const charge = resolveActionCharge(tiny);
    expect(charge.costUsd).toBe(3e-10);
    expect(charge.credits).toBe(0);

    const odd = resolveActionCharge([rec({ costUsd: 0.00123456789012 })]);
    expect(odd.costUsd).toBe(0.0012345679);
    expect(odd.credits).toBe(1.234568);
    expect(odd.credits).toBe(Math.round((0.00123456789012 / USD_PER_CREDIT) * 1e6) / 1e6);
  });

  it('clears float noise: 0.1 + 0.2 USD is 0.3 USD and 300 credits', () => {
    const charge = resolveActionCharge([rec({ costUsd: 0.1 }), rec({ component: 'analysis', costUsd: 0.2 })]);
    expect(charge.costUsd).toBe(0.3);
    expect(charge.credits).toBe(300);
  });

  it('a call with no usable price is charged the conservative figure and flagged (FR-12b)', () => {
    const unpriced = rec({ model: 'gpt-imaginary', costUsd: 0, pricing: { status: 'unpriced', unit: 'token' } });
    const priced = chargePricing.priceActionForCharge([unpriced, rec()]);
    const charge = resolveActionCharge([unpriced, rec()]);
    expect(charge.isFallbackPriced).toBe(true);
    expect(charge.fallbackCallCount).toBe(1);
    expect(priced.costUsd).toBeGreaterThan(0.001); // the conservative rate is charged, not the recorded 0
    expect(charge.costUsd).toBe(Math.round(priced.costUsd * 1e10) / 1e10);
    expect(charge.credits).toBe(Math.round((priced.costUsd / USD_PER_CREDIT) * 1e6) / 1e6);
  });

  it('adds no log for an unpriced call: bos_llm_call_unpriced stays the one event (S2 N-4)', () => {
    resolveActionCharge([rec({ model: 'gpt-imaginary', costUsd: 0, pricing: { status: 'unpriced', unit: 'token' } })]);
    expect(mockLogged.filter((l) => l.level === 'error' || l.level === 'warn')).toEqual([]);
  });

  it('logs the active credit value once per process, at info (SA-S6)', () => {
    resolveActionCharge([rec()]);
    resolveActionCharge([rec()]);
    buildAiChargeRecord(input());
    const active = mockLogged.filter((l) => l.fields.event === 'bos_credit_value_active');
    expect(active).toHaveLength(1);
    expect(active[0].level).toBe('info');
    expect(active[0].fields).toEqual({ event: 'bos_credit_value_active', version: 0, usdPerCredit: 0.001, status: 'provisional' });
  });
});

describe('toChargeTrigger (FR-10, SQ-15 (3))', () => {
  it.each([
    ['user', 'owner'],
    ['scheduled', 'scheduled'],
    ['external', 'external'],
  ] as const)('%s → %s', (trigger, expected) => {
    expect(toChargeTrigger(trigger as AiTrigger)).toBe(expected);
  });
});

describe('buildAiChargeRecord: the rules, in order (§2.3)', () => {
  it('rule 1: no calls → no_calls, and no pricing is done (FR-7, AC-6: an image served from the reuse cache)', () => {
    const spy = jest.spyOn(chargePricing, 'priceActionForCharge');
    expect(buildAiChargeRecord(input({ calls: [] }))).toEqual({ skipped: 'no_calls' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('rule 2: an action type declared not charged → not_charged (FR-4), before the identities are looked at', () => {
    expect(buildAiChargeRecord(input({ isCharged: false }))).toEqual({ skipped: 'not_charged' });
    expect(buildAiChargeRecord(input({ isCharged: false, identities: null }))).toEqual({ skipped: 'not_charged' });
  });

  it('every action type is charged today (all 16 isCharged: true)', () => {
    for (const declaration of Object.values(AI_ACTION_DECLARATIONS)) expect(declaration.isCharged).toBe(true);
  });

  it.each([
    ['a non-UUID account', { accountId: 'not-a-uuid' }],
    ['no account', { accountId: undefined }],
    ['the platform account', { accountId: PLATFORM }],
    ['the all-zero account', { accountId: ALL_ZERO_UUID }],
  ])('rule 3: %s → invalid_identity, no record (RC-3)', (_n, override) => {
    expect(buildAiChargeRecord(input(override))).toEqual({ skipped: 'invalid_identity' });
  });

  it('rule 3: a non-UUID grouping id → invalid_identity', () => {
    expect(buildAiChargeRecord(input({ spec: spec({ groupId: 'turn-1' }) }))).toEqual({ skipped: 'invalid_identity' });
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a negative cost', -0.001],
    ['a tiny negative cost that would round to -0', -1e-12],
  ])('rule 4: a priced cost of %s → unpriceable, never a NaN or negative record', (_n, costUsd) => {
    jest.spyOn(chargePricing, 'priceActionForCharge').mockReturnValue({
      costUsd,
      isFallbackPriced: false,
      fallbackCallCount: 0,
      calls: [],
    });
    expect(buildAiChargeRecord(input())).toEqual({ skipped: 'unpriceable' });
  });

  it('rule 5: the thin record, exactly these keys (FR-13, AC-11)', () => {
    const result = buildAiChargeRecord(input());
    expect(result).toEqual({
      record: {
        actionId: ACTION,
        accountId: OWNER,
        groupId: GROUP,
        actionType: 'chat_turn',
        trigger: 'owner',
        outcome: 'succeeded',
        credits: 1,
        costUsd: 0.001,
        creditValueVersion: 0,
        isFallbackPriced: false,
      },
      fallbackCallCount: 0,
    });
    // No tokens, models, call names, areas or error codes on the row.
    const keys = Object.keys(recordOf(result));
    for (const forbidden of ['inputTokens', 'outputTokens', 'model', 'models', 'callNames', 'area', 'areas', 'errorCode']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('a plan-cache hit is charged its lookup embedding only (SA-S1, AC-6)', () => {
    const record = recordOf(buildAiChargeRecord(input({ calls: [EMBEDDING] })));
    expect(record).toMatchObject({ costUsd: 0.0000002, credits: 0.0002, outcome: 'succeeded' });
  });

  it('five calls are one record, for their sum (FR-5, AC-10)', () => {
    const calls = [0.001, 0.002, 0.0005, 0.00025, 0.00125].map((costUsd, i) => rec({ component: `call_${i}`, costUsd }));
    const record = recordOf(buildAiChargeRecord(input({ calls })));
    expect(record.costUsd).toBe(0.005);
    expect(record.credits).toBe(5);
  });

  it('a failed action is charged the calls it made (FR-8, AC-7)', () => {
    const calls = [
      rec({ component: 'planner', costUsd: 0.001 }),
      rec({ component: 'analysis', costUsd: 0.002 }),
      rec({ component: 'analysis', success: false, costUsd: 0, inputTokens: 0, outputTokens: 0, errorCode: 'rate_limit_exceeded', pricing: undefined }),
    ];
    const failure = resolveActionFailure(calls, undefined, undefined);
    const record = recordOf(buildAiChargeRecord(input({ calls, failure })));
    expect(record).toMatchObject({ outcome: 'failed', costUsd: 0.003, credits: 3 });
  });

  it('a fallback-priced action carries the flag and the count (FR-12b)', () => {
    const unpriced = rec({ model: 'gpt-imaginary', costUsd: 0, pricing: { status: 'unpriced', unit: 'token' } });
    const result = buildAiChargeRecord(input({ calls: [unpriced] }));
    expect(recordOf(result).isFallbackPriced).toBe(true);
    expect(result).toMatchObject({ fallbackCallCount: 1 });
  });

  it.each([
    ['user', 'owner'],
    ['scheduled', 'scheduled'],
    ['external', 'external'],
  ] as const)('a %s action is recorded with trigger %s (FR-10)', (trigger, expected) => {
    const record = recordOf(buildAiChargeRecord(input({ spec: spec({ trigger }) })));
    expect(record.trigger).toBe(expected);
  });

  it('the account is the validated server-side one; the spec account is not read when a later one is given', () => {
    const OTHER = '6c8b8f1e-2222-4222-8222-333333333333';
    const record = recordOf(buildAiChargeRecord(input({ spec: spec({ accountId: undefined }), accountId: OTHER })));
    expect(record.accountId).toBe(OTHER);
  });

  it('two invocations of one group are two records with two action ids (AC-8)', () => {
    const OTHER_ACTION = '77777777-7777-4777-8777-777777777777';
    const a = recordOf(buildAiChargeRecord(input()));
    const b = recordOf(buildAiChargeRecord(input({ actionId: OTHER_ACTION })));
    expect([a.groupId, b.groupId]).toEqual([GROUP, GROUP]);
    expect(a.actionId).not.toBe(b.actionId);
  });
});

describe('the charge and the audit entry agree on the outcome', () => {
  const cases: Array<[string, UsageCallRecord[], string | undefined, { error: unknown } | undefined]> = [
    ['all succeeded', [rec()], undefined, undefined],
    ['a repaired call', [rec({ success: false, costUsd: 0, errorCode: 'x', pricing: undefined }), rec()], undefined, undefined],
    ['an unrepaired call', [rec(), rec({ component: 'analysis', success: false, costUsd: 0, errorCode: 'x', pricing: undefined })], undefined, undefined],
    ['a signalled fallback', [rec()], 'briefing_fallback', undefined],
    ['a throw', [rec()], undefined, { error: Object.assign(new Error('boom'), { code: 'ECONNRESET' }) }],
  ];

  it.each(cases)('%s', (_n, calls, signalled, thrown) => {
    const failure = resolveActionFailure(calls, signalled, thrown);
    const audit = buildAiAuditEntry({ spec: spec(), actionId: ACTION, accountId: OWNER, actorId: OWNER, calls, failure });
    const record = recordOf(buildAiChargeRecord(input({ calls, failure })));
    expect(record.outcome).toBe((audit.details as { outcome: string }).outcome);
    expect(record.actionId).toBe((audit.details as { actionId: string }).actionId);
  });
});

describe('source guards (AC-11, AC-30, tenant-isolation-guard)', () => {
  const read = (relative: string) => fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', relative), 'utf8');
  const MODULES = ['lib/business-os/llm/chargeResolver.ts', 'lib/business-os/entitlements/config/creditValue.ts'];

  it.each(MODULES)('%s names no usage-ledger or Pilot-Credit table', (file) => {
    const source = read(file);
    for (const table of ['token_usage', 'user_subscriptions', 'credit_transactions', 'billing_events']) {
      expect(source).not.toContain(table);
    }
  });

  it('the resolver never reads an account from a request, its headers or its body', () => {
    const source = read('lib/business-os/llm/chargeResolver.ts');
    expect(source).not.toMatch(/\b(request|headers|body|NextRequest)\b/);
  });

  it('the resolver prices from the call list, never from the audit entry cost', () => {
    const source = read('lib/business-os/llm/chargeResolver.ts');
    expect(source).not.toMatch(/estimatedCostUsd/);
    expect(source).toMatch(/priceActionForCharge\(calls\)/);
  });
});
