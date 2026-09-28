/**
 * @jest-environment jsdom
 *
 * What an admin does on the Invites screen: read the list, create an invite
 * (Paid shown disabled, champion needs an access choice), copy the link that is
 * shown once, and revoke with a reason.
 *
 * Invented ids and labels: a fixture using real plan ids would fail FR-12, and
 * the screen must render whatever the payload says.
 */

import '@testing-library/jest-dom';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import BusinessOsInvitesPage from '../page';
import type { InviteRow, InvitesPayload } from '../types';

const LINK = 'http://localhost:3000/invite#t=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

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
    ...overrides,
  };
}

function payload(overrides: Partial<InvitesPayload> = {}): InvitesPayload {
  return {
    invites: [row()],
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
          type: 'fixture-paid',
          label: 'Fixture Paid',
          available: false,
          unavailableReason: 'available when payments are live',
          requiresAccess: false,
          grants: [{ id: 'tier-a', label: 'Tier A', default: true }],
        },
      ],
    },
    enforcementMode: 'off',
    ...overrides,
  };
}

type FetchCall = { url: string; init?: RequestInit };
let calls: FetchCall[] = [];
let responder: (call: FetchCall) => { status: number; body: unknown };

function jsonResponse(status: number, body: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response);
}

beforeEach(() => {
  calls = [];
  responder = () => ({ status: 200, body: { success: true, data: payload() } });
  global.fetch = jest.fn((url: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    const { status, body } = responder(call);
    return jsonResponse(status, body);
  }) as unknown as typeof fetch;
});

// Tests that swap in a fake clipboard must not leak it into the next test.
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
afterEach(() => {
  if (originalClipboard) {
    Object.defineProperty(navigator, 'clipboard', originalClipboard);
  } else {
    delete (navigator as { clipboard?: Clipboard }).clipboard;
  }
});

