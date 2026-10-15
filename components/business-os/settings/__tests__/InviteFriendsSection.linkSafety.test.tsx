/**
 * @jest-environment jsdom
 *
 * "Invite friends" in the settings drawer: the one-time link's safety (settings
 * drawer review S-4; Q-5 (a), SA-2, SA-5, C-4, C-6).
 *
 * The link from a send is a credential and is never re-fetchable. Pinned here:
 * it survives closing and reopening the drawer (until Dismiss or leaving the
 * page); a closed drawer keeps no hidden copy of it in the DOM; it never reaches
 * the address, browser storage, a log call or the console; the drawer refuses
 * to close while a send or a revoke is in flight; the champion email's anchor
 * stays on the always-rendered row; the fetch still runs on page load.
 *
 * Real `SettingsDrawer` and Radix sheet. `fetch` is a stand-in that can hold a
 * request in flight; the logger records every call, so "never logged" is
 * checked against what was actually logged.
 */

import '@testing-library/jest-dom';
import { readFileSync } from 'fs';
import { join } from 'path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/lib/business-os/LanguageContext', () => ({
  useLanguage: () => ({ language: 'en', isRTL: false, t: (key: string) => key }),
}));

const mockLogCalls: unknown[][] = [];
jest.mock('@/lib/logger', () => {
  const record = (...args: unknown[]) => {
    mockLogCalls.push(args);
  };
  const logger = { error: record, warn: record, info: record, debug: record, trace: record, fatal: record };
  return { ...jest.requireActual('@/lib/logger'), createLogger: () => ({ ...logger, child: () => logger }) };
});

import { InviteFriendsSection } from '@/components/business-os/settings/InviteFriendsSection';
import { INVITE_FRIENDS_COPY } from '@/components/business-os/settings/inviteFriendsCopy';

// Real drawer animations and character-by-character typing; generous, as the render suite.
jest.setTimeout(30_000);

const TOKEN = 'SECRETTOKEN0123456789abcdefSECRETTOKEN0123';
const LINK = `https://app.example.test/invite#t=${TOKEN}`;
const ALLOWANCE = 7;
const EN = INVITE_FRIENDS_COPY.en;

function summary() {
  return {
    eligible: true,
    allowance: ALLOWANCE,
    remaining: 3,
    defaultLanguage: 'en',
    languages: ['en', 'he', 'es'],
    truncated: false,
    invites: [
      { id: 'p1', email: 'pending@example.com', createdAt: '2026-10-01T00:00:00.000Z', linkExpiresAt: '2026-10-31T00:00:00.000Z', status: 'pending', slotReturned: false },
    ],
  };
}

type Call = { url: string; init?: RequestInit };
type Answer = { status: number; body: unknown };
let calls: Call[] = [];
let respond: (call: Call) => Answer | Promise<Answer>;

/** A POST answer the test releases by hand, to hold a request in flight. */
function deferred() {
  let release: (answer: Answer) => void = () => undefined;
  const promise = new Promise<Answer>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const sendOk: Answer = { status: 201, body: { success: true, data: { link: LINK, invite: {}, email: { status: 'sent' } } } };
const listOk: Answer = { status: 200, body: { success: true, data: summary() } };

let consoleSpies: jest.SpyInstance[] = [];
let setItemSpy: jest.SpyInstance;
let pushStateSpy: jest.SpyInstance;
let replaceStateSpy: jest.SpyInstance;
let hrefBefore = '';

beforeEach(() => {
  calls = [];
  mockLogCalls.length = 0;
  respond = (call) => (call.init?.method === 'POST' ? sendOk : listOk);
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    const { status, body } = await respond(call);
    return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response;
  }) as unknown as typeof fetch;

  localStorage.clear();
  sessionStorage.clear();
  setItemSpy = jest.spyOn(Storage.prototype, 'setItem');
  pushStateSpy = jest.spyOn(window.history, 'pushState');
  replaceStateSpy = jest.spyOn(window.history, 'replaceState');
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    jest.spyOn(console, method).mockImplementation(() => undefined)
  );
  hrefBefore = window.location.href;
});

afterEach(() => {
  setItemSpy.mockRestore();
  pushStateSpy.mockRestore();
  replaceStateSpy.mockRestore();
  consoleSpies.forEach((spy) => spy.mockRestore());
});

