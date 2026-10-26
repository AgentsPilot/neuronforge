/**
 * @jest-environment jsdom
 *
 * Buying and upgrading in the plan comparison modal (upgrade modal UM-1b,
 * workplan §12.2; SA W-2, W-4, Q-2, Q-5, Q-6, Q-8, Q-11, Q-12).
 *
 * Driven through the real `PlanSection` (so the modal shares its one
 * `usePlanFlow` instance, C-3) with REAL payloads (`upgradeModalPayloads`). The
 * routes are faked at `fetch`; Stripe.js and the embedded checkout are faked
 * at their modules. What is asserted is what the owner sees and what is POSTed:
 *   - a column's header and footer buttons start ONE flow, once (StrictMode too);
 *   - one island and one checkout at a time (C-12);
 *   - "Back to plans" / "Not now" return to the table, focus on the pressed button;
 *   - the busy lock during Confirm and 3-D Secure, and the hand-off close that
 *     bypasses it (W-2), with "Upgrading…" in the drawer;
 *   - "Could not confirm": no way back, but closable (Q-11); a re-read showing
 *     the upgrade landed closes the modal (Q-12);
 *   - an open checkout frame survives a stray backdrop press, not the X (Q-8);
 *   - focus starts on the title, so an Enter right after opening posts nothing (Q-6).
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
const stripe: { handleNextAction: jest.Mock; loads: number } = { handleNextAction: jest.fn(), loads: 0 };
jest.mock('@/lib/client/stripeJs', () => ({
  // Counts the loads: `getStripePromise()` is what injects Stripe.js into the page (SA CR-1).
  getStripePromise: () => {
    stripe.loads += 1;
    return Promise.resolve({ handleNextAction: (...args: unknown[]) => stripe.handleNextAction(...args) });
  },
}));
jest.mock('@stripe/react-stripe-js', () => ({
  EmbeddedCheckoutProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="fake-provider">{children}</div>,
  EmbeddedCheckout: () => <div data-testid="fake-checkout" />,
}));

import { PlanSection } from '@/components/business-os/settings/PlanSection';
import type { PlanPayload } from '@/components/business-os/settings/planPayloadTypes';
import { STRIPE_CHALLENGE_REACHABLE_CSS } from '@/components/business-os/settings/UpgradeModal';

import { FOUNDING_PARTNER, LOWER, TOP, TRIAL, payingRow, payloadFor } from './upgradeModalPayloads';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};
const COPY = translations.en;
const SLOW = 20_000;

interface Reply {
  status: number;
  body: unknown;
}
function deferred() {
  let resolve: (reply: Reply) => void = () => undefined;
  const promise = new Promise<Reply>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const QUOTE: Reply = {
  status: 200,
  body: { success: true, data: { amountDueMinor: 3387, prorationDate: 1_792_766_146, renewsOn: '2026-11-13T09:30:00.000Z', monthlyPriceMinor: 12900 } },
};
const CHECKOUT: Reply = {
  status: 200,
  body: { success: true, data: { clientSecret: 'cs_test_secret_x', sessionId: 'cs_test_s1', expiresAt: '2026-10-13T10:31:00.000Z', tier: 'x' } },
};
const outcome = (data: Record<string, unknown>): Reply => ({ status: 200, body: { success: true, data } });

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
  stripe.loads = 0;
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
const closeX = (modal: HTMLElement) => within(modal).getByRole('button', { name: 'Close' });
const backdrop = (modal: HTMLElement) => {
  const overlays = Array.from(document.querySelectorAll('.fixed.inset-0')).filter((element) => !element.contains(modal));
  return overlays[overlays.length - 1];
};
const pressOutside = (element: Element) => {
  fireEvent.pointerDown(element);
  fireEvent.pointerUp(element);
  fireEvent.click(element);
};

/** An Essentials owner, on the TOP plan's quote. */
async function toQuote() {
  const payload = await payloadFor({ billingRow: payingRow(LOWER) });
  await showSection([payload]);
  const modal = await openPlans();
  await userEvent.click(action(TOP));
  await screen.findByTestId('plan-upgrade-quote');
  return { payload, modal };
}

