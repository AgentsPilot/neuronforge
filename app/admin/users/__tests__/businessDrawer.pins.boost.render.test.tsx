/**
 * @jest-environment jsdom
 */

/**
 * LF-4a.1 pin suite, part 2 of 3: the Credit top-ups block's money actions,
 * through the WHOLE Businesses drawer (requirement ADMIN_LAYOUT_FOLLOWUPS
 * §1.3, PIN-a, PIN-b, PIN-d, PIN-e, PIN-f, PIN-g, PIN-i; BD-9; SA-C5).
 *
 * Characterisation, not specification: every assertion is what the unchanged
 * code does on 2026-10-13. LF-4b may edit these tests only where an opener
 * moves or a fold appears (F-2 in the workplan); LF-4c moves the reconcile
 * cases to the Jobs page with the SAME request assertions (BD-6). Pin list:
 * docs/workplans/ADMIN_LAYOUT_LF4A1_WORKPLAN.md.
 *
 * Same harness as businessDrawer.pins.credits (Jest collects every file under
 * __tests__, so it cannot be shared as a module): the page, the row's Open
 * button, every request recorded with URL, method, headers, raw body and
 * `cache`, a counting `crypto.randomUUID`, and a failure on any console error
 * or warning or any request the stub does not know.
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
import type { AccountCreditPositionPayload, CreditLotView } from '../types';
import type { AdminBoostPurchaseRow, AdminBoostView } from '@/lib/business-os/boost/boostAdminViewTypes';

// Whole-page renders are slow on a loaded machine (a full admin run in parallel):
// generous limits, so a pin fails on behaviour, never on time.
jest.setTimeout(30_000);
configure({ asyncUtilTimeout: 5_000 });

// ── Fixtures ────────────────────────────────────────────────────────────────

const DANA_ID = '99999999-9999-4999-8999-999999999999';
const ADMIN_ID = 'abcdef12-3456-4789-8abc-def012345678';
const BUSINESS = 'Acme Therapy';

const OPS_URL = `/api/admin/business-os/entitlements/accounts/${DANA_ID}`;
const SUMMARY_URL = `/api/admin/business-os/accounts/${DANA_ID}/summary`;
const CREDITS_URL = `/api/admin/business-os/credits/accounts/${DANA_ID}`;
const BOOST_URL = `${CREDITS_URL}/boost`;
const RECONCILE_URL = '/api/admin/business-os/credits/boost/reconcile';
const ARCHIVING_URL = '/api/admin/archiving';
const CLEANUP_CHECK_URL = '/api/admin/test-account-cleanup/check';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

const DANA = {
  id: DANA_ID, full_name: 'Dana Cohen', company: 'Cohen Clinic', email: 'dana@example.com', email_confirmed: true,
  phone: null, last_sign_in_at: null, created_at: '2026-09-01T00:00:00Z', providers: ['email'],
  role: 'authenticated', business: { companyName: BUSINESS, vertical: 'therapist' },
  creditsLeft: { kind: 'percent', value: 40, trial: false },
};

const LOGIN_STATS = { success: true, data: { total_logins: 1, failed_logins: 0, unique_ips: 1, last_login_ip: '10.0.0.1' } };
const AUDIT = { success: true, data: [] };
const STATS = {
  success: true,
  data: {
    tokens: { total_input_tokens: 0, total_output_tokens: 0, total_cost_usd: 0, total_calls: 0, by_model: [] },
    plugins: { total: 0, active: 0, list: [] },
  },
};
const SUMMARY = {
  success: true,
  data: {
    accountId: DANA_ID,
    business: { status: 'ok', companyName: BUSINESS, vertical: 'therapist', subVertical: null },
    aiSpend30d: {
      status: 'complete', currency: 'USD', readCeiling: 5000,
      window: { start: '2026-08-26T00:00:00.000Z', end: '2026-09-25T00:00:00.000Z' },
      total: { calls: 0, tokens: 0, estimatedCostUsd: 0 }, lines: [],
    },
    recentAiFailures: { status: 'ok', window: { start: '2026-08-26T00:00:00.000Z', end: '2026-09-25T00:00:00.000Z' }, limit: 10, items: [] },
  },
};
const ARCHIVING = { success: true, data: { sources: [{ key: 'audit_trail', latestCutoff: '2026-01-01T00:00:00.000Z' }] } };

const PAID_LOT: CreditLotView = {
  id: 'cccccccc-3333-4333-8333-33333333333c',
  source: 'boost_purchase',
  credits: 13750,
  remaining: 13750,
  expired: false,
  counted: true,
  expiresAt: null,
  reason: null,
  actorKind: 'stripe_webhook',
  actorAdminId: null,
  createdAt: '2026-10-01T12:05:00.000Z',
  takeBacks: [],
};

function credits(lots: CreditLotView[] = [PAID_LOT]): AccountCreditPositionPayload {
  return {
    accountId: DANA_ID,
    isOwnAccount: false,
    limits: { grantCeiling: 100000, reasonMin: 3, reasonMax: 500 },
    usage: {
      status: 'ok',
      period: { kind: 'monthly', key: '2026-09-14T09:31:07.123456+00:00', resetsOn: '2026-10-14T09:31:07.123Z' },
      allowanceStatus: 'ok', allowance: { amount: 5000, per: 'month' }, allowanceLayer: 'basis',
      used: 12, usedByOwner: 10, usedAutomatic: 2, planLeft: 4988, overPlan: 0,
    },
    extra: { status: 'ok', extraCredits: 13750, hasInconsistentLot: false, lots },
  };
}

function purchase(overrides: Partial<AdminBoostPurchaseRow> = {}): AdminBoostPurchaseRow {
  return {
    id: 'aaaaaaaa-1111-4111-8111-11111111111b',
    livemode: false,
    status: 'paid',
    packageId: 'plus',
    packageVersion: 1,
    priceMinor: 2500,
    currency: 'USD',
    creditsTotal: 13750,
    amountTotalMinor: 2500,
    amountTaxMinor: 0,
    amountRefundedMinor: 0,
    flagReason: null,
    lotId: PAID_LOT.id,
    stripe: { paymentIntentId: 'pi_3Test1', chargeId: null, disputeId: null, checkoutSessionId: null },
    createdAt: '2026-10-01T12:00:00.000Z',
    paidAt: '2026-10-01T12:05:00.000Z',
    statusChangedAt: '2026-10-01T12:05:00.000Z',
    checkoutExpiresAt: '2026-10-01T12:30:00.000Z',
    ...overrides,
  };
}

const DEFAULT_CAP = { amountMinor: 15000, currency: 'USD', windowDays: 30 };
const ACTIVE_CAP = { id: 'o1', amountMinor: 50000, currency: 'USD', reason: 'annual prepay customer', actorAdminId: ADMIN_ID, createdAt: '2026-10-02T09:00:00.000Z' };

function boost(overrides: Partial<AdminBoostView> = {}): AdminBoostView {
  return {
    accountId: DANA_ID,
    isOwnAccount: false,
    serverMode: 'test',
    purchases: { status: 'ok', rows: [purchase()], truncated: { test: false, live: false } },
    cap: { status: 'ok', default: DEFAULT_CAP, active: null, history: [] },
    limits: { minMinor: 100, maxMinor: 150000, stepMinor: 100, currency: 'USD', windowDays: 30, reasonMin: 3, reasonMax: 500 },
    ...overrides,
  };
}

const RECONCILE_OK = {
  counts: { boostExamined: 3, boostCredited: 1, boostExpired: 0, boostFailed: 0, boostFlagged: 0, boostDeferred: 0 },
  passesFailed: 0,
};

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
let creditsReply: () => Queued;
let boostData: AdminBoostView;
let opsQueue: Queued[] = [];
let reconcileQueue: Queued[] = [];
let minted: string[] = [];

const ok = (data: unknown): Reply => ({ status: 200, body: { success: true, data } });
const refused = (status: number, error: string): Reply => ({ status, body: { success: false, error } });

function routeGet(url: string): Queued {
  if (url.startsWith('/api/admin/users?')) {
    return { status: 200, body: { success: true, data: [DANA], stats: { totalUsers: 1, activeUsers: 0, newUsersToday: 0 } } };
  }
  if (url === `/api/admin/users/${DANA_ID}/login-stats`) return { status: 200, body: LOGIN_STATS };
  if (url === `/api/admin/users/${DANA_ID}/audit-logs`) return { status: 200, body: AUDIT };
  if (url === `/api/admin/users/${DANA_ID}/stats`) return { status: 200, body: STATS };
  if (url === OPS_URL) return { status: 200, body: recordedAccountBody };
  if (url === SUMMARY_URL) return { status: 200, body: SUMMARY };
  if (url === BOOST_URL) return ok(boostData);
  if (url === CREDITS_URL) return creditsReply();
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
  if (url === OPS_URL) return fromQueue(opsQueue, url);
  if (url === RECONCILE_URL) return fromQueue(reconcileQueue, url);
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

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

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

/** The final read counts, once the drawer has gone quiet. */
async function expectReads(expected: { credits: number; boost: number; list: number }) {
  await quiet();
  expect({ credits: getCount(CREDITS_URL), boost: getCount(BOOST_URL), list: listReads() }).toStrictEqual(expected);
}

