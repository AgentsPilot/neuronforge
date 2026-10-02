/**
 * The bounded audit flush (T1), and the concurrency hole SA found in the code
 * it was extracted from (review M-1).
 *
 * The fake service below reproduces the ONE behaviour that matters:
 * `AuditTrailService.flush()` opens with
 * `if (this.isFlushing || this.logQueue.length === 0) return;` and clears the
 * queue before awaiting the insert. A fake that merely resolves would make the
 * serialisation untestable — and the bug invisible — so this one has a real
 * `isFlushing` flag and a real early return.
 */

const writes: string[][] = [];

/** A stand-in for the service, faithful about `isFlushing` and the early return. */
const fake = {
  queue: [] as string[],
  isFlushing: false,
  /** Makes the next insert reject. */
  failNextInsert: false,
  /** Set by `holdInsert()`; the next insert parks here until released. */
  hold: null as null | { entered: () => void; gate: Promise<void> },

  /**
   * Hold the next insert open, and say exactly when it started.
   *
   * Counting microtasks instead would be a trap: the number of `.then` hops
   * before the insert differs with and without the serialising chain, so a tick
   * count tuned to one of them silently mis-tests the other.
   */
  holdInsert(): { entered: Promise<void>; release: () => void } {
    let entered!: () => void;
    let release!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fake.hold = { entered, gate };
    return { entered: enteredPromise, release };
  },

  async log(entry: { entityId?: string | null }) {
    fake.queue.push(String(entry.entityId));
  },

  async flush() {
    if (fake.isFlushing || fake.queue.length === 0) return; // the real early return
    fake.isFlushing = true;
    try {
      const batch = [...fake.queue];
      fake.queue = []; // cleared BEFORE the insert, as the real service does
      const held = fake.hold;
      if (held) {
        fake.hold = null;
        held.entered();
        await held.gate;
      }
      if (fake.failNextInsert) {
        fake.failNextInsert = false;
        throw new Error('insert failed');
      }
      writes.push(batch);
    } finally {
      fake.isFlushing = false;
    }
  },
};

jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrail: {
    log: (entry: unknown) => fake.log(entry as { entityId?: string | null }),
    flush: () => fake.flush(),
  },
}));

import {
  AUDIT_FLUSH_TIMEOUT_MS,
  logAndFlush,
  __resetAuditFlushChainForTests,
} from '../boundedAuditFlush';
import type { AuditLogInput } from '../types';

const logs: Array<{ level: string; ctx: Record<string, unknown>; msg: string }> = [];
const testLogger = {
  warn: (ctx: Record<string, unknown>, msg: string) => logs.push({ level: 'warn', ctx, msg }),
  error: (ctx: Record<string, unknown>, msg: string) => logs.push({ level: 'error', ctx, msg }),
};

const entry = (id: string): AuditLogInput => ({
  action: 'SECURITY_UNAUTHORIZED_ACCESS',
  entityType: 'system',
  entityId: id,
  userId: `user-${id}`,
});

const REFUSAL = { reason: 'refused admin access', continues: 'the refusal is unaffected' };

beforeEach(() => {
  writes.length = 0;
  logs.length = 0;
  fake.queue = [];
  fake.isFlushing = false;
  fake.hold = null;
  fake.failNextInsert = false;
  __resetAuditFlushChainForTests();
});

afterEach(() => {
  // A test that fails mid-hold would otherwise leave an insert parked forever —
  // and its 2 s timer running into the next test's assertions.
  fake.hold?.entered();
  fake.hold = null;
});

describe('logAndFlush: one entry, written before the caller continues', () => {
  it('queues then flushes, in that order, and writes the entry', async () => {
    await logAndFlush(entry('a'), testLogger, REFUSAL);
    expect(writes).toEqual([['a']]);
    expect(fake.queue).toEqual([]);
    expect(logs).toEqual([]);
  });

  it('a rejecting flush is swallowed and logged at error, and it still resolves', async () => {
    fake.failNextInsert = true;
    await expect(logAndFlush(entry('a'), testLogger, REFUSAL)).resolves.toBeUndefined();
    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe('error');
    expect(logs[0].msg).toBe('Audit flush on refused admin access failed; the refusal is unaffected');
    expect(logs[0].ctx).toMatchObject({ userId: 'user-a', action: 'SECURITY_UNAUTHORIZED_ACCESS' });
  });

  it('logs ids and the event name only — never an email', async () => {
    fake.failNextInsert = true;
    await logAndFlush(
      { ...entry('a'), resourceName: 'leaky@example.com', details: { surface: 'admin_api' } },
      testLogger,
      REFUSAL
    );
    expect(JSON.stringify(logs)).not.toContain('leaky@example.com');
  });
});

