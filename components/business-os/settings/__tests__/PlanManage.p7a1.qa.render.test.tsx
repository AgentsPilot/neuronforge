/**
 * @jest-environment jsdom
 *
 * QA P-7a.1 (workplan "SA Code Review — P-7a.1", QA focus 2, 4, 5, 6, 7, 8),
 * on the REAL Settings view (`readPlanPurchaseView` through `payloadFor`) and
 * the real `UpgradeModal` / `PlanManage`:
 *
 *   - focus 5: the pop-up's "Your plan" strip shows Cancel / Reactivate only
 *     while no flow is open; the drawer-stacked modal (strip `status`) never
 *     does; an owner with no paid plan sees nothing in either;
 *   - TL decision on SA deviation 6: while cancelling, no upgrade button and
 *     no "Reactivate your plan to upgrade" line;
 *   - focus 6: past_due → contact line, no button; price switch off → nothing;
 *   - focus 4 (UI half): a `cancel_at`-only cancellation that our record does
 *     not mirror keeps offering Cancel (the known C-3 follow-up);
 *   - focus 2: a double press on the Cancel drawer's confirm posts once (D3);
 *   - focus 8: `upgrade_pending` reads its own line in en / he / es;
 *   - focus 7: he / es at 360 px, RTL container: lines render, no
 *     physical-direction classes, buttons wrap.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
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
jest.mock('@/lib/supabaseClient', () => ({ supabase: {} }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn() }) }));
jest.mock('@/lib/client/stripeJs', () => ({ getStripePromise: () => Promise.resolve({ handleNextAction: async () => ({}) }) }));
jest.mock('@/components/business-os/data-export/DownloadMyDataButton', () => ({
  DownloadMyDataButton: () => <div data-testid="download-my-data" />,
}));
jest.mock('@stripe/react-stripe-js', () => ({
  EmbeddedCheckoutProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="fake-provider">{children}</div>,
  EmbeddedCheckout: () => <div data-testid="fake-checkout" />,
}));

import type { PlanPayload } from '@/components/business-os/settings/planPayloadTypes';
import { PlanManage } from '@/components/business-os/settings/PlanManage';
import { UpgradeModal, type UpgradeModalFlow } from '@/components/business-os/settings/UpgradeModal';

import { LOWER, TOP, TRIAL, payingRow, payloadFor } from './upgradeModalPayloads';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};
const SLOW = 30_000;

const fetchMock = jest.fn();
beforeEach(() => {
  mockLang.language = 'en';
  fetchMock.mockReset();
  // An upgrade preview never answers (not under test); the manage routes answer per test.
  fetchMock.mockImplementation((url: string) => (String(url).endsWith('/preview') ? new Promise(() => {}) : Promise.resolve({ ok: true, status: 200, json: async () => ({}) })));
  (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});

const flow = (): UpgradeModalFlow => ({
  checkoutAllowed: true,
  upgradeAllowed: true,
  paymentsConfigured: true,
  onCheckoutComplete: jest.fn(),
  onUpgrading: jest.fn(),
  onUpgradeCheckAgain: jest.fn(async () => undefined),
});

const allBuyable = [LOWER, TOP];

describe('QA focus 5: the Settings pop-up strip vs the drawer-stacked modal', () => {
  it('paying, renewing: the `your_plan` strip shows Cancel; the `status` strip shows no manage controls', async () => {
    const payload = await payloadFor({ billingRow: payingRow(LOWER), buyable: allBuyable });
    expect(payload.purchase?.manage).toEqual({ cancel: true, reactivate: false, paymentFailed: false });

    const strip = render(<UpgradeModal open onOpenChange={() => undefined} flow={flow()} plan={payload} strip="your_plan" />);
    expect(within(screen.getByRole('dialog')).getByTestId('plan-manage-cancel')).toBeInTheDocument();
    strip.unmount();

    render(<UpgradeModal open onOpenChange={() => undefined} flow={flow()} plan={payload} />);
    expect(screen.queryByTestId('plan-manage')).not.toBeInTheDocument();
  }, SLOW);

  it('the `your_plan` strip hides Cancel while an upgrade flow is open, and shows it again after "Back to plans"', async () => {
    const payload = await payloadFor({ billingRow: payingRow(LOWER), buyable: allBuyable });
    expect(payload.purchase?.upgrade?.tiers ?? []).toContain(TOP);
    render(<UpgradeModal open onOpenChange={() => undefined} flow={flow()} plan={payload} strip="your_plan" />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByTestId('plan-manage-cancel')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByTestId(`plan-compare-action-${TOP}-header`));
    await within(dialog).findByTestId('plan-compare-flow');
    expect(within(dialog).queryByTestId('plan-manage')).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByTestId('plan-compare-back'));
    expect(await within(dialog).findByTestId('plan-manage-cancel')).toBeInTheDocument();
  }, SLOW);

  it('no paid plan (trial, no billing row): no manage controls in either strip', async () => {
    const payload = await payloadFor({ planId: TRIAL, billingRow: null });
    expect(payload.purchase?.manage).toBeUndefined();
    const a = render(<UpgradeModal open onOpenChange={() => undefined} flow={flow()} plan={payload} strip="your_plan" />);
    expect(screen.queryByTestId('plan-manage')).not.toBeInTheDocument();
    a.unmount();
    render(<UpgradeModal open onOpenChange={() => undefined} flow={flow()} plan={payload} />);
    expect(screen.queryByTestId('plan-manage')).not.toBeInTheDocument();
  }, SLOW);

  it('TL (deviation 6): cancelling → Reactivate only, no upgrade offer, no "Reactivate your plan to upgrade" line', async () => {
    const payload = await payloadFor({ billingRow: payingRow(LOWER, { cancelAtPeriodEnd: true }), buyable: allBuyable });
    expect(payload.purchase?.manage).toEqual({ cancel: false, reactivate: true, paymentFailed: false });
    expect(payload.purchase?.upgrade ?? null).toBeNull();
    render(<UpgradeModal open onOpenChange={() => undefined} flow={flow()} plan={payload} strip="your_plan" />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByTestId('plan-manage-reactivate')).toBeInTheDocument();
    expect(within(dialog).queryByTestId('plan-manage-cancel')).not.toBeInTheDocument();
    expect(within(dialog).queryByTestId(`plan-compare-action-${TOP}-header`)).not.toBeInTheDocument();
    expect(dialog.textContent ?? '').not.toMatch(/Reactivate your plan to upgrade/i);
    expect(Object.keys(translations.en).some((key) => /reactivate.*upgrade|upgrade.*reactivate/i.test(key))).toBe(false);
  }, SLOW);
});

describe('QA focus 6: failed payment and the switch', () => {
  // P-7a.4 (BQ-3 = A): the contact line is replaced by Cancel, which ends the plan now.
  it.each(['past_due', 'unpaid'])('%s on our record: the "end it now" line and Cancel only', async (status) => {
    const payload = await payloadFor({ billingRow: payingRow(LOWER, { subscriptionStatus: status }) });
    expect(payload.purchase?.manage).toEqual({ cancel: true, reactivate: false, paymentFailed: true });
    render(<PlanManage plan={payload} />);
    expect(screen.getByTestId('plan-manage-payment-failed')).toHaveTextContent(translations.en['plan.manage.payment_failed_cancel_now']);
    expect(within(screen.getByTestId('plan-manage')).getAllByRole('button').map((b) => b.getAttribute('data-testid'))).toEqual(['plan-manage-cancel']);
  }, SLOW);

  it('active but failed_attempts > 0: the same line and Cancel', async () => {
    const payload = await payloadFor({ billingRow: payingRow(LOWER, { failedAttempts: 1 }) });
    expect(payload.purchase?.manage?.paymentFailed).toBe(true);
  }, SLOW);

  it('price switch off: no manage on the wire, nothing rendered', async () => {
    for (const row of [payingRow(LOWER), payingRow(LOWER, { cancelAtPeriodEnd: true }), payingRow(LOWER, { subscriptionStatus: 'past_due' })]) {
      const payload = await payloadFor({ billingRow: row, switchesOn: false });
      expect(payload.purchase?.manage).toBeUndefined();
      const view = render(<PlanManage plan={payload} />);
      expect(screen.queryByTestId('plan-manage')).not.toBeInTheDocument();
      view.unmount();
    }
  }, SLOW);
});

describe('QA focus 4 (UI half): a `cancel_at`-only cancellation is not visible to the screen', () => {
  it('our record (mirror copies only the flag) still says renewing: Cancel is offered, Reactivate is not', async () => {
    // What the webhook leaves on our row after a dashboard "cancel at" without the flag (X-2).
    const payload = await payloadFor({ billingRow: payingRow(LOWER, { cancelAtPeriodEnd: false }) });
    expect(payload.purchase?.manage).toEqual({ cancel: true, reactivate: false, paymentFailed: false });
  }, SLOW);
});

function plan(manage: { cancel: boolean; reactivate: boolean; paymentFailed: boolean }): PlanPayload {
  return {
    status: 'ok',
    kind: 'tier',
    name: 'Essentials',
    purchase: { offer: { kind: 'none', reason: 'paying' }, billing: { state: 'renewing', date: '2099-11-26T10:00:00.000Z' }, endsFreeAccessOnPurchase: null, upgrade: null, manage },
  } as unknown as PlanPayload;
}

/** D3: Cancel opens the Cancel drawer; walk it to the confirm step (reason → changes → review → confirm). */
function walkToConfirm(reason = 'too_expensive') {
  fireEvent.click(screen.getByTestId('plan-manage-cancel'));
  fireEvent.click(screen.getByTestId(`plan-cancel-reason-${reason}`));
  for (let step = 1; step < 4; step += 1) fireEvent.click(screen.getByTestId('plan-cancel-next'));
}

