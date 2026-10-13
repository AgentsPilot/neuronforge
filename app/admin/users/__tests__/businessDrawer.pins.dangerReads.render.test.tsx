/**
 * @jest-environment jsdom
 */

/**
 * LF-4a.1 pin suite, part 3 of 3: the Businesses drawer's danger area and its
 * per-open request list (requirement ADMIN_LAYOUT_FOLLOWUPS §1.3 PIN-e,
 * PIN-f, PIN-g, PIN-j, PIN-k; AC-4.3; BD-13 as it is today; SA-C5, SA-C6).
 *
 * Characterisation, not specification: every assertion is what the unchanged
 * code does on 2026-10-13. LF-4a.2 may edit these tests only where a block
 * moves, never a request, a count or the confirm step. Pin list:
 * docs/workplans/ADMIN_LAYOUT_LF4A1_WORKPLAN.md.
 *
 * Same harness as businessDrawer.pins.credits (Jest collects every file under
 * __tests__, so it cannot be shared as a module), with four accounts: a
 * Business OS account, a login with no Business OS business, and two Business
 * OS accounts whose entitlements read or summary read fails.
 */

import React from 'react';
import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  }),
}));

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
}));

import UsersPage from '../page';
import recordedAccountBody from '@/app/admin/business-os-tiers/__tests__/__fixtures__/recordedAccountBody.json';
import type { AccountCreditPositionPayload } from '../types';
import type { AdminBoostView } from '@/lib/business-os/boost/boostAdminViewTypes';

// Whole-page renders are slow on a loaded machine (a full admin run in parallel):
// generous limits, so a pin fails on behaviour, never on time.
jest.setTimeout(30_000);
configure({ asyncUtilTimeout: 5_000 });

// ── Fixtures ────────────────────────────────────────────────────────────────

const DANA_ID = '99999999-9999-4999-8999-999999999999';
const OREN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ELI_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SARA_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const ARCHIVING_URL = '/api/admin/archiving';
const CLEANUP_CHECK_URL = '/api/admin/test-account-cleanup/check';
const CLEANUP_DELETE_URL = '/api/admin/test-account-cleanup/delete';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

function row(id: string, fullName: string, email: string, companyName: string | null) {
  return {
    id, full_name: fullName, company: null, email, email_confirmed: true, phone: null,
    last_sign_in_at: null, created_at: '2026-09-01T00:00:00Z', providers: ['email'], role: 'authenticated',
    business: companyName === null ? null : { companyName, vertical: 'therapist' },
  };
}

const DANA = row(DANA_ID, 'Dana Cohen', 'dana@example.com', 'Acme Therapy');
const OREN = row(OREN_ID, 'Oren Levi', 'oren@example.com', null);
const ELI = row(ELI_ID, 'Eli Plan', 'eli@example.com', 'Eli Studio');
const SARA = row(SARA_ID, 'Sara Summary', 'sara@example.com', 'Sara Clinic');

const LOGIN_STATS = { success: true, data: { total_logins: 1, failed_logins: 0, unique_ips: 1, last_login_ip: '10.0.0.1' } };
const AUDIT = { success: true, data: [] };
const STATS = {
  success: true,
  data: {
    tokens: { total_input_tokens: 0, total_output_tokens: 0, total_cost_usd: 0, total_calls: 0, by_model: [] },
    plugins: { total: 0, active: 0, list: [] },
  },
};
const ARCHIVING = { success: true, data: { sources: [{ key: 'audit_trail', latestCutoff: '2026-01-01T00:00:00.000Z' }] } };

function summary(id: string, companyName: string) {
  return {
    success: true,
    data: {
      accountId: id,
      business: { status: 'ok', companyName, vertical: 'therapist', subVertical: null },
      aiSpend30d: {
        status: 'complete', currency: 'USD', readCeiling: 5000,
        window: { start: '2026-08-26T00:00:00.000Z', end: '2026-09-25T00:00:00.000Z' },
        total: { calls: 0, tokens: 0, estimatedCostUsd: 0 }, lines: [],
      },
      recentAiFailures: { status: 'ok', window: { start: '2026-08-26T00:00:00.000Z', end: '2026-09-25T00:00:00.000Z' }, limit: 10, items: [] },
    },
  };
}

