/**
 * @jest-environment jsdom
 *
 * The window opened from anywhere (upgrade modal UM-2, workplan §5, §6, §11.2):
 * the real `StandaloneUpgradeModal` with its own read and its own `usePlanFlow`
 * instance, the same `UpgradeModal`, REAL payloads. Routes faked at `fetch`,
 * Stripe faked at its modules.
 *
 * What is pinned:
 *   - its own read: loading (never blank), failed, a server problem; closable in each;
 *   - `afterUpgrade="stay"`: "Upgrading…" in the window body, "You're on" only
 *     after the bounded re-read says so (U-5); a failed re-read never claims it;
 *   - 3-D Secure busy lock as in UM-1b; the Q-12 landing stays in the window;
 *   - UM-SA10 / C-12: a checkout closes the window and returns to Settings → Plan;
 *   - the variants (lock header, "Needed for this", not-offered line,
 *     "Keep everything you have"), no dead button, Hebrew RTL and Spanish.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

type Lang = 'en' | 'he' | 'es';
const mockLang: { language: Lang } = { language: 'en' };
jest.mock('@/lib/business-os/LanguageContext', () => {
  const { translations } = jest.requireActual('@/lib/business-os/LanguageContext');
  const value = () => ({
    language: mockLang.language,
    timezone: 'UTC',
    isRTL: mockLang.language === 'he',
    t: (key: string) => translations[mockLang.language][key] || key,
  });
  return { useLanguage: value, useOptionalLanguage: value };
});
const mockLog = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock('@/lib/logger', () => ({ ...jest.requireActual('@/lib/logger'), createLogger: () => mockLog }));
jest.mock('@/lib/supabaseClient', () => ({ supabase: {} }));
jest.mock('@/lib/stripe/StripeService', () => ({
  getStripeService: () => {
    throw new Error('the plan screen never talks to Stripe');
  },
}));
const router = { replace: jest.fn() };
jest.mock('next/navigation', () => ({ useRouter: () => router }));
const stripe: { handleNextAction: jest.Mock; completes: Array<() => void>; providers: number } = { handleNextAction: jest.fn(), completes: [], providers: 0 };
jest.mock('@/lib/client/stripeJs', () => ({
  getStripePromise: () => Promise.resolve({ handleNextAction: (...args: unknown[]) => stripe.handleNextAction(...args) }),
}));
jest.mock('@stripe/react-stripe-js', () => ({
  EmbeddedCheckoutProvider: ({ options, children }: { options: { onComplete?: () => void }; children: React.ReactNode }) => {
    if (options.onComplete) stripe.completes.push(options.onComplete);
    return <div data-testid="fake-provider">{children}</div>;
  },
  EmbeddedCheckout: () => <div data-testid="fake-checkout" />,
}));

import { PROCESSING_REFRESH_INTERVAL_MS, PROCESSING_REFRESH_LIMIT } from '@/components/business-os/billing/checkoutProcessing';
import { PlanSection } from '@/components/business-os/settings/PlanSection';
import type { PlanPayload } from '@/components/business-os/settings/planPayloadTypes';
import { StandaloneUpgradeModal } from '@/components/business-os/settings/StandaloneUpgradeModal';
import type { UpgradeModalContext } from '@/components/business-os/settings/upgradeModalContext';
import { BUTTON_ACTIONS, upgradeModalView } from '@/components/business-os/settings/upgradeModalView';

import { FOUNDING_PARTNER, LOWER, TOP, TRIAL, inSixtyDays, payingRow, payloadFor } from './upgradeModalPayloads';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};
const COPY = translations.en;
const SLOW = 30_000;
const SESSION = 'cs_test_s1';
const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (slot, name: string) => values[name] ?? slot);
const nameOf = (payload: PlanPayload, planId: string) => payload.plans!.find((choice) => choice.planId === planId)!.name;

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
  body: { success: true, data: { clientSecret: 'cs_test_secret_x', sessionId: SESSION, expiresAt: '2026-10-13T10:31:00.000Z', tier: 'x' } },
};
const outcome = (data: Record<string, unknown>): Reply => ({ status: 200, body: { success: true, data } });

/** my-plan answers in order (the last repeats); 'throw' is a network failure; 'hold' never answers. */
const server: { plans: Array<PlanPayload | 'throw' | 'hold'>; reads: number; confirm: Reply[]; posts: string[] } = { plans: [], reads: 0, confirm: [], posts: [] };

