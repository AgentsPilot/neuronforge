/**
 * @jest-environment jsdom
 *
 * The Danger Zone with an open deletion request (DL-2a; DL-2 workplan §5.2,
 * §5.5, §8, §12 T-5; SA W-4 d, W-10). Both hosts: the `/business-os/settings`
 * dialog body and the boxed panel (no provider, English fallback).
 *
 *   - an open closure → the pending view; the pre-check is never fetched
 *   - none, or a closure read error → the pre-check, as before
 *   - Keep: the message stays after the re-read empties the closure; the host
 *     page is refreshed; a second press is ignored while one is in flight
 *   - a recorded request swaps the form for the pending view and moves focus
 */

import '@testing-library/jest-dom';
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// SA CR-1: the hosts refresh through `useRouter()` from next/navigation.
const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh, push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }) }));
jest.mock('@/components/business-os/data-export/DownloadMyDataButton', () => ({
  DownloadMyDataButton: () => <button type="button" data-testid="download-my-data">Download my data</button>,
}));

import { DangerZonePanel, ErasureDialogBody, dangerZoneMode } from '@/components/business-os/purge/DangerZonePanel';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { DELETION_STATEMENTS } from '@/lib/business-os/account-deletion/acknowledgement';
import { PLACEHOLDER_ERASURE_CONTACT } from '@/lib/business-os/supportContact';
import { en } from '@/lib/business-os/translations/en';

const CLOSURE_URL = '/api/business-os/account/closure';
const CHECK_URL = '/api/business-os/account/deletion-check';
const KEEP_URL = '/api/business-os/account/keep';
const DELETE_URL = '/api/business-os/account/delete';
const READY = { enabled: true, available: true, blockers: [], willKeepBilling: false, exportFacts: { lastReadyAt: null, downloaded: false } };
const PENDING = {
  status: 'pending',
  planEndsAt: '2026-11-26T10:00:00.000Z',
  lockAt: '2026-12-09T22:00:00.000Z',
  lockAtIsProjected: true,
  timezone: 'Asia/Jerusalem',
  renewalWasOn: false,
  graceDays: 14,
};

type Reply = { status: number; body: unknown } | 'throw' | Promise<{ status: number; body: unknown }>;
let closureReplies: Reply[];
let checkReply: Reply;
let keepReply: Reply;
let deleteReply: Reply;
const fetchMock = jest.fn();

function respond(reply: Reply) {
  if (reply === 'throw') return Promise.reject(new Error('offline'));
  return Promise.resolve(reply).then((r) => ({ ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body }));
}

