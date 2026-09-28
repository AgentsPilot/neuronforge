/**
 * Deduction layer slice 2: how one call is classified for a charge (workplan
 * §2.3, rules 1-7 with SA C-1), and the loud log hook (§2.4, AC-3, SA S-1).
 *
 * The REAL pricing module is used: the database read returns nothing, so the
 * re-check reads the in-code table the product ships.
 */

const mockLogged: Array<{ level: string; fields: Record<string, unknown>; msg: string }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      logger[level] = (first: unknown, second?: unknown) => {
        mockLogged.push({
          level,
          fields: typeof first === 'object' && first !== null ? JSON.parse(JSON.stringify(first)) : {},
          msg: typeof first === 'string' ? first : String(second ?? ''),
        });
      };
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

jest.mock('@/lib/repositories/AiModelPricingRepository', () => ({
  aiModelPricingRepository: { listActive: jest.fn().mockResolvedValue({ data: [], error: null }) },
}));

import { classifyCallForCharge, reportUnpricedCalls, type UnpricedLogContext } from '../chargeClassification';
import type { UsageCallRecord } from '@/lib/ai/usageScope';

const GROUP = '33333333-3333-4333-8333-333333333333';
const ACCOUNT = '2f734ed5-3681-4049-880d-3de7b096bea3';
const CTX: UnpricedLogContext = { area: 'chat', actionType: 'chat_turn', groupId: GROUP, accountId: ACCOUNT };

function rec(overrides: Partial<UsageCallRecord> = {}): UsageCallRecord {
  return {
    feature: 'business-os-chat',
    component: 'planner',
    provider: 'openai',
    model: 'gpt-4o',
    sessionId: GROUP,
    inputTokens: 1000,
    outputTokens: 500,
    costUsd: 0.0075,
    success: true,
    ...overrides,
  };
}

beforeEach(() => {
  mockLogged.length = 0;
});

