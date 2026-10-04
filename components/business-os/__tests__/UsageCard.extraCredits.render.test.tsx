/**
 * @jest-environment jsdom
 *
 * The Credits card's "Extra credits" block (credit deduction slice 11d;
 * S11-D-1 A, S11-AC-7; workplan §11d.6.3; SA W11d-1, W11d-9; G11d-1, G11d-2).
 *
 * The block shows only when the payload's `extraCredits` is above 0 (user
 * decision 2026-10-04, BQ-11d-1), rounded DOWN ("less than 1" below one), with
 * its one line. The percentage, its band, the arc and the ring's label never
 * move with it, and no number on the card is the plan figure plus the extra
 * one. Rendered with the REAL dictionary in each language; numbers through the
 * same `Intl` call the card makes.
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { OwnerCreditUsage } from '@/lib/business-os/credits/ownerCreditUsageTypes';

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
      timeZoneOptions: (options: Intl.DateTimeFormatOptions = {}) => ({ ...options, timeZone: mockLang.timezone }),
    }),
  };
});
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger, clientLogger: logger };
});
jest.mock('@/lib/logger/client', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { clientLogger: logger };
});
// The dictionary module creates a browser Supabase client at import; only its
// `translations` are used here.
jest.mock('@/lib/supabaseClient', () => ({ supabase: {} }));

import { UsageCard } from '@/components/business-os/UsageCard';
const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};

const RESETS = '2026-10-14T09:31:07.123Z';
const MONTHLY = (used: number, extraCredits: number): OwnerCreditUsage => ({
  period: { kind: 'monthly', resetsOn: RESETS },
  allowance: { amount: 32250, per: 'month' },
  used,
  usedByOwner: used,
  usedAutomatic: 0,
  extraCredits,
  remaining: Math.max(0, 32250 - used),
});

type Reply = { ok: boolean; status: number; body: unknown };
const ok = (data: unknown): Reply => ({ ok: true, status: 200, body: { success: true, data } });
let replies: Reply[] = [];

/** A fetch whose answers are queued; the last one repeats. */
function installFetch() {
  global.fetch = jest.fn(async () => {
    const reply = replies.length > 1 ? replies.shift()! : replies[0];
    return { ok: reply.ok, status: reply.status, json: async () => reply.body };
  }) as unknown as typeof fetch;
}

const tr = (key: string) => translations[mockLang.language][key];
const norm = (text: string) => text.replace(/\s+/g, ' ');
const whole = (value: number) => norm(new Intl.NumberFormat(mockLang.language, { maximumFractionDigits: 0 }).format(value));

async function renderWith(data: unknown) {
  replies = [ok(data)];
  installFetch();
  const view = render(<UsageCard />);
  await waitFor(() => expect(screen.getByTestId('credits-headline')).not.toHaveTextContent('—'));
  return view;
}

async function renderFailed(reply: Reply) {
  replies = [reply];
  installFetch();
  const view = render(<UsageCard />);
  await waitFor(() => expect(screen.getByTestId('credits-error')).toBeInTheDocument());
  return view;
}

/** The ring's observable state: everything the percentage drives. */
function ringState() {
  const ring = screen.getByTestId('credits-ring');
  const arc = screen.queryByTestId('credits-arc');
  return {
    headline: screen.getByTestId('credits-headline').textContent,
    band: ring.getAttribute('data-band'),
    label: ring.getAttribute('aria-label'),
    offset: arc?.getAttribute('stroke-dashoffset') ?? null,
    arcBand: arc?.getAttribute('data-band') ?? null,
    track: screen.getByTestId('credits-track').getAttribute('stroke'),
  };
}

const cardText = () => {
  const body = screen.getByTestId('credits-card').cloneNode(true) as HTMLElement;
  body.querySelector('[role="tooltip"]')?.remove();
  return norm(body.textContent ?? '');
};

beforeEach(() => {
  mockLang.language = 'en';
  mockLang.timezone = 'UTC';
});

