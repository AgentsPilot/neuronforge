/**
 * @jest-environment jsdom
 *
 * QA pre-merge pass for DE-10b.2 (workplan § SA Code Review — 2026-10-21,
 * "What QA must exercise"). Gaps the Dev suites did not cover:
 *
 *   - a keyboard-only pass with user-event INSIDE the real Radix dialog that
 *     hosts `ErasureRequestContent` on /business-os/settings (V-8): Tab reaches
 *     the box, typing + Enter submits, there is one dialog only, Escape closes
 *     it and focus returns to the trigger;
 *   - the boxed `DangerZonePanel` (the /v2/settings and /settings surface):
 *     switch off → today's body inside the region, switch on → the steps there;
 *   - the Hebrew statement typed with niqqud (and bidi marks) enables the button;
 *   - the Spanish dictionary carries the N-3 uncounted keys and every
 *     `settings.account_delete.*` key the English one has.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockSignOut = jest.fn();
jest.mock('@/lib/client/auth-actions', () => ({ signOutUser: (...args: unknown[]) => mockSignOut(...args) }));
jest.mock('@/components/business-os/data-export/DownloadMyDataButton', () => ({
  DownloadMyDataButton: () => <button type="button" data-testid="download-my-data">Download my data</button>,
}));

import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { DangerZonePanel, ErasureDialogBody } from '@/components/business-os/purge/DangerZonePanel';
import { DeleteAccountDrawer, type CopyFn } from '../DeleteAccountDrawer';
import { DELETION_STATEMENTS } from '@/lib/business-os/account-deletion/acknowledgement';
import { en } from '@/lib/business-os/translations/en';
import { he } from '@/lib/business-os/translations/he';
import { es } from '@/lib/business-os/translations/es';

const READY = { enabled: true as const, available: true as const, blockers: [], willKeepBilling: false, exportFacts: { lastReadyAt: null, downloaded: false } };

jest.setTimeout(30000);

const fetchMock = jest.fn();
let deleteAnswer: { status: number; body: unknown } = { status: 400, body: { success: false, error: 'statement_mismatch' } };

function routeFetch(checkData: unknown) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/business-os/account/deletion-check') {
      return { ok: true, status: 200, json: async () => ({ success: true, data: checkData }) };
    }
    return { ok: deleteAnswer.status === 200, status: deleteAnswer.status, json: async () => deleteAnswer.body };
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  mockSignOut.mockReset().mockResolvedValue({ ok: true });
  deleteAnswer = { status: 400, body: { success: false, error: 'statement_mismatch' } };
  (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});
afterAll(() => {
  delete (global as unknown as { fetch?: typeof fetch }).fetch;
});

/** The /business-os/settings shape: one Radix dialog, the shared body inside it, a Close button after it. */
function SettingsDialog() {
  return (
    <Dialog>
      <DialogTrigger>Delete account</DialogTrigger>
      <DialogContent>
        {/* QA E-1 (Dev): the host body owns the title, the description and the one pre-check. */}
        <ErasureDialogBody />
      </DialogContent>
    </Dialog>
  );
}

const deleteCalls = () => fetchMock.mock.calls.filter(([url]) => url === '/api/business-os/account/delete');

