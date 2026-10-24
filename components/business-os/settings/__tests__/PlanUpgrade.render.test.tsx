/**
 * @jest-environment jsdom
 *
 * Settings → Plan: upgrading a paid plan (plan payments P-7b.1b; workplan
 * §3.7, §7 "UI", §10; SA U-5, V-1, V-2, V-3, V-4, Q-2, Q-4, Q-5, Q-6, Q-7;
 * user decision 2026-10-13 on the E-5 wording).
 *
 * The section is fed the payload the route would send: the REAL plan view
 * builder plus the REAL purchase view (`readPlanPurchaseView`, fakes only at
 * its ports), so a renamed field fails here. The upgrade routes are faked at
 * `fetch`, with the bodies the real routes send (their own suite pins those).
 * What is asserted is what an owner sees and what is POSTed:
 *
 *   - "Upgrade to <plan>" exactly for `purchase.upgrade.tiers`;
 *   - the preview: due now "excluding tax", the zero line, the E-5 small-amount
 *     line, the renewal date and the monthly price;
 *   - Confirm posts `{ tier, prorationDate }` once, whatever the clicks;
 *   - upgraded / processing → "Upgrading…"; "You're on <plan>" ONLY from a
 *     server re-read showing the target, renewing, and no longer offered; a
 *     failed re-read never claims success;
 *   - 3-D Secure through `handleNextAction` with the secret, and nowhere else;
 *   - declined (+ the retry time), not confirmed, unknown (Check again, Try
 *     again with the SAME date), and every refusal localised by code;
 *   - Q-5 and Q-7 notes; Hebrew right to left; source guards.
 */

import '@testing-library/jest-dom';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'fs';
import { join } from 'path';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));
jest.mock('@/lib/supabaseClient', () => ({ supabase: {} }));
jest.mock('@/lib/stripe/StripeService', () => ({
  getStripeService: () => {
    throw new Error('the plan screen never talks to Stripe');
  },
}));

type Lang = 'en' | 'he' | 'es';
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

const stripe: { promise: Promise<unknown> | null; handleNextAction: jest.Mock } = { promise: null, handleNextAction: jest.fn() };
jest.mock('@/lib/client/stripeJs', () => ({ getStripePromise: () => stripe.promise }));
jest.mock('@stripe/react-stripe-js', () => ({
  EmbeddedCheckoutProvider: ({ children }: { children: unknown }) => <div data-testid="fake-provider">{children as never}</div>,
  EmbeddedCheckout: () => <div data-testid="fake-checkout" />,
}));

import { PlanSection, type PlanPayload } from '@/components/business-os/settings/PlanSection';
import { classifyNextAction } from '@/components/business-os/settings/PlanUpgrade';
import {
  PLAN_UPGRADE_REFUSAL_KEYS,
  PLAN_UPGRADE_REREAD_CODES,
  STRIPE_MINIMUM_CHARGE_MINOR,
  planUpgradeRefusalKey,
  upgradeDueKey,
} from '@/components/business-os/settings/planUpgradeCopy';
import { PROCESSING_REFRESH_INTERVAL_MS, PROCESSING_REFRESH_LIMIT } from '@/components/business-os/billing/checkoutProcessing';
import { buildCustomerPlanView } from '@/lib/business-os/entitlements/customerPlanView';
import { previewAccountFor } from '@/lib/business-os/entitlements/planPresentation';
import { resolveEntitlements } from '@/lib/business-os/entitlements/resolver';
import { readCodeConfig } from '@/lib/business-os/entitlements/source';
import { PLAN_UPGRADE_REFUSALS } from '@/lib/business-os/billing/planUpgrade';
import { billingEndsWhen, readPlanPurchaseView } from '@/lib/business-os/billing/planPurchaseView';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};
const COPY = translations.en;
const USER = '11111111-1111-4111-8111-111111111111';
const SECRET = 'pi_test_secret_for_the_owner_only';
const CONFIG = readCodeConfig();
const LOWER = CONFIG.tierOrder[0];
const TOP = CONFIG.tierOrder[CONFIG.tierOrder.length - 1];
const PRORATION = 1_792_766_146;
const RENEWS_ON = '2026-11-13T09:30:00.000Z';

const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (slot, name: string) => values[name] ?? slot);

interface PayloadOptions {
  planId?: string;
  language?: Lang;
  billingRow?: Record<string, unknown> | null;
  switchesOn?: boolean;
}

/** What the my-plan route would send: the real plan view + the real purchase view. */
async function payloadFor(options: PayloadOptions = {}): Promise<PlanPayload> {
  const { planId = LOWER, language = 'en', billingRow = null, switchesOn = true } = options;
  const now = new Date();
  const resolution = resolveEntitlements({ config: CONFIG, account: previewAccountFor(CONFIG, planId, now), overrides: [], addons: [], now });
  const view = buildCustomerPlanView({ resolution, unavailable: false, now, config: CONFIG, locale: language });
  const purchase = await readPlanPurchaseView(
    { userId: USER, accountId: USER, snapshot: { unavailable: false, resolution } },
    {
      switches: () => ({ checkoutEnabled: switchesOn, pricesEnabled: switchesOn }),
      billing: { findByUser: async () => ({ data: billingRow as never, error: null }) },
      mode: () => 'test',
      logger: { warn: () => {} },
    }
  );
  const recordEndsWhen = view.kind === 'tier' ? billingEndsWhen(purchase?.billing ?? null) : null;
  return JSON.parse(JSON.stringify({ ...view, endsWhen: recordEndsWhen ?? view.endsWhen, purchase }));
}

