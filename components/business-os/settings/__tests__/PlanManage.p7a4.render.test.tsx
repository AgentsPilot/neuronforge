/**
 * @jest-environment jsdom
 *
 * Settings → Plan, P-7a.4: Cancel during a failed payment ends the plan now
 * (workplan §4.3; BQ-3 = A; SA C-11: "The confirmation for this state says
 * 'ends now', not 'until {date}'").
 *
 * With `manage.paymentFailed` + `manage.cancel` the island shows the "cancel
 * to end it now" line and a Cancel that opens the Cancel drawer in `mode="now"`
 * (D3 T-13): its review and confirm steps say the plan ends TODAY and name no
 * date; the reason step is still required and the drawer posts
 * `{ reasonCode }` (D3 SA ruling 6; P-7a.4 adds no body field). The line after
 * the press follows the ROUTE's answer: `mode: 'immediate'` or
 * `state: 'ended'` → "has ended"; a period-end answer (Stripe had already
 * cured the payment) → the usual "You keep {plan} until {date}".
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

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

jest.mock('@/components/business-os/data-export/DownloadMyDataButton', () => ({
  DownloadMyDataButton: () => <div data-testid="download-my-data" />,
}));

import { PlanManage } from '@/components/business-os/settings/PlanManage';
import type { PlanPayload } from '@/components/business-os/settings/planPayloadTypes';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};

const PHYSICAL = /(^|\s)(-?m[lr]-|p[lr]-|left-|right-|text-left|text-right|float-left|float-right|rounded-[lr]-|border-[lr](-|\s|$))/;
const P7A4_KEYS = [
  'plan.manage.payment_failed_cancel_now',
  'plan.manage.cancel_now_body',
  'plan.manage.cancel_now_confirm',
  'plan.manage.ended_now',
  'plan.manage.refusal.payment_failed',
];

function failing(): PlanPayload {
  return {
    status: 'ok',
    kind: 'tier',
    name: 'Essentials',
    purchase: {
      offer: { kind: 'none', reason: 'paying' },
      // A failed renewal: billing says payment_failed (no renewal date to promise).
      billing: { state: 'payment_failed', date: '2026-10-20T10:00:00.000Z', attempts: 1 },
      endsFreeAccessOnPurchase: null,
      upgrade: null,
      manage: { cancel: true, reactivate: false, paymentFailed: true },
    },
  } as unknown as PlanPayload;
}

/** D3 T-13: Cancel opens the drawer; walk it to the confirm step (reason → changes → review → confirm). */
function walkToConfirm(reason = 'too_expensive') {
  fireEvent.click(screen.getByTestId('plan-manage-cancel'));
  fireEvent.click(screen.getByTestId(`plan-cancel-reason-${reason}`));
  for (let step = 1; step < 4; step += 1) fireEvent.click(screen.getByTestId('plan-cancel-next'));
}

