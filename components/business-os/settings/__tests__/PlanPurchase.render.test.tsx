/**
 * @jest-environment jsdom
 *
 * Settings → Plan: buying a plan (plan payments P-4.2; workplan §3.4, §3.6,
 * §7 "UI", §9; SA M-5, M-6, M-7, M-8, W-5, W-6, W-7).
 *
 * The section is fed the payload the route would send: the REAL plan view
 * builder plus the REAL purchase view (`readPlanPurchaseView`, with fakes only
 * at its ports: switches, billing row, key mode), so a renamed field fails
 * here. What is asserted is what an owner sees and what is POSTed:
 *
 *   - Choose exactly for the tiers the server offers, with "a month, excluding
 *     tax", and none for a paying account, an open-ended Founding Partner, or
 *     with the switches off;
 *   - the trial / free-access sentence (W-7);
 *   - the embedded checkout POSTs only `{ tier, returnTo: 'settings_plan' }`;
 *   - after completion: the return marker on the URL, "Payment processing",
 *     and "You're on <plan>" ONLY once a server re-read says so (M-6); a failed
 *     re-read never claims success; after the last one, "taking longer" and a
 *     link without the marker;
 *   - a refusal is localized by code, never the server's English (M-7);
 *   - Hebrew renders right to left, and no English leaks into he or es.
 */

import '@testing-library/jest-dom';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { ReactNode } from 'react';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));
jest.mock('@/lib/supabaseClient', () => ({ supabase: {} }));
jest.mock('@/lib/stripe/StripeService', () => ({
  getStripeService: () => {
    throw new Error('the plan screen never talks to Stripe');
  },
}));

type Lang = 'en' | 'he' | 'es';
/** `timezone` is what the provider holds: `user_preferences.timezone`, or 'UTC' when unset. */
const mockLang: { language: Lang; timezone: string } = { language: 'en', timezone: 'UTC' };
jest.mock('@/lib/business-os/LanguageContext', () => {
  const { translations } = jest.requireActual('@/lib/business-os/LanguageContext');
  return {
    useLanguage: () => ({
      language: mockLang.language,
      timezone: mockLang.timezone,
      isRTL: mockLang.language === 'he',
      t: (key: string) => translations[mockLang.language][key] || key,
    }),
  };
});

const router = { replace: jest.fn() };
jest.mock('next/navigation', () => ({ useRouter: () => router }));

const stripe: { promise: Promise<unknown> | null; completes: Array<() => void> } = { promise: Promise.resolve({}), completes: [] };
jest.mock('@/lib/client/stripeJs', () => ({ getStripePromise: () => stripe.promise }));
jest.mock('@stripe/react-stripe-js', () => ({
  EmbeddedCheckoutProvider: ({ options, children }: { options: { onComplete?: () => void }; children: ReactNode }) => {
    if (options.onComplete) stripe.completes.push(options.onComplete);
    return <div data-testid="fake-provider">{children}</div>;
  },
  EmbeddedCheckout: () => <div data-testid="fake-checkout" />,
}));

import { ACCOUNT_CLOCK_SENTENCE_KEYS, PlanSection, type PlanPayload } from '@/components/business-os/settings/PlanSection';
import { PLAN_PURCHASE_REFUSAL_KEYS, planPurchaseRefusalKey } from '@/components/business-os/settings/planPurchaseCopy';
import { buildCustomerPlanView } from '@/lib/business-os/entitlements/customerPlanView';
import { previewAccountFor } from '@/lib/business-os/entitlements/planPresentation';
import { resolveEntitlements } from '@/lib/business-os/entitlements/resolver';
import { readCodeConfig } from '@/lib/business-os/entitlements/source';
import { PLAN_CHECKOUT_REFUSALS } from '@/lib/business-os/billing/planCheckout';
import { buyableTiers } from '@/lib/business-os/billing/planCheckoutEligibility';
import { billingEndsWhen, readPlanPurchaseView } from '@/lib/business-os/billing/planPurchaseView';
import { PROCESSING_REFRESH_INTERVAL_MS, PROCESSING_REFRESH_LIMIT } from '@/components/business-os/billing/checkoutProcessing';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};
const COPY = translations.en;
const USER = '11111111-1111-4111-8111-111111111111';
const SESSION = 'cs_test_s1';

interface PayloadOptions {
  planId?: string;
  language?: Lang;
  billingRow?: Record<string, unknown> | null;
  switchesOn?: boolean;
  buyable?: readonly string[];
  cohortExpiresAt?: string | null;
}

