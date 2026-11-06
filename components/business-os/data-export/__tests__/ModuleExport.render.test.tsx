/**
 * @jest-environment jsdom
 *
 * The export entry and drawer (export redesign MX-1b, workplan §9, §10, T-8;
 * SA C-1, C-8, C-12; BQ-E5-2, BQ-E5-3). MX-3.1: no switch and no ZIP; the
 * drawer reads its own history when it opens.
 *
 * The browser seam and sonner are mocked; Radix (the sheet) and Intl are real.
 * Rendered without a LanguageProvider (en, UTC: /v2, /settings) and with one
 * stubbed (he, Asia/Jerusalem: /business-os/settings).
 */

import '@testing-library/jest-dom';
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type {
  ExportHistoryRequest,
  ModuleExportHistoryCursor,
  ModuleExportHistoryVerdict,
  ModuleExportStartVerdict,
} from '@/lib/client/businessOsDataExport';

type HistoryOptions = { before?: ModuleExportHistoryCursor } | undefined;
const mockHistory = jest.fn<Promise<ModuleExportHistoryVerdict>, [HistoryOptions]>();
const mockStartModule = jest.fn<Promise<ModuleExportStartVerdict>, [readonly string[]]>();
jest.mock('@/lib/client/businessOsDataExport', () => ({
  fetchModuleExportHistory: (options?: HistoryOptions) => mockHistory(options),
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
import { EXPORT_DRAWER_COPY } from '../exportDrawerCopy';
import { EXPORT_TIME_FIELDS } from '../formatExportTime';
import { EXPORT_MODULES, enabledModules } from '@/lib/business-os/data-export/exportModules';

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

/** A history page (MX-4b: every ok answer carries hasMore and nextExportAt). */
const ok = (
  requests: ExportHistoryRequest[],
  extra: { hasMore?: boolean; nextExportAt?: string | null } = {}
): ModuleExportHistoryVerdict => ({ kind: 'ok', requests, hasMore: extra.hasMore ?? false, nextExportAt: extra.nextExportAt ?? null });

async function renderOn(variant: 'row' | 'button' = 'button', history: ModuleExportHistoryVerdict = ok(HISTORY)) {
  mockHistory.mockResolvedValue(history);
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
  mockStartModule.mockResolvedValue({ kind: 'started', requestId: REQUEST, sentTo: EMAIL, requestedEmailSent: true });
});

describe('the export drawer', () => {
  it.each(['row', 'button'] as const)('%s: the entry reads "Export data" (BQ-E5-2) and opens the drawer', async (variant) => {
    await renderOn(variant);
    const drawer = await openDrawer();
    expect(within(drawer).getByText(en.title, { selector: 'h2' })).toBeInTheDocument();
    expect(screen.queryByText('Download my data')).not.toBeInTheDocument();
  });

  it('a failed history read opens the drawer anyway and says the history could not be loaded, with Try again (MX-3.1)', async () => {
    await renderOn('button', { kind: 'error' });
    await openDrawer();
    expect(await screen.findByTestId('export-history-error')).toHaveTextContent(en.historyUnavailable);
    mockHistory.mockResolvedValue(ok(HISTORY));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.tryAgain }));
    });
    expect(await screen.findByTestId('export-history-list')).toBeInTheDocument();
  });

  it('nothing is ticked on open, Export is off, the files sentence is shown (BQ-E5-3, BQ-35)', async () => {
    await renderOn();
    await openDrawer();
    for (const entry of enabledModules()) expect(screen.getByTestId(`export-module-${entry.id}`)).toHaveAttribute('data-state', 'unchecked');
    // A switched-off module is not offered at all (user decision 2026-10-31).
    for (const entry of EXPORT_MODULES.filter((m) => !m.on)) expect(screen.queryByTestId(`export-module-${entry.id}`)).toBeNull();
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
    // Two modules the real map ships switched on, ticked against map order.
    tick('quotes');
    tick('clients');
    const historyCallsBefore = mockHistory.mock.calls.length;
    await act(async () => {
      fireEvent.click(screen.getByTestId('export-submit'));
    });
    expect(mockStartModule).toHaveBeenCalledWith(['clients', 'quotes']);
    // SA CR-3: the address in the toast is isolated with FSI / PDI.
    expect(mockToastSuccess).toHaveBeenCalledWith(`Export started. The exported files will be sent to ⁨${EMAIL}⁩ once ready.`);
    // SA CR-1: the same sentence is announced in the drawer's own polite status region, the address in <bdi>.
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(`Export started. The exported files will be sent to ${EMAIL} once ready.`);
    expect(within(status).getByTestId('export-started').querySelector('bdi')?.textContent).toBe(EMAIL);
    expect(screen.getByTestId('export-module-clients')).toHaveAttribute('data-state', 'unchecked');
    expect(mockHistory.mock.calls.length).toBeGreaterThan(historyCallsBefore);
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
    await renderOn('button', ok([]));
    mockHistory.mockResolvedValue(ok([]));
    await openDrawer();
    expect(await screen.findByTestId('export-history-empty')).toHaveTextContent(en.historyEmpty);
  });

  it('a support-sent request carries its label (BQ-E5-1)', async () => {
    const adminSent: ExportHistoryRequest[] = [{ ...HISTORY[0], origin: 'admin' }];
    await renderOn('button', ok(adminSent));
    mockHistory.mockResolvedValue(ok(adminSent));
    await openDrawer();
    expect(await screen.findByText(en.origin.admin)).toBeInTheDocument();
  });
});