describe('the list', () => {
  it('is headed "Business OS Signup Invites" (Slice 1a label)', async () => {
    render(<BusinessOsInvitesPage />);
    await screen.findByTestId('invite-list');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Business OS Signup Invites');
  });

  it('Slice 1a: shows when an invite was opened by an email that already has an account', async () => {
    responder = () => ({
      status: 200,
      body: { success: true, data: payload({ invites: [row({ openedByExistingAccountAt: '2026-10-02T09:00:00.000Z' })] }) },
    });
    render(<BusinessOsInvitesPage />);
    const list = await screen.findByTestId('invite-list');
    expect(within(list).getByTestId('invite-existing-account')).toHaveTextContent('Opened by an existing account');
    expect(within(list).getByTestId('invite-state')).toHaveTextContent('Pending');
  });

  it('Slice 1a: shows nothing extra for an invite never opened by an existing account', async () => {
    render(<BusinessOsInvitesPage />);
    const list = await screen.findByTestId('invite-list');
    expect(within(list).queryByTestId('invite-existing-account')).not.toBeInTheDocument();
  });

  it('loads the invites with their state, and the enforcement note', async () => {
    render(<BusinessOsInvitesPage />);
    const list = await screen.findByTestId('invite-list');
    expect(within(list).getByText('first@example.com')).toBeInTheDocument();
    expect(within(list).getByTestId('invite-state')).toHaveTextContent('Pending');
    expect(screen.getByTestId('enforcement-note')).toHaveTextContent('Nothing is enforced yet');
    expect(screen.getByTestId('enforcement-note')).toHaveTextContent('internal demos only');
    // No filter or search controls in Slice 0 (R-2).
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('says so when there are no invites, and shows an error when the read fails', async () => {
    responder = () => ({ status: 200, body: { success: true, data: payload({ invites: [] }) } });
    const { unmount } = render(<BusinessOsInvitesPage />);
    expect(await screen.findByTestId('invite-list-empty')).toBeInTheDocument();
    unmount();

    responder = () => ({ status: 500, body: { success: false, error: 'could_not_read_invites' } });
    render(<BusinessOsInvitesPage />);
    expect(await screen.findByTestId('page-error')).toBeInTheDocument();
  });
});

describe('creating an invite', () => {
  async function openForm() {
    const user = userEvent.setup();
    render(<BusinessOsInvitesPage />);
    await screen.findByTestId('invite-list');
    await user.click(screen.getByRole('button', { name: /new invite/i }));
    return { user, form: screen.getByTestId('create-invite-form') };
  }

  it('offers exactly the configured expiry options with the default selected, and the default language', async () => {
    const { form } = await openForm();
    const expiry = within(form).getByLabelText('Link expiry') as HTMLSelectElement;
    expect([...expiry.options].map((option) => option.value)).toEqual(['15', '30', '60']);
    expect(expiry.value).toBe('30');
    expect((within(form).getByLabelText('Invitee language') as HTMLSelectElement).value).toBe('en');
  });

  it('shows Paid disabled with the server\'s reason', async () => {
    const { form } = await openForm();
    const paid = within(form).getByRole('radio', { name: /fixture paid/i });
    expect(paid).toBeDisabled();
    expect(form).toHaveTextContent('available when payments are live');
    expect(within(form).getByRole('radio', { name: /fixture free/i })).toBeChecked();
  });

  it('needs an access choice before it can be submitted', async () => {
    const { user, form } = await openForm();
    await user.type(within(form).getByLabelText('Email'), 'x@example.com');
    await user.type(within(form).getByLabelText(/internal reason/i), 'QA slice 0 demo');
    const create = within(form).getByRole('button', { name: 'Create' });
    expect(create).toBeDisabled();
    await user.click(within(form).getByRole('radio', { name: 'No end date' }));
    expect(create).toBeEnabled();
  });

  it('after a create, shows the link once with a working copy button, and adds the row', async () => {
    const { user, form } = await openForm();
    const createdRow = row({ id: 'invite-2', email: 'x@example.com' });
    responder = (call) =>
      call.init?.method === 'POST'
        ? { status: 201, body: { success: true, data: { invite: createdRow, link: LINK } } }
        : { status: 200, body: { success: true, data: payload() } };

    await user.type(within(form).getByLabelText('Email'), 'x@example.com');
    await user.click(within(form).getByRole('radio', { name: 'No end date' }));
    await user.type(within(form).getByLabelText(/personal note/i), 'Welcome aboard');
    await user.type(within(form).getByLabelText(/internal reason/i), 'QA slice 0 demo');
    await user.click(within(form).getByRole('button', { name: 'Create' }));

    const panel = await screen.findByTestId('created-link-panel');
    expect(within(panel).getByTestId('created-link')).toHaveTextContent(LINK);
    expect(panel).toHaveTextContent('This link is shown once');

    const post = calls.find((call) => call.init?.method === 'POST');
    expect(post?.url).toBe('/api/admin/business-os/invites');
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      inviteType: 'fixture-free',
      email: 'x@example.com',
      linkExpiryDays: 30,
      language: 'en',
      personalNote: 'Welcome aboard',
      reason: 'QA slice 0 demo',
      access: { kind: 'open_ended' },
    });

    const writeText = jest.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await user.click(within(panel).getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(await within(panel).findByText('Copied')).toBeInTheDocument();

    expect(screen.getByTestId('invite-row-invite-2')).toBeInTheDocument();
  });

  it('a second invite gets a fresh panel: its button reads "Copy", not the first link\'s "Copied"', async () => {
    const LINK_B = 'http://localhost:3000/invite#t=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    const user = userEvent.setup();
    render(<BusinessOsInvitesPage />);
    await screen.findByTestId('invite-list');

    let nextCreate = { invite: row({ id: 'invite-a', email: 'a@example.com' }), link: LINK };
    responder = (call) =>
      call.init?.method === 'POST'
        ? { status: 201, body: { success: true, data: nextCreate } }
        : { status: 200, body: { success: true, data: payload() } };

    const createOne = async (email: string) => {
      await user.click(screen.getByRole('button', { name: /new invite/i }));
      const form = screen.getByTestId('create-invite-form');
      // fireEvent.change, not user.type: typing char by char pushed this test past
      // Jest's 5 s timeout. Clicks stay on user-event.
      fireEvent.change(within(form).getByLabelText('Email'), { target: { value: email } });
      await user.click(within(form).getByRole('radio', { name: 'No end date' }));
      fireEvent.change(within(form).getByLabelText(/internal reason/i), { target: { value: 'QA copy state' } });
      await user.click(within(form).getByRole('button', { name: 'Create' }));
    };

    // Must come after userEvent.setup(), which installs its own clipboard stub.
    const writeText = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    // Invite A: copy it.
    await createOne('a@example.com');
    let panel = await screen.findByTestId('created-link-panel');
    expect(within(panel).getByTestId('created-link')).toHaveTextContent(LINK);
    await user.click(within(panel).getByRole('button', { name: 'Copy' }));
    expect(await within(panel).findByText('Copied')).toBeInTheDocument();
    expect(writeText).toHaveBeenLastCalledWith(LINK);

    // Invite B, without dismissing A's panel first (what the admin did on production).
    nextCreate = { invite: row({ id: 'invite-b', email: 'b@example.com' }), link: LINK_B };
    await createOne('b@example.com');
    await waitFor(() => expect(screen.getByTestId('created-link')).toHaveTextContent(LINK_B));
    panel = screen.getByTestId('created-link-panel');
    expect(panel).toHaveTextContent('Invite created for b@example.com');
    expect(within(panel).queryByText('Copied')).not.toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenLastCalledWith(LINK_B);
    expect(await within(panel).findByText('Copied')).toBeInTheDocument();
  }, 15000);

  it('after a reload the link is gone', async () => {
    const { user, form } = await openForm();
    responder = (call) =>
      call.init?.method === 'POST'
        ? { status: 201, body: { success: true, data: { invite: row({ id: 'invite-2' }), link: LINK } } }
        : { status: 200, body: { success: true, data: payload() } };
    await user.type(within(form).getByLabelText('Email'), 'x@example.com');
    await user.click(within(form).getByRole('radio', { name: 'No end date' }));
    await user.type(within(form).getByLabelText(/internal reason/i), 'QA slice 0 demo');
    await user.click(within(form).getByRole('button', { name: 'Create' }));
    await screen.findByTestId('created-link-panel');

    // A reload is a fresh mount: nothing survives but what the server returns.
    cleanup();
    render(<BusinessOsInvitesPage />);
    await screen.findByTestId('invite-list');
    expect(screen.queryByTestId('created-link-panel')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(LINK);
  });

  it('shows the server\'s refusal in plain words', async () => {
    const { user, form } = await openForm();
    responder = (call) =>
      call.init?.method === 'POST'
        ? { status: 409, body: { success: false, error: 'paid_invites_not_available' } }
        : { status: 200, body: { success: true, data: payload() } };
    await user.type(within(form).getByLabelText('Email'), 'x@example.com');
    await user.click(within(form).getByRole('radio', { name: 'No end date' }));
    await user.type(within(form).getByLabelText(/internal reason/i), 'QA slice 0 demo');
    await user.click(within(form).getByRole('button', { name: 'Create' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Paid invites are not available');
  });
});

describe('revoking', () => {
  it('asks for a reason of at least 3 characters, then shows the row as Revoked', async () => {
    const user = userEvent.setup();
    render(<BusinessOsInvitesPage />);
    const list = await screen.findByTestId('invite-list');
    responder = (call) =>
      call.init?.method === 'POST'
        ? {
            status: 200,
            body: {
              success: true,
              data: { invite: row({ state: 'revoked', revokedAt: '2026-10-02T00:00:00.000Z', revokeReason: 'QA revoke test' }) },
            },
          }
        : { status: 200, body: { success: true, data: payload() } };

    await user.click(within(list).getByRole('button', { name: 'Revoke' }));
    const dialog = screen.getByTestId('revoke-dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Revoke invite' });
    await user.type(within(dialog).getByRole('textbox'), 'no');
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByRole('textbox'), 'pe, QA revoke test');
    await user.click(confirm);

    await waitFor(() => expect(within(list).getByTestId('invite-state')).toHaveTextContent('Revoked'));
    expect(list).toHaveTextContent('QA revoke test');
    const post = calls.find((call) => call.init?.method === 'POST');
    expect(post?.url).toBe('/api/admin/business-os/invites/invite-1/revoke');
  });

  it('offers no Revoke for an accepted or revoked invite', async () => {
    responder = () => ({
      status: 200,
      body: {
        success: true,
        data: payload({ invites: [row({ id: 'a', state: 'accepted' }), row({ id: 'b', state: 'revoked' })] }),
      },
    });
    render(<BusinessOsInvitesPage />);
    const list = await screen.findByTestId('invite-list');
    expect(within(list).queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
  });
});
