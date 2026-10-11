/**
 * @jest-environment jsdom
 */

/**
 * The "Credit top-ups" block (credits boost slice 6a; workplan §3.2; SA C-4,
 * Q-7; 2b N-3; 2a I-2): states, both modes with a badge per row, plain-words
 * statuses and flag reasons, Stripe links in the row's own mode, the limit
 * (default, override, history), and no action of any kind in 6a.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';

import { BoostBlock, BOOST_BLOCK_COPY } from '../components/BoostBlock';
import type { AdminBoostPurchaseRow, AdminBoostView } from '@/lib/business-os/boost/boostAdminViewTypes';

const ACCOUNT = '99999999-9999-4999-8999-999999999999';
const ADMIN_ID = 'abcdef12-3456-4789-8abc-def012345678';
const URL = `/api/admin/business-os/credits/accounts/${ACCOUNT}/boost`;

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
    lotId: '77777777-7777-4777-8777-777777777777',
    stripe: { paymentIntentId: 'pi_3Test1', chargeId: 'ch_3Test1', disputeId: null, checkoutSessionId: 'cs_test_a1b2c3d4e5f6g7h8' },
    createdAt: '2026-10-01T12:00:00.000Z',
    paidAt: '2026-10-01T12:05:00.000Z',
    statusChangedAt: '2026-10-01T12:05:00.000Z',
    checkoutExpiresAt: '2026-10-01T12:30:00.000Z',
    ...overrides,
  };
}

const DEFAULT_CAP = { amountMinor: 15000, currency: 'USD', windowDays: 30 };

function view(overrides: Partial<AdminBoostView> = {}): AdminBoostView {
  return {
    accountId: ACCOUNT,
    isOwnAccount: false,
    serverMode: 'live',
    purchases: { status: 'ok', rows: [row()], truncated: { test: false, live: false } },
    cap: { status: 'ok', default: DEFAULT_CAP, active: null, history: [] },
    ...overrides,
  };
}

function mockFetch(status: number, body: unknown): jest.Mock {
  const fetchMock = jest.fn(async () => ({ ok: status < 400, status, json: async () => body }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
  return fetchMock;
}

const show = async (data: AdminBoostView) => {
  const fetchMock = mockFetch(200, { success: true, data });
  render(<BoostBlock accountId={ACCOUNT} />);
  await screen.findByTestId(data.cap.status === 'ok' ? 'boost-cap' : 'boost-cap-error');
  return fetchMock;
};

describe('states', () => {
  it('reads its own route, uncached, and shows the heading', async () => {
    const fetchMock = await show(view());
    expect(fetchMock).toHaveBeenCalledWith(URL, { cache: 'no-store' });
    expect(screen.getByTestId('boost-block').textContent).toContain(BOOST_BLOCK_COPY.heading);
  });

  it('a failed read says so, with the code in words, and never shows zeros', async () => {
    mockFetch(404, { success: false, error: 'not_a_business_os_account' });
    render(<BoostBlock accountId={ACCOUNT} />);
    expect((await screen.findByTestId('boost-error')).textContent).toBe('This account is not a Business OS business.');
    expect(screen.queryByTestId('boost-cap')).toBeNull();
  });

  it('a body of another shape is an error, not a half-drawn block', async () => {
    mockFetch(200, { success: true, data: { usage: {}, extra: {} } });
    render(<BoostBlock accountId={ACCOUNT} />);
    expect((await screen.findByTestId('boost-error')).textContent).toBe(BOOST_BLOCK_COPY.error);
  });

  // QA6a-L1: each of these used to throw while drawing; now the whole shape is checked first.
  const ok = view();
  const okPurchases = ok.purchases as Extract<AdminBoostView['purchases'], { status: 'ok' }>;
  const okCap = ok.cap as Extract<AdminBoostView['cap'], { status: 'ok' }>;
  const { history: _history, ...capWithoutHistory } = okCap;
  const { default: _default, ...capWithoutDefault } = okCap;
  const { stripe: _stripe, ...rowWithoutStripe } = row();
  const { truncated: _truncated, ...purchasesWithoutTruncated } = okPurchases;
  it.each([
    ['a cap without history', { ...ok, cap: capWithoutHistory }],
    ['a cap without default', { ...ok, cap: capWithoutDefault }],
    ['a row without stripe', { ...ok, purchases: { ...okPurchases, rows: [rowWithoutStripe] } }],
    ['purchases without truncated', { ...ok, purchases: purchasesWithoutTruncated }],
    ['a null row', { ...ok, purchases: { ...okPurchases, rows: [null] } }],
  ])('QA6a-L1: %s → "Credit top-ups could not be read", never a throw', async (_name, data) => {
    mockFetch(200, { success: true, data });
    render(<BoostBlock accountId={ACCOUNT} />);
    expect((await screen.findByTestId('boost-error')).textContent).toBe(BOOST_BLOCK_COPY.error);
    expect(screen.queryByTestId('boost-cap')).toBeNull();
  });

  it('a network failure is an error', async () => {
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(async () => {
      throw new Error('offline');
    });
    render(<BoostBlock accountId={ACCOUNT} />);
    expect(await screen.findByTestId('boost-error')).toBeTruthy();
  });

  it('empty: "No top-ups yet." and the default limit', async () => {
    await show(view({ purchases: { status: 'ok', rows: [], truncated: { test: false, live: false } } }));
    expect(screen.getByTestId('boost-no-purchases').textContent).toBe(BOOST_BLOCK_COPY.noPurchases);
    expect(screen.getByTestId('boost-cap-default').textContent).toBe('Default: $150 per 30 days');
  });

  it('each block fails on its own', async () => {
    await show(view({ purchases: { status: 'error' } }));
    expect(screen.getByTestId('boost-purchases-error')).toBeTruthy();
    expect(screen.getByTestId('boost-cap')).toBeTruthy();
  });

  it('the cap block failing leaves the purchases', async () => {
    await show(view({ cap: { status: 'error' } }));
    expect(screen.getByTestId('boost-cap-error').textContent).toBe(BOOST_BLOCK_COPY.capError);
    expect(screen.getAllByTestId('boost-purchase')).toHaveLength(1);
  });
});

describe('purchases', () => {
  it('both modes, each row with its own badge (SA Q-7); the test-key note only on a test key', async () => {
    await show(view({ purchases: { status: 'ok', rows: [row({ id: 'b', livemode: true, stripe: { ...row().stripe, paymentIntentId: 'pi_3Live1' } }), row({ id: 'a' })], truncated: { test: false, live: false } } }));
    expect(screen.getAllByTestId('boost-mode-badge').map((badge) => badge.textContent)).toEqual(['Live', 'Test']);
    expect(screen.queryByTestId('boost-test-key-note')).toBeNull();
  });

  it('on a test key, the note says test-mode top-ups are not real money', async () => {
    await show(view({ serverMode: 'test' }));
    expect(screen.getByTestId('boost-test-key-note').textContent).toBe(BOOST_BLOCK_COPY.testKeyNote);
  });

  it.each([
    ['paid', 'Paid, credits added'],
    ['partially_refunded', 'Partly refunded'],
    ['refunded', 'Refunded'],
    ['disputed', 'Chargeback open'],
    ['dispute_lost', 'Chargeback lost (payment reversed)'],
    ['awaiting_payment', 'Waiting for a delayed payment'],
    ['expired', 'Checkout expired'],
  ])('status %s reads "%s", raw status on hover', async (status, words) => {
    await show(view({ purchases: { status: 'ok', rows: [row({ status })], truncated: { test: false, live: false } } }));
    const chip = screen.getByTestId('boost-status');
    expect(chip.textContent).toBe(words);
    expect(chip.getAttribute('title')).toBe(status);
  });

  it('2b N-3: a flagged purchase shows "Needs review" and the reason in words (code on hover)', async () => {
    await show(view({ purchases: { status: 'ok', rows: [row({ status: 'flagged_mismatch', flagReason: 'amount_mismatch', lotId: null })], truncated: { test: false, live: false } } }));
    expect(screen.getByTestId('boost-status').textContent).toBe('Needs review');
    const reason = screen.getByTestId('boost-flag-reason');
    expect(reason.textContent).toBe('Needs review: the amount paid does not match the package price');
    expect(reason.getAttribute('title')).toBe('amount_mismatch');
  });

  it('an unknown flag code is shown raw', async () => {
    await show(view({ purchases: { status: 'ok', rows: [row({ status: 'flagged_mismatch', flagReason: 'brand_new_code' })], truncated: { test: false, live: false } } }));
    expect(screen.getByTestId('boost-flag-reason').textContent).toBe('Needs review: brand_new_code');
  });

  it('amounts: what was paid, tax, and refunds, in the row currency; credits', async () => {
    await show(view({ purchases: { status: 'ok', rows: [row({ status: 'partially_refunded', amountTotalMinor: 2750, amountTaxMinor: 250, amountRefundedMinor: 1000 })], truncated: { test: false, live: false } } }));
    expect(screen.getByTestId('boost-purchase-paid').textContent).toBe('$27.50 (incl. tax $2.50)');
    expect(screen.getByTestId('boost-refunded').textContent).toBe('Refunded $10');
    expect(screen.getByTestId('boost-purchase').textContent).toContain('13,750 credits');
  });

  it.each([
    [{ test: true, live: false }, 'Showing the latest 50 test top-ups.'],
    [{ test: false, live: true }, 'Showing the latest 50 live top-ups.'],
    [{ test: true, live: true }, 'Showing the latest 50 test and the latest 50 live top-ups.'],
  ])('QA6a-L2: a full mode is named (%p)', async (truncated, words) => {
    await show(view({ purchases: { status: 'ok', rows: [row()], truncated } }));
    expect(screen.getByTestId('boost-truncated').textContent).toBe(words);
  });

  it('no full mode: no note', async () => {
    await show(view());
    expect(screen.queryByTestId('boost-truncated')).toBeNull();
  });

  it('SA CR-1: money goes through the shared minor-unit rule (whole amounts without decimals, others with the currency\'s own)', async () => {
    await show(view({ purchases: { status: 'ok', rows: [row({ amountTotalMinor: 2500, amountTaxMinor: 0 }), row({ id: 'j', currency: 'JPY', amountTotalMinor: 2500, amountTaxMinor: 0 })], truncated: { test: false, live: false } } }));
    expect(screen.getAllByTestId('boost-purchase-paid').map((cell) => cell.textContent)).toEqual(['$25', '¥2,500']);
  });
});

describe('SA C-4: Stripe links', () => {
  it('a TEST-mode row on a LIVE key links to the test dashboard, in a new tab with noopener noreferrer', async () => {
    await show(view({ serverMode: 'live', purchases: { status: 'ok', rows: [row({ livemode: false, stripe: { ...row().stripe, disputeId: 'dp_1Dis' } })], truncated: { test: false, live: false } } }));
    const payment = screen.getByTestId('boost-stripe-payment-link');
    expect(payment.getAttribute('href')).toBe('https://dashboard.stripe.com/test/payments/pi_3Test1');
    expect(payment.getAttribute('target')).toBe('_blank');
    expect(payment.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByTestId('boost-stripe-dispute-link').getAttribute('href')).toBe('https://dashboard.stripe.com/test/disputes/dp_1Dis');
  });

  it('a live row links to the live dashboard', async () => {
    await show(view({ purchases: { status: 'ok', rows: [row({ livemode: true, stripe: { ...row().stripe, paymentIntentId: 'pi_3Live1' } })], truncated: { test: false, live: false } } }));
    expect(screen.getByTestId('boost-stripe-payment-link').getAttribute('href')).toBe('https://dashboard.stripe.com/payments/pi_3Live1');
  });

  it('a malformed id is plain text, never a link', async () => {
    await show(view({ purchases: { status: 'ok', rows: [row({ stripe: { ...row().stripe, paymentIntentId: 'pi_x/../evil' } })], truncated: { test: false, live: false } } }));
    expect(screen.queryByTestId('boost-stripe-payment-link')).toBeNull();
    expect(screen.getByTestId('boost-stripe-payment-text').tagName).toBe('SPAN');
    expect(document.querySelectorAll('a[href*="evil"]')).toHaveLength(0);
  });

  it('the checkout session is shown short, never linked', async () => {
    await show(view());
    const session = screen.getByTestId('boost-session-id');
    expect(session.tagName).toBe('SPAN');
    expect(session.getAttribute('title')).toBe('cs_test_a1b2c3d4e5f6g7h8');
  });
});

describe('the spending limit', () => {
  it('an admin override: amount per window, the default beside it, admin, date and reason', async () => {
    await show(
      view({
        cap: {
          status: 'ok',
          default: DEFAULT_CAP,
          active: { id: 'o1', amountMinor: 50000, currency: 'USD', reason: 'annual prepay customer', actorAdminId: ADMIN_ID, createdAt: '2026-10-02T09:00:00.000Z' },
          history: [],
        },
      })
    );
    const override = screen.getByTestId('boost-cap-override');
    expect(override.textContent).toContain('Set by an admin: $500 per 30 days');
    expect(override.textContent).toContain('default $150 per 30 days');
    expect(override.textContent).toContain('abcdef12');
    expect(override.textContent).toContain('2026-10-02 09:00 UTC');
    expect(screen.getByTestId('boost-cap-reason').textContent).toBe('“annual prepay customer”');
    expect(screen.queryByTestId('boost-cap-default')).toBeNull();
  });

  it('the history: active, replaced and ended with a reason; empty says so', async () => {
    await show(
      view({
        cap: {
          status: 'ok',
          default: DEFAULT_CAP,
          active: null,
          history: [
            { id: 'h1', amountMinor: 50000, currency: 'USD', reason: 'campaign', actorAdminId: ADMIN_ID, createdAt: '2026-10-02T09:00:00.000Z', endedAt: '2026-10-05T09:00:00.000Z', endedByAdminId: ADMIN_ID, endedReason: 'campaign over' },
            { id: 'h2', amountMinor: 30000, currency: 'USD', reason: 'first try', actorAdminId: ADMIN_ID, createdAt: '2026-09-01T09:00:00.000Z', endedAt: '2026-10-02T09:00:00.000Z', endedByAdminId: ADMIN_ID, endedReason: 'replaced' },
          ],
        },
      })
    );
    const changes = screen.getAllByTestId('boost-cap-change').map((li) => li.textContent);
    expect(changes[0]).toContain('set to $500');
    expect(changes[0]).toContain('“campaign over”');
    expect(changes[1]).toContain('(replaced by a newer limit)');
    expect(screen.getByTestId('boost-cap-default')).toBeTruthy();
  });

  it('no changes: the history says no admin has changed the limit', async () => {
    await show(view());
    expect(screen.getByTestId('boost-cap-no-history').textContent).toBe(BOOST_BLOCK_COPY.noHistory);
  });

  it('free text is text: a reason with markup is not rendered as HTML', async () => {
    await show(
      view({
        cap: { status: 'ok', default: DEFAULT_CAP, active: { id: 'o1', amountMinor: 50000, currency: 'USD', reason: '<img src=x onerror=alert(1)>', actorAdminId: ADMIN_ID, createdAt: '2026-10-02T09:00:00.000Z' }, history: [] },
      })
    );
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByTestId('boost-cap-reason').textContent).toContain('<img');
  });
});

describe('6a is read only', () => {
  it('offers no action: no button, no form, no limit change, no reconcile, no take back', async () => {
    await show(view({ purchases: { status: 'ok', rows: [row(), row({ id: 'f', status: 'flagged_mismatch', flagReason: 'no_session' })], truncated: { test: false, live: false } } }));
    const block = screen.getByTestId('boost-block');
    expect(within(block).queryAllByRole('button')).toHaveLength(0);
    expect(block.querySelector('form, input, textarea')).toBeNull();
    expect(block.textContent).not.toMatch(/reconcile|take back|set limit/i);
  });
});
