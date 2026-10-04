/**
 * @jest-environment jsdom
 */

/**
 * The Credits block and its Give / Take back forms (credit deduction slice
 * 11c, workplan §11c.6.3; SA W11c-7, W11c-8, W11c-10, W11c-11; QA11b-N2).
 *
 * Fetch is stubbed per URL and method; `crypto.randomUUID` is stubbed with a
 * counter so a reused or renewed request id is visible (W11c-8).
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { CreditsBlock } from '../components/CreditsBlock';
import { CREDIT_ERROR_COPY, GENERIC_ERROR_COPY } from '../creditCopy';
import type { AccountCreditPositionPayload, CreditLotView } from '../types';

const ACCOUNT = '99999999-9999-4999-8999-999999999999';
const ADMIN_ID = 'abcdef12-3456-4789-8abc-def012345678';
const GET_URL = `/api/admin/business-os/credits/accounts/${ACCOUNT}`;
const POST_URL = `/api/admin/business-os/entitlements/accounts/${ACCOUNT}`;
const BUSINESS = 'Acme Therapy';

// The block and the dialog's Radix primitives want a few browser APIs jsdom lacks.
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

function lotView(overrides: Partial<CreditLotView> = {}): CreditLotView {
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
    takeBacks: [
      { id: 'dddddddd-4444-4444-8444-44444444444d', credits: 100, reason: 'mistaken amount', actorAdminId: ADMIN_ID, createdAt: '2026-09-02T00:00:00.000Z' },
    ],
    ...overrides,
  };
}

const LOT_A = lotView();
const LOT_B = lotView({ id: 'bbbbbbbb-2222-4222-8222-22222222222b', credits: 50, remaining: 50, expired: true, expiresAt: '2026-09-30T00:00:00.000Z', takeBacks: [], reason: 'trial top-up' });
const LOT_C = lotView({ id: 'cccccccc-3333-4333-8333-33333333333c', source: 'boost_purchase', credits: 71.25, remaining: 71.25, actorKind: 'stripe_webhook', actorAdminId: null, reason: null, takeBacks: [] });
const LOT_D = lotView({ id: 'eeeeeeee-5555-4555-8555-55555555555e', credits: 10, remaining: 0, takeBacks: [], reason: 'used up' });

// planLeft 3,765.5 + extraCredits 271.25 = 4,036.75: a distinctive sum that must appear nowhere.
function payload(overrides: Partial<AccountCreditPositionPayload> = {}): AccountCreditPositionPayload {
  return {
    accountId: ACCOUNT,
    isOwnAccount: false,
    limits: { grantCeiling: 100000, reasonMin: 3, reasonMax: 500 },
    usage: {
      status: 'ok',
      period: { kind: 'monthly', key: '2026-09-14T09:31:07.123456+00:00', resetsOn: '2026-10-14T09:31:07.123Z' },
      allowanceStatus: 'ok',
      allowance: { amount: 5000, per: 'month' },
      allowanceLayer: 'cohort_values',
      used: 1234.5,
      usedByOwner: 1000,
      usedAutomatic: 234.5,
      planLeft: 3765.5,
      overPlan: 0,
    },
    extra: { status: 'ok', extraCredits: 271.25, hasInconsistentLot: false, lots: [LOT_A, LOT_B, LOT_C, LOT_D] },
    ...overrides,
  };
}

type Reply = { status: number; body?: unknown; nonJson?: boolean } | 'network_error' | Promise<{ status: number; body: unknown }>;

interface FetchState {
  getBody: { status: number; body?: unknown; nonJson?: boolean };
  posts: Reply[];
  calls: Array<{ url: string; method: string; body: Record<string, unknown> | null }>;
}

function stubFetch(state: FetchState) {
  const toResponse = (reply: { status: number; body?: unknown; nonJson?: boolean }) => ({
    ok: reply.status < 400,
    status: reply.status,
    json: async () => {
      if (reply.nonJson) throw new SyntaxError('Unexpected token < in JSON');
      return reply.body;
    },
  });
  const fetchMock = jest.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET';
    state.calls.push({ url: String(url), method, body: init?.body ? JSON.parse(init.body) : null });
    if (method === 'GET' && String(url) === GET_URL) return toResponse(state.getBody);
    if (method === 'POST' && String(url) === POST_URL) {
      const reply = state.posts.shift() ?? { status: 500, body: { success: false, error: 'not mocked' } };
      if (reply === 'network_error') throw new TypeError('Failed to fetch');
      return toResponse(await reply);
    }
    return toResponse({ status: 404, body: { success: false, error: 'not mocked' } });
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
  return fetchMock;
}

function setup(data: AccountCreditPositionPayload = payload(), posts: Reply[] = []) {
  const state: FetchState = { getBody: { status: 200, body: { success: true, data } }, posts, calls: [] };
  stubFetch(state);
  render(<CreditsBlock accountId={ACCOUNT} businessLabel={BUSINESS} />);
  return state;
}

const posts = (state: FetchState) => state.calls.filter((c) => c.method === 'POST');
const gets = (state: FetchState) => state.calls.filter((c) => c.method === 'GET');

async function loaded() {
  await waitFor(() => expect(screen.queryByText('Loading credits…')).toBeNull());
  return screen.getByTestId('credits-block');
}

const grantOk = (credits = 50, expiresAt: string | null = null, replayed = false) => ({
  status: 200,
  body: { success: true, data: { accountId: ACCOUNT, op: 'grant_credits', lotId: 'ffffffff-6666-4666-8666-66666666666f', credits, expiresAt, replayed } },
});

/** Open Give, fill a valid form (no end date), review, confirm. */
async function giveFlow(options: { amount?: string; reason?: string; endDate?: string } = {}) {
  fireEvent.click(screen.getByTestId('credits-give'));
  const dialog = await screen.findByTestId('credit-form-dialog');
  fireEvent.change(within(dialog).getByTestId('credit-amount'), { target: { value: options.amount ?? '50' } });
  if (options.endDate) {
    fireEvent.click(within(dialog).getByTestId('end-date-choice'));
    fireEvent.change(within(dialog).getByTestId('end-date-input'), { target: { value: options.endDate } });
  } else {
    fireEvent.click(within(dialog).getByTestId('no-end-date-choice'));
  }
  fireEvent.change(within(dialog).getByTestId('credit-reason'), { target: { value: options.reason ?? 'goodwill' } });
  fireEvent.click(within(dialog).getByTestId('credit-form-continue'));
  return dialog;
}

