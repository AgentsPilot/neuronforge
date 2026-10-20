/**
 * @jest-environment jsdom
 *
 * The open contract (upgrade modal UM-2, workplan §4, §11.2): the real
 * `UpgradeModalProvider`, the real PERF-1 loader (`LazyUpgradeModal`), the real
 * `StandaloneUpgradeModal` and REAL payloads. The route is faked at `fetch`.
 *
 * What is pinned:
 *   - nothing is read at page load; one `my-plan` GET per open (StrictMode too);
 *   - a reopen reads fresh and carries nothing over;
 *   - UM-SA2: refused (one debug line, nothing portals, no GET) while the
 *     Settings `PlanSection` is mounted; works again once it unmounts;
 *   - the throwing hook, the flag hook and its closing grace;
 *   - a second open while open is ignored (SA Q-5);
 *   - focus returns to the caller's button (D-1, trigger-less);
 *   - the type contract: only the three-member union compiles.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
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
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn() }) }));
jest.mock('@/lib/client/stripeJs', () => ({ getStripePromise: () => Promise.resolve({ handleNextAction: jest.fn() }) }));
jest.mock('@stripe/react-stripe-js', () => ({
  EmbeddedCheckoutProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="fake-provider">{children}</div>,
  EmbeddedCheckout: () => <div data-testid="fake-checkout" />,
}));

import { PlanSection } from '@/components/business-os/settings/PlanSection';
import type { PlanPayload } from '@/components/business-os/settings/planPayloadTypes';
import type { UpgradeModalContext } from '@/components/business-os/settings/upgradeModalContext';
import {
  UpgradeModalProvider,
  useUpgradeModal,
  useUpgradeModalOpen,
} from '@/components/business-os/settings/UpgradeModalProvider';

import { LOWER, TOP, TRIAL, payingRow, payloadFor } from './upgradeModalPayloads';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};
const COPY = translations.en;
const SLOW = 20_000;

const server: { plans: PlanPayload[]; reads: number } = { plans: [], reads: 0 };

beforeEach(() => {
  mockLang.language = 'en';
  Object.values(mockLog).forEach((fn) => fn.mockReset());
  server.plans = [];
  server.reads = 0;
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return new Promise<Response>(() => {});
    expect(url).toBe('/api/business-os/entitlements/my-plan');
    const plan = server.plans[Math.min(server.reads, server.plans.length - 1)];
    server.reads += 1;
    return { ok: true, status: 200, json: async () => ({ success: true, data: plan }) } as Response;
  }) as unknown as typeof fetch;
});

/** A page that calls the contract, as a future locked action would. */
function Caller({ context = { kind: 'settings' } }: { context?: UpgradeModalContext }) {
  const { openUpgradeModal, isUpgradeModalOpen } = useUpgradeModal();
  return (
    <>
      <button type="button" data-testid="caller" onClick={() => openUpgradeModal(context)}>
        Upgrade
      </button>
      <span data-testid="caller-open">{String(isUpgradeModalOpen)}</span>
    </>
  );
}

/** Lets a test open a second context while the window is open (SA Q-5). */
let openFromTest: (context: UpgradeModalContext) => void = () => undefined;
function Grab() {
  openFromTest = useUpgradeModal().openUpgradeModal;
  return null;
}

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
const modal = () => screen.findByTestId('plan-compare-modal');
const modalGone = () => waitFor(() => expect(screen.queryByTestId('plan-compare-modal')).not.toBeInTheDocument());
const tableShown = () => screen.findByTestId('plan-compare-table');

describe('the open contract (UM-SA5, UM-SA8)', () => {
  it('no read at page load: the provider mounted and closed sends no my-plan GET (only the chunk warms)', async () => {
    server.plans = [await payloadFor({ planId: TRIAL })];
    render(
      <UpgradeModalProvider>
        <Caller />
      </UpgradeModalProvider>
    );
    await flush();
    expect(server.reads).toBe(0);
    expect(screen.queryByTestId('plan-compare-modal')).not.toBeInTheDocument();
  }, SLOW);

  it.each([false, true])('open (StrictMode %s): the window shows, with exactly ONE my-plan GET', async (strict) => {
    server.plans = [await payloadFor({ planId: TRIAL })];
    const tree = (
      <UpgradeModalProvider>
        <Caller />
      </UpgradeModalProvider>
    );
    render(strict ? <React.StrictMode>{tree}</React.StrictMode> : tree);
    await userEvent.click(screen.getByTestId('caller'));
    await modal();
    await tableShown();
    await flush();
    expect(server.reads).toBe(1);
  }, SLOW);

  it('reopen: one fresh GET per open (two in all), nothing carried over', async () => {
    server.plans = [await payloadFor({ planId: TRIAL })];
    render(
      <UpgradeModalProvider>
        <Caller />
      </UpgradeModalProvider>
    );
    await userEvent.click(screen.getByTestId('caller'));
    await tableShown();
    // Into a flow, then close: the next open starts on the table again.
    await userEvent.click(screen.getByTestId(`plan-compare-action-${LOWER}-header`));
    await screen.findByTestId('plan-compare-flow');
    fireEvent.keyDown(await modal(), { key: 'Escape' });
    await modalGone();
    await userEvent.click(screen.getByTestId('caller'));
    await tableShown();
    expect(screen.queryByTestId('plan-compare-flow')).not.toBeInTheDocument();
    expect(server.reads).toBe(2);
  }, SLOW);

  it('SA Q-5: a second open while open is ignored (the context does not change, no second GET)', async () => {
    const payload = await payloadFor({ billingRow: payingRow(LOWER) });
    server.plans = [payload];
    render(
      <UpgradeModalProvider>
        <Caller />
        <Grab />
      </UpgradeModalProvider>
    );
    await userEvent.click(screen.getByTestId('caller'));
    await tableShown();
    const before = screen.getByTestId('plan-compare-title').textContent;
    act(() => openFromTest({ kind: 'locked_feature', planId: TOP }));
    await flush();
    expect(screen.getByTestId('plan-compare-title').textContent).toBe(before);
    expect(screen.queryByTestId('plan-compare-lock-icon')).not.toBeInTheDocument();
    expect(server.reads).toBe(1);
  }, SLOW);

  it('D-1: closing returns focus to the caller\'s button (no Dialog.Trigger)', async () => {
    server.plans = [await payloadFor({ planId: TRIAL })];
    render(
      <UpgradeModalProvider>
        <Caller />
      </UpgradeModalProvider>
    );
    await userEvent.click(screen.getByTestId('caller'));
    const window = await modal();
    await tableShown();
    // UM-3 §5.5: the window opened from anywhere reads "Close" in its footer (was "Back to your plan").
    await userEvent.click(within(within(window).getByTestId('plan-compare-footer')).getByRole('button', { name: COPY['upgrade_modal.close'] }));
    await modalGone();
    await waitFor(() => expect(screen.getByTestId('caller')).toHaveFocus());
  }, SLOW);
});

