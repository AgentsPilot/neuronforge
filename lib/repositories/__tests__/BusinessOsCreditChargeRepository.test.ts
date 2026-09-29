/**
 * Unit tests for BusinessOsCreditChargeRepository (credit deduction slice 3b-i).
 *
 * What matters here: the charge goes through the one atomic RPC with EXACTLY
 * the eleven typed arguments, built field by field (tenant-isolation-guard Step 3);
 * the abort signal reaches the request; the RPC's row is mapped strictly, so a
 * wrong shape is an error rather than a guessed `recorded`; and a failure is
 * returned, never thrown. Plus the guardrail: nothing outside the repository
 * layer names it except the ONE production writer, the AI charge recorder
 * (slice 3b-ii, SA D-13), and the tests that fake it.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AiChargeRecord } from '@/lib/business-os/llm/chargeResolver';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
const mockWarn = jest.fn();
const mockError = jest.fn();
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {
      info: jest.fn(),
      warn: (...args: unknown[]) => mockWarn(...args),
      error: (...args: unknown[]) => mockError(...args),
      debug: jest.fn(),
    };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import {
  BOS_RECORD_CREDIT_CHARGE_RPC,
  BusinessOsCreditChargeRepository,
  type BusinessOsCreditChargeInput,
} from '@/lib/repositories/BusinessOsCreditChargeRepository';

const CHARGE: BusinessOsCreditChargeInput = {
  actionId: '11111111-1111-4111-8111-111111111111',
  accountId: '22222222-2222-4222-8222-222222222222',
  groupId: '33333333-3333-4333-8333-333333333333',
  service: 'ai',
  actionType: 'chat_turn',
  trigger: 'owner',
  outcome: 'succeeded',
  credits: 7.5,
  costUsd: 0.0075,
  creditValueVersion: 0,
  isFallbackPriced: false,
};

const EXPECTED_ARGS = {
  p_action_id: CHARGE.actionId,
  p_user_id: CHARGE.accountId,
  p_group_id: CHARGE.groupId,
  p_service: 'ai',
  p_action_type: 'chat_turn',
  p_triggered_by: 'owner',
  p_outcome: 'succeeded',
  p_credits: 7.5,
  p_cost_usd: 0.0075,
  p_credit_value_version: 0,
  p_is_fallback_priced: false,
};

const ROW = {
  out_recorded: true,
  out_period_start: '2026-09-14T10:00:00+00:00',
  out_anchor_source: 'plan',
};

interface Recorded {
  rpc?: [string, Record<string, unknown>];
  signal?: AbortSignal;
}

/**
 * A client whose `rpc()` returns a thenable builder with `abortSignal()`, the
 * shape supabase-js gives a PostgREST call. `outcome` may also be a rejection.
 */
function mockClient(outcome: { data: unknown; error: unknown } | Error) {
  const recorded: Recorded = {};
  const settle = () => (outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome));
  // `any` is unavoidable here (CLAUDE.md rule 6): the stub models PostgREST's
  // chainable, thenable builder; typing it faithfully would mean reproducing
  // supabase-js's generic builder types for no gain to these assertions.
  const builder: any = {
    abortSignal: jest.fn((signal: AbortSignal) => {
      recorded.signal = signal;
      return builder;
    }),
    then: (onFulfilled: any, onRejected: any) => settle().then(onFulfilled, onRejected),
  };
  const client = {
    rpc: jest.fn((fn: string, args: Record<string, unknown>) => {
      recorded.rpc = [fn, args];
      return builder;
    }),
    from: jest.fn(() => {
      throw new Error('the ledger repository must not use from() in 3b-i');
    }),
  } as unknown as SupabaseClient;
  return { client, recorded, builder };
}

beforeEach(() => {
  mockWarn.mockReset();
  mockError.mockReset();
});

