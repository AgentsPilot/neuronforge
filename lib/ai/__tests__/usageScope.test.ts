/**
 * The usage-scope accumulator and its hook in BaseAIProvider.callWithTracking
 * (Business OS Layer 3, FR-8; workplan T-U1 to T-U7; SA WC-1).
 *
 * Calls go through the REAL callWithTracking on a minimal provider; only the
 * ledger tracker is faked, so what the tracker receives is observable.
 */

const mockLogged: Array<{ level: string; fields: Record<string, unknown>; msg: string }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      logger[level] = (first: unknown, second?: unknown) => {
        const fields = typeof first === 'object' && first !== null ? JSON.parse(JSON.stringify(first)) : {};
        mockLogged.push({ level, fields, msg: typeof first === 'string' ? first : String(second ?? '') });
      };
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import { hasActiveUsageScope, notifyUsage, withUsageScope, type UsageCallRecord } from '../usageScope';
import { BaseAIProvider, type CallContext } from '../providers/baseProvider';
import type { AIAnalyticsService, AICallData } from '@/lib/analytics/aiAnalytics';

const GROUP = '33333333-3333-4333-8333-333333333333';
const OTHER_GROUP = '44444444-4444-4444-8444-444444444444';

const mockTrack = jest.fn();

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

const provider = new TestProvider({ trackAICall: (d: AICallData) => mockTrack(d) } as unknown as AIAnalyticsService);

function ctx(sessionId: string | undefined, component = 'planner'): CallContext {
  return { userId: '2f734ed5-3681-4049-880d-3de7b096bea3', sessionId, feature: 'business-os-chat', component };
}

/** One LLM call through the real callWithTracking. */
function call(sessionId: string | undefined, opts: { fail?: boolean; component?: string; tokens?: number } = {}) {
  return provider.callWithTracking(
    ctx(sessionId, opts.component),
    'openai',
    'gpt-test',
    'chat/completions',
    async () => {
      if (opts.fail) throw Object.assign(new Error('provider said no'), { code: 'rate_limit_exceeded' });
      return { tokens: opts.tokens ?? 10 };
    },
    (r: { tokens: number }) => ({ inputTokens: r.tokens, outputTokens: 5, cost: 0.001 })
  );
}

beforeEach(() => {
  mockTrack.mockReset();
  mockTrack.mockResolvedValue(undefined);
  mockLogged.length = 0;
});

describe('withUsageScope (T-U1 to T-U4, T-U7)', () => {
  it('collects every call made inside it, including from parallel branches (T-U1)', async () => {
    const outcome = await withUsageScope(GROUP, async () => {
      await call(GROUP, { component: 'planner', tokens: 100 });
      await Promise.all([call(GROUP, { component: 'analysis' }), call(GROUP, { component: 'plan_cache_lookup_embedding' })]);
      return 'answer';
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.value).toBe('answer');
    expect(outcome.usage.calls.map((c) => c.component).sort()).toEqual(['analysis', 'plan_cache_lookup_embedding', 'planner']);
    expect(outcome.usage.calls.find((c) => c.component === 'planner')).toEqual({
      feature: 'business-os-chat',
      component: 'planner',
      provider: 'openai',
      model: 'gpt-test',
      sessionId: GROUP,
      inputTokens: 100,
      outputTokens: 5,
      costUsd: 0.001,
      success: true,
    });
  });

  it('gives a nested scope its own calls only (innermost scope, T-U2)', async () => {
    let inner: UsageCallRecord[] = [];
    const outer = await withUsageScope(GROUP, async () => {
      await call(GROUP, { component: 'planner' });
      const nested = await withUsageScope(OTHER_GROUP, async () => {
        await call(OTHER_GROUP, { component: 'landing_page' });
      });
      inner = nested.usage.calls;
      await call(GROUP, { component: 'analysis' });
    });
    expect(inner.map((c) => c.component)).toEqual(['landing_page']);
    expect(outer.usage.calls.map((c) => c.component)).toEqual(['planner', 'analysis']);
  });

  it('leaves out a call carrying another grouping id, or none, and warns (T-U3)', async () => {
    const outcome = await withUsageScope(GROUP, async () => {
      await call(OTHER_GROUP);
      await call(undefined);
      await call(GROUP);
    });
    expect(outcome.usage.calls).toHaveLength(1);
    expect(outcome.usage.excluded).toBe(2);
    const warns = mockLogged.filter((l) => l.level === 'warn');
    expect(warns).toHaveLength(2);
    expect(warns[0].fields).toMatchObject({ groupId: GROUP, callSessionId: OTHER_GROUP, component: 'planner' });
  });

  it('drops a call that finishes after the scope closed (fire-and-forget work, T-U4)', async () => {
    let late: Promise<unknown> = Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const outcome = await withUsageScope(GROUP, async () => {
      await call(GROUP);
      late = gate.then(() => call(GROUP, { component: 'plan_cache_store_embedding' })); // not awaited
    });
    release();
    await late;
    expect(outcome.usage.calls).toHaveLength(1);
    expect(mockLogged.some((l) => l.level === 'debug' && /after its usage scope closed/.test(l.msg))).toBe(true);
    expect(hasActiveUsageScope()).toBe(false);
  });

  // SA CR-1: what concurrent requests on one serverless instance (and a cron
  // running businesses in parallel) rely on.
  it('keeps two independent scopes running at the same time apart, with interleaved awaits (CR-1)', async () => {
    const tick = () => new Promise<void>((r) => setImmediate(r));
    const order: string[] = [];
    const [a, b] = await Promise.all([
      withUsageScope(GROUP, async () => {
        order.push('a1');
        await call(GROUP, { component: 'planner' });
        await tick();
        order.push('a2');
        await call(GROUP, { component: 'analysis' });
      }),
      withUsageScope(OTHER_GROUP, async () => {
        order.push('b1');
        await tick();
        await call(OTHER_GROUP, { component: 'landing_page' });
        order.push('b2');
        await tick();
        await call(OTHER_GROUP, { component: 'full_site' });
      }),
    ]);
    // The two really interleaved (b started before a finished).
    expect(order.indexOf('b1')).toBeLessThan(order.indexOf('a2'));
    expect(a.usage.calls.map((c) => c.component)).toEqual(['planner', 'analysis']);
    expect(a.usage.calls.every((c) => c.sessionId === GROUP)).toBe(true);
    expect(b.usage.calls.map((c) => c.component)).toEqual(['landing_page', 'full_site']);
    expect(b.usage.calls.every((c) => c.sessionId === OTHER_GROUP)).toBe(true);
    expect(a.usage.excluded + b.usage.excluded).toBe(0);
  });

  it("hands back the function's error instead of swallowing it (T-U7)", async () => {
    const boom = new Error('boom');
    const outcome = await withUsageScope(GROUP, async () => {
      await call(GROUP);
      throw boom;
    });
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error).toBe(boom);
    expect(outcome.usage.calls).toHaveLength(1);
  });

  it('is a no-op outside any scope', () => {
    expect(hasActiveUsageScope()).toBe(false);
    expect(() => notifyUsage({ feature: 'f', component: 'c', provider: 'p', model: 'm', inputTokens: 0, outputTokens: 0, costUsd: 0, success: true })).not.toThrow();
    expect(mockLogged).toHaveLength(0);
  });
});

