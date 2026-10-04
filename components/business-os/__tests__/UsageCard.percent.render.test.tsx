/**
 * @jest-environment jsdom
 *
 * The Credits card as a percentage left (credit deduction slice 8a; FR-46,
 * FR-47, AC-40 to AC-42; BD-19, BD-20; SA SQ-40, SQ-47, Q-1 to Q-3).
 *
 * Every state, in en / he / es, with the REAL dictionary: the headline, the
 * band on the ring, the screen-reader label, and what must never appear.
 * Percentages are asserted through the same `Intl` call the card makes.
 */

import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';

import type { OwnerCreditUsage } from '@/lib/business-os/credits/ownerCreditUsageTypes';
import { bandColor } from '@/lib/business-os/credits/creditBands';

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
        for (const [name, value] of Object.entries(vars ?? {})) text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
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
jest.mock('@/lib/supabaseClient', () => ({ supabase: {} }));

import { UsageCard } from '@/components/business-os/UsageCard';
const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};

const RESETS = '2026-10-14T09:31:07.123Z';
const MONTHLY = (used: number): OwnerCreditUsage => ({
  period: { kind: 'monthly', resetsOn: RESETS },
  allowance: { amount: 32250, per: 'month' },
  used,
  usedByOwner: used,
  usedAutomatic: 0,
  extraCredits: 0,
  remaining: Math.max(0, 32250 - used),
});
const TRIAL = (used: number): OwnerCreditUsage => ({
  period: { kind: 'trial_total', resetsOn: null },
  allowance: { amount: 2000, per: 'total' },
  used,
  usedByOwner: used,
  usedAutomatic: 0,
  extraCredits: 0,
  remaining: Math.max(0, 2000 - used),
});

/** Whitespace-normalised, as `toHaveTextContent` reads the element. */
const norm = (text: string) => text.replace(/\s+/g, ' ');
const tr = (key: string, vars: Record<string, string> = {}) => {
  let text = translations[mockLang.language][key];
  for (const [name, value] of Object.entries(vars)) text = text.replace(`{${name}}`, value);
  return text;
};
const pctRaw = (value: number) =>
  new Intl.NumberFormat(mockLang.language, { style: 'percent', maximumFractionDigits: 0 }).format(value / 100);
const pct = (value: number) => norm(pctRaw(value));
const lessThanOne = () => tr('usage.less_than_percent', { percent: pctRaw(1) });

async function renderWith(data: OwnerCreditUsage | null, status = 200) {
  global.fetch = jest.fn(async () => ({
    ok: status === 200,
    status,
    json: async () => (status === 200 ? { success: true, data } : { success: false, error: 'x' }),
  })) as unknown as typeof fetch;
  const view = render(<UsageCard />);
  if (status === 200) await waitFor(() => expect(screen.getByTestId('credits-headline')).not.toHaveTextContent('—'));
  else await waitFor(() => expect(screen.getByTestId('credits-error')).toBeInTheDocument());
  return view;
}

/** Card text without the tooltip (the explanation sentence is unchanged, BD-24). */
const cardText = () => {
  const body = screen.getByTestId('credits-card').cloneNode(true) as HTMLElement;
  body.querySelector('[role="tooltip"]')?.remove();
  return body.textContent ?? '';
};

