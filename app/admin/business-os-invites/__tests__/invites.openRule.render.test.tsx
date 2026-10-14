/**
 * @jest-environment jsdom
 *
 * Admin Layout Follow-ups LF-3a: the open rule on Signup Invites (OR-2, OR-3).
 *
 * D-1 to D-13: "New invite" is a drawer form (SA-C9). The draft survives
 * Escape, an overlay click and the corner close, and is cleared by Cancel or a
 * success; the drawer refuses to close while the create request is in flight;
 * one send per Create; focus goes to the created-link panel's heading after a
 * success and back to "New invite" otherwise, never the page body.
 *
 * R-1 to R-11: Revoke is a dialog (SA-C10, F-41, F-110). Each row's button
 * names its invite; focus starts in the reason field; one send per confirm; no
 * close while in flight; a refusal keeps the dialog, its sentence and the
 * reason; focus goes back to the opener, or to the content area when the
 * opener has left (it always leaves on a success).
 *
 * The request bytes are pinned separately (`invites.requestPins.render`).
 * Invented ids, labels and plans only.
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ADMIN_DIALOG_CLASS } from '@/app/admin/components/layout/adminDialog';

import BusinessOsInvitesPage from '../page';
import type { InviteRow, InvitesPayload } from '../types';

jest.setTimeout(30_000);

const LINK = 'http://localhost:3000/invite#t=OPENRULEOPENRULEOPENRULEOPENRULEOPENRULEOPE';

function row(overrides: Partial<InviteRow> = {}): InviteRow {
  return {
    id: 'invite-1',
    email: 'first@example.com',
    inviteType: 'fixture-free',
    grantLabel: 'Fixture Free Plan',
    accessSummary: 'No end date',
    inviterDisplayName: 'Dana',
    language: 'en',
    createdAt: '2026-10-01T12:00:00.000Z',
    linkExpiryDays: 30,
    linkExpiresAt: '2026-10-31T12:00:00.000Z',
    state: 'pending',
    firstViewedAt: null,
    revokedAt: null,
    revokeReason: null,
    redeemedAt: null,
    openedByExistingAccountAt: null,
    redeemedAccountId: null,
    level: null,
    redemptionStoppedHalfway: false,
    redemptionFailure: null,
    ...overrides,
  };
}

function payload(invites: InviteRow[] = [row()], grantedAvailable = true): InvitesPayload {
  return {
    invites,
    formOptions: {
      expiryDays: [15, 30, 60],
      defaultExpiryDays: 30,
      languages: ['en', 'es', 'he'],
      defaultLanguage: 'en',
      championAccessMonthsMax: 60,
      inviteTypes: [
        {
          type: 'fixture-free',
          label: 'Fixture Free (Fixture Free Plan)',
          available: true,
          unavailableReason: null,
          requiresAccess: true,
          grants: [],
        },
        {
          type: 'fixture-granted',
          label: 'Fixture Granted',
          available: grantedAvailable,
          unavailableReason: grantedAvailable ? null : 'withdrawn for the test',
          requiresAccess: false,
          grants: [{ id: 'tier-b', label: 'Tier B', default: true }],
        },
      ],
    },
    enforcementMode: 'off',
  };
}

type FetchCall = { url: string; init?: RequestInit };
type Reply = { status: number; body: unknown } | 'hold';
let calls: FetchCall[] = [];
let responder: (call: FetchCall) => Reply;
let held: Array<(response: Response) => void> = [];

function asResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response;
}

beforeEach(() => {
  calls = [];
  held = [];
  responder = () => ({ status: 200, body: { success: true, data: payload() } });
  global.fetch = jest.fn((url: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    const reply = responder(call);
    if (reply === 'hold') return new Promise<Response>((resolve) => held.push(resolve));
    return Promise.resolve(asResponse(reply.status, reply.body));
  }) as unknown as typeof fetch;
});

async function release(status: number, body: unknown) {
  const resolve = held.shift();
  if (!resolve) throw new Error('no request is held');
  await act(async () => {
    resolve(asResponse(status, body));
  });
}

const posts = () => calls.filter((call) => call.init?.method === 'POST');
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

async function mount(invites: InviteRow[] = [row()]) {
  responder = () => ({ status: 200, body: { success: true, data: payload(invites) } });
  const user = userEvent.setup();
  render(<BusinessOsInvitesPage />);
  await screen.findByTestId('invite-list');
  return user;
}

// ── New invite: the drawer form ─────────────────────────────────────────────

const newInviteButton = () => screen.getByRole('button', { name: /new invite/i });

async function openDrawer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(newInviteButton());
  await screen.findByTestId('create-invite-form');
  return screen.getByTestId('create-invite-drawer');
}

async function drawerGone() {
  await waitFor(() => expect(screen.queryByTestId('create-invite-drawer')).not.toBeInTheDocument());
}

const formEl = () => screen.getByTestId('create-invite-form');
const field = <T extends HTMLElement>(label: string | RegExp) => within(formEl()).getByLabelText(label) as T;

/** Every draft value moved off its default. */
async function fillWholeDraft(user: ReturnType<typeof userEvent.setup>) {
  fireEvent.change(field('Email'), { target: { value: 'kept@example.com' } });
  await user.click(within(formEl()).getByRole('radio', { name: 'A number of months from signup' }));
  fireEvent.change(field('Months of access'), { target: { value: '18' } });
  fireEvent.change(field('Link expiry'), { target: { value: '60' } });
  fireEvent.change(field('Invitee language'), { target: { value: 'he' } });
  fireEvent.change(field(/personal note/i), { target: { value: 'Kept note' } });
  fireEvent.change(field(/internal reason/i), { target: { value: 'Kept reason' } });
  await user.click(within(formEl()).getByTestId('invite-send-email'));
}

