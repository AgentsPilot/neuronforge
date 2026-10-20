/**
 * @jest-environment jsdom
 *
 * "Your plan" opens the pop-up or the drawer (upgrade modal UM-D3; SA R-1 to
 * R-12; conditions D3-3 to D3-11; AC-UM1, AC-UM7, AC-UMD3 (a)–(e)).
 *
 * A small harness plays the settings page exactly as it wires the plan surface
 * (pinned to that form by `planPrefetch.guard` P-G3 and `settingsDeepLinks.guard`):
 * the page's warm read, ONE open state, `usePlanSurface` deciding the surface,
 * the real `SettingsDrawer` + `PlanSection`, and the real `SettingsPlanModal`.
 * REAL `my-plan` payloads; routes faked at `fetch`, Stripe at its modules.
 */

import '@testing-library/jest-dom';
import React, { useRef, useState } from 'react';
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
jest.mock('@/lib/logger', () => ({ ...jest.requireActual('@/lib/logger'), createLogger: () => ({ ...mockLog, child: () => mockLog }) }));
jest.mock('@/lib/supabaseClient', () => ({ supabase: {} }));
const router = { replace: jest.fn() };
jest.mock('next/navigation', () => ({ useRouter: () => router }));
const stripe: { completes: Array<() => void> } = { completes: [] };
jest.mock('@/lib/client/stripeJs', () => ({ getStripePromise: () => Promise.resolve({ handleNextAction: async () => ({}) }) }));
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
import { startPlanDrawerRead, type PlanRead } from '@/components/business-os/settings/planDrawerReads';
import { SettingsDrawer } from '@/components/business-os/settings/SettingsDrawer';
import { SettingsPlanModal } from '@/components/business-os/settings/SettingsPlanModal';
import { UpgradeModalProvider, useUpgradeModal } from '@/components/business-os/settings/UpgradeModalProvider';
import { DRAWER_PREFETCH_MAX_AGE_MS, useDrawerPrefetch } from '@/components/business-os/settings/useDrawerPrefetch';
import { PLAN_SURFACE_DECISION_BUDGET_MS, usePlanSurface } from '@/components/business-os/settings/usePlanSurface';

import { FOUNDING_PARTNER, LOWER, TOP, TRIAL, inSixtyDays, payingRow, payloadFor } from './upgradeModalPayloads';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};
const COPY = translations.en;
const SLOW = 30_000;
const DRAWER = 'settings-plan-drawer';
const SESSION = 'cs_test_settings1';
const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (slot, name: string) => values[name] ?? slot);

const CHECKOUT = { success: true, data: { clientSecret: 'cs_test_secret_x', sessionId: SESSION, expiresAt: '2026-10-13T10:31:00.000Z', tier: 'x' } };

/** my-plan answers in order (the last repeats); 'throw' is a network failure; 'hold' answers only when released. */
const server: { plans: Array<PlanPayload | 'throw' | 'hold'>; reads: number; release: Array<() => void> } = { plans: [], reads: 0, release: [] };
let held: PlanPayload | null = null;

beforeEach(() => {
  mockLang.language = 'en';
  Object.values(mockLog).forEach((fn) => fn.mockReset());
  router.replace.mockReset();
  stripe.completes = [];
  server.plans = [];
  server.reads = 0;
  server.release = [];
  held = null;
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return { ok: true, status: 200, json: async () => CHECKOUT } as Response;
    const next = server.plans[Math.min(server.reads, server.plans.length - 1)];
    server.reads += 1;
    if (next === 'throw') throw new Error('network down');
    if (next === 'hold') {
      return new Promise<Response>((resolve) => {
        server.release.push(() => resolve({ ok: true, status: 200, json: async () => ({ success: true, data: held }) } as Response));
      });
    }
    return { ok: true, status: 200, json: async () => ({ success: true, data: next }) } as Response;
  }) as unknown as typeof fetch;
});
afterEach(() => {
  jest.useRealTimers();
});

