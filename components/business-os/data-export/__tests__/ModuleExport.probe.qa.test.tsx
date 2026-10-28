/**
 * @jest-environment jsdom
 *
 * QA (MX-1b / E5, 2026-10-27): the export entry with the REAL browser seam.
 * Only `fetch` (for the module export route), the ZIP calls, sonner and the
 * language context are mocked, so the probe's verdict comes from the real
 * `fetchModuleExportHistory` and the real `useModuleExportSwitch` mapping.
 *
 * Adds to ModuleExport.render.test.tsx (which mocks the seam):
 *   - C-1 end to end: our JSON 500 / 401 / 429 never fall back to the ZIP;
 *     a non-JSON 502, a foreign 404, a network error and the 5 s timeout do;
 *   - a click while the probe is pending: spinner, then exactly one path,
 *     incl. a double click, and the 5 s timeout with a click waiting on it;
 *   - focus returns to "Export data" after a click that waited on the probe;
 *   - history order kept as the server gave it, origin tag, empty state;
 *   - Hebrew: the started status line and the toast isolate the address, the
 *     daily-limit time and the sent date sit in <bdi> on the owner's clock.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mockStartZip = jest.fn();
const mockFetchLast = jest.fn();
jest.mock('@/lib/client/businessOsDataExport', () => ({
  ...jest.requireActual('@/lib/client/businessOsDataExport'),
  startDataExport: () => mockStartZip(),
  downloadDataExportAgain: jest.fn(),
  fetchLastDataExport: () => mockFetchLast(),
  saveSignedDownload: jest.fn(() => true),
}));

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {};
  for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = () => undefined;
  logger.child = () => logger;
  return { createLogger: () => logger };
});

const mockToastSuccess = jest.fn();
jest.mock('sonner', () => ({ toast: { success: (...a: unknown[]) => mockToastSuccess(...a) } }));

let mockLanguage: { language: 'en' | 'he'; isRTL: boolean; timezone: string } | null = null;
jest.mock('@/lib/business-os/LanguageContext', () => ({
  useOptionalLanguage: () => (mockLanguage ? { language: mockLanguage.language, isRTL: mockLanguage.isRTL } : undefined),
  useBusinessTimezone: () => {
    const timezone = mockLanguage?.timezone ?? 'UTC';
    return { timezone, timeZoneOptions: (o: Intl.DateTimeFormatOptions = {}) => ({ ...o, timeZone: timezone }) };
  },
}));

import { DownloadMyDataButton } from '../DownloadMyDataButton';
import { DOWNLOAD_MY_DATA_COPY } from '../downloadMyDataCopy';
import { EXPORT_DRAWER_COPY } from '../exportDrawerCopy';
import { EXPORT_TIME_FIELDS } from '../formatExportTime';
import { MODULE_EXPORT_PROBE_TIMEOUT_MS, MODULE_EXPORT_URL } from '@/lib/client/businessOsDataExport';

const en = EXPORT_DRAWER_COPY.en;
const he = EXPORT_DRAWER_COPY.he;
const ZIP_LABEL = DOWNLOAD_MY_DATA_COPY.en.label;
const REQ_A = '33333333-3333-4333-8333-333333333333';
const REQ_B = '22222222-2222-4222-8222-222222222222';
const T = '2026-10-27T10:05:00.000Z';
// Far in the future: the drawer keeps a daily-limit refusal only until retryAt,
// so a fixed date that has passed makes the alert vanish and the test fail.
const RETRY = '2099-10-28T09:00:00.000Z';
const EMAIL = 'owner@example.com';
const FSI = '⁨';
const PDI = '⁩';

type FakeResponse = { status: number; ok: boolean; json: () => Promise<unknown> };
const jsonRes = (status: number, body: unknown): FakeResponse => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const htmlRes = (status: number): FakeResponse => ({
  status,
  ok: false,
  json: async () => {
    throw new SyntaxError('Unexpected token <');
  },
});
const OUR_404 = jsonRes(404, { success: false, error: 'Not found' });
const historyRes = (requests: unknown[] = []) => jsonRes(200, { success: true, data: { requests } });

/** GET answers in order (the last one repeats); POST answers from `postAnswer`. */
let getAnswers: Array<() => Promise<FakeResponse>> = [];
let postAnswer: () => Promise<FakeResponse> = async () => jsonRes(201, { success: true, data: { requestId: REQ_A, sentTo: EMAIL, requestedEmailSent: true } });
const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
  if (url !== MODULE_EXPORT_URL) throw new Error(`unexpected fetch ${url}`);
  if (init?.method === 'POST') return postAnswer();
  const next = getAnswers.length > 1 ? getAnswers.shift()! : getAnswers[0];
  return next();
});
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');

