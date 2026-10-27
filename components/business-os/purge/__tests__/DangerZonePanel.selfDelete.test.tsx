/**
 * @jest-environment jsdom
 *
 * The Danger Zone switch (data export DE-10b.2; workplan §4.3; SA V-8; QA E-1
 * and the SA addendum). The HOST surface owns the one pre-check per open and
 * follows it:
 *
 *   - /business-os/settings: `ErasureDialogBody` inside the one Radix dialog
 *   - /v2/settings, /settings: the boxed `DangerZonePanel`'s expanded region
 *
 * Off, loading or a failed check → today's heading, today's host warning and
 * today's body. Ready → the heading "Delete my account", the warning exactly
 * once (the drawer's), no download control, no mailto outside the blockers.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

jest.mock('@/components/business-os/data-export/DownloadMyDataButton', () => ({
  DownloadMyDataButton: () => <div data-testid="download-my-data" />,
}));
jest.mock('@/lib/client/auth-actions', () => ({ signOutUser: jest.fn() }));

import { DangerZonePanel, ErasureDialogBody, ErasureRequestContent } from '@/components/business-os/purge/DangerZonePanel';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';

const CHECK_URL = '/api/business-os/account/deletion-check';
const HOST_WARNING = 'This will delete all your data and cannot be undone.';
const DRAWER_WARNING = /^Before you delete, download your data/;
const READY = { enabled: true, available: true, blockers: [], willKeepBilling: false, exportFacts: { lastReadyAt: null, downloaded: false } };

const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});
afterAll(() => {
  delete (global as unknown as { fetch?: typeof fetch }).fetch;
});

const answer = (data: unknown, status = 200) =>
  fetchMock.mockResolvedValue({ ok: status === 200, status, json: async () => ({ success: true, data }) });
const checkCalls = () => fetchMock.mock.calls.filter(([url]) => url === CHECK_URL).length;

/** The /business-os/settings shape: one dialog, the shared body inside its content. */
function SettingsDialog() {
  return (
    <Dialog>
      <DialogTrigger>Open delete</DialogTrigger>
      <DialogContent>
        <ErasureDialogBody />
      </DialogContent>
    </Dialog>
  );
}

function warningsIn(root: HTMLElement) {
  const host = within(root).queryAllByText(HOST_WARNING).length;
  const drawer = within(root).queryAllByText(DRAWER_WARNING).length;
  return { host, drawer, total: host + drawer };
}

describe('the /business-os/settings dialog body', () => {
  it('off → today\'s description and warning, today\'s body, one check for the open', async () => {
    answer({ enabled: false });
    render(<SettingsDialog />);
    expect(checkCalls()).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Open delete' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(checkCalls()).toBe(1));
    expect(within(dialog).getByText('Delete Your Account?')).toBeInTheDocument();
    expect(within(dialog).getByText('Request account erasure')).toBeInTheDocument();
    expect(warningsIn(dialog)).toEqual({ host: 1, drawer: 0, total: 1 });
    expect(within(dialog).getByTestId('download-my-data')).toBeInTheDocument();
    expect(within(dialog).queryByTestId('delete-account-drawer')).toBeNull();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('ready → "Delete my account", the warning exactly once, title and description kept, one check', async () => {
    answer(READY);
    render(<SettingsDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Open delete' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByTestId('delete-account-drawer');
    expect(checkCalls()).toBe(1);
    expect(within(dialog).getByText('Delete Your Account?')).toBeInTheDocument();
    expect(within(dialog).getByText('Delete my account')).toBeInTheDocument();
    expect(within(dialog).queryByText('Request account erasure')).toBeNull();
    expect(warningsIn(dialog)).toEqual({ host: 0, drawer: 1, total: 1 });
    // Radix still names and describes the dialog.
    expect(dialog).toHaveAccessibleName('Delete Your Account?');
    expect(dialog).toHaveAccessibleDescription('Delete my account');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('a failed check → exactly today\'s text', async () => {
    answer({ enabled: true }, 500);
    render(<SettingsDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Open delete' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(checkCalls()).toBe(1));
    expect(within(dialog).getByText('Request account erasure')).toBeInTheDocument();
    expect(warningsIn(dialog)).toEqual({ host: 1, drawer: 0, total: 1 });
  });
});

describe('the boxed DangerZonePanel', () => {
  it('off → no check while closed; one per open; today\'s heading and warning', async () => {
    answer({ enabled: false });
    const { container } = render(<DangerZonePanel />);
    expect(checkCalls()).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const region = await screen.findByRole('region', { name: 'Request account erasure' });
    await waitFor(() => expect(checkCalls()).toBe(1));
    expect(within(region).getByRole('heading', { name: 'Request account erasure' })).toBeInTheDocument();
    expect(warningsIn(container)).toEqual({ host: 1, drawer: 0, total: 1 });
    expect(within(region).getByTestId('download-my-data')).toBeInTheDocument();

    // Close and reopen: one more check, not two.
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(checkCalls()).toBe(2));
  });

  it('ready → "Delete my account", the host warning gone so the warning shows once; back on close', async () => {
    answer(READY);
    const { container } = render(<DangerZonePanel />);
    expect(warningsIn(container)).toEqual({ host: 1, drawer: 0, total: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const region = await screen.findByRole('region', { name: 'Delete my account' });
    await within(region).findByTestId('delete-account-drawer');
    expect(checkCalls()).toBe(1);
    expect(within(region).getByRole('heading', { name: 'Delete my account' })).toBeInTheDocument();
    await waitFor(() => expect(warningsIn(container)).toEqual({ host: 0, drawer: 1, total: 1 }));
    expect(within(region).queryByTestId('download-my-data')).toBeNull();
    expect(container.querySelector('a[href^="mailto:"]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.queryByRole('region')).toBeNull();
    expect(warningsIn(container)).toEqual({ host: 1, drawer: 0, total: 1 });
  });

  it('ready with blockers → the mailto appears only inside the blocker list', async () => {
    // P-7a.3: `plan_running` now points at Settings → Plan and carries no
    // address, so the blocker that still names {support} carries the mailto.
    answer({ ...READY, blockers: [{ code: 'plan_running' }, { code: 'contact_support' }] });
    const { container } = render(<DangerZonePanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const list = await screen.findByTestId('delete-account-blockers');
    const mailtos = Array.from(container.querySelectorAll('a[href^="mailto:"]'));
    expect(mailtos.length).toBe(1);
    expect(list.contains(mailtos[0])).toBe(true);
  });

  it('an unexpected shape → today\'s body', async () => {
    answer({ enabled: true, available: 'yes' });
    render(<DangerZonePanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(checkCalls()).toBe(1));
    expect(screen.getByRole('region', { name: 'Request account erasure' })).toBeInTheDocument();
    expect(screen.queryByTestId('delete-account-drawer')).toBeNull();
  });
});

describe('ErasureRequestContent on its own', () => {
  it('fetches nothing and shows today\'s body without a state from its host', () => {
    render(<ErasureRequestContent />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('download-my-data')).toBeInTheDocument();
  });
});