/** The settings page's plan wiring, as `page.tsx` has it. */
function Page({ marker = null }: { marker?: string | null }) {
  const [open, setOpen] = useState(false);
  const rowRef = useRef<HTMLButtonElement>(null);
  const planPrefetch = useDrawerPrefetch({
    start: () => startPlanDrawerRead(mockLang.language),
    key: `user-1:${mockLang.language}`,
    enabled: true,
    paused: open,
    maxAgeMs: DRAWER_PREFETCH_MAX_AGE_MS,
    warmOnIdle: false,
  });
  const planSurface = usePlanSurface({ open, checkoutMarker: marker, takePrefetched: planPrefetch.take });
  return (
    <>
      <button type="button" onClick={planPrefetch.warm}>
        Warm
      </button>
      <button ref={rowRef} type="button" data-testid="row" aria-busy={planSurface.surface === 'pending' || undefined} onClick={() => setOpen(true)}>
        {COPY['plan.section_title']}
        {planSurface.surface === 'pending' && <span data-testid="row-pending" />}
      </button>
      <SettingsDrawer
        open={open && planSurface.surface === 'drawer'}
        onOpenChange={setOpen}
        title={COPY['plan.section_title']}
        isRTL={false}
        closeLabel={COPY['common.close']}
        returnFocusRef={rowRef}
        testId={DRAWER}
      >
        <PlanSection checkoutMarker={marker} takePrefetched={planSurface.takeForDrawer} />
      </SettingsDrawer>
      <SettingsPlanModal
        open={open && planSurface.surface === 'modal'}
        onClose={() => setOpen(false)}
        firstRead={planSurface.modalFirstRead}
        checkoutMarker={marker}
        returnFocusRef={rowRef}
      />
    </>
  );
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
const warm = () => fireEvent.click(screen.getByRole('button', { name: 'Warm' }));
const openRow = () => fireEvent.click(screen.getByTestId('row'));
const popUp = () => screen.findByTestId('plan-compare-modal');
const footerClose = () => within(screen.getByTestId('plan-compare-footer')).getByRole('button', { name: COPY['upgrade_modal.close'] });

async function advanceUntil(done: () => boolean, steps = 5) {
  for (let i = 0; i < steps && !done(); i += 1) {
    await act(async () => {
      jest.advanceTimersByTime(PROCESSING_REFRESH_INTERVAL_MS);
    });
  }
}

describe('which surface opens (R-1; AC-UM1)', () => {
  it('offered (Essentials, warm): the pop-up, no drawer; one request; footer "Close"; focus back to the row', async () => {
    server.plans = [await payloadFor({ billingRow: payingRow(LOWER) })];
    render(<Page />);
    warm();
    await settle();
    openRow();
    const dialog = await popUp();
    await within(dialog).findByTestId('plan-compare-table');
    expect(screen.queryByTestId(DRAWER)).not.toBeInTheDocument();
    expect(server.reads).toBe(1);
    expect(dialog).toHaveAccessibleDescription(COPY['upgrade_modal.subheading.upgrade']);
    await userEvent.click(footerClose());
    await waitFor(() => expect(screen.queryByTestId('plan-compare-modal')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('row')).toHaveFocus());
    expect(server.reads).toBe(1);
  }, SLOW);

  it('offered, cold (no warm): the pop-up, still one request (the decider hands its read to the session)', async () => {
    server.plans = [await payloadFor({ planId: TRIAL })];
    render(<Page />);
    openRow();
    await within(await popUp()).findByTestId('plan-compare-table');
    await settle();
    expect(server.reads).toBe(1);
  }, SLOW);

  it.each([
    ['Autopilot (the top plan)', () => payloadFor({ planId: TOP, billingRow: payingRow(TOP) })],
    ['Founding Partner with no end date', () => payloadFor({ planId: FOUNDING_PARTNER })],
  ])('nothing offered (%s): the drawer with "Compare plans"; one request warm and cold', async (_name, make) => {
    const payload = await make();
    for (const warmFirst of [true, false]) {
      server.plans = [payload];
      server.reads = 0;
      const view = render(<Page />);
      if (warmFirst) warm();
      await settle();
      openRow();
      const sheet = await screen.findByTestId(DRAWER);
      expect(await within(sheet).findByTestId('plan-compare-open')).toHaveTextContent(COPY['upgrade_modal.open_compare']);
      expect(screen.queryByTestId('plan-compare-modal')).not.toBeInTheDocument();
      await settle();
      expect({ warmFirst, reads: server.reads }).toEqual({ warmFirst, reads: 1 });
      view.unmount();
    }
  }, SLOW);

  it('a refused state (the server withholds the upgrade): the drawer', async () => {
    const essentials = await payloadFor({ billingRow: payingRow(LOWER) });
    server.plans = [{ ...essentials, purchase: { ...essentials.purchase!, upgrade: null } }];
    render(<Page />);
    openRow();
    await screen.findByTestId(DRAWER);
    expect(screen.queryByTestId('plan-compare-modal')).not.toBeInTheDocument();
  }, SLOW);
});

describe('slow or failed read (R-4; AC-UMD3 (d))', () => {
  it('pending: the row is busy and nothing else renders; after 2 s the drawer opens; the late offer never swaps it', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    held = await payloadFor({ planId: TRIAL });
    server.plans = ['hold'];
    render(<Page />);
    openRow();
    await screen.findByTestId('row-pending');
    expect(screen.getByTestId('row')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(PLAN_SURFACE_DECISION_BUDGET_MS);
    });
    const sheet = await screen.findByTestId(DRAWER);
    expect(screen.queryByTestId('row-pending')).not.toBeInTheDocument();
    expect(mockLog.debug).toHaveBeenCalledWith({ reason: 'timeout' }, 'Plan surface: opening the drawer');

    // The late answer: the drawer (which took the read in flight) shows the plan; no pop-up.
    await act(async () => server.release.forEach((go) => go()));
    expect(await within(sheet).findByTestId('plan-compare-open')).toHaveTextContent(COPY['upgrade_modal.open_see_plans']);
    expect(screen.queryByTestId('plan-compare-modal')).not.toBeInTheDocument();
    expect(server.reads).toBe(1);
  }, SLOW);

  it('a thrown read: the drawer, which reads again fresh; the log carries the reason only', async () => {
    server.plans = ['throw', await payloadFor({ planId: TRIAL })];
    render(<Page />);
    openRow();
    const sheet = await screen.findByTestId(DRAWER);
    await within(sheet).findByTestId('plan-compare-open');
    expect(screen.queryByTestId('plan-compare-modal')).not.toBeInTheDocument();
    expect(server.reads).toBe(2);
    expect(mockLog.debug).toHaveBeenCalledWith({ reason: 'threw' }, 'Plan surface: opening the drawer');
  }, SLOW);

  it('a plan that is not ok: the drawer, with its own problem sentence', async () => {
    const base = await payloadFor({ planId: TRIAL });
    server.plans = [{ ...base, status: 'unavailable', problem: { key: 'plan.problem.unavailable' } }];
    render(<Page />);
    openRow();
    const sheet = await screen.findByTestId(DRAWER);
    expect(await within(sheet).findByText(COPY['plan.problem.unavailable'])).toBeInTheDocument();
    expect(screen.queryByTestId('plan-compare-modal')).not.toBeInTheDocument();
  }, SLOW);
});

