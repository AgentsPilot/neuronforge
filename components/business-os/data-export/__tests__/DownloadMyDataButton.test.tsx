/**
 * @jest-environment jsdom
 *
 * The one "Download my data" control (data export DE-9, workplan §6.1, F-1 …
 * F-19; SA DE-9 C-1, C-5, C-9). The network seam is mocked; the date
 * formatting runs the REAL Intl (C-1), so a format that throws fails here.
 *
 * Rendered without a LanguageProvider (en, UTC: /v2, /settings) and with one
 * stubbed (he, Asia/Jerusalem: /business-os/settings).
 */

import '@testing-library/jest-dom';
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DataExportVerdict, LastDataExportVerdict } from '@/lib/client/businessOsDataExport';

const mockStart = jest.fn<Promise<DataExportVerdict>, []>();
const mockAgain = jest.fn<Promise<DataExportVerdict>, [string]>();
const mockFetchLast = jest.fn<Promise<LastDataExportVerdict>, []>();
const mockSave = jest.fn<boolean, [unknown]>();
jest.mock('@/lib/client/businessOsDataExport', () => ({
  startDataExport: () => mockStart(),
  downloadDataExportAgain: (jobId: string) => mockAgain(jobId),
  fetchLastDataExport: () => mockFetchLast(),
  saveSignedDownload: (v: unknown) => mockSave(v),
}));

// The provider stub: `null` = no LanguageProvider (as on /v2/settings).
let mockLanguage: { language: 'en' | 'he' | 'es'; isRTL: boolean; timezone: string } | null = null;
jest.mock('@/lib/business-os/LanguageContext', () => ({
  useOptionalLanguage: () => (mockLanguage ? { language: mockLanguage.language, isRTL: mockLanguage.isRTL } : undefined),
  useBusinessTimezone: () => {
    const timezone = mockLanguage?.timezone ?? 'UTC';
    return { timezone, timeZoneOptions: (o: Intl.DateTimeFormatOptions = {}) => ({ ...o, timeZone: timezone }) };
  },
}));

import { DownloadMyDataButton } from '../DownloadMyDataButton';
import { DOWNLOAD_MY_DATA_COPY, fillCopy } from '../downloadMyDataCopy';
import { EXPORT_TIME_FIELDS, formatExportTime } from '../formatExportTime';
import { CLIENT_TIMEOUT_STATUS_RELOAD_MS } from '../useDownloadMyData';
import { PLACEHOLDER_ERASURE_CONTACT } from '@/lib/business-os/supportContact';

const en = DOWNLOAD_MY_DATA_COPY.en;
const he = DOWNLOAD_MY_DATA_COPY.he;
const JOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CREATED = '2026-10-17T06:30:00.000Z';
const UNTIL = '2026-10-20T06:30:05.000Z';
const READY: DataExportVerdict = {
  kind: 'ready',
  downloadUrl: 'https://x.supabase.co/storage/v1/object/sign/p/1.zip?token=T',
  fileName: 'a.zip',
  asciiFileName: 'a.zip',
  expiresAt: UNTIL,
  partial: false,
};
const NONE: LastDataExportVerdict = { kind: 'ok', lastExport: null };
const READY_STATUS: LastDataExportVerdict = { kind: 'ok', lastExport: { createdAt: CREATED, downloadable: { jobId: JOB, expiresAt: UNTIL } } };
const EXPIRED_STATUS: LastDataExportVerdict = { kind: 'ok', lastExport: { createdAt: CREATED, downloadable: null } };

/** Real Intl, the same fields and zone the control uses. */
const fmt = (iso: string, language = 'en', timeZone = 'UTC') =>
  new Intl.DateTimeFormat(language, { ...EXPORT_TIME_FIELDS, timeZone }).format(new Date(iso));

const button = () => screen.getByRole('button', { name: mockLanguage?.language === 'he' ? he.label : en.label });
const statusRegion = () => screen.getByRole('status');
const alertRegion = () => screen.getByRole('alert');

