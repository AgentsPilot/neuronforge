/**
 * @jest-environment jsdom
 *
 * The export entry with the module export switch (export redesign MX-1b,
 * workplan §9, §10, T-8; SA C-1, C-8, C-12; BQ-E5-2, BQ-E5-3).
 *
 * The browser seam and sonner are mocked; Radix (the sheet) and Intl are real.
 * Rendered without a LanguageProvider (en, UTC: /v2, /settings) and with one
 * stubbed (he, Asia/Jerusalem: /business-os/settings).
 */

import '@testing-library/jest-dom';
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  DataExportVerdict,
  ExportHistoryRequest,
  LastDataExportVerdict,
  ModuleExportHistoryVerdict,
  ModuleExportStartVerdict,
} from '@/lib/client/businessOsDataExport';

const mockStart = jest.fn<Promise<DataExportVerdict>, []>();
const mockFetchLast = jest.fn<Promise<LastDataExportVerdict>, []>();
const mockProbe = jest.fn<Promise<ModuleExportHistoryVerdict>, []>();
const mockStartModule = jest.fn<Promise<ModuleExportStartVerdict>, [readonly string[]]>();
jest.mock('@/lib/client/businessOsDataExport', () => ({
  startDataExport: () => mockStart(),
  downloadDataExportAgain: jest.fn(),
  fetchLastDataExport: () => mockFetchLast(),
  saveSignedDownload: jest.fn(() => true),
  fetchModuleExportHistory: () => mockProbe(),
  startModuleExport: (modules: readonly string[]) => mockStartModule(modules),
}));

const mockToastSuccess = jest.fn();
jest.mock('sonner', () => ({ toast: { success: (...a: unknown[]) => mockToastSuccess(...a) } }));

let mockLanguage: { language: 'en' | 'he' | 'es'; isRTL: boolean; timezone: string } | null = null;
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
import { enabledModules } from '@/lib/business-os/data-export/exportModules';

const en = EXPORT_DRAWER_COPY.en;
const he = EXPORT_DRAWER_COPY.he;
const REQUEST = '33333333-3333-4333-8333-333333333333';
const T = '2026-10-27T10:05:00.000Z';
const RETRY = '2026-10-28T09:00:00.000Z';
const EMAIL = 'owner@example.com';

const HISTORY: ExportHistoryRequest[] = [
  {
    requestId: REQUEST,
    requestedAt: T,
    origin: 'owner',
    modules: [
      { module: 'quotes', status: 'sent', sentAt: T, emailCount: 2 },
      { module: 'clients', status: 'waiting', sentAt: null, emailCount: 0 },
    ],
  },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const fmt = (iso: string, language = 'en', timeZone = 'UTC') =>
  new Intl.DateTimeFormat(language, { ...EXPORT_TIME_FIELDS, timeZone }).format(new Date(iso));

async function renderOn(variant: 'row' | 'button' = 'button', history: ModuleExportHistoryVerdict = { kind: 'ok', requests: HISTORY }) {
  mockProbe.mockResolvedValue(history);
  const view = render(<DownloadMyDataButton variant={variant} />);
  await screen.findByRole('button', { name: mockLanguage?.language === 'he' ? he.entryLabel : en.entryLabel });
  return view;
}

async function openDrawer() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: mockLanguage?.language === 'he' ? he.entryLabel : en.entryLabel }));
  });
  return screen.findByTestId('export-drawer');
}

const tick = (id: string) => fireEvent.click(screen.getByTestId(`export-module-${id}`));

beforeEach(() => {
  jest.clearAllMocks();
  mockLanguage = null;
  mockFetchLast.mockResolvedValue({ kind: 'ok', lastExport: null });
  mockStartModule.mockResolvedValue({ kind: 'started', requestId: REQUEST, sentTo: EMAIL, requestedEmailSent: true });
});

