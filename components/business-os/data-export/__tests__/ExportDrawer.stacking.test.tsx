/**
 * @jest-environment jsdom
 *
 * The export drawer opened from INSIDE a dialog (export redesign MX-1b, T-9;
 * S-4 / SR-9; SA C-6). The host is the real `components/ui/dialog`, which is
 * DL-2's actual shape: `DeleteAccountDrawer` and the Danger Zone render inside
 * the settings dialog's `DialogContent`, and they render
 * `<DownloadMyDataButton variant="button" />`.
 *
 * Real Radix layers, no stand-ins (SA: if this cannot pass with real Radix,
 * stop and escalate; do not stub the layers). Only the network seam is mocked.
 * jsdom does not model `pointer-events`, so a pointer press on the outer
 * dialog's own area is QA 5 in a real browser.
 */

import '@testing-library/jest-dom';
import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ModuleExportHistoryVerdict, ModuleExportStartVerdict } from '@/lib/client/businessOsDataExport';

const mockProbe = jest.fn<Promise<ModuleExportHistoryVerdict>, []>();
const mockStartModule = jest.fn<Promise<ModuleExportStartVerdict>, [readonly string[]]>();
jest.mock('@/lib/client/businessOsDataExport', () => ({
  fetchModuleExportHistory: () => mockProbe(),
  startModuleExport: (modules: readonly string[]) => mockStartModule(modules),
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn() } }));

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { DownloadMyDataButton } from '../DownloadMyDataButton';
import { EXPORT_DRAWER_COPY } from '../exportDrawerCopy';

const en = EXPORT_DRAWER_COPY.en;
const OUTER_TITLE = 'Danger zone';

function DangerZoneLikeHost() {
  const [open, setOpen] = useState(true);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent data-testid="outer-dialog">
        <DialogTitle>{OUTER_TITLE}</DialogTitle>
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

async function openExportDrawer() {
  render(<DangerZoneLikeHost />);
  const entry = await screen.findByRole('button', { name: en.entryLabel });
  await act(async () => {
    entry.focus();
    fireEvent.click(entry);
  });
  const drawer = await screen.findByTestId('export-drawer');
  return { entry, drawer };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockProbe.mockResolvedValue({ kind: 'ok', requests: [] });
});

describe('the export drawer inside a dialog (SR-9)', () => {
  it('opens on top with focus inside; Escape closes only the drawer; focus returns to the entry; a press inside does not close the dialog; Escape then closes the dialog', async () => {
    const { entry, drawer } = await openExportDrawer();
    expect(screen.getByTestId('outer-dialog')).toBeInTheDocument();
    await waitFor(() => expect(drawer.contains(document.activeElement)).toBe(true));

    // A press inside the drawer is not "outside" for the dialog.
    const clients = screen.getByTestId('export-module-clients');
    fireEvent.pointerDown(clients);
    fireEvent.click(clients);
    expect(screen.getByTestId('outer-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('export-drawer')).toBeInTheDocument();

    // Escape goes to the top layer only.
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    });
    await waitFor(() => expect(screen.queryByTestId('export-drawer')).not.toBeInTheDocument());
    expect(screen.getByTestId('outer-dialog')).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(entry));

    // Then Escape closes the dialog itself.
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    });
    await waitFor(() => expect(screen.queryByTestId('outer-dialog')).not.toBeInTheDocument());
  });

  it('Escape while the request is in flight closes neither layer (SA C-6)', async () => {
    const pending = deferred<ModuleExportStartVerdict>();
    mockStartModule.mockReturnValue(pending.promise);
    await openExportDrawer();
    fireEvent.click(screen.getByTestId('export-module-clients'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('export-submit'));
    });
    expect(screen.getByTestId('export-submit')).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    });
    expect(screen.getByTestId('export-drawer')).toBeInTheDocument();
    expect(screen.getByTestId('outer-dialog')).toBeInTheDocument();

    await act(async () => pending.resolve({ kind: 'refused', code: 'in_progress' }));
    // Not busy any more: Escape closes the drawer again, and only the drawer.
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    });
    await waitFor(() => expect(screen.queryByTestId('export-drawer')).not.toBeInTheDocument());
    expect(screen.getByTestId('outer-dialog')).toBeInTheDocument();
  });
});