describe('classifyCallForCharge', () => {
  describe('rule 1: malformed', () => {
    it.each([
      ['a NaN cost', { costUsd: NaN }],
      ['an infinite cost', { costUsd: Infinity }],
      ['a negative cost', { costUsd: -0.01 }],
      ['a negative input count', { inputTokens: -1 }],
      ['a NaN output count', { outputTokens: NaN }],
      ['a string cost', { costUsd: '0.01' as unknown as number }],
      ['an unreadable signal status', { pricing: { status: 'maybe', unit: 'token' } as unknown as UsageCallRecord['pricing'] }],
      ['an unreadable signal unit', { pricing: { status: 'priced', unit: 'litre' } as unknown as UsageCallRecord['pricing'] }],
      ['a null signal', { pricing: null as unknown as UsageCallRecord['pricing'] }],
    ])('%s is flagged, never thrown', (_label, overrides) => {
      expect(classifyCallForCharge(rec(overrides))).toEqual({
        basis: 'conservative_fallback',
        reason: 'malformed',
        kind: 'text',
      });
    });

    it('a record that is not an object is flagged, never thrown', () => {
      for (const bad of [null, undefined, 42, 'x']) {
        expect(() => classifyCallForCharge(bad as unknown as UsageCallRecord)).not.toThrow();
        expect(classifyCallForCharge(bad as unknown as UsageCallRecord)).toMatchObject({ reason: 'malformed' });
      }
    });

    it('a non-string provider or model is flagged via the re-check, never thrown (SA C-2 on the charge side)', () => {
      const odd = rec({ provider: undefined as unknown as string, model: 42 as unknown as string, costUsd: 0 });
      expect(() => classifyCallForCharge(odd)).not.toThrow();
      expect(classifyCallForCharge(odd)).toEqual({ basis: 'conservative_fallback', reason: 'unpriced_on_recheck', kind: 'text' });
    });
  });

  it('rule 2: a failed call is failed_call, not flagged (KI-8, SQ-16)', () => {
    expect(classifyCallForCharge(rec({ success: false, inputTokens: 0, outputTokens: 0, costUsd: 0, errorCode: 'x' }))).toEqual({
      basis: 'failed_call',
      kind: 'text',
    });
  });

  describe('rule 3: signal unpriced', () => {
    it('text', () => {
      expect(classifyCallForCharge(rec({ model: 'gpt-imaginary', costUsd: 0, pricing: { status: 'unpriced', unit: 'token' } }))).toEqual({
        basis: 'conservative_fallback',
        reason: 'unpriced',
        kind: 'text',
      });
    });
    it('embedding (an input-only model)', () => {
      expect(
        classifyCallForCharge(rec({ model: 'text-embedding-imaginary', outputTokens: 0, costUsd: 0, pricing: { status: 'unpriced', unit: 'token' } }))
      ).toEqual({ basis: 'conservative_fallback', reason: 'unpriced', kind: 'embedding' });
    });
    it('image', () => {
      expect(
        classifyCallForCharge(rec({ model: 'gpt-image-1', inputTokens: 0, outputTokens: 0, costUsd: 0, pricing: { status: 'unpriced', unit: 'image' } }))
      ).toEqual({ basis: 'conservative_fallback', reason: 'unpriced', kind: 'image' });
    });
  });

  it('rule 4: signal priced with cost 0 for real tokens is the priced_but_zero backstop', () => {
    expect(classifyCallForCharge(rec({ costUsd: 0, pricing: { status: 'priced', unit: 'token' } }))).toEqual({
      basis: 'conservative_fallback',
      reason: 'priced_but_zero',
      kind: 'text',
    });
    expect(
      classifyCallForCharge(rec({ inputTokens: 0, outputTokens: 0, costUsd: 0, pricing: { status: 'priced', unit: 'image' } }))
    ).toMatchObject({ reason: 'priced_but_zero', kind: 'image' });
  });

  it('rule 5: signal priced is measured (text, embedding, image, and zero tokens at 0)', () => {
    expect(classifyCallForCharge(rec({ pricing: { status: 'priced', unit: 'token' } }))).toEqual({ basis: 'measured', kind: 'text' });
    expect(
      classifyCallForCharge(rec({ model: 'text-embedding-3-small', outputTokens: 0, costUsd: 2e-7, pricing: { status: 'priced', unit: 'token' } }))
    ).toEqual({ basis: 'measured', kind: 'embedding' });
    expect(
      classifyCallForCharge(rec({ inputTokens: 0, outputTokens: 0, costUsd: 0.063, pricing: { status: 'priced', unit: 'image' } }))
    ).toEqual({ basis: 'measured', kind: 'image' });
    expect(classifyCallForCharge(rec({ inputTokens: 0, outputTokens: 0, costUsd: 0, pricing: { status: 'priced', unit: 'token' } }))).toEqual({
      basis: 'measured',
      kind: 'text',
    });
  });

  it('rule 6: no signal and a positive cost is measured, with no re-check (an Anthropic call is not over-charged)', () => {
    expect(classifyCallForCharge(rec({ provider: 'anthropic', model: 'claude-sonnet-4-6', costUsd: 0.0105 }))).toEqual({
      basis: 'measured',
      kind: 'text',
    });
    // Even for a model the table does not know: a positive cost proves a price was found at call time (SA Q-4).
    expect(classifyCallForCharge(rec({ provider: 'groq', model: 'llama-x', costUsd: 0.001 }))).toEqual({ basis: 'measured', kind: 'text' });
  });

  describe('rule 7: no signal and cost 0, re-checked (SQ-13 (2), SA C-1)', () => {
    it('re-check priced and zero tokens: measured 0 (not over-charged)', () => {
      expect(
        classifyCallForCharge(rec({ provider: 'anthropic', model: 'claude-sonnet-4-6', inputTokens: 0, outputTokens: 0, costUsd: 0 }))
      ).toEqual({ basis: 'measured', kind: 'text' });
    });

    it('C-1: re-check priced but tokens > 0 is NOT a measured $0: flagged zero_cost_with_tokens', () => {
      expect(classifyCallForCharge(rec({ provider: 'anthropic', model: 'claude-sonnet-4-6', costUsd: 0 }))).toEqual({
        basis: 'conservative_fallback',
        reason: 'zero_cost_with_tokens',
        kind: 'text',
      });
    });

    it('re-check unpriced: flagged unpriced_on_recheck, with or without tokens', () => {
      expect(classifyCallForCharge(rec({ provider: 'anthropic', model: 'claude-imaginary', costUsd: 0 }))).toEqual({
        basis: 'conservative_fallback',
        reason: 'unpriced_on_recheck',
        kind: 'text',
      });
      expect(
        classifyCallForCharge(rec({ provider: 'anthropic', model: 'claude-imaginary', inputTokens: 0, outputTokens: 0, costUsd: 0 }))
      ).toMatchObject({ reason: 'unpriced_on_recheck' });
    });

    it('a provider absent from the table (groq) re-checks unpriced', () => {
      expect(classifyCallForCharge(rec({ provider: 'groq', model: 'llama-3.3-70b-versatile', costUsd: 0 }))).toMatchObject({
        reason: 'unpriced_on_recheck',
      });
    });
  });

  it('is silent, at every level', () => {
    classifyCallForCharge(rec({ costUsd: NaN }));
    classifyCallForCharge(rec({ provider: 'groq', model: 'x', costUsd: 0 }));
    classifyCallForCharge(rec({ pricing: { status: 'unpriced', unit: 'token' } }));
    expect(mockLogged).toHaveLength(0);
  });
});

