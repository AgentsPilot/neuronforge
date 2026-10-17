/**
 * @jest-environment jsdom
 */

/**
 * LF-4a.1 pin suite, part 1 of 3: the Credits block's money actions, through
 * the WHOLE Businesses drawer (requirement ADMIN_LAYOUT_FOLLOWUPS §1.3,
 * PIN-a, PIN-b, PIN-c, PIN-e, PIN-f, PIN-g, PIN-h; SA-C5).
 *
 * Characterisation, not specification: every assertion is what the unchanged
 * code does on 2026-10-13. LF-4a.2 / LF-4b may edit these tests only where an
 * opener moves (plus BD-14's named re-read edit), never the request or the
 * confirm step. Pin list: docs/workplans/ADMIN_LAYOUT_LF4A1_WORKPLAN.md.
 *
 * The page is rendered, the row's Open button opens the drawer, and every
 * request is recorded with its URL, method, headers, raw body and `cache`
 * option. `crypto.randomUUID` is a counter that records what it minted.
 * Every test fails on any console error or warning, and on any request the
 * stub does not know. The stub, the waits, the uuid counter and the guard are
 * the shared pin harness (`tests/admin/drawerPinHarness.ts`, LF-4b Step 12);
 * the route table below is this file's own.
 */

import React from 'react';
import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import {
  deferred,
  fromQueue,
  getCount,
  installFetch,
  installPinLifecycle,
  listReads,
  minted,
  posts,
  quiet,
  requestOf,
  settle,
  setRoutes,
  unexpected,
  type Queued,
  type Reply,
} from '@/tests/admin/drawerPinHarness';

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

function lot(overrides: Partial<CreditLotView> = {}): CreditLotView {
  return {
    id: 'aaaaaaaa-1111-4111-8111-11111111111a',
    source: 'admin_grant',
    credits: 300,
    remaining: 200,
    expired: false,
    counted: true,
    expiresAt: null,
    reason: 'goodwill after the outage',
    actorKind: 'admin',
    actorAdminId: ADMIN_ID,
    createdAt: '2026-09-01T00:00:00.000Z',
    takeBacks: [],
    ...overrides,
  };
}

const ADMIN_LOT = lot();
const PAID_LOT = lot({
  id: 'cccccccc-3333-4333-8333-33333333333c', source: 'boost_purchase', credits: 13750, remaining: 13750,
  actorKind: 'stripe_webhook', actorAdminId: null, reason: null, createdAt: '2026-10-01T12:05:00.000Z',
});

function credits(overrides: Partial<AccountCreditPositionPayload> = {}): AccountCreditPositionPayload {
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
    extra: { status: 'ok', extraCredits: 14050, hasInconsistentLot: false, lots: [ADMIN_LOT, PAID_LOT] },
    ...overrides,
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

const ACTIVE_CAP = { id: 'o1', amountMinor: 50000, currency: 'USD', reason: 'annual prepay customer', actorAdminId: ADMIN_ID, createdAt: '2026-10-02T09:00:00.000Z' };

function boost(overrides: Partial<AdminBoostView> = {}): AdminBoostView {
  return {
    accountId: DANA_ID,
    isOwnAccount: false,
    serverMode: 'test',
    purchases: { status: 'ok', rows: [], truncated: { test: false, live: false } },
    cap: { status: 'ok', default: { amountMinor: 15000, currency: 'USD', windowDays: 30 }, active: null, history: [] },
    limits: { minMinor: 100, maxMinor: 150000, stepMinor: 100, currency: 'USD', windowDays: 30, reasonMin: 3, reasonMax: 500 },
    ...overrides,
  };
}

// ── The route table (the recording stub is the shared pin harness) ──────────

let creditsData: AccountCreditPositionPayload;
let boostData: AdminBoostView;
let opsQueue: Queued[] = [];

const ok = (data: unknown): Reply => ({ status: 200, body: { success: true, data } });
const refused = (status: number, error: string, details?: Record<string, unknown>): Reply => ({
  status,
  body: { success: false, error, ...(details ? { details } : {}) },
});

/** Data export DE-10a: the Data export box's status read, an account with no export. */
const NO_EXPORTS = { exports: [], ownerDownloadedLatest: false, isOwnAccount: false, dailyLimit: 3 };

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
  if (url === CREDITS_URL) return ok(creditsData);
  if (url === ARCHIVING_URL) return { status: 200, body: ARCHIVING };
  // Data export DE-10a: the drawer's Data export box reads its status once per open.
  if (url.startsWith('/api/admin/users/') && url.endsWith('/data-exports')) return ok(NO_EXPORTS);
  if (url === CLEANUP_CHECK_URL) return ok({ configured: true });
  unexpected.push(`GET ${url}`);
  return refused(404, 'not mocked');
}