/** A promise the test resolves by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

async function renderSettled(variant: 'row' | 'button' = 'button') {
  const view = render(<DownloadMyDataButton variant={variant} />);
  await waitFor(() => expect(mockFetchLast).toHaveBeenCalled());
  await act(async () => undefined);
  return view;
}

async function clickAndSettle(verdict: DataExportVerdict) {
  mockStart.mockResolvedValueOnce(verdict);
  await act(async () => {
    fireEvent.click(button());
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLanguage = null;
  mockFetchLast.mockResolvedValue(NONE);
  mockSave.mockReturnValue(true);
});

describe('status line (F-1 … F-3, F-16)', () => {
  it('F-1: no last export: no status line, the button is enabled', async () => {
    await renderSettled();
    expect(screen.queryByTestId('download-my-data-status')).toBeNull();
    expect(button()).toBeEnabled();
    expect(statusRegion()).toBeEmptyDOMElement();
    expect(alertRegion()).toBeEmptyDOMElement();
  });

  it("F-2: a ready export: 'Last export … until …' on the owner's clock (real Intl) + Download again", async () => {
    mockLanguage = { language: 'en', isRTL: false, timezone: 'Asia/Jerusalem' };
    mockFetchLast.mockResolvedValue(READY_STATUS);
    await renderSettled('row');
    const line = await screen.findByTestId('download-my-data-status');
    expect(line).toHaveTextContent(
      fillCopy(en.lastExport, { date: fmt(CREATED, 'en', 'Asia/Jerusalem'), until: fmt(UNTIL, 'en', 'Asia/Jerusalem') })
    );
    // 06:30 UTC is 09:30 in Jerusalem on 17 Oct 2026, and the zone is named.
    expect(line.textContent).toMatch(/Oct 17, 2026/);
    expect(line.textContent).toMatch(/09:30/);
    expect(line.textContent).toMatch(/GMT\+3/);
    expect(screen.getByRole('button', { name: en.downloadAgain })).toBeInTheDocument();
  });

  it('F-2 outside the provider: UTC, and the zone is shown so it is not mistaken for local time', async () => {
    mockFetchLast.mockResolvedValue(READY_STATUS);
    await renderSettled();
    expect((await screen.findByTestId('download-my-data-status')).textContent).toMatch(/06:30.*UTC/);
  });

  it('F-3: an expired export: "Last export …" only, no Download again', async () => {
    mockFetchLast.mockResolvedValue(EXPIRED_STATUS);
    await renderSettled();
    expect(await screen.findByTestId('download-my-data-status')).toHaveTextContent(fillCopy(en.lastExportExpired, { date: fmt(CREATED) }));
    expect(screen.queryByRole('button', { name: en.downloadAgain })).toBeNull();
  });

  it('F-16: the status read is unavailable: no line and no error notice', async () => {
    mockFetchLast.mockResolvedValue({ kind: 'unavailable' });
    await renderSettled();
    expect(screen.queryByTestId('download-my-data-status')).toBeNull();
    expect(alertRegion()).toBeEmptyDOMElement();
    expect(statusRegion()).toBeEmptyDOMElement();
  });
});

describe('Download my data (F-4 … F-13)', () => {
  it('F-4: preparing is announced, busy and disabled; then started, saved once, status reloaded', async () => {
    await renderSettled();
    const pending = deferred<DataExportVerdict>();
    mockStart.mockReturnValueOnce(pending.promise);
    act(() => {
      fireEvent.click(button());
    });
    expect(button()).toBeDisabled();
    expect(button()).toHaveAttribute('aria-busy', 'true');
    expect(statusRegion()).toHaveTextContent(en.preparing);
    // The accessible name stays the label while busy.
    expect(button()).toHaveAccessibleName(en.label);

    mockFetchLast.mockResolvedValue(READY_STATUS);
    await act(async () => pending.resolve(READY));
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenCalledWith(READY);
    expect(statusRegion()).toHaveTextContent(fillCopy(en.started, { until: fmt(UNTIL) }));
    expect(statusRegion()).toHaveAttribute('aria-live', 'polite');
    expect(button()).toBeEnabled();
    expect(mockFetchLast).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('button', { name: en.downloadAgain })).toBeInTheDocument();
  });

  it('F-5: a partial export adds the README sentence', async () => {
    await renderSettled();
    await clickAndSettle({ ...READY, partial: true } as DataExportVerdict);
    expect(statusRegion()).toHaveTextContent(en.partial);
  });

  it('F-6: two clicks in one tick start ONE export', async () => {
    await renderSettled();
    const pending = deferred<DataExportVerdict>();
    mockStart.mockReturnValue(pending.promise);
    act(() => {
      const b = button();
      b.click();
      b.click();
    });
    expect(mockStart).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(READY));
  });

  it('F-7: in progress: info in the polite region, status reloaded', async () => {
    await renderSettled();
    await clickAndSettle({ kind: 'refused', code: 'in_progress' });
    expect(statusRegion()).toHaveTextContent(en.inProgress);
    expect(alertRegion()).toBeEmptyDOMElement();
    expect(mockFetchLast).toHaveBeenCalledTimes(2);
  });

  it('F-8: daily limit: the limit from config and retryAt formatted (real Intl); status reloaded', async () => {
    await renderSettled();
    await clickAndSettle({ kind: 'refused', code: 'daily_limit', retryAt: '2026-10-18T06:30:00.000Z' });
    expect(statusRegion()).toHaveTextContent(fillCopy(en.dailyLimit, { limit: 3, time: fmt('2026-10-18T06:30:00.000Z') }));
    expect(statusRegion().textContent).toMatch(/Oct 18, 2026/);
    expect(mockFetchLast).toHaveBeenCalledTimes(2);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('F-9: too large: alert, a mailto link to the one support contact, nothing saved', async () => {
    await renderSettled();
    await clickAndSettle({ kind: 'refused', code: 'too_large' });
    expect(statusRegion()).toBeEmptyDOMElement();
    const link = screen.getByRole('link', { name: PLACEHOLDER_ERASURE_CONTACT });
    expect(link).toHaveAttribute('href', `mailto:${PLACEHOLDER_ERASURE_CONTACT}`);
    expect(alertRegion()).toContainElement(link);
    expect(alertRegion().textContent).toContain(en.tooLarge.split('{email}')[0].trim());
    expect(alertRegion().textContent).not.toMatch(/150|40 MB/);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('F-10: server timeout (503 / 504 / non-JSON): the timeout message', async () => {
    await renderSettled();
    await clickAndSettle({ kind: 'refused', code: 'timeout' });
    expect(alertRegion()).toHaveTextContent(en.timeout);
  });

  it('F-11: client timeout: info, status reloaded now and once more after 30 s (fixed advance)', async () => {
    jest.useFakeTimers();
    try {
      await renderSettled();
      await clickAndSettle({ kind: 'refused', code: 'client_timeout' });
      expect(statusRegion()).toHaveTextContent(en.clientTimeout);
      expect(mockFetchLast).toHaveBeenCalledTimes(2);
      mockFetchLast.mockResolvedValue(READY_STATUS);
      await act(async () => {
        jest.advanceTimersByTime(CLIENT_TIMEOUT_STATUS_RELOAD_MS);
      });
      expect(mockFetchLast).toHaveBeenCalledTimes(3);
      expect(screen.getByRole('button', { name: en.downloadAgain })).toBeInTheDocument();
      await act(async () => {
        jest.advanceTimersByTime(CLIENT_TIMEOUT_STATUS_RELOAD_MS);
      });
      expect(mockFetchLast).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('F-11: the 30 s reload is cleared on unmount', async () => {
    jest.useFakeTimers();
    try {
      const view = await renderSettled();
      await clickAndSettle({ kind: 'refused', code: 'client_timeout' });
      view.unmount();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('F-12: sign failed: alert, and "Download again" appears after the status reload', async () => {
    await renderSettled();
    mockFetchLast.mockResolvedValue(READY_STATUS);
    await clickAndSettle({ kind: 'refused', code: 'ready_sign_failed', jobId: JOB });
    expect(alertRegion()).toHaveTextContent(en.signFailed);
    expect(await screen.findByRole('button', { name: en.downloadAgain })).toBeInTheDocument();
  });

  it('F-12: sign failed with the status read unavailable: "Download again" is offered in the notice', async () => {
    await renderSettled();
    mockFetchLast.mockResolvedValue({ kind: 'unavailable' });
    await clickAndSettle({ kind: 'refused', code: 'ready_sign_failed', jobId: JOB });
    mockAgain.mockResolvedValueOnce(READY);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.downloadAgain }));
    });
    expect(mockAgain).toHaveBeenCalledWith(JOB);
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['failed', en.failed],
    ['throttled', en.throttled],
    ['unauthorized', en.unauthorized],
    ['network', en.network],
  ] as const)('F-13: %s: its own copy in the alert region, never a success', async (code, text) => {
    await renderSettled();
    await clickAndSettle({ kind: 'refused', code });
    expect(alertRegion()).toHaveTextContent(text);
    expect(statusRegion()).toBeEmptyDOMElement();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('a URL the seam refuses to open (not https) ends in the failure message, not "started"', async () => {
    await renderSettled();
    mockSave.mockReturnValue(false);
    await clickAndSettle(READY);
    expect(alertRegion()).toHaveTextContent(en.failed);
    expect(screen.queryByText(fillCopy(en.started, { until: fmt(UNTIL) }))).toBeNull();
  });
});

describe('Download again (F-14, F-15)', () => {
  it("F-14: uses the status route's job id and saves the file", async () => {
    mockFetchLast.mockResolvedValue(READY_STATUS);
    await renderSettled();
    mockAgain.mockResolvedValueOnce(READY);
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: en.downloadAgain }));
    });
    expect(mockAgain).toHaveBeenCalledWith(JOB);
    expect(mockStart).not.toHaveBeenCalled();
    expect(mockSave).toHaveBeenCalledWith(READY);
    expect(statusRegion()).toHaveTextContent(fillCopy(en.started, { until: fmt(UNTIL) }));
  });

  it('F-15: expired (410) or gone (404): the expired message, and "Download again" disappears', async () => {
    for (const code of ['expired', 'not_found'] as const) {
      mockFetchLast.mockResolvedValue(READY_STATUS);
      const view = await renderSettled();
      mockAgain.mockResolvedValueOnce({ kind: 'refused', code });
      mockFetchLast.mockResolvedValue(EXPIRED_STATUS);
      await act(async () => {
        fireEvent.click(await screen.findByRole('button', { name: en.downloadAgain }));
      });
      expect(statusRegion()).toHaveTextContent(en.expired);
      await waitFor(() => expect(screen.queryByRole('button', { name: en.downloadAgain })).toBeNull());
      view.unmount();
    }
  });
});

describe('lifecycle and accessibility (F-17, F-18, C-9)', () => {
  it('F-17: unmounted while preparing, then 200: the file is still saved, no state update after unmount', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const view = await renderSettled();
      const pending = deferred<DataExportVerdict>();
      mockStart.mockReturnValueOnce(pending.promise);
      act(() => {
        fireEvent.click(button());
      });
      view.unmount();
      const fetchCallsAtUnmount = mockFetchLast.mock.calls.length;
      await act(async () => pending.resolve(READY));
      expect(mockSave).toHaveBeenCalledTimes(1);
      expect(mockFetchLast).toHaveBeenCalledTimes(fetchCallsAtUnmount);
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('F-18: dismiss removes the notice; both live regions stay mounted', async () => {
    await renderSettled();
    await clickAndSettle({ kind: 'refused', code: 'failed' });
    fireEvent.click(screen.getByRole('button', { name: en.dismiss }));
    expect(alertRegion()).toBeEmptyDOMElement();
    expect(statusRegion()).toBeInTheDocument();
  });

  it('C-9: nothing auto-dismisses (a notice is still there a minute later)', async () => {
    jest.useFakeTimers();
    try {
      await renderSettled();
      await clickAndSettle({ kind: 'refused', code: 'daily_limit', retryAt: '2026-10-18T06:30:00.000Z' });
      await act(async () => {
        jest.advanceTimersByTime(60_000);
      });
      expect(statusRegion()).toHaveTextContent(fillCopy(en.dailyLimit, { limit: 3, time: fmt('2026-10-18T06:30:00.000Z') }));
    } finally {
      jest.useRealTimers();
    }
  });

  it('C-9: a new action replaces the previous notice', async () => {
    await renderSettled();
    await clickAndSettle({ kind: 'refused', code: 'network' });
    expect(alertRegion()).toHaveTextContent(en.network);
    await clickAndSettle({ kind: 'refused', code: 'in_progress' });
    expect(alertRegion()).toBeEmptyDOMElement();
    expect(statusRegion()).toHaveTextContent(en.inProgress);
  });

  it('both variants render one action with the same name', async () => {
    const row = await renderSettled('row');
    expect(screen.getAllByRole('button', { name: en.label })).toHaveLength(1);
    row.unmount();
    await renderSettled('button');
    expect(screen.getAllByRole('button', { name: en.label })).toHaveLength(1);
  });
});

describe('Hebrew (F-19)', () => {
  it('Hebrew copy, dates formatted with he on the owner clock, the email kept whole in <bdi>', async () => {
    mockLanguage = { language: 'he', isRTL: true, timezone: 'Asia/Jerusalem' };
    mockFetchLast.mockResolvedValue(READY_STATUS);
    await renderSettled('row');
    expect(button()).toHaveTextContent(he.label);
    expect(await screen.findByTestId('download-my-data-status')).toHaveTextContent(
      fillCopy(he.lastExport, { date: fmt(CREATED, 'he', 'Asia/Jerusalem'), until: fmt(UNTIL, 'he', 'Asia/Jerusalem') })
    );
    expect(screen.getByRole('button', { name: he.downloadAgain })).toBeInTheDocument();

    await clickAndSettle({ kind: 'refused', code: 'too_large' });
    const link = screen.getByRole('link', { name: PLACEHOLDER_ERASURE_CONTACT });
    const bdi = link.querySelector('bdi');
    expect(bdi).not.toBeNull();
    expect(bdi).toHaveTextContent(PLACEHOLDER_ERASURE_CONTACT);
    expect(alertRegion().textContent).toContain(he.tooLarge.split('{email}')[0].trim());
  });
});

describe('the formatter (C-1, real Intl)', () => {
  it('formats with explicit fields and a zone name, and never throws', () => {
    expect(() => formatExportTime(CREATED, 'en', (o) => ({ ...o, timeZone: 'Asia/Jerusalem' }))).not.toThrow();
    expect(formatExportTime(CREATED, 'he', (o) => ({ ...o, timeZone: 'Asia/Jerusalem' }))).toBe(fmt(CREATED, 'he', 'Asia/Jerusalem'));
    expect(formatExportTime('not a date', 'en', (o) => ({ ...o, timeZone: 'UTC' }))).toBe('not a date');
    expect(formatExportTime(CREATED, 'en', (o) => ({ ...o, timeZone: 'Not/AZone' }))).toBe(CREATED);
  });

  it('negative control: the dateStyle + timeZoneName combination the workplan first wrote DOES throw', () => {
    expect(() =>
      new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZoneName: 'short', timeZone: 'UTC' }).format(new Date())
    ).toThrow(TypeError);
    expect(EXPORT_TIME_FIELDS).not.toHaveProperty('dateStyle');
    expect(EXPORT_TIME_FIELDS).not.toHaveProperty('timeStyle');
  });
});
