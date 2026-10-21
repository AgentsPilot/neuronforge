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
 *
 * Plan payments P-5a.2 (workplan §3.3, §8 "Page"): held shows one of coming
 * soon (any switch off: the 5b screen, unchanged), Pay, or Processing, from
 * the screen model (`readHeldPaymentView`, faked here; it has its own suite).
 * The shared embedded checkout runs for real over a fake Stripe.js and a fake
 * `fetch`, so a refused start is shown localized by code (W-10).
 */

import '@testing-library/jest-dom';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { ReactNode } from 'react';

const hold: { value: unknown } = { value: { state: 'signed_out' } };
jest.mock('@/lib/business-os/invites/paymentHoldGate', () => ({
  readHoldForSession: async () => hold.value,
}));

// The screen model: its own suite pins its rules; here it only picks the state.
const view: { value: unknown; inputs: unknown[] } = { value: { kind: 'coming_soon' }, inputs: [] };
jest.mock('@/lib/business-os/billing/heldPaymentView', () => ({
  readHeldPaymentView: async (input: unknown) => {
    view.inputs.push(input);
    return view.value;
  },
}));

const redirects: string[] = [];
const routerCalls: Array<[string, ...unknown[]]> = [];
jest.mock('next/navigation', () => ({
  redirect: (path: string) => {
    redirects.push(path);
    throw new Error('NEXT_REDIRECT');
  },
  useRouter: () => ({
    refresh: () => routerCalls.push(['refresh']),
    replace: (href: string) => routerCalls.push(['replace', href]),
  }),
}));

// Stripe.js and its React bindings: a fake frame that can complete on demand.
const stripeState: { completes: Array<() => void>; mounted: string[] } = { completes: [], mounted: [] };
jest.mock('@/lib/client/stripeJs', () => ({ getStripePromise: () => Promise.resolve({}) }));
jest.mock('@stripe/react-stripe-js', () => ({
  EmbeddedCheckoutProvider: ({ options, children }: { options: { clientSecret: string; onComplete?: () => void }; children: ReactNode }) => {
    stripeState.mounted.push(options.clientSecret);
    if (options.onComplete) stripeState.completes.push(options.onComplete);
    return <div data-testid="fake-stripe-provider">{children}</div>;
  },
  EmbeddedCheckout: () => <div data-testid="fake-stripe-checkout" />,
}));

const signOuts: unknown[] = [];
let signOutResult: { ok: boolean; clearedLocally?: boolean } = { ok: true };
jest.mock('@/lib/client/auth-actions', () => ({
  signOutUser: async (options: unknown) => {
    signOuts.push(options);
    return signOutResult;
  },
}));

import AwaitingPaymentPage from '../awaiting-payment/page';
import { AWAITING_PAYMENT_COPY, HELD_PAYMENT_REFUSAL_COPY } from '../awaitingPaymentCopy';

async function renderPage(searchParams?: Record<string, string | string[] | undefined>) {
  render(await AwaitingPaymentPage(searchParams ? { searchParams } : undefined));
}

const INVITE = '66666666-6666-4666-8666-666666666666';
const USER = '11111111-1111-4111-8111-111111111111';
const FRIEND_HOLD = { ok: true, held: true, inviteId: INVITE, source: 'account_invite' };
const held = (language: string) => ({ state: 'held', language, hold: FRIEND_HOLD, userId: USER, accountId: USER });
// The tier and price arrive as DATA from the screen model; these are fixture values.
const PAY_VIEW = { kind: 'pay', tier: 'tier_from_the_model', planName: 'Essentials', monthlyPriceUsd: 79 };

const fetchCalls: Array<{ url: string; body: unknown }> = [];
let fetchReply: { status: number; body: unknown } = { status: 200, body: {} };