/** Our record for an owner who pays for `boughtTier`. */
const payingRow = (boughtTier: string = LOWER, overrides: Record<string, unknown> = {}) => ({
  subscriptionStatus: 'active',
  cancelAtPeriodEnd: false,
  currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  endedAt: null,
  boughtTier,
  stripeSubscriptionId: 'sub_own',
  ...overrides,
});

type Answer = { status: number; body: Record<string, unknown> } | 'network';

const server: {
  plans: Array<PlanPayload | 'fail'>;
  planReads: number;
  preview: Answer;
  confirms: Answer[];
  posts: Array<{ path: string; body: unknown }>;
} = { plans: [], planReads: 0, preview: { status: 200, body: {} }, confirms: [], posts: [] };

const quote = (overrides: Record<string, unknown> = {}) => ({
  status: 200,
  body: {
    success: true,
    data: { fromTier: LOWER, tier: TOP, amountDueMinor: 3387, taxMinor: 0, currency: 'usd', prorationDate: PRORATION, renewsOn: RENEWS_ON, monthlyPriceMinor: 12900, ...overrides },
  },
});
const outcome = (data: Record<string, unknown>) => ({ status: 200, body: { success: true, data } });
const refusal = (code: string, extra: Record<string, unknown> = {}) => ({
  status: PLAN_UPGRADE_REFUSALS[code as keyof typeof PLAN_UPGRADE_REFUSALS]?.status ?? 409,
  body: { success: false, code, error: 'SERVER ENGLISH MUST NOT SHOW', ...extra },
});