beforeEach(() => {
  closureReplies = [{ status: 200, body: { success: true, data: { closure: null } } }];
  checkReply = { status: 200, body: { success: true, data: READY } };
  keepReply = { status: 200, body: { success: true, data: { kept: true, from: 'pending', renewal: 'not_restored_by_choice' } } };
  deleteReply = { status: 200, body: { success: true, data: { status: 'pending', planEndsOn: PENDING.planEndsAt, renewalWasOn: false } } };
  fetchMock.mockReset().mockImplementation((url: string) => {
    if (url === CLOSURE_URL) return respond(closureReplies.length > 1 ? closureReplies.shift()! : closureReplies[0]);
    if (url === CHECK_URL) return respond(checkReply);
    if (url === KEEP_URL) return respond(keepReply);
    if (url === DELETE_URL) return respond(deleteReply);
    return Promise.reject(new Error(`unexpected ${url}`));
  });
  (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});
afterAll(() => {
  delete (global as unknown as { fetch?: typeof fetch }).fetch;
});

const calls = (url: string) => fetchMock.mock.calls.filter(([u]) => u === url);
const openClosure = (closure: Record<string, unknown> = PENDING) => ({ status: 200, body: { success: true, data: { closure } } });
const none = () => ({ status: 200, body: { success: true, data: { closure: null } } });

const refresh = mockRefresh;

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

async function openDialog() {
  render(<SettingsDialog />);
  fireEvent.click(screen.getByRole('button', { name: 'Open delete' }));
  return screen.findByRole('dialog');
}

beforeEach(() => refresh.mockReset());

describe('T-5: what the Danger Zone reads, and in what order', () => {
  it('an open closure → the pending view with its dates; the pre-check is never fetched', async () => {
    closureReplies = [openClosure()];
    const dialog = await openDialog();
    const panel = await within(dialog).findByTestId('closure-pending-panel');
    expect(panel).toHaveTextContent('Your plan runs until November 26, 2026. Then you have 14 days to sign in and export your data. Your account closes on December 10, 2026.');
    expect(within(dialog).getByText(en['account_closure.heading'])).toBeInTheDocument();
    expect(dialog).toHaveAccessibleDescription(en['account_closure.heading']);
    expect(within(dialog).queryByText('This will delete all your data and cannot be undone.')).toBeNull();
    expect(calls(CHECK_URL)).toHaveLength(0);
    expect(within(dialog).getByRole('button', { name: 'Keep my account' })).toBeInTheDocument();
  });

  it('no closure → the pre-check, then the request form', async () => {
    const dialog = await openDialog();
    await within(dialog).findByTestId('delete-account-drawer');
    expect(calls(CLOSURE_URL)).toHaveLength(1);
    expect(calls(CHECK_URL)).toHaveLength(1);
    expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[1]);
    expect(calls(CLOSURE_URL)[0][1]).toMatchObject({ method: 'GET', cache: 'no-store' });
  });

  it('a closure read error → the pre-check anyway (D-3)', async () => {
    closureReplies = [{ status: 503, body: { success: false, error: 'try_again' } }];
    const dialog = await openDialog();
    await within(dialog).findByTestId('delete-account-drawer');
    expect(calls(CHECK_URL)).toHaveLength(1);
  });

  it('a closure read that throws → the pre-check anyway', async () => {
    closureReplies = ['throw'];
    const dialog = await openDialog();
    await within(dialog).findByTestId('delete-account-drawer');
  });

  it('with the switch off and a request open, Keep is still reachable (D-2)', async () => {
    closureReplies = [openClosure()];
    checkReply = { status: 200, body: { success: true, data: { enabled: false } } };
    const dialog = await openDialog();
    expect(await within(dialog).findByRole('button', { name: 'Keep my account' })).toBeInTheDocument();
  });

  it('dangerZoneMode precedence', () => {
    const notice = { key: 'k', tone: 'status' as const };
    const open = { status: 'open' as const, closure: PENDING as never };
    expect(dangerZoneMode({ closure: open, check: { status: 'loading' } }, notice)).toBe('notice');
    expect(dangerZoneMode({ closure: open, check: { status: 'ready', data: READY as never } }, null)).toBe('pending');
    expect(dangerZoneMode({ closure: { status: 'loading' }, check: { status: 'ready', data: READY as never } }, null)).toBe('today');
    expect(dangerZoneMode({ closure: { status: 'none' }, check: { status: 'ready', data: READY as never } }, null)).toBe('drawer');
    expect(dangerZoneMode({ closure: { status: 'error' }, check: { status: 'off' } }, null)).toBe('today');
  });
});

describe('each state of the pending view (§5.5)', () => {
  it('W-4 d: no lock date → the _nodate line, no date formatted', async () => {
    closureReplies = [openClosure({ ...PENDING, planEndsAt: null, lockAt: null, lockAtIsProjected: false, timezone: 'UTC' })];
    const dialog = await openDialog();
    const panel = await within(dialog).findByTestId('closure-pending-panel');
    expect(panel).toHaveTextContent(en['account_closure.pending_body_nodate'].replace('{days}', '14'));
    expect(panel.textContent).not.toMatch(/2026/);
  });

  it('grace → the stored lock date in its zone, with Keep', async () => {
    closureReplies = [openClosure({ ...PENDING, status: 'grace', planEndsAt: null, lockAt: '2026-12-01T22:00:00.000Z', lockAtIsProjected: false })];
    const dialog = await openDialog();
    const panel = await within(dialog).findByTestId('closure-pending-panel');
    // 22:00 UTC is 00:00 on December 2 in Jerusalem: the zone sent, not the browser's.
    expect(panel).toHaveTextContent('You can still sign in and export your data. Your account closes on December 2, 2026.');
    expect(within(panel).getByRole('button', { name: 'Keep my account' })).toBeInTheDocument();
  });

  it('requesting → "still setting up" with the support address (W-10), no Keep', async () => {
    closureReplies = [openClosure({ ...PENDING, status: 'requesting', lockAt: null, lockAtIsProjected: false, timezone: 'UTC' })];
    const dialog = await openDialog();
    const panel = await within(dialog).findByTestId('closure-pending-panel');
    expect(panel).toHaveTextContent("We're still setting up your request.");
    expect(panel.querySelector(`a[href="mailto:${PLACEHOLDER_ERASURE_CONTACT}"]`)).toHaveAttribute('dir', 'ltr');
    expect(within(panel).queryByRole('button', { name: 'Keep my account' })).toBeNull();
  });

  it('locked → closed, contact us, no Keep', async () => {
    closureReplies = [openClosure({ ...PENDING, status: 'locked', lockAt: '2026-12-01T22:00:00.000Z', lockAtIsProjected: false })];
    const dialog = await openDialog();
    const panel = await within(dialog).findByTestId('closure-pending-panel');
    expect(panel).toHaveTextContent('Your account is closed. Contact us at');
    expect(within(panel).queryByRole('button', { name: 'Keep my account' })).toBeNull();
  });
});