function credits(id: string): AccountCreditPositionPayload {
  return {
    accountId: id,
    isOwnAccount: false,
    limits: { grantCeiling: 100000, reasonMin: 3, reasonMax: 500 },
    usage: {
      status: 'ok',
      period: { kind: 'monthly', key: '2026-09-14T09:31:07.123456+00:00', resetsOn: '2026-10-14T09:31:07.123Z' },
      allowanceStatus: 'ok', allowance: { amount: 5000, per: 'month' }, allowanceLayer: 'basis',
      used: 0, usedByOwner: 0, usedAutomatic: 0, planLeft: 5000, overPlan: 0,
    },
    extra: { status: 'ok', extraCredits: 0, hasInconsistentLot: false, lots: [] },
  };
}

function boost(id: string): AdminBoostView {
  return {
    accountId: id,
    isOwnAccount: false,
    serverMode: 'test',
    purchases: { status: 'ok', rows: [], truncated: { test: false, live: false } },
    cap: { status: 'ok', default: { amountMinor: 15000, currency: 'USD', windowDays: 30 }, active: null, history: [] },
    limits: { minMinor: 100, maxMinor: 150000, stepMinor: 100, currency: 'USD', windowDays: 30, reasonMin: 3, reasonMax: 500 },
  };
}

function checkView() {
  return {
    version: 'v1',
    verdict: 'OK',
    targetUserId: DANA_ID,
    blockers: [],
    storageObjects: [],
    functionUpToDate: true,
    serverMs: 10,
    rows: [{ section: 'remove', status: 'remove', item: 'B1 business_os_contacts', found: 4, detail: '' }],
  };
}

function deleteView(result: string) {
  return {
    targetUserId: DANA_ID,
    filesRemoved: 0,
    report: {
      tables: [{ table: 'auth.users', rowsRemoved: 1 }],
      total: { result, rowsRemoved: 1, tablesRemoved: 1, removedLogin: DANA_ID, removedAt: null, sameRun: true },
    },
    serverMs: { check: 10, delete: 20 },
  };
}

// ── The recording fetch stub ────────────────────────────────────────────────

interface Reply {
  status: number;
  body?: unknown;
}
type Queued = Reply | Promise<Reply>;

interface Call {
  url: string;
  method: string;
  headers: HeadersInit | undefined;
  body: string | null;
  cache: RequestCache | undefined;
}

let calls: Call[] = [];
let unexpected: string[] = [];
let pending = 0;
let listRows: unknown[] = [];
let checkQueue: Queued[] = [];
let deleteQueue: Queued[] = [];

const ok = (data: unknown): Reply => ({ status: 200, body: { success: true, data } });
const refused = (status: number, error: string, extra: Record<string, unknown> = {}): Reply => ({
  status,
  body: { success: false, error, ...extra },
});

const NOT_BOS = refused(404, 'not_a_business_os_account');
const SERVER_ERROR = refused(500, 'Internal server error');

/** The panel's two reads, per account. */
const PANEL_READS: Record<string, { entitlements: Reply; summary: Reply }> = {
  [DANA_ID]: { entitlements: { status: 200, body: recordedAccountBody }, summary: { status: 200, body: summary(DANA_ID, 'Acme Therapy') } },
  [OREN_ID]: { entitlements: NOT_BOS, summary: NOT_BOS },
  [ELI_ID]: { entitlements: SERVER_ERROR, summary: { status: 200, body: summary(ELI_ID, 'Eli Studio') } },
  [SARA_ID]: { entitlements: { status: 200, body: recordedAccountBody }, summary: SERVER_ERROR },
};