beforeEach(() => {
  mockLang.language = 'en';
  Object.values(mockLog).forEach((fn) => fn.mockReset());
  router.replace.mockReset();
  stripe.handleNextAction.mockReset();
  stripe.completes = [];
  server.plans = [];
  server.reads = 0;
  server.confirm = [];
  server.posts = [];
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      server.posts.push(url);
      const reply = url.endsWith('/preview') ? QUOTE : url.endsWith('/plan/upgrade') ? server.confirm.shift() ?? outcome({ outcome: 'upgraded' }) : CHECKOUT;
      return { ok: reply.status < 300, status: reply.status, json: async () => reply.body } as Response;
    }
    const next = server.plans[Math.min(server.reads, server.plans.length - 1)];
    server.reads += 1;
    if (next === 'throw') throw new Error('network down');
    if (next === 'hold') return new Promise<Response>(() => {});
    return { ok: true, status: 200, json: async () => ({ success: true, data: next }) } as Response;
  }) as unknown as typeof fetch;
});
afterEach(() => {
  jest.useRealTimers();
});

const onClose = jest.fn();
function show(plans: Array<PlanPayload | 'throw' | 'hold'>, context: UpgradeModalContext = { kind: 'settings' }) {
  onClose.mockReset();
  server.plans = plans;
  return render(<StandaloneUpgradeModal isOpen onClose={onClose} context={context} />);
}
const modal = () => screen.getByTestId('plan-compare-modal');
const action = (planId: string, where: 'header' | 'footer' = 'header') => screen.getByTestId(`plan-compare-action-${planId}-${where}`);
const area = () => screen.getByTestId('plan-compare-table-area');

/** Fake timers: step the bounded re-read until `done()` holds (to a condition, not a fixed count: CI flake note). */
async function advanceUntil(done: () => boolean, steps = 5) {
  for (let i = 0; i < steps && !done(); i += 1) {
    await act(async () => {
      jest.advanceTimersByTime(PROCESSING_REFRESH_INTERVAL_MS);
    });
  }
}

async function toQuote(payloads: Array<PlanPayload | 'throw' | 'hold'>) {
  show(payloads);
  await screen.findByTestId('plan-compare-table');
  await userEvent.click(action(TOP));
  await screen.findByTestId('plan-upgrade-quote');
}

