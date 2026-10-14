/**
 * @jest-environment jsdom
 */

/**
 * Inside the money blocks of the Businesses drawer (Admin Layout follow-ups
 * LF-4b): the action bars (BD-5), the lot and top-up folds (BD-8, BD-9), one
 * list re-read after a successful Give or Take back and the agreement it buys
 * (BD-14, AC-4.10, SA C3), focus return on close (BD-15, AC-4.7, F-108) and the
 * contrast of the money blocks' information lines (§4).
 *
 * Through the whole page, opened from the row's Open button, on the shared
 * pin harness (`tests/admin/drawerPinHarness.ts`, LF-4b Step 12) with this
 * file's own route table. Requests are compared here as "METHOD url" lines;
 * their bodies, headers and `cache` are pinned by `businessDrawer.pins.*`.
 */

import React from 'react';
import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import {
  calls,
  deferred,
  fromQueue,
  installFetch,
  installPinLifecycle,
  quiet,
  setRoutes,
  unexpected,
  type Call,
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
}));

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
}));

import UsersPage from '../page';
import { ADMIN_BUTTON } from '@/app/admin/components/layout/adminTable';
import { MONEY_ACTION_BAR } from '../components/moneyBlockUi';
import recordedAccountBody from '@/app/admin/business-os-tiers/__tests__/__fixtures__/recordedAccountBody.json';
import type { AccountCreditPositionPayload, CreditLotView } from '../types';
import type { AdminBoostPurchaseRow, AdminBoostView } from '@/lib/business-os/boost/boostAdminViewTypes';

// As the pin and layout files: the whole page under a parallel Jest run can be
// slow to settle. A longer wait can only turn a pass into a fail.
jest.setTimeout(30_000);
configure({ asyncUtilTimeout: 5000 });

// ── Fixtures ────────────────────────────────────────────────────────────────

const DANA_ID = '99999999-9999-4999-8999-999999999999';
const ADMIN_ID = 'abcdef12-3456-4789-8abc-def012345678';
const CREDITS_URL = `/api/admin/business-os/credits/accounts/${DANA_ID}`;
const BOOST_URL = `${CREDITS_URL}/boost`;
const OPS_URL = `/api/admin/business-os/entitlements/accounts/${DANA_ID}`;
const LINK_CLASS = 'text-xs text-blue-300 underline hover:text-blue-200';

/** Dana's row; its "Credits left" changes from the second list read on (BD-14). */
function danaRow(listRead: number) {
  return {
    id: DANA_ID, full_name: 'Dana Cohen', company: null, email: 'dana@example.com', email_confirmed: true,
    last_sign_in_at: '2026-10-10T08:05:00Z', created_at: '2026-09-01T00:00:00Z', providers: ['email'], role: 'authenticated',
    business: { companyName: 'Acme Therapy', vertical: 'therapist' },
    creditsLeft: { kind: 'percent', value: listRead <= 1 ? 40 : 30, trial: false },
  };
}

function lot(n: number, over: Partial<CreditLotView> = {}): CreditLotView {
  return {
    id: `aaaaaaaa-1111-4111-8111-00000000000${n}`,
    source: 'admin_grant',
    credits: n * 100,
    remaining: n * 100,
    expired: false,
    counted: true,
    expiresAt: null,
    reason: null,
    actorKind: 'admin',
    actorAdminId: ADMIN_ID,
    createdAt: `2026-09-0${n}T00:00:00.000Z`,
    takeBacks: [],
    ...over,
  };
}

const PAID_LOT = lot(9, { source: 'boost_purchase', credits: 13750, remaining: 13750, actorKind: 'stripe_webhook', actorAdminId: null });

function creditsPayload(lots: CreditLotView[], over: Partial<AccountCreditPositionPayload> = {}): AccountCreditPositionPayload {
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
    extra: { status: 'ok', extraCredits: 14050, hasInconsistentLot: false, lots },
    ...over,
  };
}

function purchase(n: number, over: Partial<AdminBoostPurchaseRow> = {}): AdminBoostPurchaseRow {
  return {
    id: `bbbbbbbb-2222-4222-8222-00000000000${n}`,
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
    lotId: null,
    stripe: { paymentIntentId: `pi_3Test${n}`, chargeId: null, disputeId: null, checkoutSessionId: null },
    createdAt: `2026-10-0${n}T12:00:00.000Z`,
    paidAt: `2026-10-0${n}T12:05:00.000Z`,
    statusChangedAt: `2026-10-0${n}T12:05:00.000Z`,
    checkoutExpiresAt: `2026-10-0${n}T12:30:00.000Z`,
    ...over,
  };
}

const ACTIVE_CAP = { id: 'o1', amountMinor: 50000, currency: 'USD', reason: 'annual prepay customer', actorAdminId: ADMIN_ID, createdAt: '2026-10-02T09:00:00.000Z' };

function boostView(over: Partial<AdminBoostView> = {}): AdminBoostView {
  return {
    accountId: DANA_ID,
    isOwnAccount: false,
    serverMode: 'test',
    purchases: { status: 'ok', rows: [purchase(1, { lotId: PAID_LOT.id })], truncated: { test: false, live: false } },
    cap: { status: 'ok', default: { amountMinor: 15000, currency: 'USD', windowDays: 30 }, active: null, history: [] },
    limits: { minMinor: 100, maxMinor: 150000, stepMinor: 100, currency: 'USD', windowDays: 30, reasonMin: 3, reasonMax: 500 },
    ...over,
  };
}