/**
 * The page, the drawer open on Dana through the row's Open button. With
 * `settled` every per-open read has answered; without it only the top-ups
 * block is waited for (the Credits read may be held by the test).
 */
async function openDrawer(settled = true): Promise<HTMLElement> {
  installFetch();
  render(<UsersPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open details for Dana Cohen' }));
  const drawer = await screen.findByTestId('users-drawer');
  await within(drawer).findByTestId('danger-area');
  await within(drawer).findByTestId('boost-cap');
  if (settled) {
    await waitFor(() => expect(within(drawer).queryByText('Loading credits…')).toBeNull());
    await waitFor(() => expect(getCount(ARCHIVING_URL)).toBe(1));
    await waitFor(() => expect(getCount(CLEANUP_CHECK_URL)).toBe(1));
    await settle();
  }
  return drawer;
}

const button = (root: HTMLElement, testId: string) => within(root).getByTestId(testId) as HTMLButtonElement;
const noticeLines = (notice: HTMLElement) => Array.from(notice.querySelectorAll('p')).map((p) => p.textContent);
const topUpRow = (drawer: HTMLElement) => within(drawer).getByTestId('boost-purchase');

function fillCap(dialog: HTMLElement, amount: string | null, reason: string) {
  if (amount !== null) fireEvent.change(within(dialog).getByTestId('boost-cap-amount'), { target: { value: amount } });
  fireEvent.change(within(dialog).getByTestId('boost-cap-reason-input'), { target: { value: reason } });
  fireEvent.click(button(dialog, 'boost-cap-continue'));
}

/** The whole expected request of an entitlements op (PIN-e: URL, method, headers, cache, body). */
const opsPost = (body: Record<string, unknown>) => ({ url: OPS_URL, method: 'POST', headers: JSON_HEADERS, cache: 'no-store', body });
/** The whole expected reconcile request: the body is the literal string '{}'. */
const RECONCILE_POST = { url: RECONCILE_URL, method: 'POST', headers: JSON_HEADERS, cache: 'no-store', body: '{}' };

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
  opsQueue = [];
  reconcileQueue = [];
  minted = [];
  const data = credits();
  creditsReply = () => ok(data);
  boostData = boost();
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      randomUUID: () => {
        const id = uuid(minted.length + 1);
        minted.push(id);
        return id;
      },
    },
  });
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

