/**
 * @jest-environment jsdom
 *
 * QA additions for upgrade modal UM-1b (workplan § QA Testing Report). Same
 * harness as `upgradeModal.flow.render.test.tsx` (real PlanSection, real
 * payloads, routes faked at fetch, Stripe faked at its modules). Covers gaps
 * QA found in the Dev suites:
 *   - Q-8: Escape (not only the X) still closes while a checkout frame is open,
 *     and a reopen shows the table again with no frame and no second POST;
 *   - a close on the upgrade quote leaves no stale flow or lock behind;
 *   - two column buttons pressed in one act: one POST, one embedded checkout;
 *   - SA Q-4: a checkout return marker still on the URL empties the column slots;
 *   - §12.2 last row: a 3-D Secure renewal (`action_required`) keeps
 *     "Confirm payment" in the drawer and out of the modal; no dead button.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

type Lang = 'en' | 'he' | 'es';
const mockLang: { language: Lang } = { language: 'en' };
jest.mock('@/lib/business-os/LanguageContext', () => {
  const { translations } = jest.requireActual('@/lib/business-os/LanguageContext');
  return {
    useLanguage: () => ({
      language: mockLang.language,
      timezone: 'UTC',
      isRTL: mockLang.language === 'he',
      t: (key: string) => translations[mockLang.language][key] || key,
    }),
  };
});
jest.mock('@/lib/stripe/StripeService', () => ({
  getStripeService: () => {
    throw new Error('the plan screen never talks to Stripe');
  },
}));
const router = { replace: jest.fn() };
jest.mock('next/navigation', () => ({ useRouter: () => router }));
const stripe: { handleNextAction: jest.Mock } = { handleNextAction: jest.fn() };
jest.mock('@/lib/client/stripeJs', () => ({
  getStripePromise: () => Promise.resolve({ handleNextAction: (...args: unknown[]) => stripe.handleNextAction(...args) }),
}));
jest.mock('@stripe/react-stripe-js', () => ({
  EmbeddedCheckoutProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="fake-provider">{children}</div>,
  EmbeddedCheckout: () => <div data-testid="fake-checkout" />,
}));

import { PlanSection } from '@/components/business-os/settings/PlanSection';
import type { PlanPayload } from '@/components/business-os/settings/planPayloadTypes';

import { LOWER, TOP, TRIAL, payingRow, payloadFor } from './upgradeModalPayloads';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};
const COPY = translations.en;
const SLOW = 20_000;

interface Reply {
  status: number;
  body: unknown;
}

const QUOTE: Reply = {
  status: 200,
  body: { success: true, data: { amountDueMinor: 3387, prorationDate: 1_792_766_146, renewsOn: '2026-11-13T09:30:00.000Z', monthlyPriceMinor: 12900 } },
};
const CHECKOUT: Reply = {
  status: 200,
  body: { success: true, data: { clientSecret: 'cs_test_secret_x', sessionId: 'cs_test_s1', expiresAt: '2026-10-13T10:31:00.000Z', tier: 'x' } },
};

/** my-plan answers in order (the last repeats); each POST path answers from its own queue (or holds). */
const server: {
  plans: PlanPayload[];
  reads: number;
  posts: Array<{ url: string; body: unknown }>;
  replies: { checkout: Array<Reply | Promise<Reply>>; preview: Array<Reply | Promise<Reply>>; confirm: Array<Reply | Promise<Reply>> };
} = { plans: [], reads: 0, posts: [], replies: { checkout: [], preview: [], confirm: [] } };

beforeEach(() => {
  mockLang.language = 'en';
  router.replace.mockReset();
  stripe.handleNextAction.mockReset();
  server.plans = [];
  server.reads = 0;
  server.posts = [];
  server.replies = { checkout: [CHECKOUT], preview: [QUOTE], confirm: [] };
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      server.posts.push({ url, body: JSON.parse(String(init.body)) });
      const queue = url.endsWith('/preview') ? server.replies.preview : url.endsWith('/plan/upgrade') ? server.replies.confirm : server.replies.checkout;
      const next = queue.length > 1 ? queue.shift()! : queue[0];
      const reply = next === undefined ? await new Promise<Reply>(() => {}) : await next;
      return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body } as Response;
    }
    const plan = server.plans[Math.min(server.reads, server.plans.length - 1)];
    server.reads += 1;
    return { ok: true, status: 200, json: async () => ({ success: true, data: plan }) } as Response;
  }) as unknown as typeof fetch;
});

