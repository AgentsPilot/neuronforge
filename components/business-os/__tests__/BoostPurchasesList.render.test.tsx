/**
 * @jest-environment jsdom
 *
 * The Purchases list in the Top up panel (credits boost slice 5b.2; FR-26,
 * FR-28, FR-29, BQ-B1; SA Q-3, Q-4). The real dictionary in en / he / es; the
 * business timezone comes through `timeZoneOptions`, as in the app.
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import type { BoostPurchaseView } from '@/lib/business-os/boost/boostPurchasesTypes';

type Lang = 'en' | 'he' | 'es';
const mockLang: { language: Lang; timezone: string } = { language: 'en', timezone: 'UTC' };

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
      // The business's saved timezone, exactly as LanguageContext supplies it.
      timeZoneOptions: (options: Intl.DateTimeFormatOptions = {}) => ({ ...options, timeZone: mockLang.timezone }),
    }),
  };
});
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger, clientLogger: logger };
});
jest.mock('@/lib/supabaseClient', () => ({ supabase: {} }));
jest.mock('@stripe/stripe-js', () => ({ loadStripe: jest.fn(async () => ({})) }));
jest.mock('@stripe/react-stripe-js', () => ({ EmbeddedCheckoutProvider: () => null, EmbeddedCheckout: () => null }));

import { BoostPurchasesList } from '@/components/business-os/BoostPurchasesList';
import { BoostPackagesPanel } from '@/components/business-os/BoostPackagesPanel';
import { notifyCreditUsageChanged } from '@/lib/business-os/client/creditUsageSignal';
import { codeBoostPackageSource } from '@/lib/business-os/entitlements/boostCatalogue';
import { toBoostPackageView } from '@/lib/business-os/boost/boostPackagesView';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as { translations: Record<Lang, Record<string, string>> };
const tr = (key: string) => translations[mockLang.language][key];
const norm = (text: string | null | undefined) => (text ?? '').replace(/[\s  ‎‏]+/g, ' ').trim();

const PLUS = { en: 'Plus', he: 'פלוס', es: 'Plus' };
const purchase = (over: Partial<BoostPurchaseView> = {}): BoostPurchaseView => ({
  id: '11111111-0000-4000-8000-000000000001',
  createdAt: '2026-10-08T22:30:00.000Z',
  paidAt: '2026-10-08T22:31:00.000Z',
  packageId: 'plus',
  name: PLUS,
  creditsTotal: 13750,
  creditsBonus: 1250,
  priceMinor: 2500,
  currency: 'usd',
  taxExclusive: true,
  status: 'credited',
  receiptUrl: 'https://pay.stripe.com/receipts/abc',
  kind: 'bought',
  ...over,
});

type Reply = { status: number; body: unknown };
let purchaseReplies: Reply[] = [];
let calls: string[] = [];
function installFetch(packagesReply?: Reply) {
  global.fetch = jest.fn(async (url: string) => {
    calls.push(String(url));
    const reply = String(url).includes('/boost/purchases')
      ? purchaseReplies.length > 1
        ? purchaseReplies.shift()!
        : purchaseReplies[0]
      : packagesReply!;
    return { ok: reply.status === 200, status: reply.status, json: async () => reply.body };
  }) as unknown as typeof fetch;
}
const list = (purchases: BoostPurchaseView[]): Reply => ({ status: 200, body: { success: true, data: { purchases } } });

async function show(purchases: BoostPurchaseView[]) {
  purchaseReplies = [list(purchases)];
  installFetch();
  render(<BoostPurchasesList open />);
  await waitFor(() => expect(calls.length).toBeGreaterThan(0));
  if (purchases.length > 0) {
    await screen.findByTestId('boost-purchases');
  } else {
    // Let the read and its JSON settle before asserting that nothing is shown.
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }
}

beforeEach(() => {
  mockLang.language = 'en';
  mockLang.timezone = 'UTC';
  calls = [];
});

describe('BoostPurchasesList', () => {
  it('no purchases → nothing at all (SA Q-3)', async () => {
    await show([]);
    expect(screen.queryByTestId('boost-purchases')).not.toBeInTheDocument();
    expect(screen.queryByTestId('boost-purchases-error')).not.toBeInTheDocument();
  });

  it('closed → no read', () => {
    purchaseReplies = [list([purchase()])];
    installFetch();
    render(<BoostPurchasesList open={false} />);
    expect(calls).toEqual([]);
  });

  it('one credited purchase: title, name, Bought, "Credits added", date, credits, price excl. tax, Receipt', async () => {
    await show([purchase()]);
    expect(screen.getByRole('heading', { name: 'Purchases' })).toBeInTheDocument();
    const row = screen.getByTestId('boost-purchase');
    expect(within(row).getByTestId('boost-purchase-name')).toHaveTextContent('Plus');
    expect(within(row).getByTestId('boost-purchase-bought')).toHaveTextContent('Bought');
    expect(within(row).getByTestId('boost-purchase-status')).toHaveTextContent('Credits added');
    expect(norm(within(row).getByTestId('boost-purchase-when').textContent)).toBe('Oct 8, 2026, 10:30 PM');
    expect(within(row).getByTestId('boost-purchase-credits')).toHaveTextContent('13,750 credits');
    expect(within(row).getByTestId('boost-purchase-price')).toHaveTextContent('$25 excl. tax');
    const receipt = within(row).getByTestId('boost-purchase-receipt');
    expect(receipt).toHaveTextContent('Receipt');
    expect(receipt).toHaveAttribute('href', 'https://pay.stripe.com/receipts/abc');
    expect(receipt).toHaveAttribute('target', '_blank');
    expect(receipt).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('the date is in the BUSINESS timezone, not the browser\'s', async () => {
    mockLang.timezone = 'Asia/Jerusalem';
    await show([purchase()]);
    expect(norm(screen.getByTestId('boost-purchase-when').textContent)).toBe('Oct 9, 2026, 01:30 AM');
  });

  it.each([
    ['credited', 'Credits added'],
    ['processing', 'Processing'],
    ['awaiting_payment', 'Pending'],
    ['failed', "Didn't go through"],
    ['expired', 'Expired'],
    ['refunded', 'Refunded'],
    ['partially_refunded', 'Partly refunded'],
    ['under_review', 'Payment under review'],
    ['reversed', 'Payment reversed'],
  ] as const)('status %s → "%s"', async (status, text) => {
    await show([purchase({ status })]);
    expect(screen.getByTestId('boost-purchase-status')).toHaveTextContent(text);
  });

  it.each([
    ['no link', null],
    ['an http link', 'http://pay.stripe.com/receipts/abc'],
    ['a javascript: link', 'javascript:alert(1)'],
    ['not a URL', 'receipt'],
  ])('%s → no Receipt link', async (_name, receiptUrl) => {
    await show([purchase({ receiptUrl })]);
    expect(screen.queryByTestId('boost-purchase-receipt')).not.toBeInTheDocument();
  });

  it('a retired package shows its id (SA Q-4)', async () => {
    await show([purchase({ name: null, packageId: 'starter_2025' })]);
    expect(screen.getByTestId('boost-purchase-name')).toHaveTextContent('starter_2025');
  });

  it('several purchases keep the server order (newest first)', async () => {
    await show([purchase({ id: 'b', status: 'processing' }), purchase({ id: 'a' })]);
    expect(screen.getAllByTestId('boost-purchase').map((row) => row.getAttribute('data-status'))).toEqual(['processing', 'credited']);
  });

  it.each([
    ['a 500', { status: 500, body: { success: false } }],
    ['a malformed row (a non-USD currency)', list([purchase({ currency: 'eur' })])],
    ['a malformed row (an unknown status)', list([{ ...purchase(), status: 'paid' } as unknown as BoostPurchaseView])],
  ])('%s → the error line with Try again, never an empty list', async (_name, reply) => {
    purchaseReplies = [reply as Reply];
    installFetch();
    render(<BoostPurchasesList open />);
    await waitFor(() => expect(screen.getByTestId('boost-purchases-error')).toHaveTextContent("We couldn't load your purchases."));
    expect(screen.queryByTestId('boost-purchases-list')).not.toBeInTheDocument();
  });

  it('Try again reads again and shows the list', async () => {
    purchaseReplies = [{ status: 500, body: { success: false } }, list([purchase()])];
    installFetch();
    render(<BoostPurchasesList open />);
    await waitFor(() => expect(screen.getByTestId('boost-purchases-error')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('boost-purchases-retry'));
    await waitFor(() => expect(screen.getByTestId('boost-purchases-list')).toBeInTheDocument());
    expect(calls).toHaveLength(2);
  });

  it('a purchase credited while the panel is open shows at once (the credit-usage signal)', async () => {
    purchaseReplies = [list([purchase({ status: 'processing' })]), list([purchase()])];
    installFetch();
    render(<BoostPurchasesList open />);
    await waitFor(() => expect(screen.getByTestId('boost-purchase-status')).toHaveTextContent('Processing'));
    act(() => notifyCreditUsageChanged());
    await waitFor(() => expect(screen.getByTestId('boost-purchase-status')).toHaveTextContent('Credits added'));
  });

  it('Spanish: its own words and Intl formats', async () => {
    mockLang.language = 'es';
    await show([purchase()]);
    expect(screen.getByRole('heading', { name: 'Compras' })).toBeInTheDocument();
    expect(screen.getByTestId('boost-purchase-status')).toHaveTextContent('Créditos añadidos');
    expect(norm(screen.getByTestId('boost-purchase-price').textContent)).toBe('25 US$ sin impuestos');
    expect(screen.getByTestId('boost-purchase-credits')).toHaveTextContent('13.750 créditos');
  });
});

describe('inside the Top up panel', () => {
  it('Hebrew: the section sits under the packages, in the RTL sheet, in Hebrew', async () => {
    mockLang.language = 'he';
    const packages = (await codeBoostPackageSource().listActive()).map(toBoostPackageView);
    purchaseReplies = [list([purchase()])];
    installFetch({ status: 200, body: { success: true, data: { packages, purchaseAvailable: false } } });
    render(<BoostPackagesPanel open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('boost-purchases')).toBeInTheDocument());
    expect(screen.getByTestId('boost-packages-panel')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading', { name: tr('usage.boost.purchases.title') })).toBeInTheDocument();
    expect(screen.getByTestId('boost-purchase-name')).toHaveTextContent('פלוס');
    expect(screen.getByTestId('boost-purchase-bought')).toHaveTextContent('נרכש');
    expect(screen.getByTestId('boost-purchase-status')).toHaveTextContent('הקרדיטים נוספו');
    // The list comes after the packages in the sheet.
    const packageList = screen.getByTestId('boost-packages-list');
    expect(packageList.compareDocumentPosition(screen.getByTestId('boost-purchases')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('an owner with no purchases sees the packages only', async () => {
    const packages = (await codeBoostPackageSource().listActive()).map(toBoostPackageView);
    purchaseReplies = [list([])];
    installFetch({ status: 200, body: { success: true, data: { packages, purchaseAvailable: false } } });
    render(<BoostPackagesPanel open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getAllByTestId('boost-package')).toHaveLength(3));
    await waitFor(() => expect(calls.some((url) => url.includes('/boost/purchases'))).toBe(true));
    expect(screen.queryByTestId('boost-purchases')).not.toBeInTheDocument();
  });
});

describe('QA 5b.2 R-2: a Receipt link only for a real https link', () => {
  it.each([
    ['data:', 'data:text/html,hi'],
    ['protocol-relative', '//evil.com/r'],
    ['empty', ''],
    ['malformed', 'https//'],
    ['ftp', 'ftp://pay.stripe.com/r'],
  ])('%s → no link', async (_name, receiptUrl) => {
    await show([purchase({ receiptUrl })]);
    expect(screen.queryByTestId('boost-purchase-receipt')).not.toBeInTheDocument();
  });
});

describe('QA 5b.2 R-3: dates across the business\'s daylight-saving change (Asia/Jerusalem, 25 Oct 2026)', () => {
  it('before, after and across the year end, all in the business clock', async () => {
    mockLang.timezone = 'Asia/Jerusalem';
    await show([
      purchase({ id: 'a', createdAt: '2026-10-24T22:30:00.000Z' }),
      purchase({ id: 'b', createdAt: '2026-10-25T00:30:00.000Z' }),
      purchase({ id: 'c', createdAt: '2026-12-31T22:30:00.000Z' }),
    ]);
    const whens = screen.getAllByTestId('boost-purchase-when').map((el) => norm(el.textContent));
    expect(whens).toEqual(['Oct 25, 2026, 01:30 AM', 'Oct 25, 2026, 02:30 AM', 'Jan 1, 2027, 12:30 AM']);
  });
});

describe('QA 5b.2 R-4: when the list reads', () => {
  const reads = () => calls.filter((url) => url.includes('/boost/purchases')).length;

  it('one read per open; the credit signal adds exactly one read while open and none after close', async () => {
    purchaseReplies = [list([purchase()])];
    installFetch();
    const view = render(<BoostPurchasesList open />);
    await screen.findByTestId('boost-purchase');
    expect(reads()).toBe(1);
    act(() => notifyCreditUsageChanged());
    await waitFor(() => expect(reads()).toBe(2));
    view.rerender(<BoostPurchasesList open={false} />);
    act(() => notifyCreditUsageChanged());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(reads()).toBe(2);
    view.rerender(<BoostPurchasesList open />);
    await waitFor(() => expect(reads()).toBe(3));
  });
});

describe('the catalogue fails: the purchases notice (user decision 2026-10-08)', () => {
  it.each([
    ['en', "Your purchases can't be shown right now either. Please check back later."],
    ['he', 'גם את הרכישות שלך אי אפשר להציג כרגע. כדאי לבדוק שוב מאוחר יותר.'],
    ['es', 'Tampoco podemos mostrar tus compras en este momento. Vuelve a consultarlo más tarde.'],
  ] as const)('%s: under the packages error line, and no purchases read', async (language, text) => {
    mockLang.language = language;
    purchaseReplies = [list([purchase()])];
    installFetch({ status: 503, body: { success: false, error: 'packages_unavailable' } });
    render(<BoostPackagesPanel open onOpenChange={() => {}} />);
    const notice = await screen.findByTestId('boost-purchases-unavailable');
    expect(norm(notice.textContent)).toBe(norm(text));
    expect(notice.textContent).not.toMatch(/[0-9]/);
    expect(screen.getByTestId('boost-packages-error')).toContainElement(notice);
    expect(screen.queryByTestId('boost-purchases')).not.toBeInTheDocument();
  });

  it('absent when the catalogue loads, whether or not there are purchases', async () => {
    const packages = (await codeBoostPackageSource().listActive()).map(toBoostPackageView);
    for (const purchases of [[], [purchase()]]) {
      calls = [];
      purchaseReplies = [list(purchases)];
      installFetch({ status: 200, body: { success: true, data: { packages, purchaseAvailable: false } } });
      const view = render(<BoostPackagesPanel open onOpenChange={() => {}} />);
      await waitFor(() => expect(screen.getAllByTestId('boost-package')).toHaveLength(3));
      await waitFor(() => expect(calls.some((url) => url.includes('/boost/purchases'))).toBe(true));
      expect(screen.queryByTestId('boost-purchases-unavailable')).not.toBeInTheDocument();
      view.unmount();
    }
  });
});

describe('BQ-1 (user decision 2026-10-08): a lost chargeback reads "Payment reversed"', () => {
  it.each([
    ['en', 'Payment reversed'],
    ['he', 'התשלום בוטל'],
    ['es', 'Pago revertido'],
  ] as const)('%s: the chip, with no digits', async (language, text) => {
    mockLang.language = language;
    await show([purchase({ status: 'reversed' })]);
    const chip = screen.getByTestId('boost-purchase-status');
    expect(chip).toHaveTextContent(text);
    expect(chip.textContent).not.toMatch(/[0-9]/);
  });

  it('an open dispute keeps "Payment under review"; refunds keep their own words', async () => {
    await show([purchase({ id: 'a', status: 'under_review' }), purchase({ id: 'b', status: 'refunded' }), purchase({ id: 'c', status: 'partially_refunded' })]);
    expect(screen.getAllByTestId('boost-purchase-status').map((el) => el.textContent)).toEqual(['Payment under review', 'Refunded', 'Partly refunded']);
  });
});