// ── Take back credits on a top-up (BD-9) ────────────────────────────────────

describe('Take back credits on a top-up (BD-9, PIN-i, PIN-b, PIN-a)', () => {
  it("TOPUP-1: the top-up's opener opens the Credits block's Take back dialog on its lot; the paid gate; the exact request; the Credits notice and re-read only", async () => {
    const drawer = await openDrawer();
    const opener = button(topUpRow(drawer), 'boost-take-back');
    expect(opener.textContent).toBe('Take back credits');

    const mintedBefore = minted.length;
    fireEvent.click(opener);
    const dialog = await screen.findByTestId('credit-form-dialog');
    expect(minted).toHaveLength(mintedBefore + 1);
    expect(within(dialog).getByRole('heading').textContent).toBe(`Take back credits from ${BUSINESS}`);
    expect(dialog.textContent).toContain('13,750 left on this gift. The reason is internal: the business never sees it.');

    fireEvent.change(within(dialog).getByTestId('credit-amount'), { target: { value: '100' } });
    fireEvent.change(within(dialog).getByTestId('credit-reason'), { target: { value: 'refund agreed' } });
    expect(button(dialog, 'credit-form-continue').disabled).toBe(true);
    fireEvent.click(within(dialog).getByTestId('paid-credits-confirm'));
    fireEvent.click(button(dialog, 'credit-form-continue'));
    expect(within(dialog).getByTestId('credit-confirm-summary').textContent).toBe(`Take back 100 credits from ${BUSINESS}`);
    expect(posts()).toEqual([]);

    opsQueue.push(ok({ credits: 100, lotRemainingAfter: 13650, replayed: false }));
    fireEvent.click(button(dialog, 'credit-form-confirm'));
    const notice = await within(drawer).findByTestId('credits-success');
    expect(noticeLines(notice)).toEqual([`Took back 100 credits from ${BUSINESS}; 13,650 left on this gift.`]);
    expect(screen.queryByTestId('credit-form-dialog')).toBeNull();

    expect(posts().map((p) => requestOf(p))).toStrictEqual([
      opsPost({
        op: 'reduce_credit_lot',
        lotId: PAID_LOT.id,
        amount: 100,
        requestId: minted[mintedBefore],
        reason: 'refund agreed',
        confirmPaidCredits: true,
      }),
    ]);
    // One Credits re-read; today no top-ups re-read and no list re-read (BD-14 adds the list read in LF-4b, by name).
    await expectReads({ credits: 2, boost: 1, list: 1 });
  });

  it('TOPUP-2 (PIN-a): closing and pressing the top-up opener again opens the dialog again, with a new request id', async () => {
    const drawer = await openDrawer();
    const mintedBefore = minted.length;
    fireEvent.click(button(topUpRow(drawer), 'boost-take-back'));
    const first = await screen.findByTestId('credit-form-dialog');
    expect(minted).toHaveLength(mintedBefore + 1);
    fireEvent.keyDown(first, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('credit-form-dialog')).toBeNull());

    fireEvent.click(button(topUpRow(drawer), 'boost-take-back'));
    const second = await screen.findByTestId('credit-form-dialog');
    expect(minted).toHaveLength(mintedBefore + 2);
    fireEvent.change(within(second).getByTestId('credit-amount'), { target: { value: '1' } });
    fireEvent.change(within(second).getByTestId('credit-reason'), { target: { value: 'second opening' } });
    fireEvent.click(within(second).getByTestId('paid-credits-confirm'));
    fireEvent.click(button(second, 'credit-form-continue'));
    opsQueue.push(ok({ credits: 1, lotRemainingAfter: 13749, replayed: false }));
    fireEvent.click(button(second, 'credit-form-confirm'));
    await waitFor(() => expect(screen.queryByTestId('credit-form-dialog')).toBeNull());
    expect(minted[mintedBefore + 1]).not.toBe(minted[mintedBefore]);
    expect(posts().map((p) => requestOf(p))).toStrictEqual([
      opsPost({
        op: 'reduce_credit_lot',
        lotId: PAID_LOT.id,
        amount: 1,
        requestId: minted[mintedBefore + 1],
        reason: 'second opening',
        confirmPaidCredits: true,
      }),
    ]);
    await expectReads({ credits: 2, boost: 1, list: 1 });
  });

  it('TOPUP-3 (folded lot, F-2): with every lot row hidden, as a fold hides them, the top-up opener still opens Take back on its lot', async () => {
    const drawer = await openDrawer();
    // BD-8: a fold hides, never unmounts. There is no fold control yet, so the rows are hidden by hand.
    for (const row of within(drawer).getAllByTestId('credits-lot')) row.hidden = true;
    fireEvent.click(button(topUpRow(drawer), 'boost-take-back'));
    const dialog = await screen.findByTestId('credit-form-dialog');
    expect(within(dialog).getByRole('heading').textContent).toBe(`Take back credits from ${BUSINESS}`);
    expect(dialog.textContent).toContain('13,750 left on this gift.');
    expect(within(dialog).getByTestId('paid-credits-confirm')).toBeTruthy();
    expect(posts()).toEqual([]);
  });

  it('TOPUP-4a (lot not loaded): when the Credits read failed, the top-up says "Take back in Credits above" and offers no button', async () => {
    creditsReply = () => refused(500, 'Internal server error');
    const drawer = await openDrawer();
    expect(within(drawer).getByTestId('credits-error')).toBeTruthy();
    const row = topUpRow(drawer);
    expect(within(row).getByTestId('boost-take-back-above').textContent).toBe('Take back in Credits above');
    expect(within(row).queryByTestId('boost-take-back')).toBeNull();
    expect(within(row).queryByRole('button', { name: 'Take back credits' })).toBeNull();
  });

  it('TOPUP-4b (lot not loaded yet): while the Credits read runs the top-up says "Take back in Credits above"; once it lands the button appears', async () => {
    const gate = deferred<Reply>();
    const data = credits();
    let first = true;
    creditsReply = () => {
      if (!first) return ok(data);
      first = false;
      return gate.promise;
    };
    const drawer = await openDrawer(false);
    expect(within(drawer).getByText('Loading credits…')).toBeTruthy();
    expect(within(topUpRow(drawer)).getByTestId('boost-take-back-above').textContent).toBe('Take back in Credits above');
    expect(within(topUpRow(drawer)).queryByTestId('boost-take-back')).toBeNull();

    await act(async () => {
      gate.resolve(ok(data));
    });
    expect((await within(topUpRow(drawer)).findByTestId('boost-take-back')).textContent).toBe('Take back credits');
    expect(within(topUpRow(drawer)).queryByTestId('boost-take-back-above')).toBeNull();
  });

  it('TOPUP-5: a loaded lot with nothing left says "Nothing left to take back"; a top-up with no lot shows no take-back line', async () => {
    const usedUp: CreditLotView = { ...PAID_LOT, remaining: 0 };
    const data = credits([usedUp]);
    creditsReply = () => ok(data);
    boostData = boost({
      purchases: {
        status: 'ok',
        rows: [purchase(), purchase({ id: 'aaaaaaaa-1111-4111-8111-11111111111c', lotId: null, status: 'open' })],
        truncated: { test: false, live: false },
      },
    });
    const drawer = await openDrawer();
    const [withLot, withoutLot] = within(drawer).getAllByTestId('boost-purchase');
    expect(within(withLot).getByTestId('boost-take-back-none').textContent).toBe('Nothing left to take back');
    expect(within(withLot).queryByTestId('boost-take-back')).toBeNull();
    for (const testId of ['boost-take-back', 'boost-take-back-above', 'boost-take-back-none']) {
      expect(within(withoutLot).queryByTestId(testId)).toBeNull();
    }
  });
});