beforeEach(() => {
  mockLang.language = 'en';
  mockLang.timezone = 'UTC';
  router.replace.mockReset();
  stripe.handleNextAction = jest.fn(async () => ({ paymentIntent: { status: 'succeeded' } }));
  stripe.promise = Promise.resolve({ handleNextAction: (...args: unknown[]) => stripe.handleNextAction(...args) });
  server.plans = [];
  server.planReads = 0;
  server.posts = [];
  server.preview = quote();
  server.confirms = [outcome({ outcome: 'upgraded' })];
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      server.posts.push({ path: url, body: JSON.parse(String(init.body)) });
      const answer = url.endsWith('/preview') ? server.preview : server.confirms[Math.min(server.posts.filter((p) => !p.path.endsWith('/preview')).length - 1, server.confirms.length - 1)];
      if (answer === 'network') throw new TypeError('Failed to fetch');
      return { ok: answer.status === 200, status: answer.status, json: async () => answer.body } as Response;
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

async function show(payload: PlanPayload | Array<PlanPayload | 'fail'>, language: Lang = 'en') {
  mockLang.language = language;
  server.plans = Array.isArray(payload) ? payload : [payload];
  render(<PlanSection />);
  await waitFor(() => expect(screen.queryByText(translations[language]['plan.loading'])).not.toBeInTheDocument());
}

const planName = (payload: PlanPayload, tier: string) => payload.plans!.find((plan) => plan.planId === tier)!.name;
/**
 * "Upgrade to <top>" (upgrade modal UM-1b, workplan §13): the islands live in the
 * plan comparison modal now, so the press is the TOP column's header button
 * (opening the modal first). Once a flow is open the table is gone, and the
 * island's OWN button (back after a decline, a refusal or "not confirmed") is
 * the one by that name inside the flow area.
 */
async function upgradeButton(payload: PlanPayload, language: Lang = 'en'): Promise<HTMLElement> {
  if (!screen.queryByTestId('plan-compare-modal')) await userEvent.click(screen.getByTestId('plan-compare-open'));
  const flow = screen.queryByTestId('plan-compare-flow');
  if (flow) return within(flow).getByRole('button', { name: fill(translations[language]['plan.upgrade.button'], { plan: planName(payload, TOP) }) });
  const button = screen.getByTestId(`plan-compare-action-${TOP}-header`);
  expect(button).toHaveAccessibleName(fill(translations[language]['plan.upgrade.button'], { plan: planName(payload, TOP) }));
  return button;
}
const confirmPosts = () => server.posts.filter((p) => !p.path.endsWith('/preview'));

/** Fake timers: step the bounded re-read until `done()` holds (at most a few intervals). */
async function advanceUntil(done: () => boolean, steps = 5) {
  for (let i = 0; i < steps && !done(); i += 1) {
    await act(async () => {
      jest.advanceTimersByTime(PROCESSING_REFRESH_INTERVAL_MS);
    });
  }
}

/**
 * Fake timers: step the bounded re-read until it gives up ("taking longer"), then
 * a few steps more so the cap is still tested. Steps to a condition, not a fixed
 * count: `advanceTimers: true` lets real time move the fake clock, so under CI
 * load a re-read can land one step late.
 */
async function rereadUntilSlow() {
  await advanceUntil(() => screen.queryByTestId('plan-purchase-slow') !== null, PROCESSING_REFRESH_LIMIT * 3);
  await advanceUntil(() => false, 5);
}

async function toQuote(payload: PlanPayload) {
  await userEvent.click(await upgradeButton(payload));
  await screen.findByTestId('plan-upgrade-quote');
}

describe('the button renders only what the server offers (U-2)', () => {
  it('an owner paying for the lower tier: "Upgrade to <top>", no Choose list', async () => {
    const payload = await payloadFor({ billingRow: payingRow() });
    expect(payload.purchase?.upgrade).toEqual({ tiers: [TOP] });
    await show(payload);
    expect(await upgradeButton(payload)).toBeInTheDocument();
    expect(screen.queryByTestId('plan-purchase')).not.toBeInTheDocument();
    expect(server.posts).toEqual([]);
  });

  it.each([
    ['nothing paid (Choose instead)', { billingRow: null }],
    ['the switches off (production today)', { billingRow: payingRow(), switchesOn: false }],
    ['cancelling at the period end', { billingRow: payingRow(LOWER, { cancelAtPeriodEnd: true }) }],
    ['past_due', { billingRow: payingRow(LOWER, { subscriptionStatus: 'past_due' }) }],
    ['already paying for the top tier', { planId: TOP, billingRow: payingRow(TOP) }],
  ] as Array<[string, PayloadOptions]>)('%s → no Upgrade button', async (_label, options) => {
    const payload = await payloadFor(options);
    expect(payload.purchase?.upgrade ?? null).toBeNull();
    await show(payload);
    expect(screen.queryByTestId('plan-upgrade')).not.toBeInTheDocument();
    // UM-1b §13: and no "Upgrade to …" in the modal either (where the button lives now).
    const open = screen.queryByTestId('plan-compare-open');
    if (open) await userEvent.click(open);
    expect(screen.queryByRole('button', { name: /^Upgrade to / })).not.toBeInTheDocument();
  });
});

describe('the preview (F7, V-12, E-5)', () => {
  it('Upgrade POSTs only { tier }, then: due now excluding tax, the renewal date and the monthly price', async () => {
    const payload = await payloadFor({ billingRow: payingRow() });
    await show(payload);
    await toQuote(payload);
    expect(server.posts).toEqual([{ path: '/api/business-os/billing/plan/upgrade/preview', body: { tier: TOP } }]);
    expect(screen.getByTestId('plan-upgrade-due')).toHaveTextContent(fill(COPY['plan.upgrade.due_now'], { amount: '$33.87' }));
    expect(screen.getByTestId('plan-upgrade-then')).toHaveTextContent(fill(COPY['plan.upgrade.then'], { date: 'November 13, 2026', price: '$129' }));
    expect(screen.getByText(fill(COPY['plan.upgrade.immediate'], { plan: planName(payload, TOP) }))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: COPY['plan.upgrade.confirm'] })).toBeEnabled();
    expect(screen.getByRole('button', { name: COPY['plan.upgrade.cancel'] })).toBeInTheDocument();
  });

  it('the renewal date is read on the ACCOUNT clock (a billing instant, QA P-4.2 note 3)', async () => {
    mockLang.timezone = 'Pacific/Honolulu';
    server.preview = quote({ renewsOn: '2026-11-13T05:00:00.000Z' });
    const payload = await payloadFor({ billingRow: payingRow() });
    await show(payload);
    await toQuote(payload);
    expect(screen.getByTestId('plan-upgrade-then')).toHaveTextContent('November 12, 2026');
  });

  it('E-3: nothing due (account credit) → "Nothing to pay now: your account credit covers it."', async () => {
    server.preview = quote({ amountDueMinor: 0 });
    const payload = await payloadFor({ billingRow: payingRow() });
    await show(payload);
    await toQuote(payload);
    expect(screen.getByTestId('plan-upgrade-due')).toHaveTextContent(COPY['plan.upgrade.due_now_zero']);
  });

  it('E-5 (user decision 2026-10-13): under 50 cents → "Nothing to pay now. $0.14 will be added to your next bill."', async () => {
    server.preview = quote({ amountDueMinor: 14 });
    const payload = await payloadFor({ billingRow: payingRow() });
    await show(payload);
    await toQuote(payload);
    expect(screen.getByTestId('plan-upgrade-due')).toHaveTextContent('Nothing to pay now. $0.14 will be added to your next bill.');
    expect(screen.queryByText(/due now/)).not.toBeInTheDocument();
  });

  it('the E-5 boundary is Stripe\'s minimum charge, and only it', () => {
    expect(STRIPE_MINIMUM_CHARGE_MINOR).toBe(50);
    expect([0, 1, 49, 50, 3387].map(upgradeDueKey)).toEqual([
      'plan.upgrade.due_now_zero',
      'plan.upgrade.due_later_small',
      'plan.upgrade.due_later_small',
      'plan.upgrade.due_now',
      'plan.upgrade.due_now',
    ]);
  });

  it('"Not now" returns to the button and posts nothing more', async () => {
    const payload = await payloadFor({ billingRow: payingRow() });
    await show(payload);
    await toQuote(payload);
    await userEvent.click(screen.getByRole('button', { name: COPY['plan.upgrade.cancel'] }));
    expect(await upgradeButton(payload)).toBeInTheDocument();
    expect(confirmPosts()).toEqual([]);
  });
});

