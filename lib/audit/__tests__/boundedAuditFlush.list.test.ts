/**
 * `logAndFlush` with a LIST of entries (plan payments P-5a.1, workplan
 * BUSINESS_OS_PLAN_PAYMENTS_P5A_WORKPLAN.md §3.2; SA ruling Q-1, condition
 * W-6). The first payment stamp entry rides with the invoice-paid entry under
 * one bounded flush, so a companion never costs a second serial flush.
 *
 * The single-entry form is pinned, unedited, by `boundedAuditFlush.test.ts`.
 * This file covers only what the list adds: order, one flush, one chain link,
 * the empty list, and the `actions` field in the timeout and failure logs.
 */

jest.mock('@/lib/services/AuditTrailService', () => ({
  // The default sink. Every test here injects its own, so this must stay unused.
  AuditTrail: {
    log: async () => {
      throw new Error('default sink used');
    },
    flush: async () => {
      throw new Error('default sink used');
    },
  },
}));

import { AUDIT_FLUSH_TIMEOUT_MS, logAndFlush, __resetAuditFlushChainForTests } from '../boundedAuditFlush';
import type { AuditLogInput } from '../types';

const logs: Array<{ level: string; ctx: Record<string, unknown>; msg: string }> = [];
const testLogger = {
  warn: (ctx: Record<string, unknown>, msg: string) => logs.push({ level: 'warn', ctx, msg }),
  error: (ctx: Record<string, unknown>, msg: string) => logs.push({ level: 'error', ctx, msg }),
};

const CONTEXT = { reason: 'plan change', continues: 'the plan change stands' };

const entry = (action: string, id: string): AuditLogInput => ({
  action,
  entityType: 'business_os_account_plan',
  entityId: id,
  userId: 'account-1',
});

function recordingSink(opts: { failLogAt?: number; flushHangs?: boolean } = {}) {
  const calls: string[] = [];
  let logged = 0;
  return {
    calls,
    log: async (item: AuditLogInput) => {
      logged += 1;
      if (opts.failLogAt === logged) throw new Error('queue refused');
      calls.push(`log:${item.action}`);
    },
    flush: () => {
      calls.push('flush');
      return opts.flushHangs ? new Promise<void>(() => undefined) : Promise.resolve();
    },
  };
}

beforeEach(() => {
  logs.length = 0;
  __resetAuditFlushChainForTests();
});

describe('a list of entries', () => {
  it('logs every entry in order, the first first, then flushes ONCE', async () => {
    const sink = recordingSink();
    await logAndFlush([entry('MAIN', 'a'), entry('COMPANION', 'b')], testLogger, CONTEXT, sink);
    expect(sink.calls).toEqual(['log:MAIN', 'log:COMPANION', 'flush']);
    expect(logs).toEqual([]);
  });

  it('an empty list resolves with no log() and no flush()', async () => {
    const sink = recordingSink();
    await expect(logAndFlush([], testLogger, CONTEXT, sink)).resolves.toBeUndefined();
    expect(sink.calls).toEqual([]);
  });

  it('a list is ONE chain link: a later caller waits for the whole list and its flush', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slowSink = {
      log: async (item: AuditLogInput) => {
        order.push(`log:${item.action}`);
      },
      flush: async () => {
        order.push('flush 1 start');
        await gate;
        order.push('flush 1 end');
      },
    };
    const fastSink = {
      log: async (item: AuditLogInput) => {
        order.push(`log:${item.action}`);
      },
      flush: async () => {
        order.push('flush 2');
      },
    };
    const first = logAndFlush([entry('MAIN', 'a'), entry('COMPANION', 'b')], testLogger, CONTEXT, slowSink);
    const second = logAndFlush(entry('NEXT', 'c'), testLogger, CONTEXT, fastSink);
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(order).toEqual(['log:MAIN', 'log:COMPANION', 'flush 1 start']);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['log:MAIN', 'log:COMPANION', 'flush 1 start', 'flush 1 end', 'log:NEXT', 'flush 2']);
  });

  it('a failure is swallowed and logged at error with every action named, never thrown', async () => {
    const sink = recordingSink({ failLogAt: 2 });
    await expect(logAndFlush([entry('MAIN', 'a'), entry('COMPANION', 'b')], testLogger, CONTEXT, sink)).resolves.toBeUndefined();
    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe('error');
    expect(logs[0].ctx).toEqual({ err: expect.any(Error), userId: 'account-1', actions: ['MAIN', 'COMPANION'] });
    expect(logs[0].msg).toBe('Audit flush on plan change failed; the plan change stands');
  });

  it('a hung flush releases the caller at the bound, with a warning naming every action', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    try {
      const sink = recordingSink({ flushHangs: true });
      let settled = false;
      const pending = logAndFlush([entry('MAIN', 'a'), entry('COMPANION', 'b')], testLogger, CONTEXT, sink).then(() => {
        settled = true;
      });
      await jest.advanceTimersByTimeAsync(AUDIT_FLUSH_TIMEOUT_MS - 1);
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(2);
      await pending;
      expect(settled).toBe(true);
      expect(logs).toEqual([
        {
          level: 'warn',
          ctx: { userId: 'account-1', actions: ['MAIN', 'COMPANION'], timeoutMs: AUDIT_FLUSH_TIMEOUT_MS },
          msg: 'Audit flush on plan change timed out; the plan change stands',
        },
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('one entry passed alone keeps the original log fields (action, not actions)', async () => {
    const sink = recordingSink({ failLogAt: 1 });
    await logAndFlush(entry('ONLY', 'a'), testLogger, CONTEXT, sink);
    expect(logs[0].ctx).toEqual({ err: expect.any(Error), userId: 'account-1', action: 'ONLY' });
    expect(Object.keys(logs[0].ctx)).toEqual(['err', 'userId', 'action']);
  });
});
