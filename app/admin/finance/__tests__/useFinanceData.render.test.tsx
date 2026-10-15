/**
 * @jest-environment jsdom
 *
 * Finance F-3: the finance hook reads its response through the shared
 * `readAdminResponse` (Admin Layout Standard C-4, §5.10) and logs through the
 * client logger (FU-5a-2).
 *
 * - The request is pinned byte for byte. This pin was written first and passed
 *   against the hook before F-3 changed it.
 * - Success keeps the payload as the route sent it.
 * - 401 and 403 show the shared "session ended" sentence.
 * - The route's own error string is shown verbatim.
 * - A rejected fetch shows ADMIN_NETWORK_ERROR.
 * - A non-JSON or malformed body shows the shared fallback.
 * - A failure clears the data.
 * - The newest read wins: an older request settling late never overwrites a
 *   newer one, on any path.
 */

import * as fs from 'fs';
import * as path from 'path';

import { act, renderHook, waitFor } from '@testing-library/react';

import { ADMIN_NETWORK_ERROR } from '@/app/admin/components/layout/readAdminResponse';
import { FINANCE_API_PATH, useFinanceData } from '@/app/admin/finance/useFinanceData';
import type { FinancePayload } from '@/lib/business-os/finance/financeTypes';

const mockLogError = jest.fn();
jest.mock('@/lib/logger/client', () => {
  const noop = () => undefined;
  return {
    clientLogger: {
      child: () => ({ error: (...args: unknown[]) => mockLogError(...args), warn: noop, info: noop, debug: noop }),
    },
  };
});

/** The shared copy, written out: the helper does not export these two sentences. */
const SESSION_ENDED = 'Your admin session has ended. Sign in again.';
const FALLBACK = 'Could not read the finance page. Try again in a moment.';
const CALLER_FALLBACK = 'The finance page could not be loaded.';

/** The payload is opaque to the hook; a branded object proves it is passed through untouched. */
const PAYLOAD = { marker: 'finance-payload', nested: { n: 1 } } as unknown as FinancePayload;

type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> };

function respond(body: unknown, status = 200): FakeResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function install(impl: (url: string, init?: RequestInit) => Promise<FakeResponse>): jest.Mock {
  const fetchMock = jest.fn(impl);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
  return fetchMock;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function mount(queryString = 'preset=this_month') {
  return renderHook(({ q }: { q: string }) => useFinanceData(q, CALLER_FALLBACK), { initialProps: { q: queryString } });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useFinanceData: the request (pinned before F-3)', () => {
  it('sends exactly one request: the same URL, query string and init as before', async () => {
    const fetchMock = install(async () => respond({ success: true, data: PAYLOAD }));
    const { result } = mount('preset=custom&from=2026-10-01&to=2026-10-15&account=abc');
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(FINANCE_API_PATH).toBe('/api/admin/business-os/finance');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/admin/business-os/finance?preset=custom&from=2026-10-01&to=2026-10-15&account=abc');
    expect(Object.keys(init).sort()).toEqual(['cache', 'signal']);
    expect(init.cache).toBe('no-store');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('Retry sends the same request again', async () => {
    const fetchMock = install(async () => respond({ success: true, data: PAYLOAD }));
    const { result } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.reload());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe(fetchMock.mock.calls[0][0]);
  });
});

describe('useFinanceData: success (unchanged)', () => {
  it('passes the payload through untouched, with no error', async () => {
    install(async () => respond({ success: true, data: PAYLOAD }));
    const { result } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBe(PAYLOAD);
    expect(result.current.error).toBeNull();
    expect(mockLogError).not.toHaveBeenCalled();
  });
});

describe('useFinanceData: failures (§5.10 through readAdminResponse)', () => {
  it.each([401, 403])('%s shows the shared "session ended" sentence, not the route words, and clears the data', async (status) => {
    install(async () => respond({ success: false, error: 'Admin access required' }, status));
    const { result } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(SESSION_ENDED);
    expect(result.current.data).toBeNull();
  });

  it.each([
    [500, 'Failed to load finance data'],
    [404, 'Business not found'],
  ])('%s with an error string shows the route words verbatim', async (status, words) => {
    install(async () => respond({ success: false, error: words }, status));
    const { result } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(words);
    expect(result.current.data).toBeNull();
  });

  it('a rejected fetch shows ADMIN_NETWORK_ERROR, never the browser message, and logs it', async () => {
    install(async () => {
      throw new TypeError('Failed to fetch');
    });
    const { result } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(ADMIN_NETWORK_ERROR);
    expect(result.current.error).not.toMatch(/Failed to fetch/);
    expect(result.current.data).toBeNull();
    expect(mockLogError).toHaveBeenCalledTimes(1);
    expect(mockLogError.mock.calls[0][1]).toBe('Failed to load the finance page');
  });

  it('a non-JSON body (an HTML 502 from the edge) shows the plain fallback, never the parser message', async () => {
    install(async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError("Unexpected token '<'");
      },
    }));
    const { result } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(FALLBACK);
    expect(result.current.data).toBeNull();
  });

  it.each([
    ['a 200 whose body is not an object', respond(['not', 'an', 'object'], 200)],
    ['a 200 without success: true', respond({ data: PAYLOAD }, 200)],
    ['a 500 with an empty error string', respond({ success: false, error: '   ' }, 500)],
    ['a 500 with a non-string error', respond({ success: false, error: { code: 'x' } }, 500)],
  ])('%s shows the plain fallback and clears the data', async (_label, response) => {
    install(async () => response);
    const { result } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(FALLBACK);
    expect(result.current.data).toBeNull();
  });

  it('a failure after a success clears the earlier data (today’s behaviour)', async () => {
    let call = 0;
    install(async () => (++call === 1 ? respond({ success: true, data: PAYLOAD }) : respond({ success: false, error: 'Boom' }, 500)));
    const { result } = mount();
    await waitFor(() => expect(result.current.data).toBe(PAYLOAD));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.error).toBe('Boom'));
    expect(result.current.data).toBeNull();
  });
});