describe('logAndFlush: the timeout is a bound on the caller, not on the write', () => {
  it('warns and resolves when the flush outlives the budget, and clears the timer', async () => {
    jest.useFakeTimers();
    try {
      const hold = fake.holdInsert();
      const flushing = logAndFlush(entry('a'), testLogger, REFUSAL);
      await hold.entered;
      jest.advanceTimersByTime(AUDIT_FLUSH_TIMEOUT_MS);
      await flushing;

      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe('warn');
      expect(logs[0].msg).toBe('Audit flush on refused admin access timed out; the refusal is unaffected');
      expect(logs[0].ctx).toMatchObject({ timeoutMs: AUDIT_FLUSH_TIMEOUT_MS });
      // The race is decided; nothing may still be scheduled on its behalf.
      expect(jest.getTimerCount()).toBe(0);

      hold.release();
    } finally {
      jest.useRealTimers();
    }
  });

  it('clears the timer on the normal path too (no open handle)', async () => {
    jest.useFakeTimers();
    try {
      await logAndFlush(entry('a'), testLogger, REFUSAL);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

/**
 * SA review M-1. Without the serialising chain, B's `flush()` hits the early
 * return and `logAndFlush` resolves REPORTING SUCCESS having written nothing —
 * which is how acceptance criterion 1 ("one row per refused request") was
 * falsified. These are the tests that would have caught it.
 */
describe('M-1: concurrent refusals on one instance each get their row', () => {
  /**
   * THE decisive case, and the one a naive concurrency test misses.
   *
   * Two calls in the same microtask round both get written even without the
   * chain, because B queues before A's flush takes its snapshot and A's single
   * batch carries both. The loss needs B to arrive while A's INSERT is in
   * flight: then A's batch is already gone, B's `flush()` hits
   * `if (this.isFlushing)` and returns having written nothing — while
   * `logAndFlush` reports success and the handler returns 403.
   *
   * Verified by reverting the chain locally: this test fails with B's entry
   * still sitting in the queue, and passes again with the chain restored.
   */
  it("B arriving while A's insert is in flight is still written (the real loss)", async () => {
    const hold = fake.holdInsert();
    const a = logAndFlush(entry('a'), testLogger, REFUSAL);
    await hold.entered; // A has queued, flushed, taken the batch, and is inserting
    expect(fake.isFlushing).toBe(true);

    const b = logAndFlush(entry('b'), testLogger, REFUSAL);
    // Give B room to reach its own `flush()` — the moment it would early-return
    // without the chain. Three hops is enough for log → flush.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    hold.release();
    await Promise.all([a, b]);

    expect(writes.flat().sort()).toEqual(['a', 'b']);
    expect(fake.queue).toEqual([]); // nothing left behind for a timer that will never run
    expect(logs).toEqual([]); // and no timeout, because the budget is seconds
  });

  it('two concurrent calls write BOTH entries', async () => {
    await Promise.all([
      logAndFlush(entry('a'), testLogger, REFUSAL),
      logAndFlush(entry('b'), testLogger, REFUSAL),
    ]);

    expect(writes.flat().sort()).toEqual(['a', 'b']);
    expect(fake.queue).toEqual([]);
    expect(logs).toEqual([]);
  });

  it('five concurrent calls lose nothing', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    await Promise.all(ids.map((id) => logAndFlush(entry(id), testLogger, REFUSAL)));
    expect(writes.flat().sort()).toEqual(ids);
    expect(fake.queue).toEqual([]);
  });

  it('a failing first write does not poison the chain for the second', async () => {
    fake.failNextInsert = true;
    const [, second] = await Promise.all([
      logAndFlush(entry('a'), testLogger, REFUSAL),
      logAndFlush(entry('b'), testLogger, REFUSAL),
    ]);

    expect(second).toBeUndefined();
    // 'a' was cleared from the queue by the failing flush (the service's own
    // documented behaviour); 'b' must still reach the database.
    expect(writes.flat()).toContain('b');
    expect(logs.filter((l) => l.level === 'error')).toHaveLength(1);
  });

  it('three later calls still work after one rejected (the chain survives the instance)', async () => {
    fake.failNextInsert = true;
    await logAndFlush(entry('a'), testLogger, REFUSAL);
    await logAndFlush(entry('b'), testLogger, REFUSAL);
    await logAndFlush(entry('c'), testLogger, REFUSAL);
    expect(writes.flat()).toEqual(['b', 'c']);
  });

  it('the 2 s budget is TOTAL per request, not per link (M-1 constraint 1)', async () => {
    // A hung first flush. The second caller waits behind it in the chain and
    // must still give up after ONE budget, not two.
    const hold = fake.holdInsert();
    const first = logAndFlush(entry('a'), testLogger, REFUSAL);
    await hold.entered;
    const second = logAndFlush(entry('b'), testLogger, REFUSAL);

    const started = Date.now();
    await Promise.all([first, second]);
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(AUDIT_FLUSH_TIMEOUT_MS * 2 - 200);
    expect(logs.filter((l) => l.level === 'warn')).toHaveLength(2);
    hold.release();
    // Both callers continued; neither threw.
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
  }, 10_000);
});
