/**
 * The browser seam for "Download my data" (data export DE-9, workplan §3.2 /
 * §4 / §6; SA DE-9 C-5, C-6). Every server answer of §4 at helper level, the
 * non-JSON platform page, the 75 s client timer, and the https-only save.
 */

const logged: unknown[][] = [];
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {};
  for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = (...args: unknown[]) => logged.push([level, ...args]);
  logger.child = () => logger;
  return { createLogger: () => logger };
});

import {
  DATA_EXPORTS_URL,
  START_TIMEOUT_MS,
  browserNavigation,
  downloadDataExportAgain,
  fetchLastDataExport,
  isSafeDownloadUrl,
  saveSignedDownload,
  startDataExport,
  type DataExportReady,
} from '../businessOsDataExport';

const JOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SIGNED = 'https://x.supabase.co/storage/v1/object/sign/p/1.zip?token=SECRET-TOKEN';

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
const htmlResponse = (status: number) => new Response('<html>An error occurred</html>', { status, headers: { 'Content-Type': 'text/html' } });

const READY_BODY = {
  success: true,
  data: {
    jobId: JOB,
    downloadUrl: SIGNED,
    fileName: 'סטודיו-נוגה-2026-10-17.zip',
    asciiFileName: 'data-export-2026-10-17.zip',
    expiresAt: '2026-10-20T06:30:05.000Z',
    failedSections: [],
    missingFiles: 0,
  },
};

describe('startDataExport: the request', () => {
  it('POSTs an empty body to the zip route, same-origin, no-store, with an abort signal', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, READY_BODY));
    await startDataExport();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(DATA_EXPORTS_URL);
    expect(init).toMatchObject({ method: 'POST', body: '{}', credentials: 'same-origin', cache: 'no-store' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('startDataExport: every answer (§4)', () => {
  it('200: ready with the URL and names, not partial', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, READY_BODY));
    expect(await startDataExport()).toEqual({
      kind: 'ready',
      downloadUrl: SIGNED,
      fileName: READY_BODY.data.fileName,
      asciiFileName: READY_BODY.data.asciiFileName,
      expiresAt: READY_BODY.data.expiresAt,
      partial: false,
    });
  });

  it('200 with missing files or failed sections: partial', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ...READY_BODY, data: { ...READY_BODY.data, missingFiles: 2 } }));
    expect(await startDataExport()).toMatchObject({ kind: 'ready', partial: true });
    fetchMock.mockResolvedValue(jsonResponse(200, { ...READY_BODY, data: { ...READY_BODY.data, failedSections: ['invoices'] } }));
    expect(await startDataExport()).toMatchObject({ kind: 'ready', partial: true });
  });

  it('200 with an unexpected shape: failed, never a ready without a URL', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, data: { fileName: 'x.zip' } }));
    expect(await startDataExport()).toEqual({ kind: 'refused', code: 'failed' });
  });

  it('409 export_in_progress: in_progress', async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { success: false, code: 'export_in_progress', retryAt: '2026-10-17T07:01:00Z' }));
    expect(await startDataExport()).toEqual({ kind: 'refused', code: 'in_progress', retryAt: '2026-10-17T07:01:00Z' });
  });

  it('409 export_daily_limit: daily_limit with retryAt', async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { success: false, code: 'export_daily_limit', retryAt: '2026-10-18T06:30:00Z' }));
    expect(await startDataExport()).toEqual({ kind: 'refused', code: 'daily_limit', retryAt: '2026-10-18T06:30:00Z' });
  });

  it('413 export_too_large: too_large; a 413 WITHOUT the code is not (DE-4 rule)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(413, { success: false, code: 'export_too_large', error: 'server words' }));
    expect(await startDataExport()).toEqual({ kind: 'refused', code: 'too_large' });
    fetchMock.mockResolvedValue(jsonResponse(413, { success: false, error: 'Payload too large' }));
    expect(await startDataExport()).toEqual({ kind: 'refused', code: 'failed' });
  });

  it('503 export_timeout, a 504 and a 502 platform page that is not JSON: timeout', async () => {
    fetchMock.mockResolvedValue(jsonResponse(503, { success: false, code: 'export_timeout' }));
    expect(await startDataExport()).toEqual({ kind: 'refused', code: 'timeout' });
    fetchMock.mockResolvedValue(htmlResponse(504));
    expect(await startDataExport()).toEqual({ kind: 'refused', code: 'timeout' });
    fetchMock.mockResolvedValue(htmlResponse(502));
    expect(await startDataExport()).toEqual({ kind: 'refused', code: 'timeout' });
  });

  it('500 export_ready_sign_failed: ready_sign_failed with the job id; a non-uuid job id is dropped', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { success: false, code: 'export_ready_sign_failed', jobId: JOB }));
    expect(await startDataExport()).toEqual({ kind: 'refused', code: 'ready_sign_failed', jobId: JOB });
    fetchMock.mockResolvedValue(jsonResponse(500, { success: false, code: 'export_ready_sign_failed', jobId: '../x' }));
    expect(await startDataExport()).toEqual({ kind: 'refused', code: 'ready_sign_failed' });
  });

  it('500 export_failed and a 500 with no code: failed', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { success: false, code: 'export_failed' }));
    expect(await startDataExport()).toEqual({ kind: 'refused', code: 'failed' });
    fetchMock.mockResolvedValue(jsonResponse(500, { success: false, error: 'Internal server error' }));
    expect(await startDataExport()).toEqual({ kind: 'refused', code: 'failed' });
  });

  it('400: failed, logged at error (only our own client can cause it)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { success: false, error: 'Invalid input' }));
    expect(await startDataExport()).toEqual({ kind: 'refused', code: 'failed' });
    expect(logged.some(([level]) => level === 'error')).toBe(true);
  });

  it('429 (no code in the body) and 401: throttled and unauthorized', async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { success: false, error: 'Too many requests' }));
    expect(await startDataExport()).toEqual({ kind: 'refused', code: 'throttled' });
    fetchMock.mockResolvedValue(htmlResponse(401));
    expect(await startDataExport()).toEqual({ kind: 'refused', code: 'unauthorized' });
  });

  it('fetch rejects: network', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await startDataExport()).toEqual({ kind: 'refused', code: 'network' });
  });
});