/** A GET that never answers until aborted by the probe's own timer. */
const hangingUntilAbort = (signal?: AbortSignal | null) =>
  new Promise<FakeResponse>((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });

function deferred<V>() {
  let resolve!: (value: V) => void;
  const promise = new Promise<V>((r) => (resolve = r));
  return { promise, resolve };
}

const originalFetch = global.fetch;
beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterAll(() => {
  global.fetch = originalFetch;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockLanguage = null;
  getAnswers = [async () => historyRes()];
  postAnswer = async () => jsonRes(201, { success: true, data: { requestId: REQ_A, sentTo: EMAIL, requestedEmailSent: true } });
  mockFetchLast.mockResolvedValue({ kind: 'ok', lastExport: null });
  mockStartZip.mockResolvedValue({ kind: 'refused', code: 'in_progress' });
});

async function settleProbe() {
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await act(async () => undefined);
  await act(async () => undefined);
}

describe('QA 3: the four probe outcomes, real seam (C-1)', () => {
  it.each([
    ['our 500 JSON', () => jsonRes(500, { success: false, error: 'Could not read your export history. Please try again.' })],
    ['our 401 JSON (session expired)', () => jsonRes(401, { success: false, error: 'Unauthorized' })],
    ['our 429 JSON (throttled)', () => jsonRes(429, { success: false, error: 'Too many requests' })],
    ['a 200 of the wrong shape', () => jsonRes(200, { success: true, data: { nope: 1 } })],
  ])('%s → "Export data", the drawer opens with "could not be loaded" + Try again, never the ZIP', async (_label, answer) => {
    getAnswers = [async () => answer()];
    render(<DownloadMyDataButton variant="button" />);
    const entry = await screen.findByRole('button', { name: en.entryLabel });
    expect(screen.queryByRole('button', { name: ZIP_LABEL })).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(entry);
    });
    const drawer = await screen.findByTestId('export-drawer');
    expect(await within(drawer).findByTestId('export-history-error')).toHaveTextContent(en.historyUnavailable);
    expect(within(drawer).getByRole('button', { name: en.tryAgain })).toBeInTheDocument();
    expect(mockStartZip).not.toHaveBeenCalled();
  });

  it('Try again after a failed read loads the history', async () => {
    getAnswers = [async () => jsonRes(500, { success: false }), async () => jsonRes(500, { success: false }), async () => historyRes()];
    render(<DownloadMyDataButton variant="button" />);
    const entryButton = await screen.findByRole('button', { name: en.entryLabel });
    await act(async () => {
      fireEvent.click(entryButton);
    });
    const drawer = await screen.findByTestId('export-drawer');
    const tryAgain = await within(drawer).findByRole('button', { name: en.tryAgain });
    await act(async () => {
      fireEvent.click(tryAgain);
    });
    expect(await within(drawer).findByTestId('export-history-empty')).toHaveTextContent(en.historyEmpty);
  });

  it.each([
    ['our own 404 (switch off)', async () => OUR_404],
    ['a non-JSON 502', async () => htmlRes(502)],
    ['a non-JSON 504', async () => htmlRes(504)],
    ['an HTML 404 that is not ours', async () => htmlRes(404)],
    ['a JSON 404 of another shape', async () => jsonRes(404, { message: 'nope' })],
    ['a network error', async (): Promise<FakeResponse> => {
      throw new TypeError('Failed to fetch');
    }],
  ])('%s → the ZIP control, unchanged; a click starts the ZIP once and posts nothing to the module route', async (_label, answer) => {
    getAnswers = [answer];
    render(<DownloadMyDataButton variant="row" />);
    await settleProbe();
    const zip = screen.getByRole('button', { name: new RegExp(ZIP_LABEL) });
    expect(screen.queryByRole('button', { name: en.entryLabel })).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(zip);
    });
    expect(mockStartZip).toHaveBeenCalledTimes(1);
    expect(posts()).toHaveLength(0);
    expect(screen.queryByTestId('export-drawer')).not.toBeInTheDocument();
  });

  it('the 5 s timeout → the ZIP control (fake timers)', async () => {
    jest.useFakeTimers();
    try {
      getAnswers = [() => hangingUntilAbort(fetchMock.mock.calls.at(-1)?.[1]?.signal)];
      render(<DownloadMyDataButton variant="button" />);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(MODULE_EXPORT_PROBE_TIMEOUT_MS + 10);
      });
      const zip = screen.getByRole('button', { name: ZIP_LABEL });
      await act(async () => {
        fireEvent.click(zip);
        await jest.advanceTimersByTimeAsync(1);
      });
      expect(mockStartZip).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('export-drawer')).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('QA 4: a click while the probe is pending', () => {
  it('waits with a spinner; a hung probe times out at 5 s and the ZIP starts exactly once (double click included)', async () => {
    jest.useFakeTimers();
    try {
      getAnswers = [() => hangingUntilAbort(fetchMock.mock.calls.at(-1)?.[1]?.signal)];
      render(<DownloadMyDataButton variant="button" />);
      const zip = screen.getByRole('button', { name: ZIP_LABEL });
      await act(async () => {
        fireEvent.click(zip);
        fireEvent.click(zip);
      });
      expect(zip).toHaveAttribute('aria-busy', 'true');
      expect(zip).toBeDisabled();
      expect(zip.querySelector('.animate-spin')).not.toBeNull();
      expect(mockStartZip).not.toHaveBeenCalled();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(MODULE_EXPORT_PROBE_TIMEOUT_MS - 100);
      });
      expect(mockStartZip).not.toHaveBeenCalled();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(200);
      });
      expect(mockStartZip).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('export-drawer')).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it('answers ON after two clicks: one drawer, no ZIP, no POST; Escape returns focus to "Export data"', async () => {
    const probe = deferred<FakeResponse>();
    getAnswers = [() => probe.promise, async () => historyRes()];
    render(<DownloadMyDataButton variant="button" />);
    const zip = screen.getByRole('button', { name: ZIP_LABEL });
    await act(async () => {
      fireEvent.click(zip);
      fireEvent.click(zip);
    });
    expect(zip).toHaveAttribute('aria-busy', 'true');
    await act(async () => probe.resolve(historyRes()));
    const drawers = await screen.findAllByTestId('export-drawer');
    expect(drawers).toHaveLength(1);
    expect(mockStartZip).not.toHaveBeenCalled();
    expect(posts()).toHaveLength(0);

    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    });
    await waitFor(() => expect(screen.queryByTestId('export-drawer')).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: en.entryLabel })));
  });
});