describe('one flow per column, once (C-25, C-12, SA Q-2)', () => {
  it('the footer button starts the same flow as the header one: one preview POST, the table replaced, focus on the flow heading', async () => {
    const payload = await payloadFor({ billingRow: payingRow(LOWER) });
    await showSection([payload]);
    await openPlans();
    await userEvent.click(action(TOP, 'footer'));
    await screen.findByTestId('plan-upgrade-quote');
    expect(posts('/preview')).toEqual([expect.objectContaining({ body: { tier: TOP } })]);
    expect(screen.queryByTestId('plan-compare-table')).not.toBeInTheDocument();
    expect(screen.getByTestId('plan-compare-flow-heading')).toHaveFocus();
  }, SLOW);

  it('a trial\'s Choose: one checkout POST { tier, returnTo }, one island, one frame, no other column button', async () => {
    const payload = await payloadFor({ planId: TRIAL });
    await showSection([payload]);
    await openPlans();
    await userEvent.click(action(LOWER));
    await screen.findByTestId('fake-checkout');
    expect(checkoutPosts().map((post) => post.body)).toEqual([{ tier: LOWER, returnTo: 'settings_plan' }]);
    expect(screen.getAllByTestId('fake-checkout')).toHaveLength(1);
    expect(screen.getAllByTestId(/^plan-choice-/)).toHaveLength(1);
    expect(screen.queryAllByTestId(/^plan-compare-action-/)).toHaveLength(0);
    // C-12: the drawer itself mounts no island.
    expect(screen.getAllByTestId('plan-purchase').every((island) => screen.getByTestId('plan-compare-modal').contains(island))).toBe(true);
  }, SLOW);

  it.each(['checkout', 'upgrade'] as const)('StrictMode: one %s POST per press (the start is read once, through a ref)', async (kind) => {
    const payload = kind === 'checkout' ? await payloadFor({ planId: TRIAL }) : await payloadFor({ billingRow: payingRow(LOWER) });
    await showSection([payload], { strict: true });
    await openPlans();
    await userEvent.click(action(kind === 'checkout' ? LOWER : TOP));
    await screen.findByTestId(kind === 'checkout' ? 'fake-checkout' : 'plan-upgrade-quote');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(kind === 'checkout' ? checkoutPosts() : posts('/preview')).toHaveLength(1);
  }, SLOW);

  it('"Back to plans" returns to the table with focus on the button pressed; a second Choose posts again (the server replaces the session, M-3)', async () => {
    const payload = await payloadFor({ planId: TRIAL });
    await showSection([payload]);
    await openPlans();
    await userEvent.click(action(TOP, 'footer'));
    await screen.findByTestId('fake-checkout');
    await userEvent.click(screen.getByTestId('plan-compare-back'));
    expect(screen.getByTestId('plan-compare-table')).toBeInTheDocument();
    await waitFor(() => expect(action(TOP, 'footer')).toHaveFocus());
    await userEvent.click(action(TOP));
    await screen.findByTestId('fake-checkout');
    expect(checkoutPosts()).toHaveLength(2);
  }, SLOW);
});

describe('"Not now" and refusals (SA W-4)', () => {
  it('"Not now" on the quote goes back to the table, posting nothing more', async () => {
    await toQuote();
    await userEvent.click(screen.getByRole('button', { name: COPY['plan.upgrade.cancel'] }));
    expect(screen.getByTestId('plan-compare-table')).toBeInTheDocument();
    await waitFor(() => expect(action(TOP)).toHaveFocus());
    expect(server.posts).toHaveLength(1);
  }, SLOW);

  it('a refused confirm stays in the flow (never back to the table): the line, and the island\'s own Upgrade button', async () => {
    server.replies.confirm = [{ status: 409, body: { success: false, code: 'subscription_cancelling', error: 'SERVER ENGLISH' } }];
    await toQuote();
    await userEvent.click(screen.getByRole('button', { name: COPY['plan.upgrade.confirm'] }));
    expect(await screen.findByTestId('plan-upgrade-refused')).toHaveTextContent(COPY['plan.upgrade.refusal.cancelling']);
    expect(screen.getByTestId('plan-upgrade-refused')).toHaveClass('text-[var(--v2-error-text)]');
    expect(screen.queryByTestId('plan-compare-table')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('plan-compare-flow')).getByTestId(`plan-upgrade-button-${TOP}`)).toBeInTheDocument();
  }, SLOW);
});