describe('QA focus 2: a double press posts once', () => {
  it('two clicks on the Cancel drawer\'s confirm before the answer → one POST (D3)', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    fetchMock.mockImplementation(() => new Promise((r) => (resolve = r)));
    render(<PlanManage plan={plan({ cancel: true, reactivate: false, paymentFailed: false })} />);
    walkToConfirm();
    const confirm = screen.getByTestId('plan-cancel-confirm');
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('plan-cancel-busy')).toBeInTheDocument();
    expect(confirm).toBeDisabled();
    await act(async () => {
      resolve({ status: 200, json: async () => ({ success: true, data: { outcome: 'cancelled', endsOn: '2099-11-26T10:00:00.000Z' } }) });
    });
    await screen.findByTestId('plan-manage-done');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('two clicks on Reactivate before the answer → one POST', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    render(<PlanManage plan={plan({ cancel: false, reactivate: true, paymentFailed: false })} />);
    const button = screen.getByTestId('plan-manage-reactivate');
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('QA focus 8 + 7: upgrade_pending, and he / es at 360 px in RTL', () => {
  const PHYSICAL = /(^|\s)(-?m[lr]-|p[lr]-|left-|right-|text-left|text-right|float-left|float-right|rounded-[lr]-|border-[lr](-|\s|$))/;

  it.each(['en', 'he', 'es'] as const)('%s: 409 upgrade_pending reads its own line (never the server English), no write claimed, re-read asked', async (lang) => {
    mockLang.language = lang;
    fetchMock.mockResolvedValue({ status: 409, json: async () => ({ success: false, error: 'SERVER ENGLISH', code: 'upgrade_pending', retryAfter: '2099-01-01T00:00:00.000Z' }) });
    const onChanged = jest.fn();
    render(<PlanManage plan={plan({ cancel: true, reactivate: false, paymentFailed: false })} onChanged={onChanged} />);
    walkToConfirm();
    fireEvent.click(screen.getByTestId('plan-cancel-confirm'));
    const line = await screen.findByTestId('plan-manage-refused');
    expect(line).toHaveTextContent(translations[lang]['plan.manage.refusal.upgrade_pending']);
    expect(line).not.toHaveTextContent('SERVER ENGLISH');
    expect(screen.queryByTestId('plan-manage-done')).not.toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it.each(['he', 'es'] as const)('%s at 360 px (dir=rtl for he): confirm, done, refusal and contact lines render; no physical-direction classes; buttons wrap', async (lang) => {
    mockLang.language = lang;
    const dir = lang === 'he' ? 'rtl' : 'ltr';
    const host = document.createElement('div');
    host.setAttribute('dir', dir);
    host.style.width = '360px';
    document.body.appendChild(host);

    // Confirmation (D3: the Cancel drawer's confirm step).
    const a = render(<PlanManage plan={plan({ cancel: true, reactivate: false, paymentFailed: false })} />, { container: host });
    walkToConfirm();
    const confirm = screen.getByTestId('plan-cancel-step-4');
    expect(confirm.textContent).toContain(translations[lang]['settings.plan_cancel.confirm.button']);
    expect(confirm.textContent).toContain(translations[lang]['settings.plan_cancel.confirm.dismiss']);
    expect(confirm.textContent).toContain('Essentials');
    expect(confirm.textContent).not.toMatch(/\{(plan|date)\}/);
    expect((confirm.querySelector('.flex-wrap') as HTMLElement | null)).not.toBeNull();
    for (const el of [...Array.from(host.querySelectorAll('*')), ...Array.from(confirm.querySelectorAll('*'))]) {
      expect((el as HTMLElement).className?.toString() ?? '').not.toMatch(PHYSICAL);
    }
    expect(host.closest('[dir]')?.getAttribute('dir')).toBe(dir);
    expect(screen.getByTestId('plan-cancel-drawer').getAttribute('dir')).toBe(dir);

    // Done line.
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ success: true, data: { outcome: 'cancelled', endsOn: '2099-11-26T10:00:00.000Z' } }) });
    fireEvent.click(screen.getByTestId('plan-cancel-confirm'));
    const done = await screen.findByTestId('plan-manage-done');
    expect(done.textContent).not.toMatch(/\{(plan|date)\}/);
    expect(done.textContent).toContain('Essentials');
    expect(done.textContent).toContain('2099');
    a.unmount();

    // Failed-payment line (P-7a.4: with Cancel).
    const second = host.appendChild(document.createElement('div'));
    const b = render(<PlanManage plan={plan({ cancel: true, reactivate: false, paymentFailed: true })} />, { container: second });
    expect(screen.getByTestId('plan-manage-payment-failed')).toHaveTextContent(translations[lang]['plan.manage.payment_failed_cancel_now']);
    b.unmount();
    host.remove();
  });

  it('every plan.manage value keeps the English placeholders, in he and es', () => {
    const slots = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    const keys = Object.keys(translations.en).filter((key) => key.startsWith('plan.manage.'));
    // 21 from P-7a.1, plus P-7a.2's `plan.manage.update_card` and `plan.manage.opening_stripe`,
    // plus P-7a.3's `plan.manage.cancel_confirm_founding` (BQ-5);
    // P-7a.4: + payment_failed_cancel_now, cancel_now_body, cancel_now_confirm, ended_now,
    // refusal.payment_failed, − payment_failed_contact.
    expect(keys).toHaveLength(28);
    for (const key of keys) {
      for (const lang of ['he', 'es'] as const) {
        expect(`${key}:${slots(translations[lang][key] ?? '')}`).toBe(`${key}:${slots(translations.en[key])}`);
      }
    }
  });
});
