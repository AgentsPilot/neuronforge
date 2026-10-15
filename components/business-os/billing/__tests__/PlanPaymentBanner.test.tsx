/**
 * @jest-environment jsdom
 *
 * The owner's plan payment banner (plan payments P-6a.2; workplan §5.6, §13):
 * each kind in en / he / es, Hebrew right to left, the pause date on the
 * account's clock, the confirm link opening Stripe's page with `noopener`,
 * and nothing at all for `null`.
 */

import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

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

import { PlanPaymentBanner } from '@/components/business-os/billing/PlanPaymentBanner';
import type { PaymentNoticeWire } from '@/lib/business-os/billing/planPaymentNotice';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};
const URL = 'https://invoice.stripe.com/i/acct_probe/test_banner?s=ap';
const PLAN_PATH = '/business-os/settings?section=plan';
const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (slot, name: string) => values[name] ?? slot);

beforeEach(() => {
  mockLang.language = 'en';
  mockLang.timezone = 'UTC';
});

describe('PlanPaymentBanner', () => {
  it('renders nothing for null', () => {
    const { container } = render(<PlanPaymentBanner notice={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('payment_failed without a pause date: the plain sentence and Plan settings', () => {
    render(<PlanPaymentBanner notice={{ kind: 'payment_failed', planLabel: 'Essentials', pauseBy: null }} />);
    expect(screen.getByRole('status')).toHaveTextContent("Your last payment for Essentials didn't go through. Please update your card to keep your plan.");
    expect(screen.getByRole('link', { name: 'Plan settings' })).toHaveAttribute('href', PLAN_PATH);
  });

  it('payment_failed in grace: "before <date>" on the account\'s clock', () => {
    mockLang.timezone = 'Asia/Jerusalem';
    render(<PlanPaymentBanner notice={{ kind: 'payment_failed', planLabel: 'Essentials', pauseBy: '2099-11-12T22:30:00.000Z' }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Please update your card before November 13, 2099 to keep your plan running.');
  });

  it('action_required: Confirm payment opens Stripe\'s hosted page in a new tab, noopener', () => {
    render(<PlanPaymentBanner notice={{ kind: 'action_required', planLabel: 'Essentials', confirmUrl: URL }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Your bank needs you to confirm your payment for Essentials.');
    const link = screen.getByRole('link', { name: 'Confirm payment' });
    expect(link).toHaveAttribute('href', URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByRole('link', { name: 'Plan settings' })).not.toBeInTheDocument();
  });

  it('paused and ended', () => {
    const { rerender } = render(<PlanPaymentBanner notice={{ kind: 'paused', planLabel: 'Essentials' }} />);
    expect(screen.getByRole('status')).toHaveTextContent("Your Essentials plan is paused because we couldn't take your payment.");
    rerender(<PlanPaymentBanner notice={{ kind: 'ended', planLabel: 'Essentials' }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Your Essentials subscription has ended. Choose a plan to continue.');
    expect(screen.getByRole('link', { name: 'Plan settings' })).toHaveAttribute('href', PLAN_PATH);
  });

  it('no plan label: the product name', () => {
    render(<PlanPaymentBanner notice={{ kind: 'ended', planLabel: null }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Your Business OS subscription has ended.');
  });

  const KINDS: Array<[string, PaymentNoticeWire, string]> = [
    ['payment_failed', { kind: 'payment_failed', planLabel: 'Essentials', pauseBy: null }, 'billing.notice.payment_failed'],
    ['payment_failed_by', { kind: 'payment_failed', planLabel: 'Essentials', pauseBy: '2099-11-12T12:00:00.000Z' }, 'billing.notice.payment_failed_by'],
    ['paused', { kind: 'paused', planLabel: 'Essentials' }, 'billing.notice.paused'],
    ['action_required', { kind: 'action_required', planLabel: 'Essentials', confirmUrl: URL }, 'billing.notice.action_required'],
    ['ended', { kind: 'ended', planLabel: 'Essentials' }, 'billing.notice.ended'],
  ];

  it.each((['he', 'es'] as Lang[]).flatMap((language) => KINDS.map(([name, notice, key]) => [language, name, notice, key] as const)))(
    '%s %s: the dictionary sentence, the right direction, no English',
    (language, _name, notice, key) => {
      mockLang.language = language;
      render(<PlanPaymentBanner notice={notice} />);
      const banner = screen.getByRole('status');
      expect(banner).toHaveAttribute('dir', language === 'he' ? 'rtl' : 'ltr');
      const before = fill(translations[language][key], { plan: 'Essentials' }).split('{date}')[0];
      expect(banner.textContent).toContain(before);
      expect(banner.textContent).not.toMatch(/didn't|Please|subscription|Confirm payment|Plan settings/);
    }
  );

  it('every banner and Settings key exists in en, he and es', () => {
    const keys = [
      'billing.notice.payment_failed',
      'billing.notice.payment_failed_by',
      'billing.notice.paused',
      'billing.notice.action_required',
      'billing.notice.confirm_payment',
      'billing.notice.ended',
      'billing.notice.open_plan',
      'billing.notice.plan_fallback',
      'plan.payment_failed_on',
      'plan.update_card_email',
      'plan.payment_action_required_on',
      'plan.ended_on',
    ];
    for (const language of ['en', 'he', 'es'] as Lang[]) {
      for (const key of keys) expect(translations[language][key]).toEqual(expect.any(String));
    }
  });
});