describe('the busy lock (UM-FR11) and the hand-off (SA W-2)', () => {
  it('during Confirm: Escape, the X, a backdrop press and both "Back" buttons cannot close it; then "upgraded" closes it in the same act and the drawer says "Upgrading…"', async () => {
    const confirm = deferred();
    server.replies.confirm = [confirm.promise];
    const { modal } = await toQuote();
    await userEvent.click(screen.getByRole('button', { name: COPY['plan.upgrade.confirm'] }));
    await waitFor(() => expect(posts('/plan/upgrade')).toHaveLength(1));

    await waitFor(() => expect(screen.getByTestId('plan-compare-flow')).toHaveAttribute('aria-busy', 'true'));
    fireEvent.keyDown(modal, { key: 'Escape' });
    fireEvent.click(closeX(modal));
    pressOutside(backdrop(modal));
    expect(screen.getByTestId('plan-compare-modal')).toBeInTheDocument();
    expect(screen.queryByTestId('plan-compare-back')).not.toBeInTheDocument();
    expect(within(modal).queryByRole('button', { name: COPY['upgrade_modal.back_to_plan'] })).not.toBeInTheDocument();
    // SA Q-7 (iii): Stripe's frames are reachable while busy.
    expect(screen.getByTestId('plan-compare-stripe-reachable').textContent).toBe(STRIPE_CHALLENGE_REACHABLE_CSS);

    await act(async () => confirm.resolve(outcome({ outcome: 'upgraded' })));
    // W-2: the hand-off ignores the lock the island had reported.
    expect(screen.queryByTestId('plan-compare-modal')).not.toBeInTheDocument();
    expect(screen.getByTestId('plan-upgrade-upgrading')).toBeInTheDocument();
    expect(document.querySelector('[data-testid="plan-compare-stripe-reachable"]')).toBeNull();
  }, SLOW);

  it('during 3-D Secure: locked while the challenge runs; "succeeded" hands off to "Upgrading…"', async () => {
    server.replies.confirm = [outcome({ outcome: 'action_required', clientSecret: 'pi_secret_owner_only' })];
    let finish: (result: unknown) => void = () => undefined;
    stripe.handleNextAction.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const { modal } = await toQuote();
    await userEvent.click(screen.getByRole('button', { name: COPY['plan.upgrade.confirm'] }));
    await screen.findByTestId('plan-upgrade-authenticating');
    expect(stripe.handleNextAction).toHaveBeenCalledWith({ clientSecret: 'pi_secret_owner_only' });

    fireEvent.keyDown(modal, { key: 'Escape' });
    pressOutside(backdrop(modal));
    expect(screen.getByTestId('plan-compare-modal')).toBeInTheDocument();
    expect(screen.getByTestId('plan-compare-stripe-reachable')).toBeInTheDocument();

    await act(async () => finish({ paymentIntent: { status: 'succeeded' } }));
    expect(screen.queryByTestId('plan-compare-modal')).not.toBeInTheDocument();
    expect(screen.getByTestId('plan-upgrade-upgrading')).toBeInTheDocument();
  }, SLOW);

  it('"Could not confirm": no way back to the table, but the owner may close (SA Q-11)', async () => {
    server.replies.confirm = [{ status: 500, body: { success: false, error: 'Internal server error' } }];
    const { modal } = await toQuote();
    await userEvent.click(screen.getByRole('button', { name: COPY['plan.upgrade.confirm'] }));
    await screen.findByTestId('plan-upgrade-unknown');
    expect(screen.queryByTestId('plan-compare-back')).not.toBeInTheDocument();
    expect(screen.queryByTestId('plan-compare-stripe-reachable')).not.toBeInTheDocument();
    fireEvent.keyDown(modal, { key: 'Escape' });
    await modalGone();
  }, SLOW);

  it('SA Q-12: "Check again" finds the upgrade landed → the modal closes and the drawer says "You\'re on {plan}"', async () => {
    server.replies.confirm = [{ status: 500, body: { success: false, error: 'Internal server error' } }];
    const before = await payloadFor({ billingRow: payingRow(LOWER) });
    const after = await payloadFor({ planId: TOP, billingRow: payingRow(TOP) });
    // Non-vacuity: after the landing the server no longer offers TOP.
    expect(after.purchase?.upgrade ?? null).toBeNull();
    await showSection([before, after]);
    await openPlans();
    await userEvent.click(action(TOP));
    await screen.findByTestId('plan-upgrade-quote');
    await userEvent.click(screen.getByRole('button', { name: COPY['plan.upgrade.confirm'] }));
    const unknown = await screen.findByTestId('plan-upgrade-unknown');
    await userEvent.click(within(unknown).getByRole('button', { name: COPY['plan.purchase.check_again'] }));
    await modalGone();
    expect(await screen.findByTestId('plan-upgrade-done')).toBeInTheDocument();
  }, SLOW);
});