/** Everything a call carried, errors included (a plain JSON.stringify drops an Error's message). */
function serialise(value: unknown): string {
  return JSON.stringify(value, (_key, inner) =>
    inner instanceof Error ? { message: inner.message, stack: inner.stack } : inner
  );
}

function expectLinkNowhereOutsideTheDrawer() {
  expect(window.location.href).toBe(hrefBefore);
  expect(window.location.href).not.toContain(TOKEN);
  expect(pushStateSpy).not.toHaveBeenCalled();
  expect(replaceStateSpy).not.toHaveBeenCalled();

  expect(setItemSpy).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);

  for (const args of mockLogCalls) expect(serialise(args)).not.toContain(TOKEN);
  for (const spy of consoleSpies) {
    for (const args of spy.mock.calls) expect(serialise(args)).not.toContain(TOKEN);
  }
}

function row() {
  return screen.getByRole('button', { name: (name) => name.startsWith(EN.sectionTitle) });
}

const drawer = () => screen.queryByTestId('settings-invite-drawer');

async function renderRow() {
  const user = userEvent.setup();
  render(<InviteFriendsSection />);
  await screen.findByRole('button', { name: (name) => name.startsWith(EN.sectionTitle) });
  return user;
}

async function openDrawer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(row());
  return screen.findByTestId('settings-invite-drawer');
}

async function closeWithX(user: ReturnType<typeof userEvent.setup>) {
  await user.click(within(drawer() as HTMLElement).getByRole('button', { name: 'common.close' }));
  await waitFor(() => expect(drawer()).not.toBeInTheDocument());
}

async function sendInvite(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(EN.emailLabel), 'friend@example.com');
  await user.click(screen.getByRole('button', { name: EN.send }));
}