function expectWholeDraft() {
  expect(field<HTMLInputElement>('Email').value).toBe('kept@example.com');
  expect(within(formEl()).getByRole('radio', { name: 'A number of months from signup' })).toBeChecked();
  expect(field<HTMLInputElement>('Months of access').value).toBe('18');
  expect(field<HTMLSelectElement>('Link expiry').value).toBe('60');
  expect(field<HTMLSelectElement>('Invitee language').value).toBe('he');
  expect(field<HTMLTextAreaElement>(/personal note/i).value).toBe('Kept note');
  expect(field<HTMLInputElement>(/internal reason/i).value).toBe('Kept reason');
  expect(within(formEl()).getByTestId('invite-send-email')).not.toBeChecked();
}

function expectDefaults() {
  expect(field<HTMLInputElement>('Email').value).toBe('');
  expect(within(formEl()).getByRole('radio', { name: /fixture free/i })).toBeChecked();
  expect(within(formEl()).getByRole('radio', { name: 'No end date' })).not.toBeChecked();
  expect(field<HTMLSelectElement>('Link expiry').value).toBe('30');
  expect(field<HTMLSelectElement>('Invitee language').value).toBe('en');
  expect(field<HTMLTextAreaElement>(/personal note/i).value).toBe('');
  expect(field<HTMLInputElement>(/internal reason/i).value).toBe('');
  expect(within(formEl()).getByTestId('invite-send-email')).toBeChecked();
}

async function fillValid(user: ReturnType<typeof userEvent.setup>, email = 'x@example.com') {
  fireEvent.change(field('Email'), { target: { value: email } });
  await user.click(within(formEl()).getByRole('radio', { name: 'No end date' }));
  fireEvent.change(field(/internal reason/i), { target: { value: 'QA open rule' } });
}

function createReply(id: string, email: string): Reply {
  return { status: 201, body: { success: true, data: { invite: row({ id, email }), link: LINK } } };
}

