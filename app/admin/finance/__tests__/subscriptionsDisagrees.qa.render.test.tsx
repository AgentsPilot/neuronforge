/**
 * @jest-environment jsdom
 *
 * QA P-8b.3a (AM-2): edges of the "Disagrees" marker beyond the Dev tests: a
 * payload from a server older than P-8b.3a (no new fields) renders without a
 * crash, the chip shows in the plan drawer (SA P3-SA-4), every rendered title
 * never says "Stripe", every row disagreeing, and the copy's filter parser.
 */

import '@testing-library/jest-dom';
import { act, render, screen, within } from '@testing-library/react';

import type { BillingDisagreement, SubscriptionRow, SubscriptionsPayload } from '@/lib/admin/billing/subscriptionsTypes';
import { PlansSubscriptions } from '../components/PlansSubscriptions';
import { PlanDrawer } from '../components/PlanDrawer';
import { SubscriptionsTable } from '../components/SubscriptionsTable';
import { DISAGREES_LABEL, EMPTY_ALL, EMPTY_DISAGREES, EMPTY_FILTERED, SUBSCRIPTIONS_FILTER_SPEC, disagreesTitle, toSubscriptionsFilter } from '../plansCopy';

const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const ALL_KINDS: BillingDisagreement[] = ['tier_differs', 'paid_through_differs', 'no_tier_on_plan'];

const row = (n: number, extra: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
  accountId: id(n),
  businessName: `Business ${n}`,
  status: 'active',
  statuses: ['active'],
  stripeStatus: 'active',
  planBought: { id: 'tier_a', name: 'Plan A' },
  planOnRecord: { id: 'tier_a', name: 'Plan A' },
  paidThrough: '2026-11-01T00:00:00.000Z',
  currentPeriodEnd: '2026-11-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  endedAt: null,
  lastPaidAt: '2026-10-01T00:00:00.000Z',
  lastPaymentFailedAt: null,
  failedAttempts: 0,
  pendingPlan: null,
  discounted: false,
  disagreements: [],
  ...extra,
});

function payload(rows: SubscriptionRow[], status: SubscriptionsPayload['status'] = null, disagreeing = 0): SubscriptionsPayload {
  return {
    generatedAt: '2026-10-28T09:00:00.000Z',
    mode: 'test',
    status,
    totals: {
      mrr: [],
      mrrUnpriced: 0,
      mrrDiscountUnknown: 0,
      mrrPastDueCounted: true,
      paidByPlan: [],
      byStatus: { ended: 0, paused: 0, grace: 0, failed: 0, cancelling: 0, active: rows.length, other: 0, no_stripe: 0 },
      accounts: rows.length,
      disagreeing,
    },
    rows,
    matching: rows.length,
  };
}

/** A payload as a server older than P-8b.3a sends it: no `disagreements` on rows, no `totals.disagreeing`. */
function oldPayload(rows: SubscriptionRow[]): unknown {
  const p = payload(rows) as unknown as { totals: Record<string, unknown>; rows: Array<Record<string, unknown>> };
  delete p.totals.disagreeing;
  for (const r of p.rows) delete r.disagreements;
  return p;
}

