/**
 * @jest-environment jsdom
 *
 * Plan billing in the Businesses drawer (plan payments P-8a.2; AM-1, AC-AM.1,
 * AC-F4.1). The block is closed and sends nothing until it is opened (D-7),
 * then shows Stripe (mirrored) beside the plan row.
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';

import { DISAGREEMENT_COPY, PLAN_BILLING_COPY, PLAN_BILLING_ERROR_COPY, PlanBillingBlock } from '../components/PlanBillingBlock';
import type { BillingPanelPayload } from '@/lib/admin/billing/billingPanelTypes';
import { STRIPE_MODE_UNKNOWN } from '@/lib/admin/billing/subscriptionsTypes';
import { MRR_PAST_DUE_COUNTED } from '@/app/admin/finance/plansCopy';

const ACCOUNT = '11111111-1111-4111-8111-000000000001';
const URL = `/api/admin/business-os/billing/accounts/${ACCOUNT}`;
const WAIT = { timeout: 10_000 };

function payload(patch: Partial<BillingPanelPayload> = {}): BillingPanelPayload {
  return {
    generatedAt: '2026-10-18T12:00:00.000Z',
    mode: 'test',
    stripe: {
      stripeStatus: 'active',
      status: 'active',
      statuses: ['active'],
      planBought: { id: 'plan_a', name: 'Plan A' },
      currentPeriodEnd: '2026-11-01T00:00:00.000Z',
      cancelAtPeriodEnd: false,
      pendingPlan: null,
      lastPaidAt: '2026-10-01T09:30:00.000Z',
      lastPaymentFailedAt: null,
      failedAttempts: 0,
      endedAt: null,
      discounted: false,
      mrrKind: 'counted',
      monthly: { currency: 'USD', hundredths: 7900, label: '$79', pastDue: false },
    },
    plan: { tier: { id: 'plan_a', name: 'Plan A' }, cohort: null, paidThrough: '2026-11-01T00:00:00.000Z', state: 'active', origin: 'admin' },
    disagreements: [],
    customerDashboardUrl: 'https://dashboard.stripe.com/test/customers/cus_Block1',
    ...patch,
  };
}

function stub(status: number, body: unknown) {
  const fetchMock = jest.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response);
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const open = () => fireEvent.click(screen.getByTestId('plan-billing-toggle'));

beforeEach(() => jest.restoreAllMocks());

describe('PlanBillingBlock', () => {
  it('starts closed and sends nothing until opened (D-7)', () => {
    const fetchMock = stub(200, { success: true, data: payload() });
    render(<PlanBillingBlock accountId={ACCOUNT} />);
    expect(screen.getByTestId('plan-billing-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('plan-billing-toggle')).toHaveTextContent(PLAN_BILLING_COPY.open);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opening reads once; closing and opening again does not read again', async () => {
    const fetchMock = stub(200, { success: true, data: payload() });
    render(<PlanBillingBlock accountId={ACCOUNT} />);
    open();
    await screen.findByTestId('plan-billing-stripe', undefined, WAIT);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual([URL, { cache: 'no-store' }]);
    open();
    open();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('Stripe beside the plan row, the dashboard link, the test-key note, and "agree" (AC-AM.1)', async () => {
    stub(200, { success: true, data: payload() });
    render(<PlanBillingBlock accountId={ACCOUNT} />);
    open();
    const stripe = await screen.findByTestId('plan-billing-stripe', undefined, WAIT);
    expect(within(stripe).getByTestId('plan-billing-status')).toHaveTextContent('Active');
    expect(within(stripe).getByTestId('plan-billing-bought')).toHaveTextContent('Plan A');
    expect(within(stripe).getByTestId('plan-billing-renewal')).toHaveTextContent('2026-11-01 00:00 UTC');
    expect(within(stripe).getByTestId('plan-billing-mrr')).toHaveTextContent('$79 a month');
    const plan = screen.getByTestId('plan-billing-plan');
    expect(within(plan).getByTestId('plan-billing-plan-tier')).toHaveTextContent('Plan A');
    expect(within(plan).getByTestId('plan-billing-paid-through')).toHaveTextContent('2026-11-01 00:00 UTC');
    const link = screen.getByTestId('plan-billing-dashboard-link');
    expect(link).toHaveAttribute('href', 'https://dashboard.stripe.com/test/customers/cus_Block1');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByTestId('plan-billing-test-key-note')).toHaveTextContent(PLAN_BILLING_COPY.testKeyNote);
    expect(screen.getByTestId('plan-billing-agree')).toHaveTextContent(PLAN_BILLING_COPY.notReconciliation);
  });

  it('no subscription: "No Stripe subscription" (AC-F4.1), no dashboard link without a customer', async () => {
    stub(200, { success: true, data: payload({ stripe: null, customerDashboardUrl: null }) });
    render(<PlanBillingBlock accountId={ACCOUNT} />);
    open();
    expect(await screen.findByTestId('plan-billing-no-subscription', undefined, WAIT)).toHaveTextContent(PLAN_BILLING_COPY.noSubscription);
    expect(screen.queryByTestId('plan-billing-dashboard-link')).toBeNull();
    expect(screen.queryByTestId('plan-billing-agree')).toBeNull();
  });

  it('a disagreement is shown in words and says it is not the Stripe check', async () => {
    stub(200, { success: true, data: payload({ disagreements: ['tier_differs', 'paid_through_differs'] }) });
    render(<PlanBillingBlock accountId={ACCOUNT} />);
    open();
    const box = await screen.findByTestId('plan-billing-disagree', undefined, WAIT);
    expect(box).toHaveTextContent(DISAGREEMENT_COPY.tier_differs);
    expect(box).toHaveTextContent(DISAGREEMENT_COPY.paid_through_differs);
    expect(box).toHaveTextContent(PLAN_BILLING_COPY.notReconciliation);
  });

  it('past due: still counted, with the same past-due marker as the Subscriptions page (BQ-P8a-4, QA-P8a2-N1)', async () => {
    const base = payload();
    const stripe = {
      ...base.stripe!,
      stripeStatus: 'past_due',
      status: 'failed' as const,
      statuses: ['failed' as const],
      monthly: { currency: 'USD', hundredths: 7900, label: '$79', pastDue: true },
    };
    stub(200, { success: true, data: { ...base, stripe } });
    render(<PlanBillingBlock accountId={ACCOUNT} />);
    open();
    expect(await screen.findByTestId('plan-billing-mrr', undefined, WAIT)).toHaveTextContent(`$79 a month · ${MRR_PAST_DUE_COUNTED}`);
  });

  it('a paying, not past-due subscription has no past-due marker', async () => {
    stub(200, { success: true, data: payload() });
    render(<PlanBillingBlock accountId={ACCOUNT} />);
    open();
    const line = await screen.findByTestId('plan-billing-mrr', undefined, WAIT);
    expect(line.textContent).toBe('$79 a month');
  });

  it('a live key shows no test-key note', async () => {
    stub(200, { success: true, data: payload({ mode: 'live' }) });
    render(<PlanBillingBlock accountId={ACCOUNT} />);
    open();
    await screen.findByTestId('plan-billing-stripe', undefined, WAIT);
    expect(screen.queryByTestId('plan-billing-test-key-note')).toBeNull();
  });

  it.each([
    [404, 'not_a_business_os_account', PLAN_BILLING_ERROR_COPY.not_a_business_os_account],
    [409, STRIPE_MODE_UNKNOWN, STRIPE_MODE_UNKNOWN],
    [500, 'Could not read this account’s billing record. Try again.', PLAN_BILLING_COPY.error],
  ])('a %s shows its sentence, and Read again reads again', async (status, error, sentence) => {
    const fetchMock = stub(status, { success: false, error });
    render(<PlanBillingBlock accountId={ACCOUNT} />);
    open();
    expect(await screen.findByTestId('plan-billing-error', undefined, WAIT)).toHaveTextContent(sentence);
    fireEvent.click(screen.getByTestId('plan-billing-refresh'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), WAIT);
  });

  it('a network failure shows the fallback sentence', async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    render(<PlanBillingBlock accountId={ACCOUNT} />);
    open();
    expect(await screen.findByTestId('plan-billing-error', undefined, WAIT)).toHaveTextContent(PLAN_BILLING_COPY.error);
  });
});

describe('source', () => {
  const code = fs.readFileSync(path.join(process.cwd(), 'app/admin/users/components/PlanBillingBlock.tsx'), 'utf8');

  it('imports nothing from lib/business-os or a repository, and no console', () => {
    expect(code).not.toMatch(/from ['"]@\/lib\/business-os/);
    expect(code).not.toMatch(/from ['"]@\/lib\/repositories/);
    expect(code).not.toMatch(/console\./);
  });

  it('calls exactly one URL, and never Stripe', () => {
    expect(code.match(/fetch\(/g)).toHaveLength(1);
    expect(code).toContain('/api/admin/business-os/billing/accounts/');
    expect(code).not.toMatch(/api\.stripe\.com/);
  });

  it('the panel mounts it once, inside Credits & billing, after the Credit top-ups block', () => {
    const panel = fs.readFileSync(path.join(process.cwd(), 'app/admin/users/components/BusinessOsPanel.tsx'), 'utf8');
    expect(panel.match(/<PlanBillingBlock /g)).toHaveLength(1);
    expect(panel.indexOf('<PlanBillingBlock ')).toBeGreaterThan(panel.indexOf('<BoostBlock '));
    expect(panel.indexOf('<PlanBillingBlock ')).toBeLessThan(panel.indexOf('section="plan"'));
  });
});
