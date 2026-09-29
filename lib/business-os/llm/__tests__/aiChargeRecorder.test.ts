/**
 * Business OS credit deduction, slice 3b-ii: the charge recorder (workplan
 * §3.7; FR-13, FR-15, FR-16; SA SQ-3, Q-11, C-5, C-6, 3b-i N-4 and N-5).
 *
 * The recorder is real, and so are 3a's record builder and slice 2's pricing.
 * Only the logger, the repository (so nothing can reach a database) and the DB
 * price loader are faked.
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

const mockRecordCharge = jest.fn();
jest.mock('@/lib/repositories/BusinessOsCreditChargeRepository', () => ({
  businessOsCreditChargeRepository: { recordCharge: (...args: unknown[]) => mockRecordCharge(...args) },
}));

jest.mock('@/lib/repositories/AiModelPricingRepository', () => ({
  aiModelPricingRepository: { listActive: jest.fn().mockResolvedValue({ data: [], error: null }) },
}));

import type { UsageCallRecord } from '@/lib/ai/usageScope';
import type { AiActionSpec } from '../aiActionAudit';
import * as chargePricing from '../chargePricing';
import { resetCreditValueLogForTests } from '../chargeResolver';
import {
  AI_CHARGE_SERVICE,
  BOS_AI_CHARGE_WRITE_BUDGET_MS,
  recordAiCharge,
  type AiChargeInput,
} from '../aiChargeRecorder';

const OWNER = '2f734ed5-3681-4049-880d-3de7b096bea3';
const GROUP = '33333333-3333-4333-8333-333333333333';
const ACTION = '55555555-5555-4555-8555-555555555555';
const PERIOD = '2026-09-23T19:55:01.28632+00:00';

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
    pricing: { status: 'priced', unit: 'token' },
    ...overrides,
  };
}

function spec(overrides: Partial<AiActionSpec> = {}): AiActionSpec {
  return { area: 'chat', actionType: 'chat_turn', groupId: GROUP, trigger: 'user', accountId: OWNER, ...overrides };
}

function input(overrides: Partial<AiChargeInput> = {}): AiChargeInput {
  return {
    spec: spec(),
    actionId: ACTION,
    accountId: OWNER,
    decision: { identities: { accountId: OWNER }, failure: undefined },
    isCharged: true,
    calls: [rec()],
    ...overrides,
  };
}

const ok = (recorded = true, anchorSource: 'plan' | 'calendar_month' = 'plan') => ({
  data: { recorded, periodStart: PERIOD, anchorSource },
  error: null,
});

/** The recorder's own events (the resolver's once-per-process credit value info is not one). */
const events = () => mockLogged.filter((l) => typeof l.fields.event === 'string' && l.fields.event !== 'bos_credit_value_active');
const errors = () => mockLogged.filter((l) => l.level === 'error');

const FR16_IDS = { accountId: OWNER, area: 'chat', actionType: 'chat_turn', groupId: GROUP, actionId: ACTION, service: 'ai' };