describe('checkout (R-7; AC-UM7)', () => {
  it('a return marker opens the pop-up at once, with no warm read; "Payment processing", then "You\'re on" only from the re-read', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    const trial = await payloadFor({ planId: TRIAL });
    const bought = await payloadFor({ billingRow: payingRow(LOWER) });
    server.plans = [trial, trial, bought];
    render(<Page marker={SESSION} />);
    warm();
    await settle();
    expect(server.reads).toBe(1);
    openRow();
    // No pending step: the marker decides at once.
    expect(screen.queryByTestId('row-pending')).not.toBeInTheDocument();
    const dialog = await popUp();
    expect(await within(dialog).findByTestId('plan-purchase-processing')).toHaveTextContent(COPY['plan.purchase.processing']);
    // B-2: the warm read was taken and not used; the session read fresh.
    expect(server.reads).toBe(2);
    expect(screen.queryByTestId('plan-purchase-done')).not.toBeInTheDocument();
    expect(screen.queryByTestId(DRAWER)).not.toBeInTheDocument();

    await advanceUntil(() => screen.queryByTestId('plan-purchase-done') !== null);
    expect(within(dialog).getByTestId('plan-purchase-done')).toHaveTextContent(fill(COPY['plan.purchase.done'], { plan: bought.name! }));
  }, SLOW);

  it('a failed re-read never claims success', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    const trial = await payloadFor({ planId: TRIAL });
    server.plans = [trial, 'throw'];
    render(<Page marker={SESSION} />);
    openRow();
    const dialog = await popUp();
    await within(dialog).findByTestId('plan-purchase-processing');
    await advanceUntil(() => screen.queryByTestId('plan-purchase-slow') !== null, PROCESSING_REFRESH_LIMIT * 3);
    expect(screen.queryByTestId('plan-purchase-done')).not.toBeInTheDocument();
    expect(within(dialog).getByTestId('plan-purchase-slow')).toBeInTheDocument();
  }, SLOW);

  it('a checkout completed inside the pop-up keeps it open and shows "Payment processing" there (afterCheckout stay)', async () => {
    server.plans = [await payloadFor({ planId: TRIAL })];
    render(<Page />);
    openRow();
    const dialog = await popUp();
    await within(dialog).findByTestId('plan-compare-table');
    await userEvent.click(within(dialog).getByTestId(`plan-compare-action-${LOWER}-header`));
    await within(dialog).findByTestId('fake-checkout');
    await waitFor(() => expect(stripe.completes.length).toBeGreaterThan(0));
    act(() => stripe.completes[stripe.completes.length - 1]());
    expect(router.replace).toHaveBeenCalledWith(`/business-os/settings?section=plan&checkout=${SESSION}`, { scroll: false });
    expect(screen.getByTestId('plan-compare-modal')).toBeInTheDocument();
    expect(await within(dialog).findByTestId('plan-purchase-processing')).toBeInTheDocument();
    expect(screen.queryByTestId('fake-checkout')).not.toBeInTheDocument();
    expect(screen.queryByTestId(DRAWER)).not.toBeInTheDocument();
    // Focus is on the status, not lost to <body>.
    await waitFor(() => expect(within(dialog).getByTestId('plan-compare-flow-status')).toHaveFocus());
  }, SLOW);
});

