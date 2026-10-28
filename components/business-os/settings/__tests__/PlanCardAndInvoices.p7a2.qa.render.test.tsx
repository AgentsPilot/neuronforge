/**
 * @jest-environment jsdom
 *
 * QA P-7a.2 (workplan "SA Code Review — P-7a.2", QA focus 2, 3, 4 (UI half),
 * 5, 9), on the REAL Settings view (`readPlanPurchaseView`, fakes only at its
 * ports, through JSON as the browser receives it) and the real `PlanManage` /
 * `PlanCardAndInvoices` / `PlanBillingNotices`:
 *
 *   - focus 2: price switch off → no buttons; checkout switch off with the
 *     price switch on → the buttons stay (BQ-1);
 *   - focus 5: an abandoned checkout (customer, no subscription) → nothing;
 *     an ended subscription → only Update card and Invoices;
 *   - focus 4 (UI half): a failed renewal → the button replaces "use the link
 *     in Stripe's email", the manage line stays;
 *   - focus 3: exactly one GET per open; a declined upgrade's voided invoice
 *     reads "Plan change · Not charged", never "failed"; the link opens in a
 *     new tab; "See all in Stripe" posts `intent: 'invoices'`;
 *   - focus 9: he (RTL, 360 px) and es: the rows read the drafts, a credit is
 *     "-$5.00" isolated in <bdi>, the locale sent is the owner's language, no
 *     physical-direction class, the button row wraps.
 */

import '@testing-library/jest-dom';
import fs from 'fs';
import path from 'path';
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

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
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));
jest.mock('@/lib/supabaseClient', () => ({ supabase: {} }));

import type { PlanPayload } from '@/components/business-os/settings/planPayloadTypes';
import { PlanManage } from '@/components/business-os/settings/PlanManage';
import { PlanBillingNotices } from '@/components/business-os/settings/planText';
import { buildCustomerPlanView } from '@/lib/business-os/entitlements/customerPlanView';
import { previewAccountFor } from '@/lib/business-os/entitlements/planPresentation';
import { resolveEntitlements } from '@/lib/business-os/entitlements/resolver';
import { readCodeConfig } from '@/lib/business-os/entitlements/source';
import { readPlanPurchaseView } from '@/lib/business-os/billing/planPurchaseView';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};

const CONFIG = readCodeConfig();
const LOWER = CONFIG.tierOrder[0];
const USER = '11111111-1111-4111-8111-111111111111';
const SLOW = 30_000;
const HOSTED = 'https://invoice.stripe.com/i/acct_1/test_x';

async function view(billingRow: Record<string, unknown> | null, switches: { checkoutEnabled: boolean; pricesEnabled: boolean }): Promise<PlanPayload> {
  const now = new Date();
  const resolution = resolveEntitlements({ config: CONFIG, account: previewAccountFor(CONFIG, LOWER, now), overrides: [], addons: [], now });
  const planView = buildCustomerPlanView({ resolution, unavailable: false, now, config: CONFIG, locale: 'en' });
  const purchase = await readPlanPurchaseView(
    { userId: USER, accountId: USER, snapshot: { unavailable: false, resolution } },
    {
      switches: () => switches,
      billing: { findByUser: async () => ({ data: billingRow as never, error: null }) },
      mode: () => 'test',
      logger: { warn: () => {} },
    }
  );
  return JSON.parse(JSON.stringify({ ...planView, purchase }));
}

const ON = { checkoutEnabled: true, pricesEnabled: true };
const row = (overrides: Record<string, unknown> = {}) => ({
  livemode: false,
  stripeCustomerId: 'cus_own',
  stripeSubscriptionId: 'sub_own',
  subscriptionStatus: 'active',
  cancelAtPeriodEnd: false,
  currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  endedAt: null,
  failedAttempts: 0,
  boughtTier: LOWER,
  ...overrides,
});

function invoiceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'in_1',
    createdAt: '2026-10-01T10:00:00.000Z',
    reason: 'subscription_create',
    planLabel: 'Essentials',
    amountMinor: 7900,
    currency: 'usd',
    status: 'paid',
    hostedInvoiceUrl: HOSTED,
    ...overrides,
  };
}

const fetchMock = jest.fn();
const answer = (status: number, body: unknown) => ({ status, ok: status === 200, json: async () => body });
beforeEach(() => {
  mockLang.language = 'en';
  fetchMock.mockReset();
  (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});

describe('QA focus 2: switches, through the real view', () => {
  it('price switch off → no manage at all, nothing rendered', async () => {
    const payload = await view(row(), { checkoutEnabled: true, pricesEnabled: false });
    expect(payload.purchase?.manage).toBeUndefined();
    render(<PlanManage plan={payload} />);
    expect(screen.queryByTestId('plan-update-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('plan-invoices-toggle')).not.toBeInTheDocument();
  }, SLOW);

  it('checkout switch off, price switch on → Update card and Invoices stay (BQ-1)', async () => {
    const payload = await view(row(), { checkoutEnabled: false, pricesEnabled: true });
    expect(payload.purchase?.manage).toEqual({ cancel: true, reactivate: false, paymentFailed: false, cardAndInvoices: true });
    render(<PlanManage plan={payload} />);
    expect(screen.getByTestId('plan-update-card')).toBeInTheDocument();
    expect(screen.getByTestId('plan-invoices-toggle')).toBeInTheDocument();
  }, SLOW);
});

describe('QA focus 5: abandoned checkout and ended subscription', () => {
  it('a checkout started and abandoned (customer, no subscription id) → no Update card, no Invoices', async () => {
    const payload = await view(
      row({ stripeSubscriptionId: null, subscriptionStatus: null, currentPeriodEnd: null, boughtTier: null }),
      ON
    );
    expect(payload.purchase?.manage?.cardAndInvoices).toBeUndefined();
    render(<PlanManage plan={payload} />);
    expect(screen.queryByTestId('plan-card-and-invoices')).not.toBeInTheDocument();
  }, SLOW);

  it('an ended subscription → only Update card and Invoices; old receipts list', async () => {
    const payload = await view(row({ subscriptionStatus: 'canceled', endedAt: '2026-09-01T00:00:00.000Z' }), ON);
    expect(payload.purchase?.manage).toEqual({ cancel: false, reactivate: false, paymentFailed: false, cardAndInvoices: true });
    render(<PlanManage plan={payload} />);
    const manage = screen.getByTestId('plan-manage');
    expect(within(manage).getAllByRole('button').map((b) => b.getAttribute('data-testid'))).toEqual(['plan-update-card', 'plan-invoices-toggle']);
    fetchMock.mockResolvedValueOnce(answer(200, { success: true, data: { invoices: [invoiceRow({ reason: 'subscription_cycle' })], hasMore: false } }));
    fireEvent.click(screen.getByTestId('plan-invoices-toggle'));
    expect(await screen.findByTestId('plan-invoice-row')).toHaveTextContent('Monthly renewal');
  }, SLOW);
});

describe('QA focus 4 (UI half): a failed renewal', () => {
  it.each([
    ['past_due', {}],
    ['active with failed attempts', { failedAttempts: 1 }],
  ])('%s → the manage line + Update card; the "Stripe email" line is gone', async (status, extra) => {
    const payload = await view(row({ subscriptionStatus: status === 'past_due' ? 'past_due' : 'active', ...extra }), ON);
    expect(payload.purchase?.manage).toMatchObject({ paymentFailed: true, cardAndInvoices: true });
    const t = (key: string) => translations.en[key] || key;
    render(
      <>
        <PlanBillingNotices plan={payload} t={t} />
        <PlanManage plan={payload} />
      </>
    );
    // Not vacuous: the real view says payment_failed, so without the button the email line WOULD show.
    expect(payload.purchase?.billing?.state).toBe('payment_failed');
    expect(screen.queryByTestId('plan-update-card-email')).not.toBeInTheDocument();
    expect(screen.getByTestId('plan-manage-payment-failed')).toBeInTheDocument();
    expect(screen.getByTestId('plan-update-card')).toBeInTheDocument();
  }, SLOW);
});

describe('QA focus 3: the invoice list', () => {
  async function renderPaying() {
    const payload = await view(row(), ON);
    render(<PlanManage plan={payload} />);
  }

  it('one GET per open: open → 1, close → 0 more, open again → 2; the GET is no-store and has no query', async () => {
    await renderPaying();
    fetchMock.mockResolvedValue(answer(200, { success: true, data: { invoices: [invoiceRow()], hasMore: false } }));
    fireEvent.click(screen.getByTestId('plan-invoices-toggle'));
    await screen.findByTestId('plan-invoice-row');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual(['/api/business-os/billing/plan/invoices', { method: 'GET', cache: 'no-store' }]);
    fireEvent.click(screen.getByTestId('plan-invoices-toggle'));
    expect(screen.queryByTestId('plan-invoices')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('plan-invoices-toggle'));
    await screen.findByTestId('plan-invoice-row');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, SLOW);

  it('the toggle is disabled while loading (a double click is one GET)', async () => {
    await renderPaying();
    let release: (v: unknown) => void = () => undefined;
    fetchMock.mockReturnValue(new Promise((resolve) => (release = resolve)));
    fireEvent.click(screen.getByTestId('plan-invoices-toggle'));
    fireEvent.click(screen.getByTestId('plan-invoices-toggle'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release(answer(200, { success: true, data: { invoices: [], hasMore: false } }));
    expect(await screen.findByTestId('plan-invoices-empty')).toBeInTheDocument();
  }, SLOW);

  it('a declined upgrade\'s voided invoice reads "Plan change · Not charged", never "failed"; link in a new tab', async () => {
    await renderPaying();
    fetchMock.mockResolvedValue(
      answer(200, { success: true, data: { invoices: [invoiceRow({ id: 'in_up', reason: 'subscription_update', status: 'void', amountMinor: 4100 })], hasMore: false } })
    );
    fireEvent.click(screen.getByTestId('plan-invoices-toggle'));
    const item = await screen.findByTestId('plan-invoice-row');
    expect(item).toHaveTextContent('Plan change');
    expect(item).toHaveTextContent('$41.00 · Not charged');
    expect(item.textContent ?? '').not.toMatch(/fail/i);
    const link = within(item).getByTestId('plan-invoice-link');
    expect(link).toHaveAttribute('href', HOSTED);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveTextContent('View invoice and receipt');
  }, SLOW);

  it('"See all in Stripe" posts intent invoices with the owner\'s locale', async () => {
    await renderPaying();
    fetchMock.mockResolvedValueOnce(answer(200, { success: true, data: { invoices: Array.from({ length: 12 }, (_, i) => invoiceRow({ id: `in_${i}` })), hasMore: true } }));
    fireEvent.click(screen.getByTestId('plan-invoices-toggle'));
    expect(await screen.findAllByTestId('plan-invoice-row')).toHaveLength(12);
    fetchMock.mockResolvedValueOnce(answer(503, { success: false, code: 'portal_unavailable' }));
    fireEvent.click(screen.getByTestId('plan-invoices-see-all'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe('/api/business-os/billing/plan/portal');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ intent: 'invoices', locale: 'en' });
    // Focus 7 (UI half): a portal_unavailable refusal reads the "not available" line.
    expect(await screen.findByTestId('plan-portal-refused')).toHaveTextContent(translations.en['plan.manage.refusal.unavailable']);
  }, SLOW);
});

describe('QA focus 9: Hebrew (RTL) and Spanish at 360 px', () => {
  it.each(['he', 'es'] as const)('%s: rows read the drafts, a credit is -$5.00 in <bdi>, the POST sends the language', async (lang) => {
    mockLang.language = lang;
    const payload = await view(row(), ON);
    const { container } = render(
      <div dir={lang === 'he' ? 'rtl' : 'ltr'} style={{ width: 360 }}>
        <PlanManage plan={payload} />
      </div>
    );
    fetchMock.mockResolvedValueOnce(
      answer(200, {
        success: true,
        data: {
          invoices: [
            invoiceRow({ id: 'in_credit', reason: 'other', amountMinor: -500, status: 'paid' }),
            invoiceRow({ id: 'in_due', reason: 'subscription_cycle', status: 'open' }),
          ],
          hasMore: true,
        },
      })
    );
    fireEvent.click(screen.getByTestId('plan-invoices-toggle'));
    const rows = await screen.findAllByTestId('plan-invoice-row');
    const dict = translations[lang];
    expect(rows[0]).toHaveTextContent(dict['plan.invoices.reason.other']);
    expect(rows[0].querySelector('bdi')?.textContent).toBe('-$5.00');
    expect(rows[1]).toHaveTextContent(dict['plan.invoices.status.open']);
    // FU-P7a2-1: the Due row's link reads "Pay now" in the owner's language.
    expect(within(rows[1]).getByTestId('plan-invoice-link')).toHaveTextContent(dict['plan.invoices.pay_now']);
    expect(within(rows[0]).getByTestId('plan-invoice-link')).toHaveTextContent(dict['plan.invoices.view']);
    expect(screen.getByTestId('plan-invoices-see-all')).toHaveTextContent(dict['plan.invoices.see_all']);
    expect(screen.getByTestId('plan-update-card')).toHaveTextContent(dict['plan.manage.update_card']);
    // No English or raw key leaks into the island.
    const island = screen.getByTestId('plan-card-and-invoices').textContent ?? '';
    expect(island).not.toMatch(/plan\.(invoices|manage)\./);
    for (const word of ['Invoice', 'Paid', 'Due', 'See all', 'Update card']) expect(island).not.toContain(word);
    // The button row wraps.
    expect(screen.getByTestId('plan-update-card').parentElement?.className).toContain('flex-wrap');
    // The POST carries the owner's language (the route sends he as auto).
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(screen.getByTestId('plan-update-card'));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ intent: 'update_card', locale: lang });
    expect(await screen.findByTestId('plan-portal-opening')).toHaveTextContent(dict['plan.manage.opening_stripe']);
    expect(container).toBeTruthy();
  }, SLOW);

  it('no physical-direction class anywhere in PlanCardAndInvoices.tsx', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'components/business-os/settings/PlanCardAndInvoices.tsx'), 'utf8');
    const classes = source.match(/className=(?:"[^"]*"|\{[^}]*\})/g) ?? [];
    const consts = source.match(/const (SECONDARY_BUTTON|LINK) = '[^']*'/g) ?? [];
    for (const text of [...classes, ...consts]) {
      expect(text).not.toMatch(/\b(ml|mr|pl|pr|left|right)-|\btext-(left|right)\b/);
    }
  });

  it('the 20 P-7a.2 keys exist, non-empty and distinct from English, in he and es', () => {
    const keys = Object.keys(translations.en).filter(
      (key) => key.startsWith('plan.invoices.') || key === 'plan.manage.update_card' || key === 'plan.manage.opening_stripe'
    );
    // 19 approved at G-5 + plan.invoices.pay_now (FU-P7a2-1).
    expect(keys).toHaveLength(20);
    for (const lang of ['he', 'es'] as const) {
      for (const key of keys) {
        expect(`${lang}:${key}:${(translations[lang][key] ?? '').length > 0}`).toBe(`${lang}:${key}:true`);
        expect(`${lang}:${key}:${translations[lang][key] !== translations.en[key]}`).toBe(`${lang}:${key}:true`);
      }
    }
    for (const key of keys) expect(/[֐-׿]/.test(translations.he[key])).toBe(true);
  });
});