describe('an open checkout frame (SA Q-8, CR-2)', () => {
  it('a backdrop press does nothing; the X still closes, and the Stripe-frames style goes with it', async () => {
    await showSection([await payloadFor({ planId: TRIAL })]);
    const modal = await openPlans();
    await userEvent.click(action(LOWER));
    await screen.findByTestId('fake-checkout');
    // CR-2: the embedded checkout's own 3-D Secure may mount on body too.
    await waitFor(() => expect(screen.getByTestId('plan-compare-stripe-reachable').textContent).toBe(STRIPE_CHALLENGE_REACHABLE_CSS));
    pressOutside(backdrop(modal));
    expect(screen.getByTestId('plan-compare-modal')).toBeInTheDocument();
    await userEvent.click(closeX(modal));
    await modalGone();
    expect(document.querySelector('[data-testid="plan-compare-stripe-reachable"]')).toBeNull();
  }, SLOW);

  it('CR-2: the style is there only while the frame is open: none on the table, present on the frame, gone after "Back to plans"', async () => {
    await showSection([await payloadFor({ planId: TRIAL })]);
    await openPlans();
    expect(screen.queryByTestId('plan-compare-stripe-reachable')).not.toBeInTheDocument();
    await userEvent.click(action(TOP));
    await screen.findByTestId('fake-checkout');
    await waitFor(() => expect(screen.getByTestId('plan-compare-stripe-reachable')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('plan-compare-back'));
    expect(screen.getByTestId('plan-compare-table')).toBeInTheDocument();
    expect(screen.queryByTestId('plan-compare-stripe-reachable')).not.toBeInTheDocument();
  }, SLOW);
});

describe('Stripe.js is loaded only when it can be needed (SA CR-1)', () => {
  it.each([
    ['an Autopilot owner (nothing offered)', { planId: TOP, billingRow: payingRow(TOP) }],
    ['an open-ended Founding Partner (nothing offered, BQ-P10)', { planId: FOUNDING_PARTNER }],
  ] as const)('%s: opening the drawer and the modal never loads Stripe.js', async (_label, options) => {
    const payload = await payloadFor(options);
    expect(offeredAnything(payload)).toBe(false);
    await showSection([payload]);
    await openPlans();
    expect(stripe.loads).toBe(0);
  }, SLOW);

  it('control: a trial (a checkout is offered) asks for it, so the Choose buttons can show', async () => {
    await showSection([await payloadFor({ planId: TRIAL })]);
    await openPlans();
    expect(stripe.loads).toBeGreaterThan(0);
    expect(action(LOWER)).toBeInTheDocument();
  }, SLOW);
});

/** Anything offered to choose or upgrade to (server data). */
function offeredAnything(payload: PlanPayload) {
  return (payload.purchase?.offer.kind === 'choose' && payload.purchase.offer.tiers.length > 0) || (payload.purchase?.upgrade?.tiers.length ?? 0) > 0;
}

describe('focus and language (SA Q-6, RTL)', () => {
  it('opening focuses the title, not a money button: an Enter right after opening posts nothing', async () => {
    await showSection([await payloadFor({ planId: TRIAL })]);
    await openPlans();
    expect(screen.getByTestId('plan-compare-title')).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(server.posts).toEqual([]);
    expect(screen.getByTestId('plan-compare-table')).toBeInTheDocument();
  }, SLOW);

  it('Hebrew: "Back to plans" in Hebrew, its chevron mirrored, the drawer button reads "See plans" in Hebrew', async () => {
    mockLang.language = 'he';
    await showSection([await payloadFor({ planId: TRIAL, language: 'he' })]);
    expect(screen.getByTestId('plan-compare-open')).toHaveTextContent(translations.he['upgrade_modal.open_see_plans']);
    await openPlans();
    await userEvent.click(action(LOWER));
    const back = await screen.findByTestId('plan-compare-back');
    expect(back).toHaveTextContent(translations.he['upgrade_modal.back_to_plans']);
    expect(back.querySelector('svg')?.getAttribute('class')).toContain('scale-x-[-1]');
  }, SLOW);
});