describe('QA 5: the history as the drawer shows it', () => {
  const twoRequests = [
    { requestId: REQ_A, requestedAt: T, origin: 'owner', modules: [{ module: 'clients', status: 'waiting', sentAt: null, emailCount: 0 }] },
    { requestId: REQ_B, requestedAt: T, origin: 'admin', modules: [{ module: 'quotes', status: 'sent', sentAt: T, emailCount: 1 }] },
  ];

  it('keeps the server order (no re-sort on a requested_at tie) and tags only the support-sent request', async () => {
    getAnswers = [async () => historyRes(twoRequests)];
    render(<DownloadMyDataButton variant="button" />);
    const entryButton = await screen.findByRole('button', { name: en.entryLabel });
    await act(async () => {
      fireEvent.click(entryButton);
    });
    const list = await screen.findByTestId('export-history-list');
    const items = Array.from(list.querySelectorAll('[data-testid^="export-history-request-"]')).map((el) => el.getAttribute('data-testid'));
    expect(items).toEqual([`export-history-request-${REQ_A}`, `export-history-request-${REQ_B}`]);
    expect(within(screen.getByTestId(`export-history-request-${REQ_B}`)).getByText(en.origin.admin)).toBeInTheDocument();
    expect(within(screen.getByTestId(`export-history-request-${REQ_A}`)).queryByText(en.origin.admin)).not.toBeInTheDocument();
    expect(list.textContent ?? '').not.toMatch(/deliver/i);
  });

  it('an empty history says so', async () => {
    render(<DownloadMyDataButton variant="button" />);
    const entryButton = await screen.findByRole('button', { name: en.entryLabel });
    await act(async () => {
      fireEvent.click(entryButton);
    });
    expect(await screen.findByTestId('export-history-empty')).toHaveTextContent(en.historyEmpty);
  });

  it('a body with one row of an unknown status is rejected whole by the seam (history unavailable), not partly shown', async () => {
    // Documents the seam's all-or-nothing parse: the route already drops bad rows (per-row parse in both repositories).
    getAnswers = [async () => historyRes([{ ...twoRequests[0], modules: [{ module: 'clients', status: 'delivered', sentAt: null, emailCount: 0 }] }, twoRequests[1]])];
    render(<DownloadMyDataButton variant="button" />);
    const entryButton = await screen.findByRole('button', { name: en.entryLabel });
    await act(async () => {
      fireEvent.click(entryButton);
    });
    expect(await screen.findByTestId('export-history-error')).toBeInTheDocument();
  });
});