describe('reportUnpricedCalls (AC-3, the one live hook)', () => {
  const SENTINEL = 'OWNER-TYPED-SENTINEL-7f3a';

  it('logs one error per unpriced call, naming everything an operator needs', () => {
    reportUnpricedCalls(
      [
        rec({ component: 'planner', model: 'gpt-imaginary', costUsd: 0, pricing: { status: 'unpriced', unit: 'token' } }),
        rec({ component: 'analysis', provider: 'anthropic', model: 'claude-sonnet-4-6', costUsd: 0 }),
      ],
      CTX
    );
    const errors = mockLogged.filter((l) => l.level === 'error');
    expect(errors).toHaveLength(2);
    expect(errors[0].fields).toEqual({
      event: 'bos_llm_call_unpriced',
      provider: 'openai',
      model: 'gpt-imaginary',
      area: 'chat',
      actionType: 'chat_turn',
      groupId: GROUP,
      accountId: ACCOUNT,
      callName: 'planner',
      kind: 'text',
      reason: 'unpriced',
    });
    expect(errors[1].fields).toMatchObject({ callName: 'analysis', provider: 'anthropic', reason: 'zero_cost_with_tokens' });
    expect(mockLogged.filter((l) => l.level !== 'error')).toHaveLength(0);
  });

  it('logs an account it does not know as null', () => {
    reportUnpricedCalls([rec({ costUsd: 0, pricing: { status: 'unpriced', unit: 'token' } })], { ...CTX, accountId: undefined });
    expect(mockLogged[0].fields.accountId).toBeNull();
  });

  it('is silent for priced, failed and absent-but-priced calls', () => {
    reportUnpricedCalls(
      [
        rec({ pricing: { status: 'priced', unit: 'token' } }),
        rec({ success: false, inputTokens: 0, outputTokens: 0, costUsd: 0 }),
        rec({ provider: 'anthropic', model: 'claude-sonnet-4-6', costUsd: 0.0105 }),
        rec({ provider: 'anthropic', model: 'claude-sonnet-4-6', inputTokens: 0, outputTokens: 0, costUsd: 0 }),
      ],
      CTX
    );
    expect(mockLogged).toHaveLength(0);
  });

  it('never logs owner text, at any level (Standard 5 / 7)', () => {
    const hostile = { ...rec({ costUsd: 0, pricing: { status: 'unpriced', unit: 'token' } }), prompt: SENTINEL, content: SENTINEL };
    reportUnpricedCalls([hostile as UsageCallRecord], CTX);
    expect(mockLogged.length).toBeGreaterThan(0);
    expect(JSON.stringify(mockLogged)).not.toContain(SENTINEL);
  });
});
