/**
 * @jest-environment jsdom
 */

/**
 * Businesses on the Admin Layout Standard (slice L-4b, the row detail): one
 * page-level `AdminDrawer` keyed by the open account, opened by the row's Open
 * button or a click anywhere on the row (user decision D-17), the three detail
 * reads on `readJsonBody` (per-section failures), the audit section collapsed
 * by default with its fold always mounted (SA M-2), the dialogs inside the
 * drawer (Escape closes the top layer only), and the danger area never mounted
 * while the drawer is closed. D-1 to D-24 of the L-4b workplan.
 *
 * jsdom like the sibling suites (Playwright is not installed: CLAUDE.md
 * § Testing). Every request is recorded with its method, so "no POST" and
 * "no request" are pinned, not assumed.
 */

import React from 'react';
import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  }),
  // LF-F3: the page logs through `clientLogger.child`; `@/lib/logger/client` re-exports it from this module.
  clientLogger: { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) },
}));

let mockSearch = '';
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

import UsersPage from '../page';
import recordedAccountBody from '@/app/admin/business-os-tiers/__tests__/__fixtures__/recordedAccountBody.json';

// As the pin files (SA F2 on LF-4a.2; SA ruling on LF-4c, check 8): the whole
// page under a parallel Jest run can take more than RTL's 1 s default to
// settle. Both limits are raised, so the longer wait does not just hit Jest's
// 5 s test timeout. A longer wait cannot make a wrong result pass; it only stops a slow machine failing a correct one.
jest.setTimeout(30_000);
configure({ asyncUtilTimeout: 5000 });

const DANA_ID = '99999999-9999-4999-8999-999999999999';
const OREN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NONAME_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const DANA = {
  id: DANA_ID, full_name: 'Dana Cohen', company: 'Cohen Clinic', email: 'dana@example.com', email_confirmed: true,
  phone: '050-0000000', last_sign_in_at: null, created_at: '2026-09-01T00:00:00Z', providers: ['email'],
  role: 'authenticated', business: { companyName: 'Acme Therapy', vertical: 'therapist' },
  creditsLeft: { kind: 'percent', value: 40, trial: false },
};

const OREN = {
  id: OREN_ID, full_name: 'Oren Levi', company: null, email: 'oren@example.com', email_confirmed: false,
  last_sign_in_at: '2026-10-10T08:05:00Z', created_at: '2026-08-01T00:00:00Z', providers: [], role: 'authenticated',
  business: null,
};

const NONAME = {
  id: NONAME_ID, full_name: null, company: null, email: 'nobody@example.com', email_confirmed: true,
  last_sign_in_at: null, created_at: '2026-07-01T00:00:00Z', providers: [], role: 'authenticated', business: null,
};

const LOGIN_STATS = { success: true, data: { total_logins: 1, failed_logins: 2, unique_ips: 1, last_login_ip: '10.0.0.1' } };

const AUDIT = {
  success: true,
  data: [
    { id: 'a1', action: 'USER_LOGIN', entity_type: 'user', resource_name: null, changes: null, details: null, ip_address: '10.0.0.1', severity: 'info', compliance_flags: [], created_at: '2026-10-10T09:00:00.000Z' },
    { id: 'a2', action: 'PASSWORD_CHANGED', entity_type: 'user', resource_name: 'Password', changes: null, details: null, ip_address: null, severity: 'warning', compliance_flags: ['SOC2'], created_at: '2026-10-09T08:00:00.000Z' },
    { id: 'a3', action: 'SETTINGS_UPDATED', entity_type: 'user', resource_name: null, changes: null, details: null, ip_address: null, severity: 'critical', compliance_flags: [], created_at: '2026-10-08T07:00:00.000Z' },
  ],
};

const STATS = {
  success: true,
  data: {
    tokens: {
      total_input_tokens: 1200, total_output_tokens: 300, total_cost_usd: 0.4321, total_calls: 7,
      by_model: [{ model: 'openai/gpt-x', input: 1200, output: 300, cost: 0.4321, calls: 7 }],
    },
    plugins: {
      total: 2,
      active: 1,
      list: [
        { plugin: 'google-mail', connected_at: '2026-09-01T00:00:00Z', is_active: true },
        { plugin: 'slack', connected_at: '2026-09-02T00:00:00Z', is_active: false },
      ],
    },
  },
};

