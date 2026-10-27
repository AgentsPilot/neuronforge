/**
 * @jest-environment jsdom
 *
 * Settings → Plan: Update card and Invoices (plan payments P-7a.2; workplan
 * §2.1, §4.4, §4.5; SA C-1, C-6, TQ-6, TQ-8; BQ-7).
 *
 * The controls render only where `purchase.manage.cardAndInvoices` says (the
 * routes' predicate); Update card posts the intent and the owner's language
 * and sends the browser to the URL the route returns, never logging it; the
 * invoice list is fetched only when opened (TQ-6), shows the rows with
 * Stripe's hosted link, an empty line, a "could not load" line with Try again,
 * and "See all in Stripe" when there are more; a refusal reads a dictionary
 * line. When the button is offered, "use the link in Stripe's email" is not
 * shown. Every English key has a Hebrew and a Spanish draft with the same
 * placeholders.
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

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
const mockLogged: string[] = [];
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {};
  for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = (...args: unknown[]) => mockLogged.push(JSON.stringify(args));
  logger.child = () => logger;
  return { ...jest.requireActual('@/lib/logger'), createLogger: () => logger };
});

import { PlanCardAndInvoices } from '@/components/business-os/settings/PlanCardAndInvoices';
import { PlanManage } from '@/components/business-os/settings/PlanManage';
import { PlanBillingNotices } from '@/components/business-os/settings/planText';
import type { PlanPayload } from '@/components/business-os/settings/planPayloadTypes';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};

const PORTAL_URL = 'https://billing.stripe.com/p/session/test_SECRETBEARERLINK';
const HOSTED = 'https://invoice.stripe.com/i/acct_1/test_x';

function plan(manage: Record<string, unknown> | undefined, billing: unknown = { state: 'renewing', date: '2099-11-26T10:00:00.000Z' }): PlanPayload {
  return {
    status: 'ok',
    kind: 'tier',
    name: 'Essentials',
    purchase: {
      offer: { kind: 'none', reason: 'paying' },
      billing,
      endsFreeAccessOnPurchase: null,
      upgrade: null,
      ...(manage ? { manage } : {}),
    },
  } as unknown as PlanPayload;
}

function row(overrides: Record<string, unknown> = {}) {
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
const answer = (status: number, body: unknown) => ({ status, json: async () => body });

beforeEach(() => {
  mockLang.language = 'en';
  mockLogged.length = 0;
  fetchMock.mockReset();
  (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});

describe('where the controls appear (C-1: the screen never offers what the route refuses)', () => {
  it('PlanManage mounts them only with manage.cardAndInvoices', () => {
    const { rerender } = render(<PlanManage plan={plan({ cancel: true, reactivate: false, paymentFailed: false })} />);
    expect(screen.queryByTestId('plan-update-card')).toBeNull();
    rerender(<PlanManage plan={plan({ cancel: true, reactivate: false, paymentFailed: false, cardAndInvoices: true })} />);
    expect(screen.getByTestId('plan-update-card')).toHaveTextContent('Update card');
    expect(screen.getByTestId('plan-invoices-toggle')).toHaveTextContent('Show invoices');
  });

  it('an ended subscription: only Update card and Invoices, no Cancel / Reactivate', () => {
    render(<PlanManage plan={plan({ cancel: false, reactivate: false, paymentFailed: false, cardAndInvoices: true }, { state: 'ended', date: null })} />);
    expect(screen.getByTestId('plan-update-card')).toBeInTheDocument();
    expect(screen.queryByTestId('plan-manage-cancel')).toBeNull();
    expect(screen.queryByTestId('plan-manage-reactivate')).toBeNull();
  });

  it('a failed renewal: the button replaces "use the link in Stripe\'s email"; without it the line stays', () => {
    const failed = { state: 'payment_failed', date: null };
    const { rerender } = render(<PlanBillingNotices plan={plan({ cancel: false, reactivate: false, paymentFailed: true, cardAndInvoices: true }, failed)} t={(k) => k} />);
    expect(screen.queryByTestId('plan-update-card-email')).toBeNull();
    rerender(<PlanBillingNotices plan={plan({ cancel: false, reactivate: false, paymentFailed: true }, failed)} t={(k) => k} />);
    expect(screen.getByTestId('plan-update-card-email')).toHaveTextContent('plan.update_card_email');
  });
});

describe('Update card', () => {
  it('posts { intent: update_card, locale } and navigates to the returned URL, never logging it', async () => {
    mockLang.language = 'he';
    fetchMock.mockResolvedValue(answer(200, { success: true, data: { url: PORTAL_URL } }));
    const navigate = jest.fn();
    render(<PlanCardAndInvoices navigate={navigate} />);
    fireEvent.click(screen.getByTestId('plan-update-card'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(PORTAL_URL));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/business-os/billing/plan/portal');
    expect(JSON.parse(init.body)).toEqual({ intent: 'update_card', locale: 'he' });
    expect(screen.getByTestId('plan-portal-opening')).toHaveTextContent(translations.he['plan.manage.opening_stripe']);
    expect(mockLogged.join('\n')).not.toContain('SECRETBEARERLINK');
  });

  it('a double click sends ONE request', async () => {
    let release: (v: unknown) => void = () => undefined;
    fetchMock.mockReturnValue(new Promise((resolve) => (release = resolve)));
    render(<PlanCardAndInvoices navigate={jest.fn()} />);
    fireEvent.click(screen.getByTestId('plan-update-card'));
    fireEvent.click(screen.getByTestId('plan-update-card'));
    release(answer(200, { success: true, data: { url: PORTAL_URL } }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it.each([
    [503, 'portal_unavailable', 'plan.manage.refusal.unavailable'],
    [409, 'no_billing_account', 'plan.manage.refusal.not_subscribed'],
    [502, 'stripe_error', 'plan.manage.refusal.stripe_error'],
    [404, 'not_available', 'plan.manage.refusal.unavailable'],
    [401, null, 'plan.refusal.signed_out'],
  ])('a %s %s reads %s, never the server English, and does not navigate', async (status, code, key) => {
    fetchMock.mockResolvedValue(answer(status, { success: false, error: 'SERVER ENGLISH', ...(code ? { code } : {}) }));
    const navigate = jest.fn();
    render(<PlanCardAndInvoices navigate={navigate} />);
    fireEvent.click(screen.getByTestId('plan-update-card'));
    const refused = await screen.findByTestId('plan-portal-refused');
    expect(refused).toHaveTextContent(translations.en[key]);
    expect(refused).not.toHaveTextContent('SERVER ENGLISH');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a 200 whose URL is not https is not followed', async () => {
    fetchMock.mockResolvedValue(answer(200, { success: true, data: { url: 'javascript:alert(1)' } }));
    const navigate = jest.fn();
    render(<PlanCardAndInvoices navigate={navigate} />);
    fireEvent.click(screen.getByTestId('plan-update-card'));
    await screen.findByTestId('plan-portal-refused');
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('Invoices (TQ-6: loaded only when opened)', () => {
  it('nothing is fetched until the owner opens the list', () => {
    render(<PlanCardAndInvoices navigate={jest.fn()} />);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opens: rows with date, reason, plan, USD amount, status and the hosted link in a new tab', async () => {
    fetchMock.mockResolvedValue(
      answer(200, {
        success: true,
        data: { invoices: [row(), row({ id: 'in_2', reason: 'subscription_update', status: 'void', amountMinor: 3387, planLabel: null, hostedInvoiceUrl: null })], hasMore: false },
      })
    );
    render(<PlanCardAndInvoices navigate={jest.fn()} />);
    fireEvent.click(screen.getByTestId('plan-invoices-toggle'));
    const rows = await screen.findAllByTestId('plan-invoice-row');
    expect(fetchMock).toHaveBeenCalledWith('/api/business-os/billing/plan/invoices', { method: 'GET', cache: 'no-store' });
    expect(rows[0]).toHaveTextContent('October 1, 2026 · Plan started · Essentials');
    expect(rows[0]).toHaveTextContent('$79.00 · Paid');
    // U-10: a declined upgrade's voided invoice reads "Plan change", "Not charged".
    expect(rows[1]).toHaveTextContent('Plan change');
    expect(rows[1]).toHaveTextContent('$33.87 · Not charged');
    const links = screen.getAllByTestId('plan-invoice-link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', HOSTED);
    expect(links[0]).toHaveAttribute('target', '_blank');
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer');
    expect(links[0]).toHaveTextContent('View invoice and receipt');
    expect(screen.queryByTestId('plan-invoices-see-all')).toBeNull();
    expect(screen.getByTestId('plan-invoices-toggle')).toHaveTextContent('Hide invoices');
  });

  it('empty → "No invoices yet."', async () => {
    fetchMock.mockResolvedValue(answer(200, { success: true, data: { invoices: [], hasMore: false } }));
    render(<PlanCardAndInvoices navigate={jest.fn()} />);
    fireEvent.click(screen.getByTestId('plan-invoices-toggle'));
    expect(await screen.findByTestId('plan-invoices-empty')).toHaveTextContent('No invoices yet.');
  });

  it('a failure → "could not load" with Try again, which reloads', async () => {
    fetchMock.mockResolvedValueOnce(answer(502, { success: false, code: 'stripe_error' }));
    fetchMock.mockResolvedValueOnce(answer(200, { success: true, data: { invoices: [row()], hasMore: false } }));
    render(<PlanCardAndInvoices navigate={jest.fn()} />);
    fireEvent.click(screen.getByTestId('plan-invoices-toggle'));
    expect(await screen.findByTestId('plan-invoices-failed')).toHaveTextContent(translations.en['plan.invoices.unavailable']);
    fireEvent.click(screen.getByTestId('plan-invoices-retry'));
    expect(await screen.findAllByTestId('plan-invoice-row')).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('hasMore → "See all in Stripe" opens the portal home', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, { success: true, data: { invoices: [row()], hasMore: true } }));
    fetchMock.mockResolvedValueOnce(answer(200, { success: true, data: { url: PORTAL_URL } }));
    const navigate = jest.fn();
    render(<PlanCardAndInvoices navigate={navigate} />);
    fireEvent.click(screen.getByTestId('plan-invoices-toggle'));
    fireEvent.click(await screen.findByTestId('plan-invoices-see-all'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(PORTAL_URL));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ intent: 'invoices', locale: 'en' });
  });

  it('Hide closes the list; opening again reads it again (once per open)', async () => {
    fetchMock.mockResolvedValue(answer(200, { success: true, data: { invoices: [row()], hasMore: false } }));
    render(<PlanCardAndInvoices navigate={jest.fn()} />);
    fireEvent.click(screen.getByTestId('plan-invoices-toggle'));
    await screen.findAllByTestId('plan-invoice-row');
    fireEvent.click(screen.getByTestId('plan-invoices-toggle'));
    expect(screen.queryByTestId('plan-invoices')).toBeNull();
    fireEvent.click(screen.getByTestId('plan-invoices-toggle'));
    await screen.findAllByTestId('plan-invoice-row');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('Hebrew and Spanish: the rows read the drafts', async () => {
    for (const lang of ['he', 'es'] as const) {
      mockLang.language = lang;
      fetchMock.mockResolvedValue(answer(200, { success: true, data: { invoices: [row({ status: 'open', reason: 'subscription_cycle' })], hasMore: false } }));
      const view = render(<PlanCardAndInvoices navigate={jest.fn()} />);
      fireEvent.click(screen.getByTestId('plan-invoices-toggle'));
      const [first] = await screen.findAllByTestId('plan-invoice-row');
      expect(first).toHaveTextContent(translations[lang]['plan.invoices.reason.subscription_cycle']);
      expect(first).toHaveTextContent(translations[lang]['plan.invoices.status.open']);
      view.unmount();
    }
  });

  it('FU-P7a2-1: a Due (open) row says "Pay now", a paid row says "View invoice and receipt"; same link (en + he)', async () => {
    for (const lang of ['en', 'he'] as const) {
      mockLang.language = lang;
      fetchMock.mockResolvedValue(
        answer(200, {
          success: true,
          data: { invoices: [row({ id: 'in_paid', status: 'paid' }), row({ id: 'in_due', status: 'open', reason: 'subscription_cycle' })], hasMore: false },
        })
      );
      const view = render(<PlanCardAndInvoices navigate={jest.fn()} />);
      fireEvent.click(screen.getByTestId('plan-invoices-toggle'));
      const [paid, due] = await screen.findAllByTestId('plan-invoice-row');
      const paidLink = within(paid).getByTestId('plan-invoice-link');
      const dueLink = within(due).getByTestId('plan-invoice-link');
      expect(paidLink).toHaveTextContent(translations[lang]['plan.invoices.view']);
      expect(dueLink).toHaveTextContent(translations[lang]['plan.invoices.pay_now']);
      expect(dueLink).not.toHaveTextContent(translations[lang]['plan.invoices.view']);
      for (const link of [paidLink, dueLink]) {
        expect(link).toHaveAttribute('href', HOSTED);
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      }
      if (lang === 'en') {
        expect(paidLink).toHaveTextContent('View invoice and receipt');
        expect(dueLink).toHaveTextContent('Pay now');
      } else {
        expect(dueLink).toHaveTextContent('לתשלום עכשיו');
      }
      view.unmount();
    }
  });
});

describe('dictionaries', () => {
  it('every P-7a.2 key exists in en, he and es with the same placeholders', () => {
    const keys = Object.keys(translations.en).filter(
      (key) => key.startsWith('plan.invoices.') || key === 'plan.manage.update_card' || key === 'plan.manage.opening_stripe'
    );
    // 19 approved at G-5 + plan.invoices.pay_now (FU-P7a2-1).
    expect(keys).toHaveLength(20);
    const slots = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const key of keys) {
      for (const lang of ['he', 'es'] as const) {
        expect(translations[lang][key]).toBeTruthy();
        expect(`${key}:${slots(translations[lang][key])}`).toBe(`${key}:${slots(translations.en[key])}`);
      }
    }
  });
});