async function confirmAndSettle() {
  await act(async () => {
    fireEvent.click(screen.getByTestId('credit-form-confirm'));
  });
}

describe('the figures', () => {
  it('shows allowance with its layer, used and its split, plan left and extra credits, and never their sum', async () => {
    setup();
    const block = await loaded();
    expect(screen.getByTestId('credits-allowance').textContent).toContain('5,000');
    expect(screen.getByTestId('credits-allowance').textContent).toContain('per month');
    // "Set by" in plain words; the raw layer on hover (user UI fixes, 2026-10-04).
    const layer = screen.getByTestId('credits-allowance-layer');
    expect(layer.textContent).toBe('the plan group');
    expect(layer.getAttribute('title')).toBe('cohort_values');
    expect(screen.getByTestId('credits-used').textContent).toContain('1,234.5');
    expect(screen.getByTestId('credits-used').textContent).toContain('1,000');
    expect(screen.getByTestId('credits-used').textContent).toContain('234.5');
    expect(screen.getByTestId('credits-used').textContent).toContain('resets on 2026-10-14 09:31 UTC');
    expect(screen.getByTestId('credits-plan-left').textContent).toContain('3,765.5');
    expect(screen.getByTestId('credits-extra-figure').textContent).toBe('271.25');
    expect(block.textContent).toContain('Extra credits are not part of the plan figure');
    // G11c-1, the stronger proof: the distinctive sum appears nowhere.
    expect(block.textContent).not.toContain('4,036.75');
    expect(block.textContent).not.toContain('4036.75');
    expect(screen.queryByTestId('credits-over-plan')).toBeNull();
  });

  it('shows "over the plan" only when above zero, with the shadow-mode line', async () => {
    setup(payload({ usage: { ...(payload().usage as Extract<AccountCreditPositionPayload['usage'], { status: 'ok' }>), used: 5012.25, planLeft: 0, overPlan: 12.25 } }));
    await loaded();
    const over = screen.getByTestId('credits-over-plan');
    expect(over.textContent).toContain('12.25');
    expect(over.textContent).toContain('Nothing is blocked yet (shadow mode).');
  });

  it('a non-zero figure under 0.01 is never shown as 0, and carries the exact figure in its title (OP-29)', async () => {
    setup(payload({ extra: { status: 'ok', extraCredits: 0.004, hasInconsistentLot: false, lots: [] } }));
    await loaded();
    const figure = screen.getByTestId('credits-extra-figure');
    expect(figure.textContent).toBe('< 0.01');
    expect(figure.getAttribute('title')).toBe('0.004');
  });

  it('trial wording: "in total (trial)" and the trial window label', async () => {
    const base = payload().usage as Extract<AccountCreditPositionPayload['usage'], { status: 'ok' }>;
    setup(payload({ usage: { ...base, allowance: { amount: 900, per: 'total' }, period: { kind: 'trial_total', key: '2026-09-01T00:00:00.000Z', resetsOn: null } } }));
    const block = await loaded();
    expect(screen.getByTestId('credits-allowance').textContent).toContain('in total (trial)');
    expect(block.textContent).toContain('Used in the trial so far (since 2026-09-01 00:00 UTC)');
  });

  it.each([
    ['basis', 'the plan'],
    ['override', 'an exception for this account'],
    ['lifecycle_gate', 'plan ended or paused'],
    ['grandfather', 'earlier terms'],
    ['addon', 'an add-on'],
    ['some_future_layer', 'some_future_layer'],
  ])('"Set by" for layer %s reads "%s", with the raw value as its title', async (raw, words) => {
    const base = payload().usage as Extract<AccountCreditPositionPayload['usage'], { status: 'ok' }>;
    // A layer the screen has no words for (the last row) is cast in: the wire type cannot name it.
    setup(payload({ usage: { ...base, allowanceLayer: raw as typeof base.allowanceLayer } }));
    await loaded();
    const layer = screen.getByTestId('credits-allowance-layer');
    expect(layer.textContent).toBe(words);
    expect(layer.getAttribute('title')).toBe(raw);
  });

  it('no allowance: "No allowance", no plan left', async () => {
    const base = payload().usage as Extract<AccountCreditPositionPayload['usage'], { status: 'ok' }>;
    setup(payload({ usage: { ...base, allowance: null, allowanceLayer: null, planLeft: null, overPlan: null } }));
    await loaded();
    expect(screen.getByTestId('credits-allowance').textContent).toBe('No allowance');
    expect(screen.queryByTestId('credits-plan-left')).toBeNull();
  });

  it('an unavailable plan says so and never implies a trial total (OP-26)', async () => {
    const base = payload().usage as Extract<AccountCreditPositionPayload['usage'], { status: 'ok' }>;
    setup(payload({ usage: { ...base, allowanceStatus: 'unavailable', allowance: null, allowanceLayer: null, planLeft: null, overPlan: null } }));
    const block = await loaded();
    expect(screen.getByTestId('credits-allowance').textContent).toContain('The plan could not be read; figures shown without an allowance');
    expect(screen.getByTestId('credits-allowance').textContent).not.toContain('No allowance');
    expect(block.textContent).toContain('Used this billing period');
    expect(screen.getByTestId('credits-usage').textContent).not.toMatch(/trial/i);
  });

  it('error blocks say "could not be read", never zeros', async () => {
    setup(payload({ usage: { status: 'error' }, extra: { status: 'error' } }));
    const block = await loaded();
    expect(screen.getByTestId('credits-usage-error').textContent).toContain('could not be read');
    expect(screen.getByTestId('credits-extra-error').textContent).toContain('could not be read');
    expect(block.textContent).not.toMatch(/(^|[^0-9.,])0([^0-9.,]|$)/);
  });

  it('a failed GET with a non-JSON body shows the generic sentence, not a code', async () => {
    const state: FetchState = { getBody: { status: 502, nonJson: true }, posts: [], calls: [] };
    stubFetch(state);
    render(<CreditsBlock accountId={ACCOUNT} businessLabel={BUSINESS} />);
    expect((await screen.findByTestId('credits-error')).textContent).toBe(GENERIC_ERROR_COPY);
  });

  it('a refused GET shows its sentence', async () => {
    const state: FetchState = { getBody: { status: 404, body: { success: false, error: 'not_a_business_os_account' } }, posts: [], calls: [] };
    stubFetch(state);
    render(<CreditsBlock accountId={ACCOUNT} businessLabel={BUSINESS} />);
    expect((await screen.findByTestId('credits-error')).textContent).toBe(CREDIT_ERROR_COPY.not_a_business_os_account);
  });

  it('shows the inconsistent-lot warning when the server flags one', async () => {
    setup(payload({ extra: { status: 'ok', extraCredits: 0, hasInconsistentLot: true, lots: [] } }));
    await loaded();
    expect(screen.getByTestId('credits-inconsistent')).toBeTruthy();
  });
});

