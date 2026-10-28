/**
 * The browser seam for the module export (export redesign MX-1b, workplan §8,
 * T-7; SA workplan review C-1). Only the route's own 404 means "off"; a server
 * error with our JSON body means "on, history unavailable"; a network error, a
 * timeout or a non-JSON page means "unknown" (the button keeps the ZIP).
 */

const logged: unknown[][] = [];
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {};
  for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = (...args: unknown[]) => logged.push([level, ...args]);
  logger.child = () => logger;
  return { createLogger: () => logger };
});

import {
  MODULE_EXPORT_PROBE_TIMEOUT_MS,
  MODULE_EXPORT_URL,
  fetchModuleExportHistory,
  startModuleExport,
} from '../businessOsDataExport';

const REQUEST = '33333333-3333-4333-8333-333333333333';
const T = '2026-10-27T10:05:00.000Z';
const EMAIL = 'owner@example.com';

const fetchMock = jest.fn();
const originalFetch = global.fetch;
beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterAll(() => {
  global.fetch = originalFetch;
});
beforeEach(() => {
  fetchMock.mockReset();
  logged.length = 0;
});

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const htmlResponse = (status: number) => new Response('<html>Not here</html>', { status, headers: { 'Content-Type': 'text/html' } });

const HISTORY = {
  success: true,
  data: {
    requests: [
      { requestId: REQUEST, requestedAt: T, origin: 'owner', modules: [{ module: 'clients', status: 'sent', sentAt: T, emailCount: 2 }] },
    ],
  },
};

describe('fetchModuleExportHistory (C-1)', () => {
  it('GETs the route, same-origin, no-store, with an abort signal', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, HISTORY));
    await fetchModuleExportHistory();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(MODULE_EXPORT_URL);
    expect(MODULE_EXPORT_URL).toBe('/api/business-os/export-requests');
    expect(init).toMatchObject({ method: 'GET', credentials: 'same-origin', cache: 'no-store' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('200 with a valid body → ok with the history', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, HISTORY));
    expect(await fetchModuleExportHistory()).toEqual({ kind: 'ok', requests: HISTORY.data.requests });
  });

  it("our own 404 (JSON, success false) → off", async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { success: false, error: 'Not found' }));
    expect(await fetchModuleExportHistory()).toEqual({ kind: 'off' });
  });

  it('a 404 page that is not ours (HTML, or JSON of another shape) → unknown, never off', async () => {
    fetchMock.mockResolvedValue(htmlResponse(404));
    expect(await fetchModuleExportHistory()).toEqual({ kind: 'unknown' });
    fetchMock.mockResolvedValue(jsonResponse(404, { message: 'nope' }));
    expect(await fetchModuleExportHistory()).toEqual({ kind: 'unknown' });
  });

  it.each([401, 429, 500])('%p with our JSON body → error (the switch is on)', async (status) => {
    fetchMock.mockResolvedValue(jsonResponse(status, { success: false, error: 'x' }));
    expect(await fetchModuleExportHistory()).toEqual({ kind: 'error' });
  });

  it('a 200 of the wrong shape → error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, data: { requests: [{ requestId: 'x' }] } }));
    expect(await fetchModuleExportHistory()).toEqual({ kind: 'error' });
  });

  it.each([502, 504])('a non-JSON platform page %p → unknown', async (status) => {
    fetchMock.mockResolvedValue(htmlResponse(status));
    expect(await fetchModuleExportHistory()).toEqual({ kind: 'unknown' });
  });

  it('a network error → unknown, never a throw', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await fetchModuleExportHistory()).toEqual({ kind: 'unknown' });
  });

  it('the 5 s timeout → unknown', async () => {
    jest.useFakeTimers();
    try {
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
          })
      );
      const pending = fetchModuleExportHistory();
      await jest.advanceTimersByTimeAsync(MODULE_EXPORT_PROBE_TIMEOUT_MS + 1);
      expect(await pending).toEqual({ kind: 'unknown' });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('startModuleExport', () => {
  it('POSTs { modules } and nothing else', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { success: true, data: { requestId: REQUEST, sentTo: EMAIL, requestedEmailSent: true } }));
    await startModuleExport(['clients', 'quotes']);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(MODULE_EXPORT_URL);
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', cache: 'no-store' });
    expect(JSON.parse(init.body)).toEqual({ modules: ['clients', 'quotes'] });
  });

  it('201 → started, and the address is never logged', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { success: true, data: { requestId: REQUEST, sentTo: EMAIL, requestedEmailSent: false } }));
    expect(await startModuleExport(['clients'])).toEqual({ kind: 'started', requestId: REQUEST, sentTo: EMAIL, requestedEmailSent: false });
    expect(JSON.stringify(logged)).not.toContain(EMAIL);
  });

  it.each([
    [409, { success: false, code: 'export_in_progress' }, { kind: 'refused', code: 'in_progress' }],
    [409, { success: false, code: 'export_daily_limit', retryAt: T }, { kind: 'refused', code: 'daily_limit', retryAt: T }],
    [409, { success: false, code: 'export_no_login_email' }, { kind: 'refused', code: 'no_login_email' }],
    // SA CR-2: a daily limit with no retry time is a failure, never "already running".
    [409, { success: false, code: 'export_daily_limit' }, { kind: 'refused', code: 'failed' }],
    [409, { success: false, code: 'export_daily_limit', retryAt: null }, { kind: 'refused', code: 'failed' }],
    [400, { success: false, code: 'invalid_input' }, { kind: 'refused', code: 'invalid' }],
    [404, { success: false, error: 'Not found' }, { kind: 'refused', code: 'off' }],
    [401, { success: false }, { kind: 'refused', code: 'unauthorized' }],
    [429, { success: false }, { kind: 'refused', code: 'throttled' }],
    [500, { success: false }, { kind: 'refused', code: 'failed' }],
  ])('%p %j → %j', async (status, body, expected) => {
    fetchMock.mockResolvedValue(jsonResponse(status, body));
    expect(await startModuleExport(['clients'])).toEqual(expected);
  });

  it('a non-JSON page → failed; a network error → network; never a throw', async () => {
    fetchMock.mockResolvedValue(htmlResponse(504));
    expect(await startModuleExport(['clients'])).toEqual({ kind: 'refused', code: 'failed' });
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await startModuleExport(['clients'])).toEqual({ kind: 'refused', code: 'network' });
  });
});
