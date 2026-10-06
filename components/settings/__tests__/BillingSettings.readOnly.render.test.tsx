/**
 * @jest-environment jsdom
 */

/**
 * The reduced agent-platform billing screen (Business OS plan payments P-10b,
 * SA ruling Q-6), rendered with a mocked Supabase client and fetch.
 *
 * What would mislead a user if it were wrong: a purchase, upgrade or boost-pack
 * control that now only gets a 410; a request to a retired route on load; a
 * browser read of `boost_packs`; or losing what still serves an existing
 * subscription (balance, portal, cancel, reactivate, invoices).
 */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  }),
}));

type Rows = Record<string, unknown>;
const tablesRead: string[] = [];
let subscriptionRow: Rows | null = null;

function builder(table: string) {
  const result = (): { data: unknown; error: null } => {
    if (table === 'user_subscriptions') return { data: subscriptionRow, error: null };
    if (table === 'credit_transactions') return { data: [{ credits_delta: 50 }], error: null };
    if (table === 'ais_system_config') {
      return {
        data: [
          { config_key: 'pilot_credit_cost_usd', config_value: '0.00048' },
          { config_key: 'tokens_per_pilot_credit', config_value: '10' },
        ],
        error: null,
      };
    }
    return { data: [], error: null };
  };
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'neq']) chain[m] = () => chain;
  chain.single = () => Promise.resolve(result());
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result()).then(resolve, reject);
  return chain;
}

jest.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } } }) },
    from: (table: string) => {
      tablesRead.push(table);
      return builder(table);
    },
  },
}));

import BillingSettings from '../BillingSettings';

const fetchCalls: string[] = [];

beforeEach(() => {
  tablesRead.length = 0;
  fetchCalls.length = 0;
  subscriptionRow = {
    balance: 120000,
    total_earned: 200000,
    total_spent: 80000,
    status: 'active',
    stripe_subscription_id: 'sub_test',
    current_period_start: '2026-09-01T00:00:00.000Z',
    current_period_end: '2026-11-01T00:00:00.000Z',
    cancel_at_period_end: false,
    monthly_credits: 20000,
    monthly_amount_usd: 10,
  };
  global.fetch = jest.fn((input: RequestInfo | URL) => {
    const url = String(input);
    fetchCalls.push(url);
    const body = url.includes('/api/stripe/invoices')
      ? { invoices: [], has_more: false, last_invoice_id: null }
      : { success: true };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
  }) as jest.Mock;
});

const RETIRED = /\/api\/stripe\/(create-checkout|update-subscription|sync-subscription)/;

describe('BillingSettings (read-only, P-10b)', () => {
  it('shows balances and the subscription, with no purchase control', async () => {
    render(<BillingSettings />);

    expect(await screen.findByText('Credit purchases are no longer available')).toBeInTheDocument();
    expect(screen.getByText('Available')).toBeInTheDocument();
    expect(screen.getByText('12,000')).toBeInTheDocument(); // 120,000 tokens / 10
    expect(screen.getByRole('button', { name: /Subscription/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Invoices/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Update Payment/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Cancel$/ })).toBeInTheDocument();

    for (const gone of [/Start Subscription/i, /Update Subscription/i, /Buy Now/i, /Need Credits Now/i, /Monthly Pilot Credits/i]) {
      expect(screen.queryByText(gone)).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Credits$/ })).not.toBeInTheDocument();
  });

  it('the hard-coded "Platform Usage" block is gone; the Subscription tab content still renders (B-2)', async () => {
    render(<BillingSettings />);
    await screen.findByText('Credit purchases are no longer available');

    for (const gone of [/Platform Usage/, /Executions Today/, /400\.0% used/, /150 MB \/ 500 MB/, /350 MB remaining/]) {
      expect(screen.queryByText(gone)).not.toBeInTheDocument();
    }
    expect(screen.getByText('Started')).toBeInTheDocument();
    expect(screen.getByText('Next Billing')).toBeInTheDocument();
    expect(screen.getByText('Next Cycle Credits')).toBeInTheDocument();
    expect(screen.getByText('Next Cycle Cost')).toBeInTheDocument();
    expect(screen.getByText('Active Subscription')).toBeInTheDocument();
    expect(screen.getByText('$10.00')).toBeInTheDocument();
  });

  it('never reads boost_packs and never calls a retired route on load', async () => {
    render(<BillingSettings />);
    await screen.findByText('Credit purchases are no longer available');

    expect(tablesRead).not.toContain('boost_packs');
    expect(tablesRead).toEqual(expect.arrayContaining(['user_subscriptions', 'credit_transactions', 'ais_system_config']));
    expect(fetchCalls.filter((u) => RETIRED.test(u))).toEqual([]);
    expect(document.querySelector('script[src*="js.stripe.com"]')).toBeNull();
  });

  it('a ?success=true return no longer triggers a sync call', async () => {
    window.history.replaceState({}, '', '/settings?tab=billing&success=true');
    render(<BillingSettings />);
    await screen.findByText('Credit purchases are no longer available');
    expect(fetchCalls.filter((u) => RETIRED.test(u))).toEqual([]);
    window.history.replaceState({}, '', '/');
  });

  it('cancel still goes through the cancel route', async () => {
    const user = userEvent.setup();
    render(<BillingSettings />);
    await user.click(await screen.findByRole('button', { name: /^Cancel$/ }));
    await user.click(await screen.findByRole('button', { name: /Yes, Cancel/ }));
    await waitFor(() => expect(fetchCalls).toContain('/api/stripe/cancel-subscription'));
  });

  it('a canceling subscription offers reactivate, through the reactivate route', async () => {
    subscriptionRow = { ...subscriptionRow, cancel_at_period_end: true };
    const user = userEvent.setup();
    render(<BillingSettings />);
    await user.click(await screen.findByRole('button', { name: /Reactivate Subscription/ }));
    await user.click(await screen.findByRole('button', { name: /Yes, Reactivate/ }));
    await waitFor(() => expect(fetchCalls).toContain('/api/stripe/reactivate-subscription'));
  });

  it('the Invoices tab loads from the invoices route', async () => {
    const user = userEvent.setup();
    render(<BillingSettings />);
    await user.click(await screen.findByRole('button', { name: /Invoices/ }));
    expect(await screen.findByText('No invoices yet')).toBeInTheDocument();
    expect(fetchCalls.some((u) => u.includes('/api/stripe/invoices'))).toBe(true);
  });
});
