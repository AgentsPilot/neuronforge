/**
 * The Businesses drawer pin harness (Admin Layout follow-ups LF-4a.1; moved
 * here in LF-4b Step 12 by SA ruling, so there is one copy, not one per file).
 *
 * What it holds, and only that: the recording `fetch` stub, `deferred`,
 * `settle`, `quiet`, the console guard and the `crypto.randomUUID` counter,
 * plus the small readers of the recorded calls. Each pin file keeps its own
 * route table (`routeGet`, `routePost`, its fixtures and its `ok` / `refused`
 * replies) and hands the two routes over with `setRoutes`.
 *
 * Lives outside `__tests__` and has no `.test` suffix, so Jest does not
 * collect it as a suite. Jest gives every test file its own module registry,
 * so each pin file gets its own copy of the state below.
 *
 * The recorded state (`calls`, `unexpected`, `minted`) is emptied in place
 * before every test, never replaced, so a test file can import the arrays
 * once and read them in every test.
 *
 * Usage, at the top level of a pin file:
 *   setRoutes(routeGet, routePost);
 *   installPinLifecycle({ countUuids: true });
 * then `installFetch()` before rendering the page.
 */

import { act, waitFor } from '@testing-library/react';

export interface Reply {
  status: number;
  body?: unknown;
}
export type Queued = Reply | Promise<Reply>;

/** One request as `fetch` was given it. */
export interface Call {
  url: string;
  method: string;
  headers: HeadersInit | undefined;
  body: string | null;
  cache: RequestCache | undefined;
}

/** Every request of the current test, in order. */
export const calls: Call[] = [];
/** Requests the route table did not know; the console guard fails a test that has any. */
export const unexpected: string[] = [];
/** Every id `crypto.randomUUID` minted in the current test (with `countUuids`). */
export const minted: string[] = [];

/** Requests sent and not yet answered. */
let pending = 0;

type Route = (url: string) => Queued;
let routeGet: Route | null = null;
let routePost: Route | null = null;

/** The pin file's route table: one function for GET, one for every other method. */
export function setRoutes(get: Route, post: Route): void {
  routeGet = get;
  routePost = post;
}

/** The recording stub: every call is recorded, then answered from the route table. */
export function installFetch(): void {
  const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({
      url,
      method,
      headers: init?.headers,
      body: typeof init?.body === 'string' ? init.body : null,
      cache: init?.cache,
    });
    pending += 1;
    try {
      if (!routeGet || !routePost) throw new Error('drawerPinHarness: setRoutes was not called');
      const reply = await (method === 'GET' ? routeGet(url) : routePost(url));
      return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body } as unknown as Response;
    } finally {
      pending -= 1;
    }
  });
  global.fetch = fetchMock as unknown as typeof fetch;
}

/** The next queued answer; a POST nothing was queued for is unexpected (LF-4a.1 SA fix 4), and still answers 500. */
export function fromQueue(queue: Queued[], url: string): Queued {
  const next = queue.shift();
  if (next !== undefined) return next;
  unexpected.push(`POST ${url} (nothing queued)`);
  return { status: 500, body: { success: false, error: 'not queued' } };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const posts = () => calls.filter((c) => c.method === 'POST');
export const getCount = (url: string) => calls.filter((c) => c.method === 'GET' && c.url === url).length;
export const listReads = () => calls.filter((c) => c.method === 'GET' && c.url.startsWith('/api/admin/users?')).length;
export const bodyOf = (call: Call): unknown => JSON.parse(call.body ?? 'null');

/** The whole recorded request; the body parsed, or the raw string when `raw` (the reconcile body is the literal '{}'). */
export const requestOf = (call: Call, raw = false) => ({
  url: call.url,
  method: call.method,
  headers: call.headers,
  cache: call.cache,
  body: raw ? call.body : bodyOf(call),
});

/** Every request answered and every resulting state update flushed. */
export async function settle(): Promise<void> {
  await waitFor(() => expect(pending).toBe(0));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * Quiet: nothing in flight and no new request for a 300 ms window (real
 * timers), repeated until a window passes with no new call. A late extra read
 * (a timer after a success, say) lands inside the window and is counted.
 */
export async function quiet(): Promise<void> {
  await settle();
  let seen = -1;
  while (seen !== calls.length || pending !== 0) {
    seen = calls.length;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
  }
}

/**
 * The lifecycle every pin file shares: the browser APIs Radix wants and jsdom
 * lacks; before each test, empty records and (with `countUuids`) a
 * `crypto.randomUUID` that records what it mints; after each test, everything
 * answered, then fail on any unexpected request, console error or warning.
 * The spies are restored even when a guard fails, so none leaks into the next test.
 *
 * `endQuiet`: wait for `quiet()` instead of `settle()` before the guard, so a
 * request that lands late is still checked in the test that caused it.
 */
export function installPinLifecycle(options: { countUuids: boolean; endQuiet?: boolean }): void {
  let consoleError: jest.SpyInstance;
  let consoleWarn: jest.SpyInstance;

  beforeAll(() => {
    const proto = Element.prototype as unknown as Record<string, unknown>;
    proto.hasPointerCapture ??= () => false;
    proto.releasePointerCapture ??= () => undefined;
    proto.scrollIntoView ??= () => undefined;
  });

  beforeEach(() => {
    calls.length = 0;
    unexpected.length = 0;
    minted.length = 0;
    pending = 0;
    if (options.countUuids) {
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: {
          randomUUID: () => {
            const id = uuid(minted.length + 1);
            minted.push(id);
            return id;
          },
        },
      });
    }
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    try {
      await (options.endQuiet ? quiet() : settle());
      expect(unexpected).toEqual([]);
      expect(consoleError).not.toHaveBeenCalled();
      expect(consoleWarn).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
      consoleWarn.mockRestore();
    }
  });
}