describe('startDataExport: the 75 s client timer (C-5)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  /** A fetch that only settles when its signal is aborted, like a hung connection. */
  const hungFetch = (_url: string, init: { signal: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });

  it('a hung request is abandoned at 75 s as client_timeout, not before', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation(hungFetch);
    let settled: unknown = 'pending';
    const pending = startDataExport().then((v) => (settled = v));

    jest.advanceTimersByTime(START_TIMEOUT_MS - 1);
    await Promise.resolve();
    expect(settled).toBe('pending');

    jest.advanceTimersByTime(1);
    await pending;
    expect(settled).toEqual({ kind: 'refused', code: 'client_timeout' });
  });

  it('the timer is cleared once the answer arrives (no stray abort later)', async () => {
    jest.useFakeTimers();
    fetchMock.mockResolvedValue(jsonResponse(200, READY_BODY));
    await startDataExport();
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('downloadDataExportAgain', () => {
  it('POSTs {} to the part-1 download route of that job', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, data: { ...READY_BODY.data, jobId: undefined } }));
    expect(await downloadDataExportAgain(JOB)).toMatchObject({ kind: 'ready', downloadUrl: SIGNED, partial: false });
    expect(fetchMock.mock.calls[0][0]).toBe(`${DATA_EXPORTS_URL}/${JOB}/parts/1/download`);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', body: '{}' });
  });

  it('410 export_expired: expired; 404: not_found; 500: failed', async () => {
    fetchMock.mockResolvedValue(jsonResponse(410, { success: false, code: 'export_expired' }));
    expect(await downloadDataExportAgain(JOB)).toEqual({ kind: 'refused', code: 'expired' });
    fetchMock.mockResolvedValue(jsonResponse(404, { success: false, error: 'Not found' }));
    expect(await downloadDataExportAgain(JOB)).toEqual({ kind: 'refused', code: 'not_found' });
    fetchMock.mockResolvedValue(jsonResponse(500, { success: false, error: 'Could not make the download link.' }));
    expect(await downloadDataExportAgain(JOB)).toEqual({ kind: 'refused', code: 'failed' });
  });

  it('a job id that is not a uuid is never sent', async () => {
    expect(await downloadDataExportAgain('../../admin')).toEqual({ kind: 'refused', code: 'failed' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('fetchLastDataExport', () => {
  it('GETs the zip route and returns lastExport (null or with downloadable)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, data: { lastExport: null } }));
    expect(await fetchLastDataExport()).toEqual({ kind: 'ok', lastExport: null });
    expect(fetchMock.mock.calls[0][0]).toBe(DATA_EXPORTS_URL);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'GET', credentials: 'same-origin', cache: 'no-store' });

    const lastExport = { createdAt: '2026-10-17T06:30:00Z', downloadable: { jobId: JOB, expiresAt: '2026-10-20T06:30:05Z' } };
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, data: { lastExport } }));
    expect(await fetchLastDataExport()).toEqual({ kind: 'ok', lastExport });
  });

  it('a non-200, a bad shape or a network failure: unavailable', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { success: false }));
    expect(await fetchLastDataExport()).toEqual({ kind: 'unavailable' });
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, data: { lastExport: { downloadable: { jobId: 'x' } } } }));
    expect(await fetchLastDataExport()).toEqual({ kind: 'unavailable' });
    fetchMock.mockResolvedValue(htmlResponse(200));
    expect(await fetchLastDataExport()).toEqual({ kind: 'unavailable' });
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await fetchLastDataExport()).toEqual({ kind: 'unavailable' });
  });
});