describe.each<Lang>(['en', 'he', 'es'])('the extra credits block in %s', (language) => {
  beforeEach(() => {
    mockLang.language = language;
  });

  it('200 extra: the label, "200" and the one line, in this language', async () => {
    await renderWith(MONTHLY(100, 200));
    const block = screen.getByTestId('credits-extra');
    expect(block).toHaveTextContent(tr('usage.extra.label'));
    expect(screen.getByTestId('credits-extra-figure')).toHaveTextContent(whole(200));
    expect(screen.getByTestId('credits-extra-explain')).toHaveTextContent(tr('usage.extra.explain'));
  });

  it('0 extra: no block and no "Extra credits" text at all (BQ-11d-1)', async () => {
    await renderWith(MONTHLY(100, 0));
    expect(screen.queryByTestId('credits-extra')).not.toBeInTheDocument();
    expect(cardText()).not.toContain(tr('usage.extra.label'));
    expect(cardText()).not.toContain(tr('usage.extra.explain'));
  });

  it('0.4 extra: "less than 1" (it is not 0, so it is shown)', async () => {
    await renderWith(MONTHLY(100, 0.4));
    expect(screen.getByTestId('credits-extra-figure')).toHaveTextContent(tr('usage.less_than_one'));
  });

  it('199.6 extra: 199, rounded down', async () => {
    await renderWith(MONTHLY(100, 199.6));
    expect(screen.getByTestId('credits-extra-figure')).toHaveTextContent(whole(199));
  });

  it('12,000 extra: grouped the way this language groups digits', async () => {
    await renderWith(MONTHLY(100, 12000));
    expect(screen.getByTestId('credits-extra-figure').textContent).toBe(
      new Intl.NumberFormat(language, { maximumFractionDigits: 0 }).format(12000)
    );
  });

  it('the percentage does not move: 0 and 5,000 extra give the same headline, band, arc and label (G11d-2)', async () => {
    const first = await renderWith(MONTHLY(32250 * 0.351, 0));
    const without = ringState();
    first.unmount();
    await renderWith(MONTHLY(32250 * 0.351, 5000));
    expect(ringState()).toEqual(without);
    // Non-vacuity: the gauge is really drawn.
    expect(without.band).toBe('plenty');
    expect(without.offset).not.toBeNull();
  });

  it('over the allowance with 200 extra: still 0% on red, with the block below, and no combined figure', async () => {
    await renderWith(MONTHLY(32260, 200));
    expect(screen.getByTestId('credits-headline')).toHaveTextContent(
      norm(new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 0 }).format(0))
    );
    expect(screen.getByTestId('credits-ring')).toHaveAttribute('data-band', 'below_line');
    expect(screen.queryByTestId('credits-arc')).not.toBeInTheDocument();
    expect(screen.getByTestId('credits-extra-figure')).toHaveTextContent(whole(200));
  });

  it('no allowance with 200 extra: used in the ring, and the block', async () => {
    await renderWith({ ...MONTHLY(62.5, 200), period: { kind: 'monthly', resetsOn: null }, allowance: null, remaining: null });
    expect(screen.getByTestId('credits-headline')).toHaveTextContent(whole(63));
    expect(screen.getByTestId('credits-ring')).not.toHaveAttribute('data-band');
    expect(screen.getByTestId('credits-extra-figure')).toHaveTextContent(whole(200));
  });

  it('the block follows the card\'s direction (RTL in Hebrew)', async () => {
    await renderWith(MONTHLY(100, 200));
    expect(screen.getByTestId('credits-card')).toHaveStyle({ direction: language === 'he' ? 'rtl' : 'ltr' });
    // It sets no direction of its own, so it inherits the card's.
    expect(screen.getByTestId('credits-extra').style.direction).toBe('');
  });

  it('no number on the card is the plan figure plus the extra figure (G11d-1, R-5 (c))', async () => {
    // used 100: remaining 32,150, allowance 32,250; extra 200.
    await renderWith(MONTHLY(100, 200));
    const text = cardText();
    for (const sum of [32150 + 200, 32250 + 200]) {
      expect(text).not.toContain(whole(sum));
      expect(text).not.toContain(String(sum));
    }
    for (const element of Array.from(screen.getByTestId('credits-card').querySelectorAll('*'))) {
      expect(element.getAttribute('aria-label') ?? '').not.toMatch(/32[,.\s]?350|32[,.\s]?450/);
    }
  });
});

describe('when the block is absent', () => {
  it('while loading', async () => {
    let release: (value: unknown) => void = () => {};
    global.fetch = jest.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    ) as unknown as typeof fetch;
    render(<UsageCard />);
    expect(screen.getByTestId('credits-headline')).toHaveTextContent('—');
    expect(screen.queryByTestId('credits-extra')).not.toBeInTheDocument();
    await act(async () => {
      release({ ok: true, status: 200, json: async () => ({ success: true, data: MONTHLY(100, 200) }) });
    });
    await waitFor(() => expect(screen.getByTestId('credits-extra')).toBeInTheDocument());
  });

  it('on the error line', async () => {
    await renderFailed({ ok: false, status: 500, body: { success: false, error: 'x' } });
    expect(screen.queryByTestId('credits-extra')).not.toBeInTheDocument();
  });

  it.each([
    ['missing', (() => {
      const payload: Record<string, unknown> = { ...MONTHLY(100, 200) };
      delete payload.extraCredits;
      return payload;
    })()],
    ['negative', MONTHLY(100, -5)],
    ['null', { ...MONTHLY(100, 0), extraCredits: null }],
    ['a string', { ...MONTHLY(100, 0), extraCredits: '200' }],
  ])('a payload with extraCredits %s is the error line, never a hidden figure', async (_name, data) => {
    await renderFailed(ok(data));
    expect(screen.queryByTestId('credits-extra')).not.toBeInTheDocument();
    expect(screen.getByTestId('credits-headline')).toHaveTextContent('—');
  });
});

describe('refresh', () => {
  it('a refresh that brings extra credits from 0 to 200 shows the block, without a remount', async () => {
    replies = [ok(MONTHLY(100, 0)), ok(MONTHLY(100, 200))];
    installFetch();
    render(<UsageCard />);
    await waitFor(() => expect(screen.getByTestId('credits-headline')).not.toHaveTextContent('—'));
    expect(screen.queryByTestId('credits-extra')).not.toBeInTheDocument();
    const card = screen.getByTestId('credits-card');

    fireEvent.click(screen.getByTestId('credits-refresh'));

    await waitFor(() => expect(screen.getByTestId('credits-extra')).toBeInTheDocument());
    expect(screen.getByTestId('credits-card')).toBe(card);
    expect(screen.getByTestId('credits-extra-figure')).toHaveTextContent('200');
  });
});