describe('Keep my account', () => {
  it('200 not_restored_by_choice → the kept line with the plan end; it stays after the re-read; the host refreshes', async () => {
    closureReplies = [openClosure(), none()];
    const dialog = await openDialog();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Keep my account' }));
    const notice = await within(dialog).findByTestId('closure-notice');
    expect(notice).toHaveAttribute('role', 'status');
    expect(notice).toHaveTextContent('Your account is kept. Your plan still ends on November 26, 2026, as you chose before.');
    await waitFor(() => expect(calls(CLOSURE_URL)).toHaveLength(2));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(notice);
    // The message stays; the form does not come back and the pre-check is not run.
    expect(within(dialog).getByTestId('closure-notice')).toBeInTheDocument();
    expect(within(dialog).queryByTestId('delete-account-drawer')).toBeNull();
    expect(calls(CHECK_URL)).toHaveLength(0);
    expect(JSON.parse(calls(KEEP_URL)[0][1].body)).toEqual({});
    expect(calls(KEEP_URL)[0][1]).toMatchObject({ method: 'POST' });
  });

  it('CR-8: 409 state_changed + kept → the kept screen', async () => {
    closureReplies = [openClosure(), none()];
    keepReply = { status: 409, body: { success: false, error: 'state_changed', data: { status: 'kept' } } };
    const dialog = await openDialog();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Keep my account' }));
    expect(await within(dialog).findByTestId('closure-notice')).toHaveTextContent('Your account is kept.');
  });

  it('409 state_changed + locked → re-read and show the new state, no message', async () => {
    closureReplies = [openClosure(), openClosure({ ...PENDING, status: 'locked' })];
    keepReply = { status: 409, body: { success: false, error: 'state_changed', data: { status: 'locked' } } };
    const dialog = await openDialog();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Keep my account' }));
    await waitFor(() => expect(within(dialog).getByTestId('closure-pending-panel')).toHaveAttribute('data-status', 'locked'));
    // SA CR-2: the Keep button is gone with the new state, so focus lands on the line that explains it.
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByTestId('closure-pending-body')));
    expect(within(dialog).queryByTestId('closure-keep-refusal')).toBeNull();
  });

  it('503 → keep_failed in an alert the button points at; nothing re-read; the button works again', async () => {
    closureReplies = [openClosure()];
    keepReply = { status: 503, body: { success: false, error: 'try_again' } };
    const dialog = await openDialog();
    const button = await within(dialog).findByRole('button', { name: 'Keep my account' });
    fireEvent.click(button);
    const alert = await within(dialog).findByTestId('closure-keep-refusal');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent("We couldn't keep your account.");
    expect(within(dialog).getByRole('button', { name: 'Keep my account' })).toHaveAttribute('aria-describedby', alert.id);
    // SA CR-2: focus moves to the refusal line.
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect(calls(CLOSURE_URL)).toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('button', { name: 'Keep my account' })).toBeEnabled();
  });

  it('one press, one request: a second press while in flight is ignored (aria-busy)', async () => {
    closureReplies = [openClosure(), none()];
    let release: (value: { status: number; body: unknown }) => void = () => undefined;
    keepReply = new Promise((resolve) => (release = resolve));
    const dialog = await openDialog();
    const button = await within(dialog).findByRole('button', { name: 'Keep my account' });
    fireEvent.click(button);
    const busy = await within(dialog).findByRole('button', { name: 'Keeping your account…' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    // SA CR-2: aria-disabled, not disabled, so a focused button keeps focus while Keep is in flight.
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    expect(busy).not.toBeDisabled();
    busy.focus();
    expect(document.activeElement).toBe(busy);
    fireEvent.click(busy);
    expect(calls(KEEP_URL)).toHaveLength(1);
    await act(async () => {
      release({ status: 200, body: { success: true, data: { kept: true, from: 'pending', renewal: 'restored' } } });
    });
    expect(await within(dialog).findByTestId('closure-notice')).toHaveTextContent('Your account is kept, and your plan will renew as before.');
  });

  it('409 nothing_to_keep → the line stays after the re-read', async () => {
    closureReplies = [openClosure(), none()];
    keepReply = { status: 409, body: { success: false, error: 'nothing_to_keep' } };
    const dialog = await openDialog();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Keep my account' }));
    expect(await within(dialog).findByTestId('closure-notice')).toHaveTextContent('There is no deletion request on this account.');
    await waitFor(() => expect(calls(CLOSURE_URL)).toHaveLength(2));
    expect(within(dialog).getByTestId('closure-notice')).toBeInTheDocument();
  });
});

