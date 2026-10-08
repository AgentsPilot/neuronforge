/**
 * @jest-environment jsdom
 *
 * The Top up picker, as an owner reads it (credits boost slice 5a, workplan §6;
 * SA C-1, C-3, Q-1). Rendered with the REAL dictionary in en, he and es.
 * Payloads are built from the shipped catalogue (never typed figures), plus one
 * planted payload with odd figures that proves nothing is hand-written.
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

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

import { BoostPackagesPanel } from '@/components/business-os/BoostPackagesPanel';
import { codeBoostPackageSource } from '@/lib/business-os/entitlements/boostCatalogue';
import { toBoostPackageView } from '@/lib/business-os/boost/boostPackagesView';
import { formatMinorAmount } from '@/lib/business-os/currency';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};
const tr = (key: string, vars: Record<string, string> = {}) => {
  let text = translations[mockLang.language][key];
  for (const [name, value] of Object.entries(vars)) text = text.split(`{${name}}`).join(value);
  return text;
};
const norm = (text: string | null | undefined) => (text ?? '').replace(/[\s  ]+/g, ' ').trim();
const whole = (n: number) => new Intl.NumberFormat(mockLang.language, { maximumFractionDigits: 0 }).format(n);
const pct = (n: number) => new Intl.NumberFormat(mockLang.language, { style: 'percent', maximumFractionDigits: 2 }).format(n / 100);

let SHIPPED: BoostPackageView[] = [];
beforeAll(async () => {
  SHIPPED = (await codeBoostPackageSource().listActive()).map(toBoostPackageView);
});

type Reply = { ok: boolean; status: number; body: unknown };
let replies: Reply[] = [];
let fetchMock: jest.Mock;
const okReply = (data: unknown): Reply => ({ ok: true, status: 200, body: { success: true, data } });

function installFetch() {
  fetchMock = jest.fn(async () => {
    const reply = replies.length > 1 ? replies.shift()! : replies[0];
    return { ok: reply.ok, status: reply.status, json: async () => reply.body };
  });
  global.fetch = fetchMock as unknown as typeof fetch;
}

async function openWith(reply: Reply) {
  replies = [reply];
  installFetch();
  render(<BoostPackagesPanel open onOpenChange={() => {}} />);
  await waitFor(() => expect(screen.queryByTestId('boost-packages-loading')).not.toBeInTheDocument());
}

const payload = (over: Partial<BoostPackagesPayload> = {}): BoostPackagesPayload => ({
  packages: SHIPPED,
  purchaseAvailable: false,
  ...over,
});

beforeEach(() => {
  mockLang.language = 'en';
});

describe('the package picker', () => {
  it('three cards in the catalogue order, each with the figures from the payload', async () => {
    await openWith(okReply(payload()));
    const cards = screen.getAllByTestId('boost-package');
    expect(cards.map((card) => card.getAttribute('data-package-id'))).toEqual(SHIPPED.map((p) => p.id));

    cards.forEach((card, index) => {
      const pkg = SHIPPED[index];
      const inCard = within(card);
      expect(inCard.getByTestId('boost-package-name')).toHaveTextContent(pkg.labels.name.en);
      expect(norm(inCard.getByTestId('boost-package-price').textContent)).toBe(norm(formatMinorAmount(pkg.priceMinor, 'USD', 'en')));
      expect(inCard.getByTestId('boost-package-tax')).toHaveTextContent(tr('usage.boost.excl_tax'));
      expect(norm(inCard.getByTestId('boost-package-credits').textContent)).toBe(norm(tr('usage.boost.credits', { credits: whole(pkg.totalCredits) })));
      expect(inCard.getByTestId('boost-package-description')).toHaveTextContent(pkg.labels.description.en);
    });
  });

  it('the English prices read $10, $25 and $50, each "excl. tax"', async () => {
    await openWith(okReply(payload()));
    expect(screen.getAllByTestId('boost-package-price').map((el) => el.textContent)).toEqual(['$10', '$25', '$50']);
    expect(screen.getAllByTestId('boost-package-tax')).toHaveLength(3);
  });

  it('badges come from the labels: none on Starter, "Most popular" on Plus, "Best value" on Max', async () => {
    await openWith(okReply(payload()));
    const cards = screen.getAllByTestId('boost-package');
    expect(within(cards[0]).queryByTestId('boost-package-badge')).not.toBeInTheDocument();
    expect(within(cards[1]).getByTestId('boost-package-badge')).toHaveTextContent(SHIPPED[1].labels.badge!.en);
    expect(within(cards[2]).getByTestId('boost-package-badge')).toHaveTextContent(SHIPPED[2].labels.badge!.en);
  });

  it('the bonus line shows only when there is a bonus, with the payload\'s % and credits', async () => {
    await openWith(okReply(payload()));
    const cards = screen.getAllByTestId('boost-package');
    cards.forEach((card, index) => {
      const pkg = SHIPPED[index];
      const bonus = within(card).queryByTestId('boost-package-bonus');
      if (pkg.bonusPercent > 0) {
        expect(norm(bonus?.textContent)).toBe(norm(tr('usage.boost.bonus', { percent: pct(pkg.bonusPercent), credits: whole(pkg.bonusCredits) })));
      } else {
        expect(bonus).not.toBeInTheDocument();
      }
    });
  });

  it('planted figures (12 %, odd credits, $12.50) are shown as sent: nothing is hand-written', async () => {
    const odd: BoostPackageView = {
      ...SHIPPED[1],
      id: 'odd',
      priceMinor: 1250,
      baseCredits: 6250,
      bonusCredits: 750,
      totalCredits: 7000,
      bonusPercent: 12,
    };
    await openWith(okReply(payload({ packages: [odd] })));
    expect(screen.getByTestId('boost-package-price')).toHaveTextContent('$12.50');
    expect(norm(screen.getByTestId('boost-package-credits').textContent)).toBe(norm(tr('usage.boost.credits', { credits: whole(7000) })));
    expect(screen.getByTestId('boost-package-bonus')).toHaveTextContent('12%');
  });

  it('every Buy is disabled and reads "Coming soon"', async () => {
    await openWith(okReply(payload()));
    const buys = screen.getAllByTestId('boost-package-buy');
    expect(buys).toHaveLength(3);
    for (const buy of buys) {
      expect(buy).toBeDisabled();
      expect(buy).toHaveAttribute('aria-disabled', 'true');
      expect(buy).toHaveTextContent('Coming soon');
      expect(buy).toHaveAttribute('title', 'Purchasing opens soon');
    }
  });

  it('SA C-3: purchaseAvailable true still renders every Buy disabled, and clicking does nothing', async () => {
    await openWith(okReply(payload({ purchaseAvailable: true })));
    for (const buy of screen.getAllByTestId('boost-package-buy')) {
      expect(buy).toBeDisabled();
      fireEvent.click(buy);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const [url] of fetchMock.mock.calls) expect(String(url)).toBe('/api/business-os/credits/boost/packages');
  });

  it('the footer says USD and excluding tax', async () => {
    await openWith(okReply(payload()));
    expect(screen.getByTestId('boost-packages-footer')).toHaveTextContent('Prices are in US dollars and exclude tax.');
  });

  it('Hebrew: right-to-left, opens from the left, Hebrew strings; labels fall back to English', async () => {
    mockLang.language = 'he';
    const withHebrew = SHIPPED.map((p, index) => (index === 0 ? { ...p, labels: { ...p.labels, name: { ...p.labels.name, he: 'מתחילים' } } } : p));
    await openWith(okReply(payload({ packages: withHebrew })));
    const panel = screen.getByTestId('boost-packages-panel');
    expect(panel).toHaveAttribute('dir', 'rtl');
    expect(panel).toHaveAttribute('data-side', 'left');
    const names = screen.getAllByTestId('boost-package-name').map((el) => el.textContent);
    expect(names[0]).toBe('מתחילים');
    expect(names[1]).toBe(SHIPPED[1].labels.name.he || SHIPPED[1].labels.name.en);
    expect(screen.getAllByTestId('boost-package-buy')[0]).toHaveTextContent(tr('usage.boost.coming_soon'));
    expect(screen.getByTestId('boost-packages-footer')).toHaveTextContent(tr('usage.boost.footer'));
  });

  it('a blank Hebrew label falls back to English', async () => {
    mockLang.language = 'he';
    const blank = SHIPPED.map((p, index) => (index === 0 ? { ...p, labels: { ...p.labels, name: { ...p.labels.name, he: '' } } } : p));
    await openWith(okReply(payload({ packages: blank })));
    expect(screen.getAllByTestId('boost-package-name')[0]).toHaveTextContent(SHIPPED[0].labels.name.en);
  });

  it('Spanish: ltr, Spanish strings, prices through Intl for es', async () => {
    mockLang.language = 'es';
    await openWith(okReply(payload()));
    expect(screen.getByTestId('boost-packages-panel')).toHaveAttribute('dir', 'ltr');
    expect(norm(screen.getAllByTestId('boost-package-price')[1].textContent)).toBe(norm(formatMinorAmount(SHIPPED[1].priceMinor, 'USD', 'es')));
    expect(screen.getAllByTestId('boost-package-tax')[0]).toHaveTextContent('sin impuestos');
  });

  it.each([
    ['a 503', { ok: false, status: 503, body: { success: false, error: 'packages_unavailable' } }],
    ['an empty list', { ok: true, status: 200, body: { success: true, data: { packages: [], purchaseAvailable: false } } }],
    ['another currency', { ok: true, status: 200, body: { success: true, data: { packages: [{ id: 'x', currency: 'EUR' }], purchaseAvailable: false } } }],
  ] as Array<[string, Reply]>)('%s → the error with Try again, never an empty list', async (_name, reply) => {
    await openWith(reply);
    expect(screen.getByTestId('boost-packages-error')).toHaveTextContent(tr('usage.boost.error'));
    expect(screen.queryByTestId('boost-packages-list')).not.toBeInTheDocument();
  });

  it('a payload missing a language → error', async () => {
    const broken = [{ ...SHIPPED[0], labels: { ...SHIPPED[0].labels, name: { en: 'Starter', he: 'x' } } }];
    await openWith(okReply({ packages: broken, purchaseAvailable: false }));
    expect(screen.getByTestId('boost-packages-error')).toBeInTheDocument();
  });

  it('Try again reads again and shows the packages', async () => {
    replies = [{ ok: false, status: 503, body: { success: false } }, okReply(payload())];
    installFetch();
    render(<BoostPackagesPanel open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('boost-packages-error')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('boost-packages-retry'));
    await waitFor(() => expect(screen.getAllByTestId('boost-package')).toHaveLength(3));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('closed: no read at all', () => {
    replies = [okReply(payload())];
    installFetch();
    render(<BoostPackagesPanel open={false} onOpenChange={() => {}} />);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('R-3: the locale output, pinned as an owner reads it', () => {
  // Intl puts right-to-left marks (U+200F) into Hebrew prices; they are correct
  // output, invisible, and stripped here only so the pins stay readable.
  const visible = (text: string | null | undefined) => norm((text ?? '').replace(/[‎‏]/g, ''));
  const rows = () =>
    screen.getAllByTestId('boost-package').map((card) => [
      visible(within(card).getByTestId('boost-package-price').textContent),
      norm(within(card).getByTestId('boost-package-credits').textContent),
      norm(within(card).queryByTestId('boost-package-bonus')?.textContent),
    ]);

  it('en', async () => {
    await openWith(okReply(payload()));
    expect(rows()).toEqual([
      ['$10', '5,000 credits', ''],
      ['$25', '13,750 credits', 'Includes a +10% bonus (1,250 credits)'],
      ['$50', '28,750 credits', 'Includes a +15% bonus (3,750 credits)'],
    ]);
  });

  it('he: the price after the number, no leading "+" on the bonus', async () => {
    mockLang.language = 'he';
    await openWith(okReply(payload()));
    expect(rows()).toEqual([
      ['10 $', '5,000 קרדיטים', ''],
      ['25 $', '13,750 קרדיטים', 'כולל בונוס של 10% (1,250 קרדיטים)'],
      ['50 $', '28,750 קרדיטים', 'כולל בונוס של 15% (3,750 קרדיטים)'],
    ]);
    expect(screen.getAllByTestId('boost-package-tax')[0]).toHaveTextContent('לא כולל מס');
  });

  it('es: US$, a comma decimal, and no separator in four-digit numbers (CLDR)', async () => {
    mockLang.language = 'es';
    await openWith(okReply(payload()));
    expect(rows()).toEqual([
      ['10 US$', '5000 créditos', ''],
      ['25 US$', '13.750 créditos', 'Incluye un bono del +10 % (1250 créditos)'],
      ['50 US$', '28.750 créditos', 'Incluye un bono del +15 % (3750 créditos)'],
    ]);
  });
});

describe('R-5: malformed answers are an error, never an empty list', () => {
  const broken = (patch: Record<string, unknown>) => ({ ...SHIPPED[0], ...patch });
  it.each([
    ['fractional credits', okReply({ packages: [broken({ totalCredits: 5000.5 })], purchaseAvailable: false })],
    ['a negative bonus', okReply({ packages: [broken({ bonusPercent: -1 })], purchaseAvailable: false })],
    ['taxExclusive missing', okReply({ packages: [broken({ taxExclusive: undefined })], purchaseAvailable: false })],
    ['purchaseAvailable missing', okReply({ packages: SHIPPED })],
    ['packages not an array', okReply({ packages: {}, purchaseAvailable: false })],
    ['a 200 with success false', { ok: true, status: 200, body: { success: false, data: { packages: SHIPPED, purchaseAvailable: false } } }],
  ] as Array<[string, Reply]>)('%s', async (_name, reply) => {
    await openWith(reply);
    expect(screen.getByTestId('boost-packages-error')).toBeInTheDocument();
    expect(screen.queryByTestId('boost-packages-list')).not.toBeInTheDocument();
  });

  it('a non-JSON body (a 502 page)', async () => {
    fetchMock = jest.fn(async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('Unexpected token <'); } }));
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<BoostPackagesPanel open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('boost-packages-error')).toBeInTheDocument());
  });

  it('a network failure', async () => {
    fetchMock = jest.fn(async () => { throw new TypeError('Failed to fetch'); });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<BoostPackagesPanel open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('boost-packages-error')).toBeInTheDocument());
  });
});

describe('I-2: the loading state is announced', () => {
  it('role="status" with the loading text as its name', async () => {
    replies = [okReply(payload())];
    fetchMock = jest.fn(() => new Promise(() => {}));
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<BoostPackagesPanel open onOpenChange={() => {}} />);
    const loading = await screen.findByTestId('boost-packages-loading');
    expect(loading).toHaveAttribute('role', 'status');
    expect(screen.getByRole('status', { name: tr('usage.boost.loading') })).toBe(loading);
  });
});