const SUMMARY = {
  success: true,
  data: {
    accountId: DANA_ID,
    business: { status: 'ok', companyName: 'Acme Therapy', vertical: 'therapist', subVertical: null },
    aiSpend30d: {
      status: 'complete', currency: 'USD', readCeiling: 5000,
      window: { start: '2026-08-26T00:00:00.000Z', end: '2026-09-25T00:00:00.000Z' },
      total: { calls: 0, tokens: 0, estimatedCostUsd: 0 }, lines: [],
    },
    recentAiFailures: { status: 'ok', window: { start: '2026-08-26T00:00:00.000Z', end: '2026-09-25T00:00:00.000Z' }, limit: 10, items: [] },
  },
};

// ── The route table (the recording stub is the shared pin harness) ──────────

const answer = (status: number, body: unknown): Reply => ({ status, body });
const okBody = (data: unknown) => answer(200, { success: true, data });

/** A request as one line, "METHOD url". */
const line = (c: Call) => `${c.method} ${c.url}`;

let listReadCount = 0;
let creditsData: AccountCreditPositionPayload;
let boostData: AdminBoostView;
/** Answers to the entitlements POST, in order. */
let opsQueue: Queued[] = [];
/** While set, the top-ups read waits for it, as a real network read takes time. */
let boostGate: Promise<void> | null = null;
/**
 * LF-F2 (T-K): how the next list read fails, then cleared: a 500 from the
 * route, a rejected fetch, or held until the test answers it (T-K8).
 */
let listFailNext: 'http' | 'network' | 'held' | null = null;
/** The held list read's answer (T-K8). */
let heldList: { promise: Promise<Reply>; resolve: (reply: Reply) => void } | null = null;

function routePost(url: string): Queued {
  if (url === OPS_URL) return fromQueue(opsQueue, url);
  unexpected.push(`POST ${url}`);
  return answer(404, { success: false, error: 'not mocked' });
}

function routeGet(url: string): Queued {
  // The top-ups data is read when the gate opens, as the real answer would be.
  if (boostGate && url === BOOST_URL) return boostGate.then(() => okBody(boostData));
  if (url.startsWith('/api/admin/users?')) {
    listReadCount += 1;
    const fail = listFailNext;
    listFailNext = null;
    if (fail === 'http') return answer(500, { success: false, error: 'Failed to fetch users' });
    if (fail === 'network') return Promise.reject(new TypeError('Failed to fetch'));
    if (fail === 'held') {
      heldList = deferred<Reply>();
      return heldList.promise;
    }
    return okBody([danaRow(listReadCount)]);
  }
  if (url.endsWith('/login-stats')) return okBody({ total_logins: 1, failed_logins: 0, unique_ips: 1, last_login_ip: '10.0.0.1' });
  if (url.endsWith('/audit-logs')) return okBody([]);
  if (url === `/api/admin/users/${DANA_ID}/stats`) return okBody({ tokens: null, plugins: { total: 0, active: 0, list: [] } });
  if (url === OPS_URL) return answer(200, recordedAccountBody);
  if (url === `/api/admin/business-os/accounts/${DANA_ID}/summary`) return answer(200, SUMMARY);
  if (url === BOOST_URL) return okBody(boostData);
  if (url === CREDITS_URL) return okBody(creditsData);
  if (url === '/api/admin/archiving') return okBody({ sources: [] });
  if (url === '/api/admin/test-account-cleanup/check') return okBody({ configured: true });
  unexpected.push(`GET ${url}`);
  return answer(404, { success: false, error: 'not mocked' });
}

