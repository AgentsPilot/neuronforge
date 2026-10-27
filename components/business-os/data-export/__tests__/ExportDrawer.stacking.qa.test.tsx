/**
 * @jest-environment jsdom
 *
 * QA (MX-1b / E5, 2026-10-27): nested Radix stacking beyond T-9. Real
 * `components/ui/dialog` host and real Radix sheet; only the seam and sonner
 * are mocked.
 *
 *   - Escape while a request is in flight closes neither layer, the request
 *     then STARTS (not refused, as in T-9), the confirmation lands in the
 *     drawer's status region, and Escape then closes only the drawer with
 *     focus back on "Export data";
 *   - the X is disabled while busy;
 *   - re-opening the drawer clears the old confirmation and the ticks.
 */

import '@testing-library/jest-dom';
import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ModuleExportHistoryVerdict, ModuleExportStartVerdict } from '@/lib/client/businessOsDataExport';

const mockProbe = jest.fn<Promise<ModuleExportHistoryVerdict>, []>();
const mockStartModule = jest.fn<Promise<ModuleExportStartVerdict>, [readonly string[]]>();
const mockStartZip = jest.fn();
jest.mock('@/lib/client/businessOsDataExport', () => ({
  startDataExport: () => mockStartZip(),
  downloadDataExportAgain: jest.fn(),
  fetchLastDataExport: jest.fn(async () => ({ kind: 'ok', lastExport: null })),
  saveSignedDownload: jest.fn(() => true),
  fetchModuleExportHistory: () => mockProbe(),
  startModuleExport: (modules: readonly string[]) => mockStartModule(modules),
}));
const mockToast = jest.fn();
jest.mock('sonner', () => ({ toast: { success: (...a: unknown[]) => mockToast(...a) } }));

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { DownloadMyDataButton } from '../DownloadMyDataButton';
import { EXPORT_DRAWER_COPY } from '../exportDrawerCopy';

const en = EXPORT_DRAWER_COPY.en;
const REQUEST = '33333333-3333-4333-8333-333333333333';
const EMAIL = 'owner@example.com';

function Host() {
  const [open, setOpen] = useState(true);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent data-testid="outer-dialog">
        <DialogTitle>Danger zone</DialogTitle>
        <DialogDescription>Delete or export your account.</DialogDescription>
        <DownloadMyDataButton variant="button" />
      </DialogContent>
    </Dialog>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const escape = async () =>
  act(async () => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockProbe.mockResolvedValue({ kind: 'ok', requests: [] });
});

it('in flight: Escape and the X close nothing; on start the status line confirms; then Escape closes only the drawer and focus returns', async () => {
  const pending = deferred<ModuleExportStartVerdict>();
  mockStartModule.mockReturnValue(pending.promise);
  render(<Host />);
  const entry = await screen.findByRole('button', { name: en.entryLabel });
  await act(async () => {
    entry.focus();
    fireEvent.click(entry);
  });
  const drawer = await screen.findByTestId('export-drawer');
  await waitFor(() => expect(drawer.contains(document.activeElement)).toBe(true));

  fireEvent.click(screen.getByTestId('export-module-clients'));
  await act(async () => {
    fireEvent.click(screen.getByTestId('export-submit'));
  });
  // The shell's own X (aria-label); the sheet primitive's built-in X is CSS-hidden by SettingsDrawer.
  expect(drawer.querySelector(`button[aria-label="${en.close}"]`)).toBeDisabled();
  await escape();
  await escape();
  expect(screen.getByTestId('export-drawer')).toBeInTheDocument();
  expect(screen.getByTestId('outer-dialog')).toBeInTheDocument();

  await act(async () => pending.resolve({ kind: 'started', requestId: REQUEST, sentTo: EMAIL, requestedEmailSent: true }));
  expect(await screen.findByTestId('export-started')).toHaveTextContent(EMAIL);
  expect(mockToast).toHaveBeenCalledTimes(1);
  expect(mockStartModule).toHaveBeenCalledTimes(1);
  expect(mockStartZip).not.toHaveBeenCalled();

  await escape();
  await waitFor(() => expect(screen.queryByTestId('export-drawer')).not.toBeInTheDocument());
  expect(screen.getByTestId('outer-dialog')).toBeInTheDocument();
  await waitFor(() => expect(document.activeElement).toBe(entry));

  // Re-open: the old confirmation and ticks are gone (BQ-E5-3: nothing pre-ticked).
  await act(async () => {
    fireEvent.click(entry);
  });
  await screen.findByTestId('export-drawer');
  expect(screen.queryByTestId('export-started')).not.toBeInTheDocument();
  expect(screen.getByTestId('export-module-clients')).toHaveAttribute('data-state', 'unchecked');
  expect(screen.getByTestId('export-submit')).toBeDisabled();

  await escape();
  await waitFor(() => expect(screen.queryByTestId('export-drawer')).not.toBeInTheDocument());
  await escape();
  await waitFor(() => expect(screen.queryByTestId('outer-dialog')).not.toBeInTheDocument());
});