describe('useFinanceData: the newest read wins', () => {
  const NEWER = { marker: 'newer' } as unknown as FinancePayload;

  async function raceWith(settleOlder: (older: ReturnType<typeof deferred<FakeResponse>>) => void) {
    const older = deferred<FakeResponse>();
    install(async (url) => (url.endsWith('q=old') ? older.promise : respond({ success: true, data: NEWER })));
    const { result, rerender } = mount('q=old');
    rerender({ q: 'q=new' });
    await waitFor(() => expect(result.current.data).toBe(NEWER));
    await act(async () => {
      settleOlder(older);
      await older.promise.catch(() => undefined);
      await new Promise((r) => setTimeout(r, 0));
    });
    return result;
  }

  it('an older route error settling late does not overwrite the newer data', async () => {
    const result = await raceWith((older) => older.resolve(respond({ success: false, error: 'Old failure' }, 500)));
    expect(result.current.data).toBe(NEWER);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('an older 401 settling late does not show "session ended" over the newer data', async () => {
    const result = await raceWith((older) => older.resolve(respond({ success: false, error: 'x' }, 401)));
    expect(result.current.data).toBe(NEWER);
    expect(result.current.error).toBeNull();
  });

  it('an older network failure settling late does not show the network sentence or log', async () => {
    const result = await raceWith((older) => older.reject(new TypeError('Failed to fetch')));
    expect(result.current.data).toBe(NEWER);
    expect(result.current.error).toBeNull();
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it('an older success settling late does not replace the newer data', async () => {
    const result = await raceWith((older) => older.resolve(respond({ success: true, data: PAYLOAD })));
    expect(result.current.data).toBe(NEWER);
  });
});

describe('useFinanceData source (F-3)', () => {
  const HOOK = path.join(process.cwd(), 'app', 'admin', 'finance', 'useFinanceData.ts');
  const code = fs
    .readFileSync(HOOK, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  /** Names the server entry `@/lib/logger` as a module specifier (the client entry `@/lib/logger/client` is fine). */
  const namesServerLogger = (src: string) => src.includes("'@/lib/logger'") || src.includes('"@/lib/logger"');

  it('the detectors bite (planted samples)', () => {
    expect(namesServerLogger("import { createLogger } from '@/lib/logger';")).toBe(true);
    expect(namesServerLogger("import { clientLogger } from '@/lib/logger/client';")).toBe(false);
    expect(/\.json\(/.test('const body = await response.json();')).toBe(true);
  });

  it('reads through readAdminResponse with sessionEndedCopy, never .json( itself, and logs through the client logger', () => {
    expect(code).toMatch(/readAdminResponse<FinancePayload>\(response, \{ what: FINANCE_WHAT, sessionEndedCopy: true \}\)/);
    expect(code).not.toMatch(/\.json\(/);
    expect(namesServerLogger(code)).toBe(false);
    expect(code).toMatch(/clientLogger\.child\(\{ module: 'AdminFinancePage' \}\)/);
  });

  it('no file under app/admin/finance imports the server logger (walked)', () => {
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === '__tests__' ? [] : walk(full);
        return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
      });
    const files = walk(path.join(process.cwd(), 'app', 'admin', 'finance'));
    expect(files.length).toBeGreaterThan(10);
    expect(files).toContain(HOOK);
    expect(files.filter((file) => namesServerLogger(fs.readFileSync(file, 'utf8')))).toEqual([]);
  });
});