describe('its own read (X-3, NFR: never a blank modal)', () => {
  it('loading: a spinner and "Loading…" in an aria-busy region, the default band; closable', async () => {
    show(['hold']);
    const loading = await screen.findByTestId('plan-compare-loading');
    expect(loading).toHaveAttribute('aria-busy', 'true');
    expect(loading).toHaveTextContent(COPY['plan.loading']);
    expect(screen.getByTestId('plan-compare-title')).toHaveTextContent(COPY['upgrade_modal.headline.compare']);
    expect(screen.queryByTestId('plan-compare-status')).not.toBeInTheDocument();
    fireEvent.keyDown(modal(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('failed: "unavailable", a warn line with the error (no plan data), closable', async () => {
    show(['throw']);
    expect(await screen.findByTestId('plan-compare-problem')).toHaveTextContent(COPY['plan.problem.unavailable']);
    expect(mockLog.warn).toHaveBeenCalledWith({ err: expect.any(Error) }, 'Could not load the plan for the upgrade modal');
    fireEvent.keyDown(modal(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a plan that is not ok: the server\'s own problem sentence, no table', async () => {
    const base = await payloadFor({ planId: TRIAL });
    show([{ ...base, status: 'unavailable', problem: { key: 'plan.problem.unavailable' } }]);
    expect(await screen.findByTestId('plan-compare-problem')).toHaveTextContent(COPY['plan.problem.unavailable']);
    expect(screen.queryByTestId('plan-compare-table')).not.toBeInTheDocument();
  });
});

describe('an upgrade stays in the window (afterUpgrade "stay", U-5)', () => {
  it('Confirm → "upgraded": still open, "Upgrading…" in the body; "You\'re on" only after the re-read shows it', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    const before = await payloadFor({ billingRow: payingRow(LOWER) });
    const after = await payloadFor({ planId: TOP, billingRow: payingRow(TOP) });
    await toQuote([before, after]);
    await userEvent.click(screen.getByRole('button', { name: COPY['plan.upgrade.confirm'] }));
    const upgrading = await within(area()).findByTestId('plan-upgrade-upgrading');
    expect(upgrading).toHaveTextContent(COPY['plan.upgrade.upgrading']);
    expect(modal()).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByTestId('plan-upgrade-done')).not.toBeInTheDocument();
    expect(screen.queryByTestId('plan-compare-table')).not.toBeInTheDocument();

    await advanceUntil(() => screen.queryByTestId('plan-upgrade-done') !== null);
    expect(within(area()).getByTestId('plan-upgrade-done')).toHaveTextContent(fill(COPY['plan.upgrade.done'], { plan: after.name! }));
    expect(screen.queryByTestId('plan-upgrade-upgrading')).not.toBeInTheDocument();
  }, SLOW);

  it('failed re-reads keep "Upgrading…", never "You\'re on"; after the limit "taking longer" links to Settings → Plan', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    const before = await payloadFor({ billingRow: payingRow(LOWER) });
    await toQuote([before, before, 'throw']);
    await userEvent.click(screen.getByRole('button', { name: COPY['plan.upgrade.confirm'] }));
    await within(area()).findByTestId('plan-upgrade-upgrading');
    await advanceUntil(() => screen.queryByTestId('plan-purchase-slow') !== null, PROCESSING_REFRESH_LIMIT * 3);
    expect(screen.queryByTestId('plan-upgrade-done')).not.toBeInTheDocument();
    expect(within(area()).getByTestId('plan-purchase-check-again')).toHaveAttribute('href', '/business-os/settings?section=plan');
  }, SLOW);

  it('3-D Secure: the UM-1b busy lock (Escape refused, Stripe frames reachable); "succeeded" → the status in the body', async () => {
    server.confirm = [outcome({ outcome: 'action_required', clientSecret: 'pi_secret_owner_only' })];
    let finish: (result: unknown) => void = () => undefined;
    stripe.handleNextAction.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    await toQuote([await payloadFor({ billingRow: payingRow(LOWER) })]);
    await userEvent.click(screen.getByRole('button', { name: COPY['plan.upgrade.confirm'] }));
    await screen.findByTestId('plan-upgrade-authenticating');
    fireEvent.keyDown(modal(), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('plan-compare-stripe-reachable')).toBeInTheDocument();
    await act(async () => finish({ paymentIntent: { status: 'succeeded' } }));
    expect(within(area()).getByTestId('plan-upgrade-upgrading')).toBeInTheDocument();
    expect(screen.queryByTestId('plan-compare-stripe-reachable')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  }, SLOW);

  it('SA Q-12 in "stay": Check again finds the upgrade landed → "You\'re on {plan}" in the body, window open', async () => {
    server.confirm = [{ status: 500, body: { success: false, error: 'Internal server error' } }];
    const before = await payloadFor({ billingRow: payingRow(LOWER) });
    const after = await payloadFor({ planId: TOP, billingRow: payingRow(TOP) });
    await toQuote([before, after]);
    await userEvent.click(screen.getByRole('button', { name: COPY['plan.upgrade.confirm'] }));
    const unknown = await screen.findByTestId('plan-upgrade-unknown');
    await userEvent.click(within(unknown).getByRole('button', { name: COPY['plan.purchase.check_again'] }));
    expect(await within(area()).findByTestId('plan-upgrade-done')).toHaveTextContent(fill(COPY['plan.upgrade.done'], { plan: after.name! }));
    expect(onClose).not.toHaveBeenCalled();
  }, SLOW);
});

describe('a checkout returns to Settings → Plan (UM-SA10, C-12)', () => {
  it('Stripe completes → the window closes and router.replace(settings plan + marker) in the same act; Settings then shows "Payment processing", one provider ever', async () => {
    const trial = await payloadFor({ planId: TRIAL });
    const view = show([trial]);
    await screen.findByTestId('plan-compare-table');
    await userEvent.click(action(LOWER));
    await screen.findByTestId('fake-checkout');
    await waitFor(() => expect(stripe.completes.length).toBeGreaterThan(0));
    expect(screen.getAllByTestId('fake-provider')).toHaveLength(1);

    act(() => stripe.completes[stripe.completes.length - 1]());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith(`/business-os/settings?section=plan&checkout=${SESSION}`, { scroll: false });

    // The provider closes the window (isOpen false); then the Settings drawer mounts with the marker.
    view.rerender(
      <>
        <StandaloneUpgradeModal isOpen={false} onClose={onClose} context={{ kind: 'settings' }} />
        <PlanSection checkoutMarker={SESSION} />
      </>
    );
    expect(screen.queryByTestId('fake-checkout')).not.toBeInTheDocument();
    expect(await screen.findByTestId('plan-purchase-processing')).toHaveTextContent(COPY['plan.purchase.processing']);
    expect(screen.queryAllByTestId('fake-provider')).toHaveLength(0);
  }, SLOW);
});

describe('the variants (§6; AC-UM5, AC-UM9; SA Q-2, X-8)', () => {
  it('locked_feature + TOP, Essentials owner: lock icon, "This needs {plan}" with the payload\'s name, "Needed for this" on TOP, no not-offered line', async () => {
    const payload = await payloadFor({ billingRow: payingRow(LOWER) });
    show([payload], { kind: 'locked_feature', planId: TOP });
    await screen.findByTestId('plan-compare-table');
    expect(screen.getByTestId('plan-compare-lock-icon')).toBeInTheDocument();
    expect(screen.getByTestId('plan-compare-title')).toHaveTextContent(fill(COPY['upgrade_modal.headline.locked_feature'], { plan: nameOf(payload, TOP) }));
    expect(screen.getByTestId('plan-compare-title')).toHaveTextContent(fill(COPY['upgrade_modal.subheading.locked_feature'], { plan: nameOf(payload, TOP) }));
    const badge = within(screen.getByTestId(`plan-compare-col-${TOP}`)).getByTestId('plan-compare-badge-locked_feature');
    expect(badge).toHaveTextContent(COPY['upgrade_modal.badge.needed']);
    expect(screen.queryByText(COPY['upgrade_modal.recommended'])).not.toBeInTheDocument();
    expect(screen.queryByTestId('plan-compare-locked-not-offered')).not.toBeInTheDocument();
    expect(action(TOP)).toBeInTheDocument();
  }, SLOW);

  it('AC-UM9: locked_feature + TOP for an open-ended Founding Partner: the not-offered line, no button anywhere', async () => {
    const payload = await payloadFor({ planId: FOUNDING_PARTNER });
    show([payload], { kind: 'locked_feature', planId: TOP });
    await screen.findByTestId('plan-compare-table');
    expect(screen.getByTestId('plan-compare-locked-not-offered')).toHaveTextContent(fill(COPY['upgrade_modal.locked.not_offered'], { plan: nameOf(payload, TOP) }));
    expect(screen.queryAllByTestId(/^plan-compare-action-/)).toHaveLength(0);
  }, SLOW);

  it('AC-UM5: founding_partner with an end date: "Keep everything you have", its subheading, Choose buttons, the free-access line', async () => {
    show([await payloadFor({ planId: FOUNDING_PARTNER, cohortExpiresAt: inSixtyDays() })], { kind: 'founding_partner' });
    await screen.findByTestId('plan-compare-table');
    expect(screen.getByTestId('plan-compare-title')).toHaveTextContent(COPY['upgrade_modal.headline.founding_partner']);
    expect(screen.getByTestId('plan-compare-title')).toHaveTextContent(COPY['upgrade_modal.subheading.founding_partner']);
    expect(screen.queryAllByTestId(/^plan-compare-action-/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('plan-compare-ends-free-access')).toBeInTheDocument();
    expect(screen.queryByTestId('plan-compare-lock-icon')).not.toBeInTheDocument();
  }, SLOW);

  it('AC-UM5: founding_partner, open-ended: "Compare our plans", no button anywhere', async () => {
    show([await payloadFor({ planId: FOUNDING_PARTNER })], { kind: 'founding_partner' });
    await screen.findByTestId('plan-compare-table');
    expect(screen.getByTestId('plan-compare-title')).toHaveTextContent(COPY['upgrade_modal.headline.compare']);
    expect(screen.queryAllByTestId(/^plan-compare-action-/)).toHaveLength(0);
  }, SLOW);

  it.each([
    [{ kind: 'settings' }],
    [{ kind: 'founding_partner' }],
    [{ kind: 'locked_feature', planId: TOP }],
    [{ kind: 'locked_feature', planId: LOWER }],
  ] as Array<[UpgradeModalContext]>)('no dead button under %j: a button exactly where the server offers (header + footer)', async (context) => {
    for (const payload of [await payloadFor({ planId: TRIAL }), await payloadFor({ billingRow: payingRow(LOWER) }), await payloadFor({ planId: FOUNDING_PARTNER })]) {
      const view = show([payload], context);
      await screen.findByTestId('plan-compare-table');
      const offered = upgradeModalView(payload).columns.filter((entry) => BUTTON_ACTIONS.includes(entry.action)).length;
      const buttons = screen.queryAllByTestId(/^plan-compare-action-/);
      expect(buttons).toHaveLength(offered * 2);
      for (const button of buttons) expect(button).toBeEnabled();
      view.unmount();
    }
  }, 60_000);

  it.each(['he', 'es'] as const)('%s: the variant copy from the dictionary%s', async (language) => {
    mockLang.language = language;
    const payload = await payloadFor({ billingRow: payingRow(LOWER), language });
    show([payload], { kind: 'locked_feature', planId: TOP });
    await screen.findByTestId('plan-compare-table');
    expect(modal()).toHaveAttribute('dir', language === 'he' ? 'rtl' : 'ltr');
    expect(screen.getByTestId('plan-compare-title')).toHaveTextContent(fill(translations[language]['upgrade_modal.headline.locked_feature'], { plan: nameOf(payload, TOP) }));
    expect(screen.getByTestId('plan-compare-badge-locked_feature')).toHaveTextContent(translations[language]['upgrade_modal.badge.needed']);
  }, SLOW);
});