describe('the callWithTracking hook', () => {
  it('records a failed call with its error code, never its message', async () => {
    const outcome = await withUsageScope(GROUP, async () => {
      await call(GROUP, { fail: true }).catch(() => undefined);
    });
    expect(outcome.usage.calls).toEqual([
      expect.objectContaining({ success: false, errorCode: 'rate_limit_exceeded', inputTokens: 0, costUsd: 0 }),
    ]);
    expect(JSON.stringify(outcome.usage)).not.toContain('provider said no');
  });

  it('notifies exactly once when the success-branch tracker throws (SA WC-1)', async () => {
    // The first tracker call (success) throws; the catch then writes the failure row.
    mockTrack.mockRejectedValueOnce(new Error('tracker down')).mockResolvedValueOnce(undefined);
    const outcome = await withUsageScope(GROUP, async () => {
      await call(GROUP).catch(() => undefined);
    });
    expect(mockTrack).toHaveBeenCalledTimes(2); // unchanged ledger behaviour
    expect(outcome.usage.calls).toHaveLength(1);
    expect(outcome.usage.calls[0].success).toBe(true);
  });

  it('never fails the call when the scope bookkeeping throws (T-U5)', async () => {
    const outcome = await withUsageScope(GROUP, async () => {
      // A record that throws when read: the notification must swallow it.
      const hostile = new Proxy({} as UsageCallRecord, {
        get: () => {
          throw new Error('bad record');
        },
      });
      expect(() => notifyUsage(hostile)).not.toThrow();
      return call(GROUP);
    });
    expect(outcome.ok).toBe(true);
    expect(mockLogged.some((l) => l.level === 'warn' && l.msg === 'Usage scope notification failed')).toBe(true);
  });

  it('sends the tracker a byte-identical payload with and without a scope (T-U6, FR-19)', async () => {
    const strip = (d: AICallData) => {
      const { call_id: _c, latency_ms: _l, ...rest } = d as AICallData & { call_id?: string; latency_ms?: number };
      return rest;
    };
    await call(GROUP, { tokens: 42 });
    await call(GROUP, { fail: true }).catch(() => undefined);
    const without = mockTrack.mock.calls.map(([d]) => strip(d));

    mockTrack.mockClear();
    await withUsageScope(GROUP, async () => {
      await call(GROUP, { tokens: 42 });
      await call(GROUP, { fail: true }).catch(() => undefined);
    });
    const within = mockTrack.mock.calls.map(([d]) => strip(d));

    expect(JSON.stringify(within)).toBe(JSON.stringify(without));
    expect(without).toHaveLength(2);
  });
});
