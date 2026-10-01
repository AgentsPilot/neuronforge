/**
 * @jest-environment jsdom
 *
 * "Invite friends" as a champion reads it (Slice 5a; FR-28 to FR-32, F5a-12;
 * SA R-7).
 *
 * Pinned: the section renders NOTHING, its own row included, unless the server
 * says `eligible: true` (the switch off, a non-champion, and a failed load all
 * look the same: absent); "N of <allowance> left" comes from the server, with
 * no number written in the copy; at 0 the form is replaced by a plain line; a
 * send shows the link once with a copy button; revoke asks for confirmation;
 * the refusals read in plain words; Hebrew is right-to-left; every input has a
 * label; and the component imports nothing from the entitlements module.
 */

import '@testing-library/jest-dom';
import { readFileSync } from 'fs';
import { join } from 'path';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const ui = { language: 'en', isRTL: false };

jest.mock('@/lib/business-os/LanguageContext', () => ({
  useLanguage: () => ({ language: ui.language, isRTL: ui.isRTL, t: (key: string) => key }),
}));

import { InviteFriendsSection } from '@/components/business-os/settings/InviteFriendsSection';
import { INVITE_FRIENDS_COPY } from '@/components/business-os/settings/inviteFriendsCopy';

const LINK = 'https://app.example.test/invite#t=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const ALLOWANCE = 7; // Deliberately not 5: nothing in the copy may assume the number (R-7).

function summary(overrides: Record<string, unknown> = {}) {
  return {
    eligible: true,
    allowance: ALLOWANCE,
    remaining: 3,
    defaultLanguage: 'es',
    languages: ['en', 'he', 'es'],
    truncated: false,
    invites: [
      { id: 'p1', email: 'pending@example.com', createdAt: '2026-10-01T00:00:00.000Z', linkExpiresAt: '2026-10-31T00:00:00.000Z', status: 'pending', slotReturned: false },
      { id: 'r1', email: 'revoked@example.com', createdAt: '2026-09-20T00:00:00.000Z', linkExpiresAt: '2026-10-20T00:00:00.000Z', status: 'revoked', slotReturned: true },
      { id: 'e1', email: 'expired@example.com', createdAt: '2026-08-01T00:00:00.000Z', linkExpiresAt: '2026-08-31T00:00:00.000Z', status: 'expired', slotReturned: true },
    ],
    ...overrides,
  };
}

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];
let respond: (call: Call) => { status: number; body: unknown };

beforeEach(() => {
  ui.language = 'en';
  ui.isRTL = false;
  calls = [];
  respond = () => ({ status: 200, body: { success: true, data: summary() } });
  global.fetch = jest.fn((url: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    const { status, body } = respond(call);
    return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response);
  }) as unknown as typeof fetch;
});

async function openSection() {
  const user = userEvent.setup();
  render(<InviteFriendsSection />);
  const header = await screen.findByRole('button', { name: INVITE_FRIENDS_COPY.en.sectionTitle });
  await user.click(header);
  return { user, section: screen.getByTestId('invite-friends-section') };
}