describe('the row (always on the page, C-6, C-8)', () => {
  it('L-1: loads on page load, shows "N left" on the row, and announces a dialog; the drawer is closed', async () => {
    await renderRow();
    expect(calls).toHaveLength(1);
    expect(calls[0].init?.method).toBeUndefined();
    expect(screen.getByTestId('invite-friends-row-value')).toHaveTextContent(EN.remaining(3, ALLOWANCE));
    expect(row()).toHaveAttribute('aria-haspopup', 'dialog');
    expect(row()).toHaveAttribute('aria-expanded', 'false');
    expect(drawer()).not.toBeInTheDocument();
  });

  it('L-2: the champion email anchor stays on the row, closed or open, never inside the drawer', async () => {
    const user = await renderRow();
    const anchor = document.getElementById('settings-section-invite-friends');
    const opener = row();
    expect(anchor).not.toBeNull();
    expect(anchor).toContainElement(opener);

    const opened = await openDrawer(user);
    expect(document.querySelectorAll('#settings-section-invite-friends')).toHaveLength(1);
    expect(document.getElementById('settings-section-invite-friends')).toBe(anchor);
    expect(opened).not.toContainElement(anchor);
    // The modal sheet hides the page from the accessibility tree, so the row is held, not re-queried.
    expect(opener).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('the one-time link (Q-5 (a), C-6)', () => {
  it('L-3: survives closing with the X and reopening from the row', async () => {
    const user = await renderRow();
    await openDrawer(user);
    await sendInvite(user);
    expect(within(await screen.findByTestId('invite-friends-link')).getByDisplayValue(LINK)).toBeInTheDocument();

    await closeWithX(user);
    await openDrawer(user);
    expect(within(screen.getByTestId('invite-friends-link')).getByDisplayValue(LINK)).toBeInTheDocument();
    expectLinkNowhereOutsideTheDrawer();
  });

  it('L-4: survives Escape; a closed drawer keeps no hidden copy of the link in the DOM', async () => {
    const user = await renderRow();
    const opened = await openDrawer(user);
    await sendInvite(user);
    await screen.findByTestId('invite-friends-link');

    fireEvent.keyDown(opened, { key: 'Escape' });
    await waitFor(() => expect(drawer()).not.toBeInTheDocument());
    expect(screen.queryByDisplayValue(LINK)).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(TOKEN);

    await openDrawer(user);
    expect(screen.getByDisplayValue(LINK)).toBeInTheDocument();
  });

  it('L-5 / L-6 / L-7: never in the address, browser storage, a log call or the console, through send, a failed copy and a close', async () => {
    const user = await renderRow();
    await openDrawer(user);
    await sendInvite(user);
    const panel = await screen.findByTestId('invite-friends-link');

    // A copy that fails is the one path that logs while the link is in hand.
    const writeText = jest.fn(() => Promise.reject(new Error('denied')));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await user.click(within(panel).getByRole('button', { name: EN.copyLink }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LINK));
    await waitFor(() => expect(mockLogCalls.length).toBeGreaterThan(0));

    await closeWithX(user);
    await openDrawer(user);
    expectLinkNowhereOutsideTheDrawer();
  });

  it('L-11: Dismiss clears it, and reopening shows no link', async () => {
    const user = await renderRow();
    await openDrawer(user);
    await sendInvite(user);
    const panel = await screen.findByTestId('invite-friends-link');
    await user.click(within(panel).getByRole('button', { name: EN.dismiss }));
    expect(screen.queryByTestId('invite-friends-link')).not.toBeInTheDocument();

    await closeWithX(user);
    await openDrawer(user);
    expect(screen.queryByTestId('invite-friends-link')).not.toBeInTheDocument();
  });

  it('L-15: a new mount of the section starts with no link (leaving the page clears it, Q-5 (a))', async () => {
    const user = userEvent.setup();
    const first = render(<InviteFriendsSection />);
    await screen.findByRole('button', { name: (name) => name.startsWith(EN.sectionTitle) });
    await openDrawer(user);
    await sendInvite(user);
    expect(within(await screen.findByTestId('invite-friends-link')).getByDisplayValue(LINK)).toBeInTheDocument();
    first.unmount();
    expect(document.body.innerHTML).not.toContain(TOKEN);

    // A fresh page visit: new fetch answers, a new mount, nothing carried from the last one.
    calls = [];
    respond = (call) => (call.init?.method === 'POST' ? sendOk : listOk);
    render(<InviteFriendsSection />);
    await screen.findByRole('button', { name: (name) => name.startsWith(EN.sectionTitle) });
    await openDrawer(user);
    expect(screen.queryByTestId('invite-friends-link')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(LINK)).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(TOKEN);
    expect(calls.filter((call) => call.init?.method === 'POST')).toHaveLength(0);
  });
});

describe('no close while a request is in flight (C-4)', () => {
  it('L-8: while sending, the X is disabled and X, Escape and an outside press keep it open; after the answer it closes', async () => {
    const held = deferred();
    respond = (call) => (call.init?.method === 'POST' ? held.promise : listOk);
    const user = await renderRow();
    const opened = await openDrawer(user);
    await sendInvite(user);

    const close = within(opened).getByRole('button', { name: 'common.close' });
    expect(close).toBeDisabled();
    fireEvent.click(close);
    fireEvent.keyDown(opened, { key: 'Escape' });
    fireEvent.pointerDown(document.body);
    expect(drawer()).toBeInTheDocument();

    await act(async () => {
      held.release(sendOk);
    });
    await screen.findByTestId('invite-friends-link');
    expect(close).not.toBeDisabled();
    await closeWithX(user);
  });

  it('L-9: while a revoke is in flight, Escape and the X do not close it', async () => {
    const held = deferred();
    respond = (call) => (call.init?.method === 'POST' ? held.promise : listOk);
    const user = await renderRow();
    const opened = await openDrawer(user);
    const pending = screen.getByTestId('invite-friends-row-p1');
    await user.click(within(pending).getByRole('button', { name: EN.revoke }));
    await user.click(within(pending).getByRole('button', { name: EN.revokeYes }));

    const close = within(opened).getByRole('button', { name: 'common.close' });
    expect(close).toBeDisabled();
    fireEvent.keyDown(opened, { key: 'Escape' });
    expect(drawer()).toBeInTheDocument();

    await act(async () => {
      held.release({ status: 200, body: { success: true, data: { revoked: true } } });
    });
    await waitFor(() => expect(close).not.toBeDisabled());
  });
});

describe('what a close resets, and what it keeps', () => {
  it('L-10: an open revoke confirmation is gone on reopen; the link is kept', async () => {
    const user = await renderRow();
    await openDrawer(user);
    await sendInvite(user);
    await screen.findByTestId('invite-friends-link');
    const pending = screen.getByTestId('invite-friends-row-p1');
    await user.click(within(pending).getByRole('button', { name: EN.revoke }));
    expect(pending).toHaveTextContent(EN.revokeConfirm('pending@example.com'));

    await closeWithX(user);
    await openDrawer(user);
    const reopened = screen.getByTestId('invite-friends-row-p1');
    expect(reopened).not.toHaveTextContent(EN.revokeConfirm('pending@example.com'));
    expect(within(reopened).getByRole('button', { name: EN.revoke })).toBeInTheDocument();
    expect(screen.getByDisplayValue(LINK)).toBeInTheDocument();
  });

  it('L-10b: a refusal message does not come back on reopen', async () => {
    respond = (call) =>
      call.init?.method === 'POST' ? { status: 409, body: { success: false, error: 'already_invited' } } : listOk;
    const user = await renderRow();
    await openDrawer(user);
    await sendInvite(user);
    await screen.findByTestId('invite-friends-error');

    await closeWithX(user);
    await openDrawer(user);
    expect(screen.queryByTestId('invite-friends-error')).not.toBeInTheDocument();
  });

  it('L-12: the typed draft survives a close, and closing with a draft asks nothing', async () => {
    const user = await renderRow();
    await openDrawer(user);
    await user.type(screen.getByLabelText(EN.emailLabel), 'half@example.com');

    await closeWithX(user);
    expect(screen.queryByTestId('settings-drawer-discard')).not.toBeInTheDocument();
    await openDrawer(user);
    expect(screen.getByLabelText(EN.emailLabel)).toHaveValue('half@example.com');
  });

  it('L-13: focus returns to the row on close', async () => {
    const user = await renderRow();
    await openDrawer(user);
    await closeWithX(user);
    await waitFor(() => expect(row()).toHaveFocus());
  });
});

describe('the source (C-6)', () => {
  const raw = readFileSync(
    join(process.cwd(), 'components', 'business-os', 'settings', 'InviteFriendsSection.tsx'),
    'utf8'
  );
  // Comments explain the rules in words; only code is checked.
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('L-14: no forceMount, no browser storage, no address writes, no router, no console', () => {
    expect(code).not.toMatch(/forceMount/);
    expect(code).not.toMatch(/localStorage|sessionStorage/);
    expect(code).not.toMatch(/history\./);
    expect(code).not.toMatch(/useRouter|useSearchParams|next\/navigation/);
    expect(code).not.toMatch(/console\./);
  });

  it('L-14b: every log call carries only `{ err }`', () => {
    const contexts = [...code.matchAll(/logger\.\w+\(\s*\{([^}]*)\}/g)].map((match) => match[1].trim());
    expect(contexts.length).toBeGreaterThan(0);
    for (const context of contexts) expect(context).toBe('err: error');
    // The messages may say "link" in words; no argument may NAME the link or `sent`.
    const argumentsOnly = [...code.matchAll(/logger\.\w+\(([^;]*)\);/g)].map((match) =>
      match[1].replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''")
    );
    expect(argumentsOnly.length).toBe(contexts.length);
    for (const args of argumentsOnly) expect(args).not.toMatch(/\b(sent|link)\b/);
  });

  it('L-14c: no module-level mutable holder the link could outlive a mount in', () => {
    // Top level (column 0) only: `let`/`var`, or a `const` bound to an object, array, Map/Set or ref.
    expect(code).not.toMatch(/^(?:export\s+)?(?:let|var)\s/m);
    expect(code).not.toMatch(/^(?:export\s+)?const\s+\w+(?:\s*:[^=]+)?=\s*(?:\{|\[|new\s|createRef\b)/m);
  });

  it('the drawer is rendered by this component, not lifted to the page', () => {
    expect(code).toMatch(/<SettingsDrawer[\s\S]*testId="settings-invite-drawer"/);
    const page = readFileSync(join(process.cwd(), 'app', 'business-os', 'settings', 'page.tsx'), 'utf8');
    expect(page).toMatch(/<InviteFriendsSection \/>/);
    expect(page).not.toMatch(/settings-invite-drawer/);
  });
});
