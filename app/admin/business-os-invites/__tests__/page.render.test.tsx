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

// Timeout only, no assertion changes. These cases type into the form character
// by character with userEvent.type, so the file takes ~29s on its own and some
// cases ran past Jest's 5s default when the full suite loaded every worker.
jest.setTimeout(30_000);

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
    redeemedAccountId: null,
    level: null,
    redemptionStoppedHalfway: false,
    redemptionFailure: null,
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

  it('Slice 1b: an accepted invite shows its account, the time and L1', async () => {
    responder = () => ({
      status: 200,
      body: {
        success: true,
        data: payload({
          invites: [row({ state: 'accepted', redeemedAt: '2026-10-03T09:00:00.000Z', redeemedAccountId: 'acct-123', level: 1 })],
        }),
      },
    });
    render(<BusinessOsInvitesPage />);
    const list = await screen.findByTestId('invite-list');
    const accepted = within(list).getByTestId('invite-accepted-account');
    expect(accepted).toHaveTextContent('acct-123');
    expect(accepted).toHaveTextContent('2026-10-03');
    expect(accepted).toHaveTextContent('L1');
    // An L1 champion has no parent, so nothing is shown for it.
    expect(within(list).queryByTestId('invite-parent-account')).not.toBeInTheDocument();
  });

  it('Slice 5b (FR-36): an accepted friend invite shows L2 and its parent account', async () => {
    responder = () => ({
      status: 200,
      body: {
        success: true,
        data: payload({
          invites: [
            row({
              state: 'accepted',
              redeemedAt: '2026-10-03T09:00:00.000Z',
              redeemedAccountId: 'friend-456',
              level: 2,
              parentAccountId: 'champion-789',
              issuerKind: 'account',
              issuerAccountId: 'champion-789',
            }),
          ],
        }),
      },
    });
    render(<BusinessOsInvitesPage />);
    const list = await screen.findByTestId('invite-list');
    const accepted = within(list).getByTestId('invite-accepted-account');
    expect(accepted).toHaveTextContent('friend-456');
    expect(accepted).toHaveTextContent('L2');
    expect(within(accepted).getByTestId('invite-parent-account')).toHaveTextContent('parent champion-789');
  });

  it('T-16: the banner counts signups that stopped halfway, and each row shows the step, code, message and account', async () => {
    responder = () => ({
      status: 200,
      body: {
        success: true,
        data: payload({
          invites: [
            row({
              id: 'invite-a',
              redemptionStoppedHalfway: true,
              redemptionFailure: {
                at: '2026-10-03T09:00:00.000Z',
                step: 'finalise',
                errorCode: '23505',
                errorMessage: 'duplicate key for [email]',
                accountId: 'acct-9',
              },
            }),
            row({ id: 'invite-b', email: 'second@example.com', redemptionStoppedHalfway: true }),
          ],
          stoppedHalfway: { count: 2, inviteIds: ['invite-a', 'invite-b'] },
        }),
      },
    });
    render(<BusinessOsInvitesPage />);
    expect(await screen.findByTestId('stopped-halfway-banner')).toHaveTextContent('2 signups stopped halfway.');
    // QA-1b-2: the banner names the recovery runbook (D-dev-14).
    expect(screen.getByTestId('stopped-halfway-banner')).toHaveTextContent(
      'docs/workplans/BUSINESS_OS_INVITE_SIGNUP_SLICE_1_WORKPLAN.md'
    );
    const badges = screen.getAllByTestId('invite-stopped-halfway');
    expect(badges).toHaveLength(2);
    expect(badges[0]).toHaveTextContent('Step finalise');
    expect(badges[0]).toHaveTextContent('code 23505');
    expect(badges[0]).toHaveTextContent('duplicate key for [email]');
    expect(badges[0]).toHaveTextContent('acct-9');
    // The timeout case (D-3): no record, still flagged.
    expect(badges[1]).toHaveTextContent('timed out before it could record why');
  });

  it('T-16: no banner when nothing stopped halfway, or when an older server sends no summary', async () => {
    render(<BusinessOsInvitesPage />);
    await screen.findByTestId('invite-list');
    expect(screen.queryByTestId('stopped-halfway-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('invite-stopped-halfway')).not.toBeInTheDocument();
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
    // Slice 1c: the filter and search controls are present over a non-empty list.
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
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

describe('Slice 1c: filters and email search', () => {
  // One invite per state and condition. Every flag is the server's decision;
  // the screen only matches it.
  const invites = [
    row({ id: 'p', email: 'Pending.Person@Example.com', state: 'pending' }),
    row({ id: 'a', email: 'accepted@example.com', state: 'accepted', inviteType: 'fixture-paid', redeemedAt: '2026-10-03T09:00:00.000Z' }),
    row({ id: 'e', email: 'expired@other.org', state: 'expired' }),
    row({ id: 'r', email: 'revoked@example.com', state: 'revoked', revokedAt: '2026-10-02T09:00:00.000Z', revokeReason: 'typo' }),
    row({ id: 'o', email: 'existing@example.com', state: 'pending', openedByExistingAccountAt: '2026-10-02T09:00:00.000Z' }),
    row({ id: 's', email: 'halfway@other.org', state: 'expired', redemptionStoppedHalfway: true }),
    row({ id: 'pct', email: 'a%b_c@example.com', state: 'pending' }),
  ];

  const shownIds = () =>
    screen
      .queryAllByTestId(/^invite-row-/)
      .map((element) => element.getAttribute('data-testid')?.replace('invite-row-', ''));

  async function renderWith(overrides: Partial<InvitesPayload> = {}) {
    responder = () => ({ status: 200, body: { success: true, data: payload({ invites, ...overrides }) } });
    render(<BusinessOsInvitesPage />);
    await screen.findByTestId('invite-list');
  }

  it.each([
    ['pending', ['p', 'o', 'pct']],
    ['accepted', ['a']],
    ['expired', ['e', 's']],
    ['revoked', ['r']],
    ['opened_by_existing_account', ['o']],
    ['stopped_halfway', ['s']],
    ['all', ['p', 'a', 'e', 'r', 'o', 's', 'pct']],
  ])('state "%s" shows exactly %j', async (state, expected) => {
    await renderWith();
    fireEvent.change(screen.getByTestId('invite-state-filter'), { target: { value: state } });
    expect(shownIds()).toEqual(expected);
  });

  it('offers every state and condition in the state filter', async () => {
    await renderWith();
    const options = within(screen.getByTestId('invite-state-filter'))
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toEqual([
      'All states',
      'Pending',
      'Accepted',
      'Expired',
      'Revoked',
      'Opened by an existing account',
      'Signup stopped halfway',
    ]);
  });

  it('filters by invite type, with the types the payload offers', async () => {
    await renderWith();
    const typeSelect = screen.getByTestId('invite-type-filter');
    expect(within(typeSelect).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'All types',
      'Fixture Free (Fixture Free Plan)',
      'Fixture Paid',
    ]);
    fireEvent.change(typeSelect, { target: { value: 'fixture-paid' } });
    expect(shownIds()).toEqual(['a']);
  });

  it('search is a case-insensitive substring of the email', async () => {
    await renderWith();
    await userEvent.type(screen.getByTestId('invite-search'), 'PENDING.person');
    expect(shownIds()).toEqual(['p']);
    await userEvent.clear(screen.getByTestId('invite-search'));
    await userEvent.type(screen.getByTestId('invite-search'), 'other.org');
    expect(shownIds()).toEqual(['e', 's']);
  });

  it('search takes % and _ literally, not as wildcards', async () => {
    await renderWith();
    fireEvent.change(screen.getByTestId('invite-search'), { target: { value: '%' } });
    expect(shownIds()).toEqual(['pct']);
    fireEvent.change(screen.getByTestId('invite-search'), { target: { value: 'a_b' } });
    expect(shownIds()).toEqual([]);
    fireEvent.change(screen.getByTestId('invite-search'), { target: { value: 'b_c' } });
    expect(shownIds()).toEqual(['pct']);
  });

  it('a search that matches nothing says so, with the count, and Clear brings every row back', async () => {
    await renderWith();
    fireEvent.change(screen.getByTestId('invite-search'), { target: { value: 'nobody-here' } });
    expect(shownIds()).toEqual([]);
    expect(screen.getByTestId('invite-list-empty')).toHaveTextContent('No invites match these filters.');
    expect(screen.getByTestId('invite-filter-count')).toHaveTextContent('0 of 7 shown');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(shownIds()).toHaveLength(7);
    expect(screen.getByTestId('invite-filter-count')).toHaveTextContent('7 invites');
  });

  it('state, type and search combine (AND)', async () => {
    await renderWith();
    fireEvent.change(screen.getByTestId('invite-state-filter'), { target: { value: 'pending' } });
    fireEvent.change(screen.getByTestId('invite-type-filter'), { target: { value: 'fixture-free' } });
    fireEvent.change(screen.getByTestId('invite-search'), { target: { value: 'EXAMPLE.com' } });
    expect(shownIds()).toEqual(['p', 'o', 'pct']);
    fireEvent.change(screen.getByTestId('invite-search'), { target: { value: 'existing' } });
    expect(shownIds()).toEqual(['o']);
    fireEvent.change(screen.getByTestId('invite-state-filter'), { target: { value: 'revoked' } });
    expect(shownIds()).toEqual([]);
    expect(screen.getByTestId('invite-filter-count')).toHaveTextContent('0 of 7 shown');
  });

  it('never sends the search or the filters to the server', async () => {
    await renderWith();
    const before = calls.length;
    fireEvent.change(screen.getByTestId('invite-search'), { target: { value: 'secret-needle' } });
    fireEvent.change(screen.getByTestId('invite-state-filter'), { target: { value: 'revoked' } });
    expect(calls.length).toBe(before);
    expect(calls.every((call) => !call.url.includes('secret-needle'))).toBe(true);
  });

  it('the stopped-halfway banner and badges stay as they were, whatever the filter', async () => {
    await renderWith({ stoppedHalfway: { count: 1, inviteIds: ['s'] } });
    fireEvent.change(screen.getByTestId('invite-state-filter'), { target: { value: 'revoked' } });
    expect(screen.getByTestId('stopped-halfway-banner')).toHaveTextContent('1 signup stopped halfway.');
    fireEvent.change(screen.getByTestId('invite-state-filter'), { target: { value: 'stopped_halfway' } });
    expect(screen.getAllByTestId('invite-stopped-halfway')).toHaveLength(1);
  });

  it('says when the 500 ceiling was reached, and not otherwise', async () => {
    await renderWith({ truncated: true });
    expect(screen.getByTestId('invite-list-truncated')).toHaveTextContent('Showing the newest 7 invites');
    cleanup();
    await renderWith({ truncated: false });
    expect(screen.queryByTestId('invite-list-truncated')).not.toBeInTheDocument();
    cleanup();
    // An older server sends no flag: no note.
    await renderWith();
    expect(screen.queryByTestId('invite-list-truncated')).not.toBeInTheDocument();
  });

  it('shows no filter controls over an empty list', async () => {
    responder = () => ({ status: 200, body: { success: true, data: payload({ invites: [] }) } });
    render(<BusinessOsInvitesPage />);
    expect(await screen.findByTestId('invite-list-empty')).toHaveTextContent('No invites yet.');
    expect(screen.queryByTestId('invite-filters')).not.toBeInTheDocument();
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
      // Slice 2a: ticked by default.
      sendEmail: true,
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

// ── Slice 2a: the invitation email ──────────────────────────────────────────

describe('Slice 2a: the invitation email', () => {
  async function openFormWith(data: InvitesPayload = payload()) {
    responder = () => ({ status: 200, body: { success: true, data } });
    const user = userEvent.setup();
    render(<BusinessOsInvitesPage />);
    await screen.findByTestId('invite-list');
    await user.click(screen.getByRole('button', { name: /new invite/i }));
    return { user, form: screen.getByTestId('create-invite-form') };
  }

  async function createWith(email: { requested: boolean; status: string } | undefined, tick = true) {
    const { user, form } = await openFormWith();
    const createdRow = row({ id: 'invite-9', email: 'x@example.com' });
    responder = (call) =>
      call.init?.method === 'POST'
        ? { status: 201, body: { success: true, data: { invite: createdRow, link: LINK, ...(email ? { email } : {}) } } }
        : { status: 200, body: { success: true, data: payload() } };
    fireEvent.change(within(form).getByLabelText('Email'), { target: { value: 'x@example.com' } });
    await user.click(within(form).getByRole('radio', { name: 'No end date' }));
    fireEvent.change(within(form).getByLabelText(/internal reason/i), { target: { value: 'QA slice 2a' } });
    if (!tick) await user.click(within(form).getByTestId('invite-send-email'));
    await user.click(within(form).getByRole('button', { name: 'Create' }));
    return screen.findByTestId('created-link-panel');
  }

  it('the form offers "Send the invitation email", ticked by default', async () => {
    const { form } = await openFormWith();
    const box = within(form).getByRole('checkbox', { name: /send the invitation email/i });
    expect(box).toBeChecked();
  });

  it('the language arrives pre-selected from the server (the admin preference, D-8)', async () => {
    const { form } = await openFormWith(payload({ formOptions: { ...payload().formOptions, defaultLanguage: 'he' } }));
    expect((within(form).getByLabelText('Invitee language') as HTMLSelectElement).value).toBe('he');
  });

  it('unticked: the request says sendEmail false, and the panel claims nothing about an email', async () => {
    const panel = await createWith({ requested: false, status: 'not_emailed' }, false);
    const post = calls.find((call) => call.init?.method === 'POST');
    expect(JSON.parse(String(post?.init?.body)).sendEmail).toBe(false);
    expect(within(panel).queryByTestId('created-email-status')).toBeNull();
    expect(within(panel).getByTestId('created-link')).toHaveTextContent(LINK);
  });

  it('sent: the panel says it was emailed AND still shows the link once', async () => {
    const panel = await createWith({ requested: true, status: 'sent' });
    expect(within(panel).getByTestId('created-email-status')).toHaveTextContent('The invitation was emailed to x@example.com.');
    expect(within(panel).getByTestId('created-link')).toHaveTextContent(LINK);
    expect(panel).toHaveTextContent('This link is shown once');
  });

  it('not sent: the panel says so and points at the link to copy', async () => {
    const panel = await createWith({ requested: true, status: 'not_sent' });
    expect(within(panel).getByTestId('created-email-status')).toHaveTextContent('The email was not sent. Copy the link below');
    expect(within(panel).getByTestId('created-link')).toHaveTextContent(LINK);
  });

  it('unknown: the panel says it could not confirm, and the link is there', async () => {
    const panel = await createWith({ requested: true, status: 'unknown' });
    expect(within(panel).getByTestId('created-email-status')).toHaveTextContent('could not confirm');
  });

  it('an older server with no email block: the panel reads as before', async () => {
    const panel = await createWith(undefined);
    expect(within(panel).queryByTestId('created-email-status')).toBeNull();
  });

  it.each([
    ['not_emailed', 'Not emailed'],
    ['sent', 'Sent'],
    ['sent_untracked', 'Sent (not tracked)'],
    ['not_sent', 'Not sent'],
    ['unknown', 'Unknown'],
  ] as const)('the list shows email status %s as "%s"', async (emailStatus, label) => {
    responder = () => ({ status: 200, body: { success: true, data: payload({ invites: [row({ emailStatus, emailStatusAt: null })] }) } });
    render(<BusinessOsInvitesPage />);
    const list = await screen.findByTestId('invite-list');
    expect(within(list).getByTestId('invite-email-status')).toHaveTextContent(new RegExp(`^${label.replace(/[()]/g, '\\$&')}$`));
    cleanup();
  });

  it('a row without an email status (older server) shows a dash, not a badge', async () => {
    render(<BusinessOsInvitesPage />);
    const list = await screen.findByTestId('invite-list');
    expect(within(list).queryByTestId('invite-email-status')).toBeNull();
  });
});

describe('Slice 5a (F5a-11): a champion friend invite in the admin list', () => {
  const CHAMPION = '44444444-4444-4444-8444-444444444444';
  const friend = row({
    id: 'f',
    email: 'friend@example.com',
    inviteType: 'fixture-paid',
    grantLabel: 'Tier A',
    inviterDisplayName: 'Dana Champion',
    issuerKind: 'account',
    issuerAccountId: CHAMPION,
  });
  const friendRevoked = row({
    id: 'fr',
    email: 'gone@example.com',
    issuerKind: 'account',
    issuerAccountId: CHAMPION,
    state: 'revoked',
    revokedAt: '2026-10-02T09:00:00.000Z',
    revokeReason: 'Revoked by the inviting champion',
    revokedByInviter: true,
  });
  const admin = row({ id: 'adm', email: 'admin-issued@example.com', issuerKind: 'admin', issuerAccountId: null });

  const shownIds = () =>
    screen
      .queryAllByTestId(/^invite-row-/)
      .map((element) => element.getAttribute('data-testid')?.replace('invite-row-', ''));

  async function renderWith(invites: InviteRow[]) {
    responder = () => ({ status: 200, body: { success: true, data: payload({ invites }) } });
    render(<BusinessOsInvitesPage />);
    return screen.findByTestId('invite-list');
  }

  it('shows the champion as issuer, with their account id; an admin row shows none', async () => {
    const list = await renderWith([friend, admin]);
    const friendRow = within(list).getByTestId('invite-row-f');
    expect(friendRow).toHaveTextContent('Dana Champion');
    expect(within(friendRow).getByTestId('invite-issuer-account')).toHaveTextContent(CHAMPION);
    expect(within(within(list).getByTestId('invite-row-adm')).queryByTestId('invite-issuer-account')).not.toBeInTheDocument();
  });

  it('says a friend invite was revoked by the inviter', async () => {
    const list = await renderWith([friendRevoked]);
    expect(within(list).getByTestId('invite-revoked-by-inviter')).toHaveTextContent('Revoked by the inviter');
  });

  it('the issuer filter separates friend invites from admin invites; a row from an older server reads as admin', async () => {
    const legacy = row({ id: 'old', email: 'old@example.com' });
    await renderWith([friend, friendRevoked, admin, legacy]);
    const select = screen.getByTestId('invite-issuer-filter');
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'All issuers',
      'Issued by an admin',
      'Friend invites (champions)',
    ]);
    fireEvent.change(select, { target: { value: 'account' } });
    expect(shownIds()).toEqual(['f', 'fr']);
    fireEvent.change(select, { target: { value: 'admin' } });
    expect(shownIds()).toEqual(['adm', 'old']);
    fireEvent.change(select, { target: { value: 'all' } });
    expect(shownIds()).toEqual(['f', 'fr', 'adm', 'old']);
  });

  it('an admin can revoke a champion\u2019s pending friend invite (FR-6), through the admin revoke route', async () => {
    const user = userEvent.setup();
    const list = await renderWith([friend]);
    responder = (call) =>
      call.init?.method === 'POST'
        ? {
            status: 200,
            body: {
              success: true,
              data: { invite: { ...friend, state: 'revoked', revokedAt: '2026-10-02T00:00:00.000Z', revokeReason: 'Admin clean-up', revokedByInviter: false } },
            },
          }
        : { status: 200, body: { success: true, data: payload({ invites: [friend] }) } };

    await user.click(within(list).getByRole('button', { name: 'Revoke' }));
    const dialog = screen.getByTestId('revoke-dialog');
    await user.type(within(dialog).getByRole('textbox'), 'Admin clean-up');
    await user.click(within(dialog).getByRole('button', { name: 'Revoke invite' }));

    await waitFor(() => expect(within(list).getByTestId('invite-state')).toHaveTextContent('Revoked'));
    expect(calls.find((call) => call.init?.method === 'POST')?.url).toBe('/api/admin/business-os/invites/f/revoke');
    expect(within(list).queryByTestId('invite-revoked-by-inviter')).not.toBeInTheDocument();
  });
});
