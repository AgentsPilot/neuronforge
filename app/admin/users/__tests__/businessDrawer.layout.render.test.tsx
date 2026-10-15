/**
 * @jest-environment jsdom
 */

/**
 * The Businesses drawer layout (Admin Layout follow-ups LF-4a.2): the summary
 * strip, the six sections in the BD-4 order, the non-Business OS drawer
 * (BD-13), the folds outside the money blocks (BD-8), "All products" folded
 * with its note (BD-7, Q-4 (a)), Account & security (BD-10), UTC failure times
 * and the decorative colours (BD-11), the money blocks mounted once (SA C7).
 *
 * Through the whole page, opened from the row's Open button, with a
 * route-table stub in the `businessDetail.render` style (SQ-F: not the pin
 * harness). The money and danger actions themselves are pinned by
 * `businessDrawer.pins.*`, unedited by this slice.
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
  // LF-F3: the page logs through `clientLogger.child`; `@/lib/logger/client` re-exports it from this module.
  clientLogger: { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) },
}));

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
}));

import UsersPage from '../page';
import recordedAccountBody from '@/app/admin/business-os-tiers/__tests__/__fixtures__/recordedAccountBody.json';
import {
  DRAWER_PURPOSE,
  PART_BOX,
  PURPOSE_LINE,
  SECTION_BOX,
  type DrawerPurposeKey,
  type DrawerSectionKey,
} from '../components/DrawerBox';

// As the pin files: the whole page under a parallel Jest run can take more than
// RTL's 1 s default to settle. A longer wait can only turn a pass into a fail.
jest.setTimeout(30_000);
configure({ asyncUtilTimeout: 5000 });

/** The recorded account's tier, read from the fixture (no tier name as a literal: FR-12). */
const RECORDED_TIER = recordedAccountBody.data.plan.tier;

// ── Accounts ────────────────────────────────────────────────────────────────

const DANA_ID = '99999999-9999-4999-8999-999999999999';
const OREN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ELI_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SARA_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const row = (over: Record<string, unknown>) => ({
  company: null,
  email_confirmed: true,
  last_sign_in_at: null,
  created_at: '2026-09-01T00:00:00Z',
  providers: [],
  role: 'authenticated',
  ...over,
});

const DANA = row({
  id: DANA_ID, full_name: 'Dana Cohen', company: 'Cohen Clinic', phone: '050-0000000', email: 'dana@example.com',
  last_sign_in_at: '2026-10-10T08:05:00Z', updated_at: '2026-09-05T00:00:00Z', providers: ['email'],
  business: { companyName: 'Acme Therapy', vertical: 'therapist' },
  creditsLeft: { kind: 'percent', value: 40, trial: false },
});
const OREN = row({ id: OREN_ID, full_name: 'Oren Levi', email: 'oren@example.com', last_sign_in_at: '2026-10-10T08:05:00Z', business: null });
const ELI = row({
  id: ELI_ID, full_name: 'Eli Plan', email: 'eli@example.com',
  business: { companyName: 'Eli Studio', vertical: 'fitness' }, creditsLeft: { kind: 'percent', value: 10, trial: false },
});
const SARA = row({
  id: SARA_ID, full_name: 'Sara Summary', email: 'sara@example.com',
  business: { companyName: 'Sara Yoga', vertical: 'fitness' }, creditsLeft: { kind: 'no_allowance' },
});

// ── Bodies ──────────────────────────────────────────────────────────────────

const failure = (n: number) => ({
  id: `f${n}`,
  createdAt: `2026-09-2${n}T10:0${n}:00.000Z`,
  groupId: null,
  area: 'insights',
  actionType: 'insight_detection',
  trigger: 'cron',
  errorCode: `code_${n}`,
  callCount: 1,
  failedCallCount: 1,
});

function summaryBody(accountId: string, over: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      accountId,
      business: { status: 'ok', companyName: 'Acme Therapy', vertical: 'therapist', subVertical: null },
      aiSpend30d: {
        status: 'complete', currency: 'USD', readCeiling: 5000,
        window: { start: '2026-08-26T00:00:00.000Z', end: '2026-09-25T00:00:00.000Z' },
        total: { calls: 12, tokens: 3400, estimatedCostUsd: 4.21 },
        lines: [{ key: 'insights', kind: 'area', calls: 12, tokens: 3400, estimatedCostUsd: 4.21 }],
      },
      recentAiFailures: {
        status: 'ok', window: { start: '2026-08-26T00:00:00.000Z', end: '2026-09-25T00:00:00.000Z' }, limit: 10,
        items: [failure(5), failure(4), failure(3), failure(2), failure(1)],
      },
      ...over,
    },
  };
}

