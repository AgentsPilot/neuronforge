/**
 * @jest-environment jsdom
 *
 * QA P-7a.4 (workplan "SA Code Review — P-7a.4", QA focus 2, 3, 5, 6) on the
 * REAL Settings view (`readPlanPurchaseView` through `payloadFor`) and the real
 * `PlanManage`, with the route answers the route tests pin:
 *
 *   - focus 2 (UI): a cured row's period-end answer and its `unchanged` /
 *     `cancelling` replay read "You keep … until …", never "has ended";
 *   - focus 3 (UI): a double press on "Yes, end it now" posts ONCE; the second
 *     tab's two possible answers (`unchanged` / `ended`, 409 not_active);
 *   - focus 5 (UI): a stale cancelling payload (Reactivate shown) answered 409
 *     `payment_failed_contact_us` reads the new refusal line in en / he / es;
 *   - focus 6: the five new keys complete in en / he / es; he / es at 360 px in
 *     an RTL / LTR container; `plan.manage.payment_failed_contact` gone from
 *     every dictionary and every source file.
 *
 * D3 T-13: the inline "ends now" confirmation became the Cancel drawer in
 * `mode="now"` (reason → what changes → review → confirm), so every press here
 * walks the drawer and the "ends now" wording is the drawer's
 * `settings.plan_cancel.review.ends_now` / `.confirm.body_now`.
 */

import '@testing-library/jest-dom';
import fs from 'fs';
import path from 'path';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

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
jest.mock('@/components/business-os/data-export/DownloadMyDataButton', () => ({
  DownloadMyDataButton: () => <div data-testid="download-my-data" />,
}));

import type { PlanPayload } from '@/components/business-os/settings/planPayloadTypes';
import { PlanManage } from '@/components/business-os/settings/PlanManage';

import { LOWER, inSixtyDays, payingRow, payloadFor } from './upgradeModalPayloads';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};

const P7A4_KEYS = [
  'plan.manage.payment_failed_cancel_now',
  'plan.manage.cancel_now_body',
  'plan.manage.cancel_now_confirm',
  'plan.manage.ended_now',
  'plan.manage.refusal.payment_failed',
];
const PHYSICAL = /(^|\s)(-?m[lr]-|p[lr]-|left-|right-|text-left|text-right|float-left|float-right|rounded-[lr]-|border-[lr](-|\s|$))/;