describe('recordCharge', () => {
  it('calls the one atomic RPC with exactly the eleven typed arguments', async () => {
    const { client, recorded } = mockClient({ data: [ROW], error: null });

    const result = await new BusinessOsCreditChargeRepository(client).recordCharge(CHARGE);

    expect(result.error).toBeNull();
    expect(recorded.rpc?.[0]).toBe('business_os_record_credit_charge');
    expect(BOS_RECORD_CREDIT_CHARGE_RPC).toBe('business_os_record_credit_charge');
    expect(recorded.rpc?.[1]).toEqual(EXPECTED_ARGS);
    expect(Object.keys(recorded.rpc?.[1] ?? {}).sort()).toEqual(Object.keys(EXPECTED_ARGS).sort());
  });

  it('builds the arguments field by field: extra properties on the input never reach the RPC', async () => {
    const { client, recorded } = mockClient({ data: [ROW], error: null });
    const polluted = {
      ...CHARGE,
      user_id: 'ATTACKER',
      p_user_id: 'ATTACKER',
      kind: 'adjustment',
      p_kind: 'adjustment',
      id: 'injected-id',
      fallbackCallCount: 3,
    };

    await new BusinessOsCreditChargeRepository(client).recordCharge(polluted);

    expect(recorded.rpc?.[1]).toEqual(EXPECTED_ARGS);
    expect(JSON.stringify(recorded.rpc?.[1])).not.toContain('ATTACKER');
    expect(JSON.stringify(recorded.rpc?.[1])).not.toContain('adjustment');
  });

  it('maps a recorded write', async () => {
    const { client } = mockClient({ data: [ROW], error: null });

    const result = await new BusinessOsCreditChargeRepository(client).recordCharge(CHARGE);

    expect(result).toEqual({
      data: { recorded: true, periodStart: '2026-09-14T10:00:00+00:00', anchorSource: 'plan' },
      error: null,
    });
    expect(mockWarn).not.toHaveBeenCalled();
    expect(mockError).not.toHaveBeenCalled();
  });

  it('maps a duplicate (recorded false) and the calendar-month fallback', async () => {
    const { client } = mockClient({
      data: [{ out_recorded: false, out_period_start: '2026-09-01T00:00:00+00:00', out_anchor_source: 'calendar_month' }],
      error: null,
    });

    const result = await new BusinessOsCreditChargeRepository(client).recordCharge(CHARGE);

    expect(result.data).toEqual({
      recorded: false,
      periodStart: '2026-09-01T00:00:00+00:00',
      anchorSource: 'calendar_month',
    });
  });

  it('accepts a single-object row as well as an array of one', async () => {
    const { client } = mockClient({ data: ROW, error: null });

    const result = await new BusinessOsCreditChargeRepository(client).recordCharge(CHARGE);

    expect(result.data?.recorded).toBe(true);
  });

  it('passes the abort signal to the request', async () => {
    const { client, recorded, builder } = mockClient({ data: [ROW], error: null });
    const controller = new AbortController();

    await new BusinessOsCreditChargeRepository(client).recordCharge(CHARGE, { signal: controller.signal });

    expect(builder.abortSignal).toHaveBeenCalledTimes(1);
    expect(recorded.signal).toBe(controller.signal);
  });

  it('does not touch abortSignal when no signal is given', async () => {
    const { client, builder } = mockClient({ data: [ROW], error: null });

    await new BusinessOsCreditChargeRepository(client).recordCharge(CHARGE);

    expect(builder.abortSignal).not.toHaveBeenCalled();
  });

  it('returns a PostgREST error as { data: null, error } and logs warn (never error) with ids only', async () => {
    const pgError = { code: '42501', message: 'permission denied for function business_os_record_credit_charge' };
    const { client } = mockClient({ data: null, error: pgError });

    const result = await new BusinessOsCreditChargeRepository(client).recordCharge(CHARGE);

    expect(result).toEqual({ data: null, error: pgError });
    expect(mockError).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledTimes(1);
    const [context, message] = mockWarn.mock.calls[0];
    expect(message).toBe('Credit charge write failed');
    expect(context).toEqual({
      err: pgError,
      actionId: CHARGE.actionId,
      accountId: CHARGE.accountId,
      groupId: CHARGE.groupId,
      service: 'ai',
    });
  });

  it('never throws: a rejected request (an abort, a network error) is returned as error', async () => {
    const abort = new Error('This operation was aborted');
    abort.name = 'AbortError';
    const { client } = mockClient(abort);

    const result = await new BusinessOsCreditChargeRepository(client).recordCharge(CHARGE);

    expect(result).toEqual({ data: null, error: abort });
  });

  it('never throws when rpc() itself throws synchronously', async () => {
    const client = {
      rpc: jest.fn(() => {
        throw new Error('boom');
      }),
    } as unknown as SupabaseClient;

    const result = await new BusinessOsCreditChargeRepository(client).recordCharge(CHARGE);

    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('boom');
  });

  it.each([
    ['no row', []],
    ['null', null],
    ['recorded not a boolean', [{ ...ROW, out_recorded: 'true' }]],
    ['period missing', [{ out_recorded: true, out_anchor_source: 'plan' }]],
    ['unknown anchor source', [{ ...ROW, out_anchor_source: 'guess' }]],
    ['the pre-C-2 column names', [{ recorded: true, period_start: ROW.out_period_start, anchor_source: 'plan' }]],
  ])('treats an unexpected RPC row (%s) as an error, never as a guessed result', async (_name, data) => {
    const { client } = mockClient({ data, error: null });

    const result = await new BusinessOsCreditChargeRepository(client).recordCharge(CHARGE);

    expect(result.data).toBeNull();
    expect(result.error?.message).toMatch(/business_os_record_credit_charge returned/);
  });
});