describe('the confirm, and success only from the server re-read (U-5, V-4)', () => {
  it('Confirm POSTs { tier, prorationDate } ONCE on a double click; upgraded → "Upgrading…" → "You\'re on <plan>" after the re-read', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    const before = await payloadFor({ billingRow: payingRow() });
    const after = await payloadFor({ planId: TOP, billingRow: payingRow(TOP) });
    expect(after.purchase?.upgrade).toBeNull();
    await show([before, after]);
    await toQuote(before);

    const confirm = screen.getByRole('button', { name: COPY['plan.upgrade.confirm'] });
    await userEvent.dblClick(confirm);
    await waitFor(() => expect(screen.getByTestId('plan-upgrade-upgrading')).toHaveTextContent(COPY['plan.upgrade.upgrading']));
    expect(confirmPosts()).toEqual([{ path: '/api/business-os/billing/plan/upgrade', body: { tier: TOP, prorationDate: PRORATION } }]);
    // Never success from the browser.
    expect(screen.queryByTestId('plan-upgrade-done')).not.toBeInTheDocument();

    await advanceUntil(() => screen.queryByTestId('plan-upgrade-done') !== null);
    expect(screen.getByTestId('plan-upgrade-done')).toHaveTextContent(fill(COPY['plan.upgrade.done'], { plan: after.name! }));
    expect(screen.queryByTestId('plan-upgrade-upgrading')).not.toBeInTheDocument();
    expect(screen.queryByTestId('plan-upgrade')).not.toBeInTheDocument();
  });

  it('Q-4: processing reads exactly as upgraded', async () => {
    server.confirms = [outcome({ outcome: 'processing' })];
    const payload = await payloadFor({ billingRow: payingRow() });
    await show(payload);
    await toQuote(payload);
    await userEvent.click(screen.getByRole('button', { name: COPY['plan.upgrade.confirm'] }));
    expect(await screen.findByTestId('plan-upgrade-upgrading')).toBeInTheDocument();
  });

  it('failed re-reads (or the old plan still) never claim success; after the last, "taking longer" and Check again', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    const before = await payloadFor({ billingRow: payingRow() });
    await show([before, before, 'fail']);
    await toQuote(before);
    await userEvent.click(screen.getByRole('button', { name: COPY['plan.upgrade.confirm'] }));
    await screen.findByTestId('plan-upgrade-upgrading');

    await rereadUntilSlow();
    expect(server.planReads).toBe(1 + PROCESSING_REFRESH_LIMIT);
    expect(screen.queryByTestId('plan-upgrade-done')).not.toBeInTheDocument();
    expect(screen.getByTestId('plan-purchase-slow')).toHaveTextContent(COPY['plan.purchase.slow']);
    expect(screen.getByTestId('plan-purchase-check-again')).toHaveAttribute('href', '/business-os/settings?section=plan');
  });

  it('Q-5: an admin-assigned top tier on a lower PAID tier is not "done" until our record pays for it', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    const before = await payloadFor({ planId: TOP, billingRow: payingRow() });
    expect(before.purchase?.upgrade).toEqual({ tiers: [TOP] });
    // Every re-read answers the same: the plan in force is already the target, but our record still offers it.
    await show(before);
    // The note beside the button (SA Q-5): since UM-1b the modal's footer, while the table is shown (§13).
    await userEvent.click(screen.getByTestId('plan-compare-open'));
    expect(screen.getByTestId('plan-compare-own-plan-note')).toHaveTextContent(fill(COPY['plan.upgrade.own_plan_note'], { plan: planName(before, TOP) }));
    // The button sits on the CURRENT column: the server offers its own plan as the upgrade.
    expect(within(screen.getByTestId(`plan-compare-col-${TOP}`)).getByText(COPY['upgrade_modal.your_plan'])).toBeInTheDocument();
    await toQuote(before);
    await userEvent.click(screen.getByRole('button', { name: COPY['plan.upgrade.confirm'] }));
    await screen.findByTestId('plan-upgrade-upgrading');

    await rereadUntilSlow();
    expect(server.planReads).toBe(1 + PROCESSING_REFRESH_LIMIT);
    expect(screen.queryByTestId('plan-upgrade-done')).not.toBeInTheDocument();
    expect(screen.getByTestId('plan-purchase-slow')).toBeInTheDocument();
  });

  /** Confirm → "Upgrading…", then step the whole bounded re-read against `after`. */
  async function upgradeAndRereadAgainst(after: PlanPayload) {
    jest.useFakeTimers({ advanceTimers: true });
    const before = await payloadFor({ billingRow: payingRow() });
    await show([before, after]);
    await toQuote(before);
    await userEvent.click(screen.getByRole('button', { name: COPY['plan.upgrade.confirm'] }));
    await screen.findByTestId('plan-upgrade-upgrading');
    await rereadUntilSlow();
    expect(server.planReads).toBeGreaterThan(1);
  }

  it('G-2 (a): the target is in force and no longer offered, but billing is NOT renewing → never "You\'re on <plan>"', async () => {
    // Cancelling at the period end: the plan in force is the target and the record no longer offers it.
    const after = await payloadFor({ planId: TOP, billingRow: payingRow(TOP, { cancelAtPeriodEnd: true }) });
    expect(after.planId).toBe(TOP);
    expect(after.purchase?.upgrade ?? null).toBeNull();
    expect(after.purchase?.billing?.state).not.toBe('renewing');
    await upgradeAndRereadAgainst(after);
    expect(screen.queryByTestId('plan-upgrade-done')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(fill(COPY['plan.upgrade.done'], { plan: after.name! }));
    expect(screen.getByTestId('plan-purchase-slow')).toHaveTextContent(COPY['plan.purchase.slow']);
  });

  it('G-2 (b): billing renewing and nothing offered any more, but the plan in force is still the LOWER tier → never "You\'re on <plan>"', async () => {
    // The prices switch turned off meanwhile: `purchase.upgrade` is null, our record still pays for the lower tier.
    const after = await payloadFor({ planId: LOWER, billingRow: payingRow(LOWER), switchesOn: false });
    expect(after.planId).toBe(LOWER);
    expect(after.purchase?.upgrade ?? null).toBeNull();
    expect(after.purchase?.billing?.state).toBe('renewing');
    await upgradeAndRereadAgainst(after);
    expect(screen.queryByTestId('plan-upgrade-done')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(fill(COPY['plan.upgrade.done'], { plan: after.name! }));
    expect(screen.getByTestId('plan-purchase-slow')).toHaveTextContent(COPY['plan.purchase.slow']);
  });

  it('Q-5: … and "done" once the re-read shows our record pays for the target', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    const before = await payloadFor({ planId: TOP, billingRow: payingRow() });
    const after = await payloadFor({ planId: TOP, billingRow: payingRow(TOP) });
    await show([before, after]);
    await toQuote(before);
    await userEvent.click(screen.getByRole('button', { name: COPY['plan.upgrade.confirm'] }));
    await screen.findByTestId('plan-upgrade-upgrading');
    await advanceUntil(() => screen.queryByTestId('plan-upgrade-done') !== null);
    expect(screen.getByTestId('plan-upgrade-done')).toBeInTheDocument();
  });
});