describe('the lot list (S11-AC-6)', () => {
  it('shows source, credits, left, end, expired, reason, who (short id, full on hover), when, and take-backs', async () => {
    setup();
    await loaded();
    const lots = screen.getAllByTestId('credits-lot');
    expect(lots).toHaveLength(4);
    const [a, b, c] = lots;
    expect(a.textContent).toContain('Given by an admin');
    expect(a.textContent).toContain('300');
    expect(a.textContent).toContain('200');
    expect(within(a).getByTestId('credits-lot-end').textContent).toBe('No end date');
    expect(a.textContent).toContain('Reason: goodwill after the outage');
    expect(a.textContent).toContain('admin abcdef12');
    expect(within(a).getByText('admin abcdef12').getAttribute('title')).toBe(ADMIN_ID);
    expect(a.textContent).toContain('2026-09-01 00:00 UTC');
    expect(within(a).getByTestId('credits-take-back-row').textContent).toContain('Took back 100 on 2026-09-02 00:00 UTC');
    expect(within(a).getByTestId('credits-take-back-row').textContent).toContain('mistaken amount');
    expect(within(b).getByTestId('credits-lot-expired').textContent).toBe('Expired');
    expect(within(b).getByTestId('credits-lot-end').textContent).toContain('ends 2026-09-30 00:00 UTC');
    expect(c.textContent).toContain('Bought');
    expect(c.textContent).toContain('by a payment');
    expect(screen.getByTestId('credits-block').textContent).toContain('Dates are shown in UTC.');
  });

  it('Take back only on a lot with credits left that has not ended (not on expired, empty or not-yet-counted lots)', async () => {
    const skewed = lotView({ id: 'fafafafa-7777-4777-8777-77777777777a', credits: 500, remaining: 500, counted: false, takeBacks: [] });
    setup(payload({ extra: { status: 'ok', extraCredits: 271.25, hasInconsistentLot: false, lots: [LOT_A, LOT_B, LOT_C, LOT_D, skewed] } }));
    await loaded();
    const lots = screen.getAllByTestId('credits-lot');
    const withButton = lots.map((lot) => within(lot).queryByTestId('credits-take-back') !== null);
    expect(withButton).toEqual([true, false, true, false, false]);
    expect(lots[4].textContent).toContain('Not counted yet');
  });

  it('empty: "No extra credits given yet."', async () => {
    setup(payload({ extra: { status: 'ok', extraCredits: 0, hasInconsistentLot: false, lots: [] } }));
    await loaded();
    expect(screen.getByTestId('credits-no-lots').textContent).toBe('No extra credits given yet.');
  });

  it('a reason is rendered as text, never as markup', async () => {
    setup(payload({ extra: { status: 'ok', extraCredits: 0, hasInconsistentLot: false, lots: [lotView({ reason: '<img src=x onerror=alert(1)>' })] } }));
    await loaded();
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByTestId('credits-lot').textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('own account (OP-28)', () => {
  it('no buttons; the own-account sentence instead', async () => {
    setup(payload({ isOwnAccount: true }));
    await loaded();
    expect(screen.queryByTestId('credits-give')).toBeNull();
    expect(screen.queryByTestId('credits-take-back')).toBeNull();
    expect(screen.getByTestId('credits-own-account').textContent).toBe(CREDIT_ERROR_COPY.own_account);
  });
});

describe('Give credits', () => {
  it('the first step\'s button reads "Continue" and the second step\'s "Confirm" (user UI fixes, 2026-10-04)', async () => {
    setup();
    await loaded();
    const dialog = await giveFlow();
    expect(within(dialog).queryByText('Review')).toBeNull();
    expect(screen.getByTestId('credit-form-confirm').textContent).toBe('Confirm');
    fireEvent.click(screen.getByTestId('credit-form-back'));
    expect(screen.getByTestId('credit-form-continue').textContent).toBe('Continue');
  });

  it('Continue stays disabled until amount, end choice and reason are all valid', async () => {
    setup();
    await loaded();
    fireEvent.click(screen.getByTestId('credits-give'));
    const dialog = await screen.findByTestId('credit-form-dialog');
    const review = within(dialog).getByTestId('credit-form-continue') as HTMLButtonElement;
    const amount = within(dialog).getByTestId('credit-amount');
    const reason = within(dialog).getByTestId('credit-reason');

    fireEvent.change(reason, { target: { value: 'goodwill' } });
    fireEvent.change(amount, { target: { value: '50' } });
    // No end choice yet: no default (S11-D-2 C).
    expect(review.disabled).toBe(true);
    fireEvent.click(within(dialog).getByTestId('no-end-date-choice'));
    expect(review.disabled).toBe(false);

    for (const bad of ['0', '1.5', '100001', '-3', 'ten', '']) {
      fireEvent.change(amount, { target: { value: bad } });
      expect({ bad, disabled: review.disabled }).toEqual({ bad, disabled: true });
    }
    fireEvent.change(amount, { target: { value: '100000' } });
    expect(review.disabled).toBe(false);

    fireEvent.change(reason, { target: { value: ' ab ' } });
    expect(review.disabled).toBe(true);
    fireEvent.change(reason, { target: { value: 'abc' } });
    expect(review.disabled).toBe(false);

    // An end date chosen but empty, or in the past, is refused early.
    fireEvent.click(within(dialog).getByTestId('end-date-choice'));
    expect(review.disabled).toBe(true);
    fireEvent.change(within(dialog).getByTestId('end-date-input'), { target: { value: '2001-01-01T10:00' } });
    expect(review.disabled).toBe(true);
    fireEvent.change(within(dialog).getByTestId('end-date-input'), { target: { value: '2099-01-02T03:04' } });
    expect(review.disabled).toBe(false);
  });

  it('the confirm step names the business, the end (local and the UTC instant sent) and the reason', async () => {
    setup();
    await loaded();
    await giveFlow({ amount: '1500', endDate: '2099-01-02T03:04', reason: 'goodwill after the outage' });
    expect(screen.getByTestId('credit-confirm-summary').textContent).toBe(`Give 1,500 credits to ${BUSINESS}`);
    const instant = new Date('2099-01-02T03:04').toISOString();
    expect(screen.getByTestId('credit-confirm-end').textContent).toContain(`sent as ${instant}`);
    expect(screen.getByTestId('credit-confirm-reason').textContent).toBe('goodwill after the outage');
  });

  it('posts exactly { op, amount, expiresAt, requestId, reason }: an ISO instant with Z, or null', async () => {
    const state = setup(payload(), [grantOk(50, null), grantOk(7, new Date('2099-01-02T03:04').toISOString())]);
    await loaded();
    await giveFlow({ amount: '50', reason: '  goodwill  ' });
    await confirmAndSettle();
    await waitFor(() => expect(posts(state)).toHaveLength(1));
    expect(posts(state)[0].body).toEqual({ op: 'grant_credits', amount: 50, expiresAt: null, requestId: uuid(1), reason: 'goodwill' });

    await giveFlow({ amount: '7', endDate: '2099-01-02T03:04' });
    await confirmAndSettle();
    await waitFor(() => expect(posts(state)).toHaveLength(2));
    const second = posts(state)[1].body!;
    expect(Object.keys(second).sort()).toEqual(['amount', 'expiresAt', 'op', 'reason', 'requestId']);
    expect(second.expiresAt).toBe(new Date('2099-01-02T03:04').toISOString());
    expect(String(second.expiresAt).endsWith('Z')).toBe(true);
  });

  it('keeps the request id across a network error, a 500 and a 409; a new one on every opening after a success or a close (OP-32)', async () => {
    const state = setup(payload(), [
      'network_error',
      { status: 500, body: { success: false, error: 'Internal server error' } },
      { status: 409, body: { success: false, error: 'awaiting_payment' } },
      grantOk(),
      grantOk(),
      grantOk(),
    ]);
    await loaded();
    await giveFlow();
    await confirmAndSettle();
    expect((await screen.findByTestId('credit-form-error')).textContent).toBe(GENERIC_ERROR_COPY);
    for (let attempt = 0; attempt < 3; attempt++) {
      fireEvent.click(screen.getByTestId('credit-form-continue'));
      await confirmAndSettle();
    }
    await waitFor(() => expect(posts(state)).toHaveLength(4));
    const ids = posts(state).map((p) => p.body!.requestId);
    expect(ids.slice(0, 4)).toEqual([uuid(1), uuid(1), uuid(1), uuid(1)]);

    // The success closed the dialog; the next opening is a new request.
    await screen.findByTestId('credits-success');
    expect(screen.queryByTestId('credit-form-dialog')).toBeNull();
    await giveFlow({ amount: '5', reason: 'second gift' });
    await confirmAndSettle();
    await waitFor(() => expect(posts(state)).toHaveLength(5));
    expect(posts(state)[4].body!.requestId).toBe(uuid(2));

    // Opened and closed without sending, then reopened: a new id again.
    await waitFor(() => expect(screen.queryByTestId('credit-form-dialog')).toBeNull());
    fireEvent.click(screen.getByTestId('credits-give'));
    fireEvent.click(within(await screen.findByTestId('credit-form-dialog')).getByTestId('credit-form-close'));
    await waitFor(() => expect(screen.queryByTestId('credit-form-dialog')).toBeNull());
    await giveFlow();
    await confirmAndSettle();
    await waitFor(() => expect(posts(state)).toHaveLength(6));
    expect(posts(state)[5].body!.requestId).toBe(uuid(4));
  });

  it('a success closes the dialog and shows the result in the Credits block; dismissable, and cleared on the next opening (user UI fixes, 2026-10-04)', async () => {
    setup(payload(), [grantOk(50), grantOk(60)]);
    await loaded();
    await giveFlow();
    await confirmAndSettle();
    const success = await screen.findByTestId('credits-success');
    expect(screen.queryByTestId('credit-form-dialog')).toBeNull();
    expect(within(screen.getByTestId('credits-block')).getByTestId('credits-success')).toBe(success);
    expect(success.textContent).toContain(`Gave 50 credits to ${BUSINESS}, with no end date.`);

    fireEvent.click(screen.getByTestId('credits-success-dismiss'));
    expect(screen.queryByTestId('credits-success')).toBeNull();

    // A second success, then opening the form again clears it.
    await giveFlow({ amount: '60' });
    await confirmAndSettle();
    expect((await screen.findByTestId('credits-success')).textContent).toContain('Gave 60 credits');
    fireEvent.click(screen.getByTestId('credits-give'));
    await screen.findByTestId('credit-form-dialog');
    expect(screen.queryByTestId('credits-success')).toBeNull();
  });

  it('a failure keeps the dialog open with its error, and shows no success line', async () => {
    setup(payload(), [{ status: 409, body: { success: false, error: 'awaiting_payment' } }]);
    await loaded();
    await giveFlow();
    await confirmAndSettle();
    expect((await screen.findByTestId('credit-form-error')).textContent).toBe(CREDIT_ERROR_COPY.awaiting_payment);
    expect(screen.getByTestId('credit-form-dialog')).toBeTruthy();
    expect(screen.queryByTestId('credits-success')).toBeNull();
  });

  it('a replay shows the RETURNED figures and the "already recorded" note, never the typed ones (QA11b-N2)', async () => {
    const storedExpiry = '2099-06-30T00:00:00.000Z';
    setup(payload(), [grantOk(999, storedExpiry, true)]);
    await loaded();
    await giveFlow({ amount: '50' });
    await confirmAndSettle();
    const success = await screen.findByTestId('credits-success');
    expect(screen.queryByTestId('credit-form-dialog')).toBeNull();
    expect(success.textContent).toContain(`Gave 999 credits to ${BUSINESS}, ending 2099-06-30 00:00 UTC.`);
    expect(success.textContent).toContain('This gift had already been recorded; showing what was recorded.');
    expect(success.textContent).not.toContain('Gave 50');
  });

  it('reads the credits again after a success', async () => {
    const state = setup(payload(), [grantOk()]);
    await loaded();
    expect(gets(state)).toHaveLength(1);
    await giveFlow();
    await confirmAndSettle();
    await waitFor(() => expect(gets(state)).toHaveLength(2));
  });

  it('a double-click on Confirm sends exactly one POST, and Confirm is disabled while it is in flight (W11c-8)', async () => {
    let release: (value: { status: number; body: unknown }) => void = () => undefined;
    const pending = new Promise<{ status: number; body: unknown }>((resolve) => {
      release = resolve;
    });
    const state = setup(payload(), [pending]);
    await loaded();
    await giveFlow();
    const confirm = screen.getByTestId('credit-form-confirm') as HTMLButtonElement;
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect((screen.getByTestId('credit-form-confirm') as HTMLButtonElement).disabled).toBe(true));
    expect(posts(state)).toHaveLength(1);
    await act(async () => {
      release(grantOk());
    });
    await screen.findByTestId('credits-success');
    expect(posts(state)).toHaveLength(1);
  });

  it('cannot be closed while the POST is in flight: Esc and the X are ignored, one POST with one request id; the answer closes it (CR11c-1 / QA11c-1)', async () => {
    let release: (value: { status: number; body: unknown }) => void = () => undefined;
    const pending = new Promise<{ status: number; body: unknown }>((resolve) => {
      release = resolve;
    });
    const state = setup(payload(), [pending, grantOk()]);
    await loaded();
    await giveFlow();
    fireEvent.click(screen.getByTestId('credit-form-confirm'));
    await waitFor(() => expect((screen.getByTestId('credit-form-confirm') as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getByTestId('credit-form-back') as HTMLButtonElement).disabled).toBe(true);

    // Esc, then the Radix X (the only "Close" button on the confirm step).
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByTestId('credit-form-dialog')).not.toBeNull();
    fireEvent.click(within(screen.getByTestId('credit-form-dialog')).getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('credit-form-dialog')).not.toBeNull();
    // Still the confirm step, still busy: no way to send a second change.
    expect((screen.getByTestId('credit-form-confirm') as HTMLButtonElement).disabled).toBe(true);
    expect(posts(state)).toHaveLength(1);

    await act(async () => {
      release(grantOk());
    });
    // Answered: the success closes the dialog; still one POST with one id.
    await screen.findByTestId('credits-success');
    await waitFor(() => expect(screen.queryByTestId('credit-form-dialog')).toBeNull());
    expect(posts(state)).toHaveLength(1);
    expect(posts(state)[0].body!.requestId).toBe(uuid(1));
  });

  it('a failed re-read after a success keeps the success line visible beside "could not be read" (QA11c-2)', async () => {
    const state = setup(payload(), [grantOk(50)]);
    await loaded();
    // The next GET (the re-read) fails.
    state.getBody = { status: 500, body: { success: false, error: 'Internal server error' } };
    await giveFlow();
    await confirmAndSettle();
    await waitFor(() => expect(gets(state)).toHaveLength(2));
    await screen.findByTestId('credits-error');
    expect(screen.queryByTestId('credit-form-dialog')).toBeNull();
    const success = screen.getByTestId('credits-success');
    expect(success.textContent).toContain(`Gave 50 credits to ${BUSINESS}, with no end date.`);
    expect(screen.getByTestId('credits-error')).toBeTruthy();
  });
});

describe('Take back', () => {
  const reduceOk = (credits: number, left: number, replayed = false) => ({
    status: 200,
    body: { success: true, data: { accountId: ACCOUNT, op: 'reduce_credit_lot', lotId: LOT_A.id, drawId: 'd1', credits, lotRemainingAfter: left, replayed } },
  });

  async function openTakeBack(index: number) {
    fireEvent.click(within(screen.getAllByTestId('credits-lot')[index]).getByTestId('credits-take-back'));
    return screen.findByTestId('credit-form-dialog');
  }

  it('sends "rest" for "Everything left", with the lot id, request id and reason; the result is the server\'s', async () => {
    const state = setup(payload(), [reduceOk(200, 0)]);
    await loaded();
    const dialog = await openTakeBack(0);
    expect(dialog.textContent).toContain('200 left on this gift');
    fireEvent.click(within(dialog).getByTestId('take-everything-choice'));
    fireEvent.change(within(dialog).getByTestId('credit-reason'), { target: { value: 'closing the gift' } });
    fireEvent.click(within(dialog).getByTestId('credit-form-continue'));
    // CR11c-3: reads naturally, never "everything left credits".
    expect(screen.getByTestId('credit-confirm-summary').textContent).toBe(`Take back everything left on this gift from ${BUSINESS}`);
    await confirmAndSettle();
    await waitFor(() => expect(posts(state)).toHaveLength(1));
    expect(posts(state)[0].body).toEqual({ op: 'reduce_credit_lot', lotId: LOT_A.id, amount: 'rest', requestId: uuid(1), reason: 'closing the gift' });
    expect((await screen.findByTestId('credits-success')).textContent).toContain(`Took back 200 credits from ${BUSINESS}; 0 left on this gift.`);
    expect(screen.queryByTestId('credit-form-dialog')).toBeNull();
  });

  it('a number of credits reads "Take back N credits from …"', async () => {
    setup();
    await loaded();
    const dialog = await openTakeBack(0);
    fireEvent.change(within(dialog).getByTestId('credit-amount'), { target: { value: '40' } });
    fireEvent.change(within(dialog).getByTestId('credit-reason'), { target: { value: 'mistake' } });
    fireEvent.click(within(dialog).getByTestId('credit-form-continue'));
    expect(screen.getByTestId('credit-confirm-summary').textContent).toBe(`Take back 40 credits from ${BUSINESS}`);
  });

  it('the success line shows what is left from lotRemainingAfter, not the figure the dialog opened with (CR11c-2)', async () => {
    setup(payload(), [reduceOk(50, 150)]);
    await loaded();
    const dialog = await openTakeBack(0);
    expect(within(dialog).getByText(/left on this gift\. The reason/).textContent).toContain('200 left on this gift.');
    fireEvent.change(within(dialog).getByTestId('credit-amount'), { target: { value: '50' } });
    fireEvent.change(within(dialog).getByTestId('credit-reason'), { target: { value: 'mistake' } });
    fireEvent.click(within(dialog).getByTestId('credit-form-continue'));
    await confirmAndSettle();
    const success = await screen.findByTestId('credits-success');
    expect(success.textContent).toContain(`Took back 50 credits from ${BUSINESS}; 150 left on this gift.`);
    expect(success.textContent).not.toContain('200 left');
  });

  it('a take-back answer without a readable lotRemainingAfter names no figure left, rather than a stale one', async () => {
    setup(payload(), [{ status: 200, body: { success: true, data: { accountId: ACCOUNT, op: 'reduce_credit_lot', lotId: LOT_A.id, credits: 50, replayed: false } } }]);
    await loaded();
    const dialog = await openTakeBack(0);
    fireEvent.change(within(dialog).getByTestId('credit-amount'), { target: { value: '50' } });
    fireEvent.change(within(dialog).getByTestId('credit-reason'), { target: { value: 'mistake' } });
    fireEvent.click(within(dialog).getByTestId('credit-form-continue'));
    await confirmAndSettle();
    const success = await screen.findByTestId('credits-success');
    expect(success.textContent).toContain(`Took back 50 credits from ${BUSINESS}.`);
    expect(success.textContent).not.toContain('left on this gift');
  });

  it('a replayed take-back shows the returned figures and its note', async () => {
    setup(payload(), [reduceOk(30, 170, true)]);
    await loaded();
    const dialog = await openTakeBack(0);
    fireEvent.change(within(dialog).getByTestId('credit-amount'), { target: { value: '40' } });
    fireEvent.change(within(dialog).getByTestId('credit-reason'), { target: { value: 'mistake' } });
    fireEvent.click(within(dialog).getByTestId('credit-form-continue'));
    await confirmAndSettle();
    const success = await screen.findByTestId('credits-success');
    expect(success.textContent).toContain('Took back 30 credits');
    expect(success.textContent).toContain('170 left on this gift');
    expect(success.textContent).toContain('This take-back had already been recorded; showing what was recorded.');
  });

  it('a paid (boost) lot needs the checkbox, then sends confirmPaidCredits: true (S11-D-7 A)', async () => {
    const state = setup(payload(), [reduceOk(10, 61.25)]);
    await loaded();
    const dialog = await openTakeBack(2);
    fireEvent.change(within(dialog).getByTestId('credit-amount'), { target: { value: '10' } });
    fireEvent.change(within(dialog).getByTestId('credit-reason'), { target: { value: 'refund agreed' } });
    const review = within(dialog).getByTestId('credit-form-continue') as HTMLButtonElement;
    expect(dialog.textContent).toContain('These credits were paid for. Taking them back does not refund the payment.');
    expect(review.disabled).toBe(true);
    fireEvent.click(within(dialog).getByTestId('paid-credits-confirm'));
    expect(review.disabled).toBe(false);
    fireEvent.click(review);
    await confirmAndSettle();
    await waitFor(() => expect(posts(state)).toHaveLength(1));
    expect(posts(state)[0].body).toEqual({
      op: 'reduce_credit_lot',
      lotId: LOT_C.id,
      amount: 10,
      requestId: uuid(1),
      reason: 'refund agreed',
      confirmPaidCredits: true,
    });
  });

  it('a non-paid lot never sends confirmPaidCredits and shows no checkbox', async () => {
    const state = setup(payload(), [reduceOk(5, 195)]);
    await loaded();
    const dialog = await openTakeBack(0);
    expect(within(dialog).queryByTestId('paid-credits-confirm')).toBeNull();
    fireEvent.change(within(dialog).getByTestId('credit-amount'), { target: { value: '5' } });
    fireEvent.change(within(dialog).getByTestId('credit-reason'), { target: { value: 'small fix' } });
    fireEvent.click(within(dialog).getByTestId('credit-form-continue'));
    await confirmAndSettle();
    await waitFor(() => expect(posts(state)).toHaveLength(1));
    expect(posts(state)[0].body).not.toHaveProperty('confirmPaidCredits');
  });

  it('exceeds_remaining shows details.remaining ("Only N are left on this gift")', async () => {
    setup(payload(), [{ status: 409, body: { success: false, error: 'exceeds_remaining', details: { remaining: 12, remainingBasis: 'read_before_write' } } }]);
    await loaded();
    const dialog = await openTakeBack(0);
    fireEvent.change(within(dialog).getByTestId('credit-amount'), { target: { value: '150' } });
    fireEvent.change(within(dialog).getByTestId('credit-reason'), { target: { value: 'too much' } });
    fireEvent.click(within(dialog).getByTestId('credit-form-continue'));
    await confirmAndSettle();
    expect((await screen.findByTestId('credit-form-error')).textContent).toBe('Only 12 are left on this gift.');
  });
});

describe('every refusal shows its sentence (W11c-7)', () => {
  it.each(Object.keys(CREDIT_ERROR_COPY).filter((code) => code !== 'exceeds_remaining'))('%s', async (code) => {
    setup(payload(), [{ status: 409, body: { success: false, error: code } }]);
    await loaded();
    await giveFlow();
    await confirmAndSettle();
    const error = await screen.findByTestId('credit-form-error');
    expect(error.textContent).toBe(CREDIT_ERROR_COPY[code]);
  });

  it('a non-JSON 502 (a proxy page) shows the generic sentence', async () => {
    setup(payload(), [{ status: 502, nonJson: true }]);
    await loaded();
    await giveFlow();
    await confirmAndSettle();
    expect((await screen.findByTestId('credit-form-error')).textContent).toBe(GENERIC_ERROR_COPY);
  });

  it('an unknown code shows the generic sentence, never the code', async () => {
    setup(payload(), [{ status: 409, body: { success: false, error: 'brand_new_refusal' } }]);
    await loaded();
    await giveFlow();
    await confirmAndSettle();
    const error = await screen.findByTestId('credit-form-error');
    expect(error.textContent).toBe(GENERIC_ERROR_COPY);
    expect(document.body.textContent).not.toContain('brand_new_refusal');
  });

  it('a 200 without success: true shows the generic sentence', async () => {
    setup(payload(), [{ status: 200, body: { success: false } }]);
    await loaded();
    await giveFlow();
    await confirmAndSettle();
    expect((await screen.findByTestId('credit-form-error')).textContent).toBe(GENERIC_ERROR_COPY);
  });
});