/** What the my-plan route would send: the real plan view + the real purchase view. */
async function payloadFor(options: PayloadOptions = {}): Promise<PlanPayload> {
  const { planId = 'basic', language = 'en', billingRow = null, switchesOn = true, buyable, cohortExpiresAt } = options;
  const config = readCodeConfig();
  const now = new Date();
  const account = previewAccountFor(config, planId, now);
  const resolution = resolveEntitlements({
    config,
    account: cohortExpiresAt === undefined ? account : { ...account, cohortExpiresAt },
    overrides: [],
    addons: [],
    now,
  });
  const view = buildCustomerPlanView({ resolution, unavailable: false, now, config, locale: language });
  const purchase = await readPlanPurchaseView(
    { userId: USER, accountId: USER, snapshot: { unavailable: false, resolution } },
    {
      switches: () => ({ checkoutEnabled: switchesOn, pricesEnabled: switchesOn }),
      billing: { findByUser: async () => ({ data: billingRow as never, error: null }) },
      mode: () => 'test',
      ...(buyable ? { buyableTiers: () => buyable } : {}),
      logger: { warn: () => {} },
    }
  );
  const recordEndsWhen = view.kind === 'tier' ? billingEndsWhen(purchase?.billing ?? null) : null;
  // Through JSON, as the browser receives it.
  return JSON.parse(JSON.stringify({ ...view, endsWhen: recordEndsWhen ?? view.endsWhen, purchase }));
}

const activeRow = () => ({
  subscriptionStatus: 'active',
  cancelAtPeriodEnd: false,
  currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  endedAt: null,
});

/** my-plan answers, in order (the last one repeats); the checkout POST answers `checkout`. */
const server: {
  plans: Array<PlanPayload | 'fail'>;
  planReads: number;
  checkout: { status: number; body: unknown };
  posts: unknown[];
} = { plans: [], planReads: 0, checkout: { status: 200, body: {} }, posts: [] };

beforeEach(() => {
  mockLang.language = 'en';
  mockLang.timezone = 'UTC';
  router.replace.mockReset();
  stripe.promise = Promise.resolve({});
  stripe.completes.length = 0;
  server.plans = [];
  server.planReads = 0;
  server.posts = [];
  server.checkout = {
    status: 200,
    body: { success: true, data: { clientSecret: 'cs_test_secret_x', sessionId: SESSION, expiresAt: '2026-10-13T10:31:00.000Z', tier: 'x' } },
  };
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      server.posts.push(JSON.parse(String(init.body)));
      return { ok: server.checkout.status === 200, status: server.checkout.status, json: async () => server.checkout.body } as Response;
    }
    const next = server.plans[Math.min(server.planReads, server.plans.length - 1)];
    server.planReads += 1;
    if (next === 'fail') throw new Error('offline');
    return { ok: true, status: 200, json: async () => ({ success: true, data: next }) } as Response;
  }) as unknown as typeof fetch;
});

afterEach(() => {
  jest.useRealTimers();
});

async function show(payload: PlanPayload, props: { checkoutMarker?: string | null } = {}, language: Lang = 'en') {
  mockLang.language = language;
  server.plans = [payload];
  render(<PlanSection {...props} />);
  await waitFor(() => expect(screen.queryByText(translations[language]['plan.loading'])).not.toBeInTheDocument());
}

const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (slot, name: string) => values[name] ?? slot);

/**
 * Every button except the view-only "Compare plans" (upgrade modal UM-1a, §10):
 * excluded by its EXACT test id only, never by name or pattern (SA W-3), so a
 * money control can never hide behind it. Each absence test that uses this also
 * asserts the excluded button is present, so the narrowing is visible.
 */
const moneyButtons = () => screen.queryAllByRole('button').filter((button) => button.getAttribute('data-testid') !== 'plan-compare-open');

/**
 * Upgrade modal UM-1b (workplan §13): Choose / Pay for live in the plan
 * comparison modal now, two buttons per offered column (header and footer) for
 * one flow. These open it and find them; the island's test ids are unchanged.
 */
