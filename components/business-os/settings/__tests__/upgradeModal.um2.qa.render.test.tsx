/**
 * @jest-environment jsdom
 *
 * QA additions for upgrade modal UM-2 (workplan QA Testing Report). Gaps left by
 * the Dev suites, all through the REAL provider, the REAL PERF-1 loader, the
 * REAL standalone window and REAL payloads (routes faked at `fetch`):
 *
 *   - the demo page itself: `notFound()` while the switch is off (behaviour, not
 *     source text), the client child once it is on;
 *   - the demo client inside the provider: ONE read on mount (StrictMode too),
 *     the picker filled from the payload, each button opens the real window
 *     with its context, and each open adds exactly one read;
 *   - keyboard: Enter opens, Escape closes, focus returns to the caller;
 *   - a failed read, closed with Escape, then a reopen that reads fresh and shows
 *     the table; a slow read closed before it answers leaves nothing behind;
 *   - locked_feature with an id not in the table / the current plan falls back
 *     to the settings copy (no lock, no "Needed for this");
 *   - Hebrew founding_partner (with an end date): RTL, the Hebrew headline.
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
const mockNotFound = jest.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn() }), notFound: () => mockNotFound() }));
jest.mock('@/lib/client/stripeJs', () => ({ getStripePromise: () => Promise.resolve({ handleNextAction: jest.fn() }) }));
jest.mock('@stripe/react-stripe-js', () => ({
  EmbeddedCheckoutProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="fake-provider">{children}</div>,
  EmbeddedCheckout: () => <div data-testid="fake-checkout" />,
}));

import UpgradeModalDemoPage from '@/app/business-os/upgrade-modal-demo/page';
import { UpgradeModalDemo } from '@/app/business-os/upgrade-modal-demo/UpgradeModalDemo';
import type { PlanPayload } from '@/components/business-os/settings/planPayloadTypes';
import type { UpgradeModalContext } from '@/components/business-os/settings/upgradeModalContext';
import { UpgradeModalProvider, useUpgradeModal } from '@/components/business-os/settings/UpgradeModalProvider';

import { FOUNDING_PARTNER, LOWER, TOP, TRIAL, inSixtyDays, payingRow, payloadFor } from './upgradeModalPayloads';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};
const COPY = translations.en;
const SLOW = 30_000;
const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (slot, name: string) => values[name] ?? slot);
const nameOf = (payload: PlanPayload, planId: string) => payload.plans!.find((choice) => choice.planId === planId)!.name;

/** my-plan answers in order (the last repeats); 'throw' is a network failure; 'hold' never answers. */
const server: { plans: Array<PlanPayload | 'throw' | 'hold'>; reads: number } = { plans: [], reads: 0 };
const ENV = 'BUSINESS_OS_UPGRADE_MODAL_DEMO_ENABLED';
const savedEnv = process.env[ENV];

beforeEach(() => {
  mockLang.language = 'en';
  Object.values(mockLog).forEach((fn) => fn.mockReset());
  mockNotFound.mockClear();
  server.plans = [];
  server.reads = 0;
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return new Promise<Response>(() => {});
    expect(url).toBe('/api/business-os/entitlements/my-plan');
    const next = server.plans[Math.min(server.reads, server.plans.length - 1)];
    server.reads += 1;
    if (next === 'throw') throw new Error('network down');
    if (next === 'hold') return new Promise<Response>(() => {});
    return { ok: true, status: 200, json: async () => ({ success: true, data: next }) } as Response;
  }) as unknown as typeof fetch;
});
afterAll(() => {
  if (savedEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = savedEnv;
});

const modal = () => screen.findByTestId('plan-compare-modal');
const modalGone = () => waitFor(() => expect(screen.queryByTestId('plan-compare-modal')).not.toBeInTheDocument());
const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 20)));

