/**
 * AIAnalyticsService.trackAICall — characterization of the inserted row, and of
 * what reaches the logs (logging clean-up workplan OI-4, T-5 / T-6, WC-4).
 *
 * Every `token_usage` row in the product is written here. This file was written
 * against the UNTOUCHED tracker (step 4a), before its logging moved from
 * `console.*` to Pino (step 4b). 4b must pass it without editing it or its
 * snapshot: that is the proof the row is byte-identical.
 *
 * Determinism: the clock is frozen (it feeds `metadata.timestamp`), and
 * `Math.random` is fixed (it feeds a generated `call_id`). No property matcher
 * hides any part of the row. `SYSTEM_ADMIN_USER_ID` is set and restored per case.
 */

import { inspect } from 'util';

/** Pino output, serialized at call time (used once the tracker logs through Pino). */
const mockLogged: Array<{ level: string; args: unknown[] }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      logger[level] = (...args: unknown[]) => mockLogged.push({ level, args: [inspect(args, { depth: 10 })] });
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import { AIAnalyticsService, type AICallData } from '@/lib/analytics/aiAnalytics';
import { ALL_ZERO_UUID } from '@/lib/platformAccount';

const OWNER = '2f734ed5-3681-4049-880d-3de7b096bea3';
const SESSION = '33333333-3333-4333-8333-333333333333';
const PLATFORM = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-09-18T10:00:00.000Z');
const SELECT = 'id, call_id, created_at, input_tokens, output_tokens';

/** Must never reach a log line, at any level. */
const SENTINEL = 'PAYLOAD-SENTINEL-rq8m';

type Insert = { table: string; row: Record<string, unknown>; select: string };

/** A fake Supabase client that records each insert and answers as configured. */
function fakeDb(answer: Answer) {
  const inserts: Insert[] = [];
  const client = {
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => ({
        select: (select: string) => {
          inserts.push({ table, row, select });
          return answer();
        },
      }),
    }),
  };
  return { client, inserts };
}

type Answer = () => Promise<{ data: unknown; error: unknown }>;

const ok: Answer = () =>
  Promise.resolve({
    data: [{ id: 'row-1', call_id: 'call-fixed', created_at: NOW.toISOString(), input_tokens: 120, output_tokens: 30 }],
    error: null,
  });

function fullCall(overrides: Partial<AICallData> = {}): AICallData {
  return {
    user_id: OWNER,
    provider: 'openai',
    model_name: 'gpt-4o',
    input_tokens: 120,
    output_tokens: 30,
    cost_usd: 0.0021,
    session_id: SESSION,
    call_id: 'call-fixed',
    endpoint: '/api/example',
    feature: 'business-os-onboarding',
    component: 'business_story_extraction',
    workflow_step: 'step-1',
    request_type: 'chat',
    category: 'onboarding',
    latency_ms: 812,
    response_size_bytes: 2048,
    success: true,
    activity_type: 'extraction',
    activity_name: 'extract_story',
    agent_id: 'agent-1',
    activity_step: 'story',
    request_payload: { prompt: `${SENTINEL} prompt` },
    response_metadata: { note: `${SENTINEL} response` },
    metadata: { execution_id: 'exec-1', extra: `${SENTINEL} metadata` },
    ...overrides,
  };
}

let savedPlatform: string | undefined;
let consoleOut: string[];

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  jest.setSystemTime(NOW);
  jest.spyOn(Math, 'random').mockReturnValue(0.123456789);
  savedPlatform = process.env.SYSTEM_ADMIN_USER_ID;
  delete process.env.SYSTEM_ADMIN_USER_ID;
  mockLogged.length = 0;
  consoleOut = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      consoleOut.push(inspect(args, { depth: 10 }));
    });
  }
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  if (savedPlatform === undefined) delete process.env.SYSTEM_ADMIN_USER_ID;
  else process.env.SYSTEM_ADMIN_USER_ID = savedPlatform;
});

/** Everything the tracker printed or logged, through either channel. */
function allOutput(): string {
  return [...consoleOut, ...mockLogged.map((l) => String(l.args[0]))].join('\n');
}

async function track(call: AICallData, answer: Answer = ok) {
  const db = fakeDb(answer);
  await expect(new AIAnalyticsService(db.client).trackAICall(call)).resolves.toBeUndefined();
  return db.inserts;
}