const fetchMock = jest.fn();
beforeEach(() => {
  mockLang.language = 'en';
  fetchMock.mockReset();
  (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});

describe('PlanManage — P-7a.4 failed payment', () => {
  it('shows the "end it now" line and Cancel; the drawer says it ends NOW (review + confirm) and names no date', async () => {
    render(<PlanManage plan={failing()} />);
    expect(screen.getByTestId('plan-manage-payment-failed')).toHaveTextContent(translations.en['plan.manage.payment_failed_cancel_now']);
    fireEvent.click(screen.getByTestId('plan-manage-cancel'));
    // The reason step is still required in `now` mode (D3 SA ruling 6).
    expect(screen.getByTestId('plan-cancel-next')).toBeDisabled();
    fireEvent.click(screen.getByTestId('plan-cancel-reason-too_expensive'));
    fireEvent.click(screen.getByTestId('plan-cancel-next'));
    fireEvent.click(screen.getByTestId('plan-cancel-next'));
    expect(screen.getByTestId('plan-cancel-last-day')).toHaveTextContent(translations.en['settings.plan_cancel.review.ends_now']);
    fireEvent.click(screen.getByTestId('plan-cancel-next'));
    const confirm = screen.getByTestId('plan-cancel-confirm-body');
    expect(confirm).toHaveTextContent(translations.en['settings.plan_cancel.confirm.body_now']);
    expect(confirm.textContent).not.toMatch(/until|before|\{date\}|2026/);
    // "Don't cancel" backs out with no request.
    fireEvent.click(screen.getByTestId('plan-cancel-dismiss'));
    await waitFor(() => expect(screen.queryByTestId('plan-cancel-drawer')).not.toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('confirm posts `{ reasonCode }` to the cancel route; `mode: immediate` → "has ended"', async () => {
    const onChanged = jest.fn();
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ success: true, data: { outcome: 'cancelled', endsOn: '2026-10-27T10:00:00.000Z', mode: 'immediate' } }) });
    render(<PlanManage plan={failing()} onChanged={onChanged} />);
    walkToConfirm('missing_feature');
    fireEvent.click(screen.getByTestId('plan-cancel-confirm'));
    const done = await screen.findByTestId('plan-manage-done');
    expect(done).toHaveTextContent(translations.en['plan.manage.ended_now'].replace('{plan}', 'Essentials'));
    expect(fetchMock).toHaveBeenCalledWith('/api/business-os/billing/plan/cancel', expect.objectContaining({ method: 'POST', body: '{"reasonCode":"missing_feature"}' }));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('`unchanged` / `ended` (a second tab) → "has ended" too', async () => {
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ success: true, data: { outcome: 'unchanged', state: 'ended', date: '2026-10-27T10:00:00.000Z' } }) });
    render(<PlanManage plan={failing()} />);
    walkToConfirm();
    fireEvent.click(screen.getByTestId('plan-cancel-confirm'));
    expect(await screen.findByTestId('plan-manage-done')).toHaveTextContent(translations.en['plan.manage.ended_now'].replace('{plan}', 'Essentials'));
  });

  it('Stripe had cured it: a period-end answer reads "You keep {plan} until {date}", never "has ended"', async () => {
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ success: true, data: { outcome: 'cancelled', endsOn: '2099-11-26T10:00:00.000Z' } }) });
    render(<PlanManage plan={failing()} />);
    walkToConfirm();
    fireEvent.click(screen.getByTestId('plan-cancel-confirm'));
    const done = await screen.findByTestId('plan-manage-done');
    expect(done.textContent).toContain('2099');
    expect(done.textContent).not.toContain(translations.en['plan.manage.ended_now'].replace('{plan}', 'Essentials'));
  });

  it('a renewing plan still gets the period-end confirmation (unchanged by P-7a.4)', () => {
    const plan = failing();
    (plan.purchase as unknown as { manage: unknown }).manage = { cancel: true, reactivate: false, paymentFailed: false };
    (plan.purchase as unknown as { billing: unknown }).billing = { state: 'renewing', date: '2099-11-26T10:00:00.000Z' };
    render(<PlanManage plan={plan} />);
    expect(screen.queryByTestId('plan-manage-payment-failed')).not.toBeInTheDocument();
    walkToConfirm();
    expect(screen.getByTestId('plan-cancel-confirm-body')).toHaveTextContent('You can keep it any time before November 26, 2099.');
    expect(screen.getByTestId('plan-cancel-confirm-body')).not.toHaveTextContent(translations.en['settings.plan_cancel.confirm.body_now']);
  });

  it('a refused Reactivate during a failed payment reads the new line, never the server English', async () => {
    const { planManageRefusalKey } = jest.requireActual('@/components/business-os/settings/planManageCopy') as typeof import('@/components/business-os/settings/planManageCopy');
    expect(planManageRefusalKey({ httpStatus: 409, code: 'payment_failed_contact_us', outcomeUnknown: false })).toBe('plan.manage.refusal.payment_failed');
  });

  it.each(['he', 'es'] as const)('%s: drafts exist, keep the placeholders, render with no physical-direction classes', async (lang) => {
    for (const key of P7A4_KEYS) {
      expect(translations[lang][key]).toBeTruthy();
      const slots = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
      expect(slots(translations[lang][key])).toBe(slots(translations.en[key]));
    }
    mockLang.language = lang;
    const host = document.createElement('div');
    host.setAttribute('dir', lang === 'he' ? 'rtl' : 'ltr');
    document.body.appendChild(host);
    render(<PlanManage plan={failing()} />, { container: host });
    walkToConfirm();
    expect(screen.getByTestId('plan-cancel-heading').textContent).toContain('Essentials');
    const confirm = screen.getByTestId('plan-cancel-confirm-body');
    expect(confirm).toHaveTextContent(translations[lang]['settings.plan_cancel.confirm.body_now']);
    expect(confirm.textContent).not.toMatch(/\{(plan|date)\}/);
    for (const el of Array.from(host.querySelectorAll('*'))) expect((el as HTMLElement).className?.toString() ?? '').not.toMatch(PHYSICAL);
    host.remove();
  });

  it('SA deviation 8: a Founding Partner (server sent freeAccessAfter) reads the BQ-5 sentence in the "ends now" confirmation; a non-founding account does not', () => {
    const FREE_UNTIL = '2100-03-01T12:00:00.000Z';
    const founding = failing();
    (founding.purchase as unknown as { manage: unknown }).manage = {
      cancel: true,
      reactivate: false,
      paymentFailed: true,
      freeAccessAfter: { endsAt: FREE_UNTIL },
    };
    const sentence = translations.en['plan.manage.cancel_confirm_founding'].replace('{freeUntil}', 'March 1, 2100');
    const endsNow = translations.en['settings.plan_cancel.confirm.body_now'];

    const { unmount } = render(<PlanManage plan={founding} />);
    walkToConfirm();
    const text = screen.getByTestId('plan-cancel-confirm-body').textContent ?? '';
    expect(text).toContain(endsNow);
    expect(text).toContain(sentence);
    // "Ends now" first, then where the owner lands.
    expect(text.indexOf(endsNow)).toBeLessThan(text.indexOf(sentence));
    unmount();

    render(<PlanManage plan={failing()} />);
    walkToConfirm();
    expect(screen.getByTestId('plan-cancel-confirm-body')).not.toHaveTextContent('Founding Partner');
  });

  it('the retired P-7a.1 "contact us" key is gone from every dictionary', () => {
    for (const lang of ['en', 'he', 'es'] as const) expect(translations[lang]['plan.manage.payment_failed_contact']).toBeUndefined();
  });
});