function Caller({ context = { kind: 'settings' } }: { context?: UpgradeModalContext }) {
  const { openUpgradeModal } = useUpgradeModal();
  return (
    <button type="button" data-testid="caller" onClick={() => openUpgradeModal(context)}>
      Upgrade
    </button>
  );
}

describe('the demo page (X-1 / X-2, behaviour)', () => {
  it.each([undefined, '', 'false', 'off'])('switch %p: the page answers notFound() and renders nothing', (value) => {
    if (value === undefined) delete process.env[ENV];
    else process.env[ENV] = value;
    expect(() => UpgradeModalDemoPage()).toThrow('NEXT_NOT_FOUND');
    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });

  it('switch on: the page renders the client demo (control)', () => {
    process.env[ENV] = 'true';
    const element = UpgradeModalDemoPage() as React.ReactElement;
    expect(mockNotFound).not.toHaveBeenCalled();
    expect(element.type).toBe(UpgradeModalDemo);
  });
});

describe('the demo client inside the real provider', () => {
  it.each([false, true])('StrictMode %s: ONE read on mount, the picker from the payload, each open adds one read with its context', async (strict) => {
    const payload = await payloadFor({ billingRow: payingRow(LOWER) });
    server.plans = [payload];
    const tree = (
      <UpgradeModalProvider>
        <UpgradeModalDemo />
      </UpgradeModalProvider>
    );
    render(strict ? <React.StrictMode>{tree}</React.StrictMode> : tree);
    await waitFor(() => expect(screen.getByTestId('upgrade-modal-demo-offer')).toHaveTextContent('Offered as an upgrade'));
    await flush();
    expect(server.reads).toBe(1);

    const picker = screen.getByTestId('upgrade-modal-demo-plan') as HTMLSelectElement;
    expect(Array.from(picker.options).map((option) => option.value)).toEqual(payload.plans!.map((choice) => choice.planId));
    expect(picker.value).toBe(TOP);

    await userEvent.click(screen.getByTestId('upgrade-modal-demo-locked'));
    const window = await modal();
    await within(window).findByTestId('plan-compare-table');
    expect(within(window).getByTestId('plan-compare-title')).toHaveTextContent(fill(COPY['upgrade_modal.headline.locked_feature'], { plan: nameOf(payload, TOP) }));
    expect(server.reads).toBe(2);

    fireEvent.keyDown(window, { key: 'Escape' });
    await modalGone();
    await userEvent.click(screen.getByTestId('upgrade-modal-demo-settings'));
    await within(await modal()).findByTestId('plan-compare-table');
    expect(screen.queryByTestId('plan-compare-lock-icon')).not.toBeInTheDocument();
    expect(server.reads).toBe(3);
  }, 60_000);

  it('a failed demo read: says so, the locked button stays disabled (no typed plan id)', async () => {
    server.plans = ['throw'];
    render(
      <UpgradeModalProvider>
        <UpgradeModalDemo />
      </UpgradeModalProvider>
    );
    await waitFor(() => expect(screen.getByTestId('upgrade-modal-demo-offer')).toHaveTextContent('Could not read'));
    expect(screen.getByTestId('upgrade-modal-demo-locked')).toBeDisabled();
    expect(mockLog.warn).toHaveBeenCalledWith({ err: expect.any(Error) }, 'Upgrade modal demo could not read the plan');
  });
});