const model = (name: string, cost: number) => ({ model: name, input: 100, output: 50, cost, calls: 2 });

function statsBody(tokensNull = false) {
  return {
    success: true,
    data: {
      tokens: tokensNull
        ? null
        : {
            total_input_tokens: 1200, total_output_tokens: 300, total_cost_usd: 0.4321, total_calls: 7,
            by_model: [model('m-a', 0.2), model('m-b', 0.1), model('m-c', 0.05), model('m-d', 0.02), model('m-e', 0.01)],
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
}

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

const NOT_BOS = { success: false, error: 'not_a_business_os_account' };
const SERVER_ERROR = { success: false, error: 'Internal server error' };

// ── Fetch stub ──────────────────────────────────────────────────────────────

interface ResponseLike {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

const answer = (status: number, body: unknown): ResponseLike => ({ ok: status < 400, status, json: async () => body });

let calls: string[] = [];
let pending = 0;
/** Per-test override of a summary body, by account. */
let summaryOverride: Record<string, unknown> | null = null;
let tokensNull = false;
/** While set, the summary read waits for it (BD-12). */
let summaryGate: Promise<void> | null = null;
/** The summary read's `fetch` rejects, as a network error does (SA F1, C1). */
let summaryRejects = false;

function route(url: string): ResponseLike {
  if (url.startsWith('/api/admin/users?')) {
    return answer(200, { success: true, data: [DANA, OREN, ELI, SARA], stats: { totalUsers: 4, activeUsers: 0, newUsersToday: 0 } });
  }
  if (url.endsWith('/login-stats')) {
    return answer(200, { success: true, data: { total_logins: 1, failed_logins: 2, unique_ips: 1, last_login_ip: '10.0.0.1' } });
  }
  if (url.endsWith('/audit-logs')) return answer(200, { success: true, data: [] });
  if (url.startsWith('/api/admin/users/') && url.endsWith('/stats')) return answer(200, statsBody(tokensNull));
  if (url.startsWith('/api/admin/business-os/entitlements/accounts/')) {
    if (url.endsWith(OREN_ID)) return answer(404, NOT_BOS);
    if (url.endsWith(ELI_ID)) return answer(500, SERVER_ERROR);
    return answer(200, recordedAccountBody);
  }
  if (url.startsWith('/api/admin/business-os/accounts/') && url.endsWith('/summary')) {
    if (url.includes(OREN_ID)) return answer(404, NOT_BOS);
    if (url.includes(SARA_ID)) return answer(500, SERVER_ERROR);
    return answer(200, summaryBody(DANA_ID, summaryOverride ?? {}));
  }
  if (url.endsWith('/boost')) return answer(200, BOOST);
  if (url.startsWith('/api/admin/business-os/credits/accounts/')) return answer(200, CREDITS);
  if (url === '/api/admin/archiving') return answer(200, { success: true, data: { sources: [] } });
  if (url === '/api/admin/test-account-cleanup/check') return answer(200, { success: true, data: { configured: true } });
  return answer(404, { success: false, error: 'not mocked' });
}

function installFetch() {
  const fetchMock = jest.fn(async (input: string) => {
    const url = String(input);
    calls.push(url);
    pending += 1;
    try {
      if (summaryGate && url.endsWith('/summary')) await summaryGate;
      if (summaryRejects && url.endsWith('/summary')) throw new TypeError('Failed to fetch');
      return route(url);
    } finally {
      pending -= 1;
    }
  });
  global.fetch = fetchMock as unknown as typeof fetch;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Nothing in flight and no new request for a 300 ms window, repeated until one passes quietly. */
async function quiet() {
  let seen = -1;
  while (seen !== calls.length || pending !== 0) {
    seen = calls.length;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
  }
}

const openButtonFor = (name: string) =>
  screen.getByRole('button', { name: `Open details for ${name}`, hidden: true }) as HTMLButtonElement;

async function openDrawer(name: string, ready: string): Promise<HTMLElement> {
  installFetch();
  render(<UsersPage />);
  await screen.findAllByTestId('row-business');
  fireEvent.click(openButtonFor(name));
  const drawer = await screen.findByTestId('users-drawer');
  await within(drawer).findByTestId('danger-area');
  await within(drawer).findByTestId(ready);
  await quiet();
  return drawer;
}

const group = (drawer: HTMLElement, name: string) => within(drawer).getByRole('group', { name });

function expectInOrder(nodes: Element[]) {
  for (let i = 1; i < nodes.length; i++) {
    expect(nodes[i - 1].compareDocumentPosition(nodes[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
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
  pending = 0;
  summaryOverride = null;
  tokensNull = false;
  summaryGate = null;
  summaryRejects = false;
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  try {
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  } finally {
    consoleError.mockRestore();
    consoleWarn.mockRestore();
  }
});

// ── L-1 order (BD-4, AC-4.2) ────────────────────────────────────────────────

describe('L-1: the strip, then six sections in a fixed order', () => {
  it('strip, Credits & billing, Plan & entitlements, AI usage, Account & security, Activity, danger last; blocks in their sections', async () => {
    const drawer = await openDrawer('Dana Cohen', 'boost-cap');
    const credits = group(drawer, 'Credits & billing');
    const plan = group(drawer, 'Plan & entitlements');
    const ai = group(drawer, 'AI usage');
    const account = group(drawer, 'Account & security');
    const activity = group(drawer, 'Activity');
    const danger = within(drawer).getByTestId('danger-area');
    expectInOrder([within(drawer).getByTestId('drawer-strip'), credits, plan, ai, account, activity, danger]);
    expect(danger.parentElement?.lastElementChild).toBe(danger);

    expect(credits.getAttribute('data-testid')).toBe('drawer-section-credits');
    expect(plan.getAttribute('data-testid')).toBe('drawer-section-plan');
    expect(ai.getAttribute('data-testid')).toBe('drawer-section-ai');
    expect(account.getAttribute('data-testid')).toBe('drawer-section-account');
    expect(activity.getAttribute('data-testid')).toBe('detail-audit');

    expect(within(credits).getByTestId('credits-block')).toBeTruthy();
    expect(within(credits).getByTestId('boost-block')).toBeTruthy();
    expect(within(plan).getByTestId('bos-panel-plan')).toBeTruthy();
    expectInOrder([
      within(ai).getByTestId('bos-panel-spend'),
      within(ai).getByTestId('bos-panel-failures'),
      within(ai).getByTestId('ai-spend-card'),
    ]);
    // One h2 (the title); each section named by its own h3 (L-11).
    expect(drawer.querySelectorAll('h2')).toHaveLength(1);
    for (const section of [credits, plan, ai, account, activity]) {
      const labelledBy = section.getAttribute('aria-labelledby');
      expect(section.querySelector('h3')?.id).toBe(labelledBy);
    }
  });
});

// ── L-2 to L-5 the strip (BD-1, BD-3, BD-13) ────────────────────────────────

describe('L-2 to L-5: the summary strip', () => {
  it('L-2: a Business OS account: plan, the list row cell, USD recorded, the UTC sign-in; nothing to click', async () => {
    const drawer = await openDrawer('Dana Cohen', 'boost-cap');
    const strip = within(drawer).getByTestId('drawer-strip');
    expect(within(strip).getByTestId('strip-plan').textContent).toBe(RECORDED_TIER);

    const inDrawer = within(within(strip).getByTestId('strip-credits-left')).getByTestId('row-credits-left');
    const listCell = openButtonFor('Dana Cohen').closest('tr')?.querySelector('[data-testid="row-credits-left"]');
    expect(listCell).not.toBeNull();
    expect(inDrawer.textContent).toBe(listCell?.textContent);
    expect(inDrawer.getAttribute('data-band')).toBe(listCell?.getAttribute('data-band'));
    expect(inDrawer.textContent).toBe('40%');

    expect(within(strip).getByTestId('strip-ai-spend').textContent).toBe('$4.21recorded');
    expect(within(strip).getByTestId('strip-last-sign-in').textContent?.startsWith('2026-10-10 08:05 UTC')).toBe(true);
    expect(strip.querySelectorAll('a, button, input, select, textarea, summary')).toHaveLength(0);
  });

  it('L-3 (AC-4.9, BD-13): a non-Business OS login: three "Not a Business OS account" slots, notes, only All products', async () => {
    const drawer = await openDrawer('Oren Levi', 'bos-panel-not-bos');
    for (const id of ['strip-plan', 'strip-credits-left', 'strip-ai-spend']) {
      expect(within(drawer).getByTestId(id).textContent).toBe('Not a Business OS account');
    }
    expect(within(drawer).getByTestId('strip-last-sign-in').textContent?.startsWith('2026-10-10 08:05 UTC')).toBe(true);
    const sentence = 'Not a Business OS account. This login has no Business OS business.';
    expect(within(group(drawer, 'Credits & billing')).getByTestId('bos-panel-not-bos').textContent).toBe(sentence);
    expect(within(group(drawer, 'Plan & entitlements')).getByTestId('bos-plan-not-bos').textContent).toBe(sentence);

    const ai = group(drawer, 'AI usage');
    expect(within(ai).getByTestId('ai-spend-card')).toBeTruthy();
    expect(within(ai).queryByTestId('bos-panel-spend')).toBeNull();
    expect(within(ai).queryByTestId('bos-panel-failures')).toBeNull();
    expect(within(ai).getByTestId('ai-all-products-fold').hidden).toBe(true);
    expect(within(drawer).queryByTestId('credits-block')).toBeNull();
    expect(within(drawer).queryByTestId('boost-block')).toBeNull();
    expect(calls.some((url) => url.includes('/credits/accounts/'))).toBe(false);
  });

  it('L-4: a failed entitlements read: Plan "Could not read", the other slots filled', async () => {
    const drawer = await openDrawer('Eli Plan', 'boost-cap');
    expect(within(drawer).getByTestId('strip-plan').textContent).toBe('Could not read');
    expect(within(drawer).getByTestId('strip-ai-spend').textContent).toBe('$4.21recorded');
    expect(within(within(drawer).getByTestId('strip-credits-left')).getByTestId('row-credits-left').textContent).toBe('10%');
  });

  it('L-4: a failed summary read: AI "Could not read", never $0.00', async () => {
    const drawer = await openDrawer('Sara Summary', 'boost-cap');
    const ai = within(drawer).getByTestId('strip-ai-spend');
    expect(ai.textContent).toBe('Could not read');
    expect(ai.textContent).not.toContain('$');
    expect(within(drawer).getByTestId('strip-plan').textContent).toBe(RECORDED_TIER);
  });

  it('L-4: an unreadable AI ledger inside a good summary: AI "Could not read"', async () => {
    summaryOverride = {
      aiSpend30d: {
        status: 'error', currency: 'USD', readCeiling: 5000,
        window: { start: '2026-08-26T00:00:00.000Z', end: '2026-09-25T00:00:00.000Z' },
        total: { calls: 0, tokens: 0, estimatedCostUsd: 0 }, lines: [],
      },
    };
    const drawer = await openDrawer('Dana Cohen', 'boost-cap');
    expect(within(drawer).getByTestId('strip-ai-spend').textContent).toBe('Could not read');
  });

  it('L-4 (SA F1, C1): a summary read that rejects (network error): the fallback sentence, AI "Could not read", money blocks mounted', async () => {
    summaryRejects = true;
    const drawer = await openDrawer('Dana Cohen', 'boost-cap');
    const ai = group(drawer, 'AI usage');
    expect(within(ai).getByTestId('bos-panel-summary-error').textContent).toBe('The Business OS summary could not be read.');
    const slot = within(drawer).getByTestId('strip-ai-spend');
    expect(slot.textContent).toBe('Could not read');
    expect(slot.textContent).not.toContain('Reading');
    expect(slot.textContent).not.toContain('$');
    expect(within(drawer).getByTestId('credits-block')).toBeTruthy();
    expect(within(drawer).getByTestId('boost-block')).toBeTruthy();
  });

  it('L-5: an incomplete 30-day total is marked a lower bound in the strip too', async () => {
    summaryOverride = {
      aiSpend30d: {
        status: 'incomplete', currency: 'USD', readCeiling: 5000,
        window: { start: '2026-08-26T00:00:00.000Z', end: '2026-09-25T00:00:00.000Z' },
        total: { calls: 5000, tokens: 9000, estimatedCostUsd: 4.21 }, lines: [],
      },
    };
    const drawer = await openDrawer('Dana Cohen', 'boost-cap');
    expect(within(drawer).getByTestId('strip-ai-spend').textContent).toBe('$4.21recorded, a lower bound');
    expect(within(drawer).getByTestId('bos-panel-spend-incomplete')).toBeTruthy();
  });
});

// ── L-6, L-7 folds (BD-7, BD-8) ─────────────────────────────────────────────

describe('L-6 / L-7: folds outside the money blocks', () => {
  it('L-6: five failures: three shown, two hidden in the DOM; UTC times; the toggle sends nothing', async () => {
    const drawer = await openDrawer('Dana Cohen', 'boost-cap');
    const failures = within(drawer).getByTestId('bos-panel-failures');
    const items = within(failures).getAllByTestId('bos-panel-failure');
    expect(items).toHaveLength(5);
    const rest = within(failures).getByTestId('bos-panel-failures-more-rest');
    expect(rest.hidden).toBe(true);
    expect(within(rest).getAllByTestId('bos-panel-failure')).toHaveLength(2);
    expect(items[0].textContent).toContain('code_5');

    const times = within(failures).getAllByTestId('bos-panel-failure-time').map((t) => t.textContent);
    expect(times[0]).toBe('2026-09-25 10:05 UTC');
    expect(times).not.toContain(new Date('2026-09-25T10:05:00.000Z').toLocaleString());

    const toggle = within(failures).getByTestId('bos-panel-failures-more');
    expect(toggle.textContent).toBe('Show 2 more');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const before = calls.length;
    fireEvent.click(toggle);
    expect(rest.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await quiet();
    expect(calls.length).toBe(before);
  });

  it('L-7: All products is folded with its note visible; figures in the DOM; Recorded AI cost by model shows three; toggles send nothing', async () => {
    const drawer = await openDrawer('Dana Cohen', 'boost-cap');
    const card = within(drawer).getByTestId('ai-spend-card');
    expect(card.textContent).toContain('may be incomplete above 1,000 calls');
    const note = within(card).getByTestId('ai-differ-note');
    expect(note.closest('[hidden]')).toBeNull();
    expect(note.textContent).toContain('may not match');
    const fold = within(card).getByTestId('ai-all-products-fold');
    expect(fold.hidden).toBe(true);
    expect(fold.textContent).toContain('$0.4321');

    const modelsRest = within(card).getByTestId('ai-models-more-rest');
    expect(within(card).getAllByTestId('ai-model-row')).toHaveLength(5);
    expect(within(modelsRest).getAllByTestId('ai-model-row')).toHaveLength(2);
    expect(within(card).getAllByTestId('ai-model-row')[0].textContent).toContain('m-a');
    expect(card.textContent).toContain('Recorded AI cost by model (highest first)');

    const before = calls.length;
    const toggle = within(card).getByTestId('ai-all-products-toggle');
    expect(toggle.textContent).toBe('Show all products');
    fireEvent.click(toggle);
    expect(fold.hidden).toBe(false);
    expect(toggle.textContent).toBe('Hide all products');
    fireEvent.click(within(card).getByTestId('ai-models-more'));
    expect(modelsRest.hidden).toBe(false);
    await quiet();
    expect(calls.length).toBe(before);
  });

  it('L-7 (SA C3 (c)): an unreadable tokens read is shown open, with no toggle', async () => {
    tokensNull = true;
    const drawer = await openDrawer('Dana Cohen', 'boost-cap');
    const card = within(drawer).getByTestId('ai-spend-card');
    const sentence = within(card).getByText('The AI usage records could not be read.');
    expect(sentence.closest('[hidden]')).toBeNull();
    expect(within(card).queryByTestId('ai-all-products-toggle')).toBeNull();
    expect(card.textContent).not.toContain('$0.0000');
  });
});

// ── L-8 Account & security (BD-10) ──────────────────────────────────────────

describe('L-8: Account & security', () => {
  it('one section, three labelled groups, the same fields and words', async () => {
    const drawer = await openDrawer('Dana Cohen', 'boost-cap');
    const account = group(drawer, 'Account & security');
    const parts = ['account-group-account', 'account-group-signin', 'plugins-card'].map((id) => within(account).getByTestId(id));
    expectInOrder(parts);
    expect(parts.map((p) => p.querySelector('p')?.textContent)).toEqual(['Account', 'Sign-in', 'Connected plugins']);
    const labels = (el: HTMLElement) => Array.from(el.querySelectorAll('dt')).map((dt) => dt.textContent);
    expect(labels(parts[0])).toEqual(['Full Name', 'Company', 'Phone', 'User ID', 'Created', 'Last Updated']);
    expect(labels(parts[1])).toEqual([
      'Email Verified', 'Auth Providers', 'Last Sign In', 'Total Logins', 'Failed Logins', 'Unique IPs', 'Last Login IP',
    ]);
    expect(parts[2].textContent).toContain('1/2 active');
    expect(account.querySelectorAll('h1, h2, h3, h4, h5, h6')).toHaveLength(1);
  });
});

// ── L-9 colours (BD-11, SA C5) ──────────────────────────────────────────────

const DECORATIVE = ['emerald', 'teal', 'purple', 'orange', 'cyan'];
const COLOUR_PREFIXES = ['bg-', 'text-', 'border-', 'from-', 'to-'];

/** The decorative colour utilities on one element: the part after the last variant colon. */
function decorativeClasses(el: Element): string[] {
  const tokens = (el.getAttribute('class') ?? '').split(' ').filter(Boolean);
  return tokens.filter((token) => {
    const utility = token.slice(token.lastIndexOf(':') + 1);
    if (utility.startsWith('bg-gradient')) return true;
    return COLOUR_PREFIXES.some((p) => utility.startsWith(p)) && DECORATIVE.some((c) => utility.includes(c));
  });
}

describe('L-9: no decorative colour outside the money blocks and the danger area', () => {
  it('the strip, sections 2 to 5 and the header use slate and status tones only', async () => {
    const drawer = await openDrawer('Dana Cohen', 'boost-cap');
    const excluded = ['credits-block', 'boost-block', 'danger-area'].map((id) => within(drawer).getByTestId(id));
    const found: string[] = [];
    for (const el of Array.from(drawer.querySelectorAll('*'))) {
      if (excluded.some((block) => block.contains(el))) continue;
      for (const cls of decorativeClasses(el)) found.push(cls);
    }
    expect(found).toEqual([]);
  });

  it('the matcher sees each kind (planted samples)', () => {
    const el = document.createElement('div');
    el.setAttribute('class', 'bg-gradient-to-br from-emerald-500/10 hover:text-emerald-200 text-purple-300 border-orange-500 focus-visible:ring-purple-500 text-slate-400');
    expect(decorativeClasses(el)).toEqual(['bg-gradient-to-br', 'from-emerald-500/10', 'hover:text-emerald-200', 'text-purple-300', 'border-orange-500']);
  });
});

// ── L-10 loading and the money blocks mounted once (BD-12, SA C7) ───────────

describe('L-10: loading, and the money blocks keep their nodes', () => {
  it('while the summary read is held: three "Reading…" slots, the sign-in at once, no money block', async () => {
    const gate = deferred();
    summaryGate = gate.promise;
    installFetch();
    render(<UsersPage />);
    await screen.findAllByTestId('row-business');
    fireEvent.click(openButtonFor('Dana Cohen'));
    const drawer = await screen.findByTestId('users-drawer');
    await within(drawer).findByTestId('drawer-strip');
    for (const id of ['strip-plan', 'strip-credits-left', 'strip-ai-spend']) {
      expect(within(drawer).getByTestId(id).textContent).toBe('Reading…');
    }
    expect(within(drawer).getByTestId('strip-last-sign-in').textContent?.startsWith('2026-10-10 08:05 UTC')).toBe(true);
    expect(within(drawer).queryByTestId('credits-block')).toBeNull();
    await act(async () => gate.resolve());
    await within(drawer).findByTestId('boost-cap');
    await waitFor(() => expect(within(drawer).getByTestId('strip-ai-spend').textContent).toBe('$4.21recorded'));
    await quiet();
  });

  it('SA C7: toggling every fold outside the money blocks keeps the same credits and top-ups nodes and sends nothing', async () => {
    const drawer = await openDrawer('Dana Cohen', 'boost-cap');
    const credits = within(drawer).getByTestId('credits-block');
    const boost = within(drawer).getByTestId('boost-block');
    const before = calls.length;
    for (const id of ['bos-panel-failures-more', 'ai-all-products-toggle', 'ai-models-more', 'detail-audit-toggle']) {
      fireEvent.click(within(drawer).getByTestId(id));
      fireEvent.click(within(drawer).getByTestId(id));
    }
    fireEvent.click(within(drawer).getByTestId('bos-panel-plan-summary'));
    await quiet();
    expect(calls.length).toBe(before);

    // A re-render from above (SA optimisation on C7): a list Refresh re-renders the
    // drawer body; the panel and both money blocks must keep their nodes and
    // send no read of their own. Only the one list read goes out.
    const panel = within(drawer).getByTestId('bos-panel');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh the business list', hidden: true }));
    await quiet();
    const sent = calls.slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0].startsWith('/api/admin/users?')).toBe(true);
    expect(within(drawer).getByTestId('bos-panel')).toBe(panel);
    expect(within(drawer).getByTestId('credits-block')).toBe(credits);
    expect(within(drawer).getByTestId('boost-block')).toBe(boost);
  });
});

// ── L-12 a box and a purpose line per section (LF-4d, BD-16) ────────────────

/** Section title, its box key, and the group's test id, in the BD-4 order. */
const BOXED_SECTIONS: Array<[string, DrawerSectionKey, string]> = [
  ['Credits & billing', 'credits', 'drawer-section-credits'],
  ['Plan & entitlements', 'plan', 'drawer-section-plan'],
  ['AI usage', 'ai', 'drawer-section-ai'],
  ['Account & security', 'account', 'drawer-section-account'],
  ['Activity', 'activity', 'detail-audit'],
];

/** Each part's root test id and its own purpose key. */
const PARTS: Array<[string, DrawerPurposeKey]> = [
  ['credits-block', 'credits-part'],
  ['boost-block', 'topups'],
  ['boost-cap', 'limit'],
  ['bos-panel-spend', 'ai-bos'],
  ['bos-panel-failures', 'ai-failures'],
  ['ai-spend-card', 'ai-all'],
  ['account-group-account', 'account-account'],
  ['account-group-signin', 'account-signin'],
  ['plugins-card', 'account-plugins'],
];

const PART_IDS = PARTS.map(([id]) => id);

/** The closest part box around an element (itself included). */
function closestPart(el: Element): Element | null {
  let node: Element | null = el;
  while (node) {
    if (PART_IDS.includes(node.getAttribute('data-testid') ?? '')) return node;
    node = node.parentElement;
  }
  return null;
}

const DANGER_SENTENCE = 'Permanent actions for this account. Each runs a check first; a refused check changes nothing.';

describe('L-12: a box and a purpose line per section (LF-4d, BD-16)', () => {
  it('L-12a: five section boxes, each directly around its named group, in order; the danger area last', async () => {
    const drawer = await openDrawer('Dana Cohen', 'boost-cap');
    const boxes = BOXED_SECTIONS.map(([title, key, testId]) => {
      const box = within(drawer).getByTestId(`drawer-box-${key}`);
      expect({ key, className: box.className }).toEqual({ key, className: SECTION_BOX });
      expect(box.children).toHaveLength(1);
      const named = group(drawer, title);
      expect(box.firstElementChild).toBe(named);
      expect(named.getAttribute('data-testid')).toBe(testId);
      return box;
    });
    const danger = within(drawer).getByTestId('danger-area');
    expectInOrder([...boxes, danger]);
    expect(danger.parentElement?.lastElementChild).toBe(danger);
  });

  it('L-12b: each section sentence is the element straight after its heading, its own words', async () => {
    const drawer = await openDrawer('Dana Cohen', 'boost-cap');
    for (const [title, key] of BOXED_SECTIONS) {
      const heading = group(drawer, title).querySelector('h3') as HTMLElement;
      const purpose = heading.nextElementSibling as HTMLElement;
      expect({ title, id: purpose.getAttribute('data-testid'), text: purpose.textContent, cls: purpose.className }).toEqual({
        title,
        id: `drawer-purpose-${key}`,
        text: DRAWER_PURPOSE[key],
        cls: PURPOSE_LINE,
      });
    }
  });

  it('L-12c (SA C3): each part is a box holding exactly one purpose line whose closest part is itself, after its label', async () => {
    const drawer = await openDrawer('Dana Cohen', 'boost-cap');
    for (const [id, key] of PARTS) {
      const part = within(drawer).getByTestId(id);
      expect({ id, boxed: part.className.includes(PART_BOX) }).toEqual({ id, boxed: true });
      const own = Array.from(part.querySelectorAll('[data-testid^="drawer-purpose-"]')).filter((p) => closestPart(p) === part);
      expect({ id, own: own.map((p) => p.getAttribute('data-testid')) }).toEqual({ id, own: [`drawer-purpose-${key}`] });
      expect(own[0].textContent).toBe(DRAWER_PURPOSE[key]);
      // The label is the part's first p; the purpose line comes after it.
      const label = part.querySelector('p') as HTMLElement;
      expect(label).not.toBe(own[0]);
      expectInOrder([label, own[0]]);
    }
  });

  it('L-12d: the limit is inside Top-ups, and the pointer is still the last element of the top-ups block', async () => {
    const drawer = await openDrawer('Dana Cohen', 'boost-cap');
    const boost = within(drawer).getByTestId('boost-block');
    const cap = within(boost).getByTestId('boost-cap');
    expect(within(cap).getByTestId('drawer-purpose-limit')).toBeTruthy();
    expect(within(cap).queryByTestId('drawer-purpose-topups')).toBeNull();
    const pointer = within(boost).getByTestId('boost-reconcile-pointer');
    const after = Array.from(boost.querySelectorAll('*')).filter(
      (el) => pointer.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING && !pointer.contains(el)
    );
    expect(after).toEqual([]);
  });

  it('L-12e: parts are not groups and purpose lines are not headings', async () => {
    const drawer = await openDrawer('Dana Cohen', 'boost-cap');
    expect(drawer.querySelectorAll('[role="group"]')).toHaveLength(5);
    for (const id of PART_IDS) {
      const part = within(drawer).getByTestId(id);
      expect({ id, role: part.getAttribute('role'), labelledBy: part.getAttribute('aria-labelledby') }).toEqual({
        id,
        role: null,
        labelledBy: null,
      });
    }
    for (const line of Array.from(drawer.querySelectorAll('[data-testid^="drawer-purpose-"]'))) {
      expect(line.tagName).toBe('P');
    }
    expect(drawer.querySelectorAll('[data-testid^="drawer-purpose-"]')).toHaveLength(BOXED_SECTIONS.length + PARTS.length);

    // QA note 3 (BD-16 focus clause, BD-15): focus return falls back to the
    // closest labelled group's heading, so from a money opener and from every
    // part that group must be the section, never a part.
    const LABELLED = '[role="group"][aria-labelledby]';
    const credits = within(drawer).getByTestId('drawer-section-credits');
    for (const opener of ['credits-give', 'boost-cap-set']) {
      expect({ opener, group: within(drawer).getByTestId(opener).closest(LABELLED)?.getAttribute('data-testid') }).toEqual({
        opener,
        group: 'drawer-section-credits',
      });
    }
    expect(within(drawer).getByTestId('credits-give').closest(LABELLED)).toBe(credits);
    const sectionOf: Record<string, string> = {
      'credits-block': 'drawer-section-credits',
      'boost-block': 'drawer-section-credits',
      'boost-cap': 'drawer-section-credits',
      'bos-panel-spend': 'drawer-section-ai',
      'bos-panel-failures': 'drawer-section-ai',
      'ai-spend-card': 'drawer-section-ai',
      'account-group-account': 'drawer-section-account',
      'account-group-signin': 'drawer-section-account',
      'plugins-card': 'drawer-section-account',
    };
    for (const id of PART_IDS) {
      const group = within(drawer).getByTestId(id).closest(LABELLED);
      expect({ id, group: group?.getAttribute('data-testid') }).toEqual({ id, group: sectionOf[id] });
    }
  });

  it('L-12f: a non-Business OS login: five section boxes and sentences; in AI usage only All products; no money part', async () => {
    const drawer = await openDrawer('Oren Levi', 'bos-panel-not-bos');
    for (const [, key] of BOXED_SECTIONS) {
      expect(within(drawer).getByTestId(`drawer-box-${key}`).className).toBe(SECTION_BOX);
      expect(within(drawer).getByTestId(`drawer-purpose-${key}`).textContent).toBe(DRAWER_PURPOSE[key]);
    }
    const ai = group(drawer, 'AI usage');
    expect(within(ai).getByTestId('drawer-purpose-ai-all')).toBeTruthy();
    expect(within(ai).queryByTestId('drawer-purpose-ai-bos')).toBeNull();
    expect(within(ai).queryByTestId('drawer-purpose-ai-failures')).toBeNull();
    for (const key of ['credits-part', 'topups', 'limit']) {
      expect(within(drawer).queryByTestId(`drawer-purpose-${key}`)).toBeNull();
    }
  });

  it('L-12g: the danger area keeps its rose box and its sentence, word for word, and gets no purpose line', async () => {
    const drawer = await openDrawer('Dana Cohen', 'boost-cap');
    const danger = within(drawer).getByTestId('danger-area');
    expect(danger.className).toBe('p-6 rounded-xl border border-rose-500/40 bg-rose-500/5');
    expect(within(danger).getByText(DANGER_SENTENCE)).toBeTruthy();
    expect(danger.querySelector('[data-testid^="drawer-purpose-"]')).toBeNull();
    expect(danger.closest('[data-testid^="drawer-box-"]')).toBeNull();
  });

  it('L-12h: while the summary read is held, the three panel boxes show their sentences with the loading lines', async () => {
    const gate = deferred();
    summaryGate = gate.promise;
    installFetch();
    render(<UsersPage />);
    await screen.findAllByTestId('row-business');
    fireEvent.click(openButtonFor('Dana Cohen'));
    const drawer = await screen.findByTestId('users-drawer');
    await within(drawer).findByTestId('drawer-strip');
    for (const key of ['credits', 'plan', 'ai'] as const) {
      expect(within(drawer).getByTestId(`drawer-box-${key}`).className).toBe(SECTION_BOX);
      expect(within(drawer).getByTestId(`drawer-purpose-${key}`).textContent).toBe(DRAWER_PURPOSE[key]);
    }
    expect(within(drawer).getByText('Loading Business OS details…')).toBeTruthy();
    expect(within(drawer).queryByTestId('credits-block')).toBeNull();
    await act(async () => gate.resolve());
    await within(drawer).findByTestId('boost-cap');
    await quiet();
  });
});
