/**
 * @jest-environment jsdom
 *
 * Buying from the Top up panel (credits boost slice 5b.1; FR-7 to FR-12; SA
 * C-2, C-4, C-5; 5a N-2). Stripe's embedded checkout is mocked; every request
 * the panel makes is recorded, so "nothing but the package id" and "one
 * checkout per click" are checked on the wire.
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { BoostPackagesPayload, BoostPackageView } from '@/lib/business-os/boost/boostPackagesTypes';

type Lang = 'en' | 'he' | 'es';
const mockLang: { language: Lang } = { language: 'en' };

jest.mock('@/lib/business-os/LanguageContext', () => {
  const { translations } = jest.requireActual('@/lib/business-os/LanguageContext');
  return {
    useLanguage: () => ({
      language: mockLang.language,
      isRTL: mockLang.language === 'he',
      t: (key: string, vars?: Record<string, string | number>) => {
        let text: string = translations[mockLang.language][key] || key;
        for (const [name, value] of Object.entries(vars ?? {})) text = text.split(`{${name}}`).join(String(value));
        return text;
      },
      timeZoneOptions: (options: Intl.DateTimeFormatOptions = {}) => ({ ...options, timeZone: 'UTC' }),
    }),
  };
});
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger, clientLogger: logger };
});
jest.mock('@/lib/supabaseClient', () => ({ supabase: {} }));

const mockLoadStripe = jest.fn(async () => ({ stripe: true }));
jest.mock('@stripe/stripe-js', () => ({ loadStripe: (...args: unknown[]) => mockLoadStripe(...(args as [])) }));
const mockProviderProps: Array<{ options: { clientSecret: string } }> = [];
jest.mock('@stripe/react-stripe-js', () => ({
  EmbeddedCheckoutProvider: (props: { options: { clientSecret: string }; children: unknown }) => {
    mockProviderProps.push(props);
    return <div data-testid="stripe-provider">{props.children as never}</div>;
  },
  EmbeddedCheckout: () => <div data-testid="stripe-embedded-checkout" />,
}));

import { BoostPackagesPanel } from '@/components/business-os/BoostPackagesPanel';
import { codeBoostPackageSource } from '@/lib/business-os/entitlements/boostCatalogue';
import { toBoostPackageView } from '@/lib/business-os/boost/boostPackagesView';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as { translations: Record<Lang, Record<string, string>> };
const tr = (key: string) => translations[mockLang.language][key];

let SHIPPED: BoostPackageView[] = [];
beforeAll(async () => {
  SHIPPED = (await codeBoostPackageSource().listActive()).map(toBoostPackageView);
});

type Reply = { status: number; body: unknown } | 'hang' | 'throw';
const PACKAGES = '/api/business-os/credits/boost/packages';
const CHECKOUT = '/api/business-os/credits/boost/checkout';
let packageReplies: Reply[] = [];
let checkoutReplies: Reply[] = [];
let calls: Array<{ url: string; init?: RequestInit }> = [];

function installFetch() {
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const queue = String(url) === CHECKOUT ? checkoutReplies : packageReplies;
    const reply = queue.length > 1 ? queue.shift()! : queue[0];
    if (reply === 'hang') return new Promise(() => {});
    if (reply === 'throw') throw new TypeError('Failed to fetch');
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body };
  }) as unknown as typeof fetch;
}

const ok = (data: unknown): Reply => ({ status: 200, body: { success: true, data } });
const payload = (over: Partial<BoostPackagesPayload> = {}): BoostPackagesPayload => ({ packages: SHIPPED, purchaseAvailable: true, ...over });
const checkoutCalls = () => calls.filter((c) => c.url === CHECKOUT);
const SECRET = 'cs_test_abc_secret_xyz';

async function openPanel(packages: Reply = ok(payload())) {
  packageReplies = [packages];
  installFetch();
  render(<BoostPackagesPanel open onOpenChange={() => {}} />);
  await waitFor(() => expect(screen.queryByTestId('boost-packages-loading')).not.toBeInTheDocument());
}

const ENV = { ...process.env };
beforeEach(() => {
  mockLang.language = 'en';
  calls = [];
  packageReplies = [];
  checkoutReplies = [ok({ clientSecret: SECRET, purchaseId: '44444444-4444-4444-8444-444444444444', expiresAt: '2026-10-08T12:31:00.000Z' })];
  mockProviderProps.length = 0;
  mockLoadStripe.mockClear();
  process.env = { ...ENV, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_browser' };
});
afterAll(() => {
  process.env = ENV;
});

describe('Buy (5b.1)', () => {
  it('a click sends exactly one POST with { packageId } and nothing else, then mounts the embedded checkout with the client secret', async () => {
    await openPanel();
    fireEvent.click(screen.getAllByTestId('boost-package-buy')[1]);
    await waitFor(() => expect(screen.getByTestId('stripe-embedded-checkout')).toBeInTheDocument());
    expect(checkoutCalls()).toHaveLength(1);
    const call = checkoutCalls()[0];
    expect(call.init?.method).toBe('POST');
    expect(JSON.parse(String(call.init?.body))).toEqual({ packageId: SHIPPED[1].id });
    expect(mockProviderProps[mockProviderProps.length - 1].options).toEqual({ clientSecret: SECRET });
    expect(mockLoadStripe).toHaveBeenCalledWith('pk_test_browser');
    expect(screen.getByTestId('boost-checkout-summary')).toHaveTextContent('Plus');
    expect(screen.queryByTestId('boost-packages-list')).not.toBeInTheDocument();
    // The client secret is never printed on the page.
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it('SA C-4: a double click (two clicks across microtasks) sends ONE checkout', async () => {
    checkoutReplies = ['hang'];
    await openPanel();
    const buy = screen.getAllByTestId('boost-package-buy')[0];
    await act(async () => {
      fireEvent.click(buy);
      await Promise.resolve();
      fireEvent.click(buy);
      await Promise.resolve();
      fireEvent.click(screen.getAllByTestId('boost-package-buy')[2]);
    });
    expect(checkoutCalls()).toHaveLength(1);
    expect(screen.getAllByTestId('boost-package-buy')[0]).toHaveTextContent(tr('usage.boost.buying'));
    for (const button of screen.getAllByTestId('boost-package-buy')) expect(button).toBeDisabled();
  });

  it('SA C-4: the guard stays held while the form is open, and is re-armed on Back', async () => {
    await openPanel();
    fireEvent.click(screen.getAllByTestId('boost-package-buy')[0]);
    await waitFor(() => expect(screen.getByTestId('stripe-embedded-checkout')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('boost-checkout-back'));
    expect(screen.getByTestId('boost-packages-list')).toBeInTheDocument();
    fireEvent.click(screen.getAllByTestId('boost-package-buy')[0]);
    await waitFor(() => expect(screen.getByTestId('stripe-embedded-checkout')).toBeInTheDocument());
    expect(checkoutCalls()).toHaveLength(2);
  });

  it('a failed request re-arms the guard: the owner can try again', async () => {
    checkoutReplies = [{ status: 502, body: { success: false, error: 'checkout_unavailable' } }, ok({ clientSecret: SECRET })];
    await openPanel();
    fireEvent.click(screen.getAllByTestId('boost-package-buy')[0]);
    await waitFor(() => expect(screen.getByTestId('boost-checkout-error')).toHaveTextContent(tr('usage.boost.error.generic')));
    fireEvent.click(screen.getAllByTestId('boost-package-buy')[0]);
    await waitFor(() => expect(screen.getByTestId('stripe-embedded-checkout')).toBeInTheDocument());
    expect(checkoutCalls()).toHaveLength(2);
  });

  it('purchaseAvailable false: no checkout call ever', async () => {
    await openPanel(ok(payload({ purchaseAvailable: false })));
    for (const buy of screen.getAllByTestId('boost-package-buy')) fireEvent.click(buy);
    await act(async () => {
      await Promise.resolve();
    });
    expect(checkoutCalls()).toHaveLength(0);
  });

  it('SA C-2 defence in depth: no publishable key → a friendly line, no form, Stripe.js never loaded', async () => {
    delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    await openPanel();
    fireEvent.click(screen.getAllByTestId('boost-package-buy')[0]);
    await waitFor(() => expect(screen.getByTestId('boost-checkout-no-key')).toHaveTextContent(tr('usage.boost.error.payments_unavailable')));
    expect(screen.queryByTestId('stripe-embedded-checkout')).not.toBeInTheDocument();
    expect(mockLoadStripe).not.toHaveBeenCalled();
  });
});

describe('every checkout refusal has its own line, never the raw code', () => {
  it.each([
    ['409 cap_reached with figures (SA C-5)', { status: 409, body: { success: false, error: 'cap_reached', capMinor: 15000, windowDays: 30 } },
      "You've reached the top-up limit for now ($150 in 30 days). Contact support if you need more."],
    ['409 cap_reached without figures', { status: 409, body: { success: false, error: 'cap_reached' } },
      "You've reached the top-up limit for now. Contact support if you need more."],
    ['409 awaiting_payment', { status: 409, body: { success: false, error: 'awaiting_payment' } }, 'Finish setting up your plan payment first.'],
    ['403 not_eligible', { status: 403, body: { success: false, error: 'not_eligible' } }, "Top-ups aren't available for this account yet."],
    ['404 (switch turned off)', { status: 404, body: { success: false, error: 'Not found' } }, "This package isn't available right now. Please reopen Top up."],
    ['404 unknown_package', { status: 404, body: { success: false, error: 'unknown_package' } }, "This package isn't available right now. Please reopen Top up."],
    ['503 catalogue_unavailable', { status: 503, body: { success: false, error: 'catalogue_unavailable' } }, "We couldn't start the payment. Please try again in a moment."],
    ['502 checkout_unavailable', { status: 502, body: { success: false, error: 'checkout_unavailable' } }, "We couldn't start the payment. Please try again in a moment."],
    ['500 payments_unavailable', { status: 500, body: { success: false, error: 'payments_unavailable' } }, "We couldn't start the payment. Please try again in a moment."],
    ['401', { status: 401, body: { success: false, error: 'Unauthorized' } }, 'Please sign in again.'],
    ['a network failure', 'throw', "We couldn't start the payment. Please try again in a moment."],
    ['a 200 without a client secret', { status: 200, body: { success: true, data: {} } }, "We couldn't start the payment. Please try again in a moment."],
  ] as Array<[string, Reply, string]>)('%s', async (_name, reply, text) => {
    checkoutReplies = [reply];
    await openPanel();
    fireEvent.click(screen.getAllByTestId('boost-package-buy')[0]);
    await waitFor(() => expect(screen.getByTestId('boost-checkout-error')).toHaveTextContent(text));
    expect(screen.queryByTestId('stripe-embedded-checkout')).not.toBeInTheDocument();
    for (const code of ['cap_reached', 'awaiting_payment', 'not_eligible', 'checkout_unavailable']) {
      expect(screen.getByTestId('boost-checkout-error').textContent).not.toContain(code);
    }
  });

  it('a 404 re-reads the packages (the switch may have changed)', async () => {
    checkoutReplies = [{ status: 404, body: { success: false, error: 'Not found' } }];
    await openPanel();
    fireEvent.click(screen.getAllByTestId('boost-package-buy')[0]);
    await waitFor(() => expect(calls.filter((c) => c.url === PACKAGES)).toHaveLength(2));
  });

  it('Hebrew: the cap line uses the server figures in Hebrew format, inside an RTL sheet', async () => {
    mockLang.language = 'he';
    checkoutReplies = [{ status: 409, body: { success: false, error: 'cap_reached', capMinor: 15000, windowDays: 30 } }];
    await openPanel();
    expect(screen.getByTestId('boost-packages-panel')).toHaveAttribute('dir', 'rtl');
    expect(screen.getAllByTestId('boost-package-buy')[0]).toHaveTextContent('קנייה');
    fireEvent.click(screen.getAllByTestId('boost-package-buy')[0]);
    await waitFor(() => expect(screen.getByTestId('boost-checkout-error').textContent).toContain('30'));
    expect(screen.getByTestId('boost-checkout-error').textContent).toContain('150');
  });
});

describe('accessibility (5a N-1, N-2)', () => {
  it('the sheet has a description (the intro line) and no Buy carries a tooltip', async () => {
    await openPanel();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleDescription(tr('usage.boost.intro'));
    for (const buy of screen.getAllByTestId('boost-package-buy')) expect(buy).not.toHaveAttribute('title');
  });
});

describe('QA R-2: the cap line names only the server\'s cap and window, never the counted spend', () => {
  const norm = (text: string | null | undefined) => (text ?? '').replace(/[\s\u00a0\u202f]+/g, ' ').trim();
  it.each<[string, Reply, string]>([
    ['an override cap ($300)', { status: 409, body: { success: false, error: 'cap_reached', capMinor: 30000, windowDays: 30 } },
      "You've reached the top-up limit for now ($300 in 30 days). Contact support if you need more."],
    ['odd cents and a short window', { status: 409, body: { success: false, error: 'cap_reached', capMinor: 12550, windowDays: 7 } },
      "You've reached the top-up limit for now ($125.50 in 7 days). Contact support if you need more."],
    ['the counted amount only', { status: 409, body: { success: false, error: 'cap_reached', countedMinor: 14000 } },
      "You've reached the top-up limit for now. Contact support if you need more."],
    ['figures as strings', { status: 409, body: { success: false, error: 'cap_reached', capMinor: '15000', windowDays: 30 } },
      "You've reached the top-up limit for now. Contact support if you need more."],
    ['a zero-day window', { status: 409, body: { success: false, error: 'cap_reached', capMinor: 15000, windowDays: 0 } },
      "You've reached the top-up limit for now. Contact support if you need more."],
  ])('%s', async (_name, reply, text) => {
    checkoutReplies = [{ ...(reply as { status: number; body: Record<string, unknown> }), body: { ...(reply as { body: Record<string, unknown> }).body, countedMinor: 14000 } }];
    await openPanel();
    fireEvent.click(screen.getAllByTestId('boost-package-buy')[1]);
    const line = await screen.findByTestId('boost-checkout-error');
    expect(norm(line.textContent)).toBe(norm(text));
    expect(line.textContent).not.toMatch(/14,?000|\$140\b|cap_reached/);
  });
});

describe('QA R-5: Back and closing the sheet both unmount the form, and allow exactly one more checkout', () => {
  it('Back: the form goes, the list returns, one more click is one more POST', async () => {
    await openPanel();
    fireEvent.click(screen.getAllByTestId('boost-package-buy')[1]);
    await screen.findByTestId('stripe-embedded-checkout');
    fireEvent.click(screen.getByTestId('boost-checkout-back'));
    expect(screen.queryByTestId('stripe-embedded-checkout')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('boost-package')).toHaveLength(3);
    fireEvent.click(screen.getAllByTestId('boost-package-buy')[0]);
    fireEvent.click(screen.getAllByTestId('boost-package-buy')[0]);
    await screen.findByTestId('stripe-embedded-checkout');
    expect(checkoutCalls()).toHaveLength(2);
  });

  it('closing the sheet mid-checkout and reopening: the form is gone, the list is back, one more click is one more POST', async () => {
    packageReplies = [ok(payload())];
    installFetch();
    const view = render(<BoostPackagesPanel open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getAllByTestId('boost-package')).toHaveLength(3));
    fireEvent.click(screen.getAllByTestId('boost-package-buy')[1]);
    await screen.findByTestId('stripe-embedded-checkout');
    view.rerender(<BoostPackagesPanel open={false} onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.queryByTestId('stripe-embedded-checkout')).not.toBeInTheDocument());
    view.rerender(<BoostPackagesPanel open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getAllByTestId('boost-package')).toHaveLength(3));
    expect(screen.queryByTestId('stripe-embedded-checkout')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByTestId('boost-package-buy')[0]);
    fireEvent.click(screen.getAllByTestId('boost-package-buy')[0]);
    await screen.findByTestId('stripe-embedded-checkout');
    expect(checkoutCalls()).toHaveLength(2);
  });
});
