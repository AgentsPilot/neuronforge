/**
 * @jest-environment jsdom
 *
 * The holding screen (Slice 5b; FR-24, FR-35, BQ-13; workplan D-10, SA R-4).
 *
 *   held       → the message in the invite's language (RTL for Hebrew) and
 *                Sign out; NO checkout, price, plan name or email promise;
 *   not held   → redirected to onboarding;
 *   signed out → a sign-in link only;
 *   error      → a neutral "try again" with Sign out, and NEVER a redirect
 *                (one failed read must not release a held friend, R-4).
 */

import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const hold: { value: unknown } = { value: { state: 'signed_out' } };
jest.mock('@/lib/business-os/invites/paymentHoldGate', () => ({
  readHoldForSession: async () => hold.value,
}));

const redirects: string[] = [];
jest.mock('next/navigation', () => ({
  redirect: (path: string) => {
    redirects.push(path);
    throw new Error('NEXT_REDIRECT');
  },
}));

const signOuts: unknown[] = [];
let signOutResult = { ok: true };
jest.mock('@/lib/client/auth-actions', () => ({
  signOutUser: async (options: unknown) => {
    signOuts.push(options);
    return signOutResult;
  },
}));

import AwaitingPaymentPage from '../awaiting-payment/page';
import { AWAITING_PAYMENT_COPY } from '../awaitingPaymentCopy';

async function renderPage() {
  render(await AwaitingPaymentPage());
}

beforeEach(() => {
  redirects.length = 0;
  signOuts.length = 0;
  signOutResult = { ok: true };
});

describe('held (FR-35)', () => {
  it('says payment is coming soon, with no checkout, price or plan name', async () => {
    hold.value = { state: 'held', language: 'en' };
    await renderPage();
    const section = screen.getByTestId('awaiting-payment-held');
    const copy = AWAITING_PAYMENT_COPY.en;
    expect(section).toHaveTextContent(copy.title);
    expect(section).toHaveTextContent(copy.heldHeading);
    expect(section).toHaveTextContent(copy.heldBody);
    expect(section.textContent).not.toMatch(/\$|[0-9]|checkout|pay now|Essentials|Autopilot|email you/i);
    expect(screen.queryAllByRole('link')).toEqual([]);
    expect(screen.getByTestId('awaiting-payment-sign-out')).toBeInTheDocument();
    expect(redirects).toEqual([]);
  });

  it('Hebrew is right to left, in Hebrew', async () => {
    hold.value = { state: 'held', language: 'he' };
    await renderPage();
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('dir', 'rtl');
    expect(main).toHaveAttribute('lang', 'he');
    expect(screen.getByTestId('awaiting-payment-held')).toHaveTextContent(AWAITING_PAYMENT_COPY.he.heldHeading);
  });

  it('Sign out signs out and goes to the normal sign-in page', async () => {
    hold.value = { state: 'held', language: 'en' };
    const assign = jest.fn();
    Object.defineProperty(window, 'location', { value: { ...window.location, assign }, writable: true });
    await renderPage();
    await userEvent.setup().click(screen.getByTestId('awaiting-payment-sign-out'));
    expect(signOuts).toEqual([{ scope: 'local', method: 'awaiting-payment' }]);
    expect(assign).toHaveBeenCalledWith(expect.stringMatching(/\/login$/));
  });

  it('a failed sign out says so and stays', async () => {
    hold.value = { state: 'held', language: 'en' };
    signOutResult = { ok: false };
    await renderPage();
    await userEvent.setup().click(screen.getByTestId('awaiting-payment-sign-out'));
    expect(await screen.findByRole('alert')).toHaveTextContent(AWAITING_PAYMENT_COPY.en.signOutFailed);
  });
});

describe('the other states', () => {
  it('not held: redirected to onboarding (nobody else belongs here)', async () => {
    hold.value = { state: 'not_held' };
    await expect(AwaitingPaymentPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirects).toEqual(['/onboarding-chat']);
  });

  it('signed out: a sign-in link only', async () => {
    hold.value = { state: 'signed_out' };
    await renderPage();
    expect(screen.getByTestId('awaiting-payment-sign-in')).toHaveAttribute('href', expect.stringMatching(/\/login$/));
    expect(screen.queryByTestId('awaiting-payment-sign-out')).not.toBeInTheDocument();
  });

  it('R-4: error is a neutral try-again with Sign out, and NEVER a redirect', async () => {
    hold.value = { state: 'error' };
    await renderPage();
    expect(screen.getByTestId('awaiting-payment-error')).toHaveTextContent(AWAITING_PAYMENT_COPY.en.errorHeading);
    expect(screen.getByTestId('awaiting-payment-try-again')).toHaveAttribute('href', '/invite/awaiting-payment');
    expect(screen.getByTestId('awaiting-payment-sign-out')).toBeInTheDocument();
    expect(redirects).toEqual([]);
  });
});

describe('copy', () => {
  it('every locale has every key, none empty, and he/es are translated', () => {
    const keys = Object.keys(AWAITING_PAYMENT_COPY.en);
    for (const locale of ['he', 'es'] as const) {
      expect(Object.keys(AWAITING_PAYMENT_COPY[locale]).sort()).toEqual([...keys].sort());
      for (const key of keys) {
        const value = AWAITING_PAYMENT_COPY[locale][key as keyof typeof AWAITING_PAYMENT_COPY.en];
        expect(value.length).toBeGreaterThan(0);
        expect(value).not.toBe(AWAITING_PAYMENT_COPY.en[key as keyof typeof AWAITING_PAYMENT_COPY.en]);
      }
    }
  });
});