function onlyInsert(inserts: Insert[]): Record<string, unknown> {
  expect(inserts).toHaveLength(1);
  expect(inserts[0].table).toBe('token_usage');
  expect(inserts[0].select).toBe(SELECT);
  return inserts[0].row;
}

describe('trackAICall: the inserted row (T-5)', () => {
  it('(a) a full, valid call', async () => {
    const row = onlyInsert(await track(fullCall()));
    expect(row).toMatchSnapshot();
    // Snapshots sort keys; the serialized row is also pinned in its real key order.
    expect(JSON.stringify(row)).toMatchSnapshot();
  });

  it('(a2) the defaults: request type, category, success, no session, execution id from metadata', async () => {
    const row = onlyInsert(
      await track({
        user_id: OWNER,
        provider: 'anthropic',
        model_name: 'claude-x',
        input_tokens: 5,
        output_tokens: 0,
        cost_usd: 0,
        call_id: 'call-min',
        metadata: { execution_id: 'exec-from-metadata' },
      })
    );
    expect(row).toMatchSnapshot();
  });

  it('(b1) an invalid user_id with SYSTEM_ADMIN_USER_ID set: the platform account', async () => {
    process.env.SYSTEM_ADMIN_USER_ID = PLATFORM;
    const row = onlyInsert(await track(fullCall({ user_id: 'not-a-uuid' })));
    expect(row.user_id).toBe(PLATFORM);
    expect(row).toMatchSnapshot();
  });

  it('(b2) an invalid user_id with SYSTEM_ADMIN_USER_ID unset: the all-zero account', async () => {
    const row = onlyInsert(await track(fullCall({ user_id: 'not-a-uuid' })));
    expect(row.user_id).toBe(ALL_ZERO_UUID);
    expect(row).toMatchSnapshot();
  });

  it('(b3) an empty user_id: the platform account', async () => {
    process.env.SYSTEM_ADMIN_USER_ID = PLATFORM;
    const row = onlyInsert(await track(fullCall({ user_id: '' })));
    expect(row.user_id).toBe(PLATFORM);
  });

  it('(c) an invalid session_id: recorded as null', async () => {
    const row = onlyInsert(await track(fullCall({ session_id: 'not-a-uuid' })));
    expect(row.session_id).toBeNull();
    expect(row).toMatchSnapshot();
  });

  it('(d) no call_id: one is generated from the clock and Math.random', async () => {
    const row = onlyInsert(await track(fullCall({ call_id: undefined })));
    expect(row.call_id).toBe(`call_${NOW.getTime()}_4fzzzxjyl`);
    expect(row).toMatchSnapshot();
  });

  it('(e) a database error is swallowed after one insert', async () => {
    const inserts = await track(fullCall(), () =>
      Promise.resolve({ data: null, error: { message: 'insert failed', code: '23502', details: null, hint: null } })
    );
    onlyInsert(inserts);
  });

  it('(f) an insert that throws is swallowed', async () => {
    const db = {
      from: () => ({
        insert: () => ({
          select: () => {
            throw new Error('connection reset');
          },
        }),
      }),
    };
    await expect(new AIAnalyticsService(db).trackAICall(fullCall())).resolves.toBeUndefined();
  });

  it('(g) no client: nothing is inserted and nothing throws', async () => {
    await expect(new AIAnalyticsService(undefined).trackAICall(fullCall())).resolves.toBeUndefined();
  });
});

describe('trackAICall: payloads never reach the logs (T-6)', () => {
  it('on success', async () => {
    await track(fullCall());
    expect(allOutput()).not.toContain(SENTINEL);
  });

  it('on a database error', async () => {
    await track(fullCall(), () =>
      Promise.resolve({ data: null, error: { message: 'insert failed', code: '23502', details: null, hint: null } })
    );
    expect(allOutput()).not.toContain(SENTINEL);
  });

  it('on an exception', async () => {
    const db = {
      from: () => ({
        insert: () => ({
          select: () => {
            throw new Error('connection reset');
          },
        }),
      }),
    };
    await new AIAnalyticsService(db).trackAICall(fullCall({ error_message: `${SENTINEL} error` }));
    expect(allOutput()).not.toContain(SENTINEL);
  });

  it('the output is not empty: the check above is looking at something', async () => {
    await track(fullCall());
    expect(allOutput()).toContain('gpt-4o');
  });
});