async function openDrawer(): Promise<HTMLElement> {
  installFetch();
  render(<UsersPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open details for Dana Cohen' }));
  const drawer = await screen.findByTestId('users-drawer');
  await within(drawer).findByTestId('danger-area');
  await within(drawer).findByTestId('boost-cap');
  await waitFor(() => expect(within(drawer).queryByText('Loading credits…')).toBeNull());
  await quiet();
  return drawer;
}

const button = (root: HTMLElement, testId: string) => within(root).getByTestId(testId) as HTMLButtonElement;
const sectionHeading = (drawer: HTMLElement) =>
  within(drawer).getByTestId('drawer-section-credits').querySelector('h3') as HTMLHeadingElement;

function expectInOrder(nodes: Element[]) {
  for (let i = 1; i < nodes.length; i++) {
    expect(nodes[i - 1].compareDocumentPosition(nodes[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
}

/** Click as an admin does: the button takes focus first. */
function press(element: HTMLElement) {
  element.focus();
  fireEvent.click(element);
}

/** Give credits, no end date, through to Confirm. */
async function give(drawer: HTMLElement) {
  press(button(drawer, 'credits-give'));
  const dialog = await screen.findByTestId('credit-form-dialog');
  fireEvent.change(within(dialog).getByTestId('credit-amount'), { target: { value: '100' } });
  fireEvent.click(within(dialog).getByTestId('no-end-date-choice'));
  fireEvent.change(within(dialog).getByTestId('credit-reason'), { target: { value: 'goodwill' } });
  fireEvent.click(within(dialog).getByTestId('credit-form-continue'));
  return dialog;
}

/** Take back a number of credits, paid confirmation ticked when asked, through to Confirm. */
function fillTakeBack(dialog: HTMLElement, amount: string) {
  fireEvent.change(within(dialog).getByTestId('credit-amount'), { target: { value: amount } });
  fireEvent.change(within(dialog).getByTestId('credit-reason'), { target: { value: 'refund agreed' } });
  const paid = within(dialog).queryByTestId('paid-credits-confirm');
  if (paid) fireEvent.click(paid);
  fireEvent.click(within(dialog).getByTestId('credit-form-continue'));
}

async function confirm(dialog: HTMLElement) {
  fireEvent.click(button(dialog, 'credit-form-confirm'));
  await waitFor(() => expect(dialog.isConnected).toBe(false));
  await quiet();
}

const reduced = (lotId: string, credits: number, left: number) =>
  okBody({ accountId: DANA_ID, op: 'reduce_credit_lot', lotId, drawId: 'd1', credits, lotRemainingAfter: left, replayed: false });
const granted = (credits: number) =>
  okBody({ accountId: DANA_ID, op: 'grant_credits', lotId: 'ffffffff-6666-4666-8666-66666666666f', credits, expiresAt: null, replayed: false });

/** The class tokens of an element, any variant prefix stripped. */
const classTokens = (el: Element) => (el.getAttribute('class') ?? '').split(' ').filter(Boolean).map((t) => t.slice(t.lastIndexOf(':') + 1));

// ── Lifecycle ───────────────────────────────────────────────────────────────

// The shared harness: browser shims, emptied records, the uuid counter, the
// console and unexpected-request guard after every test.
// `endQuiet`: every test ends quiet before the guard, so a late request is
// checked in the test that caused it (this file's rule before the harness).
setRoutes(routeGet, routePost);
installPinLifecycle({ countUuids: true, endQuiet: true });

beforeEach(() => {
  listReadCount = 0;
  opsQueue = [];
  boostGate = null;
  listFailNext = null;
  heldList = null;
  creditsData = creditsPayload([lot(1), PAID_LOT]);
  boostData = boostView();
});

// ── T-A action bars (BD-5) ──────────────────────────────────────────────────

describe('T-A: the money actions sit in bars of their own, apart from the figures (BD-5)', () => {
  it('T-A1: Give credits is alone in a bar above the Credits figures', async () => {
    const drawer = await openDrawer();
    const block = within(drawer).getByTestId('credits-block');
    const bar = within(block).getByTestId('credits-actions');
    expect(bar.className).toContain(MONEY_ACTION_BAR); // the bordered row, apart from the figures
    expect(bar.contains(button(drawer, 'credits-give'))).toBe(true);
    expect(within(bar).getAllByRole('button')).toHaveLength(1);
    expect(bar.querySelector('dl, dd')).toBeNull();
    expectInOrder([bar, within(block).getByTestId('credits-usage'), within(block).getByTestId('credits-extra')]);
    expect(within(within(block).getByTestId('credits-usage')).queryAllByRole('button')).toHaveLength(0);
    // The Credits block holds no heading: a label (D-20, LF-4b).
    expect(block.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull();
  });

  it('T-A2: Set limit and Back to default open the Spending limit part, above its figures; no reconcile button, the pointer is last (LF-4c)', async () => {
    boostData = boostView({ cap: { status: 'ok', default: { amountMinor: 15000, currency: 'USD', windowDays: 30 }, active: ACTIVE_CAP, history: [] } });
    const drawer = await openDrawer();
    const cap = within(drawer).getByTestId('boost-cap');
    const bar = within(cap).getByTestId('boost-cap-actions');
    expect(bar.className).toBe(MONEY_ACTION_BAR);
    expect(within(bar).getAllByRole('button').map((b) => b.getAttribute('data-testid'))).toEqual(['boost-cap-set', 'boost-cap-end']);
    expectInOrder([bar, within(cap).getByTestId('boost-cap-override'), within(cap).getByTestId('boost-cap-history')]);
    // LF-4c (BD-6): the reconcile moved to Scheduled jobs & queues; the block ends on the pointer line.
    const block = within(drawer).getByTestId('boost-block');
    expect(within(block).queryByTestId('boost-reconcile')).toBeNull();
    const pointer = within(block).getByTestId('boost-reconcile-pointer');
    const all = Array.from(block.querySelectorAll('*'));
    expect(all.filter((element) => pointer.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING && !pointer.contains(element))).toEqual([]);
    expect(within(drawer).getByTestId('boost-block').querySelector('h1, h2, h3, h4, h5, h6')).toBeNull();
  });

  it("T-A3: on the admin's own account there is no bar; the own-account sentences stay", async () => {
    creditsData = creditsPayload([lot(1)], { isOwnAccount: true });
    boostData = boostView({ isOwnAccount: true });
    const drawer = await openDrawer();
    expect(within(drawer).queryByTestId('credits-actions')).toBeNull();
    expect(within(drawer).queryByTestId('boost-cap-actions')).toBeNull();
    expect(within(drawer).getByTestId('credits-own-account')).toBeTruthy();
    expect(within(drawer).getByTestId('boost-own-account')).toBeTruthy();
  });

  it('T-A4: the bar buttons use the shared admin button, and the Stripe links the drawer link style (no decorative green)', async () => {
    boostData = boostView({ cap: { status: 'ok', default: { amountMinor: 15000, currency: 'USD', windowDays: 30 }, active: ACTIVE_CAP, history: [] } });
    const drawer = await openDrawer();
    for (const id of ['credits-give', 'boost-cap-set', 'boost-cap-end']) {
      expect({ id, className: button(drawer, id).className }).toEqual({ id, className: ADMIN_BUTTON });
    }
    const link = within(drawer).getByTestId('boost-stripe-payment-link');
    expect(link.className.startsWith(LINK_CLASS)).toBe(true);
    expect(link.className).not.toContain('emerald');
  });
});

// ── T-F folds (BD-8, BD-9) ──────────────────────────────────────────────────

describe('T-F: lots and top-ups show the newest three and fold the rest (BD-8)', () => {
  it('T-F1: five lots: three shown, two hidden but mounted; the toggle names them and sends nothing', async () => {
    creditsData = creditsPayload([lot(5), lot(4), lot(3), lot(2), lot(1)]);
    const drawer = await openDrawer();
    const block = within(drawer).getByTestId('credits-block');
    const toggle = button(drawer, 'credits-lots-more');
    const rest = within(drawer).getByTestId('credits-lots-more-rest');
    expect(toggle.textContent).toBe('Show 2 more');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe(rest.id);
    expect(rest.hidden).toBe(true);
    expect(within(drawer).getAllByTestId('credits-lot')).toHaveLength(5);
    expect(within(rest).getAllByTestId('credits-lot')).toHaveLength(2);
    const before = calls.length;
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe('Show fewer');
    expect(rest.hidden).toBe(false);
    await quiet();
    expect(calls.length).toBe(before);
    expect(within(drawer).getByTestId('credits-block')).toBe(block);
  });

  it('T-F2: three lots or fewer: no toggle and no hidden list', async () => {
    creditsData = creditsPayload([lot(3), lot(2), lot(1)]);
    const drawer = await openDrawer();
    expect(within(drawer).queryByTestId('credits-lots-more')).toBeNull();
    expect(within(drawer).queryByTestId('credits-lots-more-rest')).toBeNull();
  });

  it("T-F3: five top-ups fold the same way; a folded top-up's Take back credits opens the Credits dialog on its lot (BD-9)", async () => {
    const lots = [lot(5), lot(4), lot(3), lot(2), lot(1)];
    creditsData = creditsPayload(lots);
    boostData = boostView({
      purchases: {
        status: 'ok',
        rows: [5, 4, 3, 2, 1].map((n) => purchase(n, { lotId: lot(n).id })),
        truncated: { test: false, live: false },
      },
    });
    const drawer = await openDrawer();
    const toggle = button(drawer, 'boost-purchases-more');
    const rest = within(drawer).getByTestId('boost-purchases-more-rest');
    expect(toggle.textContent).toBe('Show 2 more');
    expect(rest.hidden).toBe(true);
    expect(within(drawer).getAllByTestId('boost-purchase')).toHaveLength(5);
    const before = calls.length;
    fireEvent.click(toggle);
    await quiet();
    expect(calls.length).toBe(before);
    // The 4th top-up is lot(2)'s purchase.
    fireEvent.click(within(within(rest).getAllByTestId('boost-purchase')[0]).getByTestId('boost-take-back'));
    const dialog = await screen.findByTestId('credit-form-dialog');
    expect(dialog.textContent).toContain('200 left on this gift.');
  });

  it('T-F4: a lot inside the opened fold takes its own Take back', async () => {
    creditsData = creditsPayload([lot(5), lot(4), lot(3), lot(2), lot(1)]);
    const drawer = await openDrawer();
    fireEvent.click(button(drawer, 'credits-lots-more'));
    const rest = within(drawer).getByTestId('credits-lots-more-rest');
    fireEvent.click(within(within(rest).getAllByTestId('credits-lot')[1]).getByTestId('credits-take-back'));
    const dialog = await screen.findByTestId('credit-form-dialog');
    expect(dialog.textContent).toContain('100 left on this gift.');
  });
});

// ── T-B one list re-read (BD-14, AC-4.10, SA C3) ────────────────────────────

describe('T-B: one list re-read after a successful Give or Take back (BD-14)', () => {
  /** The requests sent from `start` on, sorted. */
  const since = (start: number) => calls.slice(start).map(line).sort();
  const listCall = () => calls.map(line).find((c) => c.startsWith('GET /api/admin/users?')) as string;

  it('T-B1: a Give sends exactly its POST, one Credits read and one list read, nothing else', async () => {
    const drawer = await openDrawer();
    const dialog = await give(drawer);
    opsQueue.push(granted(100));
    const start = calls.length;
    await confirm(dialog);
    expect(since(start)).toEqual([`GET ${CREDITS_URL}`, listCall(), `POST ${OPS_URL}`].sort());
  });

  it('T-B2: a refused Give, an Escape close, a Set limit and a Back to default send no list read', async () => {
    boostData = boostView({ cap: { status: 'ok', default: { amountMinor: 15000, currency: 'USD', windowDays: 30 }, active: ACTIVE_CAP, history: [] } });
    const drawer = await openDrawer();
    const lists = () => calls.map(line).filter((c) => c.startsWith('GET /api/admin/users?')).length;
    expect(lists()).toBe(1);

    let dialog = await give(drawer);
    opsQueue.push(answer(409, { success: false, error: 'awaiting_payment' }));
    fireEvent.click(button(dialog, 'credit-form-confirm'));
    await within(dialog).findByTestId('credit-form-error');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(dialog.isConnected).toBe(false));
    await quiet();
    expect(lists()).toBe(1);

    press(button(drawer, 'boost-cap-set'));
    dialog = await screen.findByTestId('boost-cap-dialog');
    fireEvent.change(within(dialog).getByTestId('boost-cap-amount'), { target: { value: '200' } });
    fireEvent.change(within(dialog).getByTestId('boost-cap-reason-input'), { target: { value: 'larger studio' } });
    fireEvent.click(button(dialog, 'boost-cap-continue'));
    opsQueue.push(okBody({ amountMinor: 20000 }));
    fireEvent.click(button(dialog, 'boost-cap-confirm'));
    await waitFor(() => expect(dialog.isConnected).toBe(false));
    await quiet();
    expect(lists()).toBe(1);

    press(await within(drawer).findByTestId('boost-cap-end'));
    dialog = await screen.findByTestId('boost-cap-dialog');
    fireEvent.change(within(dialog).getByTestId('boost-cap-reason-input'), { target: { value: 'back to normal' } });
    fireEvent.click(button(dialog, 'boost-cap-continue'));
    opsQueue.push(okBody({}));
    fireEvent.click(button(dialog, 'boost-cap-confirm'));
    await waitFor(() => expect(dialog.isConnected).toBe(false));
    await quiet();
    expect(lists()).toBe(1);
  });

  it('T-B3: after a Give the strip, the list row and the Credits block agree, and nothing remounts', async () => {
    const drawer = await openDrawer();
    const strip = () => within(within(drawer).getByTestId('strip-credits-left')).getByTestId('row-credits-left');
    const rowCell = () => within(screen.getByTestId('row-credits-cell')).getByTestId('row-credits-left');
    expect(strip().textContent).toBe('40%');
    expect(rowCell().textContent).toBe('40%');
    const nodes = ['bos-panel', 'credits-block', 'boost-block'].map((id) => within(drawer).getByTestId(id));

    const dialog = await give(drawer);
    opsQueue.push(granted(100));
    creditsData = creditsPayload([lot(1), PAID_LOT], { extra: { status: 'ok', extraCredits: 14150, hasInconsistentLot: false, lots: [lot(1), PAID_LOT] } });
    await confirm(dialog);

    expect(strip().textContent).toBe('30%');
    expect(rowCell().textContent).toBe('30%');
    expect(strip().getAttribute('data-band')).toBe(rowCell().getAttribute('data-band'));
    expect(within(drawer).getByTestId('credits-extra-figure').textContent).toBe('14,150');
    ['bos-panel', 'credits-block', 'boost-block'].forEach((id, i) => expect(within(drawer).getByTestId(id)).toBe(nodes[i]));
  });

  it('T-B4: a Take back credits on a top-up sends exactly its POST, one Credits read and one list read', async () => {
    const drawer = await openDrawer();
    press(button(within(drawer).getByTestId('boost-purchase'), 'boost-take-back'));
    const dialog = await screen.findByTestId('credit-form-dialog');
    fillTakeBack(dialog, '100');
    opsQueue.push(reduced(PAID_LOT.id, 100, 13650));
    const start = calls.length;
    await confirm(dialog);
    expect(since(start)).toEqual([`GET ${CREDITS_URL}`, listCall(), `POST ${OPS_URL}`].sort());
  });
});

// ── T-K a failed list re-read after a money action keeps the rows (LF-F2) ──

describe('T-K: a failed list re-read after a Give or Take back keeps the rows and the drawer (LF4B-F1)', () => {
  const DRAWER_STALE =
    'The business list could not be refreshed, so the credits at the top of this panel and in the list may show an older figure.';
  /** The requests sent from `start` on, sorted. */
  const since = (start: number) => calls.slice(start).map(line).sort();
  const listUrls = () => calls.filter((c) => c.method === 'GET' && c.url.startsWith('/api/admin/users?')).map((c) => c.url);
  const refreshButton = () => screen.getByRole('button', { name: 'Refresh the business list' }) as HTMLButtonElement;
  const strip = (drawer: HTMLElement) => within(within(drawer).getByTestId('strip-credits-left')).getByTestId('row-credits-left');
  const rowCell = () => within(screen.getByTestId('row-credits-cell')).getByTestId('row-credits-left');
  const SAME_NODES = ['bos-panel', 'credits-block', 'boost-block'];

  /** The money action succeeded and its list read failed: everything an admin needs to see is still there. */
  function expectKept(drawer: HTMLElement, nodes: HTMLElement[]) {
    expect(drawer.isConnected).toBe(true);
    expect(screen.getByTestId('users-drawer')).toBe(drawer);
    expect(screen.getAllByTestId('row-business')).toHaveLength(1);
    expect(within(drawer).getByTestId('credits-success').textContent).not.toBe('');
    const line = within(drawer).getByTestId('drawer-list-stale');
    expect(line.textContent).toBe(DRAWER_STALE);
    expect(line.getAttribute('role')).toBe('status');
    expect(screen.queryByTestId('users-error')).toBeNull();
    // Behind the drawer too (SA C3), so it is still there once the drawer closes.
    expect(screen.getByTestId('users-list-stale')).toBeTruthy();
    SAME_NODES.forEach((id, i) => expect(within(drawer).getByTestId(id)).toBe(nodes[i]));
  }

  async function closeDrawer(drawer: HTMLElement) {
    fireEvent.keyDown(drawer, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await quiet();
  }

  /** A Give whose list read fails as asked; returns the drawer. */
  async function giveThenListFails(how: 'http' | 'network'): Promise<HTMLElement> {
    const drawer = await openDrawer();
    const dialog = await give(drawer);
    opsQueue.push(granted(100));
    listFailNext = how;
    await confirm(dialog);
    return drawer;
  }

  it('T-K1: Give, then the list read answers 500: same request as the first read, rows, drawer, notice and focus all stay', async () => {
    const drawer = await openDrawer();
    const mountUrl = listUrls()[0];
    expect(screen.queryByTestId('drawer-list-stale')).toBeNull();
    expect(screen.queryByTestId('users-list-stale')).toBeNull();
    const nodes = SAME_NODES.map((id) => within(drawer).getByTestId(id));

    const dialog = await give(drawer);
    expect(screen.queryByTestId('drawer-list-stale')).toBeNull();
    expect(screen.queryByTestId('users-list-stale')).toBeNull();
    opsQueue.push(granted(100));
    listFailNext = 'http';
    const start = calls.length;
    await confirm(dialog);

    expect(since(start)).toEqual([`GET ${CREDITS_URL}`, `GET ${mountUrl}`, `POST ${OPS_URL}`].sort());
    expect(listUrls()).toEqual([mountUrl, mountUrl]); // byte for byte the first read's request (SA C3)
    expectKept(drawer, nodes);
    await waitFor(() => expect(document.activeElement).toBe(button(drawer, 'credits-give')));
  });

  it('T-K2: Take back on a lot, then the list read answers 500: the same', async () => {
    const drawer = await openDrawer();
    const nodes = SAME_NODES.map((id) => within(drawer).getByTestId(id));
    press(within(within(drawer).getAllByTestId('credits-lot')[0]).getByTestId('credits-take-back'));
    const dialog = await screen.findByTestId('credit-form-dialog');
    fillTakeBack(dialog, '10');
    opsQueue.push(reduced(lot(1).id, 10, 90));
    creditsData = creditsPayload([lot(1, { remaining: 90 }), PAID_LOT]);
    listFailNext = 'http';
    const start = calls.length;
    await confirm(dialog);

    expect(since(start)).toEqual([`GET ${CREDITS_URL}`, `GET ${listUrls()[0]}`, `POST ${OPS_URL}`].sort());
    expect(listUrls()).toHaveLength(2);
    expectKept(drawer, nodes);
  });

  it('T-K3: Take back on a top-up, then the list read is rejected (network): the same', async () => {
    const drawer = await openDrawer();
    const nodes = SAME_NODES.map((id) => within(drawer).getByTestId(id));
    press(button(within(drawer).getByTestId('boost-purchase'), 'boost-take-back'));
    const dialog = await screen.findByTestId('credit-form-dialog');
    fillTakeBack(dialog, '100');
    opsQueue.push(reduced(PAID_LOT.id, 100, 13650));
    listFailNext = 'network';
    const start = calls.length;
    await confirm(dialog);

    expect(since(start)).toEqual([`GET ${CREDITS_URL}`, `GET ${listUrls()[0]}`, `POST ${OPS_URL}`].sort());
    expect(listUrls()).toHaveLength(2);
    expectKept(drawer, nodes);
  });

  it('T-K4: the strip and the row keep the last good figure; the Credits block shows its own new one', async () => {
    creditsData = creditsPayload([lot(1), PAID_LOT]);
    const drawer = await openDrawer();
    expect(strip(drawer).textContent).toBe('40%');
    const dialog = await give(drawer);
    opsQueue.push(granted(100));
    creditsData = creditsPayload([lot(1), PAID_LOT], { extra: { status: 'ok', extraCredits: 14150, hasInconsistentLot: false, lots: [lot(1), PAID_LOT] } });
    listFailNext = 'http';
    await confirm(dialog);

    expect(strip(drawer).textContent).toBe('40%');
    expect(rowCell().textContent).toBe('40%');
    expect(within(drawer).getByTestId('credits-extra-figure').textContent).toBe('14,150');
  });

  it('T-K5: closing the drawer keeps the rows and the page line; the next good Refresh clears both lines', async () => {
    const drawer = await giveThenListFails('http');
    await closeDrawer(drawer);

    expect(screen.getAllByTestId('row-business')).toHaveLength(1);
    // SA C5's copy, with the time of the last good read in the middle.
    const pageLine = screen.getByTestId('users-list-stale').textContent ?? '';
    expect(pageLine.startsWith('The business list could not be refreshed. These rows are from ')).toBe(true);
    expect(pageLine.endsWith(' UTC. Press Refresh to try again.')).toBe(true);

    fireEvent.click(refreshButton());
    await waitFor(() => expect(rowCell().textContent).toBe('30%'));
    await quiet();
    expect(screen.queryByTestId('users-list-stale')).toBeNull();
    expect(screen.queryByTestId('drawer-list-stale')).toBeNull();
    expect(screen.queryByTestId('users-error')).toBeNull();
    expect(listUrls()).toHaveLength(3);
  });

  it("T-K6: Refresh keeps today's behaviour: a failed Refresh empties the rows and shows the error, never beside the stale line", async () => {
    const drawer = await giveThenListFails('http');
    await closeDrawer(drawer);

    listFailNext = 'http';
    fireEvent.click(refreshButton());
    await screen.findByTestId('users-error');
    await quiet();
    expect(screen.queryAllByTestId('row-business')).toHaveLength(0);
    expect(screen.queryByTestId('users-list-stale')).toBeNull();
    expect(listUrls()).toHaveLength(3);
  });

  it('T-K7: a refused Give sends no list read at all, so the failure switch is never used', async () => {
    const drawer = await openDrawer();
    const dialog = await give(drawer);
    opsQueue.push(answer(409, { success: false, error: 'awaiting_payment' }));
    listFailNext = 'http';
    fireEvent.click(button(dialog, 'credit-form-confirm'));
    await within(dialog).findByTestId('credit-form-error');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(dialog.isConnected).toBe(false));
    await quiet();

    expect(listUrls()).toHaveLength(1);
    expect(listFailNext).toBe('http');
    expect(screen.queryByTestId('drawer-list-stale')).toBeNull();
    listFailNext = null;
  });

  it('T-K8: an older post-Give read that fails after a newer read succeeded changes nothing (newest read wins)', async () => {
    const drawer = await openDrawer();
    const dialog = await give(drawer);
    opsQueue.push(granted(100));
    listFailNext = 'held';
    fireEvent.click(button(dialog, 'credit-form-confirm'));
    await waitFor(() => expect(dialog.isConnected).toBe(false));
    await waitFor(() => expect(heldList).not.toBeNull());

    // Refresh is disabled while a read is in flight, so the newer read an admin
    // can start at this moment is a status change, once the drawer is closed.
    fireEvent.keyDown(drawer, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(refreshButton().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'all' } });
    await waitFor(() => expect(listUrls()).toHaveLength(3));
    await waitFor(() => expect(rowCell().textContent).toBe('30%'));

    await act(async () => {
      heldList?.resolve(answer(500, { success: false, error: 'Failed to fetch users' }));
    });
    await quiet();

    expect(rowCell().textContent).toBe('30%');
    expect(screen.getAllByTestId('row-business')).toHaveLength(1);
    expect(screen.queryByTestId('users-list-stale')).toBeNull();
    expect(screen.queryByTestId('users-error')).toBeNull();
    expect(listUrls()).toHaveLength(3);
    window.history.replaceState(null, '', '/');
  });
});

// ── T-R focus return (BD-15, AC-4.7, F-108) ─────────────────────────────────

describe('T-R: closing a money dialog returns focus to its opener, else to the section heading, never body (BD-15)', () => {
  const expectFocus = async (target: () => Element) => {
    await waitFor(() => expect(document.activeElement).toBe(target()));
    await quiet();
    expect(document.activeElement).toBe(target());
    expect(document.activeElement).not.toBe(document.body);
  };

  it('T-R1: Give credits: Escape and a success both return to Give credits', async () => {
    const drawer = await openDrawer();
    press(button(drawer, 'credits-give'));
    const first = await screen.findByTestId('credit-form-dialog');
    fireEvent.keyDown(first, { key: 'Escape' });
    await expectFocus(() => button(drawer, 'credits-give'));

    const dialog = await give(drawer);
    opsQueue.push(granted(100));
    await confirm(dialog);
    await expectFocus(() => button(drawer, 'credits-give'));
  });

  it("T-R2: Take back on a lot: Escape and a success that leaves credits return to that lot's button; emptying the lot goes to the heading", async () => {
    const drawer = await openDrawer();
    const lotButton = () => within(within(drawer).getAllByTestId('credits-lot')[0]).getByTestId('credits-take-back');
    press(lotButton());
    const first = await screen.findByTestId('credit-form-dialog');
    fireEvent.keyDown(first, { key: 'Escape' });
    await expectFocus(lotButton);

    press(lotButton());
    let dialog = await screen.findByTestId('credit-form-dialog');
    fillTakeBack(dialog, '10');
    opsQueue.push(reduced(lot(1).id, 10, 90));
    creditsData = creditsPayload([lot(1, { remaining: 90 }), PAID_LOT]);
    await confirm(dialog);
    await expectFocus(lotButton);

    press(lotButton());
    dialog = await screen.findByTestId('credit-form-dialog');
    fillTakeBack(dialog, '90');
    opsQueue.push(reduced(lot(1).id, 90, 0));
    creditsData = creditsPayload([lot(1, { remaining: 0 }), PAID_LOT]);
    await confirm(dialog);
    expect(within(within(drawer).getAllByTestId('credits-lot')[0]).queryByTestId('credits-take-back')).toBeNull();
    await expectFocus(() => sectionHeading(drawer));
    expect(sectionHeading(drawer).getAttribute('tabindex')).toBe('-1');
  });

  it("T-R3: Take back credits on a top-up: Escape returns to the top-up's button; emptying its lot goes to the heading", async () => {
    const drawer = await openDrawer();
    const topUpButton = () => button(within(drawer).getByTestId('boost-purchase'), 'boost-take-back');
    press(topUpButton());
    const first = await screen.findByTestId('credit-form-dialog');
    fireEvent.keyDown(first, { key: 'Escape' });
    await expectFocus(topUpButton);

    press(topUpButton());
    const dialog = await screen.findByTestId('credit-form-dialog');
    fillTakeBack(dialog, '13750');
    opsQueue.push(reduced(PAID_LOT.id, 13750, 0));
    creditsData = creditsPayload([lot(1), { ...PAID_LOT, remaining: 0 }]);
    await confirm(dialog);
    expect(within(within(drawer).getByTestId('boost-purchase')).getByTestId('boost-take-back-none')).toBeTruthy();
    await expectFocus(() => sectionHeading(drawer));
  });

  it('T-R4: Set limit and Back to default: Escape returns to the button; a success (the re-read unmounts the bar) goes to the heading', async () => {
    boostData = boostView({ cap: { status: 'ok', default: { amountMinor: 15000, currency: 'USD', windowDays: 30 }, active: ACTIVE_CAP, history: [] } });
    const drawer = await openDrawer();

    press(button(drawer, 'boost-cap-set'));
    let dialog = await screen.findByTestId('boost-cap-dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await expectFocus(() => button(drawer, 'boost-cap-set'));

    press(button(drawer, 'boost-cap-end'));
    dialog = await screen.findByTestId('boost-cap-dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await expectFocus(() => button(drawer, 'boost-cap-end'));

    // A success: the top-ups re-read (held, as a real read takes time) shows
    // "Loading…" in place of the block, so the button is gone: the heading.
    press(button(drawer, 'boost-cap-set'));
    dialog = await screen.findByTestId('boost-cap-dialog');
    fireEvent.change(within(dialog).getByTestId('boost-cap-amount'), { target: { value: '200' } });
    fireEvent.change(within(dialog).getByTestId('boost-cap-reason-input'), { target: { value: 'larger studio' } });
    fireEvent.click(button(dialog, 'boost-cap-continue'));
    opsQueue.push(okBody({ amountMinor: 20000 }));
    let gate = deferred<void>();
    boostGate = gate.promise;
    fireEvent.click(button(dialog, 'boost-cap-confirm'));
    await waitFor(() => expect(dialog.isConnected).toBe(false));
    await waitFor(() => expect(within(drawer).queryByTestId('boost-cap-set')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(sectionHeading(drawer)));
    await act(async () => {
      gate.resolve();
    });
    await within(drawer).findByTestId('boost-cap-set');
    await expectFocus(() => sectionHeading(drawer));

    // Back to default ends the limit, so its button does not come back.
    press(await within(drawer).findByTestId('boost-cap-end'));
    dialog = await screen.findByTestId('boost-cap-dialog');
    fireEvent.change(within(dialog).getByTestId('boost-cap-reason-input'), { target: { value: 'back to normal' } });
    fireEvent.click(button(dialog, 'boost-cap-continue'));
    opsQueue.push(okBody({}));
    boostData = boostView();
    gate = deferred<void>();
    boostGate = gate.promise;
    fireEvent.click(button(dialog, 'boost-cap-confirm'));
    await waitFor(() => expect(dialog.isConnected).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(sectionHeading(drawer)));
    await act(async () => {
      gate.resolve();
    });
    await within(drawer).findByTestId('boost-cap-set');
    await expectFocus(() => sectionHeading(drawer));
    expect(within(drawer).queryByTestId('boost-cap-end')).toBeNull();
  });

  it('T-R5: a Back to default success whose re-read answers at once still ends on the heading (the limit ended, the button is gone)', async () => {
    boostData = boostView({ cap: { status: 'ok', default: { amountMinor: 15000, currency: 'USD', windowDays: 30 }, active: ACTIVE_CAP, history: [] } });
    const drawer = await openDrawer();
    press(button(drawer, 'boost-cap-end'));
    const dialog = await screen.findByTestId('boost-cap-dialog');
    fireEvent.change(within(dialog).getByTestId('boost-cap-reason-input'), { target: { value: 'back to normal' } });
    fireEvent.click(button(dialog, 'boost-cap-continue'));
    opsQueue.push(okBody({}));
    boostData = boostView();
    fireEvent.click(button(dialog, 'boost-cap-confirm'));
    await waitFor(() => expect(dialog.isConnected).toBe(false));
    await expectFocus(() => sectionHeading(drawer));
  });
});

// ── T-C contrast (§4) ───────────────────────────────────────────────────────

describe("T-C: the money blocks' information lines are slate-400 (T-5, §4)", () => {
  it('T-C1: the five lines read slate-400, and nothing in either block is slate-500 or slate-600 text', async () => {
    creditsData = creditsPayload([lot(1), { ...PAID_LOT, remaining: 0 }]);
    boostData = boostView({
      purchases: {
        status: 'ok',
        rows: [
          purchase(3, { lotId: PAID_LOT.id, stripe: { paymentIntentId: 'pi_3Test3', chargeId: null, disputeId: null, checkoutSessionId: 'cs_test_a1b2c3d4e5f6g7' } }),
          purchase(2, { lotId: 'cccccccc-0000-4000-8000-00000000000c' }),
        ],
        truncated: { test: true, live: false },
      },
    });
    const drawer = await openDrawer();
    const dates = within(drawer).getByText('Dates are shown in UTC.');
    for (const el of [
      dates,
      within(drawer).getByTestId('boost-take-back-none'),
      within(drawer).getByTestId('boost-take-back-above'),
      within(drawer).getByTestId('boost-session-id'),
      within(drawer).getByTestId('boost-truncated'),
    ]) {
      expect({ text: el.textContent, slate400: classTokens(el).includes('text-slate-400') }).toEqual({ text: el.textContent, slate400: true });
    }
    for (const id of ['credits-block', 'boost-block']) {
      const dim = Array.from(within(drawer).getByTestId(id).querySelectorAll('*')).flatMap((el) =>
        classTokens(el).filter((t) => t.startsWith('text-slate-500') || t.startsWith('text-slate-600'))
      );
      expect({ id, dim }).toEqual({ id, dim: [] });
    }
  });
});