const SUMMARY = {
  success: true,
  data: {
    accountId: DANA_ID,
    business: { status: 'ok', companyName: 'Acme Therapy', vertical: 'therapist', subVertical: 'family_therapist' },
    aiSpend30d: {
      status: 'complete', currency: 'USD', readCeiling: 5000,
      window: { start: '2026-08-26T00:00:00.000Z', end: '2026-09-25T00:00:00.000Z' },
      total: { calls: 0, tokens: 0, estimatedCostUsd: 0 }, lines: [],
    },
    recentAiFailures: { status: 'ok', window: { start: '2026-08-26T00:00:00.000Z', end: '2026-09-25T00:00:00.000Z' }, limit: 10, items: [] },
  },
};

const CREDITS = {
  success: true,
  data: {
    accountId: DANA_ID,
    isOwnAccount: false,
    limits: { grantCeiling: 100000, reasonMin: 3, reasonMax: 500 },
    usage: {
      status: 'ok',
      period: { kind: 'monthly', key: '2026-09-14T09:31:07.123456+00:00', resetsOn: '2026-10-14T09:31:07.123Z' },
      allowanceStatus: 'ok', allowance: { amount: 5000, per: 'month' }, allowanceLayer: 'basis',
      used: 12, usedByOwner: 10, usedAutomatic: 2, planLeft: 4988, overPlan: 0,
    },
    extra: { status: 'ok', extraCredits: 0, hasInconsistentLot: false, lots: [] },
  },
};

const BOOST = {
  success: true,
  data: {
    accountId: DANA_ID,
    isOwnAccount: false,
    serverMode: 'test',
    purchases: { status: 'ok', rows: [], truncated: { test: false, live: false } },
    cap: { status: 'ok', default: { amountMinor: 15000, currency: 'USD', windowDays: 30 }, active: null, history: [] },
    limits: { minMinor: 100, maxMinor: 150000, stepMinor: 100, currency: 'USD', windowDays: 30, reasonMin: 3, reasonMax: 500 },
  },
};

const ARCHIVING = { success: true, data: { sources: [{ key: 'audit_trail', latestCutoff: '2026-01-01T00:00:00.000Z' }] } };