describe('switch off or unknown: the ZIP control, unchanged (AC MX-1b, C-1)', () => {
  it.each([['off'], ['unknown']] as const)('probe %s → "Download my data" and a click starts the ZIP', async (kind) => {
    mockProbe.mockResolvedValue({ kind });
    mockStart.mockResolvedValue({ kind: 'refused', code: 'in_progress' });
    render(<DownloadMyDataButton variant="button" />);
    await waitFor(() => expect(mockProbe).toHaveBeenCalledTimes(1));
    await act(async () => undefined);
    const zip = screen.getByRole('button', { name: DOWNLOAD_MY_DATA_COPY.en.label });
    await act(async () => {
      fireEvent.click(zip);
    });
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('export-drawer')).not.toBeInTheDocument();
  });

  it('a click before the probe answers waits (spinner, aria-busy), then starts the ZIP when it answers off', async () => {
    const probe = deferred<ModuleExportHistoryVerdict>();
    mockProbe.mockReturnValue(probe.promise);
    mockStart.mockResolvedValue({ kind: 'refused', code: 'in_progress' });
    render(<DownloadMyDataButton variant="button" />);
    const zip = screen.getByRole('button', { name: DOWNLOAD_MY_DATA_COPY.en.label });
    await act(async () => {
      fireEvent.click(zip);
    });
    expect(mockStart).not.toHaveBeenCalled();
    expect(zip).toHaveAttribute('aria-busy', 'true');
    expect(zip).toBeDisabled();
    await act(async () => probe.resolve({ kind: 'off' }));
    await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
  });

  it('a click before the probe answers opens the drawer, and starts no ZIP, when it answers on', async () => {
    const probe = deferred<ModuleExportHistoryVerdict>();
    mockProbe.mockReturnValueOnce(probe.promise).mockResolvedValue({ kind: 'ok', requests: HISTORY });
    render(<DownloadMyDataButton variant="button" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: DOWNLOAD_MY_DATA_COPY.en.label }));
    });
    await act(async () => probe.resolve({ kind: 'ok', requests: HISTORY }));
    expect(await screen.findByTestId('export-drawer')).toBeInTheDocument();
    expect(mockStart).not.toHaveBeenCalled();
  });
});