describe('MX-4b: "Show older" (H-1) and "export again at" on open (N-1), T-16', () => {
  const OLDER = '44444444-4444-4444-8444-444444444444';
  const OLDEST = '55555555-5555-4555-8555-555555555555';
  // A database time with microseconds: it must go back as it came (SA C-4).
  const T_MICRO = '2026-10-26T09:00:00.123456+00:00';
  const request = (requestId: string, requestedAt: string): ExportHistoryRequest => ({
    requestId,
    requestedAt,
    origin: 'owner',
    modules: [{ module: 'clients', status: 'sent', sentAt: requestedAt, emailCount: 1 }],
  });

  it('no "Show older" without hasMore', async () => {
    await renderOn('button', ok(HISTORY));
    await openDrawer();
    await screen.findByTestId('export-history-list');
    expect(screen.queryByTestId('export-history-show-older')).toBeNull();
  });

  it('"Show older" appears with hasMore, sends the last request as the cursor untouched, appends, drops a repeated id, and hides when no more', async () => {
    await renderOn('button', ok([request(REQUEST, T), request(OLDER, T_MICRO)], { hasMore: true }));
    await openDrawer();
    const button = await screen.findByTestId('export-history-show-older');
    expect(button).toHaveTextContent(en.historyShowOlder);

    // The older page repeats OLDER (a row at the page edge) and adds OLDEST.
    mockHistory.mockResolvedValue(ok([request(OLDER, T_MICRO), request(OLDEST, '2026-10-25T09:00:00.000Z')], { hasMore: false }));
    await act(async () => {
      fireEvent.click(button);
    });
    expect(mockHistory).toHaveBeenLastCalledWith({ before: { requestedAt: T_MICRO, requestId: OLDER } });
    const ids = screen
      .getAllByTestId(/^export-history-request-/)
      .map((element) => element.getAttribute('data-testid')?.replace('export-history-request-', ''));
    expect(ids).toEqual([REQUEST, OLDER, OLDEST]);
    expect(screen.queryByTestId('export-history-show-older')).toBeNull();
  });

  it('a failed older read keeps the list, says so, and Try again reads the same page again', async () => {
    await renderOn('button', ok([request(REQUEST, T), request(OLDER, T_MICRO)], { hasMore: true }));
    await openDrawer();
    const button = await screen.findByTestId('export-history-show-older');
    mockHistory.mockResolvedValue({ kind: 'error' });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(screen.getByTestId('export-history-older-error')).toHaveTextContent(en.historyOlderUnavailable);
    expect(screen.getAllByTestId(/^export-history-request-/)).toHaveLength(2);
    expect(screen.queryByTestId('export-history-error')).toBeNull();

    mockHistory.mockResolvedValue(ok([request(OLDEST, '2026-10-25T09:00:00.000Z')]));
    await act(async () => {
      fireEvent.click(within(screen.getByTestId('export-history-older')).getByRole('button', { name: en.tryAgain }));
    });
    expect(mockHistory).toHaveBeenLastCalledWith({ before: { requestedAt: T_MICRO, requestId: OLDER } });
    expect(screen.getAllByTestId(/^export-history-request-/)).toHaveLength(3);
    expect(screen.queryByTestId('export-history-older-error')).toBeNull();
  });

  it('while an older page loads the button is busy and a second click reads nothing more', async () => {
    await renderOn('button', ok([request(REQUEST, T)], { hasMore: true }));
    await openDrawer();
    const button = await screen.findByTestId('export-history-show-older');
    const pending = deferred<ModuleExportHistoryVerdict>();
    mockHistory.mockReturnValue(pending.promise);
    const callsBefore = mockHistory.mock.calls.length;
    await act(async () => {
      fireEvent.click(button);
    });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(button);
    expect(mockHistory.mock.calls.length).toBe(callsBefore + 1);
    await act(async () => pending.resolve(ok([])));
  });

  it('SA CR-1: "Show older" during a first-page reload never appends to the new first page (no gap in the history)', async () => {
    const DEEP = '66666666-6666-4666-8666-666666666666';
    const NEW = '77777777-7777-4777-8777-777777777777';
    const BEYOND = '88888888-8888-4888-8888-888888888888';
    // A list two pages deep, with more still older.
    await renderOn('button', ok([request(REQUEST, T), request(OLDER, T_MICRO)], { hasMore: true }));
    await openDrawer();
    mockHistory.mockResolvedValueOnce(ok([request(DEEP, '2026-10-20T09:00:00.000Z')], { hasMore: true }));
    await act(async () => {
      fireEvent.click(await screen.findByTestId('export-history-show-older'));
    });
    expect(screen.getAllByTestId(/^export-history-request-/)).toHaveLength(3);

    // A start: the history reloads, and that first-page read is held open.
    const firstPage = deferred<ModuleExportHistoryVerdict>();
    const olderPage = deferred<ModuleExportHistoryVerdict>();
    mockHistory.mockImplementation((options) => (options?.before ? olderPage.promise : firstPage.promise));
    tick('clients');
    await act(async () => {
      fireEvent.click(screen.getByTestId('export-submit'));
    });
    // The deep list is still on screen; a click on "Show older" now must not read past the deep cursor.
    await act(async () => {
      fireEvent.click(screen.getByTestId('export-history-show-older'));
    });
    await act(async () => firstPage.resolve(ok([request(NEW, '2026-10-28T09:00:00.000Z'), request(REQUEST, T)], { hasMore: true })));
    await act(async () => olderPage.resolve(ok([request(BEYOND, '2026-10-10T09:00:00.000Z')], { hasMore: false })));
    const ids = screen
      .getAllByTestId(/^export-history-request-/)
      .map((element) => element.getAttribute('data-testid')?.replace('export-history-request-', ''));
    expect(ids).toEqual([NEW, REQUEST]);
    expect(screen.getByTestId('export-history-show-older')).toBeInTheDocument();
  });

  it('opened at the limit: Export is off with the "export again at" sentence, and comes back on at that time', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-27T12:00:00.000Z') });
    try {
      await renderOn('button', ok(HISTORY, { nextExportAt: RETRY }));
      await openDrawer();
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByRole('alert')).toHaveTextContent(`You can export again at ${fmt(RETRY)}.`);
      tick('clients');
      expect(screen.getByTestId('export-submit')).toBeDisabled();
      await act(async () => {
        jest.advanceTimersByTime(Date.parse(RETRY) - Date.now() + 1);
      });
      expect(screen.getByTestId('export-submit')).toBeEnabled();
      expect(screen.getByTestId('export-alert')).toBeEmptyDOMElement();
    } finally {
      jest.useRealTimers();
    }
  });

  it('a nextExportAt already past, or none, leaves Export on and says nothing', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-29T12:00:00.000Z') });
    try {
      await renderOn('button', ok(HISTORY, { nextExportAt: RETRY }));
      await openDrawer();
      await act(async () => {
        await Promise.resolve();
      });
      tick('clients');
      expect(screen.getByTestId('export-submit')).toBeEnabled();
      expect(screen.getByTestId('export-alert')).toBeEmptyDOMElement();
    } finally {
      jest.useRealTimers();
    }
  });

  it('a failed history read on open leaves Export on (the POST decides)', async () => {
    await renderOn('button', { kind: 'error' });
    await openDrawer();
    await screen.findByTestId('export-history-error');
    tick('clients');
    expect(screen.getByTestId('export-submit')).toBeEnabled();
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