describe('saveSignedDownload: https only (C-6)', () => {
  const ready = (downloadUrl: string): DataExportReady => ({
    kind: 'ready',
    downloadUrl,
    fileName: 'a.zip',
    asciiFileName: 'a.zip',
    expiresAt: '2026-10-20T00:00:00Z',
    partial: false,
  });
  let assign: jest.SpyInstance;
  beforeEach(() => {
    assign = jest.spyOn(browserNavigation, 'assign').mockImplementation(() => undefined);
  });
  afterEach(() => assign.mockRestore());

  it('an https Storage URL is opened, once', () => {
    expect(saveSignedDownload(ready(SIGNED))).toBe(true);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(SIGNED);
  });

  it('a javascript:, data:, relative or plain-http URL never reaches location.assign', () => {
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,hi', '/relative/1.zip', 'http://evil.example/1.zip', 'not a url']) {
      expect(saveSignedDownload(ready(bad))).toBe(false);
    }
    expect(assign).not.toHaveBeenCalled();
    expect(logged.some(([level]) => level === 'error')).toBe(true);
  });

  it('http://localhost only in development', () => {
    const env = process.env as Record<string, string | undefined>;
    const original = env.NODE_ENV;
    try {
      expect(isSafeDownloadUrl('http://localhost:54321/storage/1.zip')).toBe(false);
      env.NODE_ENV = 'development';
      expect(isSafeDownloadUrl('http://localhost:54321/storage/1.zip')).toBe(true);
      expect(isSafeDownloadUrl('http://example.com/1.zip')).toBe(false);
    } finally {
      env.NODE_ENV = original;
    }
  });
});

describe('the signed URL is never logged', () => {
  it('across every path above, no log line carries the token', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, data: { fileName: SIGNED } }));
    await startDataExport();
    fetchMock.mockResolvedValue(jsonResponse(500, { success: false, error: SIGNED }));
    await startDataExport();
    const assign = jest.spyOn(browserNavigation, 'assign').mockImplementation(() => undefined);
    saveSignedDownload({ kind: 'ready', downloadUrl: `http://evil.example/?token=SECRET-TOKEN`, fileName: 'a', asciiFileName: 'a', expiresAt: 'x', partial: false });
    assign.mockRestore();
    expect(logged.length).toBeGreaterThan(0);
    expect(JSON.stringify(logged)).not.toContain('SECRET-TOKEN');
  });
});