function routeGet(url: string): Queued {
  if (url.startsWith('/api/admin/users?')) {
    return { status: 200, body: { success: true, data: listRows, stats: { totalUsers: listRows.length, activeUsers: 0, newUsersToday: 0 } } };
  }
  for (const id of Object.keys(PANEL_READS)) {
    if (url === `/api/admin/users/${id}/login-stats`) return { status: 200, body: LOGIN_STATS };
    if (url === `/api/admin/users/${id}/audit-logs`) return { status: 200, body: AUDIT };
    if (url === `/api/admin/users/${id}/stats`) return { status: 200, body: STATS };
    if (url === `/api/admin/business-os/entitlements/accounts/${id}`) return PANEL_READS[id].entitlements;
    if (url === `/api/admin/business-os/accounts/${id}/summary`) return PANEL_READS[id].summary;
    if (url === `/api/admin/business-os/credits/accounts/${id}`) return ok(credits(id));
    if (url === `/api/admin/business-os/credits/accounts/${id}/boost`) return ok(boost(id));
  }
  if (url === ARCHIVING_URL) return { status: 200, body: ARCHIVING };
  if (url === CLEANUP_CHECK_URL) return ok({ configured: true });
  unexpected.push(`GET ${url}`);
  return refused(404, 'not mocked');
}

/** The next queued answer; a POST nothing was queued for is unexpected (SA fix 4), and still answers 500. */
function fromQueue(queue: Queued[], url: string): Queued {
  const next = queue.shift();
  if (next !== undefined) return next;
  unexpected.push(`POST ${url} (nothing queued)`);
  return refused(500, 'not queued');
}

function routePost(url: string): Queued {
  if (url === CLEANUP_CHECK_URL) return fromQueue(checkQueue, url);
  if (url === CLEANUP_DELETE_URL) return fromQueue(deleteQueue, url);
  unexpected.push(`POST ${url}`);
  return refused(404, 'not mocked');
}

function installFetch(): void {
  const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({
      url,
      method,
      headers: init?.headers,
      body: typeof init?.body === 'string' ? init.body : null,
      cache: init?.cache,
    });
    pending += 1;
    try {
      const reply = await (method === 'GET' ? routeGet(url) : routePost(url));
      return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body } as unknown as Response;
    } finally {
      pending -= 1;
    }
  });
  global.fetch = fetchMock as unknown as typeof fetch;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const posts = () => calls.filter((c) => c.method === 'POST');
const getCount = (url: string) => calls.filter((c) => c.method === 'GET' && c.url === url).length;
const listReads = () => calls.filter((c) => c.method === 'GET' && c.url.startsWith('/api/admin/users?')).length;
const bodyOf = (call: Call): unknown => JSON.parse(call.body ?? 'null');

/** The whole recorded request; the body parsed, or the raw string when `raw` (the reconcile body is the literal '{}'). */
const requestOf = (call: Call, raw = false) => ({
  url: call.url,
  method: call.method,
  headers: call.headers,
  cache: call.cache,
  body: raw ? call.body : bodyOf(call),
});

/** One request as a line: method, URL, the `cache` option and the headers it was given ("none" when absent). */
const describeCall = (c: Call) =>
  `${c.method} ${c.url} cache=${c.cache ?? 'none'} headers=${c.headers === undefined ? 'none' : JSON.stringify(c.headers)}`;

async function settle() {
  await waitFor(() => expect(pending).toBe(0));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * Quiet: nothing in flight and no new request for a 300 ms window (real
 * timers), repeated until a window passes with no new call. A late extra read
 * (a timer after a success, say) lands inside the window and is counted.
 */
async function quiet() {
  await settle();
  let seen = -1;
  while (seen !== calls.length || pending !== 0) {
    seen = calls.length;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
  }
}

async function renderPage() {
  installFetch();
  render(<UsersPage />);
  await screen.findAllByTestId('row-business');
  await settle();
}

/**
 * Opens the row through its Open button and waits until every per-open read
 * has answered: the danger area, the panel's settled state (`ready`), the
 * archive cutoff and the cleanup probe.
 */
async function openRow(name: string, ready: string): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: `Open details for ${name}`, hidden: true }));
  const drawer = await screen.findByTestId('users-drawer');
  await within(drawer).findByTestId('danger-area');
  await within(drawer).findByTestId(ready);
  await waitFor(() => expect(getCount(ARCHIVING_URL)).toBeGreaterThan(0));
  await waitFor(() => expect(getCount(CLEANUP_CHECK_URL)).toBeGreaterThan(0));
  await settle();
  return drawer;
}