describe('a recorded request swaps the form for the pending view (D-8)', () => {
  it('200 → re-read → the pending view, focus on its first line, the host refreshed, no navigation', async () => {
    closureReplies = [none(), openClosure()];
    const dialog = await openDialog();
    await within(dialog).findByTestId('delete-account-drawer');
    fireEvent.click(within(dialog).getByTestId('delete-account-reason-too_expensive'));
    fireEvent.change(within(dialog).getByLabelText('Type the statement to confirm'), { target: { value: DELETION_STATEMENTS.en } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete my account forever' }));
    });
    const panel = await within(dialog).findByTestId('closure-pending-panel');
    await waitFor(() => expect(document.activeElement).toBe(within(panel).getByTestId('closure-pending-body')));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(JSON.parse(calls(DELETE_URL)[0][1].body)).toEqual({ statement: DELETION_STATEMENTS.en, language: 'en', reasonCode: 'too_expensive' });
    expect(calls(CHECK_URL)).toHaveLength(1);
  });

  it('409 already_requested → re-read → the pending view', async () => {
    closureReplies = [none(), openClosure()];
    deleteReply = { status: 409, body: { success: false, error: 'already_requested', data: { status: null } } };
    const dialog = await openDialog();
    await within(dialog).findByTestId('delete-account-drawer');
    fireEvent.click(within(dialog).getByTestId('delete-account-reason-other'));
    fireEvent.change(within(dialog).getByLabelText('Type the statement to confirm'), { target: { value: DELETION_STATEMENTS.en } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete my account forever' }));
    });
    expect(await within(dialog).findByTestId('closure-pending-panel')).toBeInTheDocument();
  });

  it('409 already_requested but the re-read finds nothing → the already_requested line in the form', async () => {
    closureReplies = [none()];
    deleteReply = { status: 409, body: { success: false, error: 'already_requested', data: { status: 'pending' } } };
    const dialog = await openDialog();
    await within(dialog).findByTestId('delete-account-drawer');
    fireEvent.click(within(dialog).getByTestId('delete-account-reason-other'));
    fireEvent.change(within(dialog).getByLabelText('Type the statement to confirm'), { target: { value: DELETION_STATEMENTS.en } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete my account forever' }));
    });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('You have already asked us to delete your account.');
  });

  it('502 outcomeUnknown → "couldn\'t confirm", then a re-read that finds the row → the pending view', async () => {
    closureReplies = [none(), openClosure({ ...PENDING, status: 'requesting', lockAt: null, lockAtIsProjected: false, timezone: 'UTC' })];
    deleteReply = { status: 502, body: { success: false, error: 'stripe_error', outcomeUnknown: true } };
    const dialog = await openDialog();
    await within(dialog).findByTestId('delete-account-drawer');
    fireEvent.click(within(dialog).getByTestId('delete-account-reason-other'));
    fireEvent.change(within(dialog).getByLabelText('Type the statement to confirm'), { target: { value: DELETION_STATEMENTS.en } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete my account forever' }));
    });
    expect(await within(dialog).findByTestId('closure-pending-panel')).toHaveAttribute('data-status', 'requesting');
  });
});

describe('the boxed panel (no language provider)', () => {
  it('an open closure → the region heading follows, the host warning is hidden, Keep works and refreshes the host', async () => {
    closureReplies = [openClosure(), none()];
    const { container } = render(<DangerZonePanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const region = await screen.findByRole('region', { name: en['account_closure.heading'] });
    await within(region).findByTestId('closure-pending-panel');
    expect(within(container).queryByText('This will delete all your data and cannot be undone.')).toBeNull();
    fireEvent.click(within(region).getByRole('button', { name: 'Keep my account' }));
    expect(await screen.findByTestId('closure-notice')).toHaveTextContent('Your account is kept.');
    expect(calls(CHECK_URL)).toHaveLength(0);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