async function showSection(payloads: PlanPayload[], { strict = false }: { strict?: boolean } = {}) {
  server.plans = payloads;
  render(strict ? <React.StrictMode><PlanSection /></React.StrictMode> : <PlanSection />);
  await waitFor(() => expect(screen.queryByText(translations[mockLang.language]['plan.loading'])).not.toBeInTheDocument());
}

async function openPlans() {
  await userEvent.click(screen.getByTestId('plan-compare-open'));
  return screen.findByTestId('plan-compare-modal');
}

const action = (planId: string, where: 'header' | 'footer' = 'header') => screen.getByTestId(`plan-compare-action-${planId}-${where}`);
const posts = (suffix: string) => server.posts.filter((post) => post.url.endsWith(suffix));
const checkoutPosts = () => server.posts.filter((post) => post.url.endsWith('/plan/checkout'));
const modalGone = () => waitFor(() => expect(screen.queryByTestId('plan-compare-modal')).not.toBeInTheDocument());
const backdrop = (modal: HTMLElement) => {
  const overlays = Array.from(document.querySelectorAll('.fixed.inset-0')).filter((element) => !element.contains(modal));
  return overlays[overlays.length - 1];
};
const pressOutside = (element: Element) => {
  fireEvent.pointerDown(element);
  fireEvent.pointerUp(element);
  fireEvent.click(element);
};


/** Every button in the modal is the X, "Back to your plan", or a column button for a plan the server offers. */
function expectNoDeadButton(modal: HTMLElement, payload: PlanPayload) {
  const offered = new Set([
    ...(payload.purchase?.offer.kind === 'choose' ? payload.purchase.offer.tiers : []),
    ...(payload.purchase?.upgrade?.tiers ?? []),
  ]);
  for (const button of within(modal).queryAllByRole('button')) {
    const id = button.getAttribute('data-testid') ?? '';
    const match = /^plan-compare-action-(.+)-(header|footer)$/.exec(id);
    const name = (button.textContent ?? '').trim();
    const ok = name === 'Close' || name === COPY['upgrade_modal.back_to_plan'] || (match !== null && offered.has(match[1]));
    expect({ id, name, ok }).toEqual({ id, name, ok: true });
  }
}

