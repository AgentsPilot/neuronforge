/**
 * @jest-environment jsdom
 *
 * Settings → Plan: a failed renewal, a 3-D Secure request and an ended
 * subscription (plan payments P-6a.2; workplan §5.7, §13; SA Q-5, Q-6).
 *
 * Fed the payload the my-plan route would send: the REAL plan view and the
 * REAL purchase view (`readPlanPurchaseView`), which asks `planPaymentNotice`,
 * the predicate the owner banner uses too. Asserted: the sentence with its
 * date on the account's clock and the attempt count, the "use Stripe's email"
 * line (no Update card button until P-7a, Q-6), the "Confirm payment" link
 * (new tab, noopener), "ended", nothing while the price switch is off, and
 * he / es with Hebrew right to left.
 */

import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));
jest.mock('@/lib/supabaseClient', () => ({ supabase: {} }));
jest.mock('@/lib/stripe/StripeService', () => ({
  getStripeService: () => {
    throw new Error('the plan screen never talks to Stripe');
  },
}));

type Lang = 'en' | 'he' | 'es';
const mockLang: { language: Lang; timezone: string } = { language: 'en', timezone: 'UTC' };
jest.mock('@/lib/business-os/LanguageContext', () => {
  const { translations } = jest.requireActual('@/lib/business-os/LanguageContext');
  return {
    useLanguage: () => ({
      language: mockLang.language,
      timezone: mockLang.timezone,
      isRTL: mockLang.language === 'he',
      t: (key: string) => translations[mockLang.language][key] || key,
    }),
  };
});
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn() }) }));
jest.mock('@/lib/client/stripeJs', () => ({ getStripePromise: () => null }));

import { PlanSection, type PlanPayload } from '@/components/business-os/settings/PlanSection';
import { buildCustomerPlanView } from '@/lib/business-os/entitlements/customerPlanView';
import { previewAccountFor } from '@/lib/business-os/entitlements/planPresentation';
import { resolveEntitlements } from '@/lib/business-os/entitlements/resolver';
import { readCodeConfig } from '@/lib/business-os/entitlements/source';
import { billingEndsWhen, readPlanPurchaseView } from '@/lib/business-os/billing/planPurchaseView';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};
const USER = '11111111-1111-4111-8111-111111111111';
const URL = 'https://invoice.stripe.com/i/acct_probe/test_settings?s=ap';
const DAY = 24 * 60 * 60 * 1000;

/** 22:30 UTC on 12 November is 00:30 on the 13th in Asia/Jerusalem. */
const FAILED_AT = '2099-11-12T22:30:00.000Z';

interface Options {
  billingRow: Record<string, unknown>;
  switchesOn?: boolean;
  language?: Lang;
  /** The paid-through date: in the past puts the account in grace / paused. */
  tierExpiresAt?: string | null;
}

async function payloadFor({ billingRow, switchesOn = true, language = 'en', tierExpiresAt }: Options): Promise<PlanPayload> {
  const config = readCodeConfig();
  const now = new Date();
  const [firstTier] = config.tierOrder;
  const account = previewAccountFor(config, firstTier, now);
  const resolution = resolveEntitlements({
    config,
    account: tierExpiresAt === undefined ? account : { ...account, tierExpiresAt },
    overrides: [],
    addons: [],
    now,
  });
  const view = buildCustomerPlanView({ resolution, unavailable: false, now, config, locale: language });
  const purchase = await readPlanPurchaseView(
    { userId: USER, accountId: USER, snapshot: { unavailable: false, resolution } },
    {
      switches: () => ({ checkoutEnabled: switchesOn, pricesEnabled: switchesOn }),
      billing: { findByUser: async () => ({ data: billingRow as never, error: null }) },
      mode: () => 'test',
      enforcing: () => false,
      logger: { warn: () => {} },
    }
  );
  const recordEndsWhen = view.kind === 'tier' ? billingEndsWhen(purchase?.billing ?? null) : null;
  return JSON.parse(JSON.stringify({ ...view, endsWhen: recordEndsWhen ?? view.endsWhen, purchase }));
}

