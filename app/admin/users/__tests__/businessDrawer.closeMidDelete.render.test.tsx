/**
 * @jest-environment jsdom
 */

/**
 * LF-F1 (requirement ADMIN_LAYOUT_FOLLOWUPS §14 LF4A1-F1, §1 LF-F1 row):
 * "Remove this account" closed mid-delete.
 *
 * Escape closes the Businesses drawer while the delete is in flight, so the
 * cleanup panel unmounts before the answer lands. Pinned through the whole
 * page: a CLEAN answer after the close still reads the list exactly once
 * (the row leaves); a refused or not-CLEAN answer after the close reads
 * nothing. The request list is the same two POSTs as DANGER-2.
 *
 * The harness is a copy of businessDrawer.pins.dangerReads, the fourth copy
 * of the shared pin harness. The SA accepted it for this slice only; the
 * harness is extracted to tests/admin/ as the first step of LF-4b, and there
 * is no fifth copy. That pin file is not edited by this slice.
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

/** The whole recorded request, the body parsed. */
const requestOf = (call: Call) => ({
  url: call.url,
  method: call.method,
  headers: call.headers,
  cache: call.cache,
  body: bodyOf(call),
});

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


// ── LF-F1: Escape while the delete is in flight ─────────────────────────────

/** Opens Dana, checks, confirms, clicks Delete with the answer held, then closes with Escape. */
async function closeMidDelete(): Promise<{ listBefore: number; land: (reply: Reply) => Promise<void> }> {
  await renderPage();
  const drawer = await openRow('Dana Cohen', 'boost-cap');
  const deleteButton = await checkAndConfirm(drawer);
  // The baseline is taken before the delete, so a list read at any point of the removal counts.
  const listBefore = listReads();
  const held = deferred<Reply>();
  deleteQueue.push(held.promise);
  fireEvent.click(deleteButton);
  expect(await within(panelOf(drawer)).findByRole('button', { name: 'Deleting…' })).toBeTruthy();

  fireEvent.keyDown(screen.getByTestId('users-drawer'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByTestId('users-drawer')).toBeNull());
  expect(screen.queryByTestId('test-account-cleanup-panel')).toBeNull();
  // Closing alone reads nothing.
  expect(listReads()).toBe(listBefore);

  const land = async (reply: Reply) => {
    await act(async () => {
      held.resolve(reply);
    });
    await quiet();
  };
  return { listBefore, land };
}

const danaRow = () => screen.queryByRole('button', { name: 'Open details for Dana Cohen', hidden: true });

describe('LF-F1: "Remove this account" closed mid-delete', () => {
  it('F1-1: close mid-delete still reads the list once: a CLEAN answer after Escape reads the list exactly once and the row leaves', async () => {
    const { listBefore, land } = await closeMidDelete();
    listRows = [OREN, ELI, SARA];
    await land(ok(deleteView('CLEAN')));
    expect(listReads()).toBe(listBefore + 1);
    expect(posts().map((p) => requestOf(p))).toStrictEqual([CHECK_POST, DELETE_POST]);
    expect(danaRow()).toBeNull();
  });

  it('F1-2: a refused answer after Escape reads nothing; the row stays', async () => {
    const { listBefore, land } = await closeMidDelete();
    await land(refused(409, 'blocked', { guards: ['G-5'], blockers: [] }));
    expect(listReads()).toBe(listBefore);
    expect(posts().map((p) => requestOf(p))).toStrictEqual([CHECK_POST, DELETE_POST]);
    expect(danaRow()).not.toBeNull();
  });

  it('F1-3: a not-CLEAN answer after Escape reads nothing; the row stays', async () => {
    const { listBefore, land } = await closeMidDelete();
    await land(ok(deleteView('SURVIVORS')));
    expect(listReads()).toBe(listBefore);
    expect(posts().map((p) => requestOf(p))).toStrictEqual([CHECK_POST, DELETE_POST]);
    expect(danaRow()).not.toBeNull();
  });

  it('F1-4: a CLEAN answer before Escape (no Done) still reads the list exactly once', async () => {
    await renderPage();
    const drawer = await openRow('Dana Cohen', 'boost-cap');
    const deleteButton = await checkAndConfirm(drawer);
    const listBefore = listReads();
    deleteQueue.push(ok(deleteView('CLEAN')));
    fireEvent.click(deleteButton);
    await within(drawer).findByTestId('cleanup-report');
    await quiet();
    expect(listReads()).toBe(listBefore);

    listRows = [OREN, ELI, SARA];
    fireEvent.keyDown(screen.getByTestId('users-drawer'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('users-drawer')).toBeNull());
    await quiet();
    expect(listReads()).toBe(listBefore + 1);
    expect(posts().map((p) => requestOf(p))).toStrictEqual([CHECK_POST, DELETE_POST]);
    expect(danaRow()).toBeNull();
  });
});