describe('switch on: the export drawer', () => {
  it.each(['row', 'button'] as const)('%s: the entry reads "Export data" (BQ-E5-2) and opens the drawer', async (variant) => {
    await renderOn(variant);
    const drawer = await openDrawer();
    expect(within(drawer).getByText(en.title, { selector: 'h2' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: DOWNLOAD_MY_DATA_COPY.en.label })).not.toBeInTheDocument();
  });

  it('a probe error still means on: the drawer opens and says the history could not be loaded, with Try again (C-1)', async () => {
    await renderOn('button', { kind: 'error' });
    mockProbe.mockResolvedValue({ kind: 'error' });
    await openDrawer();
    expect(await screen.findByTestId('export-history-error')).toHaveTextContent(en.historyUnavailable);
    mockProbe.mockResolvedValue({ kind: 'ok', requests: HISTORY });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.tryAgain }));
    });
    expect(await screen.findByTestId('export-history-list')).toBeInTheDocument();
  });

  it('nothing is ticked on open, Export is off, the files sentence is shown (BQ-E5-3, BQ-35)', async () => {
    await renderOn();
    await openDrawer();
    for (const entry of enabledModules()) expect(screen.getByTestId(`export-module-${entry.id}`)).toHaveAttribute('data-state', 'unchecked');
    expect(screen.getByTestId('export-submit')).toBeDisabled();
    expect(screen.getByTestId('export-drawer-files')).toHaveTextContent(en.filesNotIncluded);
  });

  it('Select all ticks every module, then clears them all; one tick enables Export', async () => {
    await renderOn();
    await openDrawer();
    fireEvent.click(screen.getByTestId('export-select-all'));
    for (const entry of enabledModules()) expect(screen.getByTestId(`export-module-${entry.id}`)).toHaveAttribute('data-state', 'checked');
    expect(screen.getByTestId('export-select-all')).toHaveAttribute('data-state', 'checked');
    fireEvent.click(screen.getByTestId('export-select-all'));
    for (const entry of enabledModules()) expect(screen.getByTestId(`export-module-${entry.id}`)).toHaveAttribute('data-state', 'unchecked');
    tick('quotes');
    expect(screen.getByTestId('export-submit')).toBeEnabled();
  });

  it('Export sends the ticked modules in map order; the pop-up confirms with the address; the ticks clear; the history reloads', async () => {
    await renderOn();
    await openDrawer();
    tick('website');
    tick('clients');
    const probeCallsBefore = mockProbe.mock.calls.length;
    await act(async () => {
      fireEvent.click(screen.getByTestId('export-submit'));
    });
    expect(mockStartModule).toHaveBeenCalledWith(['clients', 'website']);
    // SA CR-3: the address in the toast is isolated with FSI / PDI.
    expect(mockToastSuccess).toHaveBeenCalledWith(`Export started. The exported files will be sent to ⁨${EMAIL}⁩ once ready.`);
    // SA CR-1: the same sentence is announced in the drawer's own polite status region, the address in <bdi>.
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(`Export started. The exported files will be sent to ${EMAIL} once ready.`);
    expect(within(status).getByTestId('export-started').querySelector('bdi')?.textContent).toBe(EMAIL);
    expect(screen.getByTestId('export-module-clients')).toHaveAttribute('data-state', 'unchecked');
    expect(mockProbe.mock.calls.length).toBeGreaterThan(probeCallsBefore);
    expect(screen.getByTestId('export-alert')).toBeEmptyDOMElement();
  });

  it('a start whose confirmation email failed says so in the drawer', async () => {
    mockStartModule.mockResolvedValue({ kind: 'started', requestId: REQUEST, sentTo: EMAIL, requestedEmailSent: false });
    await renderOn();
    await openDrawer();
    tick('clients');
    await act(async () => {
      fireEvent.click(screen.getByTestId('export-submit'));
    });
    expect(screen.getByTestId('export-status')).toHaveTextContent(en.confirmationNotSent);
  });

  it('busy while the request runs: Export is off and busy, the drawer refuses to close', async () => {
    const pending = deferred<ModuleExportStartVerdict>();
    mockStartModule.mockReturnValue(pending.promise);
    await renderOn();
    await openDrawer();
    tick('clients');
    await act(async () => {
      fireEvent.click(screen.getByTestId('export-submit'));
    });
    expect(screen.getByTestId('export-submit')).toBeDisabled();
    expect(screen.getByTestId('export-submit')).toHaveAttribute('aria-busy', 'true');
    fireEvent.keyDown(screen.getByTestId('export-drawer'), { key: 'Escape' });
    expect(screen.getByTestId('export-drawer')).toBeInTheDocument();
    await act(async () => pending.resolve({ kind: 'started', requestId: REQUEST, sentTo: EMAIL, requestedEmailSent: true }));
  });

  it('in_progress stays inline in the drawer', async () => {
    mockStartModule.mockResolvedValue({ kind: 'refused', code: 'in_progress' });
    await renderOn();
    await openDrawer();
    tick('clients');
    await act(async () => {
      fireEvent.click(screen.getByTestId('export-submit'));
    });
    expect(screen.getByRole('alert')).toHaveTextContent(en.inProgress);
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it('daily_limit says when, in the owner clock, and keeps Export off until that time (C-8)', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-27T12:00:00.000Z') });
    try {
      mockStartModule.mockResolvedValue({ kind: 'refused', code: 'daily_limit', retryAt: RETRY });
      await renderOn();
      await openDrawer();
      tick('clients');
      await act(async () => {
        fireEvent.click(screen.getByTestId('export-submit'));
      });
      expect(screen.getByRole('alert')).toHaveTextContent(`You can export again at ${fmt(RETRY)}.`);
      tick('quotes');
      expect(screen.getByTestId('export-submit')).toBeDisabled();
      await act(async () => {
        jest.advanceTimersByTime(Date.parse(RETRY) - Date.now() + 1);
      });
      expect(screen.getByTestId('export-submit')).toBeEnabled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('the history: newest first, the request date, module names, status words, sent date and email count (never "delivered")', async () => {
    await renderOn();
    await openDrawer();
    const list = await screen.findByTestId('export-history-list');
    expect(within(list).getByTestId('export-history-requested')).toHaveTextContent(`Requested ${fmt(T)}`);
    const lines = within(list).getAllByTestId('export-history-line');
    expect(lines.map((line) => line.getAttribute('data-status'))).toEqual(['sent', 'waiting']);
    expect(lines[0]).toHaveTextContent('Quotes');
    expect(lines[0]).toHaveTextContent(en.status.sent);
    expect(lines[0]).toHaveTextContent(`Sent ${fmt(T)} · 2 emails`);
    expect(lines[1]).toHaveTextContent(en.status.waiting);
    expect(list.textContent).not.toMatch(/deliver/i);
  });

  it('an empty history says so', async () => {
    await renderOn('button', { kind: 'ok', requests: [] });
    mockProbe.mockResolvedValue({ kind: 'ok', requests: [] });
    await openDrawer();
    expect(await screen.findByTestId('export-history-empty')).toHaveTextContent(en.historyEmpty);
  });

  it('a support-sent request carries its label (BQ-E5-1)', async () => {
    const adminSent: ExportHistoryRequest[] = [{ ...HISTORY[0], origin: 'admin' }];
    await renderOn('button', { kind: 'ok', requests: adminSent });
    mockProbe.mockResolvedValue({ kind: 'ok', requests: adminSent });
    await openDrawer();
    expect(await screen.findByText(en.origin.admin)).toBeInTheDocument();
  });
});

describe('Hebrew (RTL)', () => {
  beforeEach(() => {
    mockLanguage = { language: 'he', isRTL: true, timezone: 'Asia/Jerusalem' };
  });

  it('the drawer opens from the left, the words are Hebrew, and a history date is in the owner clock, kept whole (C-8)', async () => {
    await renderOn('row');
    const drawer = await openDrawer();
    expect(drawer).toHaveAttribute('data-side', 'left');
    expect(drawer).toHaveAttribute('dir', 'rtl');
    expect(within(drawer).getByText(he.selectAll)).toBeInTheDocument();
    const requested = await screen.findByTestId('export-history-requested');
    const bdi = requested.querySelector('bdi');
    expect(bdi).not.toBeNull();
    expect(bdi!.textContent).toBe(fmt(T, 'he', 'Asia/Jerusalem'));
  });

  it('the row chevron is mirrored', async () => {
    await renderOn('row');
    const entry = screen.getByRole('button', { name: he.entryLabel });
    expect(entry.querySelector('svg.scale-x-\\[-1\\]')).not.toBeNull();
  });
});