describe('QA: closing and reopening around a flow', () => {
  it('Q-8: with a checkout frame open, Escape still closes; the reopen shows the table, no frame, one POST in total', async () => {
    await showSection([await payloadFor({ planId: TRIAL })]);
    const modal = await openPlans();
    await userEvent.click(action(LOWER));
    await screen.findByTestId('fake-checkout');
    fireEvent.keyDown(modal, { key: 'Escape' });
    await modalGone();
    expect(screen.queryByTestId('fake-checkout')).not.toBeInTheDocument();
    expect(screen.queryByTestId('plan-purchase')).not.toBeInTheDocument();

    const again = await openPlans();
    expect(within(again).getByTestId('plan-compare-table')).toBeInTheDocument();
    expect(within(again).queryByTestId('plan-compare-flow')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fake-checkout')).not.toBeInTheDocument();
    expect(checkoutPosts()).toHaveLength(1);
    // The frame guard was reset with the flow: a backdrop press closes the table view again.
    pressOutside(backdrop(again));
    await modalGone();
  }, SLOW);

  it('closing on the upgrade quote ("Back to your plan") leaves no stale flow or lock behind', async () => {
    await showSection([await payloadFor({ billingRow: payingRow(LOWER) })]);
    const modal = await openPlans();
    await userEvent.click(action(TOP));
    await screen.findByTestId('plan-upgrade-quote');
    await userEvent.click(within(modal).getByRole('button', { name: COPY['upgrade_modal.back_to_plan'] }));
    await modalGone();
    await waitFor(() => expect(screen.getByTestId('plan-compare-open')).toHaveFocus());

    const again = await openPlans();
    expect(within(again).getByTestId('plan-compare-table')).toBeInTheDocument();
    expect(within(again).getByRole('button', { name: COPY['upgrade_modal.back_to_plan'] })).toBeInTheDocument();
    expect(posts('/preview')).toHaveLength(1);
    expect(posts('/plan/upgrade')).toHaveLength(0);
  }, SLOW);
});

describe('QA: one embedded checkout, even under a double press (C-12, R-2)', () => {
  it('header and footer of the same column pressed in one act: one checkout POST, one frame', async () => {
    await showSection([await payloadFor({ planId: TRIAL })]);
    await openPlans();
    const header = action(TOP, 'header');
    const footer = action(TOP, 'footer');
    await act(async () => {
      fireEvent.click(header);
      fireEvent.click(footer);
    });
    await screen.findByTestId('fake-checkout');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(checkoutPosts().map((post) => post.body)).toEqual([{ tier: TOP, returnTo: 'settings_plan' }]);
    expect(screen.getAllByTestId('fake-checkout')).toHaveLength(1);
    expect(screen.getAllByTestId('fake-provider')).toHaveLength(1);
  }, SLOW);

  it('two different columns pressed in one act: one flow, one POST, one frame', async () => {
    await showSection([await payloadFor({ planId: TRIAL })]);
    await openPlans();
    const lower = action(LOWER, 'header');
    const top = action(TOP, 'footer');
    await act(async () => {
      fireEvent.click(lower);
      fireEvent.click(top);
    });
    await screen.findByTestId('fake-checkout');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(checkoutPosts()).toHaveLength(1);
    expect(screen.getAllByTestId('fake-checkout')).toHaveLength(1);
    expect(screen.getAllByTestId(/^plan-choice-/)).toHaveLength(1);
  }, SLOW);
});

describe('QA: gates that are not about the plan', () => {
  it('SA Q-4: a checkout marker still on the URL (payment landed): the modal opens, but no column offers a button', async () => {
    const payload = await payloadFor({ billingRow: payingRow(LOWER) });
    // Non-vacuity: without the marker the server's offer gives TOP an Upgrade button.
    expect(payload.purchase?.upgrade?.tiers).toContain(TOP);
    server.plans = [payload];
    render(<PlanSection checkoutMarker="cs_test_abc123" />);
    await screen.findByTestId('plan-purchase-done');
    const modal = await openPlans();
    expect(within(modal).queryAllByTestId(/^plan-compare-action-/)).toHaveLength(0);
    expect(within(modal).queryByTestId('plan-upgrade')).not.toBeInTheDocument();
    expect(server.posts).toEqual([]);
  }, SLOW);

  it('§12.2: a 3-D Secure renewal (action_required) keeps "Confirm payment" in the drawer only; no dead button in the modal', async () => {
    const FAILED_AT = '2099-11-12T22:30:00.000Z';
    const payload = await payloadFor({
      billingRow: payingRow(LOWER, {
        livemode: false,
        subscriptionStatus: 'past_due',
        currentPeriodEnd: FAILED_AT,
        failedAttempts: 1,
        lastPaymentFailedAt: FAILED_AT,
        actionRequiredInvoiceUrl: 'https://invoice.stripe.com/i/acct_probe/qa?s=ap',
      }),
    });
    expect(payload.purchase?.billing?.state).toBe('action_required');
    await showSection([payload]);
    expect(screen.getByTestId('plan-confirm-payment')).toBeInTheDocument();
    const modal = await openPlans();
    expect(within(modal).queryByTestId('plan-confirm-payment')).not.toBeInTheDocument();
    expectNoDeadButton(modal, payload);
  }, SLOW);

  it.each([
    ['trial', () => payloadFor({ planId: TRIAL })],
    ['Essentials owner', () => payloadFor({ billingRow: payingRow(LOWER) })],
    ['top-plan owner', () => payloadFor({ planId: TOP, billingRow: payingRow(TOP) })],
  ] as const)('no dead button in the modal: %s', async (_label, make) => {
    const payload = await make();
    await showSection([payload]);
    const modal = await openPlans();
    expectNoDeadButton(modal, payload);
  }, SLOW);
});
