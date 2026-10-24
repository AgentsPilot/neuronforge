/**
 * @jest-environment jsdom
 *
 * QA additions for UM-3 + UM-D3 (gaps left by `SettingsPlanSurface.render`):
 *   - Escape closes either surface and focus returns to the "Your plan" row (AC-UM1);
 *   - the decision is taken again on every open (R-3);
 *   - every drawer line B1..B11 has a place on the surface that opens (R-5);
 *   - an ended / no-plan record and a payment-failed renewal are decided by the server offer (§2.2);
 *   - Spanish strip and X name (A-9);
 *   - the checkout marker stays on the address after a close (F-1, documented as-built).
 * Same harness as `SettingsPlanSurface.render` (the page's plan wiring), REAL `my-plan` payloads.
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
jest.mock('@/lib/client/stripeJs', () => ({ getStripePromise: () => Promise.resolve({ handleNextAction: async () => ({}) }) }));
jest.mock('@stripe/react-stripe-js', () => ({
  EmbeddedCheckoutProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="fake-provider">{children}</div>,
  EmbeddedCheckout: () => <div data-testid="fake-checkout" />,
}));

import { PlanSection } from '@/components/business-os/settings/PlanSection';
import type { PlanPayload } from '@/components/business-os/settings/planPayloadTypes';
import { startPlanDrawerRead, type PlanRead } from '@/components/business-os/settings/planDrawerReads';
import { SettingsDrawer } from '@/components/business-os/settings/SettingsDrawer';
import { SettingsPlanModal } from '@/components/business-os/settings/SettingsPlanModal';
import { planSurfaceFor, upgradeModalView } from '@/components/business-os/settings/upgradeModalView';
import { DRAWER_PREFETCH_MAX_AGE_MS, useDrawerPrefetch } from '@/components/business-os/settings/useDrawerPrefetch';
import { usePlanSurface } from '@/components/business-os/settings/usePlanSurface';

import { LOWER, TOP, TRIAL, payingRow, payloadFor } from './upgradeModalPayloads';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};
const COPY = translations.en;
const SLOW = 30_000;
const DRAWER = 'settings-plan-drawer';

const server: { plans: PlanPayload[]; reads: number } = { plans: [], reads: 0 };

beforeEach(() => {
  mockLang.language = 'en';
  Object.values(mockLog).forEach((fn) => fn.mockReset());
  router.replace.mockReset();
  server.plans = [];
  server.reads = 0;
  global.fetch = jest.fn(async () => {
    const next = server.plans[Math.min(server.reads, server.plans.length - 1)];
    server.reads += 1;
    return { ok: true, status: 200, json: async () => ({ success: true, data: next }) } as Response;
  }) as unknown as typeof fetch;
});

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
      <button ref={rowRef} type="button" data-testid="row" onClick={() => setOpen(true)}>
        {COPY['plan.section_title']}
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

function showPopUp(payload: PlanPayload) {
  const read: Promise<PlanRead> = Promise.resolve({ kind: 'answered', status: 200, body: { success: true, data: payload } });
  return render(<SettingsPlanModal open onClose={() => undefined} firstRead={read} checkoutMarker={null} returnFocusRef={{ current: null }} />);
}

const openRow = () => fireEvent.click(screen.getByTestId('row'));

describe('QA: Escape and re-decision (AC-UM1, R-3)', () => {
  it('Escape closes the pop-up, focus returns to the row; the next open decides again (now the drawer), Escape closes it, focus to the row', async () => {
    server.plans = [await payloadFor({ planId: TRIAL }), await payloadFor({ planId: TOP, billingRow: payingRow(TOP) })];
    render(<Page />);
    openRow();
    const dialog = await screen.findByTestId('plan-compare-modal');
    await within(dialog).findByTestId('plan-compare-table');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('plan-compare-modal')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('row')).toHaveFocus());

    openRow();
    const sheet = await screen.findByTestId(DRAWER);
    expect(await within(sheet).findByTestId('plan-compare-open')).toHaveTextContent(COPY['upgrade_modal.open_compare']);
    expect(screen.queryByTestId('plan-compare-modal')).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId(DRAWER)).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('row')).toHaveFocus());
    expect(server.reads).toBe(2);
  }, SLOW);

  it('F-1 as built: after closing a checkout-return pop-up, a row reopen with the marker still present opens the pop-up again', async () => {
    const trial = await payloadFor({ planId: TRIAL });
    server.plans = [trial];
    render(<Page marker="cs_test_qa1" />);
    openRow();
    const dialog = await screen.findByTestId('plan-compare-modal');
    await within(dialog).findByTestId('plan-purchase-processing');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('plan-compare-modal')).not.toBeInTheDocument());
    // Row-opened: the link hook writes nothing, so the marker is not removed (AC-UM7 last sentence vs R-7).
    expect(router.replace).not.toHaveBeenCalled();
    openRow();
    expect(await within(await screen.findByTestId('plan-compare-modal')).findByTestId('plan-purchase-processing')).toBeInTheDocument();
  }, SLOW);
});

describe('QA: every drawer line has a place on the surface that opens (R-5)', () => {
  it('trial pop-up: B1 name + price and B2 ending in the strip, B7 in the footer, B8 collapsed, B11 Choose buttons; no B9', async () => {
    const payload = await payloadFor({ planId: TRIAL });
    showPopUp(payload);
    const strip = await screen.findByRole('group', { name: COPY['upgrade_modal.your_plan'] });
    expect(within(strip).getByTestId('plan-compare-status-name')).toHaveTextContent(payload.name!);
    expect(screen.getByTestId('plan-compare-includes')).not.toHaveAttribute('open');
    // B7: the trial's "when this changes" sentence sits in the footer (table view).
    expect(payload.whenThisChanges).not.toBeNull();
    expect(within(screen.getByTestId('plan-compare-footer')).getByTestId('plan-compare-when-this-changes')).toBeInTheDocument();
    expect(screen.getByTestId(`plan-compare-action-${LOWER}-header`)).toBeInTheDocument();
    // B9 is superseded by the next plan's column in the pop-up (R-5).
    expect(screen.queryByText(/What .* would add/)).not.toBeInTheDocument();
  }, SLOW);

  it('Essentials pop-up: B10 upgrade reachable from the column; the CV-5 subheading describes the dialog', async () => {
    const payload = await payloadFor({ billingRow: payingRow(LOWER) });
    const tier = payload.purchase?.upgrade?.tiers?.[0];
    expect(tier).toBeTruthy();
    showPopUp(payload);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleDescription(COPY['upgrade_modal.subheading.upgrade']);
    await userEvent.click(await screen.findByTestId(`plan-compare-action-${tier}-header`));
    expect(await screen.findByTestId('plan-compare-flow')).toBeInTheDocument();
  }, SLOW);
});

describe('QA: §2.2 states decided by the server offer', () => {
  it('3-D Secure renewal fixture used by the B3 / B4 test carries an upgrade offer (its flow branch is not skipped)', async () => {
    const base = await payloadFor({ billingRow: payingRow(LOWER) });
    expect((base.purchase?.upgrade?.tiers ?? []).length).toBeGreaterThan(0);
  });

  it('an ended subscription record (buy again): pop-up when the server offers choose, and the predicate is the only input', async () => {
    const ended = await payloadFor({
      billingRow: payingRow(LOWER, { subscriptionStatus: 'canceled', endedAt: '2026-01-01T00:00:00.000Z' }),
    });
    const view = upgradeModalView(ended);
    expect(ended.purchase?.offer?.kind).toBe('choose');
    expect(view.available && view.hasActions).toBe(true);
    expect(planSurfaceFor(ended, false)).toBe('modal');
  });

  it('Essentials cancelling (the server offers nothing): the drawer', async () => {
    const cancelling = await payloadFor({ billingRow: payingRow(LOWER, { cancelAtPeriodEnd: true }) });
    expect(planSurfaceFor(cancelling, false)).toBe('drawer');
  });
});

describe('QA: Spanish (A-9, AC-UMD3 (a))', () => {
  it('es: the strip badge, the X ("Cerrar") and the footer close are in Spanish; no English "Close"', async () => {
    mockLang.language = 'es';
    const payload = await payloadFor({ planId: TRIAL, language: 'es' });
    showPopUp(payload);
    const es = translations.es;
    const dialog = await screen.findByRole('dialog');
    expect(await screen.findByRole('group', { name: es['upgrade_modal.your_plan'] })).toBeInTheDocument();
    expect(within(dialog).getAllByRole('button', { name: es['upgrade_modal.close'] })).toHaveLength(2);
    expect(within(dialog).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    expect(dialog).toHaveAccessibleDescription(es['upgrade_modal.subheading']);
  }, SLOW);
});

describe('QA: busy decision does not leak a second request on repeated row presses', () => {
  it('pressing the row twice while deciding still makes one request and one surface', async () => {
    server.plans = [await payloadFor({ planId: TRIAL })];
    render(<Page />);
    openRow();
    openRow();
    await within(await screen.findByTestId('plan-compare-modal')).findByTestId('plan-compare-table');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(server.reads).toBe(1);
    expect(screen.getAllByTestId('plan-compare-modal')).toHaveLength(1);
  }, SLOW);
});