// ── Set limit / Back to default ─────────────────────────────────────────────

describe('Set limit and Back to default (PIN-d, PIN-e, PIN-f, PIN-g)', () => {
  it('CAP-1: Set limit: opener, words, confirm step; the exact set_boost_cap request; the notice from the response; one top-ups re-read', async () => {
    const drawer = await openDrawer();
    const opener = button(drawer, 'boost-cap-set');
    expect(opener.textContent).toBe('Set limit');
    expect(within(drawer).getByTestId('boost-cap').contains(opener)).toBe(true);
    expect(within(drawer).queryByTestId('boost-cap-end')).toBeNull();

    fireEvent.click(opener);
    const dialog = await screen.findByTestId('boost-cap-dialog');
    expect(within(dialog).getByRole('heading').textContent).toBe(`Set the top-up spending limit for ${BUSINESS}`);
    expect(dialog.textContent).toContain('Whole dollars, from $1 to $1,500, per 30 days. The reason is internal: the business never sees it.');
    expect(within(dialog).getByTestId('boost-cap-dialog-current').textContent).toBe('Now: $150 per 30 days (the default)');

    fillCap(dialog, '$500', '  annual prepay customer  ');
    expect(within(dialog).getByTestId('boost-cap-confirm-summary').textContent).toBe(`Set the limit of ${BUSINESS} to $500 per 30 days`);
    expect(within(dialog).getByTestId('boost-cap-confirm-now').textContent).toBe('$150 per 30 days (the default)');
    expect(within(dialog).getByTestId('boost-cap-confirm-after').textContent).toBe('$500 per 30 days (set by an admin)');
    expect(within(dialog).getByTestId('boost-cap-confirm-reason').textContent).toBe('annual prepay customer');
    expect(posts()).toEqual([]);

    opsQueue.push(ok({ accountId: DANA_ID, op: 'set_boost_cap', overrideId: 'n1', previousOverrideId: null, amountMinor: 50000 }));
    fireEvent.click(button(dialog, 'boost-cap-confirm'));
    const notice = await within(drawer).findByTestId('boost-notice');
    expect(noticeLines(notice)).toEqual([`Set the limit of ${BUSINESS} to $500 per 30 days.`]);
    expect(screen.queryByTestId('boost-cap-dialog')).toBeNull();

    expect(posts().map((p) => requestOf(p))).toStrictEqual([
      opsPost({ op: 'set_boost_cap', amountMinor: 50000, reason: 'annual prepay customer' }),
    ]);
    // One top-ups re-read, no Credits re-read, no list re-read.
    await expectReads({ credits: 1, boost: 2, list: 1 });
  });

  it('CAP-2: Back to default: opener only with an active limit, words, confirm step; the exact end_boost_cap request; the notice; one re-read', async () => {
    boostData = boost({ cap: { status: 'ok', default: DEFAULT_CAP, active: ACTIVE_CAP, history: [] } });
    const drawer = await openDrawer();
    const opener = button(drawer, 'boost-cap-end');
    expect(opener.textContent).toBe('Back to default');
    expect(within(drawer).getByTestId('boost-cap').contains(opener)).toBe(true);

    fireEvent.click(opener);
    const dialog = await screen.findByTestId('boost-cap-dialog');
    expect(within(dialog).getByRole('heading').textContent).toBe(`Return ${BUSINESS} to the default limit`);
    expect(dialog.textContent).toContain('The default is $150 per 30 days. The reason is internal: the business never sees it.');
    expect(within(dialog).getByTestId('boost-cap-dialog-current').textContent).toBe('Now: $500 per 30 days (set by an admin)');
    expect(within(dialog).queryByTestId('boost-cap-amount')).toBeNull();

    fillCap(dialog, null, 'prepay ended');
    expect(within(dialog).getByTestId('boost-cap-confirm-summary').textContent).toBe(
      `Return the limit of ${BUSINESS} to the default: $150 per 30 days`
    );
    expect(within(dialog).getByTestId('boost-cap-confirm-after').textContent).toBe('$150 per 30 days (the default)');
    expect(posts()).toEqual([]);

    opsQueue.push(ok({ accountId: DANA_ID, op: 'end_boost_cap', endedOverrideId: 'o1' }));
    fireEvent.click(button(dialog, 'boost-cap-confirm'));
    const notice = await within(drawer).findByTestId('boost-notice');
    expect(noticeLines(notice)).toEqual([`${BUSINESS} is back on the default limit of $150 per 30 days.`]);

    expect(posts().map((p) => requestOf(p))).toStrictEqual([opsPost({ op: 'end_boost_cap', reason: 'prepay ended' })]);
    await expectReads({ credits: 1, boost: 2, list: 1 });
  });

  it('CAP-3 (PIN-f): Set limit: a double click sends once; while in flight the dialog refuses Escape and Back is disabled', async () => {
    const drawer = await openDrawer();
    fireEvent.click(button(drawer, 'boost-cap-set'));
    const dialog = await screen.findByTestId('boost-cap-dialog');
    fillCap(dialog, '500', 'double click');
    const held = deferred<Reply>();
    opsQueue.push(held.promise);
    const confirm = button(dialog, 'boost-cap-confirm');
    act(() => {
      confirm.click();
      confirm.click();
    });
    expect(posts()).toHaveLength(1);
    expect(button(dialog, 'boost-cap-confirm').textContent).toBe('Saving…');
    expect(button(dialog, 'boost-cap-back').disabled).toBe(true);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await act(async () => undefined);
    expect(screen.getByTestId('boost-cap-dialog')).toBe(dialog);
    expect(screen.getByTestId('users-drawer').getAttribute('data-state')).toBe('open');
    await act(async () => {
      held.resolve(ok({ amountMinor: 50000 }));
    });
    await waitFor(() => expect(screen.queryByTestId('boost-cap-dialog')).toBeNull());
    expect(posts().map((p) => requestOf(p))).toStrictEqual([
      opsPost({ op: 'set_boost_cap', amountMinor: 50000, reason: 'double click' }),
    ]);
    await expectReads({ credits: 1, boost: 2, list: 1 });
  });

  it('CAP-4 (PIN-g): a Set limit refusal keeps the dialog open on the form with the mapped sentence; no notice, no re-read', async () => {
    const drawer = await openDrawer();
    fireEvent.click(button(drawer, 'boost-cap-set'));
    const dialog = await screen.findByTestId('boost-cap-dialog');
    fillCap(dialog, '500', 'write fails');
    opsQueue.push(refused(500, 'cap_override_write_failed'));
    fireEvent.click(button(dialog, 'boost-cap-confirm'));
    expect((await within(dialog).findByTestId('boost-cap-dialog-error')).textContent).toBe('The limit could not be saved. Try again.');
    await expectReads({ credits: 1, boost: 1, list: 1 });
    expect(screen.getByTestId('boost-cap-dialog')).toBe(dialog);
    expect(within(dialog).getByTestId('boost-cap-amount')).toBeTruthy();
    expect(within(drawer).queryByTestId('boost-notice')).toBeNull();
    expect(posts().map((p) => requestOf(p))).toStrictEqual([
      opsPost({ op: 'set_boost_cap', amountMinor: 50000, reason: 'write fails' }),
    ]);
  });

  it('CAP-5 (PIN-f, PIN-g): Back to default: a double click sends once, Escape is refused in flight, and a refusal stays open with its sentence', async () => {
    boostData = boost({ cap: { status: 'ok', default: DEFAULT_CAP, active: ACTIVE_CAP, history: [] } });
    const drawer = await openDrawer();
    fireEvent.click(button(drawer, 'boost-cap-end'));
    const dialog = await screen.findByTestId('boost-cap-dialog');
    fillCap(dialog, null, 'prepay ended');
    const held = deferred<Reply>();
    opsQueue.push(held.promise);
    const confirm = button(dialog, 'boost-cap-confirm');
    act(() => {
      confirm.click();
      confirm.click();
    });
    expect(posts()).toHaveLength(1);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await act(async () => undefined);
    expect(screen.getByTestId('boost-cap-dialog')).toBe(dialog);
    await act(async () => {
      held.resolve(refused(409, 'no_active_cap_override'));
    });
    expect((await within(dialog).findByTestId('boost-cap-dialog-error')).textContent).toBe('This business is already on the default limit.');
    expect(screen.getByTestId('boost-cap-dialog')).toBe(dialog);
    expect(within(drawer).queryByTestId('boost-notice')).toBeNull();
    expect(posts().map((p) => requestOf(p))).toStrictEqual([opsPost({ op: 'end_boost_cap', reason: 'prepay ended' })]);
    await expectReads({ credits: 1, boost: 1, list: 1 });
  });
});