interface ResponseLike {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

const json = (status: number, body: unknown): ResponseLike => ({ ok: status < 400, status, json: async () => body });

/** An `ok` answer whose body is an HTML page: `json()` throws a parser error. */
const htmlOk = (): ResponseLike => ({
  ok: true,
  status: 200,
  json: async () => {
    throw new SyntaxError("Unexpected token '<'");
  },
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** The list rows; set per test. */
let listRows: unknown[];
/** A failing list read (D-10). */
let listFails = false;
/** Per-test overrides for the three detail reads, by suffix. */
let detailAnswer: Partial<Record<'login-stats' | 'audit-logs' | 'stats', () => ResponseLike>>;
/** While set, the three detail reads wait for it (D-3's loading state). */
let detailGate: Promise<void> | null = null;

const calls: Array<{ url: string; method: string }> = [];

function route(url: string): ResponseLike {
  if (url.startsWith('/api/admin/users?')) {
    if (listFails) return json(500, { success: false, error: 'Failed to fetch users' });
    return json(200, { success: true, data: listRows, stats: { totalUsers: listRows.length, activeUsers: 0, newUsersToday: 0 } });
  }
  for (const section of ['login-stats', 'audit-logs', 'stats'] as const) {
    if (/^\/api\/admin\/users\/[^/]+\//.test(url) && url.endsWith(`/${section}`)) {
      const override = detailAnswer[section];
      if (override) return override();
      if (section === 'login-stats') return json(200, LOGIN_STATS);
      if (section === 'audit-logs') return json(200, AUDIT);
      return json(200, STATS);
    }
  }
  if (url.includes('/api/admin/business-os/entitlements/accounts/')) return json(200, recordedAccountBody);
  if (url.includes('/api/admin/business-os/accounts/') && url.endsWith('/summary')) return json(200, SUMMARY);
  if (url.endsWith('/boost') && url.includes('/credits/accounts/')) return json(200, BOOST);
  if (url.includes('/api/admin/business-os/credits/accounts/')) return json(200, CREDITS);
  if (url === '/api/admin/archiving') return json(200, ARCHIVING);
  if (url === '/api/admin/test-account-cleanup/check') return json(200, { success: true, data: { configured: true } });
  return json(404, { success: false, error: 'not mocked' });
}

function mockFetch(): jest.Mock {
  const fetchMock = jest.fn(async (input: string, init?: { method?: string }) => {
    const url = String(input);
    calls.push({ url, method: (init?.method ?? 'GET').toUpperCase() });
    if (detailGate && /\/(login-stats|audit-logs|stats)$/.test(url) && !url.startsWith('/api/admin/users?')) await detailGate;
    return route(url);
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
  return fetchMock;
}

const count = (suffix: string) => calls.filter((c) => c.url.endsWith(suffix)).length;
const detailReads = (id: string) => ({
  login: count(`/api/admin/users/${id}/login-stats`),
  audit: count(`/api/admin/users/${id}/audit-logs`),
  stats: count(`/api/admin/users/${id}/stats`),
});
const posts = () => calls.filter((c) => c.method !== 'GET');

const content = () => screen.getByTestId('users-content');
/** Radix hides the page from role queries while the modal drawer is open. */
const refreshButton = () =>
  screen.getByRole('button', { name: 'Refresh the business list', hidden: true }) as HTMLButtonElement;
const openButtonFor = (name: string) =>
  screen.getByRole('button', { name: `Open details for ${name}`, hidden: true }) as HTMLButtonElement;
const rowOf = (name: string) => openButtonFor(name).closest('tr') as HTMLTableRowElement;

async function renderPage() {
  mockFetch();
  render(<UsersPage />);
  await screen.findAllByTestId('row-business');
}

/** Open through the button and wait for the body (the detail reads have settled). */
async function openWithButton(name: string): Promise<HTMLElement> {
  fireEvent.click(openButtonFor(name));
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByTestId('danger-area');
  return dialog;
}

async function closeWithEscape() {
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

function expectInOrder(nodes: Element[]) {
  for (let i = 1; i < nodes.length; i++) {
    expect(nodes[i - 1].compareDocumentPosition(nodes[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
}

beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.releasePointerCapture ??= () => undefined;
  proto.scrollIntoView ??= () => undefined;
});

beforeEach(() => {
  jest.clearAllMocks();
  calls.length = 0;
  listRows = [DANA, OREN, NONAME];
  listFails = false;
  detailAnswer = {};
  detailGate = null;
  mockSearch = '';
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
  });
});

describe('D-1 / D-2 / D-17 the closed page', () => {
  it('D-1: on mount there is no dialog, no danger area, no cleanup panel and no Business OS panel anywhere', async () => {
    await renderPage();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('danger-area')).toBeNull();
    expect(screen.queryByTestId('test-account-cleanup-panel')).toBeNull();
    expect(screen.queryByTestId('bos-panel')).toBeNull();
  });

  it('D-2: each first cell holds one Open button; the row has no tabindex and no role; six headers', async () => {
    await renderPage();
    const button = screen.getByRole('button', { name: 'Open details for Dana Cohen' });
    expect(button.textContent).toBe('Open');
    const firstCell = button.closest('td') as HTMLTableCellElement;
    expect(firstCell.cellIndex).toBe(0);
    expect(within(firstCell).getAllByRole('button')).toHaveLength(1);
    for (const tr of screen.getAllByTestId('row-business').map((p) => p.closest('tr') as HTMLTableRowElement)) {
      expect(tr.hasAttribute('tabindex')).toBe(false);
      expect(tr.hasAttribute('role')).toBe(false);
    }
    expect(screen.getAllByRole('columnheader')).toHaveLength(6);
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).toBeNull();
  });

  it('D-17: closing the drawer unmounts the cleanup panel, as collapsing the row did', async () => {
    await renderPage();
    const dialog = await openWithButton('Dana Cohen');
    expect(within(dialog).getByTestId('test-account-cleanup-panel')).toBeTruthy();
    await closeWithEscape();
    expect(screen.queryByTestId('test-account-cleanup-panel')).toBeNull();
    expect(screen.queryByTestId('danger-area')).toBeNull();
  });
});

describe('D-3 / D-4 / D-5 opening', () => {
  it('D-3: one dialog named for the business; one request per read; the loading line; the blocks in order', async () => {
    const gate = deferred();
    detailGate = gate.promise;
    await renderPage();
    fireEvent.click(openButtonFor('Dana Cohen'));
    const dialog = await screen.findByRole('dialog', { name: 'Acme Therapy 99999999…' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(within(dialog).getByText('Reading the business details…')).toBeTruthy();

    await act(async () => gate.resolve());
    await within(dialog).findByTestId('danger-area');
    expect(detailReads(DANA_ID)).toEqual({ login: 1, audit: 1, stats: 1 });
    await waitFor(() => expect(count('/api/admin/archiving')).toBe(1));

    // LF-4a.2 (BD-4): strip, then Credits & billing, Plan & entitlements, AI usage
    // (All products last in it), Account & security (plugins last in it),
    // Activity, and the danger area last. Both money blocks' reads have landed
    // before the assertions (SA optimisation: no late act() warning).
    await within(dialog).findByTestId('credits-block');
    await waitFor(() => expect(within(dialog).queryByText('Loading credits…')).toBeNull());
    await within(dialog).findByTestId('boost-cap');
    expectInOrder([
      within(dialog).getByTestId('bos-panel'),
      within(dialog).getByTestId('drawer-strip'),
      within(dialog).getByRole('group', { name: 'Credits & billing' }),
      within(dialog).getByRole('group', { name: 'Plan & entitlements' }),
      within(dialog).getByRole('group', { name: 'AI usage' }),
      within(dialog).getByTestId('ai-spend-card'),
      within(dialog).getByRole('group', { name: 'Account & security' }),
      within(dialog).getByTestId('account-login-stats'),
      within(dialog).getByTestId('plugins-card'),
      within(dialog).getByTestId('detail-audit'),
      within(dialog).getByTestId('danger-area'),
    ]);
    expect(within(dialog).getByRole('group', { name: 'Activity' })).toBe(within(dialog).getByTestId('detail-audit'));
  });

  it('D-4: a row with no business is titled by the person; a row with no name by the email', async () => {
    await renderPage();
    fireEvent.click(openButtonFor('Oren Levi'));
    expect(await screen.findByRole('dialog', { name: 'Oren Levi aaaaaaaa…' })).toBeTruthy();
    await closeWithEscape();
    fireEvent.click(openButtonFor('nobody@example.com'));
    expect(await screen.findByRole('dialog', { name: 'nobody@example.com cccccccc…' })).toBeTruthy();
  });

  it('D-5: the timeline shows UTC times with an age line, "Never" for no sign-in, and no locale date', async () => {
    await renderPage();
    const dialog = await openWithButton('Dana Cohen');
    const created = within(dialog).getByTestId('detail-created');
    const lines = Array.from(created.querySelectorAll('span')).map((s) => s.textContent);
    expect(lines[0]).toBe('2026-09-01 00:00 UTC');
    expect(lines[1]).toMatch(/^(Just now|\d+h ago|\d+d ago)$/);
    expect(within(dialog).getByTestId('detail-last-sign-in').textContent).toBe('Never');
    // LF-4a.2 (BD-10): the timeline fields are in the Account & security section.
    const timeline = within(dialog).getByRole('group', { name: 'Account & security' });
    expect(timeline.textContent).not.toContain(new Date('2026-09-01T00:00:00Z').toLocaleDateString());
  });
});

describe('D-6 / D-7 the audit section (user request: collapsed by default; SA M-2)', () => {
  it('D-6: collapsed by default with the fold mounted but hidden; expanding and collapsing send no request', async () => {
    await renderPage();
    const dialog = await openWithButton('Dana Cohen');
    // Let every read of the open drawer settle first (the panel's, the archive cutoff's).
    await within(dialog).findByTestId('credits-block');
    await within(dialog).findByTestId('boost-cap');
    await waitFor(() => expect(count('/api/admin/archiving')).toBe(1));
    await act(async () => undefined);

    const toggle = within(dialog).getByTestId('detail-audit-toggle');
    expect(toggle.textContent).toBe('Show audit events');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const fold = document.getElementById(toggle.getAttribute('aria-controls') as string) as HTMLElement;
    expect(fold).toBeTruthy();
    expect(dialog.contains(fold)).toBe(true);
    expect(fold.hasAttribute('hidden')).toBe(true);
    expect(within(dialog).queryByRole('combobox', { name: 'Event type' })).toBeNull();
    // Mounted (M-2) but inside the hidden fold, so not shown.
    expect(fold.contains(within(dialog).getByText('User Login'))).toBe(true);
    expect(within(fold).queryAllByRole('listitem')).toHaveLength(0);

    const before = calls.length;
    fireEvent.click(toggle);
    expect(toggle.textContent).toBe('Hide audit events');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(fold.hasAttribute('hidden')).toBe(false);
    expect(within(dialog).getByRole('combobox', { name: 'Event type' })).toBeTruthy();
    expect(within(fold).getAllByTestId('detail-audit-event')).toHaveLength(3);
    expect(within(fold).getByRole('note').textContent).toContain('Entries before 2026-01-01 are archived.');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(fold.hasAttribute('hidden')).toBe(true);
    await act(async () => undefined);
    expect(calls.length).toBe(before);
  });

  it('D-7: the filter, severity chips and UTC times; a reopen is collapsed again and keeps the filter', async () => {
    await renderPage();
    let dialog = await openWithButton('Dana Cohen');
    fireEvent.click(within(dialog).getByTestId('detail-audit-toggle'));
    const fold = () => document.getElementById(
      within(screen.getByRole('dialog')).getByTestId('detail-audit-toggle').getAttribute('aria-controls') as string,
    ) as HTMLElement;

    const chips = within(fold()).getAllByTestId('detail-audit-event').map((e) => e.querySelector('[data-tone]'));
    expect(chips.map((c) => c?.textContent)).toEqual(['Info', 'Warning', 'Critical']);
    expect(chips.map((c) => c?.getAttribute('data-tone'))).toEqual(['info', 'warn', 'danger']);
    expect(fold().textContent).toContain('2026-10-10 09:00 UTC');

    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Event type' }), { target: { value: 'login' } });
    const events = within(fold()).getAllByTestId('detail-audit-event');
    expect(events).toHaveLength(1);
    expect(events[0].textContent).toContain('User Login');

    await closeWithEscape();
    fireEvent.click(openButtonFor('Dana Cohen'));
    dialog = await screen.findByRole('dialog');
    const toggle = await within(dialog).findByTestId('detail-audit-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect((within(dialog).getByRole('combobox', { name: 'Event type' }) as HTMLSelectElement).value).toBe('login');
  });
});

describe('D-8 / D-9 / D-10 close and focus', () => {
  it('D-8: Escape and the X each return focus to the Open button', async () => {
    await renderPage();
    await openWithButton('Dana Cohen');
    await closeWithEscape();
    expect(document.activeElement).toBe(openButtonFor('Dana Cohen'));

    const dialog = await openWithButton('Dana Cohen');
    const closes = within(dialog).getAllByRole('button', { name: 'Close' });
    fireEvent.click(closes[closes.length - 1]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(openButtonFor('Dana Cohen'));
  });

  it('D-9: the open row leaving the list closes the drawer, focus lands on the content area, and it never reopens by itself', async () => {
    await renderPage();
    await openWithButton('Dana Cohen');

    listRows = [OREN, NONAME];
    fireEvent.click(refreshButton());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(refreshButton().disabled).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(content()));

    listRows = [DANA, OREN, NONAME];
    fireEvent.click(refreshButton());
    await waitFor(() => expect(screen.getAllByTestId('row-business')).toHaveLength(3));
    await waitFor(() => expect(refreshButton().disabled).toBe(false));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(openButtonFor('Dana Cohen'));
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('D-10: a failed Refresh closes the drawer through its open prop, shows the error, focus on the content area', async () => {
    await renderPage();
    await openWithButton('Dana Cohen');
    listFails = true;
    fireEvent.click(refreshButton());
    expect(await screen.findByTestId('users-error')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(content()));
  });
});

// SA M-5 asked to pin focus on the dialog's trigger after the first Escape.
// Not built: CreditFormDialog and BoostCapDialog are opened by state, without
// a Radix Trigger, so Radix has no trigger to return focus to, and focus falls
// to <body> (the drawer's trap is paused under the nested dialog). That was
// equally true in the expanded row before L-4b. Fixing it means editing
// CreditsBlock / BoostBlock, which this slice keeps unchanged: recorded as
// F-108 and escalated. What is pinned: the drawer stays open with the trigger
// in it, focus is never inside a closed dialog, and the second Escape returns
// focus to the row's Open button.
describe('D-11 / D-12 dialogs inside the drawer (D-8; SA M-5 in part)', () => {
  it('D-11: Escape closes the credit dialog only; a second Escape closes the drawer; no POST', async () => {
    await renderPage();
    const dialog = await openWithButton('Dana Cohen');
    const give = await within(dialog).findByTestId('credits-give');
    give.focus();
    fireEvent.click(give);
    const creditDialog = await screen.findByTestId('credit-form-dialog');

    fireEvent.keyDown(creditDialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('credit-form-dialog')).toBeNull());
    expect(screen.getByTestId('users-drawer').getAttribute('data-state')).toBe('open');
    expect(within(screen.getByTestId('users-drawer')).getByTestId('credits-give').isConnected).toBe(true);
    expect(document.activeElement?.isConnected).toBe(true);

    fireEvent.keyDown(screen.getByTestId('users-drawer'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(openButtonFor('Dana Cohen'));
    expect(posts()).toEqual([]);
  });

  it('D-12: the same for the top-ups spending-limit dialog; no POST', async () => {
    await renderPage();
    const dialog = await openWithButton('Dana Cohen');
    const setLimit = await within(dialog).findByTestId('boost-cap-set');
    setLimit.focus();
    fireEvent.click(setLimit);
    const capDialog = await screen.findByTestId('boost-cap-dialog');

    fireEvent.keyDown(capDialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('boost-cap-dialog')).toBeNull());
    expect(screen.getByTestId('users-drawer').getAttribute('data-state')).toBe('open');
    expect(within(screen.getByTestId('users-drawer')).getByTestId('boost-cap-set').isConnected).toBe(true);
    expect(document.activeElement?.isConnected).toBe(true);

    fireEvent.keyDown(screen.getByTestId('users-drawer'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(openButtonFor('Dana Cohen'));
    expect(posts()).toEqual([]);
  });
});

describe('D-13 / D-14 / D-15 the detail reads (QA-P8, O-3; SA Q-4)', () => {
  it('D-13: a reopen of a loaded account sends no detail read; the panel reads again', async () => {
    await renderPage();
    await openWithButton('Dana Cohen');
    await waitFor(() => expect(count(`/api/admin/business-os/accounts/${DANA_ID}/summary`)).toBe(1));
    await closeWithEscape();
    await openWithButton('Dana Cohen');
    expect(detailReads(DANA_ID)).toEqual({ login: 1, audit: 1, stats: 1 });
    await waitFor(() => expect(count(`/api/admin/business-os/accounts/${DANA_ID}/summary`)).toBe(2));
  });

  it('D-14: a reopen after a failed stats read reads stats again', async () => {
    detailAnswer = { stats: () => json(500, { success: false }) };
    await renderPage();
    const dialog = await openWithButton('Dana Cohen');
    expect(within(dialog).getByTestId('ai-spend-card').textContent).toContain('could not be read');
    await closeWithEscape();
    detailAnswer = {};
    await openWithButton('Dana Cohen');
    expect(detailReads(DANA_ID).stats).toBe(2);
    await waitFor(() => expect(screen.getByTestId('ai-spend-card').textContent).toContain('$0.4321'));
  });

  it('D-15a: an unreadable login-stats body hides only its own section, and is read again on reopen', async () => {
    detailAnswer = { 'login-stats': htmlOk };
    await renderPage();
    const dialog = await openWithButton('Dana Cohen');
    // LF-4a.2 (BD-10): the login fields live in Account & security's sign-in group.
    expect(within(dialog).queryByTestId('account-login-stats')).toBeNull();
    expect(within(dialog).getByTestId('plugins-card').textContent).toContain('1/2 active');
    expect(within(dialog).getByTestId('ai-spend-card').textContent).toContain('$0.4321');
    fireEvent.click(within(dialog).getByTestId('detail-audit-toggle'));
    expect(within(dialog).getAllByTestId('detail-audit-event')).toHaveLength(3);
    await closeWithEscape();
    detailAnswer = {};
    await openWithButton('Dana Cohen');
    expect(detailReads(DANA_ID).login).toBe(2);
  });

  it('D-15b: an unreadable audit body shows no events and is never cached as empty', async () => {
    detailAnswer = { 'audit-logs': htmlOk };
    await renderPage();
    const dialog = await openWithButton('Dana Cohen');
    fireEvent.click(within(dialog).getByTestId('detail-audit-toggle'));
    expect(within(dialog).getByText('No audit logs found')).toBeTruthy();
    // LF-4a.2 (BD-10, SA C4): the login fields live in Account & security's sign-in group.
    expect(within(dialog).getByTestId('account-login-stats')).toBeTruthy();
    await closeWithEscape();
    detailAnswer = {};
    await openWithButton('Dana Cohen');
    expect(detailReads(DANA_ID).audit).toBe(2);
  });
});

describe('D-16 / D-18 / D-19 / D-20 the body', () => {
  it('D-16: the cleanup panel is mounted once inside the danger area, locked to the email; no Delete… entry', async () => {
    await renderPage();
    const dialog = await openWithButton('Dana Cohen');
    const danger = within(dialog).getByTestId('danger-area');
    const panels = within(dialog).getAllByTestId('test-account-cleanup-panel');
    expect(panels).toHaveLength(1);
    expect(danger.contains(panels[0])).toBe(true);
    expect(within(panels[0]).getAllByDisplayValue('dana@example.com').length).toBeGreaterThan(0);
    expect(within(dialog).queryByTestId('delete-business-open')).toBeNull();
  });

  it('D-16: a row with no email says it cannot be removed here', async () => {
    listRows = [{ ...NONAME, email: '' }];
    await renderPage();
    fireEvent.click(openButtonFor('this login'));
    const dialog = await screen.findByRole('dialog');
    const danger = await within(dialog).findByTestId('danger-area');
    expect(danger.textContent).toContain('This login has no email, so it cannot be removed here.');
    expect(within(dialog).queryByTestId('test-account-cleanup-panel')).toBeNull();
  });

  it('D-18: Login Activity says "Click to load" until opened, then the count in no green class; failures stay red', async () => {
    await renderPage();
    const cell = () => within(rowOf('Dana Cohen')).getByTestId('row-login-activity');
    expect(cell().textContent).toBe('Click to load');
    await openWithButton('Dana Cohen');
    await closeWithEscape();
    expect(cell().textContent).toContain('1logins');
    const countNode = within(cell()).getByTestId('row-login-count');
    expect(countNode.className).not.toMatch(/green/);
    expect(cell().innerHTML).not.toMatch(/text-green-/);
    expect(within(cell()).getByTestId('row-login-failed').className).toContain('text-red-300');
  });

  it('D-19: an inactive plugin says "inactive"; no green dot in the drawer', async () => {
    await renderPage();
    const dialog = await openWithButton('Dana Cohen');
    const plugins = within(dialog).getByTestId('plugins-card');
    expect(within(plugins).getByText('Slack', { exact: false }).textContent).toContain('inactive');
    expect(within(plugins).getByText('Google Mail', { exact: false }).textContent).not.toContain('inactive');
    expect(dialog.querySelector('.bg-green-400')).toBeNull();
  });

  it('D-20: one h1 on the page; the title is the only h2; each drawer section has exactly one heading', async () => {
    await renderPage();
    const dialog = await openWithButton('Dana Cohen');
    // SA S-6: counted in the DOM, because the page header is aria-hidden while the modal is open.
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    const h2s = dialog.querySelectorAll('h2');
    expect(h2s).toHaveLength(1);
    expect(h2s[0].textContent).toBe('Acme Therapy 99999999…');
    // LF-4a.2 (BD-4, SA C2): exactly five sections for a Business OS account,
    // each named by its first heading, its h3. One named exception, asserted by
    // containment: Plan & entitlements also holds the snapshot's own h3 inside
    // the plan fold. LF-4b turned the money blocks' h4s into labels, so Credits
    // & billing has exactly one heading and its exception is gone.
    await within(dialog).findByTestId('credits-block');
    await waitFor(() => expect(within(dialog).queryByText('Loading credits…')).toBeNull());
    await within(dialog).findByTestId('boost-cap');
    const sections = Array.from(dialog.querySelectorAll('[role="group"][aria-labelledby]'));
    expect(sections.map((s) => s.querySelector('h3')?.textContent)).toEqual([
      'Credits & billing',
      'Plan & entitlements',
      'AI usage',
      'Account & security',
      'Activity',
    ]);
    const allowedExtra = (section: Element): Element[] => {
      const name = section.querySelector('h3')?.textContent;
      if (name === 'Plan & entitlements') {
        const snapshotHeading = within(dialog).getByTestId('bos-panel-plan').querySelector('h3');
        return snapshotHeading ? [snapshotHeading] : [];
      }
      return [];
    };
    for (const section of sections) {
      const headings = Array.from(section.querySelectorAll('h1, h2, h3, h4, h5, h6'));
      const extras = allowedExtra(section);
      const name = section.querySelector('h3')?.textContent;
      const expectedExtras = name === 'Plan & entitlements' ? 1 : 0;
      expect({ name, extras: extras.length }).toEqual({ name, extras: expectedExtras });
      expect({ name, id: section.getAttribute('aria-labelledby'), count: headings.length }).toEqual({
        name,
        id: headings[0]?.id,
        count: 1 + extras.length,
      });
      // Containment: every extra heading is exactly one of the named ones (identity, not shape).
      headings.slice(1).forEach((heading, i) => expect(heading).toBe(extras[i]));
    }
    // The money blocks hold no heading of their own (labels since LF-4b).
    for (const testId of ['credits-block', 'boost-block']) {
      expect({ testId, headings: within(dialog).getByTestId(testId).querySelectorAll('h1, h2, h3, h4, h5, h6').length }).toEqual({
        testId,
        headings: 0,
      });
    }
  });
});

describe('D-21 to D-24 the whole-row click (user decision D-17; SA Q-1)', () => {
  it.each([
    ['the business name', () => within(rowOf('Dana Cohen')).getByTestId('row-business')],
    ['the Contact cell', () => within(rowOf('Dana Cohen')).getByTestId('row-contact')],
    ['the Credits left cell', () => within(rowOf('Dana Cohen')).getByTestId('row-credits-cell')],
  ])('D-21: a click on %s opens the drawer with one set of reads; Escape returns focus to that row\'s Open button', async (_where, target) => {
    await renderPage();
    fireEvent.click(target());
    const dialog = await screen.findByRole('dialog', { name: 'Acme Therapy 99999999…' });
    await within(dialog).findByTestId('danger-area');
    expect(detailReads(DANA_ID)).toEqual({ login: 1, audit: 1, stats: 1 });
    await closeWithEscape();
    expect(document.activeElement).toBe(openButtonFor('Dana Cohen'));
  });

  it('D-22: a click on the Open button sends exactly one set of reads (the row handler ignores it)', async () => {
    await renderPage();
    await openWithButton('Dana Cohen');
    expect(detailReads(DANA_ID)).toEqual({ login: 1, audit: 1, stats: 1 });
  });

  it('D-23: a text selection inside the row blocks the row click; a selection elsewhere does not', async () => {
    await renderPage();
    const name = within(rowOf('Dana Cohen')).getByTestId('row-business');
    const spy = jest.spyOn(window, 'getSelection');

    spy.mockReturnValue({ isCollapsed: false, anchorNode: name.firstChild, focusNode: name.firstChild } as unknown as Selection);
    fireEvent.click(name);
    await act(async () => undefined);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(detailReads(DANA_ID)).toEqual({ login: 0, audit: 0, stats: 0 });

    const elsewhere = screen.getByTestId('users-count-line');
    spy.mockReturnValue({ isCollapsed: false, anchorNode: elsewhere.firstChild, focusNode: elsewhere.firstChild } as unknown as Selection);
    fireEvent.click(name);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    spy.mockRestore();
  });

  it('D-24: keyboard: Enter on the focused Open button opens the drawer', async () => {
    const user = userEvent.setup();
    await renderPage();
    openButtonFor('Dana Cohen').focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: 'Acme Therapy 99999999…' })).toBeTruthy();
  });
});