describe('keyboard, close and reopen through the provider', () => {
  it('Enter opens, Escape closes, focus returns to the caller', async () => {
    server.plans = [await payloadFor({ planId: TRIAL })];
    render(
      <UpgradeModalProvider>
        <Caller />
      </UpgradeModalProvider>
    );
    screen.getByTestId('caller').focus();
    await userEvent.keyboard('{Enter}');
    const window = await modal();
    await within(window).findByTestId('plan-compare-table');
    // Focus is inside the window (on its title, UM-1b), not left on the page.
    await waitFor(() => expect(window.contains(document.activeElement)).toBe(true));
    await userEvent.keyboard('{Escape}');
    await modalGone();
    await waitFor(() => expect(screen.getByTestId('caller')).toHaveFocus());
  }, SLOW);

  it('a failed read, closed with Escape; the reopen reads fresh and shows the table', async () => {
    server.plans = ['throw', await payloadFor({ planId: TRIAL })];
    render(
      <UpgradeModalProvider>
        <Caller />
      </UpgradeModalProvider>
    );
    await userEvent.click(screen.getByTestId('caller'));
    const first = await modal();
    expect(await within(first).findByTestId('plan-compare-problem')).toHaveTextContent(COPY['plan.problem.unavailable']);
    fireEvent.keyDown(first, { key: 'Escape' });
    await modalGone();
    await userEvent.click(screen.getByTestId('caller'));
    const second = await modal();
    await within(second).findByTestId('plan-compare-table');
    expect(within(second).queryByTestId('plan-compare-problem')).not.toBeInTheDocument();
    expect(server.reads).toBe(2);
  }, SLOW);

  it('closed while still loading: nothing left behind; the reopen reads once more', async () => {
    server.plans = ['hold', await payloadFor({ planId: TRIAL })];
    render(
      <UpgradeModalProvider>
        <Caller />
      </UpgradeModalProvider>
    );
    await userEvent.click(screen.getByTestId('caller'));
    const first = await modal();
    await within(first).findByTestId('plan-compare-loading');
    fireEvent.keyDown(first, { key: 'Escape' });
    await modalGone();
    await userEvent.click(screen.getByTestId('caller'));
    await within(await modal()).findByTestId('plan-compare-table');
    expect(server.reads).toBe(2);
  }, SLOW);
});

describe('context fallbacks and Hebrew through the provider', () => {
  it.each([
    ['an id the table does not have', 'no-such-plan'],
    ['the plan the owner is already on', 'CURRENT'],
  ])('locked_feature with %s: the settings copy, no lock, no "Needed for this"', async (_label, planId) => {
    const payload = await payloadFor({ billingRow: payingRow(LOWER) });
    server.plans = [payload];
    render(
      <UpgradeModalProvider>
        <Caller context={{ kind: 'locked_feature', planId: planId === 'CURRENT' ? LOWER : planId }} />
      </UpgradeModalProvider>
    );
    await userEvent.click(screen.getByTestId('caller'));
    const window = await modal();
    await within(window).findByTestId('plan-compare-table');
    expect(within(window).queryByTestId('plan-compare-lock-icon')).not.toBeInTheDocument();
    expect(within(window).queryByTestId('plan-compare-badge-locked_feature')).not.toBeInTheDocument();
    expect(within(window).queryByTestId('plan-compare-locked-not-offered')).not.toBeInTheDocument();
    expect(within(window).getByTestId('plan-compare-title')).not.toHaveTextContent(fill(COPY['upgrade_modal.headline.locked_feature'], { plan: '' }).trim());
  }, SLOW);

  it('Hebrew founding_partner with an end date: RTL, the Hebrew headline, Choose buttons', async () => {
    mockLang.language = 'he';
    server.plans = [await payloadFor({ planId: FOUNDING_PARTNER, cohortExpiresAt: inSixtyDays(), language: 'he' })];
    render(
      <UpgradeModalProvider>
        <Caller context={{ kind: 'founding_partner' }} />
      </UpgradeModalProvider>
    );
    await userEvent.click(screen.getByTestId('caller'));
    const window = await modal();
    await within(window).findByTestId('plan-compare-table');
    expect(window).toHaveAttribute('dir', 'rtl');
    expect(within(window).getByTestId('plan-compare-title')).toHaveTextContent(translations.he['upgrade_modal.headline.founding_partner']);
    expect(within(window).queryAllByTestId(/^plan-compare-action-/).length).toBeGreaterThan(0);
  }, SLOW);
});
