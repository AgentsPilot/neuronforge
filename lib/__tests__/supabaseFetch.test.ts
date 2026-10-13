/**
 * Supabase never gets more connections than it will accept.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Opening one CRM contact drawer fires nine API routes and thirty-odd queries
 * at once. Node's fetch caps nothing per host, so thirty TLS handshakes opened
 * together and the far end reset them:
 *
 *     TypeError: fetch failed … read ECONNRESET
 *       at PluginConnectionRepository.findActiveByUser
 *
 * The failure shape is what makes it dangerous: a dropped connection surfaces
 * as "no rows" or "not authorised", so a signed-in owner is told they have no
 * bookings rather than that something went wrong.
 *
 * These count sockets, not correctness.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const original = global.fetch;

let inFlight = 0;
let peak = 0;
let completed = 0;
let latency = 10;
let failNext = false;

beforeEach(() => {
  inFlight = 0;
  peak = 0;
  completed = 0;
  latency = 10;
  failNext = false;

  global.fetch = (async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    try {
      await new Promise(r => setTimeout(r, latency));
      if (failNext) {
        failNext = false;
        throw new Error('fetch failed');
      }
      completed++;
      return new Response('{}', { status: 200 });
    } finally {
      inFlight--;
    }
  }) as typeof fetch;
});

afterEach(() => {
  global.fetch = original;
});

import { supabaseFetch, supabaseFetchStats, timeoutMs } from '@/lib/supabaseFetch';

describe('a burst is queued, not dropped', () => {
  it('never exceeds the limit, however many arrive at once', async () => {
    /*
     * ─────────────────────────────────────────────────────────────────────
     * THE ONE THAT MATTERS.
     *
     * Forty concurrent queries is a realistic drawer-open. Before this they
     * all opened a socket; now at most twelve are in flight and the rest
     * wait a few milliseconds for a slot.
     * ─────────────────────────────────────────────────────────────────────
     */
    await Promise.all(Array.from({ length: 40 }, () => supabaseFetch('https://x.test')));

    expect(peak).toBeLessThanOrEqual(12);
    expect(completed).toBe(40);
  });

  it('serves every queued request rather than shedding any', async () => {
    // Waiting is invisible; being reset is a false 401.
    const responses = await Promise.all(
      Array.from({ length: 25 }, () => supabaseFetch('https://x.test'))
    );

    expect(responses).toHaveLength(25);
    expect(responses.every(r => r.status === 200)).toBe(true);
  });

  it('drains the pool completely when the burst is over', async () => {
    await Promise.all(Array.from({ length: 20 }, () => supabaseFetch('https://x.test')));

    expect(supabaseFetchStats()).toEqual(
      expect.objectContaining({ active: 0, waiting: 0 })
    );
  });
});

describe('a failed request does not leak its slot', () => {
  it('releases on throw, so the pool cannot stall', async () => {
    /*
     * The failure mode to avoid. Leak enough slots and every Supabase call in
     * the process blocks forever — a worse outage than the one being fixed.
     */
    failNext = true;
    await expect(supabaseFetch('https://x.test')).rejects.toThrow('fetch failed');

    expect(supabaseFetchStats().active).toBe(0);

    // And the pool still works afterwards.
    await Promise.all(Array.from({ length: 20 }, () => supabaseFetch('https://x.test')));
    expect(completed).toBe(20);
    expect(supabaseFetchStats().active).toBe(0);
  });
});

describe('a hung request cannot hold a slot for ever', () => {
  it('abandons it and frees the slot', async () => {
    /*
     * ─────────────────────────────────────────────────────────────────────
     * THE WAY THE FIX COULD BECOME THE OUTAGE.
     *
     * Node's fetch has no default timeout. A request that hangs rather than
     * failing keeps its slot for the life of the process, and twelve of
     * those block every Supabase call there is — a worse stall than the
     * unbounded sockets this file replaced.
     * ─────────────────────────────────────────────────────────────────────
     */
    process.env.SUPABASE_REQUEST_TIMEOUT_MS = '60';

    global.fetch = ((_input: unknown, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        /* Otherwise never settles — a hang, not a failure. */
      })) as typeof fetch;

    try {
      await expect(supabaseFetch('https://x.test')).rejects.toThrow();
      expect(supabaseFetchStats().active).toBe(0);
    } finally {
      delete process.env.SUPABASE_REQUEST_TIMEOUT_MS;
    }
  });
});

describe('the ceiling on one request', () => {
  const NODE_ENV = process.env.NODE_ENV;

  afterEach(() => {
    Object.defineProperty(process.env, 'NODE_ENV', { value: NODE_ENV, configurable: true });
    delete process.env.SUPABASE_REQUEST_TIMEOUT_MS;
  });

  /*
   * The clock starts AFTER a slot is acquired, so this bounds the request and
   * never the queue. In production twenty seconds means what it says: nothing
   * healthy takes that long against Supabase's tens of milliseconds.
   *
   * The dev server compiles routes on the same process and stalls for tens of
   * seconds while it does, so a fetch issued before a compile and read after
   * it aborts with nothing wrong at either end — and the abort surfaces inside
   * `GoTrueClient._getUser`, where it reads as an auth failure.
   */
  it('is more generous in development, where compiles block the loop', () => {
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'development', configurable: true });
    expect(timeoutMs()).toBe(60_000);

    Object.defineProperty(process.env, 'NODE_ENV', { value: 'production', configurable: true });
    expect(timeoutMs()).toBe(20_000);
  });

  it('still lets a deployment set its own', () => {
    process.env.SUPABASE_REQUEST_TIMEOUT_MS = '5000';
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'development', configurable: true });

    expect(timeoutMs()).toBe(5_000);
  });
});

describe('it stays out of the way when there is no burst', () => {
  it('adds no waiting for traffic under the limit', async () => {
    await Promise.all(Array.from({ length: 5 }, () => supabaseFetch('https://x.test')));

    expect(peak).toBe(5);
    expect(supabaseFetchStats().waiting).toBe(0);
  });
});
