/**
 * @jest-environment jsdom
 */

/**
 * The recent-grant warning on the Give credits confirm step (2026-10-15, the
 * double-give guard; docs/workplans/BUSINESS_OS_RECENT_GRANT_WARNING_WORKPLAN.md).
 *
 * One amber line when the account already has an admin grant from the last 15
 * minutes; shown only, never blocking. It reads the lots the block already
 * loaded and adds no request. Ages are relative to the real clock at render,
 * so each lot is dated from `Date.now()` when the test builds it.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { CreditsBlock } from '../components/CreditsBlock';
import { RECENT_GRANT_WINDOW_MS, minutesAgo, mostRecentAdminGrant, recentGrantWarning } from '../creditCopy';
import type { AccountCreditPositionPayload, CreditLotView } from '../types';

const ACCOUNT = '99999999-9999-4999-8999-999999999999';
const ADMIN_ID = 'abcdef12-3456-4789-8abc-def012345678';
const GET_URL = `/api/admin/business-os/credits/accounts/${ACCOUNT}`;
const POST_URL = `/api/admin/business-os/entitlements/accounts/${ACCOUNT}`;
const BUSINESS = 'Acme Therapy';
const MINUTE = 60 * 1000;
const WARNING = 'credit-confirm-recent-grant';

beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.releasePointerCapture ??= () => undefined;
  proto.scrollIntoView ??= () => undefined;
});

let uuidCounter = 0;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

beforeEach(() => {
  uuidCounter = 0;
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { randomUUID: () => uuid(++uuidCounter) },
  });
});

const ago = (minutes: number) => new Date(Date.now() - minutes * MINUTE).toISOString();

function lotView(overrides: Partial<CreditLotView> = {}): CreditLotView {
  return {
    id: 'aaaaaaaa-1111-4111-8111-11111111111a',
    source: 'admin_grant',
    credits: 500,
    remaining: 500,
    expired: false,
    counted: true,
    expiresAt: null,
    reason: 'goodwill',
    actorKind: 'admin',
    actorAdminId: ADMIN_ID,
    createdAt: ago(3),
    takeBacks: [],
    ...overrides,
  };
}

function payload(lots: CreditLotView[]): AccountCreditPositionPayload {
  return {
    accountId: ACCOUNT,
    isOwnAccount: false,
    limits: { grantCeiling: 100000, reasonMin: 3, reasonMax: 500 },
    usage: { status: 'error' },
    extra: { status: 'ok', extraCredits: 0, hasInconsistentLot: false, lots },
  };
}

/** Every call as sent: url, the whole init, and the raw body string, so "the same request" is byte-level. */
interface Call {
  url: string;
  method: string;
  headers: unknown;
  cache: unknown;
  rawBody: string | null;
}