// ── Run billing reconcile ───────────────────────────────────────────────────

describe('Run billing reconcile (PIN-e, PIN-f, PIN-g; moves to Jobs in LF-4c with the same request assertions)', () => {
  it("REC-1: opener, words, confirm step; POST, the header, the literal body '{}', cache no-store; the counts as the notice; one top-ups re-read", async () => {
    const drawer = await openDrawer();
    const opener = button(drawer, 'boost-reconcile');
    expect(opener.textContent).toBe('Run billing reconcile now (all accounts)');
    expect(within(drawer).getByTestId('boost-block').contains(opener)).toBe(true);

    fireEvent.click(opener);
    const dialog = await screen.findByTestId('boost-reconcile-dialog');
    expect(within(dialog).getByRole('heading').textContent).toBe('Run billing reconcile now');
    expect(within(dialog).getByTestId('boost-reconcile-description').textContent).toBe(
      'This checks Stripe for unfinished credit top-ups of every business, not only this one. It may add credits, close expired checkouts or mark failed payments, exactly as the nightly run at 05:41 UTC does.'
    );
    expect(button(dialog, 'boost-reconcile-run').textContent).toBe('Run now');
    expect(posts()).toEqual([]);

    reconcileQueue.push(ok(RECONCILE_OK));
    fireEvent.click(button(dialog, 'boost-reconcile-run'));
    const notice = await within(drawer).findByTestId('boost-notice');
    expect(noticeLines(notice)).toEqual([
      'Reconcile finished: 3 stuck top-ups examined, 1 credited, 0 expired, 0 marked failed, 0 need a person, 0 left for the next run.',
    ]);
    expect(screen.queryByTestId('boost-reconcile-dialog')).toBeNull();

    expect(posts().map((p) => requestOf(p, true))).toStrictEqual([RECONCILE_POST]);
    // One top-ups re-read, no Credits re-read, no list re-read.
    await expectReads({ credits: 1, boost: 2, list: 1 });
  });

  it('REC-2 (PIN-f): a double click on Run sends once; while running, Run says Running…, Close is disabled and Escape is refused', async () => {
    const drawer = await openDrawer();
    fireEvent.click(button(drawer, 'boost-reconcile'));
    const dialog = await screen.findByTestId('boost-reconcile-dialog');
    const held = deferred<Reply>();
    reconcileQueue.push(held.promise);
    const run = button(dialog, 'boost-reconcile-run');
    act(() => {
      run.click();
      run.click();
    });
    expect(posts()).toHaveLength(1);
    expect(button(dialog, 'boost-reconcile-run').textContent).toBe('Running…');
    expect(button(dialog, 'boost-reconcile-run').disabled).toBe(true);
    expect(button(dialog, 'boost-reconcile-close').disabled).toBe(true);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await act(async () => undefined);
    expect(screen.getByTestId('boost-reconcile-dialog')).toBe(dialog);
    expect(screen.getByTestId('users-drawer').getAttribute('data-state')).toBe('open');
    await act(async () => {
      held.resolve(ok(RECONCILE_OK));
    });
    await waitFor(() => expect(screen.queryByTestId('boost-reconcile-dialog')).toBeNull());
    expect(posts().map((p) => requestOf(p, true))).toStrictEqual([RECONCILE_POST]);
    await expectReads({ credits: 1, boost: 2, list: 1 });
  });

  it('REC-3 (PIN-g, QA6b-M1): a 200 whose pass failed shows the failure words and stays open; no notice, no re-read; Run again sends the same body', async () => {
    const drawer = await openDrawer();
    fireEvent.click(button(drawer, 'boost-reconcile'));
    const dialog = await screen.findByTestId('boost-reconcile-dialog');
    reconcileQueue.push(ok({ ...RECONCILE_OK, passesFailed: 1 }));
    fireEvent.click(button(dialog, 'boost-reconcile-run'));
    expect((await within(dialog).findByTestId('boost-reconcile-error')).textContent).toBe(
      'The reconcile could not run. Nothing is lost: the nightly run will try again.'
    );
    await expectReads({ credits: 1, boost: 1, list: 1 });
    expect(screen.getByTestId('boost-reconcile-dialog')).toBe(dialog);
    expect(within(drawer).queryByTestId('boost-notice')).toBeNull();
    expect(posts().map((p) => requestOf(p, true))).toStrictEqual([RECONCILE_POST]);

    reconcileQueue.push(ok(RECONCILE_OK));
    fireEvent.click(button(dialog, 'boost-reconcile-run'));
    await waitFor(() => expect(screen.queryByTestId('boost-reconcile-dialog')).toBeNull());
    expect(posts().map((p) => requestOf(p, true))).toStrictEqual([RECONCILE_POST, RECONCILE_POST]);
    await expectReads({ credits: 1, boost: 2, list: 1 });
  });
});
