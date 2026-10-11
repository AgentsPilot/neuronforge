/**
 * @jest-environment jsdom
 */

/**
 * The "Credit top-ups" block's actions (credits boost slice 6b; workplan §3.4;
 * SA C-2, C-3, C-5, C-6; BQ-1): Set limit / Back to default with a two-step
 * confirm and one submit at a time, the reconcile button with its confirm and
 * counts, and Take back on a purchase's lot.
 *
 * Fetch is stubbed per URL and method; a POST can be held open to test double
 * submits.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { BoostBlock } from '../components/BoostBlock';
import { BOOST_ACTION_COPY } from '../boostCopy';
import type { AdminBoostPurchaseRow, AdminBoostView } from '@/lib/business-os/boost/boostAdminViewTypes';

const ACCOUNT = '99999999-9999-4999-8999-999999999999';
const ADMIN_ID = 'abcdef12-3456-4789-8abc-def012345678';
const GET_URL = `/api/admin/business-os/credits/accounts/${ACCOUNT}/boost`;
const OPS_URL = `/api/admin/business-os/entitlements/accounts/${ACCOUNT}`;
const RECONCILE_URL = '/api/admin/business-os/credits/boost/reconcile';
const BUSINESS = 'Acme Therapy';
const LOT = '77777777-7777-4777-8777-777777777777';

beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.releasePointerCapture ??= () => undefined;
  proto.scrollIntoView ??= () => undefined;
});

function row(overrides: Partial<AdminBoostPurchaseRow> = {}): AdminBoostPurchaseRow {
  return {
    id: 'aaaaaaaa-1111-4111-8111-11111111111a',
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
    lotId: LOT,
    stripe: { paymentIntentId: 'pi_3Test1', chargeId: 'ch_3Test1', disputeId: null, checkoutSessionId: 'cs_test_a1' },
    createdAt: '2026-10-01T12:00:00.000Z',
    paidAt: '2026-10-01T12:05:00.000Z',
    statusChangedAt: '2026-10-01T12:05:00.000Z',
    checkoutExpiresAt: '2026-10-01T12:30:00.000Z',
    ...overrides,
  };
}

const ACTIVE = { id: 'o1', amountMinor: 50000, currency: 'USD', reason: 'annual prepay customer', actorAdminId: ADMIN_ID, createdAt: '2026-10-02T09:00:00.000Z' };

function view(overrides: Partial<AdminBoostView> = {}): AdminBoostView {
  return {
    accountId: ACCOUNT,
    isOwnAccount: false,
    serverMode: 'test',
    purchases: { status: 'ok', rows: [row()], truncated: { test: false, live: false } },
    cap: { status: 'ok', default: { amountMinor: 15000, currency: 'USD', windowDays: 30 }, active: null, history: [] },
    limits: { minMinor: 100, maxMinor: 150000, stepMinor: 100, currency: 'USD', windowDays: 30, reasonMin: 3, reasonMax: 500 },
    ...overrides,
  };
}

type Answer = { status: number; body: unknown } | Promise<{ status: number; body: unknown }>;
interface Routes {
  get: () => Answer;
  ops?: (body: Record<string, unknown>) => Answer;
  reconcile?: (body: string) => Answer;
}

function mockFetch(routes: Routes) {
  const calls: Array<{ url: string; method: string; body: string | null }> = [];
  const fetchMock = jest.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET';
    calls.push({ url: String(url), method, body: init?.body ?? null });
    let answer: Answer = { status: 404, body: { success: false, error: 'not mocked' } };
    if (method === 'GET' && url === GET_URL) answer = routes.get();
    else if (method === 'POST' && url === OPS_URL && routes.ops) answer = routes.ops(JSON.parse(init!.body!));
    else if (method === 'POST' && url === RECONCILE_URL && routes.reconcile) answer = routes.reconcile(init!.body!);
    const { status, body } = await answer;
    return { ok: status < 400, status, json: async () => body };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
  return calls;
}

const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });
type Call = { url: string; method: string; body: string | null };
const posts = (calls: Call[], url: string) => calls.filter((call) => call.method === 'POST' && call.url === url);
const gets = (calls: Call[]) => calls.filter((call) => call.method === 'GET');

async function mount(data: AdminBoostView, routes: Omit<Routes, 'get'> = {}, props: Partial<React.ComponentProps<typeof BoostBlock>> = {}) {
  const calls = mockFetch({ get: () => ok(data), ...routes });
  render(<BoostBlock accountId={ACCOUNT} businessLabel={BUSINESS} {...props} />);
  await screen.findByTestId('boost-cap');
  return calls;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('the buttons', () => {
  it('Set limit and the reconcile button for another account; Back to default only with an override', async () => {
    await mount(view());
    expect(screen.getByTestId('boost-cap-set').textContent).toBe('Set limit');
    expect(screen.queryByTestId('boost-cap-end')).toBeNull();
    expect(screen.getByTestId('boost-reconcile').textContent).toBe('Run billing reconcile now (all accounts)');
  });

  it('with an active override, Back to default is offered', async () => {
    await mount(view({ cap: { status: 'ok', default: { amountMinor: 15000, currency: 'USD', windowDays: 30 }, active: ACTIVE, history: [] } }));
    expect(screen.getByTestId('boost-cap-end').textContent).toBe('Back to default');
  });

  it('on the admin\'s own account: no Set limit, no reconcile, no Take back; the sentence says why', async () => {
    await mount(view({ isOwnAccount: true }), {}, { takeBack: { lotIds: new Set([LOT]), loadedLotIds: new Set([LOT]), onTakeBack: jest.fn() } });
    expect(screen.queryByTestId('boost-cap-set')).toBeNull();
    expect(screen.queryByTestId('boost-reconcile')).toBeNull();
    expect(screen.queryByTestId('boost-take-back')).toBeNull();
    expect(screen.getByTestId('boost-own-account').textContent).toBe(BOOST_ACTION_COPY.ownAccount);
  });
});

describe('Set limit (SA C-3)', () => {
  async function openSet(data = view(), ops?: Routes['ops']) {
    const calls = await mount(data, { ops });
    fireEvent.click(screen.getByTestId('boost-cap-set'));
    const dialog = await screen.findByTestId('boost-cap-dialog');
    return { calls, dialog };
  }

  it('names the business, the bounds from configuration and the window; shows the current limit', async () => {
    const { dialog } = await openSet();
    expect(dialog.textContent).toContain('Set the top-up spending limit for Acme Therapy');
    expect(dialog.textContent).toContain('Whole dollars, from $1 to $1,500, per 30 days. The reason is internal: the business never sees it.');
    expect(screen.getByTestId('boost-cap-dialog-current').textContent).toBe('Now: $150 per 30 days (the default)');
  });

  it.each([['0'], ['1500.50'], ['1501'], ['-5'], ['abc'], ['']])('amount %p keeps Continue disabled', async (amount) => {
    await openSet();
    fireEvent.change(screen.getByTestId('boost-cap-amount'), { target: { value: amount } });
    fireEvent.change(screen.getByTestId('boost-cap-reason-input'), { target: { value: 'support case' } });
    expect((screen.getByTestId('boost-cap-continue') as HTMLButtonElement).disabled).toBe(true);
  });

  it('QA6b-L1: two emoji are two characters (code points, as the SQL counts), so Continue stays disabled; three pass', async () => {
    await openSet();
    fireEvent.change(screen.getByTestId('boost-cap-amount'), { target: { value: '500' } });
    fireEvent.change(screen.getByTestId('boost-cap-reason-input'), { target: { value: '\u{1F600}\u{1F600}' } });
    expect((screen.getByTestId('boost-cap-continue') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('boost-cap-reason-input'), { target: { value: '\u{1F600}\u{1F600}\u{1F600}' } });
    expect((screen.getByTestId('boost-cap-continue') as HTMLButtonElement).disabled).toBe(false);
  });

  it('a reason is required (3 characters at least)', async () => {
    await openSet();
    fireEvent.change(screen.getByTestId('boost-cap-amount'), { target: { value: '500' } });
    fireEvent.change(screen.getByTestId('boost-cap-reason-input'), { target: { value: 'ab' } });
    expect((screen.getByTestId('boost-cap-continue') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('boost-cap-reason-input'), { target: { value: 'abc' } });
    expect((screen.getByTestId('boost-cap-continue') as HTMLButtonElement).disabled).toBe(false);
  });

  it('the confirm step restates the old limit, the new limit and the window; Confirm posts minor units; the block re-reads and says what the SERVER saved', async () => {
    const { calls } = await openSet(view(), () => ok({ accountId: ACCOUNT, op: 'set_boost_cap', overrideId: 'n1', previousOverrideId: null, amountMinor: 50000 }));
    fireEvent.change(screen.getByTestId('boost-cap-amount'), { target: { value: '$500' } });
    fireEvent.change(screen.getByTestId('boost-cap-reason-input'), { target: { value: '  annual prepay customer  ' } });
    fireEvent.click(screen.getByTestId('boost-cap-continue'));

    expect(screen.getByTestId('boost-cap-confirm-summary').textContent).toBe('Set the limit of Acme Therapy to $500 per 30 days');
    expect(screen.getByTestId('boost-cap-confirm-now').textContent).toBe('$150 per 30 days (the default)');
    expect(screen.getByTestId('boost-cap-confirm-after').textContent).toBe('$500 per 30 days (set by an admin)');
    expect(screen.getByTestId('boost-cap-confirm-reason').textContent).toBe('annual prepay customer');

    const getsBefore = gets(calls).length;
    fireEvent.click(screen.getByTestId('boost-cap-confirm'));
    expect((await screen.findByTestId('boost-notice')).textContent).toContain('Set the limit of Acme Therapy to $500 per 30 days.');
    expect(posts(calls, OPS_URL).map((call) => JSON.parse(call.body!))).toEqual([{ op: 'set_boost_cap', amountMinor: 50000, reason: 'annual prepay customer' }]);
    expect(screen.queryByTestId('boost-cap-dialog')).toBeNull();
    await waitFor(() => expect(gets(calls).length).toBe(getsBefore + 1));
  });

  it('SA C-2: the server says unchanged → "already …; nothing changed."', async () => {
    await openSet(view({ cap: { status: 'ok', default: { amountMinor: 15000, currency: 'USD', windowDays: 30 }, active: ACTIVE, history: [] } }), () =>
      ok({ accountId: ACCOUNT, op: 'set_boost_cap', unchanged: true, amountMinor: 50000, overrideId: 'o1' })
    );
    expect(screen.getByTestId('boost-cap-dialog-current').textContent).toBe('Now: $500 per 30 days (set by an admin)');
    fireEvent.change(screen.getByTestId('boost-cap-amount'), { target: { value: '500' } });
    fireEvent.change(screen.getByTestId('boost-cap-reason-input'), { target: { value: 'double check' } });
    fireEvent.click(screen.getByTestId('boost-cap-continue'));
    fireEvent.click(screen.getByTestId('boost-cap-confirm'));
    expect((await screen.findByTestId('boost-notice')).textContent).toContain('The limit of Acme Therapy was already $500 per 30 days; nothing changed.');
  });

  it('one submit at a time: a second Confirm while the first is in flight posts nothing, and the dialog cannot be closed', async () => {
    const held = deferred<{ status: number; body: unknown }>();
    const { calls } = await openSet(view(), () => held.promise);
    fireEvent.change(screen.getByTestId('boost-cap-amount'), { target: { value: '500' } });
    fireEvent.change(screen.getByTestId('boost-cap-reason-input'), { target: { value: 'support case' } });
    fireEvent.click(screen.getByTestId('boost-cap-continue'));
    fireEvent.click(screen.getByTestId('boost-cap-confirm'));
    fireEvent.click(screen.getByTestId('boost-cap-confirm'));
    fireEvent.keyDown(screen.getByTestId('boost-cap-dialog'), { key: 'Escape' });
    expect(posts(calls, OPS_URL)).toHaveLength(1);
    expect(screen.getByTestId('boost-cap-dialog')).toBeTruthy();
    expect((screen.getByTestId('boost-cap-confirm') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => held.resolve(ok({ amountMinor: 50000 })));
    expect(await screen.findByTestId('boost-notice')).toBeTruthy();
    expect(posts(calls, OPS_URL)).toHaveLength(1);
  });

  it.each([
    ['own_account', 'You cannot change your own account.'],
    ['plan_row_missing', 'This business has no plan yet, so it has no limit to change.'],
    ['invalid_body', 'The amount or the reason is not valid.'],
    ['something_else', 'Something failed on the server. The correlation id is in the logs.'],
  ])('a refusal %s is shown in words, back on the form, nothing closes', async (code, words) => {
    await openSet(view(), () => ({ status: 409, body: { success: false, error: code } }));
    fireEvent.change(screen.getByTestId('boost-cap-amount'), { target: { value: '500' } });
    fireEvent.change(screen.getByTestId('boost-cap-reason-input'), { target: { value: 'support case' } });
    fireEvent.click(screen.getByTestId('boost-cap-continue'));
    fireEvent.click(screen.getByTestId('boost-cap-confirm'));
    expect((await screen.findByTestId('boost-cap-dialog-error')).textContent).toBe(words);
    expect(screen.getByTestId('boost-cap-amount')).toBeTruthy();
    expect(screen.queryByTestId('boost-notice')).toBeNull();
  });
});

describe('Back to default', () => {
  it('restates the override and the default, posts end_boost_cap with the reason, and says the business is back on the default', async () => {
    const calls = await mount(view({ cap: { status: 'ok', default: { amountMinor: 15000, currency: 'USD', windowDays: 30 }, active: ACTIVE, history: [] } }), {
      ops: () => ok({ accountId: ACCOUNT, op: 'end_boost_cap', overrideId: 'o1' }),
    });
    fireEvent.click(screen.getByTestId('boost-cap-end'));
    const dialog = await screen.findByTestId('boost-cap-dialog');
    expect(dialog.textContent).toContain('Return Acme Therapy to the default limit');
    expect(screen.queryByTestId('boost-cap-amount')).toBeNull();
    fireEvent.change(screen.getByTestId('boost-cap-reason-input'), { target: { value: 'campaign over' } });
    fireEvent.click(screen.getByTestId('boost-cap-continue'));
    expect(screen.getByTestId('boost-cap-confirm-summary').textContent).toBe('Return the limit of Acme Therapy to the default: $150 per 30 days');
    expect(screen.getByTestId('boost-cap-confirm-now').textContent).toBe('$500 per 30 days (set by an admin)');
    expect(screen.getByTestId('boost-cap-confirm-after').textContent).toBe('$150 per 30 days (the default)');
    fireEvent.click(screen.getByTestId('boost-cap-confirm'));
    expect((await screen.findByTestId('boost-notice')).textContent).toContain('Acme Therapy is back on the default limit of $150 per 30 days.');
    expect(posts(calls, OPS_URL).map((call) => JSON.parse(call.body!))).toEqual([{ op: 'end_boost_cap', reason: 'campaign over' }]);
  });

  it('already on the default (a repeat elsewhere) → the 409 in words', async () => {
    await mount(view({ cap: { status: 'ok', default: { amountMinor: 15000, currency: 'USD', windowDays: 30 }, active: ACTIVE, history: [] } }), {
      ops: () => ({ status: 409, body: { success: false, error: 'no_active_cap_override' } }),
    });
    fireEvent.click(screen.getByTestId('boost-cap-end'));
    fireEvent.change(await screen.findByTestId('boost-cap-reason-input'), { target: { value: 'campaign over' } });
    fireEvent.click(screen.getByTestId('boost-cap-continue'));
    fireEvent.click(screen.getByTestId('boost-cap-confirm'));
    expect((await screen.findByTestId('boost-cap-dialog-error')).textContent).toBe('This business is already on the default limit.');
  });
});

describe('Run billing reconcile now (SA C-6)', () => {
  const COUNTS = {
    boostExamined: 3,
    boostCredited: 1,
    boostExpired: 1,
    boostFailed: 0,
    boostFlagged: 1,
    boostDeferred: 0,
    boostDisputesExamined: 0,
    boostReceiptsFilled: 2,
    boostDeadlineHit: 0,
  };

  it('the confirm says it covers every business; Run posts an EMPTY body (no account id) and shows the counts in words', async () => {
    const calls = await mount(view(), { reconcile: () => ok({ runId: 'r1', counts: COUNTS, passesRun: 1, passesFailed: 0, durationMs: 12 }) });
    fireEvent.click(screen.getByTestId('boost-reconcile'));
    expect((await screen.findByTestId('boost-reconcile-description')).textContent).toBe(BOOST_ACTION_COPY.reconcileDescription);
    expect(screen.getByTestId('boost-reconcile-dialog').textContent).toContain('not only this one');
    expect(posts(calls, RECONCILE_URL)).toHaveLength(0);
    fireEvent.click(screen.getByTestId('boost-reconcile-run'));
    const notice = await screen.findByTestId('boost-notice');
    expect(notice.textContent).toContain('Reconcile finished: 3 stuck top-ups examined, 1 credited, 1 expired, 0 marked failed, 1 need a person, 0 left for the next run.');
    expect(notice.textContent).toContain('2 missing receipts filled.');
    const sent = posts(calls, RECONCILE_URL);
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toBe('{}');
    expect(sent[0].body).not.toContain(ACCOUNT);
  });

  it('a run cut by its deadline, or with Stripe unreadable, says so', async () => {
    await mount(view(), { reconcile: () => ok({ counts: { ...COUNTS, boostDeadlineHit: 1, boostRowsLeft: 4, boostStripeUnavailable: 1 } }) });
    fireEvent.click(screen.getByTestId('boost-reconcile'));
    fireEvent.click(await screen.findByTestId('boost-reconcile-run'));
    const notice = await screen.findByTestId('boost-notice');
    expect(notice.textContent).toContain('It stopped at its time limit with 4 top-ups left; the nightly run picks them up.');
    expect(notice.textContent).toContain('Stripe could not be read, so nothing was checked.');
  });

  it.each([
    ['a pass that failed (passesFailed > 0)', { runId: 'r1', counts: {}, passesRun: 1, passesFailed: 1, durationMs: 3 }],
    ['counts without boostExamined', { runId: 'r1', counts: { passesRun: 1 }, passesRun: 1, passesFailed: 0, durationMs: 3 }],
    ['no counts at all', { runId: 'r1', passesRun: 1, passesFailed: 0 }],
  ])('QA6b-M1: a 200 with %s is the failure line, never "0 examined"', async (_name, data) => {
    await mount(view(), { reconcile: () => ok(data) });
    fireEvent.click(screen.getByTestId('boost-reconcile'));
    fireEvent.click(await screen.findByTestId('boost-reconcile-run'));
    expect((await screen.findByTestId('boost-reconcile-error')).textContent).toBe(
      'The reconcile could not run. Nothing is lost: the nightly run will try again.'
    );
    expect(screen.queryByTestId('boost-notice')).toBeNull();
  });

  it('a list read that failed is mentioned', async () => {
    await mount(view(), { reconcile: () => ok({ counts: { ...COUNTS, boostListFailed: 1 }, passesRun: 1, passesFailed: 0 }) });
    fireEvent.click(screen.getByTestId('boost-reconcile'));
    fireEvent.click(await screen.findByTestId('boost-reconcile-run'));
    expect((await screen.findByTestId('boost-notice')).textContent).toContain('Some top-ups could not be listed; the nightly run tries again.');
  });

  it('one run at a time, and a failure says it could not run', async () => {
    const held = deferred<{ status: number; body: unknown }>();
    const calls = await mount(view(), { reconcile: () => held.promise });
    fireEvent.click(screen.getByTestId('boost-reconcile'));
    fireEvent.click(await screen.findByTestId('boost-reconcile-run'));
    fireEvent.click(screen.getByTestId('boost-reconcile-run'));
    expect(posts(calls, RECONCILE_URL)).toHaveLength(1);
    expect(screen.getByTestId('boost-reconcile-run').textContent).toBe('Running…');
    await act(async () => held.resolve({ status: 500, body: { success: false, error: 'reconcile_failed' } }));
    expect((await screen.findByTestId('boost-reconcile-error')).textContent).toBe(BOOST_ACTION_COPY.reconcileFailed);
    expect(screen.queryByTestId('boost-notice')).toBeNull();
  });
});

describe('Take back (SA C-5)', () => {
  it('a purchase whose lot the Credits block can take back: the button asks the panel to open that lot', async () => {
    const onTakeBack = jest.fn();
    await mount(view(), {}, { takeBack: { lotIds: new Set([LOT]), loadedLotIds: new Set([LOT]), onTakeBack } });
    fireEvent.click(screen.getByTestId('boost-take-back'));
    expect(onTakeBack).toHaveBeenCalledWith(LOT);
  });

  it('a lot the Credits block has NOT loaded (yet) → "Take back in Credits above", no button', async () => {
    await mount(view(), {}, { takeBack: { lotIds: new Set(['other']), loadedLotIds: new Set(['other']), onTakeBack: jest.fn() } });
    expect(screen.queryByTestId('boost-take-back')).toBeNull();
    expect(screen.getByTestId('boost-take-back-above').textContent).toBe('Take back in Credits above');
  });

  it('QA6b-L2: a loaded lot that cannot be taken back (expired, used up, not counted) → "Nothing left to take back", no pointer to Credits', async () => {
    await mount(view(), {}, { takeBack: { lotIds: new Set(), loadedLotIds: new Set([LOT]), onTakeBack: jest.fn() } });
    expect(screen.queryByTestId('boost-take-back')).toBeNull();
    expect(screen.queryByTestId('boost-take-back-above')).toBeNull();
    expect(screen.getByTestId('boost-take-back-none').textContent).toBe('Nothing left to take back');
  });

  it('no panel wiring → the fallback text; a purchase with no lot → nothing', async () => {
    await mount(view({ purchases: { status: 'ok', rows: [row(), row({ id: 'b', lotId: null, status: 'expired' })], truncated: { test: false, live: false } } }));
    const rows = screen.getAllByTestId('boost-purchase');
    expect(within(rows[0]).getByTestId('boost-take-back-above')).toBeTruthy();
    expect(within(rows[1]).queryByTestId('boost-take-back-above')).toBeNull();
  });
});