describe('one surface, one checkout (R-3, R-10; AC-UMD3 (e))', () => {
  function Caller() {
    const { openUpgradeModal } = useUpgradeModal();
    return (
      <button type="button" data-testid="caller" onClick={() => openUpgradeModal({ kind: 'settings' })}>
        open
      </button>
    );
  }

  it('while the Settings pop-up is open the layout refuses its own window; the drawer is never mounted with it', async () => {
    server.plans = [await payloadFor({ planId: TRIAL })];
    render(
      <UpgradeModalProvider>
        <Page />
        <Caller />
      </UpgradeModalProvider>
    );
    openRow();
    await within(await popUp()).findByTestId('plan-compare-table');
    fireEvent.click(screen.getByTestId('caller'));
    await settle();
    expect(screen.getAllByTestId('plan-compare-modal')).toHaveLength(1);
    expect(screen.queryByTestId(DRAWER)).not.toBeInTheDocument();
    expect(mockLog.debug).toHaveBeenCalledWith({ contextKind: 'settings' }, 'Upgrade modal open refused: the Settings plan drawer hosts its own');
  }, SLOW);
});

/** The Settings pop-up on its own, with a handed-over read (the strip, D3-5 / D3-6). */
function showPopUp(payload: PlanPayload) {
  const read: Promise<PlanRead> = Promise.resolve({ kind: 'answered', status: 200, body: { success: true, data: payload } });
  const row = { current: null };
  return render(<SettingsPlanModal open onClose={() => undefined} firstRead={read} checkoutMarker={null} returnFocusRef={row} />);
}