describe('3-D Secure in place (E-1b, V-1)', () => {
  it('action_required → handleNextAction with the secret; completed → "Upgrading…"; the secret is nowhere else', async () => {
    server.confirms = [outcome({ outcome: 'action_required', clientSecret: SECRET })];
    const setItem = jest.spyOn(Storage.prototype, 'setItem');
    const payload = await payloadFor({ billingRow: payingRow() });
    await show(payload);
    await toQuote(payload);
    await userEvent.click(screen.getByRole('button', { name: COPY['plan.upgrade.confirm'] }));
    expect(await screen.findByTestId('plan-upgrade-upgrading')).toBeInTheDocument();
    expect(stripe.handleNextAction).toHaveBeenCalledTimes(1);
    expect(stripe.handleNextAction).toHaveBeenCalledWith({ clientSecret: SECRET });
    expect(document.body.innerHTML).not.toContain(SECRET);
    expect(window.location.href).not.toContain(SECRET);
    expect(router.replace).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it.each([
    ['refused by the bank (card_error)', { error: { type: 'card_error', message: 'closed' } }],
    ['the bank refused (requires_payment_method)', { paymentIntent: { status: 'requires_payment_method' } }],
    [
      'the owner closed the challenge (G-1: payment_intent_authentication_failure)',
      { error: { type: 'invalid_request_error', code: 'payment_intent_authentication_failure', payment_intent: { status: 'requires_payment_method' } } },
    ],
    ['an error carrying a canceled PaymentIntent', { error: { type: 'invalid_request_error', payment_intent: { status: 'canceled' } } }],
  ])('%s → "The payment was not confirmed, so nothing changed." and Upgrade again', async (_label, result) => {
    server.confirms = [outcome({ outcome: 'action_required', clientSecret: SECRET })];
    stripe.handleNextAction = jest.fn(async () => result);
    const payload = await payloadFor({ billingRow: payingRow() });
    await show(payload);
    await toQuote(payload);
    await userEvent.click(screen.getByRole('button', { name: COPY['plan.upgrade.confirm'] }));
    expect(await screen.findByTestId('plan-upgrade-not-confirmed')).toHaveTextContent(fill(COPY['plan.upgrade.not_confirmed'], { plan: payload.name! }));
    expect(await upgradeButton(payload)).toBeInTheDocument();
    expect(screen.queryByTestId('plan-upgrade-upgrading')).not.toBeInTheDocument();
  });

  it.each([
    ['Stripe.js throws inside handleNextAction (SA mutation MB)', 'throw' as const],
    ['a returned api_connection_error (no PaymentIntent)', { error: { type: 'api_connection_error', message: 'offline' } }],
    ['a returned api_error', { error: { type: 'api_error' } }],
    ['a returned rate_limit_error', { error: { type: 'rate_limit_error' } }],
    ['an error of a type we do not know', { error: { type: 'something_new' } }],
    ['no error and no PaymentIntent status', { paymentIntent: {} }],
  ] as Array<[string, 'throw' | Record<string, unknown>]>)(
    'G-1: %s → "We could not confirm your upgrade" with Check again and Try again (same prorationDate), never "nothing changed"',
    async (_label, result) => {
      server.confirms = [outcome({ outcome: 'action_required', clientSecret: SECRET }), outcome({ outcome: 'upgraded' })];
      stripe.handleNextAction = jest.fn(async () => {
        if (result === 'throw') throw new Error('Stripe.js exploded');
        return result;
      });
      const before = await payloadFor({ billingRow: payingRow() });
      await show([before, before]);
      await toQuote(before);
      await userEvent.click(screen.getByRole('button', { name: COPY['plan.upgrade.confirm'] }));
      const unknown = await screen.findByTestId('plan-upgrade-unknown');
      expect(unknown).toHaveTextContent(COPY['plan.upgrade.not_sure']);
      expect(screen.queryByTestId('plan-upgrade-not-confirmed')).not.toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/nothing changed/);
      expect(within(unknown).getByRole('button', { name: COPY['plan.purchase.check_again'] })).toBeEnabled();
      expect(document.body.innerHTML).not.toContain(SECRET);

      await userEvent.click(within(unknown).getByRole('button', { name: COPY['plan.upgrade.try_again'] }));
      await screen.findByTestId('plan-upgrade-upgrading');
      expect(confirmPosts().map((p) => p.body)).toEqual([
        { tier: TOP, prorationDate: PRORATION },
        { tier: TOP, prorationDate: PRORATION },
      ]);
    }
  );

  it('G-1 / Q-2: after "not confirmed", pressing Upgrade again shows the waiting line and resumes the same challenge', async () => {
    server.confirms = [outcome({ outcome: 'action_required', clientSecret: SECRET })];
    stripe.handleNextAction = jest.fn(async () => ({
      error: { type: 'invalid_request_error', code: 'payment_intent_authentication_failure', payment_intent: { status: 'requires_payment_method' } },
    }));
    const payload = await payloadFor({ billingRow: payingRow() });
    await show(payload);
    await toQuote(payload);
    await userEvent.click(screen.getByRole('button', { name: COPY['plan.upgrade.confirm'] }));
    await screen.findByTestId('plan-upgrade-not-confirmed');

    // The pending update is still at Stripe: the preview now answers awaiting (Q-2).
    server.preview = refusal('upgrade_awaiting_confirmation', { amountDueMinor: 3387, prorationDate: PRORATION + 120 });
    await userEvent.click(await upgradeButton(payload));
    expect(await screen.findByTestId('plan-upgrade-awaiting')).toHaveTextContent(COPY['plan.upgrade.awaiting_confirmation']);
    expect(screen.queryByTestId('plan-upgrade-not-confirmed')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: COPY['plan.upgrade.confirm'] }));
    await waitFor(() => expect(stripe.handleNextAction).toHaveBeenCalledTimes(2));
    expect(stripe.handleNextAction).toHaveBeenLastCalledWith({ clientSecret: SECRET });
    expect(confirmPosts().map((p) => p.body)).toEqual([
      { tier: TOP, prorationDate: PRORATION },
      { tier: TOP, prorationDate: PRORATION + 120 },
    ]);
  });

  it('Q-2 resume: the preview answers awaiting → the line and a Confirm that posts the fresh date', async () => {
    server.preview = refusal('upgrade_awaiting_confirmation', { amountDueMinor: 3387, prorationDate: PRORATION + 60 });
    server.confirms = [outcome({ outcome: 'action_required', clientSecret: SECRET })];
    const payload = await payloadFor({ billingRow: payingRow() });
    await show(payload);
    await userEvent.click(await upgradeButton(payload));
    expect(await screen.findByTestId('plan-upgrade-awaiting')).toHaveTextContent(COPY['plan.upgrade.awaiting_confirmation']);
    expect(screen.getByTestId('plan-upgrade-due')).toHaveTextContent('$33.87');
    await userEvent.click(screen.getByRole('button', { name: COPY['plan.upgrade.confirm'] }));
    await waitFor(() => expect(stripe.handleNextAction).toHaveBeenCalledWith({ clientSecret: SECRET }));
    expect(confirmPosts()).toEqual([{ path: '/api/business-os/billing/plan/upgrade', body: { tier: TOP, prorationDate: PRORATION + 60 } }]);
    expect(document.body.textContent).not.toContain('SERVER ENGLISH MUST NOT SHOW');
  });

  it('M-2: no usable publishable key → the preview still shows, but no Confirm and no confirm POST', async () => {
    stripe.promise = null;
    const payload = await payloadFor({ billingRow: payingRow() });
    await show(payload);
    await toQuote(payload);
    expect(screen.getByTestId('plan-upgrade-not-configured')).toHaveTextContent(COPY['plan.choose.not_configured']);
    expect(screen.queryByRole('button', { name: COPY['plan.upgrade.confirm'] })).not.toBeInTheDocument();
    expect(confirmPosts()).toEqual([]);
  });
});