describe.each<Lang>(['en', 'he', 'es'])('the percentage card in %s', (language) => {
  beforeEach(() => {
    mockLang.language = language;
    mockLang.timezone = 'UTC';
  });

  it.each([
    ['nothing used → 100%, green', 0, 100, 'plenty'],
    ['one 0.2-credit briefing → 99%', 0.2, 99, 'plenty'],
    ['64.9% left → 64%', 32250 * 0.351, 64, 'plenty'],
    ['exactly 60% → green', 32250 * 0.4, 60, 'plenty'],
    ['59% → blue', 32250 * 0.41, 59, 'comfortable'],
    ['30% → blue', 32250 * 0.7, 30, 'comfortable'],
    ['29% → orange', 32250 * 0.71, 29, 'low'],
    ['exactly 10.000000% → orange, never 9', 29025, 10, 'low'],
    ['9.6% → 9%, red', 32250 * 0.904, 9, 'below_line'],
  ])('%s', async (_name, used, shown, band) => {
    await renderWith(MONTHLY(used));
    expect(screen.getByTestId('credits-headline')).toHaveTextContent(pct(shown));
    expect(screen.getByTestId('credits-headline')).toHaveAttribute('data-size', 'large');
    expect(screen.getByTestId('credits-ring')).toHaveAttribute('data-band', band);
    const arc = screen.getByTestId('credits-arc');
    expect(arc).toHaveAttribute('data-band', band);
    expect(arc).toHaveAttribute('stroke', bandColor(band as Parameters<typeof bandColor>[0]));
    // The number is always written; no credit count, no "of" line.
    expect(screen.queryByTestId('credits-of')).not.toBeInTheDocument();
    expect(cardText()).not.toMatch(/32[,.\s]?250|of \d/);
  });

  it('0.4% left → "less than 1%", red, at the smaller size, with a sliver of arc', async () => {
    await renderWith(MONTHLY(32250 * 0.996));
    expect(screen.getByTestId('credits-headline')).toHaveTextContent(norm(lessThanOne()));
    expect(screen.getByTestId('credits-headline')).toHaveAttribute('data-size', 'small');
    expect(screen.getByTestId('credits-ring')).toHaveAttribute('data-band', 'below_line');
    expect(screen.getByTestId('credits-arc')).toHaveAttribute('data-band', 'below_line');
    // Never "0%" while credits remain.
    expect(screen.getByTestId('credits-headline').textContent).not.toBe(norm(pctRaw(0)));
  });

  it('at or over the allowance → 0%, no arc, the track in the red band (SA Q-2), no warning wording', async () => {
    await renderWith(MONTHLY(32260));
    expect(screen.getByTestId('credits-headline')).toHaveTextContent(pct(0));
    expect(screen.queryByTestId('credits-arc')).not.toBeInTheDocument();
    expect(screen.getByTestId('credits-ring')).toHaveAttribute('data-band', 'below_line');
    expect(screen.getByTestId('credits-track')).toHaveAttribute('stroke', bandColor('below_line'));
    expect(cardText()).not.toMatch(/paus|upgrade|limit|warn|running out/i);
  });

  it('a gauged track is the neutral track', async () => {
    await renderWith(MONTHLY(100));
    expect(screen.getByTestId('credits-track')).toHaveAttribute('stroke', 'var(--v2-border)');
  });

  it('a trial: the percentage of its one-off total, "For your trial"', async () => {
    await renderWith(TRIAL(260));
    expect(screen.getByTestId('credits-headline')).toHaveTextContent(pct(87));
    expect(screen.getByTestId('credits-period')).toHaveTextContent(tr('usage.for_trial'));
    expect(screen.getByTestId('credits-ring')).toHaveAttribute('aria-label', tr('usage.sr.trial', { percent: pctRaw(87) }));
  });

  it('the screen-reader label states the percentage and the reset date — no colour name (AC-42)', async () => {
    await renderWith(MONTHLY(32250 * 0.351));
    const date = new Intl.DateTimeFormat(language, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(RESETS));
    const label = screen.getByTestId('credits-ring').getAttribute('aria-label')!;
    expect(label).toBe(tr('usage.sr.monthly', { percent: pctRaw(64), date }));
    expect(label).not.toMatch(/\b(green|blue|orange|red|verde|azul|naranja|rojo)\b|ירוק|כחול|כתום|אדום/i);
  });

  it('"less than 1%" is read out too', async () => {
    await renderWith(MONTHLY(32250 * 0.996));
    expect(screen.getByTestId('credits-ring').getAttribute('aria-label')).toContain(lessThanOne());
  });

  it('a monthly reset date that does not parse: the plain label', async () => {
    await renderWith({ ...MONTHLY(100), period: { kind: 'monthly', resetsOn: 'not-a-date' } });
    expect(screen.getByTestId('credits-ring')).toHaveAttribute('aria-label', tr('usage.sr.plain', { percent: pctRaw(99) }));
  });

  it('no allowance: credits used as before — no %, no band, no gauge', async () => {
    await renderWith({ ...MONTHLY(62.5), period: { kind: 'monthly', resetsOn: null }, allowance: null, remaining: null });
    expect(screen.getByTestId('credits-headline')).toHaveTextContent('63');
    expect(screen.getByTestId('credits-headline').textContent).not.toMatch(/%/);
    expect(screen.getByTestId('credits-ring')).not.toHaveAttribute('data-band');
    expect(screen.queryByTestId('credits-arc')).not.toBeInTheDocument();
  });

  it('a failed read: the error line — never "0%" or "100%"', async () => {
    await renderWith(null, 500);
    expect(screen.getByTestId('credits-headline')).toHaveTextContent('—');
    expect(cardText()).not.toContain(norm(pctRaw(0)));
    expect(cardText()).not.toContain(norm(pctRaw(100)));
    expect(screen.getByTestId('credits-ring')).not.toHaveAttribute('data-band');
  });

  it('names no agent-platform measure, token, dollar or cost (FR-36, BD-15)', async () => {
    await renderWith(MONTHLY(1000));
    expect(cardText()).not.toMatch(/\bAI\b|\bIA\b|token|\$|cost|dollar|pilot/i);
  });
});