describe('the strip marks the current plan for every account (R-5, R-6; AC-UMD3 (a)–(c))', () => {
  it.each([
    ['Test Flight (trial)', () => payloadFor({ planId: TRIAL }), false],
    ['Founding Partner with an end date', () => payloadFor({ planId: FOUNDING_PARTNER, cohortExpiresAt: inSixtyDays() }), false],
    ['Essentials', () => payloadFor({ billingRow: payingRow(LOWER) }), true],
    ['admin-assigned tier', () => payloadFor({ planId: LOWER, buyable: [LOWER] }), true],
  ] as const)('%s: "Your plan" badge + the name first; exactly one column marked (LF-2: the own column for a non-tier)', async (_name, make, tier) => {
    const payload = await make();
    showPopUp(payload);
    const strip = await screen.findByRole('group', { name: COPY['upgrade_modal.your_plan'] });
    expect(within(strip).getByTestId('plan-compare-status-badge')).toHaveTextContent(COPY['upgrade_modal.your_plan']);
    expect(within(strip).getByTestId('plan-compare-status-name')).toHaveTextContent(payload.name!);
    // The badge comes before the name.
    expect(strip.textContent!.indexOf(COPY['upgrade_modal.your_plan'])).toBeLessThan(strip.textContent!.indexOf(payload.name!));
    const table = screen.getByTestId('plan-compare-table');
    // LF-2 (live test 2026-10-20; was `tier ? 1 : 0`): a trial or Founding Partner now sees its own plan
    // as its own first column, so every account has exactly one marked column.
    const marked = within(table).getAllByText(COPY['upgrade_modal.your_plan']);
    expect(marked).toHaveLength(1);
    expect(marked[0].closest('[data-own-plan="true"]') !== null).toBe(!tier);
  }, SLOW);

  it('"What your plan includes" is collapsed by default and lists the drawer\'s own list', async () => {
    const payload = await payloadFor({ planId: TRIAL });
    showPopUp(payload);
    const disclosure = await screen.findByTestId('plan-compare-includes');
    expect(disclosure.tagName).toBe('DETAILS');
    expect(disclosure).not.toHaveAttribute('open');
    expect(within(disclosure).getByText(COPY['plan.includes'])).toBeInTheDocument();
    const list = within(disclosure).getByRole('list', { name: COPY['plan.includes'], hidden: true });
    expect(within(list).getAllByRole('listitem', { hidden: true })).toHaveLength(payload.included.length);
  }, SLOW);

  it('B3 / B4: the failed-renewal line and "Confirm your payment" (new tab) sit in the strip, and stay during a flow', async () => {
    const base = await payloadFor({ billingRow: payingRow(LOWER) });
    const failed: PlanPayload = { ...base, purchase: { ...base.purchase!, billing: { state: 'payment_failed', date: '2099-11-12T22:30:00.000Z', attempts: 2 } } };
    const view = showPopUp(failed);
    const strip = await screen.findByRole('group', { name: COPY['upgrade_modal.your_plan'] });
    expect(within(strip).getByTestId('plan-update-card-email')).toHaveTextContent(COPY['plan.update_card_email']);
    view.unmount();

    const url = 'https://invoice.stripe.com/i/acct_probe/test?s=ap';
    const confirm: PlanPayload = { ...base, purchase: { ...base.purchase!, billing: { state: 'action_required', date: '2099-11-12T22:30:00.000Z', confirmUrl: url } } };
    showPopUp(confirm);
    const again = await screen.findByRole('group', { name: COPY['upgrade_modal.your_plan'] });
    const link = within(again).getByTestId('plan-confirm-payment');
    expect(link).toHaveAttribute('href', url);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    // In a flow: B3 / B4 stay, B8 goes (R-12).
    const upgrade = (confirm.purchase?.upgrade?.tiers ?? [])[0];
    if (upgrade) {
      await userEvent.click(screen.getByTestId(`plan-compare-action-${upgrade}-header`));
      await screen.findByTestId('plan-compare-flow');
      expect(within(again).getByTestId('plan-confirm-payment')).toBeInTheDocument();
      expect(screen.queryByTestId('plan-compare-includes')).not.toBeInTheDocument();
    }
  }, SLOW);

  it('Hebrew: the strip badge, the X and the footer are in Hebrew', async () => {
    mockLang.language = 'he';
    const payload = await payloadFor({ planId: TRIAL, language: 'he' });
    showPopUp(payload);
    const he = translations.he;
    const dialog = await screen.findByRole('dialog');
    expect(await screen.findByRole('group', { name: he['upgrade_modal.your_plan'] })).toBeInTheDocument();
    expect(within(dialog).getAllByRole('button', { name: he['upgrade_modal.close'] })).toHaveLength(2);
    expect(within(dialog).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  }, SLOW);
});