describe('declined, unknown and refusals (Q-6, V-3, V-2)', () => {
  it('E-2 / Q-6: declined with retryAfter → "Your card was declined, so nothing changed." + "You can try again after <time>"', async () => {
    server.confirms = [outcome({ outcome: 'declined', retryAfter: '2026-10-14T09:05:00.000Z' })];
    const payload = await payloadFor({ billingRow: payingRow() });
    await show(payload);
    await toQuote(payload);
    await userEvent.click(screen.getByRole('button', { name: COPY['plan.upgrade.confirm'] }));
    const declined = await screen.findByTestId('plan-upgrade-declined');
    expect(declined).toHaveTextContent(fill(COPY['plan.upgrade.declined'], { plan: payload.name! }));
    expect(declined).toHaveTextContent(/You can try again after October 14(,| at) 09:05 AM\./);
    // The next press is refused with the same time (upgrade_pending): the button is back.
    expect(await upgradeButton(payload)).toBeInTheDocument();
  });

  it.each([
    ['a 502 with outcomeUnknown (V-3)', refusal('stripe_error', { outcomeUnknown: true })],
    ['a 500 with no code', { status: 500, body: { success: false, error: 'Internal server error' } }],
    ['the network failed after sending', 'network' as const],
  ] as Array<[string, Answer]>)('%s → "We could not confirm your upgrade", never "nothing changed"', async (_label, answer) => {
    server.confirms = [answer, outcome({ outcome: 'upgraded' })];
    const before = await payloadFor({ billingRow: payingRow() });
    await show([before, before]);
    await toQuote(before);
    await userEvent.click(screen.getByRole('button', { name: COPY['plan.upgrade.confirm'] }));
    const unknown = await screen.findByTestId('plan-upgrade-unknown');
    expect(unknown).toHaveTextContent(COPY['plan.upgrade.not_sure']);
    expect(document.body.textContent).not.toMatch(/nothing changed/);

    // Check again: ONE server re-read, still unsure (the old plan).
    await userEvent.click(within(unknown).getByRole('button', { name: COPY['plan.purchase.check_again'] }));
    await waitFor(() => expect(server.planReads).toBe(2));
    expect(screen.getByTestId('plan-upgrade-unknown')).toBeInTheDocument();

    // Try again re-posts the SAME prorationDate (the idempotency key replays at Stripe).
    await userEvent.click(within(screen.getByTestId('plan-upgrade-unknown')).getByRole('button', { name: COPY['plan.upgrade.try_again'] }));
    await screen.findByTestId('plan-upgrade-upgrading');
    expect(confirmPosts().map((p) => p.body)).toEqual([
      { tier: TOP, prorationDate: PRORATION },
      { tier: TOP, prorationDate: PRORATION },
    ]);
  });

  it.each(PLAN_UPGRADE_REREAD_CODES)('%s (V-2: the change is landing) → "Upgrading…" and the re-read, not a line', async (code) => {
    server.confirms = [refusal(code)];
    const payload = await payloadFor({ billingRow: payingRow() });
    await show(payload);
    await toQuote(payload);
    await userEvent.click(screen.getByRole('button', { name: COPY['plan.upgrade.confirm'] }));
    expect(await screen.findByTestId('plan-upgrade-upgrading')).toBeInTheDocument();
    expect(screen.queryByTestId('plan-upgrade-refused')).not.toBeInTheDocument();
  });

  it('upgrade_pending shows the time it can be retried, on the account clock', async () => {
    server.preview = refusal('upgrade_pending', { retryAfter: '2026-10-14T09:05:00.000Z' });
    mockLang.timezone = 'Asia/Jerusalem';
    const payload = await payloadFor({ billingRow: payingRow() });
    await show(payload);
    await userEvent.click(await upgradeButton(payload));
    expect(await screen.findByTestId('plan-upgrade-refused')).toHaveTextContent(/after October 14(,| at) 12:05 PM\.$/);
  });

  // QA-M1: with no retryAfter there is no time to fill, so the line must be the
  // time-less one — never the timed template with a raw `{time}` placeholder.
  it.each(['preview', 'confirm'] as const)('upgrade_pending with no retryAfter on %s → the time-less line, no raw placeholder', async (step) => {
    if (step === 'preview') server.preview = refusal('upgrade_pending');
    else server.confirms = [refusal('upgrade_pending')];
    const payload = await payloadFor({ billingRow: payingRow() });
    await show(payload);
    if (step === 'preview') {
      await userEvent.click(await upgradeButton(payload));
    } else {
      await toQuote(payload);
      await userEvent.click(screen.getByRole('button', { name: COPY['plan.upgrade.confirm'] }));
    }
    const line = await screen.findByTestId('plan-upgrade-refused');
    expect(line).toHaveTextContent(COPY['plan.upgrade.refusal.pending_no_time']);
    expect(line.textContent).not.toContain('{');
    expect(document.body.textContent).not.toContain('SERVER ENGLISH MUST NOT SHOW');
  });

  const LINES: Array<[string, string]> = [
    ['subscription_cancelling', 'plan.upgrade.refusal.cancelling'],
    ['subscription_not_active', 'plan.upgrade.refusal.not_active'],
    ['preview_expired', 'plan.upgrade.refusal.preview_expired'],
    ['upgrade_busy', 'plan.upgrade.refusal.busy'],
    ['price_mismatch', 'plan.upgrade.refusal.unavailable'],
    ['billing_record_mismatch', 'plan.upgrade.refusal.support'],
    ['stripe_error', 'plan.upgrade.refusal.generic'],
    ['not_available', 'plan.upgrade.refusal.unavailable'],
  ];

  it.each(LINES)('a refused confirm (%s) shows the localized line, never the server\'s English; Upgrade comes back', async (code, key) => {
    server.confirms = [refusal(code)];
    const payload = await payloadFor({ billingRow: payingRow() });
    await show(payload);
    await toQuote(payload);
    await userEvent.click(screen.getByRole('button', { name: COPY['plan.upgrade.confirm'] }));
    expect(await screen.findByTestId('plan-upgrade-refused')).toHaveTextContent(COPY[key]);
    expect(document.body.textContent).not.toContain('SERVER ENGLISH MUST NOT SHOW');
    expect(await upgradeButton(payload)).toBeInTheDocument();
  });

  it('every refusal code the routes can send has a line in all three languages; 401 reads signed out', () => {
    const codes = [...Object.keys(PLAN_UPGRADE_REFUSALS), 'not_available', 'invalid_input'];
    expect(Object.keys(PLAN_UPGRADE_REFUSAL_KEYS).sort()).toEqual(codes.sort());
    expect(planUpgradeRefusalKey({ httpStatus: 401, code: null })).toBe('plan.refusal.signed_out');
    expect(planUpgradeRefusalKey({ httpStatus: 500, code: 'something_new' })).toBe('plan.upgrade.refusal.generic');
    const upgradeKeys = Object.keys(COPY).filter((key) => key.startsWith('plan.upgrade.') || key.startsWith('plan.choose.button_own') || key === 'plan.choose.own_plan_note');
    const keys = new Set([...Object.values(PLAN_UPGRADE_REFUSAL_KEYS), ...upgradeKeys, 'plan.refusal.signed_out']);
    expect(upgradeKeys.length).toBeGreaterThan(25);
    for (const language of ['en', 'he', 'es'] as const) {
      for (const key of keys) expect({ language, key, present: !!translations[language][key] }).toEqual({ language, key, present: true });
    }
  });
});