describe('not AI-specific: any service charges the one pool (user decision 2026-09-29)', () => {
  it('passes a non-AI service through unchanged', async () => {
    const { client, recorded } = mockClient({ data: [ROW], error: null });

    await new BusinessOsCreditChargeRepository(client).recordCharge({
      ...CHARGE,
      service: 'notification_email',
      actionType: 'client_reminder_email',
      isFallbackPriced: false,
    });

    expect(recorded.rpc?.[1]).toEqual({
      ...EXPECTED_ARGS,
      p_service: 'notification_email',
      p_action_type: 'client_reminder_email',
    });
  });
});

describe('the input is the record chargeResolver builds plus service (3a → 3b-ii hand-off)', () => {
  it('an AiChargeRecord plus service is assignable to the repository input, with the same keys', () => {
    // Compile-time half: this assignment fails `tsc` if the two drift.
    const record: AiChargeRecord = {
      actionId: CHARGE.actionId,
      accountId: CHARGE.accountId,
      groupId: CHARGE.groupId,
      actionType: 'chat_turn',
      trigger: 'scheduled',
      outcome: 'failed',
      credits: 1,
      costUsd: 0.001,
      creditValueVersion: 0,
      isFallbackPriced: true,
    };
    // The 3b-ii recorder adds the service; chargeResolver stays AI-only.
    const input: BusinessOsCreditChargeInput = { ...record, service: 'ai' };

    expect(Object.keys(input).sort()).toEqual(Object.keys(CHARGE).sort());
    expect(Object.keys(record)).not.toContain('service');
  });
});

describe('guardrail: the AI charge recorder is the only production caller (3b-ii, D-13)', () => {
  const ROOT = process.cwd();
  const SCANNED_DIRS = ['app', 'lib', 'components', 'hooks', 'scripts', 'pages', 'middleware.ts'];
  const SYMBOLS = ['BusinessOsCreditChargeRepository', 'businessOsCreditChargeRepository', 'business_os_record_credit_charge'];
  /**
   * The repository, the barrel and the tests, plus — since slice 3b-ii — the
   * one production writer, `aiChargeRecorder.ts`, and the two suites that fake
   * the repository under it. Adding a file here is where someone states, in a
   * reviewable diff, what else starts writing the ledger.
   */
  const ALLOWED = new Set(
    [
      'lib/repositories/BusinessOsCreditChargeRepository.ts',
      'lib/repositories/index.ts',
      'lib/repositories/__tests__/BusinessOsCreditChargeRepository.test.ts',
      // Slice 3b-ii (D-13): the only production writer, and its tests.
      'lib/business-os/llm/aiChargeRecorder.ts',
      'lib/business-os/llm/__tests__/aiChargeRecorder.test.ts',
      'lib/business-os/llm/__tests__/aiActionAudit.test.ts',
    ].map((p) => p.split('/').join(sep))
  );

  function walk(path: string, out: string[] = []): string[] {
    let stats;
    try {
      stats = statSync(path);
    } catch {
      return out;
    }
    if (stats.isFile()) {
      if (/\.(ts|tsx|js|jsx)$/.test(path)) out.push(path);
      return out;
    }
    for (const entry of readdirSync(path)) {
      if (entry === 'node_modules' || entry === '.next' || entry === '.claude') continue;
      walk(join(path, entry), out);
    }
    return out;
  }

  const files = SCANNED_DIRS.flatMap((dir) => walk(join(ROOT, dir)));

  it('scans a non-trivial number of files', () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it.each(SYMBOLS)('only the repository layer names %s', (symbol) => {
    const referrers = files
      .filter((file) => readFileSync(file, 'utf8').includes(symbol))
      .map((file) => relative(ROOT, file))
      .filter((rel) => !ALLOWED.has(rel))
      .sort();

    expect(referrers).toEqual([]);
  });
});