let fetchMock: jest.Mock;
function serve(body: unknown) {
  fetchMock = jest.fn(async () => ({ ok: true, status: 200, json: async () => body }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
}
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

beforeEach(() => jest.clearAllMocks());

describe('QA P-8b.3a: a payload missing the new fields (a page open across a deploy)', () => {
  it('the list renders its rows, with no chip, no totals line and the bare option label', async () => {
    serve({ success: true, data: oldPayload([row(1), row(2)]) });
    await act(async () => {
      render(<PlansSubscriptions status={null} onStatus={jest.fn()} />);
    });
    expect(screen.getAllByTestId('subscription-row')).toHaveLength(2);
    expect(screen.queryByTestId('subscription-disagrees')).toBeNull();
    expect(screen.queryByTestId('plans-subscriptions-disagreeing')).toBeNull();
    const select = screen.getByTestId('plans-subscriptions-status') as HTMLSelectElement;
    const last = [...select.options].at(-1)!;
    expect(last).toHaveValue('disagrees');
    expect(last.textContent).toBe(DISAGREES_LABEL);
  });

  it('the table alone renders a row with no `disagreements` key', () => {
    const legacy = row(1) as unknown as Record<string, unknown>;
    delete legacy.disagreements;
    render(<SubscriptionsTable rows={[legacy as unknown as SubscriptionRow]} />);
    expect(screen.getAllByTestId('subscription-row')).toHaveLength(1);
    expect(screen.queryByTestId('subscription-disagrees')).toBeNull();
  });
});

describe('QA P-8b.3a: the chip in the plan drawer (SA P3-SA-4)', () => {
  it('the plan drawer shows the chip on the disagreeing row only, with the same title', async () => {
    serve({ success: true, data: payload([row(1, { disagreements: ['paid_through_differs'] }), row(2)], null, 1) });
    render(<PlanDrawer plan={{ id: 'tier_a', name: 'Plan A' }} onClose={jest.fn()} onReturnFocus={jest.fn()} />);
    await settle();
    const body = await screen.findByTestId('plan-drawer-body');
    const chips = within(body).getAllByTestId('subscription-disagrees');
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveAttribute('title', disagreesTitle(['paid_through_differs']));
  });
});

describe('QA P-8b.3a: every row disagrees, and no rendered title says Stripe', () => {
  it('one chip per row; every title names its kinds and never says Stripe', async () => {
    const rows = [
      row(1, { disagreements: ['tier_differs'] }),
      row(2, { disagreements: ['no_tier_on_plan'] }),
      row(3, { disagreements: ['paid_through_differs'] }),
      row(4, { disagreements: ALL_KINDS }),
    ];
    serve({ success: true, data: payload(rows, 'disagrees', 4) });
    await act(async () => {
      render(<PlansSubscriptions status="disagrees" onStatus={jest.fn()} />);
    });
    const chips = screen.getAllByTestId('subscription-disagrees');
    expect(chips).toHaveLength(4);
    chips.forEach((chip, i) => {
      expect(chip.getAttribute('title')).toBe(disagreesTitle(rows[i].disagreements));
      expect(chip.getAttribute('title')).not.toMatch(/stripe/i);
      expect(chip).toHaveTextContent(DISAGREES_LABEL);
    });
    expect(screen.getByTestId('plans-subscriptions-disagreeing')).toHaveTextContent('4');
    expect(screen.queryByTestId('plans-subscriptions-empty')).toBeNull();
  });

  it('empty words: no filter → EMPTY_ALL; a status filter → EMPTY_FILTERED; disagrees → EMPTY_DISAGREES', async () => {
    for (const [status, words] of [
      [null, EMPTY_ALL],
      ['failed', EMPTY_FILTERED],
      ['disagrees', EMPTY_DISAGREES],
    ] as const) {
      serve({ success: true, data: payload([], status, 0) });
      let unmount = () => {};
      await act(async () => {
        ({ unmount } = render(<PlansSubscriptions status={status} onStatus={jest.fn()} />));
      });
      expect(screen.getByTestId('plans-subscriptions-empty')).toHaveTextContent(words);
      // The totals line shows 0, not hidden, when the server sends the field.
      expect(screen.getByTestId('plans-subscriptions-disagreeing')).toHaveTextContent('0');
      unmount();
    }
  });
});

describe('QA P-8b.3a: the copy-side filter parser', () => {
  it('toSubscriptionsFilter keeps disagrees and every status, and drops anything else to all', () => {
    expect(toSubscriptionsFilter('disagrees')).toBe('disagrees');
    expect(toSubscriptionsFilter('failed')).toBe('failed');
    for (const raw of ['', 'Disagrees', 'disagree', 'all ', 'stripe']) expect(toSubscriptionsFilter(raw)).toBe('all');
  });

  it('SUBSCRIPTIONS_FILTER_SPEC accepts disagrees and all, and rejects an unknown value', () => {
    const parse = (raw: string | null) => SUBSCRIPTIONS_FILTER_SPEC.status.parse(() => raw);
    expect(parse('disagrees')).toBe('disagrees');
    expect(parse('all')).toBe('all');
    expect(parse('nonsense')).toBeUndefined();
  });
});