describe('Q-7: an admin-assigned plan with no billing record is offered its own plan as "Pay for"', () => {
  it('the row of the plan in force reads "Pay for <plan>" with the note; the others read "Choose"', async () => {
    const payload = await payloadFor({ billingRow: null });
    expect(payload.kind).toBe('tier');
    await show(payload);
    // UM-1b §13: the columns carry the buttons; the note is the modal footer's in the table view,
    // and the island's own (unchanged id) once that plan's checkout is open.
    await userEvent.click(screen.getByTestId('plan-compare-open'));
    for (const where of ['header', 'footer']) {
      expect(screen.getByTestId(`plan-compare-action-${LOWER}-${where}`)).toHaveAccessibleName(fill(COPY['plan.choose.button_own'], { plan: planName(payload, LOWER) }));
      expect(screen.getByTestId(`plan-compare-action-${TOP}-${where}`)).toHaveAccessibleName(fill(COPY['plan.choose.button'], { plan: planName(payload, TOP) }));
    }
    expect(screen.getByTestId('plan-compare-own-plan-note')).toHaveTextContent(fill(COPY['plan.choose.own_plan_note'], { plan: planName(payload, LOWER) }));
    await userEvent.click(screen.getByTestId(`plan-compare-action-${LOWER}-header`));
    const own = within(await screen.findByTestId(`plan-choice-${LOWER}`));
    expect(own.getByTestId('plan-choice-own-plan-note')).toHaveTextContent(fill(COPY['plan.choose.own_plan_note'], { plan: planName(payload, LOWER) }));
    // One flow: the other plan's row is not mounted (C-12).
    expect(screen.queryByTestId(`plan-choice-${TOP}`)).not.toBeInTheDocument();
  });

  it('a trial (a cohort, not a tier) sees no "Pay for" anywhere', async () => {
    const payload = await payloadFor({ planId: 'trial' });
    await show(payload);
    await userEvent.click(screen.getByTestId('plan-compare-open'));
    expect(screen.queryByTestId('plan-compare-own-plan-note')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: fill(COPY['plan.choose.button_own'], { plan: planName(payload, LOWER) }) })).not.toBeInTheDocument();
    expect(screen.queryByTestId('plan-choice-own-plan-note')).not.toBeInTheDocument();
  });
});