async function openPlans() {
  if (!screen.queryByTestId('plan-compare-modal')) await userEvent.click(screen.getByTestId('plan-compare-open'));
  return screen.getByTestId('plan-compare-modal');
}
const columnButton = (planId: string, where: 'header' | 'footer' = 'header') => screen.getByTestId(`plan-compare-action-${planId}-${where}`);
/** Every Choose / Pay for button on screen (drawer or modal). */
const chooseButtons = () => screen.queryAllByRole('button', { name: /^(Choose|Pay for) / });
/** Open the modal and press the first plan's Choose (was `getAllByRole('button')[0]` in the drawer). */
async function pressFirstChoose(payload: PlanPayload) {
  await openPlans();
  await userEvent.click(columnButton(payload.plans![0].planId));
}

/**
 * The Choose button's label for a plan row (P-7b.1b, SA Q-7): the plan in force,
 * when it is a tier with no billing record (admin-assigned), reads "Pay for".
 */
const chooseLabel = (payload: PlanPayload, plan: { planId: string; name: string }) =>
  fill(COPY[payload.kind === 'tier' && payload.planId === plan.planId ? 'plan.choose.button_own' : 'plan.choose.button'], { plan: plan.name });

describe('the Choose list renders only what the server offers (M-5)', () => {
  it('an Essentials account with nothing paid: every offered plan, its price excluding tax, and a Choose button', async () => {
    const payload = await payloadFor();
    await show(payload);
    // Non-vacuity: the server offers more than one tier.
    expect(payload.purchase?.offer).toEqual({ kind: 'choose', tiers: [...buyableTiers()] });
    expect(payload.plans!.length).toBeGreaterThan(1);
    // C-12: no Choose in the drawer any more; its one button says there are plans to see.
    expect(moneyButtons()).toEqual([]);
    expect(screen.getByTestId('plan-compare-open')).toHaveTextContent(COPY['upgrade_modal.open_see_plans']);
    // The section's "Available to choose." line is not repeated: the modal is the action.
    expect(screen.queryByText(COPY['plan.next.available'])).not.toBeInTheDocument();

    await openPlans();
    for (const plan of payload.plans!) {
      expect(within(screen.getByTestId(`plan-compare-col-${plan.planId}`)).getByText(`$${plan.monthlyPriceUsd}`)).toBeInTheDocument();
      for (const where of ['header', 'footer'] as const) expect(columnButton(plan.planId, where)).toHaveAccessibleName(chooseLabel(payload, plan));
    }
    // A tier account is ending no free access.
    expect(screen.queryByTestId('plan-compare-ends-free-access')).not.toBeInTheDocument();

    // "excluding tax" travels with the price where the owner pays (M-8): the flow heading.
    const [first] = payload.plans!;
    await userEvent.click(columnButton(first.planId, 'footer'));
    expect(screen.getByTestId('plan-compare-flow-heading')).toHaveTextContent(fill(COPY['plan.choose.price_ex_tax'], { amount: `$${first.monthlyPriceUsd}` }));
    expect(screen.queryByTestId('plan-purchase-ends-free-access')).not.toBeInTheDocument();
  });

  it('a shown plan the server does not offer reads "Coming soon", with no button (never a dead control)', async () => {
    const config = readCodeConfig();
    const [first, ...rest] = config.tierOrder;
    const payload = await payloadFor({ buyable: [first] });
    await show(payload);
    await openPlans();

    // UM-1b SA Q-1: while choosing, a shown plan the server does not offer reads "Coming soon".
    expect(columnButton(first)).toBeInTheDocument();
    expect(rest.length).toBeGreaterThan(0);
    for (const tier of rest) {
      const column = within(screen.getByTestId(`plan-compare-col-${tier}`));
      expect(column.queryByRole('button')).not.toBeInTheDocument();
      expect(column.getByText(COPY['plan.next.coming_soon'])).toBeInTheDocument();
      expect(screen.queryByTestId(`plan-compare-action-${tier}-footer`)).not.toBeInTheDocument();
    }
  });

  it('a live trial is told buying ends it today (BQ-P2 wording)', async () => {
    const payload = await payloadFor({ planId: 'trial' });
    await show(payload);
    await openPlans();
    expect(screen.getByTestId('plan-compare-ends-free-access')).toHaveTextContent(COPY['plan.choose.trial_ends_today']);
    // And beside the checkout itself, once a plan is chosen.
    await userEvent.click(columnButton(payload.plans![0].planId));
    expect(screen.getByTestId('plan-purchase-ends-free-access')).toHaveTextContent(COPY['plan.choose.trial_ends_today']);
  });

  it('a Founding Partner WITH an end date may buy, and is told it ends their free access today (Q-3)', async () => {
    const future = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    const payload = await payloadFor({ planId: 'champion', cohortExpiresAt: future });
    await show(payload);
    await openPlans();
    expect(screen.getByTestId('plan-compare-ends-free-access')).toHaveTextContent(COPY['plan.choose.free_access_ends_today']);
    expect(chooseButtons().length).toBeGreaterThan(0);
    await userEvent.click(columnButton(payload.plans![0].planId));
    expect(screen.getByTestId('plan-purchase-ends-free-access')).toHaveTextContent(COPY['plan.choose.free_access_ends_today']);
  });

  it('BQ-P10: an open-ended Founding Partner sees no Choose at all', async () => {
    const payload = await payloadFor({ planId: 'champion' });
    expect(payload.purchase?.offer).toEqual({ kind: 'none', reason: 'free_access_no_end_date' });
    await show(payload);
    expect(screen.queryByTestId('plan-purchase')).not.toBeInTheDocument();
    // The existing sentence already says what will happen.
    expect(screen.getByText(COPY['plan.changes.no_end_date'])).toBeInTheDocument();
    expect(moneyButtons()).toEqual([]);
    expect(screen.getByTestId('plan-compare-open')).toBeInTheDocument();
    // UM-1b §13: and no Choose / Pay for in the modal, where they live now.
    await openPlans();
    expect(chooseButtons()).toEqual([]);
  });

  it('a paying account: no Choose, "Renews on <date>", and the plan above as information only', async () => {
    const payload = await payloadFor({ billingRow: activeRow() });
    expect(payload.purchase?.offer).toEqual({ kind: 'none', reason: 'paying' });
    await show(payload);
    expect(screen.queryByTestId('plan-purchase')).not.toBeInTheDocument();
    expect(moneyButtons()).toEqual([]);
    expect(screen.getByTestId('plan-compare-open')).toBeInTheDocument();
    // UM-1b §13: and no Choose / Pay for in the modal, where they live now.
    await openPlans();
    expect(chooseButtons()).toEqual([]);
    expect(screen.getByText(/^Renews on \w+ \d+, \d{4}\.$/)).toBeInTheDocument();
    expect(screen.queryByText(COPY['plan.next.available'])).not.toBeInTheDocument();
  });

  it('cancelling at the period end reads "Ends on <date>. It will not renew."', async () => {
    await show(await payloadFor({ billingRow: { ...activeRow(), cancelAtPeriodEnd: true } }));
    expect(screen.getByText(/^Ends on \w+ \d+, \d{4}\. It will not renew\.$/)).toBeInTheDocument();
  });

  /*
   * QA P-4.2 note 3: a Stripe period end is an INSTANT (the purchase time one
   * month on), so it is read on the account's clock. 22:30 UTC on 12 November
   * is 00:30 on the 13th in Asia/Jerusalem (UTC+2 in winter): in UTC it read a
   * day early. A far-future year keeps the period end "in the future".
   */
  const JUST_AFTER_JERUSALEM_MIDNIGHT = '2099-11-12T22:30:00.000Z';

  it.each([
    ['renewing', false, 'Renews on November 13, 2099.'],
    ['ending', true, 'Ends on November 13, 2099. It will not renew.'],
  ])('a %s period end just after local midnight reads the account\'s own day (Asia/Jerusalem)', async (_state, cancelAtPeriodEnd, expected) => {
    mockLang.timezone = 'Asia/Jerusalem';
    await show(await payloadFor({ billingRow: { ...activeRow(), cancelAtPeriodEnd, currentPeriodEnd: JUST_AFTER_JERUSALEM_MIDNIGHT } }));
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('no timezone stored (the provider holds UTC): the same instant reads the UTC day, as before', async () => {
    await show(await payloadFor({ billingRow: { ...activeRow(), currentPeriodEnd: JUST_AFTER_JERUSALEM_MIDNIGHT } }));
    expect(screen.getByText('Renews on November 12, 2099.')).toBeInTheDocument();
  });

  it('a cohort end date (midnight UTC) stays in UTC on any account clock: no day lost west of UTC', async () => {
    mockLang.timezone = 'America/Los_Angeles';
    await show(await payloadFor({ planId: 'champion', cohortExpiresAt: '2099-03-01T00:00:00.000Z' }));
    expect(screen.getByText(/March 1, 2099/)).toBeInTheDocument();
    expect(screen.queryByText(/February 28, 2099/)).not.toBeInTheDocument();
  });

  it('the account-clock keys are exactly the ones the billing record writes (billingEndsWhen)', () => {
    const keys = [
      billingEndsWhen({ state: 'renewing', date: JUST_AFTER_JERUSALEM_MIDNIGHT })!.key,
      billingEndsWhen({ state: 'ending', date: JUST_AFTER_JERUSALEM_MIDNIGHT })!.key,
      // P-6a.2: the three failed-payment states are billing instants too.
      billingEndsWhen({ state: 'payment_failed', date: JUST_AFTER_JERUSALEM_MIDNIGHT, attempts: 1 })!.key,
      billingEndsWhen({ state: 'action_required', date: JUST_AFTER_JERUSALEM_MIDNIGHT, confirmUrl: 'https://invoice.stripe.com/i/x' })!.key,
      billingEndsWhen({ state: 'ended', date: JUST_AFTER_JERUSALEM_MIDNIGHT })!.key,
    ];
    expect([...ACCOUNT_CLOCK_SENTENCE_KEYS].sort()).toEqual(keys.sort());
  });

  it('the switches off (production today): no Choose, and no "Available to choose." promise', async () => {
    await show(await payloadFor({ switchesOn: false }));
    expect(screen.queryByTestId('plan-purchase')).not.toBeInTheDocument();
    expect(moneyButtons()).toEqual([]);
    expect(screen.getByTestId('plan-compare-open')).toBeInTheDocument();
    // UM-1b §13: and no Choose / Pay for in the modal, where they live now.
    await openPlans();
    expect(chooseButtons()).toEqual([]);
    expect(screen.queryByText(COPY['plan.next.available'])).not.toBeInTheDocument();
  });

  it('purchase: null (the view threw, or the key mode is unknown): no Choose, and still no "Available to choose." (SA P-4.2 review)', async () => {
    const payload = { ...(await payloadFor()), purchase: null };
    // Non-vacuity: the plan above is on sale in config, so only `purchase` decides the line.
    expect(payload.nextPlanUp?.availableToBuy).toBe(true);
    await show(payload);
    expect(screen.queryByTestId('plan-purchase')).not.toBeInTheDocument();
    expect(moneyButtons()).toEqual([]);
    expect(screen.getByTestId('plan-compare-open')).toBeInTheDocument();
    // UM-1b §13: and no Choose / Pay for in the modal, where they live now.
    await openPlans();
    expect(chooseButtons()).toEqual([]);
    expect(screen.queryByText(COPY['plan.next.available'])).not.toBeInTheDocument();
  });

  it('M-2: no usable publishable key → one "not set up" line and no POST', async () => {
    stripe.promise = null;
    await show(await payloadFor());
    expect(moneyButtons()).toEqual([]);
    expect(screen.getByTestId('plan-compare-open')).toBeInTheDocument();
    // UM-1b §13 / SA W-3: in the modal, one "not set up" line for the whole table and no Choose.
    await openPlans();
    expect(screen.getAllByText(COPY['plan.choose.not_configured'])).toHaveLength(1);
    expect(chooseButtons()).toEqual([]);
    expect(server.posts).toEqual([]);
  });

  it('UM-1b (replaces UM-1a W-4): the drawer has one button, "See plans"; the Choose presses below are by column, not by index', async () => {
    const payload = await payloadFor();
    await show(payload);
    expect(screen.getAllByRole('button')).toEqual([screen.getByTestId('plan-compare-open')]);
    expect(screen.getByTestId('plan-compare-open')).toHaveTextContent(COPY['upgrade_modal.open_see_plans']);
  });
});

describe('the checkout (P-5a.2 component, returnTo settings_plan)', () => {
  it('Choose POSTs only { tier, returnTo }, mounts the frame, and hides every other plan\'s button', async () => {
    const payload = await payloadFor();
    await show(payload);
    const [first, second] = payload.plans!;

    await openPlans();
    await userEvent.click(columnButton(first.planId));

    await waitFor(() => expect(screen.getByTestId('fake-checkout')).toBeInTheDocument());
    expect(server.posts).toEqual([{ tier: first.planId, returnTo: 'settings_plan' }]);
    expect(screen.queryByRole('button', { name: chooseLabel(payload, second) })).not.toBeInTheDocument();
  });

  /*
   * QA P-4.2 note 1. Without this guard a second click during the first POST
   * would hit the server lock (`checkout_busy`), and its refusal would reset
   * the active tier while the first frame opens, hiding every checkout.
   */
  it('while the first start is still pending, every other Choose button is disabled', async () => {
    const payload = await payloadFor();
    await show(payload);
    const offered = payload.plans!.filter((plan) => payload.purchase!.offer.kind === 'choose' && payload.purchase!.offer.tiers.includes(plan.planId));
    const [first, ...others] = offered;
    // Non-vacuity: there is another offered plan to be disabled.
    expect(others.length).toBeGreaterThan(0);

    // Hold the checkout POST open; plan reads still answer.
    const answer = global.fetch;
    let release: (response: Response) => void = () => {};
    global.fetch = jest.fn((url: string, init?: RequestInit) => {
      if (init?.method !== 'POST') return answer(url, init);
      server.posts.push(JSON.parse(String(init.body)));
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    }) as unknown as typeof fetch;

    await openPlans();
    await userEvent.click(columnButton(first.planId));
    await waitFor(() => expect(server.posts).toHaveLength(1));

    // The chosen plan reads "starting". UM-1b §13 (stronger than "disabled"): the
    // table is gone, so no other plan's button, and not this column's footer
    // twin either, can start a second session.
    expect(within(screen.getByTestId(`plan-choice-${first.planId}`)).getByRole('button')).toHaveTextContent(COPY['plan.choose.starting']);
    for (const plan of others) {
      expect(screen.queryByRole('button', { name: chooseLabel(payload, plan) })).not.toBeInTheDocument();
      expect(screen.queryByTestId(`plan-choice-${plan.planId}`)).not.toBeInTheDocument();
    }
    expect(screen.queryByTestId(`plan-compare-action-${first.planId}-footer`)).not.toBeInTheDocument();
    expect(screen.queryByTestId('fake-checkout')).not.toBeInTheDocument();

    // Let the first answer land: its frame opens, and only one POST was ever made.
    await act(async () => {
      release({ ok: true, status: 200, json: async () => server.checkout.body } as Response);
    });
    await waitFor(() => expect(screen.getByTestId('fake-checkout')).toBeInTheDocument());
    expect(server.posts).toEqual([{ tier: first.planId, returnTo: 'settings_plan' }]);
  });

  it('on completion: the return marker goes on the URL and the section says "Payment processing", never success', async () => {
    const payload = await payloadFor();
    await show(payload);
    await pressFirstChoose(payload);
    // The fake provider records `onComplete` on every render, and the modal re-renders once
    // the frame opens (SA Q-8 guard), so the latest one is Stripe's current callback.
    await waitFor(() => expect(stripe.completes.length).toBeGreaterThan(0));

    act(() => stripe.completes[stripe.completes.length - 1]());
    // UM-1b hand-off (C-3): the modal closes; the drawer says "Payment processing".
    await waitFor(() => expect(screen.queryByTestId('plan-compare-modal')).not.toBeInTheDocument());

    expect(router.replace).toHaveBeenCalledWith(`/business-os/settings?section=plan&checkout=${SESSION}`, { scroll: false });
    expect(screen.getByTestId('plan-purchase-processing')).toHaveTextContent(COPY['plan.purchase.processing']);
    expect(screen.queryByTestId('plan-purchase')).not.toBeInTheDocument();
    expect(screen.queryByTestId('plan-purchase-done')).not.toBeInTheDocument();
  });

  const REFUSALS: Array<[string, number, string]> = [
    ['checkout_processing', 409, 'plan.refusal.checkout_processing'],
    ['free_access_no_end_date', 409, 'plan.refusal.free_access_no_end_date'],
    ['subscription_live', 409, 'plan.refusal.subscription_live'],
    ['price_unavailable', 503, 'plan.refusal.price_unavailable'],
    ['checkout_open', 409, 'plan.refusal.checkout_open'],
    ['not_available', 404, 'plan.refusal.not_open'],
  ];

  it.each(REFUSALS)('a refused start (%s) shows the localized line, never the server\'s English', async (code, status, key) => {
    server.checkout = { status, body: { success: false, code, error: 'SERVER ENGLISH MUST NOT SHOW' } };
    const payload = await payloadFor();
    await show(payload);
    await pressFirstChoose(payload);

    expect(await screen.findByTestId('plan-purchase-refused')).toHaveTextContent(COPY[key]);
    expect(document.body.textContent).not.toContain('SERVER ENGLISH MUST NOT SHOW');
    // The button comes back (inside the flow), so the owner can try again.
    expect(screen.getByTestId(`plan-choose-${payload.plans![0].planId}-start`)).toBeEnabled();
  });

  it('a 401 with no code reads "signed out"; an unknown code reads the generic line', async () => {
    expect(planPurchaseRefusalKey({ httpStatus: 401, code: null })).toBe('plan.refusal.signed_out');
    expect(planPurchaseRefusalKey({ httpStatus: 500, code: 'something_new' })).toBe('plan.refusal.generic');
  });

  it('every refusal code the route can send has a line in all three languages', () => {
    const codes = [...Object.keys(PLAN_CHECKOUT_REFUSALS), 'not_available', 'invalid_input'];
    expect(Object.keys(PLAN_PURCHASE_REFUSAL_KEYS).sort()).toEqual(codes.sort());
    const keys = new Set([...Object.values(PLAN_PURCHASE_REFUSAL_KEYS), 'plan.refusal.signed_out', 'plan.refusal.generic']);
    for (const language of ['en', 'he', 'es'] as const) {
      for (const key of keys) expect({ language, key, present: !!translations[language][key] }).toEqual({ language, key, present: true });
    }
  });
});

describe('the return from checkout (M-6): success only from the server re-read', () => {
  it('a marker with nothing landed yet → processing; a re-read showing the plan renewing → "You\'re on <plan>"', async () => {
    jest.useFakeTimers();
    const before = await payloadFor({ planId: 'trial' });
    const after = await payloadFor({ billingRow: activeRow() });
    mockLang.language = 'en';
    server.plans = [before, after];
    render(<PlanSection checkoutMarker="cs_test_abc123" />);
    await waitFor(() => expect(screen.getByTestId('plan-purchase-processing')).toBeInTheDocument());
    expect(screen.queryByTestId('plan-purchase')).not.toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(PROCESSING_REFRESH_INTERVAL_MS);
    });

    await waitFor(() => expect(screen.getByTestId('plan-purchase-done')).toHaveTextContent(fill(COPY['plan.purchase.done'], { plan: after.name! })));
    expect(screen.queryByTestId('plan-purchase-processing')).not.toBeInTheDocument();
    expect(screen.getByText(/^Renews on \w+ \d+, \d{4}\.$/)).toBeInTheDocument();
    expect(server.planReads).toBe(2);
  });

  it('failed re-reads never claim success; after the last one, "taking longer" and a link WITHOUT the marker', async () => {
    jest.useFakeTimers();
    const before = await payloadFor({ planId: 'trial' });
    server.plans = [before, 'fail'];
    render(<PlanSection checkoutMarker="cs_test_abc123" />);
    await waitFor(() => expect(screen.getByTestId('plan-purchase-processing')).toBeInTheDocument());

    for (let i = 0; i < PROCESSING_REFRESH_LIMIT + 5; i += 1) {
      await act(async () => {
        jest.advanceTimersByTime(PROCESSING_REFRESH_INTERVAL_MS);
      });
    }

    // Bounded: one initial read plus at most the limit.
    expect(server.planReads).toBe(1 + PROCESSING_REFRESH_LIMIT);
    expect(screen.queryByTestId('plan-purchase-done')).not.toBeInTheDocument();
    expect(screen.getByTestId('plan-purchase-slow')).toHaveTextContent(COPY['plan.purchase.slow']);
    expect(screen.getByTestId('plan-purchase-check-again')).toHaveAttribute('href', '/business-os/settings?section=plan');
  });

  it('a failed FIRST read does not hide a later good re-read (SA P-4.2 review)', async () => {
    jest.useFakeTimers();
    const after = await payloadFor({ billingRow: activeRow() });
    mockLang.language = 'en';
    server.plans = ['fail', after];
    render(<PlanSection checkoutMarker="cs_test_abc123" />);
    await waitFor(() => expect(screen.getByText(COPY['plan.problem.unavailable'])).toBeInTheDocument());

    await act(async () => {
      jest.advanceTimersByTime(PROCESSING_REFRESH_INTERVAL_MS);
    });

    await waitFor(() => expect(screen.getByTestId('plan-purchase-done')).toHaveTextContent(fill(COPY['plan.purchase.done'], { plan: after.name! })));
    expect(screen.queryByText(COPY['plan.problem.unavailable'])).not.toBeInTheDocument();
  });

  it('a malformed marker is ignored: no processing, Choose as usual', async () => {
    const payload = await payloadFor();
    await show(payload, { checkoutMarker: 'not-a-session' });
    expect(screen.queryByTestId('plan-purchase-processing')).not.toBeInTheDocument();
    await openPlans();
    expect(columnButton(payload.plans![0].planId)).toBeInTheDocument();
  });

  it('a stale marker on an account already paying shows the server\'s answer at once, with no re-read', async () => {
    await show(await payloadFor({ billingRow: activeRow() }), { checkoutMarker: 'cs_test_old' });
    expect(screen.getByTestId('plan-purchase-done')).toBeInTheDocument();
    expect(server.planReads).toBe(1);
  });
});