/** A test-mode billing row whose renewal failed. */
const failedRow = (overrides: Record<string, unknown> = {}) => ({
  livemode: false,
  stripeSubscriptionId: 'sub_probe',
  subscriptionStatus: 'past_due',
  boughtTier: null,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: FAILED_AT,
  failedAttempts: 2,
  lastPaymentFailedAt: FAILED_AT,
  actionRequiredInvoiceUrl: null,
  endedAt: null,
  ...overrides,
});

async function show(payload: PlanPayload, language: Lang = 'en') {
  mockLang.language = language;
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: payload }) })) as unknown as typeof fetch;
  const view = render(<PlanSection />);
  await waitFor(() => expect(screen.queryByText(translations[language]['plan.loading'])).not.toBeInTheDocument());
  return view;
}

beforeEach(() => {
  mockLang.language = 'en';
  mockLang.timezone = 'UTC';
});

describe('Settings → Plan, a failed renewal (P-6a.2)', () => {
  it('payment_failed: the date on the account clock, the attempts, and where the card link is (no Update card button, Q-6)', async () => {
    mockLang.timezone = 'Asia/Jerusalem';
    const payload = await payloadFor({ billingRow: failedRow() });
    expect(payload.purchase?.billing).toEqual({ state: 'payment_failed', date: FAILED_AT, attempts: 2 });
    await show(payload);
    expect(screen.getByText("Your payment on November 13, 2099 didn't go through. Stripe will try again automatically (attempts so far: 2).")).toBeInTheDocument();
    expect(screen.getByTestId('plan-update-card-email')).toHaveTextContent(translations.en['plan.update_card_email']);
    expect(screen.queryByRole('button', { name: /update card/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('plan-confirm-payment')).not.toBeInTheDocument();
  });

  it('action_required: the due date and a "Confirm payment" link to Stripe\'s page, in a new tab', async () => {
    const payload = await payloadFor({ billingRow: failedRow({ actionRequiredInvoiceUrl: URL, failedAttempts: 1 }) });
    expect(payload.purchase?.billing).toEqual({ state: 'action_required', date: FAILED_AT, confirmUrl: URL });
    await show(payload);
    expect(screen.getByText('Your bank asked you to confirm the payment due on November 12, 2099.')).toBeInTheDocument();
    const link = screen.getByTestId('plan-confirm-payment');
    expect(link).toHaveAttribute('href', URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveTextContent('Confirm payment');
    expect(screen.queryByTestId('plan-update-card-email')).not.toBeInTheDocument();
  });

  it('ended while paused: "Your subscription ended on <date>."', async () => {
    const endedAt = new Date(Date.now() - 2 * DAY).toISOString();
    const payload = await payloadFor({
      billingRow: failedRow({ subscriptionStatus: 'canceled', endedAt }),
      tierExpiresAt: new Date(Date.now() - 20 * DAY).toISOString(),
    });
    expect(payload.purchase?.billing).toEqual({ state: 'ended', date: endedAt });
    await show(payload);
    expect(screen.getByText(/^Your subscription ended on \w+ \d+, \d{4}\.$/)).toBeInTheDocument();
  });

  it('the price switch off: the failure is not described (production today)', async () => {
    const payload = await payloadFor({ billingRow: failedRow(), switchesOn: false });
    expect(payload.purchase?.billing).toBeNull();
    await show(payload);
    expect(screen.queryByTestId('plan-update-card-email')).not.toBeInTheDocument();
    expect(screen.queryByText(/attempts so far/)).not.toBeInTheDocument();
  });

  it.each([
    ['he', 'rtl'],
    ['es', 'ltr'],
  ] as Array<[Lang, string]>)('%s: the sentence and the card line in that language (%s), no English left', async (language, dir) => {
    const payload = await payloadFor({ billingRow: failedRow(), language });
    const { container } = await show(payload, language);
    const copy = translations[language];
    expect(screen.getByTestId('plan-update-card-email')).toHaveTextContent(copy['plan.update_card_email']);
    expect(container.querySelector(`[dir="${dir}"]`)).not.toBeNull();
    const sentence = copy['plan.payment_failed_on'].split('{date}')[0];
    expect(screen.getByText((text) => text.startsWith(sentence) && text.includes('2'))).toBeInTheDocument();
    expect(container.textContent).not.toContain("didn't go through");
    expect(container.textContent).not.toContain('Stripe sent you');
  });
});