describe('Hebrew and Spanish (G-5 drafts): right to left, and no English', () => {
  const ENGLISH = [/Upgrade to/, /due now/i, /excluding tax/i, /renews on/i, /Confirm upgrade/, /Not now/];

  it.each(['he', 'es'] as const)('%s: the button, the quote and the island direction', async (language) => {
    const payload = await payloadFor({ billingRow: payingRow(), language });
    await show(payload, language);
    await userEvent.click(await upgradeButton(payload, language));
    await screen.findByTestId('plan-upgrade-quote');
    const dictionary = translations[language];
    expect(screen.getByTestId('plan-upgrade-due')).toHaveTextContent(fill(dictionary['plan.upgrade.due_now'], { amount: '$33.87' }));
    expect(screen.getByRole('button', { name: dictionary['plan.upgrade.confirm'] })).toBeInTheDocument();
    const text = document.body.textContent ?? '';
    expect(ENGLISH.filter((phrase) => phrase.test(text)).map(String)).toEqual([]);
    expect(screen.getByTestId('plan-upgrade').closest('[dir]')).toHaveAttribute('dir', language === 'he' ? 'rtl' : 'ltr');
  });

  it.each(['he', 'es'] as const)('%s: a refusal reads in the owner\'s language', async (language) => {
    server.preview = refusal('subscription_cancelling');
    const payload = await payloadFor({ billingRow: payingRow(), language });
    await show(payload, language);
    await userEvent.click(await upgradeButton(payload, language));
    expect(await screen.findByTestId('plan-upgrade-refused')).toHaveTextContent(translations[language]['plan.upgrade.refusal.cancelling']);
  });
});

describe('G-1: what a handleNextAction answer means', () => {
  it.each([
    [{ paymentIntent: { status: 'succeeded' } }, 'upgrading'],
    [{ paymentIntent: { status: 'processing' } }, 'upgrading'],
    [{ paymentIntent: { status: 'requires_capture' } }, 'upgrading'],
    [{ error: { type: 'api_connection_error', payment_intent: { status: 'succeeded' } } }, 'upgrading'],
    [{ paymentIntent: { status: 'requires_payment_method' } }, 'not_confirmed'],
    [{ paymentIntent: { status: 'requires_action' } }, 'not_confirmed'],
    [{ paymentIntent: { status: 'canceled' } }, 'not_confirmed'],
    [{ error: { type: 'card_error' } }, 'not_confirmed'],
    [{ error: { type: 'invalid_request_error', code: 'payment_intent_authentication_failure' } }, 'not_confirmed'],
    [{ error: { type: 'api_connection_error' } }, 'unknown'],
    [{ error: { type: 'api_error' } }, 'unknown'],
    [{ error: { type: 'rate_limit_error' } }, 'unknown'],
    [{ error: { type: 'invalid_request_error' } }, 'unknown'],
    [{ paymentIntent: { status: 'requires_confirmation' } }, 'unknown'],
    [{}, 'unknown'],
  ] as Array<[Parameters<typeof classifyNextAction>[0], ReturnType<typeof classifyNextAction>]>)('%j → %s', (result, expected) => {
    expect(classifyNextAction(result)).toBe(expected);
  });
});

describe('source guards (CLAUDE.md rule 1, W-6, V-1, Pino)', () => {
  const read = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8');
  const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const CLIENT_FILES = ['components/business-os/settings/PlanUpgrade.tsx', 'components/business-os/settings/planUpgradeCopy.ts'];

  it.each(CLIENT_FILES)('%s imports nothing from the entitlements module, no server code, no billing value, and writes no console call', (file) => {
    const text = code(read(file));
    expect(text).not.toMatch(/from\s+'[^']*lib\/business-os\/entitlements/);
    expect(text).not.toMatch(/console\./);
    expect(text).not.toMatch(/server-only|lib\/repositories|supabaseServer|lib\/stripe\//);
    const valueImports = text.match(/^import\s+(?!type\s)[^;]*?from\s+'[^']+';/gm) ?? [];
    expect(valueImports.filter((s) => /lib\/business-os\/billing/.test(s))).toEqual([]);
  });

  it('the secret is never put in state, a URL, storage or a log (V-1)', () => {
    const text = code(read('components/business-os/settings/PlanUpgrade.tsx'));
    expect(text).not.toMatch(/localStorage|sessionStorage|document\.cookie|history\.|router\.|URLSearchParams|location\./);
    // The secret is passed straight to handleNextAction and held in no state.
    expect(text).not.toMatch(/useState<[^>]*clientSecret/);
    expect(text).not.toMatch(/setPhase\(\{[^}]*clientSecret/);
    expect(text).not.toMatch(/logger\.\w+\([^)]*clientSecret/);
    expect(text).toMatch(/handleNextAction\(\{ clientSecret \}\)/);
  });

  it('the island is a client component', () => {
    expect(read('components/business-os/settings/PlanUpgrade.tsx').trimStart().startsWith("'use client';")).toBe(true);
  });
});
