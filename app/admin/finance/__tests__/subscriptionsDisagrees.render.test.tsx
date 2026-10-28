/**
 * @jest-environment jsdom
 *
 * Plan payments P-8b.3a (AM-2; SA P3-SA-4, P3-SA-2 item 5): the "Disagrees"
 * chip, its title, the filter option with its count and the totals line.
 * "Disagrees" means OUR two stored records disagree, so no word here may say
 * "Stripe" (ruling 4, option A; the reconcile's findings are worded apart).
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';

import type { BillingDisagreement, SubscriptionRow, SubscriptionsPayload } from '@/lib/admin/billing/subscriptionsTypes';
import { PlansSubscriptions } from '../components/PlansSubscriptions';
import { SubscriptionsTable } from '../components/SubscriptionsTable';
import {
  DISAGREEING_LABEL,
  DISAGREEMENT_LIST_COPY,
  DISAGREES_LABEL,
  EMPTY_DISAGREES,
  disagreesOptionLabel,
  disagreesTitle,
} from '../plansCopy';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const KINDS: BillingDisagreement[] = ['tier_differs', 'paid_through_differs', 'no_tier_on_plan'];

const row = (extra: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
  accountId: A,
  businessName: 'Acme Dental',
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

function payload(rows: SubscriptionRow[], status: SubscriptionsPayload['status'] = null, disagreeing = 2): SubscriptionsPayload {
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
      accounts: 5,
      disagreeing,
    },
    rows,
    matching: rows.length,
  };
}

let fetchMock: jest.Mock;
function serve(body: unknown) {
  fetchMock = jest.fn(async () => ({ ok: true, status: 200, json: async () => body }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
}

describe('the words', () => {
  it('the title says what the rule means and never says Stripe, for every kind and every combination', () => {
    for (const kind of KINDS) {
      expect(disagreesTitle([kind])).toBe(`Our billing record and the plan record disagree: ${DISAGREEMENT_LIST_COPY[kind]}.`);
    }
    const all = disagreesTitle(KINDS);
    for (const text of [all, DISAGREES_LABEL, DISAGREEING_LABEL, EMPTY_DISAGREES, disagreesOptionLabel(3), ...Object.values(DISAGREEMENT_LIST_COPY)]) {
      expect(text).not.toMatch(/stripe/i);
    }
  });

  it('the option carries the count', () => {
    expect(disagreesOptionLabel(0)).toBe('Disagrees (0)');
    expect(disagreesOptionLabel(12)).toBe('Disagrees (12)');
  });
});

describe('the chip in the table', () => {
  it('a row whose records disagree carries the amber chip with the kinds in its title; a row that agrees has none', () => {
    render(
      <SubscriptionsTable
        rows={[row({ disagreements: ['tier_differs', 'paid_through_differs'] }), row({ accountId: B, businessName: 'Bright Clinic' })]}
      />
    );
    const chips = screen.getAllByTestId('subscription-disagrees');
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveTextContent(DISAGREES_LABEL);
    expect(chips[0]).toHaveAttribute('title', disagreesTitle(['tier_differs', 'paid_through_differs']));
    expect(chips[0].getAttribute('title')).not.toMatch(/stripe/i);
  });
});

describe('the list: option, totals line and empty words', () => {
  it('the select has a Disagrees option after the statuses, with the count; the totals show one line', async () => {
    serve({ success: true, data: payload([row({ disagreements: ['no_tier_on_plan'] })]) });
    await act(async () => {
      render(<PlansSubscriptions status={null} onStatus={jest.fn()} />);
    });
    const select = screen.getByTestId('plans-subscriptions-status') as HTMLSelectElement;
    const options = [...select.options];
    expect(options[options.length - 1]).toHaveValue('disagrees');
    expect(options[options.length - 1]).toHaveTextContent('Disagrees (2)');
    expect(screen.getByText(DISAGREEING_LABEL)).toBeInTheDocument();
    expect(screen.getByTestId('plans-subscriptions-disagreeing')).toHaveTextContent('2');
    // No new tile: the line lives inside the existing totals list.
    expect(screen.getByTestId('plans-subscriptions-totals')).toContainElement(screen.getByTestId('plans-subscriptions-disagreeing'));
  });

  it('choosing Disagrees hands the filter value up; the request carries status=disagrees', async () => {
    const onStatus = jest.fn();
    serve({ success: true, data: payload([], 'disagrees', 0) });
    await act(async () => {
      render(<PlansSubscriptions status="disagrees" onStatus={onStatus} />);
    });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/business-os/billing/subscriptions?status=disagrees');
    expect(screen.getByText(EMPTY_DISAGREES)).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('plans-subscriptions-status'), { target: { value: 'all' } });
    expect(onStatus).toHaveBeenLastCalledWith(null);
    fireEvent.change(screen.getByTestId('plans-subscriptions-status'), { target: { value: 'disagrees' } });
    expect(onStatus).toHaveBeenLastCalledWith('disagrees');
  });
});
