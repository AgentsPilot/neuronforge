/**
 * @jest-environment jsdom
 *
 * The Credits card's one slice 7a addition: the "Credit history" link (D-i;
 * parked behind NEXT_PUBLIC_BUSINESS_OS_CREDIT_HISTORY, default off — both states pinned;
 * workplan §4.9; SA SQ-37, W7-8). The 6a card suite runs unedited beside this
 * one; here only the link is pinned: shown whenever the card has a result
 * (gauged, trial, no allowance), absent while loading and on the error line,
 * and the card's own mount makes exactly one request — the panel reads only
 * when it is opened.
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { OwnerCreditUsage } from '@/lib/business-os/credits/ownerCreditUsageTypes';

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
        for (const [name, value] of Object.entries(vars ?? {})) text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
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

import { UsageCard } from '@/components/business-os/UsageCard';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};

const MONTHLY: OwnerCreditUsage = {
  period: { kind: 'monthly', resetsOn: '2026-10-14T09:31:07.123Z' },
  allowance: { amount: 32250, per: 'month' },
  used: 62.5,
  usedByOwner: 40.6,
  usedAutomatic: 21.9,
  granted: 0,
  remaining: 32187.5,
};

const HISTORY = {
  summary: {
    period: { kind: 'monthly', startsOn: '2026-09-14T09:31:07.123Z', endsBefore: '2026-10-14T09:31:07.123Z' },
    used: 62.5,
    usedByOwner: 40.6,
    usedAutomatic: 21.9,
  },
  lines: [],
  nextCursor: null,
};

let fetchMock: jest.Mock;
function install(card: { ok: boolean; body: unknown }) {
  fetchMock = jest.fn(async (url: string) => {
    if (url.startsWith('/api/business-os/credits/history')) {
      return { ok: true, status: 200, json: async () => ({ success: true, data: HISTORY }) };
    }
    return { ok: card.ok, status: card.ok ? 200 : 500, json: async () => card.body };
  });
  global.fetch = fetchMock as unknown as typeof fetch;
}

const FLAG = 'NEXT_PUBLIC_BUSINESS_OS_CREDIT_HISTORY';
const flagBefore = process.env[FLAG];
afterAll(() => {
  if (flagBefore === undefined) delete process.env[FLAG];
  else process.env[FLAG] = flagBefore;
});

beforeEach(() => {
  mockLang.language = 'en';
  // Parked behind a flag (default off). The link tests below run it switched on;
  // the "flag off" block switches it off again.
  process.env[FLAG] = 'true';
});

describe('parked: with the flag off (the default), the card is exactly the 6a card', () => {
  it.each([['unset', undefined], ['false', 'false']])('%s: no link, no panel, one request', async (_name, value) => {
    if (value === undefined) delete process.env[FLAG];
    else process.env[FLAG] = value;
    install({ ok: true, body: { success: true, data: MONTHLY } });
    render(<UsageCard />);
    await screen.findByTestId('credits-arc');
    await act(async () => {});
    expect(screen.queryByTestId('credits-history-link')).not.toBeInTheDocument();
    expect(screen.queryByTestId('credit-history-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('credits-card').textContent).not.toContain(translations.en['credits.history.link']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/credits/history'))).toBe(false);
  });
});

describe.each<Lang>(['en', 'he', 'es'])('the Credit history link (%s)', (lang) => {
  beforeEach(() => {
    mockLang.language = lang;
  });

  it.each<[string, OwnerCreditUsage]>([
    ['a monthly plan', MONTHLY],
    ['a trial', { ...MONTHLY, period: { kind: 'trial_total', resetsOn: null }, allowance: { amount: 2000, per: 'total' } }],
    ['no allowance', { ...MONTHLY, period: { kind: 'calendar_month', resetsOn: null }, allowance: null, remaining: null }],
  ])('is shown for %s, and the card made one request only', async (_name, usage) => {
    install({ ok: true, body: { success: true, data: usage } });
    render(<UsageCard />);
    const link = await screen.findByTestId('credits-history-link');
    expect(link).toHaveTextContent(translations[lang]['credits.history.link']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/business-os/usage');
    expect(screen.queryByTestId('credit-history-panel')).not.toBeInTheDocument();
  });
});

describe('the Credit history link', () => {
  it('is absent while the card is loading', async () => {
    fetchMock = jest.fn(() => new Promise(() => {}));
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<UsageCard />);
    await act(async () => {});
    expect(screen.queryByTestId('credits-history-link')).not.toBeInTheDocument();
  });

  it('is absent on the error line', async () => {
    install({ ok: false, body: { success: false, error: 'x' } });
    render(<UsageCard />);
    await screen.findByTestId('credits-error');
    expect(screen.queryByTestId('credits-history-link')).not.toBeInTheDocument();
  });

  it('opens the panel, which then makes the first history request', async () => {
    install({ ok: true, body: { success: true, data: MONTHLY } });
    render(<UsageCard />);
    fireEvent.click(await screen.findByTestId('credits-history-link'));
    expect(await screen.findByTestId('credit-history-panel')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe('/api/business-os/credits/history');
  });
});