const fetchMock = jest.fn();
beforeEach(() => {
  mockLang.language = 'en';
  fetchMock.mockReset();
  (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});

const answer = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
const failingPayload = () => payloadFor({ billingRow: payingRow(LOWER, { subscriptionStatus: 'past_due', failedAttempts: 1 }) });
const planName = (p: PlanPayload) => (p as unknown as { name: string }).name;
const fill = (s: string, vars: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? `{${k}}`);

/** D3 T-13: Cancel opens the drawer; walk it to the confirm step (reason → changes → review → confirm). */
function walkToConfirm(reason = 'too_expensive') {
  fireEvent.click(screen.getByTestId('plan-manage-cancel'));
  fireEvent.click(screen.getByTestId(`plan-cancel-reason-${reason}`));
  for (let step = 1; step < 4; step += 1) fireEvent.click(screen.getByTestId('plan-cancel-next'));
}

async function pressEndNow(): Promise<HTMLElement> {
  walkToConfirm();
  fireEvent.click(screen.getByTestId('plan-cancel-confirm'));
  return screen.findByTestId('plan-manage-done');
}

describe('QA P-7a.4 — real view: a failing row offers Cancel that ends now', () => {
  it.each([
    ['past_due', { subscriptionStatus: 'past_due', failedAttempts: 1 }],
    ['unpaid', { subscriptionStatus: 'unpaid', failedAttempts: 2 }],
    ['active + failed_attempts', { subscriptionStatus: 'active', failedAttempts: 1 }],
    ['cancelling + past_due (failure first, F-4)', { subscriptionStatus: 'past_due', cancelAtPeriodEnd: true, currentPeriodEnd: inSixtyDays() }],
  ])('%s → manage { cancel, paymentFailed }, no Reactivate; the "ends now" confirmation', async (_label, overrides) => {
    const payload = await payloadFor({ billingRow: payingRow(LOWER, overrides) });
    const manage = (payload as unknown as { purchase: { manage: Record<string, unknown> } }).purchase.manage;
    expect(manage).toMatchObject({ cancel: true, reactivate: false, paymentFailed: true });
    render(<PlanManage plan={payload} />);
    expect(screen.queryByTestId('plan-manage-reactivate')).not.toBeInTheDocument();
    walkToConfirm();
    // The drawer in `now` mode: "ends today", never the period-end date.
    expect(screen.getByTestId('plan-cancel-confirm-body')).toHaveTextContent(translations.en['settings.plan_cancel.confirm.body_now']);
    expect(screen.getByTestId('plan-cancel-confirm-body').textContent).not.toMatch(/before|until/);
  });

  it('a failure count on an ended row offers no Cancel (deviation 5)', async () => {
    const payload = await payloadFor({ billingRow: payingRow(LOWER, { subscriptionStatus: 'canceled', failedAttempts: 2, endedAt: new Date().toISOString() }) });
    render(<PlanManage plan={payload} />);
    expect(screen.queryByTestId('plan-manage-cancel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('plan-manage-payment-failed')).not.toBeInTheDocument();
  });
});

describe('QA focus 2 (UI): a cured row never reads "has ended"', () => {
  it.each([
    ['period-end write', { success: true, data: { outcome: 'cancelled', endsOn: '2099-11-26T10:00:00.000Z' } }],
    ['unchanged / cancelling replay', { success: true, data: { outcome: 'unchanged', state: 'cancelling', date: '2099-11-26T10:00:00.000Z' } }],
  ])('%s → "Cancelled. You keep {plan} until {date}"', async (_label, body) => {
    const payload = await failingPayload();
    fetchMock.mockResolvedValue(answer(200, body));
    render(<PlanManage plan={payload} />);
    const done = await pressEndNow();
    const ended = fill(translations.en['plan.manage.ended_now'], { plan: planName(payload) });
    expect(done.textContent).not.toContain(ended);
    expect(done.textContent).toContain('2099');
    expect(done.textContent).toContain(translations.en['plan.manage.cancelled'].split('{plan}')[0].trim());
  });
});

describe('QA focus 3 (UI): two presses, two tabs', () => {
  it('a double press on "Yes, end it now" posts ONCE', async () => {
    const payload = await failingPayload();
    let resolve: (v: unknown) => void = () => undefined;
    fetchMock.mockImplementation(() => new Promise((r) => { resolve = r; }));
    render(<PlanManage plan={payload} />);
    walkToConfirm();
    const confirm = screen.getByTestId('plan-cancel-confirm');
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(screen.getByTestId('plan-cancel-confirm')).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => resolve(answer(200, { success: true, data: { outcome: 'cancelled', endsOn: new Date().toISOString(), mode: 'immediate' } })));
    expect(await screen.findByTestId('plan-manage-done')).toHaveTextContent(fill(translations.en['plan.manage.ended_now'], { plan: planName(payload) }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('tab B, our row lagging → `unchanged` / `ended` → "has ended"', async () => {
    const payload = await failingPayload();
    fetchMock.mockResolvedValue(answer(200, { success: true, data: { outcome: 'unchanged', state: 'ended', date: new Date().toISOString() } }));
    render(<PlanManage plan={payload} />);
    expect(await pressEndNow()).toHaveTextContent(fill(translations.en['plan.manage.ended_now'], { plan: planName(payload) }));
  });

  // QA E-1, closed by TL ruling 2026-10-27: the route now answers 200 unchanged / ended from our row.
  it('tab B, our row already mirrored → 200 unchanged / ended → "has ended" (QA E-1 closed), never "not active"', async () => {
    const payload = await failingPayload();
    fetchMock.mockResolvedValue(answer(200, { success: true, data: { outcome: 'unchanged', state: 'ended', date: new Date().toISOString() } }));
    render(<PlanManage plan={payload} />);
    expect(await pressEndNow()).toHaveTextContent(fill(translations.en['plan.manage.ended_now'], { plan: planName(payload) }));
    expect(screen.queryByText(translations.en['plan.manage.refusal.not_active'])).not.toBeInTheDocument();
  });
});

describe('QA focus 5 (UI): Reactivate refused during a failed payment', () => {
  it.each(['en', 'he', 'es'] as const)('%s: a stale cancelling payload, 409 payment_failed_contact_us → the dictionary line, never the server English', async (lang) => {
    mockLang.language = lang;
    const payload = await payloadFor({ billingRow: payingRow(LOWER, { cancelAtPeriodEnd: true, currentPeriodEnd: inSixtyDays() }) });
    fetchMock.mockResolvedValue(answer(409, { success: false, error: 'Your payment failed. Update your card, or contact us to cancel.', code: 'payment_failed_contact_us' }));
    render(<PlanManage plan={payload} />);
    fireEvent.click(screen.getByTestId('plan-manage-reactivate'));
    expect(await screen.findByText(translations[lang]['plan.manage.refusal.payment_failed'])).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('contact us to cancel');
    expect(fetchMock).toHaveBeenCalledWith('/api/business-os/billing/plan/reactivate', expect.objectContaining({ method: 'POST' }));
  });
});

describe('QA focus 6: wording and layout', () => {
  it('the five new keys: present, non-empty, placeholders as en, he in Hebrew script, es not English', () => {
    for (const key of P7A4_KEYS) {
      const slots = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
      for (const lang of ['en', 'he', 'es'] as const) {
        expect(typeof translations[lang][key]).toBe('string');
        expect(translations[lang][key].trim().length).toBeGreaterThan(0);
        expect(slots(translations[lang][key])).toBe(slots(translations.en[key]));
      }
      expect(translations.he[key]).toMatch(/[֐-׿]/);
      expect(translations.es[key]).not.toBe(translations.en[key]);
    }
  });

  it.each(['he', 'es'] as const)('%s at 360 px: the payment-failed line, the ends-now confirmation and the done line render in full; buttons wrap; no physical-direction class', async (lang) => {
    mockLang.language = lang;
    const payload = await failingPayload();
    fetchMock.mockResolvedValue(answer(200, { success: true, data: { outcome: 'cancelled', endsOn: new Date().toISOString(), mode: 'immediate' } }));
    const host = document.createElement('div');
    host.setAttribute('dir', lang === 'he' ? 'rtl' : 'ltr');
    host.style.width = '360px';
    document.body.appendChild(host);
    render(<PlanManage plan={payload} />, { container: host });
    const dict = translations[lang];
    expect(screen.getByTestId('plan-manage-payment-failed')).toHaveTextContent(dict['plan.manage.payment_failed_cancel_now']);
    walkToConfirm();
    const confirm = screen.getByTestId('plan-cancel-confirm-body');
    expect(confirm).toHaveTextContent(dict['settings.plan_cancel.confirm.body_now']);
    expect(screen.getByTestId('plan-cancel-heading').textContent).toContain(planName(payload));
    const row = screen.getByTestId('plan-cancel-confirm').parentElement as HTMLElement;
    expect(row.className).toMatch(/flex-wrap/);
    // No fixed width / nowrap that would stop a long Hebrew / Spanish line wrapping.
    for (const el of Array.from(host.querySelectorAll('*'))) {
      const cls = (el as HTMLElement).className?.toString() ?? '';
      expect(cls).not.toMatch(PHYSICAL);
      expect(cls).not.toMatch(/whitespace-nowrap|truncate|(^|\s)w-\[\d/);
    }
    fireEvent.click(screen.getByTestId('plan-cancel-confirm'));
    expect(await screen.findByTestId('plan-manage-done')).toHaveTextContent(fill(dict['plan.manage.ended_now'], { plan: planName(payload) }));
    expect(host.textContent).not.toMatch(/\{(plan|date)\}|plan\.manage\./);
    host.remove();
  });

  it('`plan.manage.payment_failed_contact` is gone from every dictionary and every source file (tests asserting its absence excepted)', () => {
    for (const lang of ['en', 'he', 'es'] as const) expect(translations[lang]['plan.manage.payment_failed_contact']).toBeUndefined();
    const root = path.resolve(__dirname, '../../../..');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx|js|json)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          if (/plan\.manage\.payment_failed_contact(?!_)/.test(fs.readFileSync(full, 'utf8'))) hits.push(path.relative(root, full));
        }
      }
    };
    for (const top of ['app', 'components', 'lib', 'hooks', 'types']) {
      const dir = path.join(root, top);
      if (fs.existsSync(dir)) walk(dir);
    }
    expect(hits).toEqual([]);
  });
});