/** The requests one opening sent, as sorted lines. */
async function requestsOfOneOpen(name: string, ready: string): Promise<string[]> {
  await renderPage();
  const before = calls.length;
  await openRow(name, ready);
  await quiet();
  return calls.slice(before).map(describeCall).sort();
}

const DANA_EMAIL = 'dana@example.com';
/** The whole expected cleanup check request (PIN-e; no cache option today, F-4). */
const CHECK_POST = {
  url: CLEANUP_CHECK_URL,
  method: 'POST',
  headers: JSON_HEADERS,
  cache: undefined,
  body: { email: DANA_EMAIL, tag: DANA_EMAIL },
};
/** The whole expected cleanup delete request (PIN-e; no cache option today, F-4). */
const DELETE_POST = {
  url: CLEANUP_DELETE_URL,
  method: 'POST',
  headers: JSON_HEADERS,
  cache: undefined,
  body: { email: DANA_EMAIL, tag: DANA_EMAIL, confirmEmail: DANA_EMAIL },
};

const panelOf = (drawer: HTMLElement) => within(drawer).getByTestId('test-account-cleanup-panel');

/** Check, then type the confirmation; returns the Delete button. */
async function checkAndConfirm(drawer: HTMLElement): Promise<HTMLButtonElement> {
  const panel = panelOf(drawer);
  checkQueue.push(ok(checkView()));
  fireEvent.click(within(panel).getByRole('button', { name: 'Check' }));
  await within(panel).findByTestId('cleanup-confirm');
  const deleteButton = within(panel).getByRole('button', { name: 'Delete this account' }) as HTMLButtonElement;
  expect(deleteButton.disabled).toBe(true);
  fireEvent.change(within(panel).getByLabelText('Type the email again to confirm'), { target: { value: 'dana@example.com' } });
  expect(deleteButton.disabled).toBe(false);
  return deleteButton;
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

let consoleError: jest.SpyInstance;
let consoleWarn: jest.SpyInstance;

beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.releasePointerCapture ??= () => undefined;
  proto.scrollIntoView ??= () => undefined;
});

