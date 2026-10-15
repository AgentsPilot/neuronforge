/**
 * T-R: the server read of the platform's custom design tokens (performance
 * slice TH-1, TH-2 folded in; SA R2-Q2, R2-Q9, RC-10).
 *
 * The read sits on the render path of every owner page, so its contract is:
 * never reject, never wait past the deadline, never hammer the database, and
 * never log a token value.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const getByKey = jest.fn();
jest.mock('@/lib/repositories/SystemConfigRepository', () => ({
  systemConfigRepository: { getByKey: (...args: unknown[]) => getByKey(...args) },
}));

const logged: Array<{ level: string; obj: unknown; msg: string }> = [];
jest.mock('@/lib/logger', () => {
  const make = () => ({
    debug: (obj: unknown, msg: string) => logged.push({ level: 'debug', obj, msg }),
    info: (obj: unknown, msg: string) => logged.push({ level: 'info', obj, msg }),
    warn: (obj: unknown, msg: string) => logged.push({ level: 'warn', obj, msg }),
    error: (obj: unknown, msg: string) => logged.push({ level: 'error', obj, msg }),
  });
  return { createLogger: () => make() };
});

import {
  V2_CUSTOM_TOKENS_DEADLINE_MS,
  V2_CUSTOM_TOKENS_RETRY_BACKOFF_MS,
  V2_CUSTOM_TOKENS_TTL_MS,
  __resetV2CustomTokensCacheForTests,
  readV2CustomTokens as readV2CustomTokensForLayouts,
  readV2CustomTokensWithStatus,
} from '../server/readV2CustomTokens';

/** Most cases assert on the tokens only. */
const readV2CustomTokens = async () => (await readV2CustomTokensWithStatus()).tokens;
import { V2_CUSTOM_TOKENS_CONFIG_KEY } from '../customTokens';

const GOOD = { colors: { primary: '#0000A1', secondary: '#0000A2' } };
const row = (value: unknown) => ({ data: { key: V2_CUSTOM_TOKENS_CONFIG_KEY, value }, error: null });