describe('Hebrew and Spanish (M-7): right to left, and no English', () => {
  const ENGLISH = [/excluding tax/i, /Choose/, /a month/i, /Buying ends/i, /Payment processing/i];

  it.each(['he', 'es'] as const)('%s: the Choose list and the trial line are translated', async (language) => {
    const payload = await payloadFor({ planId: 'trial', language });
    await show(payload, {}, language);
    const dictionary = translations[language];
    await openPlans();
    for (const plan of payload.plans!) expect(columnButton(plan.planId)).toHaveAccessibleName(fill(dictionary['plan.choose.button'], { plan: plan.name }));
    expect(screen.getByTestId('plan-compare-ends-free-access')).toHaveTextContent(dictionary['plan.choose.trial_ends_today']);
    await userEvent.click(columnButton(payload.plans![0].planId));
    expect(screen.getByTestId('plan-purchase-ends-free-access')).toHaveTextContent(dictionary['plan.choose.trial_ends_today']);
    const text = document.body.textContent ?? '';
    expect(ENGLISH.filter((phrase) => phrase.test(text)).map(String)).toEqual([]);
    const section = screen.getByTestId('plan-purchase').closest('[dir]');
    expect(section).toHaveAttribute('dir', language === 'he' ? 'rtl' : 'ltr');
  });

  it.each(['he', 'es'] as const)('%s: a refusal reads in the owner\'s language', async (language) => {
    server.checkout = { status: 409, body: { success: false, code: 'checkout_processing', error: 'Your payment is being processed.' } };
    const payload = await payloadFor({ language });
    await show(payload, {}, language);
    await pressFirstChoose(payload);
    expect(await screen.findByTestId('plan-purchase-refused')).toHaveTextContent(translations[language]['plan.refusal.checkout_processing']);
    expect(document.body.textContent).not.toContain('Your payment is being processed.');
  });
});