beforeEach(() => {
  calls = [];
  unexpected = [];
  pending = 0;
  listRows = [DANA, OREN, ELI, SARA];
  checkQueue = [];
  deleteQueue = [];
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(async () => {
  try {
    await settle();
    expect(unexpected).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  } finally {
    // Restored even when a guard fails, so a spy never leaks into the next test.
    consoleError.mockRestore();
    consoleWarn.mockRestore();
  }
});

// ── PIN-k: the per-open request list ────────────────────────────────────────

/** The reads every opening sends, whatever the account. */
const commonReads = (id: string) => [
  `GET /api/admin/users/${id}/login-stats cache=none headers=none`,
  `GET /api/admin/users/${id}/audit-logs cache=none headers=none`,
  `GET /api/admin/users/${id}/stats cache=none headers=none`,
  `GET /api/admin/business-os/entitlements/accounts/${id} cache=no-store headers=none`,
  `GET /api/admin/business-os/accounts/${id}/summary cache=no-store headers=none`,
  `GET ${ARCHIVING_URL} cache=none headers=none`,
  `GET ${CLEANUP_CHECK_URL} cache=none headers=none`,
];
const moneyReads = (id: string) => [
  `GET /api/admin/business-os/credits/accounts/${id} cache=no-store headers=none`,
  `GET /api/admin/business-os/credits/accounts/${id}/boost cache=no-store headers=none`,
];

describe('PIN-k / AC-4.3: the requests one opening sends', () => {
  it('READS-1: a Business OS account: the nine reads below, each exactly once, and no POST', async () => {
    const sent = await requestsOfOneOpen('Dana Cohen', 'boost-cap');
    expect(sent).toEqual([...commonReads(DANA_ID), ...moneyReads(DANA_ID)].sort());
  });

  it('READS-2 (BD-13 today): a login with no Business OS business: the seven common reads, no credits or top-ups read; the one-line note; no money block', async () => {
    const sent = await requestsOfOneOpen('Oren Levi', 'bos-panel-not-bos');
    expect(sent).toEqual([...commonReads(OREN_ID)].sort());
    const drawer = screen.getByTestId('users-drawer');
    expect(within(drawer).getByTestId('bos-panel-not-bos').textContent).toBe(
      'Not a Business OS account. This login has no Business OS business.'
    );
    expect(within(drawer).getByTestId('bos-panel-business').textContent).toBe('No Business OS business');
    expect(within(drawer).queryByTestId('credits-block')).toBeNull();
    expect(within(drawer).queryByTestId('boost-block')).toBeNull();
    expect(within(drawer).queryByTestId('bos-panel-plan')).toBeNull();
    expect(within(drawer).queryByTestId('bos-panel-spend')).toBeNull();
    // The danger area is still there for a non-Business OS login.
    expect(within(drawer).getByTestId('test-account-cleanup-panel')).toBeTruthy();
  });

  it('READS-3: a failed entitlements read: the same nine reads once each (the money blocks still mount); the plan error is shown', async () => {
    const sent = await requestsOfOneOpen('Eli Plan', 'boost-cap');
    expect(sent).toEqual([...commonReads(ELI_ID), ...moneyReads(ELI_ID)].sort());
    const drawer = screen.getByTestId('users-drawer');
    expect(within(drawer).getByTestId('bos-panel-plan-error')).toBeTruthy();
    expect(within(drawer).getByTestId('credits-block')).toBeTruthy();
  });

  it('READS-4: a failed summary read: the same nine reads once each; the summary error is shown under a neutral header', async () => {
    const sent = await requestsOfOneOpen('Sara Summary', 'boost-cap');
    expect(sent).toEqual([...commonReads(SARA_ID), ...moneyReads(SARA_ID)].sort());
    const drawer = screen.getByTestId('users-drawer');
    expect(within(drawer).getByTestId('bos-panel-summary-error').textContent).toBe(
      'Something failed on the server. The correlation id is in the logs.'
    );
    expect(within(drawer).getByTestId('bos-panel-business').textContent).toBe('Business OS');
  });
});

// ── PIN-j: the danger area ──────────────────────────────────────────────────

describe('PIN-j: Remove this account and the hidden Delete… entry', () => {
  it("DANGER-1: the cleanup panel is the drawer's last block, locked to the row's email, and sends nothing before Check", async () => {
    await renderPage();
    const drawer = await openRow('Dana Cohen', 'boost-cap');
    const danger = within(drawer).getByTestId('danger-area');
    const panel = panelOf(drawer);

    // Last block of the drawer body, and the last thing inside the danger area.
    expect(danger.parentElement?.lastElementChild).toBe(danger);
    expect(danger.lastElementChild).toBe(panel);
    expect(within(drawer).getAllByTestId('test-account-cleanup-panel')).toHaveLength(1);

    expect(within(panel).getByRole('heading').textContent).toBe('Remove this account');
    expect(within(panel).getByTestId('cleanup-locked-warning').textContent).toBe(
      'Permanently removes a real account, its login and money history.'
    );
    const fields = within(panel).getAllByRole('textbox') as HTMLInputElement[];
    expect(fields.map((field) => [field.value, field.readOnly])).toEqual([
      ['dana@example.com', true],
      ['dana@example.com', true],
    ]);
    expect(within(panel).getByRole('button', { name: 'Check' })).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: 'Delete this account' })).toBeNull();
    expect(posts()).toEqual([]);
  });

  it('DANGER-2: Check, typed confirmation, Delete: the exact requests (header, no cache option); a CLEAN report waits for Done; Done reads the list exactly once', async () => {
    await renderPage();
    const drawer = await openRow('Dana Cohen', 'boost-cap');
    const deleteButton = await checkAndConfirm(drawer);

    // The baseline is taken before the delete, so a list read at any point of the removal counts.
    const listBefore = listReads();
    deleteQueue.push(ok(deleteView('CLEAN')));
    fireEvent.click(deleteButton);
    const report = await within(drawer).findByTestId('cleanup-report');
    expect(within(report).getByTestId('cleanup-report-total').textContent).toContain('TOTAL · CLEAN');

    // Locked mode: no list read between the CLEAN report and Done.
    await quiet();
    expect(listReads()).toBe(listBefore);
    expect(posts().map((p) => requestOf(p))).toStrictEqual([CHECK_POST, DELETE_POST]);

    listRows = [OREN, ELI, SARA];
    fireEvent.click(within(report).getByTestId('cleanup-done'));
    await waitFor(() => expect(screen.queryByTestId('users-drawer')).toBeNull());
    // Exactly one list read for the whole removal, after Done.
    await quiet();
    expect(listReads()).toBe(listBefore + 1);
    expect(posts().map((p) => requestOf(p))).toStrictEqual([CHECK_POST, DELETE_POST]);
    expect(screen.queryByRole('button', { name: 'Open details for Dana Cohen', hidden: true })).toBeNull();
  });

  it('DANGER-3 (PIN-f): a double click on Delete sends one delete', async () => {
    await renderPage();
    const drawer = await openRow('Dana Cohen', 'boost-cap');
    const deleteButton = await checkAndConfirm(drawer);
    const held = deferred<Reply>();
    deleteQueue.push(held.promise);
    act(() => {
      deleteButton.click();
      deleteButton.click();
    });
    expect(posts().filter((p) => p.url === CLEANUP_DELETE_URL)).toHaveLength(1);
    expect(within(panelOf(drawer)).getByRole('button', { name: 'Deleting…' })).toBeTruthy();
    await act(async () => {
      held.resolve(ok(deleteView('CLEAN')));
    });
    await within(drawer).findByTestId('cleanup-report');
    await quiet();
    expect(posts().map((p) => requestOf(p))).toStrictEqual([CHECK_POST, DELETE_POST]);
  });

  it('DANGER-4 (PIN-g): a refused delete shows its sentence, offers no Done and reads nothing', async () => {
    await renderPage();
    const drawer = await openRow('Dana Cohen', 'boost-cap');
    const deleteButton = await checkAndConfirm(drawer);
    const listBefore = listReads();
    deleteQueue.push(refused(409, 'blocked', { guards: ['G-5'], blockers: [] }));
    fireEvent.click(deleteButton);
    expect((await within(drawer).findByTestId('cleanup-delete-error')).textContent).toContain('BLOCKED by G-5, nothing was removed.');
    await quiet();
    expect(posts().map((p) => requestOf(p))).toStrictEqual([CHECK_POST, DELETE_POST]);
    expect(within(drawer).queryByTestId('cleanup-done')).toBeNull();
    expect(within(drawer).queryByTestId('cleanup-report')).toBeNull();
    expect(listReads()).toBe(listBefore);
    expect(screen.getByTestId('users-drawer').getAttribute('data-state')).toBe('open');
  });

  it('DANGER-5: the Delete… entry is not rendered and its preview is never requested', async () => {
    await renderPage();
    const drawer = await openRow('Dana Cohen', 'boost-cap');
    expect(within(drawer).queryByTestId('delete-business-open')).toBeNull();
    expect(within(drawer).queryByRole('button', { name: 'Delete…' })).toBeNull();
    expect(within(drawer).queryByText('Delete…')).toBeNull();
    expect(calls.filter((c) => c.url.includes('/deletion/'))).toEqual([]);
  });
});