describe('renders nothing unless the server says eligible', () => {
  it.each([
    ['{ eligible: false } (switch off, or not a champion)', { status: 200, body: { success: true, data: { eligible: false } } }],
    ['a 401', { status: 401, body: { success: false, error: 'Unauthorized' } }],
    ['a 500', { status: 500, body: { success: false } }],
  ])('%s → no section and no header', async (_label, response) => {
    respond = () => response;
    const { container } = render(<InviteFriendsSection />);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(INVITE_FRIENDS_COPY.en.sectionTitle)).not.toBeInTheDocument();
  });

  it('a network failure → nothing', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    const { container } = render(<InviteFriendsSection />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

describe('an eligible champion', () => {
  it('shows "N of <allowance> left" from the server, and the list with statuses and returned slots', async () => {
    const { section } = await openSection();
    expect(screen.getByTestId('invite-friends-remaining')).toHaveTextContent(`3 of ${ALLOWANCE} invites left`);
    expect(section).toHaveTextContent(INVITE_FRIENDS_COPY.en.intro(ALLOWANCE));

    const pending = screen.getByTestId('invite-friends-row-p1');
    expect(within(pending).getByTestId('invite-friends-status')).toHaveTextContent('Pending');
    expect(within(pending).getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
    expect(pending).not.toHaveTextContent(INVITE_FRIENDS_COPY.en.slotReturned);

    for (const [id, status] of [['r1', 'Revoked'], ['e1', 'Expired']] as const) {
      const rowElement = screen.getByTestId(`invite-friends-row-${id}`);
      expect(within(rowElement).getByTestId('invite-friends-status')).toHaveTextContent(status);
      expect(rowElement).toHaveTextContent(INVITE_FRIENDS_COPY.en.slotReturned);
      expect(within(rowElement).queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
    }
  });

  it('every input has a proper label, and the language defaults to the server’s choice, not the UI language', async () => {
    await openSection();
    expect(screen.getByLabelText(INVITE_FRIENDS_COPY.en.emailLabel)).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText(INVITE_FRIENDS_COPY.en.noteLabel)).toHaveAttribute('maxLength', '1000');
    expect(screen.getByLabelText(INVITE_FRIENDS_COPY.en.languageLabel)).toHaveValue('es');
  });

  it('at 0 left the form is replaced by a plain line', async () => {
    respond = () => ({ status: 200, body: { success: true, data: summary({ remaining: 0 }) } });
    await openSection();
    expect(screen.queryByTestId('invite-friends-form')).not.toBeInTheDocument();
    expect(screen.getByTestId('invite-friends-all-in-use')).toHaveTextContent(INVITE_FRIENDS_COPY.en.allInUse(ALLOWANCE));
  });

  it('sending: posts only email, note and language; shows the link once with a copy button; then refreshes', async () => {
    respond = (call) =>
      call.init?.method === 'POST'
        ? { status: 201, body: { success: true, data: { link: LINK, invite: {}, email: { status: 'sent' } } } }
        : { status: 200, body: { success: true, data: summary() } };

    const { user } = await openSection();
    // After userEvent.setup(), which installs its own clipboard stub.
    const writeText = jest.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await user.type(screen.getByLabelText(INVITE_FRIENDS_COPY.en.emailLabel), 'friend@example.com');
    await user.type(screen.getByLabelText(INVITE_FRIENDS_COPY.en.noteLabel), '  Come and see  ');
    await user.click(screen.getByRole('button', { name: INVITE_FRIENDS_COPY.en.send }));

    const panel = await screen.findByTestId('invite-friends-link');
    expect(within(panel).getByDisplayValue(LINK)).toBeInTheDocument();
    expect(panel).not.toHaveTextContent(INVITE_FRIENDS_COPY.en.emailNotSent);
    await user.click(within(panel).getByRole('button', { name: INVITE_FRIENDS_COPY.en.copyLink }));
    expect(writeText).toHaveBeenCalledWith(LINK);

    const post = calls.find((call) => call.init?.method === 'POST');
    expect(post?.url).toBe('/api/business-os/friend-invites');
    expect(JSON.parse(String(post?.init?.body))).toEqual({ email: 'friend@example.com', language: 'es', personalNote: 'Come and see' });
    // The GET after the send refreshed the count; it never carries a link.
    expect(calls.filter((call) => !call.init?.method)).toHaveLength(2);

    await user.click(within(panel).getByRole('button', { name: INVITE_FRIENDS_COPY.en.dismiss }));
    expect(screen.queryByTestId('invite-friends-link')).not.toBeInTheDocument();
  });

  it('a send whose email failed still shows the link, and says to share it', async () => {
    respond = (call) =>
      call.init?.method === 'POST'
        ? { status: 201, body: { success: true, data: { link: LINK, invite: {}, email: { status: 'not_sent' } } } }
        : { status: 200, body: { success: true, data: summary() } };
    const { user } = await openSection();
    await user.type(screen.getByLabelText(INVITE_FRIENDS_COPY.en.emailLabel), 'friend@example.com');
    await user.click(screen.getByRole('button', { name: INVITE_FRIENDS_COPY.en.send }));
    const panel = await screen.findByTestId('invite-friends-link');
    expect(panel).toHaveTextContent(INVITE_FRIENDS_COPY.en.emailNotSent);
  });

  it.each([
    ['allowance_reached', 409],
    ['already_invited', 409],
    ['own_email', 409],
    ['daily_limit', 429],
  ] as const)('a %s refusal reads in plain words, with the allowance interpolated', async (code, status) => {
    respond = (call) =>
      call.init?.method === 'POST'
        ? { status, body: { success: false, error: code, message: 'server words' } }
        : { status: 200, body: { success: true, data: summary() } };
    const { user } = await openSection();
    await user.type(screen.getByLabelText(INVITE_FRIENDS_COPY.en.emailLabel), 'friend@example.com');
    await user.click(screen.getByRole('button', { name: INVITE_FRIENDS_COPY.en.send }));
    expect(await screen.findByTestId('invite-friends-error')).toHaveTextContent(INVITE_FRIENDS_COPY.en.errors[code](ALLOWANCE));
    expect(screen.queryByTestId('invite-friends-link')).not.toBeInTheDocument();
  });

  it('revoke asks for confirmation first, then posts to the revoke route and refreshes', async () => {
    respond = (call) =>
      call.init?.method === 'POST'
        ? { status: 200, body: { success: true, data: { revoked: true } } }
        : { status: 200, body: { success: true, data: summary() } };
    const { user } = await openSection();
    const pending = screen.getByTestId('invite-friends-row-p1');
    await user.click(within(pending).getByRole('button', { name: 'Revoke' }));
    expect(calls.some((call) => call.init?.method === 'POST')).toBe(false);
    expect(pending).toHaveTextContent(INVITE_FRIENDS_COPY.en.revokeConfirm('pending@example.com'));

    await user.click(within(pending).getByRole('button', { name: INVITE_FRIENDS_COPY.en.revokeYes }));
    await waitFor(() => expect(calls.filter((call) => !call.init?.method)).toHaveLength(2));
    expect(calls.find((call) => call.init?.method === 'POST')?.url).toBe('/api/business-os/friend-invites/p1/revoke');
  });

  it('Slice 5b (F5b-7): a joined friend reads "Signed up — not subscribed yet", in every language, with no Revoke', async () => {
    const joined = { id: 'j1', email: 'joined@example.com', createdAt: '2026-09-25T00:00:00.000Z', linkExpiresAt: '2026-10-25T00:00:00.000Z', status: 'joined', slotReturned: false };
    respond = () => ({ status: 200, body: { success: true, data: summary({ invites: [joined] }) } });
    await openSection();
    const row = screen.getByTestId('invite-friends-row-j1');
    expect(within(row).getByTestId('invite-friends-status')).toHaveTextContent('Signed up — not subscribed yet');
    expect(within(row).queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
    expect(row).not.toHaveTextContent(INVITE_FRIENDS_COPY.en.slotReturned);
    expect(INVITE_FRIENDS_COPY.he.status.joined).toBe('נרשם — עדיין ללא מנוי');
    expect(INVITE_FRIENDS_COPY.es.status.joined).toBe('Registrado — aún sin suscripción');
  });

  it('Slice 5b: a revoke answered 409 already_used (the friend signed up meanwhile) says so and refreshes', async () => {
    respond = (call) =>
      call.init?.method === 'POST'
        ? { status: 409, body: { success: false, error: 'already_used' } }
        : { status: 200, body: { success: true, data: summary() } };
    const { user } = await openSection();
    const pending = screen.getByTestId('invite-friends-row-p1');
    await user.click(within(pending).getByRole('button', { name: 'Revoke' }));
    await user.click(within(pending).getByRole('button', { name: INVITE_FRIENDS_COPY.en.revokeYes }));
    expect(await screen.findByText(INVITE_FRIENDS_COPY.en.revokeFailed)).toBeInTheDocument();
    await waitFor(() => expect(calls.filter((call) => !call.init?.method)).toHaveLength(2));
  });

  it('cancelling a revoke sends nothing', async () => {
    const { user } = await openSection();
    const pending = screen.getByTestId('invite-friends-row-p1');
    await user.click(within(pending).getByRole('button', { name: 'Revoke' }));
    await user.click(within(pending).getByRole('button', { name: INVITE_FRIENDS_COPY.en.cancel }));
    expect(calls.some((call) => call.init?.method === 'POST')).toBe(false);
  });

  it('Hebrew: right-to-left, in Hebrew', async () => {
    ui.language = 'he';
    ui.isRTL = true;
    render(<InviteFriendsSection />);
    const header = await screen.findByRole('button', { name: INVITE_FRIENDS_COPY.he.sectionTitle });
    expect(screen.getByTestId('invite-friends-section')).toHaveAttribute('dir', 'rtl');
    await userEvent.setup().click(header);
    expect(screen.getByTestId('invite-friends-remaining')).toHaveTextContent(INVITE_FRIENDS_COPY.he.remaining(3, ALLOWANCE));
  });
});

describe('the copy and the source', () => {
  it('no sentence in any language writes the allowance as a number (R-7)', () => {
    for (const locale of ['en', 'he', 'es'] as const) {
      const copy = INVITE_FRIENDS_COPY[locale];
      expect(copy.intro(ALLOWANCE)).toContain(String(ALLOWANCE));
      expect(copy.allInUse(ALLOWANCE)).toContain(String(ALLOWANCE));
      expect(copy.remaining(2, ALLOWANCE)).toContain(String(ALLOWANCE));
      expect(copy.intro(ALLOWANCE)).not.toMatch(/\b5\b/);
    }
  });

  it('the section and its copy import nothing from the entitlements module and name no plan id', () => {
    for (const file of ['InviteFriendsSection.tsx', 'inviteFriendsCopy.ts']) {
      const source = readFileSync(join(process.cwd(), 'components', 'business-os', 'settings', file), 'utf8');
      expect(source).not.toMatch(/business-os\/entitlements/);
      expect(source).not.toMatch(/['"`](basic|pro|trial|champion)['"`]/);
    }
  });
});