describe('source guards (CLAUDE.md rule 1, W-6, Pino)', () => {
  const read = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8');
  const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const CLIENT_FILES = [
    'components/business-os/settings/PlanSection.tsx',
    'components/business-os/settings/PlanPurchase.tsx',
    'components/business-os/settings/planPurchaseCopy.ts',
    'components/business-os/billing/checkoutProcessing.ts',
    // Upgrade modal UM-1a: the moved types / helpers / flow, and the modal.
    'components/business-os/settings/planPayloadTypes.ts',
    'components/business-os/settings/planText.tsx',
    'components/business-os/settings/usePlanFlow.ts',
    'components/business-os/settings/upgradeModalView.ts',
    'components/business-os/settings/UpgradeModal.tsx',
  ];

  it.each(CLIENT_FILES)('%s imports nothing from the entitlements module, no server code, and writes no console call', (file) => {
    const text = code(read(file));
    // An import, not the my-plan URL the section fetches (which names the folder).
    expect(text).not.toMatch(/from\s+'[^']*lib\/business-os\/entitlements/);
    expect(text).not.toMatch(/console\./);
    expect(text).not.toMatch(/server-only|lib\/repositories|supabaseServer/);
    // Billing VALUE imports: only the pure, import-free return-marker check.
    const valueImports = text.match(/^import\s+(?!type\s)[^;]*?from\s+'[^']+';/gm) ?? [];
    for (const statement of valueImports.filter((s) => /lib\/business-os\/billing/.test(s))) {
      expect(statement).toMatch(/lib\/business-os\/billing\/checkoutReturnMarker'/);
    }
  });

  it('the return-marker check really is import-free', () => {
    expect(code(read('lib/business-os/billing/checkoutReturnMarker.ts'))).not.toMatch(/^import\s/m);
  });

  it('the islands are client components', () => {
    expect(read('components/business-os/settings/PlanPurchase.tsx').trimStart().startsWith("'use client';")).toBe(true);
    expect(read('components/business-os/settings/PlanSection.tsx').trimStart().startsWith("'use client';")).toBe(true);
    for (const file of ['planText.tsx', 'usePlanFlow.ts', 'UpgradeModal.tsx']) {
      expect(read(`components/business-os/settings/${file}`).trimStart().startsWith("'use client';")).toBe(true);
    }
  });
});