describe('LF-3a: New invite is a drawer form (OR-2, SA-C9)', () => {
  it('D-1: opens a dialog named "New invite" holding the form, outside the content, with one heading', async () => {
    const user = await mount();
    const drawer = await openDrawer(user);
    expect(screen.getByRole('dialog', { name: 'New invite' })).toBe(drawer);
    expect(drawer).toContainElement(formEl());
    expect(screen.getByTestId('invites-content')).not.toContainElement(formEl());
    expect(within(drawer).getAllByRole('heading', { name: 'New invite' })).toHaveLength(1);
  });

  it('D-2: Escape closes it with nothing sent, and reopening shows every value as it was left', async () => {
    const user = await mount();
    const drawer = await openDrawer(user);
    await fillWholeDraft(user);
    fireEvent.keyDown(drawer, { key: 'Escape' });
    await drawerGone();
    expect(posts()).toHaveLength(0);
    await openDrawer(user);
    expectWholeDraft();
  });

  it('D-3: an overlay click and the corner close keep the draft too', async () => {
    const user = await mount();
    await openDrawer(user);
    await fillWholeDraft(user);
    await settle();
    fireEvent.pointerDown(document.body);
    await drawerGone();
    const drawer = await openDrawer(user);
    expectWholeDraft();
    await user.click(within(drawer).getByRole('button', { name: 'Close' }));
    await drawerGone();
    await openDrawer(user);
    expectWholeDraft();
    expect(posts()).toHaveLength(0);
  });

  it('D-4: Cancel closes it and clears the draft', async () => {
    const user = await mount();
    await openDrawer(user);
    await fillWholeDraft(user);
    await user.click(within(formEl()).getByRole('button', { name: 'Cancel' }));
    await drawerGone();
    await openDrawer(user);
    expectDefaults();
    expect(posts()).toHaveLength(0);
  });

  it('D-5: while the request is in flight, Escape, an overlay click and X do nothing and Cancel is disabled', async () => {
    const user = await mount();
    const drawer = await openDrawer(user);
    await fillValid(user);
    responder = (call) => (call.init?.method === 'POST' ? 'hold' : { status: 200, body: { success: true, data: payload() } });
    await user.click(within(formEl()).getByRole('button', { name: 'Create' }));
    expect(posts()).toHaveLength(1);

    fireEvent.keyDown(drawer, { key: 'Escape' });
    await settle();
    fireEvent.pointerDown(document.body);
    await settle();
    await user.click(within(drawer).getByRole('button', { name: 'Close' }));
    await settle();
    expect(screen.getByTestId('create-invite-drawer')).toBe(drawer);
    expect(within(formEl()).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(posts()).toHaveLength(1);

    await release(201, { success: true, data: { invite: row({ id: 'invite-new', email: 'x@example.com' }), link: LINK } });
    await drawerGone();
    expect(screen.getByTestId('created-link-panel')).toBeInTheDocument();
  });

  it('D-6: two submits in the same tick send one create', async () => {
    const user = await mount();
    await openDrawer(user);
    await fillValid(user);
    responder = (call) => (call.init?.method === 'POST' ? createReply('invite-new', 'x@example.com') : { status: 200, body: { success: true, data: payload() } });
    act(() => {
      fireEvent.submit(formEl());
      fireEvent.submit(formEl());
    });
    await screen.findByTestId('created-link-panel');
    expect(posts()).toHaveLength(1);
  });

  it('D-7: a success closes the drawer, shows the link on the page, focuses its heading and clears the draft, with no list read', async () => {
    const user = await mount();
    const before = calls.length;
    await openDrawer(user);
    await fillValid(user);
    responder = (call) => (call.init?.method === 'POST' ? createReply('invite-new', 'x@example.com') : { status: 200, body: { success: true, data: payload() } });
    await user.click(within(formEl()).getByRole('button', { name: 'Create' }));
    await drawerGone();

    const panel = screen.getByTestId('created-link-panel');
    expect(screen.getByTestId('invites-content')).toContainElement(panel);
    expect(within(panel).getByTestId('created-link')).toHaveTextContent(LINK);
    const heading = within(panel).getByRole('heading', { name: 'Invite created for x@example.com' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.getByTestId('invite-row-invite-new')).toBeInTheDocument();
    expect(calls).toHaveLength(before + 1);

    await openDrawer(user);
    expectDefaults();
  });

  it('D-8: a refusal keeps the drawer open with the sentence and the draft; Cancel then returns focus to "New invite"', async () => {
    const user = await mount();
    const drawer = await openDrawer(user);
    await fillValid(user);
    responder = (call) =>
      call.init?.method === 'POST'
        ? { status: 409, body: { success: false, error: 'grant_not_available' } }
        : { status: 200, body: { success: true, data: payload() } };
    await user.click(within(formEl()).getByRole('button', { name: 'Create' }));
    expect(await within(drawer).findByRole('alert')).toHaveTextContent('That plan is no longer offered.');
    expect(screen.getByTestId('create-invite-drawer')).toBe(drawer);
    expect(field<HTMLInputElement>('Email').value).toBe('x@example.com');
    expect(within(formEl()).getByRole('button', { name: 'Create' })).toBeEnabled();

    await user.click(within(formEl()).getByRole('button', { name: 'Cancel' }));
    await drawerGone();
    await waitFor(() => expect(document.activeElement).toBe(newInviteButton()));
  });

  it('D-9: Escape returns focus to "New invite", never the page body', async () => {
    const user = await mount();
    const drawer = await openDrawer(user);
    fireEvent.keyDown(drawer, { key: 'Escape' });
    await drawerGone();
    await waitFor(() => expect(document.activeElement).toBe(newInviteButton()));
    expect(document.activeElement).not.toBe(document.body);
  });

  it('D-10: a second create replaces the panel and focuses the new heading', async () => {
    const user = await mount();
    responder = (call) => (call.init?.method === 'POST' ? createReply('invite-a', 'a@example.com') : { status: 200, body: { success: true, data: payload() } });
    await openDrawer(user);
    await fillValid(user, 'a@example.com');
    await user.click(within(formEl()).getByRole('button', { name: 'Create' }));
    await drawerGone();

    responder = (call) => (call.init?.method === 'POST' ? createReply('invite-b', 'b@example.com') : { status: 200, body: { success: true, data: payload() } });
    await openDrawer(user);
    await fillValid(user, 'b@example.com');
    await user.click(within(formEl()).getByRole('button', { name: 'Create' }));
    await drawerGone();

    expect(screen.getAllByTestId('created-link-panel')).toHaveLength(1);
    const heading = screen.getByRole('heading', { name: 'Invite created for b@example.com' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('D-11: open, Escape, reopen, Cancel and a create write nothing to the URL, history or storage', async () => {
    const push = jest.spyOn(window.history, 'pushState');
    const replace = jest.spyOn(window.history, 'replaceState');
    sessionStorage.clear();
    localStorage.clear();
    const before = window.location.href;
    try {
      const user = await mount();
      let drawer = await openDrawer(user);
      await fillWholeDraft(user);
      fireEvent.keyDown(drawer, { key: 'Escape' });
      await drawerGone();
      await openDrawer(user);
      await user.click(within(formEl()).getByRole('button', { name: 'Cancel' }));
      await drawerGone();
      drawer = await openDrawer(user);
      await fillValid(user);
      responder = (call) => (call.init?.method === 'POST' ? createReply('invite-new', 'x@example.com') : { status: 200, body: { success: true, data: payload() } });
      await user.click(within(drawer).getByRole('button', { name: 'Create' }));
      await drawerGone();

      expect(push).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
      expect(window.location.href).toBe(before);
      expect(sessionStorage.length).toBe(0);
      expect(localStorage.length).toBe(0);
    } finally {
      push.mockRestore();
      replace.mockRestore();
    }
  });

  it('D-12: after a success, a later Escape returns focus to "New invite", not the panel (the flag is used once)', async () => {
    const user = await mount();
    await openDrawer(user);
    await fillValid(user);
    responder = (call) => (call.init?.method === 'POST' ? createReply('invite-new', 'x@example.com') : { status: 200, body: { success: true, data: payload() } });
    await user.click(within(formEl()).getByRole('button', { name: 'Create' }));
    await drawerGone();
    await waitFor(() => expect(document.activeElement).toHaveTextContent('Invite created for x@example.com'));

    const drawer = await openDrawer(user);
    fireEvent.keyDown(drawer, { key: 'Escape' });
    await drawerGone();
    await waitFor(() => expect(document.activeElement).toBe(newInviteButton()));
  });

  it('D-13: a kept draft whose type is no longer offered after a Refresh reopens as a fresh draft', async () => {
    const user = await mount();
    const drawer = await openDrawer(user);
    await user.click(within(formEl()).getByRole('radio', { name: 'Fixture Granted' }));
    fireEvent.change(field('Email'), { target: { value: 'kept@example.com' } });
    fireEvent.keyDown(drawer, { key: 'Escape' });
    await drawerGone();

    responder = () => ({ status: 200, body: { success: true, data: payload([row()], false) } });
    await user.click(screen.getByRole('button', { name: 'Refresh invites' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh invites' })).toBeEnabled());

    await openDrawer(user);
    expectDefaults();
  });
});

// ── Revoke: the dialog ──────────────────────────────────────────────────────

const OPENER_1 = 'Revoke invite for first@example.com (created 2026-10-01 12:00:00 UTC)';

async function openRevoke(user: ReturnType<typeof userEvent.setup>, name = OPENER_1) {
  const opener = within(screen.getByTestId('invite-list')).getByRole('button', { name });
  await user.click(opener);
  const dialog = await screen.findByTestId('revoke-dialog');
  return { opener, dialog };
}

async function dialogGone() {
  await waitFor(() => expect(screen.queryByTestId('revoke-dialog')).not.toBeInTheDocument());
}

const reasonOf = (dialog: HTMLElement) => within(dialog).getByRole('textbox') as HTMLInputElement;
const confirmOf = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: 'Revoke invite' });

function revokeReply(invite: InviteRow, reason = 'QA open rule'): Reply {
  return {
    status: 200,
    body: { success: true, data: { invite: { ...invite, state: 'revoked', revokedAt: '2026-10-02T00:00:00.000Z', revokeReason: reason } } },
  };
}

describe('LF-3a: Revoke is a dialog (OR-3, SA-C10, F-41, F-110)', () => {
  it('R-1: two invites to one email, created seconds apart on one day, get two different names; the visible word is "Revoke"', async () => {
    await mount([
      row({ id: 'one', createdAt: '2026-10-01T12:00:00.000Z' }),
      row({ id: 'two', createdAt: '2026-10-01T12:00:07.000Z' }),
    ]);
    const buttons = within(screen.getByTestId('invite-list')).getAllByRole('button', { name: /^Revoke/ });
    expect(buttons).toHaveLength(2);
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Revoke invite for first@example.com (created 2026-10-01 12:00:00 UTC)',
      'Revoke invite for first@example.com (created 2026-10-01 12:00:07 UTC)',
    ]);
    for (const button of buttons) expect(button.textContent).toBe('Revoke');
  });

  it('R-2: it opens as a named dialog with focus in the reason field and today’s label', async () => {
    const user = await mount();
    const { dialog } = await openRevoke(user);
    expect(screen.getByRole('dialog', { name: 'Revoke the invite for first@example.com?' })).toBe(dialog);
    const reason = within(dialog).getByLabelText('Why are you revoking the invite for first@example.com? (at least 3 characters)');
    await waitFor(() => expect(document.activeElement).toBe(reason));
    expect(within(dialog).getByRole('button', { name: 'Keep it' })).toBeInTheDocument();
    expect(confirmOf(dialog)).toBeDisabled();
  });

  it('R-3: Enter in the empty reason field sends nothing', async () => {
    const user = await mount();
    const { dialog } = await openRevoke(user);
    await waitFor(() => expect(document.activeElement).toBe(reasonOf(dialog)));
    await user.keyboard('{Enter}');
    await settle();
    expect(posts()).toHaveLength(0);
    expect(screen.getByTestId('revoke-dialog')).toBe(dialog);
  });

  it.each(['Keep it', 'Escape', 'Close'])('R-4: %s closes it with nothing sent and focus back on that row’s button', async (how) => {
    const user = await mount();
    const { opener, dialog } = await openRevoke(user);
    fireEvent.change(reasonOf(dialog), { target: { value: 'not sent' } });
    if (how === 'Escape') fireEvent.keyDown(dialog, { key: 'Escape' });
    else await user.click(within(dialog).getByRole('button', { name: how }));
    await dialogGone();
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(posts()).toHaveLength(0);
  });

  it('R-5: while the request is in flight, Escape, an outside click and X do nothing and Keep it is disabled', async () => {
    const user = await mount();
    const { dialog } = await openRevoke(user);
    responder = (call) => (call.init?.method === 'POST' ? 'hold' : { status: 200, body: { success: true, data: payload() } });
    fireEvent.change(reasonOf(dialog), { target: { value: 'QA open rule' } });
    await user.click(confirmOf(dialog));
    expect(posts()).toHaveLength(1);
    expect(dialog).toHaveAttribute('aria-busy', 'true');

    fireEvent.keyDown(dialog, { key: 'Escape' });
    await settle();
    fireEvent.pointerDown(document.body);
    await settle();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await settle();
    expect(screen.getByTestId('revoke-dialog')).toBe(dialog);
    expect(within(dialog).getByRole('button', { name: 'Keep it' })).toBeDisabled();
    expect(posts()).toHaveLength(1);

    await release(200, { success: true, data: { invite: row({ state: 'revoked', revokeReason: 'QA open rule' }) } });
    await dialogGone();
  });

  it('R-6: two submits in the same tick, or a double click, send one revoke each time', async () => {
    const second = row({ id: 'invite-2', email: 'second@example.com' });
    const user = await mount([row(), second]);
    responder = (call) => (call.init?.method === 'POST' ? revokeReply(row()) : { status: 200, body: { success: true, data: payload() } });
    let { dialog } = await openRevoke(user);
    fireEvent.change(reasonOf(dialog), { target: { value: 'QA open rule' } });
    const form = dialog.querySelector('form') as HTMLFormElement;
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await dialogGone();
    expect(posts()).toHaveLength(1);

    responder = (call) => (call.init?.method === 'POST' ? revokeReply(second) : { status: 200, body: { success: true, data: payload() } });
    ({ dialog } = await openRevoke(user, 'Revoke invite for second@example.com (created 2026-10-01 12:00:00 UTC)'));
    fireEvent.change(reasonOf(dialog), { target: { value: 'QA open rule' } });
    await user.dblClick(confirmOf(dialog));
    await dialogGone();
    expect(posts()).toHaveLength(2);
  });

  it('R-7: a success closes it, marks the row Revoked and puts focus on the content area, never body', async () => {
    const user = await mount();
    const { dialog } = await openRevoke(user);
    responder = (call) => (call.init?.method === 'POST' ? revokeReply(row()) : { status: 200, body: { success: true, data: payload() } });
    fireEvent.change(reasonOf(dialog), { target: { value: 'QA open rule' } });
    await user.click(confirmOf(dialog));
    await dialogGone();
    expect(within(screen.getByTestId('invite-row-invite-1')).getByTestId('invite-state')).toHaveTextContent('Revoked');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('invites-content')));
  });

  it('R-8: with the State filter on Pending the revoked row leaves the list; focus still lands on the content area', async () => {
    const user = await mount();
    fireEvent.change(screen.getByTestId('invite-state-filter'), { target: { value: 'pending' } });
    const { dialog } = await openRevoke(user);
    responder = (call) => (call.init?.method === 'POST' ? revokeReply(row()) : { status: 200, body: { success: true, data: payload() } });
    fireEvent.change(reasonOf(dialog), { target: { value: 'QA open rule' } });
    await user.click(confirmOf(dialog));
    await dialogGone();
    expect(screen.getByTestId('invite-list-empty')).toHaveTextContent('No invites match these filters.');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('invites-content')));
  });

  it('R-9: a refusal keeps the dialog with its sentence and the reason; Keep it then returns focus to the opener', async () => {
    const user = await mount();
    const { opener, dialog } = await openRevoke(user);
    responder = (call) =>
      call.init?.method === 'POST'
        ? { status: 409, body: { success: false, error: 'invite_not_revocable' } }
        : { status: 200, body: { success: true, data: payload() } };
    fireEvent.change(reasonOf(dialog), { target: { value: 'QA open rule' } });
    await user.click(confirmOf(dialog));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This invite cannot be revoked: it was accepted or already revoked.');
    expect(screen.getByTestId('revoke-dialog')).toBe(dialog);
    expect(reasonOf(dialog).value).toBe('QA open rule');
    expect(confirmOf(dialog)).toBeEnabled();

    await user.click(within(dialog).getByRole('button', { name: 'Keep it' }));
    await dialogGone();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('R-10: a reason never carries over: not to another row, and not to the same row reopened', async () => {
    const user = await mount([row(), row({ id: 'invite-2', email: 'second@example.com' })]);
    let { dialog } = await openRevoke(user);
    fireEvent.change(reasonOf(dialog), { target: { value: 'typed for the first' } });
    await user.click(within(dialog).getByRole('button', { name: 'Keep it' }));
    await dialogGone();

    ({ dialog } = await openRevoke(user, 'Revoke invite for second@example.com (created 2026-10-01 12:00:00 UTC)'));
    expect(reasonOf(dialog).value).toBe('');
    fireEvent.change(reasonOf(dialog), { target: { value: 'typed for the second' } });
    await user.click(within(dialog).getByRole('button', { name: 'Keep it' }));
    await dialogGone();

    ({ dialog } = await openRevoke(user, 'Revoke invite for second@example.com (created 2026-10-01 12:00:00 UTC)'));
    expect(reasonOf(dialog).value).toBe('');
    expect(posts()).toHaveLength(0);
  });

  it('R-11: it wears the admin dialog classes and has no description', async () => {
    const user = await mount();
    const { dialog } = await openRevoke(user);
    for (const name of ADMIN_DIALOG_CLASS.split(' ').filter(Boolean)) expect(dialog.classList.contains(name)).toBe(true);
    expect(dialog).not.toHaveAttribute('aria-describedby');
  });
});