describe('QA 7: Hebrew / RTL', () => {
  beforeEach(() => {
    mockLanguage = { language: 'he', isRTL: true, timezone: 'Asia/Jerusalem' };
  });
  const heTime = (iso: string) => new Intl.DateTimeFormat('he', { ...EXPORT_TIME_FIELDS, timeZone: 'Asia/Jerusalem' }).format(new Date(iso));

  async function openHe() {
    render(<DownloadMyDataButton variant="button" />);
    const entryButton = await screen.findByRole('button', { name: he.entryLabel });
    await act(async () => {
      fireEvent.click(entryButton);
    });
    return screen.findByTestId('export-drawer');
  }

  it('started: the status line has the Hebrew sentence with the address alone in <bdi dir="ltr">; the toast wraps it in FSI/PDI', async () => {
    await openHe();
    fireEvent.click(screen.getByTestId('export-module-clients'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('export-submit'));
    });
    const line = await screen.findByTestId('export-started');
    const bdi = line.querySelector('bdi');
    expect(bdi).not.toBeNull();
    expect(bdi).toHaveAttribute('dir', 'ltr');
    expect(bdi!.textContent).toBe(EMAIL);
    expect(line.textContent).toBe(he.startedToast.replace('{email}', EMAIL));
    expect(screen.getByTestId('export-status')).toContainElement(line);
    expect(screen.getByTestId('export-alert')).toBeEmptyDOMElement();
    expect(mockToastSuccess).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess.mock.calls[0][0]).toBe(he.startedToast.replace('{email}', `${FSI}${EMAIL}${PDI}`));
  });

  it('daily limit: the time is on the owner clock inside <bdi>, as an alert, and Export stays off', async () => {
    postAnswer = async () => jsonRes(409, { success: false, code: 'export_daily_limit', retryAt: RETRY });
    await openHe();
    fireEvent.click(screen.getByTestId('export-module-clients'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('export-submit'));
    });
    const alert = screen.getByTestId('export-alert');
    await waitFor(() => expect(alert.querySelector('bdi')).not.toBeNull());
    expect(alert.querySelector('bdi')!.textContent).toBe(heTime(RETRY));
    expect(screen.getByTestId('export-status')).toBeEmptyDOMElement();
    expect(screen.getByTestId('export-submit')).toBeDisabled();
  });

  it('history: requested and sent dates each in their own <bdi>, Asia/Jerusalem', async () => {
    getAnswers = [async () => historyRes([{ requestId: REQ_A, requestedAt: T, origin: 'owner', modules: [{ module: 'quotes', status: 'sent', sentAt: RETRY, emailCount: 2 }] }])];
    await openHe();
    const request = await screen.findByTestId(`export-history-request-${REQ_A}`);
    const dates = Array.from(request.querySelectorAll('bdi')).map((b) => b.textContent);
    expect(dates).toEqual([heTime(T), heTime(RETRY)]);
  });
});