function setup(lots: CreditLotView[]) {
  const calls: Call[] = [];
  const fetchMock = jest.fn(async (url: string, init?: { method?: string; body?: string; headers?: unknown; cache?: unknown }) => {
    const method = init?.method ?? 'GET';
    calls.push({ url: String(url), method, headers: init?.headers, cache: init?.cache, rawBody: init?.body ?? null });
    if (method === 'GET' && String(url) === GET_URL) {
      return { ok: true, status: 200, json: async () => ({ success: true, data: payload(lots) }) };
    }
    if (method === 'POST' && String(url) === POST_URL) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { accountId: ACCOUNT, op: 'grant_credits', lotId: 'ffffffff-6666-4666-8666-66666666666f', credits: 50, expiresAt: null, replayed: false },
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({ success: false, error: 'not mocked' }) };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
  const view = render(<CreditsBlock accountId={ACCOUNT} businessLabel={BUSINESS} />);
  return { calls, view };
}

async function loaded() {
  await waitFor(() => expect(screen.queryByText('Loading credits…')).toBeNull());
}

/** Open Give, fill a valid form (no end date), Continue to the confirm step. */
async function giveToConfirm() {
  fireEvent.click(screen.getByTestId('credits-give'));
  const dialog = await screen.findByTestId('credit-form-dialog');
  fireEvent.change(within(dialog).getByTestId('credit-amount'), { target: { value: '50' } });
  fireEvent.click(within(dialog).getByTestId('no-end-date-choice'));
  fireEvent.change(within(dialog).getByTestId('credit-reason'), { target: { value: 'goodwill' } });
  // The form step never warns: only the confirm step does.
  expect(within(dialog).queryByTestId(WARNING)).toBeNull();
  fireEvent.click(within(dialog).getByTestId('credit-form-continue'));
  expect(within(dialog).getByTestId('credit-confirm-summary').textContent).toBe(`Give 50 credits to ${BUSINESS}`);
  return dialog;
}

describe('the recent-grant warning on the Give confirm step', () => {
  it('shows one amber line for an admin grant created 3 minutes ago', async () => {
    setup([lotView({ credits: 500, createdAt: ago(3) })]);
    await loaded();
    const dialog = await giveToConfirm();
    expect(within(dialog).getByTestId(WARNING).textContent).toBe(
      'This business was already given 500 credits 3 minutes ago. Confirm only if you mean to give more.'
    );
    // Shown only: Confirm stays enabled.
    expect((within(dialog).getByTestId('credit-form-confirm') as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows nothing for a grant created 16 minutes ago', async () => {
    setup([lotView({ createdAt: ago(16) })]);
    await loaded();
    const dialog = await giveToConfirm();
    expect(within(dialog).queryByTestId(WARNING)).toBeNull();
  });

  it('shows nothing on Take back, even on a grant made a minute ago', async () => {
    setup([lotView({ createdAt: ago(1) })]);
    await loaded();
    fireEvent.click(screen.getByTestId('credits-take-back'));
    const dialog = await screen.findByTestId('credit-form-dialog');
    fireEvent.change(within(dialog).getByTestId('credit-amount'), { target: { value: '50' } });
    fireEvent.change(within(dialog).getByTestId('credit-reason'), { target: { value: 'mistaken amount' } });
    fireEvent.click(within(dialog).getByTestId('credit-form-continue'));
    expect(within(dialog).getByTestId('credit-confirm-summary').textContent).toBe(`Take back 50 credits from ${BUSINESS}`);
    expect(within(dialog).queryByTestId(WARNING)).toBeNull();
  });

  it('shows nothing when the only recent lot is a top-up purchase', async () => {
    setup([
      lotView({ source: 'boost_purchase', actorKind: 'stripe_webhook', actorAdminId: null, reason: null, createdAt: ago(2) }),
      lotView({ id: 'bbbbbbbb-2222-4222-8222-22222222222b', createdAt: ago(40) }),
    ]);
    await loaded();
    const dialog = await giveToConfirm();
    expect(within(dialog).queryByTestId(WARNING)).toBeNull();
  });

  it('names the most recent of several recent grants, whatever the list order', async () => {
    setup([
      lotView({ id: 'aaaaaaaa-1111-4111-8111-11111111111a', credits: 300, createdAt: ago(9) }),
      lotView({ id: 'bbbbbbbb-2222-4222-8222-22222222222b', credits: 1250, createdAt: ago(2) }),
      lotView({ id: 'cccccccc-3333-4333-8333-33333333333c', credits: 75, createdAt: ago(5) }),
    ]);
    await loaded();
    const dialog = await giveToConfirm();
    expect(within(dialog).getByTestId(WARNING).textContent).toBe(
      'This business was already given 1,250 credits 2 minutes ago. Confirm only if you mean to give more.'
    );
  });

  it('Confirm sends exactly the same request with or without the warning, and the warning adds no request', async () => {
    async function giveAndCapture(lots: CreditLotView[]) {
      uuidCounter = 0;
      const { calls, view } = setup(lots);
      await loaded();
      const dialog = await giveToConfirm();
      const warned = within(dialog).queryByTestId(WARNING) !== null;
      await act(async () => {
        fireEvent.click(within(dialog).getByTestId('credit-form-confirm'));
      });
      await screen.findByTestId('credits-success');
      const posts = calls.filter((c) => c.method === 'POST');
      // Up to Confirm: the block's own read only, then the one POST.
      const beforePost = calls.slice(0, calls.indexOf(posts[0]));
      view.unmount();
      return { warned, posts, beforePost };
    }

    const withWarning = await giveAndCapture([lotView({ createdAt: ago(3) })]);
    const without = await giveAndCapture([lotView({ createdAt: ago(60) })]);

    expect(withWarning.warned).toBe(true);
    expect(without.warned).toBe(false);
    expect(withWarning.posts).toHaveLength(1);
    expect(without.posts).toHaveLength(1);
    expect(withWarning.posts[0]).toEqual(without.posts[0]);
    expect(withWarning.posts[0].rawBody).toBe(
      JSON.stringify({ op: 'grant_credits', amount: 50, expiresAt: null, requestId: uuid(1), reason: 'goodwill' })
    );
    expect(withWarning.beforePost.map((c) => `${c.method} ${c.url}`)).toEqual([`GET ${GET_URL}`]);
  });
});

describe('the recent-grant helpers', () => {
  const NOW = Date.parse('2026-10-15T12:00:00.000Z');
  const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

  it('the window is 15 minutes, exclusive at the edge', () => {
    expect(RECENT_GRANT_WINDOW_MS).toBe(15 * MINUTE);
    expect(mostRecentAdminGrant([lotView({ createdAt: at(15 * MINUTE - 1) })], NOW)).not.toBeNull();
    expect(mostRecentAdminGrant([lotView({ createdAt: at(15 * MINUTE) })], NOW)).toBeNull();
  });

  it('a slightly future grant (the admin clock behind) counts and reads "just now"; an unreadable date is skipped', () => {
    const future = lotView({ createdAt: at(-2 * MINUTE) });
    expect(mostRecentAdminGrant([future], NOW)).toBe(future);
    expect(recentGrantWarning(future, NOW)).toBe(
      'This business was already given 500 credits just now. Confirm only if you mean to give more.'
    );
    expect(mostRecentAdminGrant([lotView({ createdAt: 'not a date' })], NOW)).toBeNull();
  });

  it('time words: just now under a minute, then 1 minute, then N minutes', () => {
    expect(minutesAgo(at(59 * 1000), NOW)).toBe('just now');
    expect(minutesAgo(at(60 * 1000), NOW)).toBe('1 minute ago');
    expect(minutesAgo(at(14 * MINUTE + 59 * 1000), NOW)).toBe('14 minutes ago');
  });
});