describe('never over the Settings drawer (UM-SA2)', () => {
  it('while PlanSection is mounted: refused, one debug line, nothing portals, no GET from the provider; after it unmounts, the next open works', async () => {
    server.plans = [await payloadFor({ planId: TRIAL })];
    const view = render(
      <UpgradeModalProvider>
        <Caller context={{ kind: 'founding_partner' }} />
        <PlanSection />
      </UpgradeModalProvider>
    );
    await waitFor(() => expect(screen.getByTestId('plan-compare-open')).toBeInTheDocument());
    const readsWithDrawer = server.reads;
    await userEvent.click(screen.getByTestId('caller'));
    await flush();
    expect(screen.queryByTestId('plan-compare-modal')).not.toBeInTheDocument();
    expect(server.reads).toBe(readsWithDrawer);
    expect(mockLog.debug).toHaveBeenCalledWith({ contextKind: 'founding_partner' }, 'Upgrade modal open refused: the Settings plan drawer hosts its own');
    expect(screen.getByTestId('caller-open')).toHaveTextContent('false');

    view.rerender(
      <UpgradeModalProvider>
        <Caller context={{ kind: 'founding_partner' }} />
      </UpgradeModalProvider>
    );
    await userEvent.click(screen.getByTestId('caller'));
    await tableShown();
    expect(server.reads).toBe(readsWithDrawer + 1);
  }, SLOW);
});

describe('the hooks', () => {
  it('useUpgradeModal throws outside the provider; useUpgradeModalOpen is false there', () => {
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useUpgradeModal())).toThrow('useUpgradeModal must be used inside <UpgradeModalProvider>');
    quiet.mockRestore();
    expect(renderHook(() => useUpgradeModalOpen()).result.current).toBe(false);
  });

  it('SA Q-6: the flag is true while open and for the closing grace after, then false', async () => {
    server.plans = [await payloadFor({ planId: TRIAL })];
    render(
      <UpgradeModalProvider>
        <Caller />
      </UpgradeModalProvider>
    );
    expect(screen.getByTestId('caller-open')).toHaveTextContent('false');
    await userEvent.click(screen.getByTestId('caller'));
    await tableShown();
    expect(screen.getByTestId('caller-open')).toHaveTextContent('true');
    fireEvent.keyDown(await modal(), { key: 'Escape' });
    await modalGone();
    // Still true straight after the close (the closing click is in flight)…
    expect(screen.getByTestId('caller-open')).toHaveTextContent('true');
    // …and false once the grace has passed.
    await waitFor(() => expect(screen.getByTestId('caller-open')).toHaveTextContent('false'), { timeout: 2000 });
  }, SLOW);
});

/*
 * C-4 / UM-SA5, checked by the compiler (ts-jest type-checks this file): a
 * caller can pass the three-member union and nothing else. Never called.
 */
export function typeContract(open: (context: UpgradeModalContext) => void) {
  open({ kind: 'settings' });
  open({ kind: 'founding_partner' });
  open({ kind: 'locked_feature', planId: 'from-a-refusal' });
  // @ts-expect-error a name is not part of the contract
  open({ kind: 'locked_feature', planId: 'x', name: 'Plan' });
  // @ts-expect-error a price is not part of the contract
  open({ kind: 'settings', price: 10 });
  // @ts-expect-error an offer is not part of the contract
  open({ kind: 'founding_partner', offer: [] });
  // @ts-expect-error a callback is not part of the contract
  open({ kind: 'settings', onDone: () => undefined });
  // @ts-expect-error no other kind
  open({ kind: 'other' });
  // @ts-expect-error locked_feature needs its planId
  open({ kind: 'locked_feature' });
}
