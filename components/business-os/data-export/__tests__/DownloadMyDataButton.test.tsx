/**
 * @jest-environment jsdom
 *
 * DownloadMyDataButton after MX-3.1 (export redesign, workplan §7.1, §16.1):
 * no switch and no ZIP. Both variants read "Export data" and open the export
 * drawer; nothing is fetched on mount, and the drawer reads its own history
 * when it opens. The frozen props shape (SR-2 / B.6) is pinned from source.
 *
 * The browser seam and sonner are mocked; Radix (the sheet) is real.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ModuleExportHistoryVerdict, ModuleExportStartVerdict } from '@/lib/client/businessOsDataExport';

const mockHistory = jest.fn<Promise<ModuleExportHistoryVerdict>, []>();
const mockStartModule = jest.fn<Promise<ModuleExportStartVerdict>, [readonly string[]]>();
jest.mock('@/lib/client/businessOsDataExport', () => ({
  fetchModuleExportHistory: () => mockHistory(),
  startModuleExport: (modules: readonly string[]) => mockStartModule(modules),
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn() } }));

let mockLanguage: { language: 'en' | 'he'; isRTL: boolean } | null = null;
jest.mock('@/lib/business-os/LanguageContext', () => ({
  useOptionalLanguage: () => (mockLanguage ? { language: mockLanguage.language, isRTL: mockLanguage.isRTL } : undefined),
  useBusinessTimezone: () => ({ timezone: 'UTC', timeZoneOptions: (o: Intl.DateTimeFormatOptions = {}) => ({ ...o, timeZone: 'UTC' }) }),
}));

import DefaultExport, { DownloadMyDataButton } from '../DownloadMyDataButton';
import { EXPORT_DRAWER_COPY } from '../exportDrawerCopy';

const en = EXPORT_DRAWER_COPY.en;
const he = EXPORT_DRAWER_COPY.he;

beforeEach(() => {
  jest.clearAllMocks();
  mockLanguage = null;
  mockHistory.mockResolvedValue({ kind: 'ok', requests: [] });
});

describe('always the export drawer (MX-3.1)', () => {
  it.each(['row', 'button'] as const)('%s: reads "Export data" at once and fetches nothing on mount', (variant) => {
    render(<DownloadMyDataButton variant={variant} />);
    expect(screen.getByRole('button', { name: en.entryLabel })).toBeInTheDocument();
    expect(screen.queryByText('Download my data')).not.toBeInTheDocument();
    expect(mockHistory).not.toHaveBeenCalled();
    expect(mockStartModule).not.toHaveBeenCalled();
  });

  it('a click opens the drawer, which reads its own first history page once', async () => {
    render(<DownloadMyDataButton variant="button" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.entryLabel }));
    });
    expect(await screen.findByTestId('export-drawer')).toBeInTheDocument();
    await waitFor(() => expect(mockHistory).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('export-history-empty')).toHaveTextContent(en.historyEmpty);
  });

  it('while the first read is in flight the history says nothing has failed (loading, not error)', async () => {
    let resolve!: (v: ModuleExportHistoryVerdict) => void;
    mockHistory.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<DownloadMyDataButton variant="button" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.entryLabel }));
    });
    expect(screen.queryByTestId('export-history-error')).not.toBeInTheDocument();
    await act(async () => resolve({ kind: 'ok', requests: [] }));
    expect(await screen.findByTestId('export-history-empty')).toBeInTheDocument();
  });

  it('Escape closes the drawer and focus returns to the entry', async () => {
    render(<DownloadMyDataButton variant="button" />);
    const entry = screen.getByRole('button', { name: en.entryLabel });
    await act(async () => {
      fireEvent.click(entry);
    });
    const drawer = await screen.findByTestId('export-drawer');
    await act(async () => {
      fireEvent.keyDown(drawer, { key: 'Escape' });
    });
    await waitFor(() => expect(screen.queryByTestId('export-drawer')).not.toBeInTheDocument());
    await waitFor(() => expect(entry).toHaveFocus());
  });

  it('Hebrew: the entry reads the Hebrew label', () => {
    mockLanguage = { language: 'he', isRTL: true };
    render(<DownloadMyDataButton variant="row" />);
    expect(screen.getByRole('button', { name: he.entryLabel })).toBeInTheDocument();
  });

  it('the default export is the same component', () => {
    expect(DefaultExport).toBe(DownloadMyDataButton);
  });
});

describe('frozen shape and no switch (source)', () => {
  const source = readFileSync(join(__dirname, '..', 'DownloadMyDataButton.tsx'), 'utf8').replace(/\r\n/g, '\n');

  it('keeps the frozen props interface (SR-2 / B.6)', () => {
    expect(source).toMatch(/export interface DownloadMyDataButtonProps \{[\s\S]*?variant: 'row' \| 'button';[\s\S]*?className\?: string;[\s\S]*?\}/);
    expect(source).toContain('export function DownloadMyDataButton({ variant, className = \'\' }: DownloadMyDataButtonProps)');
    expect(source).toContain('export default DownloadMyDataButton;');
  });

  it('renders only the module export entry: no ZIP control, no switch probe', () => {
    expect(source).toContain('<ModuleExportEntry');
    expect(source).not.toMatch(/ZipDownloadControl|useModuleExportSwitch|useDownloadMyData|featureFlags/);
  });
});