beforeEach(() => {
  redirects.length = 0;
  signOuts.length = 0;
  signOutResult = { ok: true };
  view.value = { kind: 'coming_soon' };
  view.inputs.length = 0;
  routerCalls.length = 0;
  stripeState.completes.length = 0;
  stripeState.mounted.length = 0;
  fetchCalls.length = 0;
  fetchReply = { status: 200, body: {} };
  global.fetch = jest.fn(async (url: string, init?: { body?: string }) => {
    fetchCalls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    return { ok: fetchReply.status === 200, status: fetchReply.status, json: async () => fetchReply.body } as Response;
  }) as unknown as typeof fetch;
});

describe('held (FR-35)', () => {
  it('says payment is coming soon, with no checkout, price or plan name', async () => {
    hold.value = held('en');
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
    hold.value = held('he');
    await renderPage();
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('dir', 'rtl');
    expect(main).toHaveAttribute('lang', 'he');
    expect(screen.getByTestId('awaiting-payment-held')).toHaveTextContent(AWAITING_PAYMENT_COPY.he.heldHeading);
  });

  it('Sign out signs out and goes to the normal sign-in page', async () => {
    hold.value = held('en');
    const assign = jest.fn();
    Object.defineProperty(window, 'location', { value: { ...window.location, assign }, writable: true });
    await renderPage();
    await userEvent.setup().click(screen.getByTestId('awaiting-payment-sign-out'));
    expect(signOuts).toEqual([{ scope: 'local', method: 'awaiting-payment' }]);
    expect(assign).toHaveBeenCalledWith(expect.stringMatching(/\/login$/));
  });

  it('a failed sign out says so and stays', async () => {
    hold.value = held('en');
    signOutResult = { ok: false };
    await renderPage();
    await userEvent.setup().click(screen.getByTestId('awaiting-payment-sign-out'));
    expect(await screen.findByRole('alert')).toHaveTextContent(AWAITING_PAYMENT_COPY.en.signOutFailed);
  });

  /*
   * Slice C-c (SA-CC-7): the server did not confirm, but this browser IS signed
   * out. After a hung request a retry cannot succeed (the auth lock is held),
   * so the friend goes on to sign-in instead of seeing "failed".
   */
  it('server unconfirmed but cleared locally: goes on to sign-in, no failure shown', async () => {
    hold.value = held('en');
    signOutResult = { ok: false, clearedLocally: true };
    const assign = jest.fn();
    Object.defineProperty(window, 'location', { value: { ...window.location, assign }, writable: true });
    await renderPage();
    await userEvent.setup().click(screen.getByTestId('awaiting-payment-sign-out'));
    expect(assign).toHaveBeenCalledWith(expect.stringMatching(/\/login$/));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('not cleared locally either: failure shown, button enabled for a retry, no navigation', async () => {
    hold.value = held('en');
    signOutResult = { ok: false, clearedLocally: false };
    const assign = jest.fn();
    Object.defineProperty(window, 'location', { value: { ...window.location, assign }, writable: true });
    await renderPage();
    await userEvent.setup().click(screen.getByTestId('awaiting-payment-sign-out'));
    expect(await screen.findByRole('alert')).toHaveTextContent(AWAITING_PAYMENT_COPY.en.signOutFailed);
    expect(screen.getByTestId('awaiting-payment-sign-out')).toBeEnabled();
    expect(assign).not.toHaveBeenCalled();
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

  it('P-5a.2: every locale keeps the {price} and {time} placeholders', () => {
    for (const locale of ['en', 'he', 'es'] as const) {
      expect(AWAITING_PAYMENT_COPY[locale].payPrice.split('{price}')).toHaveLength(2);
      expect(AWAITING_PAYMENT_COPY[locale].refusalCheckoutOpen.split('{time}')).toHaveLength(2);
    }
  });

  it('P-5a.2 (W-10): every refusal code maps to a refusal line that exists', () => {
    for (const key of Object.values(HELD_PAYMENT_REFUSAL_COPY)) {
      expect(key.startsWith('refusal')).toBe(true);
      expect(AWAITING_PAYMENT_COPY.en[key].length).toBeGreaterThan(0);
    }
  });
});

describe('P-5a.2 held: Pay (FR-35, BQ-P5, AC-F2.7)', () => {
  it.each(['en', 'he', 'es'] as const)('%s: "Finish your payment", the plan name, the price excluding tax, and Pay', async (locale) => {
    hold.value = held(locale);
    view.value = PAY_VIEW;
    await renderPage();
    const copy = AWAITING_PAYMENT_COPY[locale];
    const pay = screen.getByTestId('awaiting-payment-pay');
    expect(pay).toHaveTextContent(copy.payTitle);
    expect(screen.getByTestId('awaiting-payment-plan')).toHaveTextContent('Essentials');
    expect(screen.getByTestId('awaiting-payment-price')).toHaveTextContent(copy.payPrice.replace('{price}', '$79'));
    expect(screen.getByTestId('awaiting-payment-checkout-start')).toHaveTextContent(copy.payButton);
    expect(screen.getByTestId('awaiting-payment-sign-out')).toBeInTheDocument();
    // Not the coming-soon screen.
    expect(screen.queryByText(copy.title)).not.toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('dir', locale === 'he' ? 'rtl' : 'ltr');
    expect(redirects).toEqual([]);
  });

  it('the screen model is asked with the SESSION ids, the hold and the invite language', async () => {
    hold.value = held('he');
    await renderPage();
    expect(view.inputs).toEqual([{ userId: USER, accountId: USER, hold: FRIEND_HOLD, language: 'he', checkoutReturned: false }]);
  });

  it('Pay POSTs exactly { tier, returnTo: awaiting_payment } and mounts the checkout; completion goes to the marker URL', async () => {
    hold.value = held('en');
    view.value = PAY_VIEW;
    fetchReply = {
      status: 200,
      body: { success: true, data: { clientSecret: 'cs_test_secret_x', sessionId: 'cs_test_abc123', expiresAt: '2026-10-12T10:31:00.000Z', tier: PAY_VIEW.tier } },
    };
    await renderPage();
    await userEvent.setup().click(screen.getByTestId('awaiting-payment-checkout-start'));
    expect(fetchCalls).toEqual([{ url: '/api/business-os/billing/plan/checkout', body: { tier: PAY_VIEW.tier, returnTo: 'awaiting_payment' } }]);
    expect(await screen.findByTestId('fake-stripe-checkout')).toBeInTheDocument();
    expect(stripeState.mounted).toContain('cs_test_secret_x');
    expect(screen.getByTestId('awaiting-payment-pay').textContent).not.toContain('cs_test_secret_x');

    act(() => stripeState.completes[stripeState.completes.length - 1]());
    // The marker only changes what is shown; the server's hold re-read releases (P5-C6).
    expect(routerCalls).toEqual([['replace', '/invite/awaiting-payment?checkout=cs_test_abc123']]);
    expect(redirects).toEqual([]);
  });

  it.each(Object.entries(HELD_PAYMENT_REFUSAL_COPY).filter(([code]) => code !== 'checkout_open'))(
    'a refused start (%s) is shown localized by code, never the server message',
    async (code, key) => {
      hold.value = held('es');
      view.value = PAY_VIEW;
      fetchReply = { status: 409, body: { success: false, error: 'SERVER ENGLISH MESSAGE', code } };
      await renderPage();
      await userEvent.setup().click(screen.getByTestId('awaiting-payment-checkout-start'));
      const alert = await screen.findByTestId('awaiting-payment-refused');
      expect(alert).toHaveTextContent(AWAITING_PAYMENT_COPY.es[key]);
      expect(alert.textContent).not.toContain('SERVER ENGLISH MESSAGE');
    }
  );

  // P-4.1 M-3 (rewritten on purpose): the checkout now replaces the account's
  // own open window, so `checkout_open` reaches this screen only when that
  // window could not be checked or closed; it keeps its line. A window that
  // was already paid answers `checkout_processing`.
  it.each(['en', 'he', 'es'] as const)('P-4.1 M-3 %s: checkout_processing → the localized "already being processed" line, never the server message', async (locale) => {
    hold.value = held(locale);
    view.value = PAY_VIEW;
    fetchReply = { status: 409, body: { success: false, error: 'Your payment is being processed.', code: 'checkout_processing' } };
    await renderPage();
    await userEvent.setup().click(screen.getByTestId('awaiting-payment-checkout-start'));
    const alert = await screen.findByTestId('awaiting-payment-refused');
    expect(alert).toHaveTextContent(AWAITING_PAYMENT_COPY[locale].refusalProcessing);
    if (locale !== 'en') expect(alert.textContent).not.toContain('Your payment is being processed.');
    expect(screen.getByRole('main')).toHaveAttribute('dir', locale === 'he' ? 'rtl' : 'ltr');
  });

  it('P-4.1: the two new refusal codes have their own lines', () => {
    expect(HELD_PAYMENT_REFUSAL_COPY.checkout_processing).toBe('refusalProcessing');
    expect(HELD_PAYMENT_REFUSAL_COPY.free_access_no_end_date).toBe('refusalNotReady');
    expect(HELD_PAYMENT_REFUSAL_COPY.checkout_open).toBe('refusalCheckoutOpen');
  });

  it('checkout_open (the open window could not be checked) shows the local time from expiresAt', async () => {
    hold.value = held('en');
    view.value = PAY_VIEW;
    const expiresAt = '2026-10-12T10:31:00.000Z';
    fetchReply = { status: 409, body: { success: false, error: 'x', code: 'checkout_open', expiresAt } };
    await renderPage();
    await userEvent.setup().click(screen.getByTestId('awaiting-payment-checkout-start'));
    const time = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(expiresAt));
    expect(await screen.findByTestId('awaiting-payment-refused')).toHaveTextContent(AWAITING_PAYMENT_COPY.en.refusalCheckoutOpen.replace('{time}', time));
  });

  it('W-10: an unknown code, a 500 with no code, or a network failure → the generic line; a 401 → signed out', async () => {
    hold.value = held('he');
    view.value = PAY_VIEW;
    const user = userEvent.setup();
    fetchReply = { status: 409, body: { success: false, error: 'x', code: 'a_code_nobody_mapped' } };
    await renderPage();
    await user.click(screen.getByTestId('awaiting-payment-checkout-start'));
    expect(await screen.findByTestId('awaiting-payment-refused')).toHaveTextContent(AWAITING_PAYMENT_COPY.he.refusalGeneric);

    fetchReply = { status: 500, body: { success: false, error: 'Internal server error' } };
    await user.click(screen.getByTestId('awaiting-payment-checkout-start'));
    expect(await screen.findByTestId('awaiting-payment-refused')).toHaveTextContent(AWAITING_PAYMENT_COPY.he.refusalGeneric);

    fetchReply = { status: 401, body: { success: false, error: 'Unauthorized' } };
    await user.click(screen.getByTestId('awaiting-payment-checkout-start'));
    expect(await screen.findByText(AWAITING_PAYMENT_COPY.he.refusalSignedOut)).toBeInTheDocument();

    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    await user.click(screen.getByTestId('awaiting-payment-checkout-start'));
    expect(await screen.findByText(AWAITING_PAYMENT_COPY.he.refusalGeneric)).toBeInTheDocument();
  });
});

describe('P-5a.2 held: Processing (S5-6, W-7)', () => {
  it.each(['en', 'he', 'es'] as const)('%s: "Payment processing", NO Pay button, Sign out', async (locale) => {
    hold.value = held(locale);
    view.value = { kind: 'processing', delay: 'none', markerOnly: false };
    await renderPage();
    const copy = AWAITING_PAYMENT_COPY[locale];
    expect(screen.getByTestId('awaiting-payment-processing')).toHaveTextContent(copy.processingTitle);
    expect(screen.queryByTestId('awaiting-payment-checkout-start')).not.toBeInTheDocument();
    expect(screen.queryByTestId('awaiting-payment-pay')).not.toBeInTheDocument();
    expect(screen.getByTestId('awaiting-payment-sign-out')).toBeInTheDocument();
    expect(redirects).toEqual([]);
  });

  it('a well-formed return marker reaches the model as checkoutReturned; a malformed one is ignored', async () => {
    hold.value = held('en');
    await renderPage({ checkout: 'cs_test_abc123' });
    await renderPage({ checkout: 'cs_test_abc/../../x' });
    await renderPage({ checkout: ['cs_test_a', 'cs_test_b'] });
    await renderPage({ checkout: 'https://evil.example' });
    expect(view.inputs.map((input) => (input as { checkoutReturned: boolean }).checkoutReturned)).toEqual([true, false, false, false]);
  });

  it('stuck: the "taking longer" line at once, no refresh', async () => {
    hold.value = held('en');
    view.value = { kind: 'processing', delay: 'stuck', markerOnly: false };
    await renderPage();
    expect(screen.getByTestId('awaiting-payment-processing-slow')).toHaveTextContent(AWAITING_PAYMENT_COPY.en.processingSlow);
    expect(screen.queryByTestId('awaiting-payment-check-again')).not.toBeInTheDocument();
  });
});

describe('P-5a.2 release (P5-C6) and the error state', () => {
  it('not held redirects to onboarding even with a return marker; error never does, and never asks the model', async () => {
    hold.value = { state: 'not_held' };
    await expect(AwaitingPaymentPage({ searchParams: { checkout: 'cs_test_abc123' } })).rejects.toThrow('NEXT_REDIRECT');
    expect(redirects).toEqual(['/onboarding-chat']);

    redirects.length = 0;
    hold.value = { state: 'error' };
    await renderPage({ checkout: 'cs_test_abc123' });
    expect(screen.getByTestId('awaiting-payment-error')).toBeInTheDocument();
    expect(redirects).toEqual([]);
    expect(view.inputs).toEqual([]);
  });
});

describe('P-5a.2 source guards', () => {
  const read = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8');
  const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const FILES = [
    'app/invite/awaiting-payment/page.tsx',
    'app/invite/awaiting-payment/HeldPaymentCheckout.tsx',
    'app/invite/awaiting-payment/PaymentProcessingRefresher.tsx',
    'app/invite/awaitingPaymentCopy.ts',
  ];

  it.each(FILES)('%s imports nothing from the entitlements module and writes no console call', (file) => {
    const text = code(read(file));
    expect(text).not.toMatch(/business-os\/entitlements/);
    expect(text).not.toMatch(/console\./);
  });

  it('the islands are client components; the page is not', () => {
    expect(read('app/invite/awaiting-payment/HeldPaymentCheckout.tsx').trimStart().startsWith("'use client';")).toBe(true);
    expect(read('app/invite/awaiting-payment/PaymentProcessingRefresher.tsx').trimStart().startsWith("'use client';")).toBe(true);
    expect(read('app/invite/awaiting-payment/page.tsx')).not.toContain("'use client'");
  });

  // SA code review P-5a.2: what reaches the browser bundle never pulls in the
  // server side (CLAUDE.md rule 1). `awaitingPaymentCopy.ts` may only TYPE-import
  // from the billing module: a value import would bundle `planCheckout.ts` and,
  // through it, the repositories and the service-role client.
  it.each([
    'app/invite/awaiting-payment/HeldPaymentCheckout.tsx',
    'app/invite/awaiting-payment/PaymentProcessingRefresher.tsx',
    'app/invite/awaitingPaymentCopy.ts',
    'components/business-os/billing/PlanEmbeddedCheckout.tsx',
    'lib/client/stripeJs.ts',
  ])('%s (client bundle) imports no repository, no server-only module and no billing value', (file) => {
    const text = code(read(file));
    const valueImports = text.match(/^import\s+(?!type\s)[^;]*?from\s+'[^']+';/gms) ?? [];
    expect(valueImports.length + (text.match(/^import\s+type\s/gm) ?? []).length).toBeGreaterThan(0);
    for (const statement of valueImports) {
      expect(statement).not.toMatch(/lib\/repositories|supabaseServer|heldPaymentView|lib\/business-os\/billing|server-only/);
    }
    expect(text).not.toMatch(/^import\s+'server-only'/m);
  });

  it('the page writes no price literal and no tier name', () => {
    const text = code(read('app/invite/awaiting-payment/page.tsx'));
    expect(text).not.toMatch(/\b79\b/);
    expect(text).not.toMatch(/Essentials|Autopilot/);
  });
});

// ── Plan payments P-9.2: an ADMIN Paid invitee on the holding screen ──────────
// The screen is invite-neutral: the plan and price arrive as data from the
// model, which got the admin hold (with its `grantId`) from the session.

describe('P-9.2 held: an admin Paid invitee pays for the plan the admin chose', () => {
  const ADMIN_HOLD = { ok: true, held: true, inviteId: INVITE, source: 'admin_invite', grantId: 'top_tier_from_the_invite' };
  const ADMIN_PAY_VIEW = { kind: 'pay', tier: 'top_tier_from_the_invite', planName: 'Autopilot', monthlyPriceUsd: 129 };
  const heldAdmin = (language: string) => ({ state: 'held', language, hold: ADMIN_HOLD, userId: USER, accountId: USER });

  it('the screen model is asked with the admin hold, grantId included, never a client value', async () => {
    hold.value = heldAdmin('he');
    await renderPage();
    expect(view.inputs).toEqual([{ userId: USER, accountId: USER, hold: ADMIN_HOLD, language: 'he', checkoutReturned: false }]);
  });

  it.each(['en', 'he', 'es'] as const)('%s: "Finish your payment", the invited plan, its price (LTR inside RTL), and Pay for that tier', async (locale) => {
    hold.value = heldAdmin(locale);
    view.value = ADMIN_PAY_VIEW;
    fetchReply = { status: 200, body: { success: true, data: { clientSecret: 'cs_test_secret_a', sessionId: 'cs_test_admin1', expiresAt: '2026-10-14T10:31:00.000Z', tier: ADMIN_PAY_VIEW.tier } } };
    await renderPage();
    const copy = AWAITING_PAYMENT_COPY[locale];
    expect(screen.getByTestId('awaiting-payment-pay')).toHaveTextContent(copy.payTitle);
    expect(screen.getByTestId('awaiting-payment-plan')).toHaveTextContent('Autopilot');
    const price = screen.getByTestId('awaiting-payment-price');
    expect(price).toHaveTextContent(copy.payPrice.replace('{price}', '$129'));
    if (locale === 'he') {
      expect(screen.getByRole('main')).toHaveAttribute('dir', 'rtl');
      expect(price.querySelector('bdi[dir="ltr"]')?.textContent).toContain('$129');
    }
    await userEvent.setup().click(screen.getByTestId('awaiting-payment-checkout-start'));
    expect(fetchCalls).toEqual([{ url: '/api/business-os/billing/plan/checkout', body: { tier: ADMIN_PAY_VIEW.tier, returnTo: 'awaiting_payment' } }]);
  });

  it('coming soon when the model says so (a switch off, or the invited tier has no price)', async () => {
    hold.value = heldAdmin('en');
    view.value = { kind: 'coming_soon' };
    await renderPage();
    expect(screen.getByText(AWAITING_PAYMENT_COPY.en.title)).toBeInTheDocument();
    expect(screen.queryByTestId('awaiting-payment-checkout-start')).not.toBeInTheDocument();
  });
});