function routePost(url: string): Queued {
  if (url === OPS_URL) return fromQueue(opsQueue, url);
  unexpected.push(`POST ${url}`);
  return refused(404, 'not mocked');
}

/** The final read counts, once the drawer has gone quiet. */
async function expectReads(expected: { credits: number; boost: number; list: number }) {
  await quiet();
  expect({ credits: getCount(CREDITS_URL), boost: getCount(BOOST_URL), list: listReads() }).toStrictEqual(expected);
}

/** The page, the drawer open on Dana through the row's Open button, every per-open read settled. */
async function openDrawer(): Promise<HTMLElement> {
  installFetch();
  render(<UsersPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open details for Dana Cohen' }));
  const drawer = await screen.findByTestId('users-drawer');
  await within(drawer).findByTestId('danger-area');
  await within(drawer).findByTestId('credits-extra');
  await within(drawer).findByTestId('boost-cap');
  await waitFor(() => expect(getCount(ARCHIVING_URL)).toBe(1));
  await waitFor(() => expect(getCount(CLEANUP_CHECK_URL)).toBe(1));
  await settle();
  return drawer;
}

const button = (root: HTMLElement, testId: string) => within(root).getByTestId(testId) as HTMLButtonElement;
const noticeLines = (notice: HTMLElement) => Array.from(notice.querySelectorAll('p')).map((p) => p.textContent);

/** Give: amount, end (null = no end date) and reason, then Continue. */
function fillGive(dialog: HTMLElement, amount: string, endLocal: string | null, reason: string) {
  fireEvent.change(within(dialog).getByTestId('credit-amount'), { target: { value: amount } });
  if (endLocal === null) {
    fireEvent.click(within(dialog).getByTestId('no-end-date-choice'));
  } else {
    fireEvent.click(within(dialog).getByTestId('end-date-choice'));
    fireEvent.change(within(dialog).getByTestId('end-date-input'), { target: { value: endLocal } });
  }
  fireEvent.change(within(dialog).getByTestId('credit-reason'), { target: { value: reason } });
}

async function openGive(drawer: HTMLElement): Promise<HTMLElement> {
  fireEvent.click(button(drawer, 'credits-give'));
  return screen.findByTestId('credit-form-dialog');
}

async function openTakeBack(drawer: HTMLElement, index: number): Promise<HTMLElement> {
  fireEvent.click(within(drawer).getAllByTestId('credits-take-back')[index]);
  return screen.findByTestId('credit-form-dialog');
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

// The shared harness: browser shims, emptied records, the uuid counter, the
// console and unexpected-request guard after every test.
setRoutes(routeGet, routePost);
installPinLifecycle({ countUuids: true });

beforeEach(() => {
  opsQueue = [];
  creditsData = credits();
  boostData = boost();
});

// ── Give credits ────────────────────────────────────────────────────────────

/** The whole expected request of a credit op (PIN-e: URL, method, headers, cache, body). */
const opsPost = (body: Record<string, unknown>) => ({ url: OPS_URL, method: 'POST', headers: JSON_HEADERS, cache: 'no-store', body });

describe('Give credits (PIN-c, PIN-e, PIN-a, PIN-f, PIN-g)', () => {
  it('GIVE-1: opener, words, confirm step, no end date: the exact request, the notice from the response, one Credits re-read', async () => {
    const drawer = await openDrawer();
    const give = button(drawer, 'credits-give');
    expect(give.textContent).toBe('Give credits');
    expect(within(drawer).getByTestId('credits-block').contains(give)).toBe(true);

    const dialog = await openGive(drawer);
    expect(within(dialog).getByRole('heading').textContent).toBe(`Give credits to ${BUSINESS}`);
    expect(dialog.textContent).toContain('Whole credits, from 1 to 100,000. The reason is internal: the business never sees it.');
    expect(button(dialog, 'credit-form-continue').disabled).toBe(true);

    fillGive(dialog, '1000', null, '  goodwill gesture  ');
    expect(posts()).toEqual([]);
    fireEvent.click(button(dialog, 'credit-form-continue'));
    // The confirm step: nothing is sent until Confirm.
    expect(within(dialog).getByTestId('credit-confirm-summary').textContent).toBe(`Give 1,000 credits to ${BUSINESS}`);
    expect(within(dialog).getByTestId('credit-confirm-end').textContent).toBe('No end date');
    expect(within(dialog).getByTestId('credit-confirm-reason').textContent).toBe('goodwill gesture');
    expect(posts()).toEqual([]);

    opsQueue.push(ok({ credits: 1000, expiresAt: null, replayed: false }));
    fireEvent.click(button(dialog, 'credit-form-confirm'));

    const notice = await within(drawer).findByTestId('credits-success');
    expect(noticeLines(notice)).toEqual([`Gave 1,000 credits to ${BUSINESS}, with no end date.`]);
    expect(screen.queryByTestId('credit-form-dialog')).toBeNull();

    expect(posts().map((p) => requestOf(p))).toStrictEqual([
      opsPost({ op: 'grant_credits', amount: 1000, expiresAt: null, requestId: minted[minted.length - 1], reason: 'goodwill gesture' }),
    ]);
    // One Credits re-read and one list re-read (BD-14, LF-4b); no top-ups re-read.
    await expectReads({ credits: 2, boost: 1, list: 2 });
  });

  it('GIVE-2: a dated gift sends the local end time as an ISO instant; the confirm step shows what is sent; the notice reads the response', async () => {
    const drawer = await openDrawer();
    const dialog = await openGive(drawer);
    const endLocal = '2099-01-02T03:04';
    const instant = new Date(endLocal).toISOString();
    fillGive(dialog, '250', endLocal, 'loyalty');
    fireEvent.click(button(dialog, 'credit-form-continue'));
    expect(within(dialog).getByTestId('credit-confirm-summary').textContent).toBe(`Give 250 credits to ${BUSINESS}`);
    expect(within(dialog).getByTestId('credit-confirm-end').textContent).toContain(`(sent as ${instant})`);

    opsQueue.push(ok({ credits: 250, expiresAt: '2099-01-02T01:04:00.000Z', replayed: false }));
    fireEvent.click(button(dialog, 'credit-form-confirm'));
    const notice = await within(drawer).findByTestId('credits-success');
    expect(noticeLines(notice)).toEqual([`Gave 250 credits to ${BUSINESS}, ending 2099-01-02 01:04 UTC.`]);

    expect(posts().map((p) => requestOf(p))).toStrictEqual([
      opsPost({ op: 'grant_credits', amount: 250, expiresAt: instant, requestId: minted[minted.length - 1], reason: 'loyalty' }),
    ]);
    await expectReads({ credits: 2, boost: 1, list: 2 });
  });

  it('GIVE-3 (PIN-a): one request id per opening, the same id on the retry after a failure, a new id on the next opening', async () => {
    const drawer = await openDrawer();

    const mintedBefore = minted.length;
    let dialog = await openGive(drawer);
    expect(minted).toHaveLength(mintedBefore + 1);
    const firstId = minted[minted.length - 1];

    fillGive(dialog, '10', null, 'first try');
    fireEvent.click(button(dialog, 'credit-form-continue'));
    opsQueue.push(refused(500, 'Internal server error'));
    fireEvent.click(button(dialog, 'credit-form-confirm'));
    expect((await within(dialog).findByTestId('credit-form-error')).textContent).toBe(
      'Something failed on the server. The correlation id is in the logs.'
    );
    // Back on the form step, nothing reset, no new id.
    expect(within(dialog).getByTestId('credit-form-continue')).toBeTruthy();
    expect(minted).toHaveLength(mintedBefore + 1);

    fireEvent.click(button(dialog, 'credit-form-continue'));
    opsQueue.push(ok({ credits: 10, expiresAt: null, replayed: false }));
    fireEvent.click(button(dialog, 'credit-form-confirm'));
    await within(drawer).findByTestId('credits-success');
    await waitFor(() => expect(screen.queryByTestId('credit-form-dialog')).toBeNull());
    await settle();

    dialog = await openGive(drawer);
    expect(minted).toHaveLength(mintedBefore + 2);
    const secondId = minted[minted.length - 1];
    expect(secondId).not.toBe(firstId);
    fillGive(dialog, '10', null, 'second gift');
    fireEvent.click(button(dialog, 'credit-form-continue'));
    opsQueue.push(ok({ credits: 10, expiresAt: null, replayed: false }));
    fireEvent.click(button(dialog, 'credit-form-confirm'));
    await waitFor(() => expect(screen.queryByTestId('credit-form-dialog')).toBeNull());

    expect(posts().map((p) => requestOf(p))).toStrictEqual([
      opsPost({ op: 'grant_credits', amount: 10, expiresAt: null, requestId: firstId, reason: 'first try' }),
      opsPost({ op: 'grant_credits', amount: 10, expiresAt: null, requestId: firstId, reason: 'first try' }),
      opsPost({ op: 'grant_credits', amount: 10, expiresAt: null, requestId: secondId, reason: 'second gift' }),
    ]);
    await expectReads({ credits: 3, boost: 1, list: 3 });
  });

  it('GIVE-4 (PIN-f): a double click sends once; while in flight the dialog refuses Escape and its Back is disabled', async () => {
    const drawer = await openDrawer();
    const dialog = await openGive(drawer);
    fillGive(dialog, '5', null, 'double click');
    fireEvent.click(button(dialog, 'credit-form-continue'));

    const held = deferred<Reply>();
    opsQueue.push(held.promise);
    const confirm = button(dialog, 'credit-form-confirm');
    // Two clicks before React re-renders: only the in-flight guard can refuse the second.
    act(() => {
      confirm.click();
      confirm.click();
    });
    expect(posts()).toHaveLength(1);
    expect(button(dialog, 'credit-form-confirm').textContent).toBe('Saving…');
    expect(button(dialog, 'credit-form-confirm').disabled).toBe(true);
    expect(button(dialog, 'credit-form-back').disabled).toBe(true);

    fireEvent.keyDown(dialog, { key: 'Escape' });
    await act(async () => undefined);
    expect(screen.getByTestId('credit-form-dialog')).toBe(dialog);
    expect(screen.getByTestId('users-drawer').getAttribute('data-state')).toBe('open');

    await act(async () => {
      held.resolve(ok({ credits: 5, expiresAt: null, replayed: false }));
    });
    await waitFor(() => expect(screen.queryByTestId('credit-form-dialog')).toBeNull());
    expect(posts().map((p) => requestOf(p))).toStrictEqual([
      opsPost({ op: 'grant_credits', amount: 5, expiresAt: null, requestId: minted[minted.length - 1], reason: 'double click' }),
    ]);
    await expectReads({ credits: 2, boost: 1, list: 2 });
  });

  it('GIVE-5 (PIN-g): a refusal keeps the dialog open with the mapped sentence; no notice, no re-read', async () => {
    const drawer = await openDrawer();
    const dialog = await openGive(drawer);
    fillGive(dialog, '5', null, 'not yet paid');
    fireEvent.click(button(dialog, 'credit-form-continue'));
    opsQueue.push(refused(409, 'awaiting_payment'));
    fireEvent.click(button(dialog, 'credit-form-confirm'));

    expect((await within(dialog).findByTestId('credit-form-error')).textContent).toBe(
      'This account is waiting for its first payment. Credits cannot be given until it has paid.'
    );
    await expectReads({ credits: 1, boost: 1, list: 1 });
    expect(screen.getByTestId('credit-form-dialog')).toBe(dialog);
    expect(within(drawer).queryByTestId('credits-success')).toBeNull();
    expect(posts().map((p) => requestOf(p))).toStrictEqual([
      opsPost({ op: 'grant_credits', amount: 5, expiresAt: null, requestId: minted[minted.length - 1], reason: 'not yet paid' }),
    ]);
  });
});

// ── Take back ───────────────────────────────────────────────────────────────

describe('Take back on a lot (PIN-b, PIN-e, PIN-a, PIN-f, PIN-g)', () => {
  it('TAKE-1: opener on the lot row, words, confirm step; a number: the exact request without confirmPaidCredits; the notice from the response; one re-read', async () => {
    const drawer = await openDrawer();
    const takeBacks = within(drawer).getAllByTestId('credits-take-back');
    expect(takeBacks.map((b) => b.textContent)).toEqual(['Take back', 'Take back']);
    expect(within(drawer).getAllByTestId('credits-lot')[0].contains(takeBacks[0])).toBe(true);

    const mintedBefore = minted.length;
    const dialog = await openTakeBack(drawer, 0);
    expect(minted).toHaveLength(mintedBefore + 1);
    expect(within(dialog).getByRole('heading').textContent).toBe(`Take back credits from ${BUSINESS}`);
    expect(dialog.textContent).toContain('200 left on this gift. The reason is internal: the business never sees it.');
    expect(within(dialog).queryByTestId('paid-credits-confirm')).toBeNull();

    fireEvent.change(within(dialog).getByTestId('credit-amount'), { target: { value: '50' } });
    fireEvent.change(within(dialog).getByTestId('credit-reason'), { target: { value: 'mistaken amount' } });
    fireEvent.click(button(dialog, 'credit-form-continue'));
    expect(within(dialog).getByTestId('credit-confirm-summary').textContent).toBe(`Take back 50 credits from ${BUSINESS}`);
    expect(dialog.textContent).toContain('300 credits, given 2026-09-01 00:00 UTC');
    expect(posts()).toEqual([]);

    opsQueue.push(ok({ credits: 50, lotRemainingAfter: 150, replayed: false }));
    fireEvent.click(button(dialog, 'credit-form-confirm'));
    const notice = await within(drawer).findByTestId('credits-success');
    expect(noticeLines(notice)).toEqual([`Took back 50 credits from ${BUSINESS}; 150 left on this gift.`]);

    expect(posts().map((p) => requestOf(p))).toStrictEqual([
      opsPost({ op: 'reduce_credit_lot', lotId: ADMIN_LOT.id, amount: 50, requestId: minted[mintedBefore], reason: 'mistaken amount' }),
    ]);
    await expectReads({ credits: 2, boost: 1, list: 2 });
  });

  it("TAKE-2: 'Everything left' sends amount 'rest' and says so on the confirm step", async () => {
    const drawer = await openDrawer();
    const dialog = await openTakeBack(drawer, 0);
    fireEvent.click(within(dialog).getByTestId('take-everything-choice'));
    expect(within(dialog).queryByTestId('credit-amount')).toBeNull();
    fireEvent.change(within(dialog).getByTestId('credit-reason'), { target: { value: 'closing the gift' } });
    fireEvent.click(button(dialog, 'credit-form-continue'));
    expect(within(dialog).getByTestId('credit-confirm-summary').textContent).toBe(
      `Take back everything left on this gift from ${BUSINESS}`
    );
    opsQueue.push(ok({ credits: 200, lotRemainingAfter: 0, replayed: false }));
    fireEvent.click(button(dialog, 'credit-form-confirm'));
    await waitFor(() => expect(screen.queryByTestId('credit-form-dialog')).toBeNull());

    expect(posts().map((p) => requestOf(p))).toStrictEqual([
      opsPost({ op: 'reduce_credit_lot', lotId: ADMIN_LOT.id, amount: 'rest', requestId: minted[minted.length - 1], reason: 'closing the gift' }),
    ]);
    await expectReads({ credits: 2, boost: 1, list: 2 });
  });

  it('TAKE-3: a paid lot blocks Continue until the paid confirmation is ticked, and only then sends confirmPaidCredits', async () => {
    const drawer = await openDrawer();
    const dialog = await openTakeBack(drawer, 1);
    expect(dialog.textContent).toContain('13,750 left on this gift.');
    expect(dialog.textContent).toContain('These credits were paid for. Taking them back does not refund the payment.');
    fireEvent.change(within(dialog).getByTestId('credit-amount'), { target: { value: '100' } });
    fireEvent.change(within(dialog).getByTestId('credit-reason'), { target: { value: 'refund agreed' } });
    expect(button(dialog, 'credit-form-continue').disabled).toBe(true);
    fireEvent.click(within(dialog).getByTestId('paid-credits-confirm'));
    expect(button(dialog, 'credit-form-continue').disabled).toBe(false);
    fireEvent.click(button(dialog, 'credit-form-continue'));

    opsQueue.push(ok({ credits: 100, lotRemainingAfter: 13650, replayed: false }));
    fireEvent.click(button(dialog, 'credit-form-confirm'));
    await waitFor(() => expect(screen.queryByTestId('credit-form-dialog')).toBeNull());
    expect(posts().map((p) => requestOf(p))).toStrictEqual([
      opsPost({
        op: 'reduce_credit_lot',
        lotId: PAID_LOT.id,
        amount: 100,
        requestId: minted[minted.length - 1],
        reason: 'refund agreed',
        confirmPaidCredits: true,
      }),
    ]);
    await expectReads({ credits: 2, boost: 1, list: 2 });
  });

  it('TAKE-4 (PIN-g, PIN-a): exceeds_remaining keeps the dialog open with the remaining figure; the retry reuses the request id', async () => {
    const drawer = await openDrawer();
    const dialog = await openTakeBack(drawer, 0);
    const id = minted[minted.length - 1];
    fireEvent.change(within(dialog).getByTestId('credit-amount'), { target: { value: '150' } });
    fireEvent.change(within(dialog).getByTestId('credit-reason'), { target: { value: 'too much' } });
    fireEvent.click(button(dialog, 'credit-form-continue'));
    opsQueue.push(refused(409, 'exceeds_remaining', { remaining: 120 }));
    fireEvent.click(button(dialog, 'credit-form-confirm'));

    expect((await within(dialog).findByTestId('credit-form-error')).textContent).toBe('Only 120 are left on this gift.');
    await expectReads({ credits: 1, boost: 1, list: 1 });
    expect(screen.getByTestId('credit-form-dialog')).toBe(dialog);
    expect(within(drawer).queryByTestId('credits-success')).toBeNull();

    fireEvent.change(within(dialog).getByTestId('credit-amount'), { target: { value: '120' } });
    fireEvent.click(button(dialog, 'credit-form-continue'));
    opsQueue.push(ok({ credits: 120, lotRemainingAfter: 0, replayed: false }));
    fireEvent.click(button(dialog, 'credit-form-confirm'));
    await waitFor(() => expect(screen.queryByTestId('credit-form-dialog')).toBeNull());
    expect(posts().map((p) => requestOf(p))).toStrictEqual([
      opsPost({ op: 'reduce_credit_lot', lotId: ADMIN_LOT.id, amount: 150, requestId: id, reason: 'too much' }),
      opsPost({ op: 'reduce_credit_lot', lotId: ADMIN_LOT.id, amount: 120, requestId: id, reason: 'too much' }),
    ]);
    await expectReads({ credits: 2, boost: 1, list: 2 });
  });

  it('TAKE-5 (PIN-f): a double click sends once; while in flight the dialog refuses Escape', async () => {
    const drawer = await openDrawer();
    const dialog = await openTakeBack(drawer, 0);
    fireEvent.change(within(dialog).getByTestId('credit-amount'), { target: { value: '1' } });
    fireEvent.change(within(dialog).getByTestId('credit-reason'), { target: { value: 'double click' } });
    fireEvent.click(button(dialog, 'credit-form-continue'));
    const held = deferred<Reply>();
    opsQueue.push(held.promise);
    const confirm = button(dialog, 'credit-form-confirm');
    act(() => {
      confirm.click();
      confirm.click();
    });
    expect(posts()).toHaveLength(1);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await act(async () => undefined);
    expect(screen.getByTestId('credit-form-dialog')).toBe(dialog);
    await act(async () => {
      held.resolve(ok({ credits: 1, lotRemainingAfter: 199, replayed: false }));
    });
    await waitFor(() => expect(screen.queryByTestId('credit-form-dialog')).toBeNull());
    expect(posts().map((p) => requestOf(p))).toStrictEqual([
      opsPost({ op: 'reduce_credit_lot', lotId: ADMIN_LOT.id, amount: 1, requestId: minted[minted.length - 1], reason: 'double click' }),
    ]);
    await expectReads({ credits: 2, boost: 1, list: 2 });
  });
});

// ── Own account ─────────────────────────────────────────────────────────────

describe("the admin's own account (PIN-h)", () => {
  it('OWN-1: no money button renders in either block, even with take-back-able lots, a top-up lot and an active limit', async () => {
    creditsData = credits({ isOwnAccount: true });
    boostData = boost({
      isOwnAccount: true,
      purchases: { status: 'ok', rows: [purchase()], truncated: { test: false, live: false } },
      cap: { status: 'ok', default: { amountMinor: 15000, currency: 'USD', windowDays: 30 }, active: ACTIVE_CAP, history: [] },
    });
    const drawer = await openDrawer();
    for (const testId of [
      'credits-give',
      'credits-take-back',
      'boost-cap-set',
      'boost-cap-end',
      'boost-reconcile',
      'boost-take-back',
      'boost-take-back-above',
      'boost-take-back-none',
    ]) {
      expect({ testId, count: within(drawer).queryAllByTestId(testId).length }).toEqual({ testId, count: 0 });
    }
    for (const name of ['Give credits', 'Take back', 'Take back credits', 'Set limit', 'Back to default', 'Run billing reconcile now (all accounts)']) {
      expect(within(drawer).queryByRole('button', { name })).toBeNull();
    }
    expect(within(drawer).queryByRole('button', { name: 'Reconcile top-ups now (all accounts)' })).toBeNull();
    expect(within(drawer).getByTestId('credits-own-account').textContent).toBe(
      'You cannot change credits on your own account. Another admin has to do it.'
    );
    expect(within(drawer).getByTestId('boost-own-account').textContent).toBe('This is your own account: an admin cannot change it.');
    // The lots and the limit are still shown, read-only.
    expect(within(drawer).getAllByTestId('credits-lot')).toHaveLength(2);
    expect(within(drawer).getByTestId('boost-cap-override')).toBeTruthy();
    expect(posts()).toEqual([]);
    await expectReads({ credits: 1, boost: 1, list: 1 });
  });
});