let now = 1_000_000;
beforeEach(() => {
  __resetV2CustomTokensCacheForTests();
  getByKey.mockReset();
  logged.length = 0;
  now = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const warns = () => logged.filter((l) => l.level === 'warn');

describe('constants', () => {
  it('TTL 60 s, back-off 10 s, deadline 1000 ms', () => {
    expect(V2_CUSTOM_TOKENS_TTL_MS).toBe(60_000);
    expect(V2_CUSTOM_TOKENS_RETRY_BACKOFF_MS).toBe(10_000);
    expect(V2_CUSTOM_TOKENS_DEADLINE_MS).toBe(1000);
  });
});

describe('T-R1 never rejects', () => {
  it.each([
    ['an error result', () => Promise.resolve({ data: null, error: new Error('boom') })],
    ['a throw', () => Promise.reject(new Error('boom'))],
    ['a synchronous throw', () => { throw new Error('boom'); }],
    ['no row', () => Promise.resolve({ data: null, error: null })],
    ['a null value', () => Promise.resolve(row(null))],
    ['an array value', () => Promise.resolve(row([1, 2]))],
    ['a string value', () => Promise.resolve(row('#fff'))],
    ['a number value', () => Promise.resolve(row(7))],
  ])('%s → {}', async (_label, impl) => {
    getByKey.mockImplementation(impl);
    await expect(readV2CustomTokens()).resolves.toEqual({});
  });

  it('reads the constant key', async () => {
    getByKey.mockResolvedValue(row(GOOD));
    await readV2CustomTokens();
    expect(getByKey).toHaveBeenCalledWith(V2_CUSTOM_TOKENS_CONFIG_KEY);
  });
});

describe('T-R2 validated only, names-only logging', () => {
  it('returns only valid keys and logs the dropped names without values', async () => {
    getByKey.mockResolvedValue(row({ colors: { primary: '#0000A1', secondary: 'var(--SECRET-VALUE)', bogus: '#0000A9' } }));
    const out = await readV2CustomTokens();
    expect(out).toEqual({ colors: { primary: '#0000A1' } });
    expect(Object.isFrozen(out)).toBe(true);
    const dropped = warns().find((l) => (l.obj as { droppedKeys?: string[] }).droppedKeys);
    expect((dropped?.obj as { droppedKeys: string[] }).droppedKeys).toEqual(['colors.secondary']);
    const everything = JSON.stringify(logged);
    expect(everything).not.toContain('#0000A1');
    expect(everything).not.toContain('SECRET-VALUE');
  });

  it('on an error result logs a reason only, never the err (getByKey already logged it, R2-Q9)', async () => {
    getByKey.mockResolvedValue({ data: null, error: new Error('db down') });
    await readV2CustomTokens();
    expect(warns()).toHaveLength(1);
    expect(Object.keys(warns()[0].obj as object).sort()).toEqual(['ms', 'reason']);
    expect((warns()[0].obj as { reason: string }).reason).toBe('read_failed');
    expect(typeof (warns()[0].obj as { ms: number }).ms).toBe('number');
  });

  it('logs { err } for a throw it caught itself', async () => {
    getByKey.mockRejectedValue(new Error('socket'));
    await readV2CustomTokens();
    expect(warns()).toHaveLength(1);
    expect((warns()[0].obj as { err: Error }).err).toBeInstanceOf(Error);
    expect(typeof (warns()[0].obj as { ms: number }).ms).toBe('number');
  });
});

describe('T-R9 a completed read is logged at info with { ms, keys } only (SA CR-1)', () => {
  it('a successful cold read logs ms at info, and no logged object carries a token value', async () => {
    let release!: (v: unknown) => void;
    getByKey.mockReturnValue(new Promise((r) => { release = r; }));
    const pending = readV2CustomTokens();
    now += 37;
    release(row(GOOD));
    await pending;
    const infos = logged.filter((l) => l.level === 'info');
    expect(infos).toHaveLength(1);
    expect(infos[0].obj).toEqual({ ms: 37, keys: 1 });
    const everything = JSON.stringify(logged);
    expect(everything).not.toContain('#0000A1');
    expect(everything).not.toContain('#0000A2');
  });

  it('a cache hit logs nothing', async () => {
    getByKey.mockResolvedValue(row(GOOD));
    await readV2CustomTokens();
    logged.length = 0;
    await readV2CustomTokens();
    expect(logged).toEqual([]);
  });
});

describe('T-R10 stale-while-revalidate (SA RC-15), fake timers', () => {
  beforeEach(() => {
    // Timers only: Date.now stays on the test's own clock (`now`), so expiry is real.
    jest.useFakeTimers({ doNotFake: ['Date'] });
  });

  it('an expired value plus a never-resolving read returns the stale value without advancing timers; one call for ten callers; the next call gets the new value', async () => {
    getByKey.mockResolvedValueOnce(row(GOOD));
    await readV2CustomTokens();
    expect(getByKey).toHaveBeenCalledTimes(1);

    now += V2_CUSTOM_TOKENS_TTL_MS + 1;
    let release!: (v: unknown) => void;
    getByKey.mockReturnValueOnce(new Promise((r) => { release = r; }));

    const settled: unknown[] = [];
    for (let i = 0; i < 10; i++) void readV2CustomTokens().then((v) => settled.push(v));
    await jest.advanceTimersByTimeAsync(0);
    expect(settled).toHaveLength(10);
    for (const v of settled) expect(v).toEqual(GOOD);
    expect(getByKey).toHaveBeenCalledTimes(2);

    // SA-D1: nobody waited, so even a refresh slower than the page deadline
    // logs no "this page uses the defaults" warn.
    await jest.advanceTimersByTimeAsync(V2_CUSTOM_TOKENS_DEADLINE_MS * 3);
    expect(warns().filter((l) => (l.obj as { deadlineMs?: number }).deadlineMs !== undefined)).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);

    const NEW = { colors: { primary: '#0000B1' } };
    release(row(NEW));
    await jest.advanceTimersByTimeAsync(0);
    expect(await readV2CustomTokens()).toEqual(NEW);
    expect(getByKey).toHaveBeenCalledTimes(2);
  });
});

describe('T-R11 known / unknown status (SA RC-16)', () => {
  beforeEach(() => {
    // Timers only: Date.now stays on the test's own clock (`now`), so expiry is real.
    jest.useFakeTimers({ doNotFake: ['Date'] });
  });

  it('a cold read that lands in time is known', async () => {
    getByKey.mockResolvedValue(row(GOOD));
    expect(await readV2CustomTokensWithStatus()).toEqual({ tokens: GOOD, known: true });
  });

  it('a cold read that misses the page deadline is unknown ({}), and known once it lands', async () => {
    let release!: (v: unknown) => void;
    getByKey.mockReturnValue(new Promise((r) => { release = r; }));
    const pending = readV2CustomTokensWithStatus();
    await jest.advanceTimersByTimeAsync(V2_CUSTOM_TOKENS_DEADLINE_MS);
    expect(await pending).toEqual({ tokens: {}, known: false });
    release(row(GOOD));
    await jest.advanceTimersByTimeAsync(0);
    expect(await readV2CustomTokensWithStatus()).toEqual({ tokens: GOOD, known: true });
  });

  it('a cold failure is unknown, and stays unknown during the back-off', async () => {
    getByKey.mockResolvedValue({ data: null, error: new Error('down') });
    expect(await readV2CustomTokensWithStatus()).toEqual({ tokens: {}, known: false });
    now += 5_000;
    expect(await readV2CustomTokensWithStatus()).toEqual({ tokens: {}, known: false });
    expect(getByKey).toHaveBeenCalledTimes(1);
  });

  it('a caller with its own waitMs waits longer on the same flight, without a deadline warn from it', async () => {
    let release!: (v: unknown) => void;
    getByKey.mockReturnValue(new Promise((r) => { release = r; }));
    const route = readV2CustomTokensWithStatus({ waitMs: 5000 });
    await jest.advanceTimersByTimeAsync(3000);
    release(row(GOOD));
    await jest.advanceTimersByTimeAsync(0);
    expect(await route).toEqual({ tokens: GOOD, known: true });
    expect(getByKey).toHaveBeenCalledTimes(1);
  });

  it('a caller with its own waitMs gives up at that wait as unknown', async () => {
    getByKey.mockReturnValue(new Promise(() => {}));
    const route = readV2CustomTokensWithStatus({ waitMs: 5000 });
    await jest.advanceTimersByTimeAsync(5000);
    expect(await route).toEqual({ tokens: {}, known: false });
  });
});

describe('T-R3 cache', () => {
  it('serves from the cache within the TTL and reads again after it', async () => {
    getByKey.mockResolvedValue(row(GOOD));
    await readV2CustomTokens();
    now += V2_CUSTOM_TOKENS_TTL_MS;
    await readV2CustomTokens();
    expect(getByKey).toHaveBeenCalledTimes(1);
    now += 1;
    await readV2CustomTokens();
    expect(getByKey).toHaveBeenCalledTimes(2);
  });
});

describe('T-R4 single-flight', () => {
  it('ten concurrent callers on a cold cache cause one read', async () => {
    let release!: (v: unknown) => void;
    getByKey.mockReturnValue(new Promise((r) => { release = r; }));
    const calls = Array.from({ length: 10 }, () => readV2CustomTokens());
    release(row(GOOD));
    const results = await Promise.all(calls);
    expect(getByKey).toHaveBeenCalledTimes(1);
    for (const r of results) expect(r).toEqual(GOOD);
  });
});

describe('T-R5 stale-on-error', () => {
  it('serves the old value after a failed refresh and backs off for 10 s', async () => {
    getByKey.mockResolvedValueOnce(row(GOOD));
    await readV2CustomTokens();
    now += V2_CUSTOM_TOKENS_TTL_MS + 1;
    getByKey.mockResolvedValue({ data: null, error: new Error('down') });
    expect(await readV2CustomTokens()).toEqual(GOOD);
    expect(getByKey).toHaveBeenCalledTimes(2);

    now += 5_000;
    expect(await readV2CustomTokens()).toEqual(GOOD);
    expect(getByKey).toHaveBeenCalledTimes(2);

    now += V2_CUSTOM_TOKENS_RETRY_BACKOFF_MS;
    await readV2CustomTokens();
    expect(getByKey).toHaveBeenCalledTimes(3);
  });
});

describe('T-R5b negative back-off (RC-10(b))', () => {
  it('a cold failure returns {} and is not retried for 10 s', async () => {
    getByKey.mockResolvedValue({ data: null, error: new Error('down') });
    expect(await readV2CustomTokens()).toEqual({});
    now += 5_000;
    expect(await readV2CustomTokens()).toEqual({});
    expect(getByKey).toHaveBeenCalledTimes(1);
    now += V2_CUSTOM_TOKENS_RETRY_BACKOFF_MS;
    await readV2CustomTokens();
    expect(getByKey).toHaveBeenCalledTimes(2);
  });

  it('a cold throw is backed off the same way', async () => {
    getByKey.mockRejectedValue(new Error('socket'));
    await readV2CustomTokens();
    now += 5_000;
    await readV2CustomTokens();
    expect(getByKey).toHaveBeenCalledTimes(1);
  });
});

describe('T-R6 a reset (row deleted) is an answer, not an error', () => {
  it('after expiry the refresh caches {} as KNOWN, and the next call serves it', async () => {
    getByKey.mockResolvedValueOnce(row(GOOD));
    await readV2CustomTokens();
    now += V2_CUSTOM_TOKENS_TTL_MS + 1;
    getByKey.mockResolvedValueOnce({ data: null, error: null });
    // Stale-while-revalidate: this call still gets the old value at once (RC-15)...
    expect(await readV2CustomTokens()).toEqual(GOOD);
    await Promise.resolve(); await Promise.resolve();
    // ...and the next one the reset, as a known answer (no client correction).
    expect(await readV2CustomTokensWithStatus()).toEqual({ tokens: {}, known: true });
    expect(warns()).toHaveLength(0);
  });

  it('a cold reset (no row ever) is known too', async () => {
    getByKey.mockResolvedValue({ data: null, error: null });
    expect(await readV2CustomTokensWithStatus()).toEqual({ tokens: {}, known: true });
  });
});

describe('the layouts entry point', () => {
  it('readV2CustomTokens() returns the tokens with their status', async () => {
    getByKey.mockResolvedValue(row(GOOD));
    expect(await readV2CustomTokensForLayouts()).toEqual({ tokens: GOOD, known: true });
  });
});

describe('T-R7 server-only', () => {
  it('the module starts with import server-only', () => {
    const source = readFileSync(join(__dirname, '..', 'server', 'readV2CustomTokens.ts'), 'utf8');
    expect(source.trimStart().startsWith("import 'server-only';")).toBe(true);
  });
});

describe('T-R8 deadline (RC-10(a), (c))', () => {
  beforeEach(() => {
    // Timers only: Date.now stays on the test's own clock (`now`), so expiry is real.
    jest.useFakeTimers({ doNotFake: ['Date'] });
  });

  it('a read that never resolves gives {} at the deadline, with one warn for ten callers', async () => {
    let release!: (v: unknown) => void;
    getByKey.mockReturnValue(new Promise((r) => { release = r; }));
    let settled = 0;
    const calls = Array.from({ length: 10 }, () => readV2CustomTokens().then((v) => { settled++; return v; }));

    await jest.advanceTimersByTimeAsync(V2_CUSTOM_TOKENS_DEADLINE_MS - 1);
    expect(settled).toBe(0);
    await jest.advanceTimersByTimeAsync(1);
    const results = await Promise.all(calls);
    for (const r of results) expect(r).toEqual({});
    const deadlineWarns = warns().filter((l) => (l.obj as { deadlineMs?: number }).deadlineMs === V2_CUSTOM_TOKENS_DEADLINE_MS);
    expect(deadlineWarns).toHaveLength(1);

    // The read lands later and fills the cache; the next call reads nothing new.
    release(row(GOOD));
    await jest.advanceTimersByTimeAsync(0);
    expect(await readV2CustomTokens()).toEqual(GOOD);
    expect(getByKey).toHaveBeenCalledTimes(1);
  });

  it('with an expired cached value, that value is served at once (RC-15), not at the deadline', async () => {
    getByKey.mockResolvedValueOnce(row(GOOD));
    await readV2CustomTokens();
    now += V2_CUSTOM_TOKENS_TTL_MS + 1;
    getByKey.mockReturnValue(new Promise(() => {}));
    let settled: unknown;
    void readV2CustomTokens().then((v) => { settled = v; });
    await jest.advanceTimersByTimeAsync(0); // microtasks only, no time passes
    expect(settled).toEqual(GOOD);
  });

  it('a read that wins clears its timer and logs no deadline warning', async () => {
    getByKey.mockResolvedValue(row(GOOD));
    await readV2CustomTokens();
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(V2_CUSTOM_TOKENS_DEADLINE_MS * 2);
    expect(warns()).toHaveLength(0);
  });
});
