/**
 * @jest-environment jsdom
 *
 * Admin Layout Follow-ups LF-3a, request pins (RP-1 to RP-13).
 *
 * Written BEFORE "New invite" moved into the drawer and Revoke into a dialog,
 * green on the unchanged code, and kept byte-identical through the build (its
 * SHA-256 is recorded in docs/workplans/ADMIN_LAYOUT_LF3A_WORKPLAN.md). Any
 * red here after the move means a request changed, not that the pin is wrong.
 *
 * What is pinned: the exact URL, the init keys in order, the exact headers,
 * the body as an exact string (so the key order is pinned too), one send and
 * no list read after it, every error sentence, and both enable rules.
 *
 * Portal-safe on purpose (SA C3 b): the create form and the revoke surface are
 * always found through `screen` by test id, never inside the list or the
 * content area, so the same query holds inline (before) and portalled (after).
 * A row's revoke opener is found by `/^Revoke/` inside its row: "Revoke"
 * before F-110, "Revoke invite for ..." after.
 *
 * Invented ids, labels and plans only.
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import BusinessOsInvitesPage from '../page';
import type { InviteRow, InvitesPayload } from '../types';

jest.setTimeout(30_000);

const LINK = 'http://localhost:3000/invite#t=PINPINPINPINPINPINPINPINPINPINPINPINPINPINP';
const CREATE_URL = '/api/admin/business-os/invites';
const JSON_HEADERS = { 'content-type': 'application/json' };

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

function payload(invites: InviteRow[] = [row()]): InvitesPayload {
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
          type: 'fixture-paid',
          label: 'Fixture Paid',
          available: false,
          unavailableReason: 'available when payments are live',
          requiresAccess: false,
          grants: [{ id: 'tier-a', label: 'Tier A', default: true }],
        },
        {
          type: 'fixture-granted',
          label: 'Fixture Granted',
          available: true,
          unavailableReason: null,
          requiresAccess: false,
          grants: [
            { id: 'tier-b', label: 'Tier B', default: true },
            { id: 'tier-c', label: 'Tier C', default: false },
          ],
        },
      ],
    },
    enforcementMode: 'off',
  };
}

type FetchCall = { url: string; init?: RequestInit };
type Reply = { status: number; body: unknown } | 'not-json' | 'reject';
let calls: FetchCall[] = [];
let responder: (call: FetchCall) => Reply;

beforeEach(() => {
  calls = [];
  responder = () => ({ status: 200, body: { success: true, data: payload() } });
  global.fetch = jest.fn((url: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    const reply = responder(call);
    if (reply === 'reject') return Promise.reject(new TypeError('Failed to fetch'));
    if (reply === 'not-json') {
      return Promise.resolve({
        ok: false,
        status: 502,
        json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON')),
      } as Response);
    }
    return Promise.resolve({
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: () => Promise.resolve(reply.body),
    } as Response);
  }) as unknown as typeof fetch;
});

const posts = () => calls.filter((call) => call.init?.method === 'POST');

function expectExactPost(call: FetchCall | undefined, url: string, body: string) {
  expect(call?.url).toBe(url);
  expect(Object.keys(call?.init ?? {})).toEqual(['method', 'headers', 'body']);
  expect(call?.init?.method).toBe('POST');
  expect(call?.init?.headers).toEqual(JSON_HEADERS);
  expect(call?.init?.body).toBe(body);
}

async function mount(invites: InviteRow[] = [row()]) {
  responder = () => ({ status: 200, body: { success: true, data: payload(invites) } });
  const user = userEvent.setup();
  render(<BusinessOsInvitesPage />);
  await screen.findByTestId('invite-list');
  return user;
}

// ── Create ──────────────────────────────────────────────────────────────────

async function openCreate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /new invite/i }));
  return screen.findByTestId('create-invite-form');
}

function createSucceeds(id = 'invite-new') {
  responder = (call) =>
    call.init?.method === 'POST'
      ? { status: 201, body: { success: true, data: { invite: row({ id, email: 'x@example.com' }), link: LINK } } }
      : { status: 200, body: { success: true, data: payload() } };
}

function type(form: HTMLElement, label: string | RegExp, value: string) {
  fireEvent.change(within(form).getByLabelText(label), { target: { value } });
}

async function submitCreate(user: ReturnType<typeof userEvent.setup>, form: HTMLElement) {
  await user.click(within(form).getByRole('button', { name: 'Create' }));
}

describe('LF-3a pins: the create request', () => {
  it('RP-1: free type, no end date, a note, email ticked: the exact request', async () => {
    const user = await mount();
    const form = await openCreate(user);
    createSucceeds();
    type(form, 'Email', 'x@example.com');
    await user.click(within(form).getByRole('radio', { name: 'No end date' }));
    type(form, /personal note/i, 'Welcome');
    type(form, /internal reason/i, 'QA pin');
    await submitCreate(user, form);
    await screen.findByTestId('created-link-panel');

    expect(posts()).toHaveLength(1);
    expectExactPost(
      posts()[0],
      CREATE_URL,
      '{"inviteType":"fixture-free","email":"x@example.com","linkExpiryDays":30,"language":"en","reason":"QA pin","sendEmail":true,"personalNote":"Welcome","access":{"kind":"open_ended"}}'
    );
  });

  it('RP-2: months of access, 60-day expiry, Hebrew, email unticked, no note: the exact request', async () => {
    const user = await mount();
    const form = await openCreate(user);
    createSucceeds();
    type(form, 'Email', 'x@example.com');
    await user.click(within(form).getByRole('radio', { name: 'A number of months from signup' }));
    type(form, 'Months of access', '18');
    fireEvent.change(within(form).getByLabelText('Link expiry'), { target: { value: '60' } });
    fireEvent.change(within(form).getByLabelText('Invitee language'), { target: { value: 'he' } });
    await user.click(within(form).getByTestId('invite-send-email'));
    type(form, /internal reason/i, 'QA pin');
    await submitCreate(user, form);
    await screen.findByTestId('created-link-panel');

    expectExactPost(
      posts()[0],
      CREATE_URL,
      '{"inviteType":"fixture-free","email":"x@example.com","linkExpiryDays":60,"language":"he","reason":"QA pin","sendEmail":false,"access":{"kind":"months","months":18}}'
    );
  });

  it('RP-3: a type with plans and no access decision sends its default plan and no access', async () => {
    const user = await mount();
    const form = await openCreate(user);
    createSucceeds();
    await user.click(within(form).getByRole('radio', { name: 'Fixture Granted' }));
    expect((within(form).getByLabelText('Plan') as HTMLSelectElement).value).toBe('tier-b');
    type(form, 'Email', 'x@example.com');
    type(form, /internal reason/i, 'QA pin');
    await submitCreate(user, form);
    await screen.findByTestId('created-link-panel');

    expectExactPost(
      posts()[0],
      CREATE_URL,
      '{"inviteType":"fixture-granted","email":"x@example.com","linkExpiryDays":30,"language":"en","reason":"QA pin","sendEmail":true,"grantId":"tier-b"}'
    );
  });

  it('RP-4: the plan chosen in Plan is the one sent', async () => {
    const user = await mount();
    const form = await openCreate(user);
    createSucceeds();
    await user.click(within(form).getByRole('radio', { name: 'Fixture Granted' }));
    fireEvent.change(within(form).getByLabelText('Plan'), { target: { value: 'tier-c' } });
    type(form, 'Email', 'x@example.com');
    type(form, /internal reason/i, 'QA pin');
    await submitCreate(user, form);
    await screen.findByTestId('created-link-panel');

    expectExactPost(
      posts()[0],
      CREATE_URL,
      '{"inviteType":"fixture-granted","email":"x@example.com","linkExpiryDays":30,"language":"en","reason":"QA pin","sendEmail":true,"grantId":"tier-c"}'
    );
  });

  it('RP-13: changing the type and back resets the plan to its default', async () => {
    const user = await mount();
    const form = await openCreate(user);
    createSucceeds();
    await user.click(within(form).getByRole('radio', { name: 'Fixture Granted' }));
    fireEvent.change(within(form).getByLabelText('Plan'), { target: { value: 'tier-c' } });
    await user.click(within(form).getByRole('radio', { name: /fixture free/i }));
    await user.click(within(form).getByRole('radio', { name: 'Fixture Granted' }));
    expect((within(form).getByLabelText('Plan') as HTMLSelectElement).value).toBe('tier-b');
    type(form, 'Email', 'x@example.com');
    type(form, /internal reason/i, 'QA pin');
    await submitCreate(user, form);
    await screen.findByTestId('created-link-panel');

    expect(posts()[0]?.init?.body).toBe(
      '{"inviteType":"fixture-granted","email":"x@example.com","linkExpiryDays":30,"language":"en","reason":"QA pin","sendEmail":true,"grantId":"tier-b"}'
    );
  });

  it('RP-5: the reason and the note are trimmed; a note of only spaces sends no note', async () => {
    const user = await mount();
    let form = await openCreate(user);
    createSucceeds('invite-a');
    type(form, 'Email', 'x@example.com');
    await user.click(within(form).getByRole('radio', { name: 'No end date' }));
    type(form, /personal note/i, '  Welcome  ');
    type(form, /internal reason/i, '  QA pin  ');
    await submitCreate(user, form);
    await screen.findByTestId('created-link-panel');
    expect(posts()[0]?.init?.body).toBe(
      '{"inviteType":"fixture-free","email":"x@example.com","linkExpiryDays":30,"language":"en","reason":"QA pin","sendEmail":true,"personalNote":"Welcome","access":{"kind":"open_ended"}}'
    );

    createSucceeds('invite-b');
    form = await openCreate(user);
    type(form, 'Email', 'x@example.com');
    await user.click(within(form).getByRole('radio', { name: 'No end date' }));
    type(form, /personal note/i, '   ');
    type(form, /internal reason/i, 'QA pin');
    await submitCreate(user, form);
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(posts()[1]?.init?.body).toBe(
      '{"inviteType":"fixture-free","email":"x@example.com","linkExpiryDays":30,"language":"en","reason":"QA pin","sendEmail":true,"access":{"kind":"open_ended"}}'
    );
  });

  it('RP-6: a create sends exactly one request and reads the list no more', async () => {
    const user = await mount();
    const before = calls.length;
    const form = await openCreate(user);
    createSucceeds();
    type(form, 'Email', 'x@example.com');
    await user.click(within(form).getByRole('radio', { name: 'No end date' }));
    type(form, /internal reason/i, 'QA pin');
    await submitCreate(user, form);
    await screen.findByTestId('created-link-panel');
    await waitFor(() => expect(screen.getByTestId('invite-row-invite-new')).toBeInTheDocument());
    expect(calls).toHaveLength(before + 1);
  });

  const CREATE_FALLBACK = 'The invite could not be created. Try again.';

  it.each<[string, Reply, string]>([
    ['invalid_input', { status: 400, body: { success: false, error: 'invalid_input' } }, 'Some fields are not valid. Check the email, the reason and the choices.'],
    ['paid_invites_not_available', { status: 409, body: { success: false, error: 'paid_invites_not_available' } }, 'Paid invites are not available until payments are live.'],
    ['invite_type_not_allowed', { status: 403, body: { success: false, error: 'invite_type_not_allowed' } }, 'You cannot issue this type of invite.'],
    ['grant_not_available', { status: 409, body: { success: false, error: 'grant_not_available' } }, 'That plan is no longer offered.'],
    ['could_not_create_invite', { status: 500, body: { success: false, error: 'could_not_create_invite' } }, CREATE_FALLBACK],
    ['an unknown code', { status: 500, body: { success: false, error: 'some_new_code' } }, CREATE_FALLBACK],
    ['a reply that is not JSON', 'not-json', CREATE_FALLBACK],
    ['a rejected fetch', 'reject', CREATE_FALLBACK],
  ])('RP-7: a create refused with %s shows its sentence in the form', async (_case, reply, sentence) => {
    const user = await mount();
    const form = await openCreate(user);
    responder = (call) => (call.init?.method === 'POST' ? reply : { status: 200, body: { success: true, data: payload() } });
    type(form, 'Email', 'x@example.com');
    await user.click(within(form).getByRole('radio', { name: 'No end date' }));
    type(form, /internal reason/i, 'QA pin');
    await submitCreate(user, form);
    const alert = await within(screen.getByTestId('create-invite-form')).findByRole('alert');
    expect(alert.textContent).toBe(sentence);
    expect(document.body.textContent).not.toContain('some_new_code');
    expect(document.body.textContent).not.toContain('Failed to fetch');
    expect(posts()).toHaveLength(1);
  });

  it('RP-12: Create waits for an email, a 3-character reason and, for this type, an access choice within the month cap', async () => {
    const user = await mount();
    const form = await openCreate(user);
    const create = () => within(screen.getByTestId('create-invite-form')).getByRole('button', { name: 'Create' });
    expect(create()).toBeDisabled();
    type(form, 'Email', 'x@example.com');
    type(form, /internal reason/i, 'ab');
    await user.click(within(form).getByRole('radio', { name: 'No end date' }));
    expect(create()).toBeDisabled();
    type(form, /internal reason/i, 'abc');
    expect(create()).toBeEnabled();
    await user.click(within(form).getByRole('radio', { name: 'A number of months from signup' }));
    for (const [months, enabled] of [
      ['0', false],
      ['61', false],
      ['1.5', false],
      ['1', true],
      ['60', true],
    ] as const) {
      type(form, 'Months of access', months);
      if (enabled) expect(create()).toBeEnabled();
      else expect(create()).toBeDisabled();
    }
    type(form, 'Email', '');
    expect(create()).toBeDisabled();
  });
});

// ── Revoke ──────────────────────────────────────────────────────────────────

async function openRevoke(user: ReturnType<typeof userEvent.setup>, inviteId: string) {
  const opener = within(screen.getByTestId(`invite-row-${inviteId}`)).getByRole('button', { name: /^Revoke/ });
  await user.click(opener);
  return screen.findByTestId('revoke-dialog');
}

describe('LF-3a pins: the revoke request', () => {
  const ODD = row({ id: 'inv/1 a', email: 'odd@example.com' });

  it('RP-8: the id is encoded in the path and the trimmed reason is the whole body', async () => {
    const user = await mount([ODD]);
    responder = (call) =>
      call.init?.method === 'POST'
        ? {
            status: 200,
            body: { success: true, data: { invite: { ...ODD, state: 'revoked', revokedAt: '2026-10-02T00:00:00.000Z', revokeReason: 'QA pin reason' } } },
          }
        : { status: 200, body: { success: true, data: payload([ODD]) } };
    const dialog = await openRevoke(user, 'inv/1 a');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '  QA pin reason  ' } });
    await user.click(within(dialog).getByRole('button', { name: 'Revoke invite' }));
    await waitFor(() =>
      expect(within(screen.getByTestId('invite-row-inv/1 a')).getByTestId('invite-state')).toHaveTextContent('Revoked')
    );

    expect(posts()).toHaveLength(1);
    expectExactPost(posts()[0], '/api/admin/business-os/invites/inv%2F1%20a/revoke', '{"reason":"QA pin reason"}');
  });

  it('RP-9: a revoke sends exactly one request and reads the list no more', async () => {
    const user = await mount();
    const before = calls.length;
    responder = (call) =>
      call.init?.method === 'POST'
        ? { status: 200, body: { success: true, data: { invite: row({ state: 'revoked', revokeReason: 'QA pin' }) } } }
        : { status: 200, body: { success: true, data: payload() } };
    const dialog = await openRevoke(user, 'invite-1');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'QA pin' } });
    await user.click(within(dialog).getByRole('button', { name: 'Revoke invite' }));
    await waitFor(() =>
      expect(within(screen.getByTestId('invite-row-invite-1')).getByTestId('invite-state')).toHaveTextContent('Revoked')
    );
    expect(calls).toHaveLength(before + 1);
  });

  const REVOKE_FALLBACK = 'The invite could not be revoked. Try again.';

  it.each<[string, Reply, string]>([
    ['invalid_input', { status: 400, body: { success: false, error: 'invalid_input' } }, 'Give a reason of at least 3 characters.'],
    ['invite_not_found', { status: 404, body: { success: false, error: 'invite_not_found' } }, 'This invite no longer exists. Refresh the list.'],
    ['invite_not_revocable', { status: 409, body: { success: false, error: 'invite_not_revocable' } }, 'This invite cannot be revoked: it was accepted or already revoked.'],
    ['could_not_revoke_invite', { status: 500, body: { success: false, error: 'could_not_revoke_invite' } }, REVOKE_FALLBACK],
    ['an unknown code', { status: 500, body: { success: false, error: 'some_new_code' } }, REVOKE_FALLBACK],
    ['a reply that is not JSON', 'not-json', REVOKE_FALLBACK],
    ['a rejected fetch', 'reject', REVOKE_FALLBACK],
  ])('RP-10: a revoke refused with %s shows its sentence in the revoke surface', async (_case, reply, sentence) => {
    const user = await mount();
    responder = (call) => (call.init?.method === 'POST' ? reply : { status: 200, body: { success: true, data: payload() } });
    const dialog = await openRevoke(user, 'invite-1');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'QA pin' } });
    await user.click(within(dialog).getByRole('button', { name: 'Revoke invite' }));
    const alert = await within(screen.getByTestId('revoke-dialog')).findByRole('alert');
    expect(alert.textContent).toBe(sentence);
    expect(document.body.textContent).not.toContain('some_new_code');
    expect(document.body.textContent).not.toContain('Failed to fetch');
    expect(posts()).toHaveLength(1);
  });

  it('RP-11: the reason needs 3 characters by code point, after trimming', async () => {
    const user = await mount();
    const dialog = await openRevoke(user, 'invite-1');
    const confirm = () => within(screen.getByTestId('revoke-dialog')).getByRole('button', { name: 'Revoke invite' });
    for (const [reason, enabled] of [
      ['', false],
      ['ab', false],
      ['  ab ', false],
      ['abc', true],
      ['😀😀', false],
      ['😀😀😀', true],
    ] as const) {
      fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: reason } });
      if (enabled) expect(confirm()).toBeEnabled();
      else expect(confirm()).toBeDisabled();
    }
    expect(posts()).toHaveLength(0);
  });
});