describe('keyboard-only pass inside the one settings dialog (V-8)', () => {
  it('Tab reaches the box, Enter submits, one dialog only, Escape closes it and focus returns', async () => {
    routeFetch(READY);
    const user = userEvent.setup({ delay: null });
    render(<SettingsDialog />);

    const trigger = screen.getByRole('button', { name: 'Delete account' });
    trigger.focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByTestId('delete-account-drawer');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);

    const box = within(dialog).getByLabelText('Type the statement to confirm');
    for (let i = 0; i < 10 && document.activeElement !== box; i += 1) await user.tab();
    expect(document.activeElement).toBe(box);

    const button = within(dialog).getByRole('button', { name: 'Delete my account forever' });
    expect(button).toBeDisabled();
    await user.keyboard(DELETION_STATEMENTS.en);
    expect(button).toBeEnabled();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(deleteCalls()).toHaveLength(1));
    expect(JSON.parse(deleteCalls()[0][1].body)).toEqual({ statement: DELETION_STATEMENTS.en, language: 'en' });
    // The refusal renders in an alert inside the same dialog; still one dialog.
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The statement does not match');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);

    // Tab moves on to the Delete button (reachable), Escape closes the dialog.
    await user.tab();
    expect(document.activeElement).toBe(button);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('Enter in the box does nothing while the statement does not match', async () => {
    routeFetch(READY);
    const user = userEvent.setup({ delay: null });
    render(<SettingsDialog />);
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    const box = await screen.findByLabelText('Type the statement to confirm');
    await user.click(box);
    await user.keyboard('I want my account deleted{Enter}');
    expect(deleteCalls()).toHaveLength(0);
  });

  it('switch off: the same dialog shows today\'s body (export + Contact us), no box', async () => {
    routeFetch({ enabled: false });
    const user = userEvent.setup({ delay: null });
    render(<SettingsDialog />);
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(within(dialog).getByTestId('download-my-data')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Contact us' })).toBeInTheDocument();
    expect(within(dialog).queryByTestId('delete-account-drawer')).toBeNull();
  });
});

describe('the boxed DangerZonePanel (/v2/settings, /settings)', () => {
  it('switch off → today\'s body inside the region, and the check runs only once the panel opens', async () => {
    routeFetch({ enabled: false });
    const user = userEvent.setup({ delay: null });
    render(<DangerZonePanel />);
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const region = await screen.findByRole('region');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(within(region).getByTestId('download-my-data')).toBeInTheDocument();
    expect(within(region).getByRole('link', { name: 'Contact us' })).toBeInTheDocument();
    expect(within(region).queryByTestId('delete-account-drawer')).toBeNull();
  });

  it('switch on → the steps inside the region, no download control, no second dialog', async () => {
    routeFetch(READY);
    const user = userEvent.setup({ delay: null });
    render(<DangerZonePanel />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const region = await screen.findByRole('region');
    expect(await within(region).findByTestId('delete-account-drawer')).toBeInTheDocument();
    expect(within(region).queryByTestId('download-my-data')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('switch on but not available (no cleanup secret) → the not-available line with the support address', async () => {
    routeFetch({ ...READY, available: false });
    const user = userEvent.setup({ delay: null });
    render(<DangerZonePanel />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const region = await screen.findByRole('region');
    const status = await within(region).findByRole('status');
    expect(status).toHaveTextContent('Deleting your account is not available right now');
    expect(status.querySelector('a[href^="mailto:"]')).not.toBeNull();
    expect(within(region).queryByLabelText('Type the statement to confirm')).toBeNull();
  });
});

describe('Hebrew pass', () => {
  const tr = (dictionary: Record<string, string>): CopyFn => (key, vars) => {
    let text = dictionary[key] ?? key;
    for (const [name, value] of Object.entries(vars ?? {})) text = text.split(`{${name}}`).join(String(value));
    return text;
  };

  it('the Hebrew statement typed with niqqud and bidi marks enables the button; Enter sends the typed text as is', async () => {
    deleteAnswer = { status: 200, body: { success: true, data: { redirect: '/account-deleted?lang=he' } } };
    routeFetch(READY);
    const navigate = jest.fn();
    const user = userEvent.setup({ delay: null });
    const dictionary = he as unknown as Record<string, string>;
    render(<DeleteAccountDrawer check={READY} tr={tr(dictionary)} language="he" isRTL navigate={navigate} />);
    const box = screen.getByLabelText(dictionary['settings.account_delete.statement_label']);
    expect(box).toHaveAttribute('dir', 'rtl');
    const typed = `‏${DELETION_STATEMENTS.he.replace('הורדתי', 'הוֹרַדְתִּי')}`;
    await user.click(box);
    await user.keyboard(typed);
    const button = screen.getByRole('button', { name: dictionary['settings.account_delete.delete_button'] });
    expect(button).toBeEnabled();
    await act(async () => {
      await user.keyboard('{Enter}');
    });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/account-deleted?lang=he'));
    expect(JSON.parse(deleteCalls()[0][1].body)).toEqual({ statement: typed, language: 'he' });
  });
});

describe('dictionaries', () => {
  const keys = (dictionary: unknown) =>
    Object.keys(dictionary as Record<string, string>)
      .filter((key) => key.startsWith('settings.account_delete.'))
      .sort();

  it('Spanish has the N-3 uncounted keys, with no {n}', () => {
    const dictionary = es as unknown as Record<string, string>;
    expect(dictionary['settings.account_delete.blocker.client_plans_running_uncounted']).toBeTruthy();
    expect(dictionary['settings.account_delete.blocker.client_payments_pending_uncounted']).toBeTruthy();
    expect(dictionary['settings.account_delete.blocker.client_plans_running_uncounted']).not.toContain('{n}');
    expect(dictionary['settings.account_delete.blocker.client_payments_pending_uncounted']).not.toContain('{n}');
  });

  it('en, he and es hold the same settings.account_delete.* key set, and each {support} line keeps its placeholder', () => {
    expect(keys(he)).toEqual(keys(en));
    expect(keys(es)).toEqual(keys(en));
    for (const dictionary of [en, he, es] as unknown as Array<Record<string, string>>) {
      for (const key of keys(en)) {
        if ((en as unknown as Record<string, string>)[key].includes('{support}')) expect(dictionary[key]).toContain('{support}');
        if ((en as unknown as Record<string, string>)[key].includes('{n}')) expect(dictionary[key]).toContain('{n}');
      }
    }
  });
});