beforeEach(() => {
  mockLogged.length = 0;
  mockRecordCharge.mockReset();
  mockRecordCharge.mockResolvedValue(ok());
  resetCreditValueLogForTests();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('the constants (SA C-6, SQ-3)', () => {
  it('the AI service is exactly "ai"', () => {
    expect(AI_CHARGE_SERVICE).toBe('ai');
  });

  it('the budget is 1,500 ms, under SA\'s 2 s ceiling', () => {
    expect(BOS_AI_CHARGE_WRITE_BUDGET_MS).toBe(1_500);
  });
});

describe('recorded (FR-13, FR-15)', () => {
  it('writes the thin row once, field by field, with service from the constant and an abort signal', async () => {
    await recordAiCharge(input());
    expect(mockRecordCharge).toHaveBeenCalledTimes(1);
    const [charge, options] = mockRecordCharge.mock.calls[0];
    expect(charge).toEqual({
      actionId: ACTION,
      accountId: OWNER,
      groupId: GROUP,
      service: 'ai',
      actionType: 'chat_turn',
      trigger: 'owner',
      outcome: 'succeeded',
      credits: 1,
      costUsd: 0.001,
      creditValueVersion: 0,
      isFallbackPriced: false,
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.signal.aborted).toBe(false);
  });

  it('logs bos_ai_charge_recorded at debug only: no info, warn or error', async () => {
    await recordAiCharge(input());
    expect(events()).toEqual([
      expect.objectContaining({ level: 'debug', fields: expect.objectContaining({ event: 'bos_ai_charge_recorded', ...FR16_IDS }) }),
    ]);
  });

  it('service never comes from input: a spec carrying another service still writes "ai" (C-6)', async () => {
    const tampered = { ...spec(), service: 'sms' } as AiActionSpec;
    await recordAiCharge(input({ spec: tampered }));
    expect(mockRecordCharge.mock.calls[0][0].service).toBe(AI_CHARGE_SERVICE);
  });

  it('only the listed fields reach the repository, whatever the spec carries (tenant-isolation-guard Step 3)', async () => {
    const tampered = { ...spec(), user_id: 'x', id: 'y', kind: 'adjustment' } as AiActionSpec;
    await recordAiCharge(input({ spec: tampered }));
    expect(Object.keys(mockRecordCharge.mock.calls[0][0]).sort()).toEqual(
      ['accountId', 'actionId', 'actionType', 'costUsd', 'creditValueVersion', 'credits', 'groupId', 'isFallbackPriced', 'outcome', 'service', 'trigger'],
    );
  });

  it('a failed action is written as failed, from the decision it was given (N-7)', async () => {
    await recordAiCharge(input({ decision: { identities: { accountId: OWNER }, failure: { code: 'chat_error' } } }));
    expect(mockRecordCharge.mock.calls[0][0].outcome).toBe('failed');
  });

  it.each([
    ['user', 'owner'],
    ['scheduled', 'scheduled'],
    ['external', 'external'],
  ] as const)('a %s action is written with trigger %s', async (trigger, expected) => {
    await recordAiCharge(input({ spec: spec({ trigger }) }));
    expect(mockRecordCharge.mock.calls[0][0].trigger).toBe(expected);
  });

  it('a fallback-priced charge logs one info with fallbackCallCount, pricing only once (D-1), and no second unpriced error (S2 N-4)', async () => {
    const spy = jest.spyOn(chargePricing, 'priceActionForCharge');
    const unpriced = rec({ model: 'gpt-imaginary', costUsd: 0, pricing: { status: 'unpriced', unit: 'token' } });
    await recordAiCharge(input({ calls: [unpriced, rec({ component: 'analysis', model: 'gpt-imaginary-2', costUsd: 0, pricing: { status: 'unpriced', unit: 'token' } })] }));
    expect(spy).toHaveBeenCalledTimes(1);
    const info = events().filter((l) => l.fields.event === 'bos_ai_charge_fallback_priced');
    expect(info).toHaveLength(1);
    expect(info[0].level).toBe('info');
    expect(info[0].fields).toEqual({
      event: 'bos_ai_charge_fallback_priced',
      actionId: ACTION,
      groupId: GROUP,
      accountId: OWNER,
      actionType: 'chat_turn',
      fallbackCallCount: 2,
    });
    expect(mockRecordCharge.mock.calls[0][0].isFallbackPriced).toBe(true);
    expect(errors()).toEqual([]);
    expect(mockLogged.some((l) => l.fields.event === 'bos_llm_call_unpriced')).toBe(false);
  });

  it('a replayed action id (recorded = false) is logged at info with the action id (3b-i N-4), never as an error', async () => {
    mockRecordCharge.mockResolvedValue(ok(false));
    await recordAiCharge(input());
    expect(events()).toEqual([
      expect.objectContaining({ level: 'info', fields: expect.objectContaining({ event: 'bos_ai_charge_duplicate', recorded: false, actionId: ACTION }) }),
    ]);
  });

  it('no plan row: recorded in the calendar month, one warn (Q-3)', async () => {
    mockRecordCharge.mockResolvedValue(ok(true, 'calendar_month'));
    await recordAiCharge(input());
    const warn = events().filter((l) => l.level === 'warn');
    expect(warn).toHaveLength(1);
    expect(warn[0].fields).toMatchObject({ event: 'bos_ai_charge_no_plan_row', ...FR16_IDS, periodStart: PERIOD });
    expect(errors()).toEqual([]);
  });
});

describe('nothing to write', () => {
  it('no calls → skipped at debug, the repository never called (FR-7)', async () => {
    await recordAiCharge(input({ calls: [] }));
    expect(mockRecordCharge).not.toHaveBeenCalled();
    expect(events()).toEqual([expect.objectContaining({ level: 'debug', fields: expect.objectContaining({ reason: 'no_calls' }) })]);
  });

  it('a type declared not charged → skipped at debug (FR-4)', async () => {
    await recordAiCharge(input({ isCharged: false }));
    expect(mockRecordCharge).not.toHaveBeenCalled();
    expect(events()).toEqual([expect.objectContaining({ level: 'debug', fields: expect.objectContaining({ reason: 'not_charged' }) })]);
  });

  it('invalid identities → one error bos_ai_charge_not_written, no write (FR-16)', async () => {
    await recordAiCharge(input({ decision: { identities: null, failure: undefined } }));
    expect(mockRecordCharge).not.toHaveBeenCalled();
    expect(errors()).toHaveLength(1);
    expect(errors()[0].fields).toMatchObject({ event: 'bos_ai_charge_not_written', reason: 'invalid_identity', ...FR16_IDS });
  });

  it('an unpriceable cost → one error bos_ai_charge_not_written, no write', async () => {
    jest.spyOn(chargePricing, 'priceActionForCharge').mockReturnValue({ costUsd: Number.NaN, isFallbackPriced: false, fallbackCallCount: 0, calls: [] });
    await recordAiCharge(input());
    expect(mockRecordCharge).not.toHaveBeenCalled();
    expect(errors()).toHaveLength(1);
    expect(errors()[0].fields).toMatchObject({ event: 'bos_ai_charge_not_written', reason: 'unpriceable' });
  });

  it('no decision (deciding it threw in runAiAction) → one error, reason undecided, no write', async () => {
    await recordAiCharge(input({ decision: undefined }));
    expect(mockRecordCharge).not.toHaveBeenCalled();
    expect(errors()).toHaveLength(1);
    expect(errors()[0].fields).toMatchObject({ event: 'bos_ai_charge_not_written', reason: 'undecided', ...FR16_IDS });
  });
});

describe('failures: one error, never a throw (FR-16, AC-12)', () => {
  const writeFailed = () => errors().filter((l) => l.fields.event === 'bos_ai_charge_write_failed');

  it('a database error with a code → db_error with the code, not written', async () => {
    mockRecordCharge.mockResolvedValue({ data: null, error: Object.assign(new Error('boom'), { code: 'PGRST202' }) });
    await expect(recordAiCharge(input())).resolves.toBeUndefined();
    expect(errors()).toHaveLength(1);
    expect(writeFailed()[0].fields).toEqual({
      event: 'bos_ai_charge_write_failed',
      reason: 'db_error',
      errCode: 'PGRST202',
      fate: 'not_written',
      ...FR16_IDS,
    });
  });

  it('a SQLSTATE code (23514, a CHECK violation) → db_error, not written', async () => {
    mockRecordCharge.mockResolvedValue({ data: null, error: { message: 'violates check constraint', details: '', hint: '', code: '23514' } });
    await recordAiCharge(input());
    expect(errors()).toHaveLength(1);
    expect(writeFailed()[0].fields).toMatchObject({ reason: 'db_error', errCode: '23514', fate: 'not_written' });
  });

  // SA 3b-ii S-1: the REAL shape postgrest-js 2.x returns from its fetch-error
  // branch (`res.catch((fetchError) => …)`): a plain object, `code` always a
  // string, '' when the fetch error carries none. The write may have committed.
  it('a network failure in the real postgrest-js shape (code "") → db_error, errCode network, unknown fate (N-5)', async () => {
    mockRecordCharge.mockResolvedValue({
      data: null,
      error: { message: 'TypeError: fetch failed', details: '', hint: '', code: '' },
    });
    await recordAiCharge(input());
    expect(errors()).toHaveLength(1);
    expect(writeFailed()[0].fields).toMatchObject({ reason: 'db_error', errCode: 'network', fate: 'unknown', ...FR16_IDS });
  });

  it('a network failure carrying a Node code (ECONNRESET) → db_error with that code, unknown fate (N-5)', async () => {
    mockRecordCharge.mockResolvedValue({
      data: null,
      error: { message: 'FetchError: socket hang up', details: '', hint: '', code: 'ECONNRESET' },
    });
    await recordAiCharge(input());
    expect(errors()).toHaveLength(1);
    expect(writeFailed()[0].fields).toMatchObject({ reason: 'db_error', errCode: 'ECONNRESET', fate: 'unknown' });
  });

  // A 5-letter Node code has the length of a SQLSTATE; no SQLSTATE class starts with E.
  it('a 5-letter Node network code (EPIPE) is not mistaken for a SQLSTATE → unknown fate', async () => {
    mockRecordCharge.mockResolvedValue({ data: null, error: { message: 'write EPIPE', details: '', hint: '', code: 'EPIPE' } });
    await recordAiCharge(input());
    expect(writeFailed()[0].fields).toMatchObject({ reason: 'db_error', errCode: 'EPIPE', fate: 'unknown' });
  });

  it('a raised PL/pgSQL exception (P0001) → not written', async () => {
    mockRecordCharge.mockResolvedValue({ data: null, error: { message: 'raised', details: '', hint: '', code: 'P0001' } });
    await recordAiCharge(input());
    expect(writeFailed()[0].fields).toMatchObject({ reason: 'db_error', errCode: 'P0001', fate: 'not_written' });
  });

  it('never logs an error message or owner text', async () => {
    mockRecordCharge.mockResolvedValue({ data: null, error: Object.assign(new Error('SECRET-MESSAGE'), { code: '23514' }) });
    await recordAiCharge(input());
    expect(JSON.stringify(mockLogged)).not.toContain('SECRET-MESSAGE');
  });

  it('a hanging write settles at the budget, aborts the request, logs a timeout with an unknown fate (N-5) and leaves no timer', async () => {
    jest.useFakeTimers();
    let signal: AbortSignal | undefined;
    mockRecordCharge.mockImplementation((_c: unknown, o: { signal: AbortSignal }) => {
      signal = o.signal;
      return new Promise(() => undefined);
    });
    let settled = false;
    const done = recordAiCharge(input()).then(() => {
      settled = true;
    });
    await jest.advanceTimersByTimeAsync(BOS_AI_CHARGE_WRITE_BUDGET_MS - 1);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await done;
    expect(settled).toBe(true);
    expect(signal?.aborted).toBe(true);
    expect(errors()).toHaveLength(1);
    expect(writeFailed()[0].fields).toMatchObject({ reason: 'timeout', fate: 'unknown', ...FR16_IDS });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a successful write clears its budget timer', async () => {
    jest.useFakeTimers();
    await recordAiCharge(input());
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a rejecting repository → exception with an unknown fate', async () => {
    mockRecordCharge.mockRejectedValue(new Error('rejected'));
    await expect(recordAiCharge(input())).resolves.toBeUndefined();
    expect(writeFailed()).toHaveLength(1);
    expect(writeFailed()[0].fields).toMatchObject({ reason: 'exception', fate: 'unknown', errCode: 'Error' });
  });

  it('a synchronously throwing repository → exception, never a throw', async () => {
    mockRecordCharge.mockImplementation(() => {
      throw new Error('sync');
    });
    await expect(recordAiCharge(input())).resolves.toBeUndefined();
    expect(writeFailed()[0].fields).toMatchObject({ reason: 'exception' });
  });

  it('a throwing builder (a pricing-table defect, SA N-4) → exception, not written, no write attempted', async () => {
    jest.spyOn(chargePricing, 'priceActionForCharge').mockImplementation(() => {
      throw new Error('rates empty');
    });
    await expect(recordAiCharge(input())).resolves.toBeUndefined();
    expect(mockRecordCharge).not.toHaveBeenCalled();
    expect(writeFailed()[0].fields).toMatchObject({ reason: 'exception', fate: 'not_written' });
  });
});

describe('source guards (SA C-5, C-6, D-13, tenant-isolation-guard, AC-11)', () => {
  const read = (relative: string) => fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', relative), 'utf8');
  const CHARGE_MODULES = ['lib/business-os/llm/chargeResolver.ts', 'lib/business-os/llm/aiChargeRecorder.ts'];

  /** Every import statement's text, joined across lines. */
  const importsOf = (source: string) => source.match(/^import[\s\S]*?from\s+['"][^'"]+['"];?/gm) ?? [];

  it.each(CHARGE_MODULES)('%s imports only types from aiActionAudit (no runtime cycle, C-5)', (file) => {
    const fromAudit = importsOf(read(file)).filter((statement) => /['"]\.\/aiActionAudit['"]|llm\/aiActionAudit['"]/.test(statement));
    expect(fromAudit.length).toBeGreaterThan(0);
    for (const statement of fromAudit) expect(statement).toMatch(/^import\s+type\s/);
    // And nothing reaches it through require() or a dynamic import.
    expect(read(file)).not.toMatch(/(require|import)\(\s*['"][^'"]*aiActionAudit['"]\s*\)/);
  });

  it('the recorder writes service only from AI_CHARGE_SERVICE (C-6)', () => {
    const source = read('lib/business-os/llm/aiChargeRecorder.ts');
    expect(source).toMatch(/export const AI_CHARGE_SERVICE = 'ai' as const;/);
    const assignments = source.match(/\bservice:\s*[^,\n}]+/g) ?? [];
    expect(assignments).toEqual(['service: AI_CHARGE_SERVICE', 'service: AI_CHARGE_SERVICE']);
  });

  it('the recorder reaches the database only through the credit charge repository', () => {
    const source = read('lib/business-os/llm/aiChargeRecorder.ts');
    expect(source).not.toMatch(/supabaseServer|supabaseClient|\.from\(|\.rpc\(/);
    expect(source).toMatch(/from '@\/lib\/repositories\/BusinessOsCreditChargeRepository'/);
  });

  it('the recorder never reads a request, its headers or its body', () => {
    expect(read('lib/business-os/llm/aiChargeRecorder.ts')).not.toMatch(/\b(request|headers|body|NextRequest)\b/);
  });

  it('the recorder names no usage-ledger or Pilot-Credit table', () => {
    const source = read('lib/business-os/llm/aiChargeRecorder.ts');
    for (const table of ['token_usage', 'user_subscriptions', 'credit_transactions', 'billing_events']) {
      expect(source).not.toContain(table);
    }
  });

  it('no retry inside the budget: the repository is called in exactly one place (Q-11)', () => {
    const source = read('lib/business-os/llm/aiChargeRecorder.ts');
    expect(source.match(/businessOsCreditChargeRepository\.recordCharge\(/g)).toHaveLength(1);
    expect(source).not.toMatch(/\bretry\b|\bretries\b/i);
  });
});
