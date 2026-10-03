/**
 * @jest-environment jsdom
 *
 * The Credits card, as an owner reads it (credit deduction slice 6a, workplan
 * §4.6, §4.7, §7 "States × languages", "Refresh triggers").
 *
 * Rendered with the REAL dictionary in each language, so the words asserted are
 * the words an owner sees — and "AI", tokens or dollars appearing anywhere on
 * the card fails here. Numbers and dates are asserted through the same `Intl`
 * calls the card makes, never hand-typed separators (SA Q-10).
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
// The dictionary module creates a browser Supabase client at import; only its
// `translations` are used here.
jest.mock('@/lib/supabaseClient', () => ({ supabase: {} }));

import { UsageCard } from '@/components/business-os/UsageCard';
import { notifyCreditUsageChanged } from '@/lib/business-os/client/creditUsageSignal';
// The real dictionary, for the expected strings.
const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};

const RESETS = '2026-10-14T09:31:07.123Z';

const FOUNDING_PARTNER: OwnerCreditUsage = {
  period: { kind: 'monthly', resetsOn: RESETS },
  allowance: { amount: 32250, per: 'month' },
  used: 62.5,
  usedByOwner: 40.6,
  usedAutomatic: 21.9,
  granted: 0,
  remaining: 32187.5,
};

const with_ = (over: Partial<OwnerCreditUsage>): OwnerCreditUsage => ({ ...FOUNDING_PARTNER, ...over });

type Reply = { ok: boolean; status: number; body: unknown };
const okReply = (data: OwnerCreditUsage): Reply => ({ ok: true, status: 200, body: { success: true, data } });

let replies: Reply[] = [];
let fetchMock: jest.Mock;

/** A fetch whose answers are queued; the last one repeats. */
function installFetch() {
  fetchMock = jest.fn(async (_url: string, init?: RequestInit) => {
    const reply = replies.length > 1 ? replies.shift()! : replies[0];
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return { ok: reply.ok, status: reply.status, json: async () => reply.body };
  });
  global.fetch = fetchMock as unknown as typeof fetch;
}

/** A fetch that waits until released, to hold a read in flight. */
function installHeldFetch() {
  const releases: Array<() => void> = [];
  fetchMock = jest.fn(
    () =>
      new Promise((resolve) => {
        releases.push(() => resolve({ ok: true, status: 200, json: async () => ({ success: true, data: FOUNDING_PARTNER }) }));
      })
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  return releases;
}

const t = (key: string, vars: Record<string, string> = {}) => {
  let text = translations[mockLang.language][key];
  for (const [name, value] of Object.entries(vars)) text = text.replace(`{${name}}`, value);
  return text;
};
/** A whole percentage as the card writes it, in the current language (slice 8a). */
const pct = (value: number) =>
  new Intl.NumberFormat(mockLang.language, { style: 'percent', maximumFractionDigits: 0 })
    .format(value / 100)
    // toHaveTextContent collapses the element's whitespace (es "99 %" uses a no-break space).
    .replace(/\s/g, ' ');

/** The used / "by you" / "automatic" line under the ring is gone (user decision 2026-10-01), in every state. */
function expectNoSplitLine() {
  expect(screen.queryByTestId('credits-split')).not.toBeInTheDocument();
  // The card's visible body, without the tooltip: the es sentence itself says "por ti".
  const body = screen.getByTestId('credits-card').cloneNode(true) as HTMLElement;
  body.querySelector('[role="tooltip"]')?.remove();
  const text = body.textContent ?? '';
  // Slice 8a: a gauged ring carries its band (the "of N" line is gone).
  const gauged = screen.getByTestId('credits-ring').hasAttribute('data-band');
  // "used" is still the centre label of the no-allowance state; a gauged card has no "used" anywhere.
  if (gauged) expect(text).not.toContain(t('usage.used'));
  for (const word of ['by you', 'על ידך', 'por ti', 'automatic', 'אוטומטי', 'automático', 'Nothing used yet', 'עדיין לא נוצל', 'Aún no has usado']) {
    expect(text).not.toContain(word);
  }
}

/**
 * The explanation sentence is no longer card text (user decision 2026-10-01):
 * it is ONLY the ring's tooltip, never a paragraph in the body.
 */
function expectExplainOnlyInTooltip(sentence: string) {
  expect(screen.queryByTestId('credits-explain')).not.toBeInTheDocument();
  const tooltip = screen.getByRole('tooltip', { hidden: true });
  expect(tooltip).toHaveTextContent(sentence);
  expect(screen.getByTestId('credits-ring')).toContainElement(tooltip);
  // Exactly once on the card: the tooltip, nowhere else.
  expect(screen.getAllByText(sentence, { exact: true })).toEqual([tooltip]);
}

async function renderWith(data: OwnerCreditUsage | Reply) {
  replies = ['ok' in data && 'body' in data ? (data as Reply) : okReply(data as OwnerCreditUsage)];
  installFetch();
  const view = render(<UsageCard />);
  await waitFor(() => expect(screen.getByTestId('credits-headline')).not.toHaveTextContent('—'));
  return view;
}

beforeEach(() => {
  mockLang.language = 'en';
  mockLang.timezone = 'UTC';
});

describe('states (English)', () => {
  it('loading: the frame with "—"', async () => {
    const releases = installHeldFetch();
    render(<UsageCard />);
    expect(screen.getByTestId('credits-headline')).toHaveTextContent('—');
    expect(screen.getByText(t('usage.title'))).toBeInTheDocument();
    await act(async () => releases.forEach((r) => r()));
  });

  it('a Founding Partner: the percentage left, the reset date, and the explanation on the ring', async () => {
    await renderWith(FOUNDING_PARTNER);

    expect(screen.getByText('Credits')).toBeInTheDocument();
    const date = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(RESETS));
    expect(screen.getByTestId('credits-period')).toHaveTextContent(`Resets ${date}`);
    // Slice 8a: 62.5 used of 32,250 → 99.8% → "99%" (BD-20, rounded down), no "of" line.
    expect(screen.getByTestId('credits-headline')).toHaveTextContent(pct(99));
    expect(screen.getByText('left')).toBeInTheDocument();
    expect(screen.queryByTestId('credits-of')).not.toBeInTheDocument();
    expect(screen.getByTestId('credits-arc')).toHaveAttribute('data-band', 'plenty');
    expectNoSplitLine();
    expectExplainOnlyInTooltip(t('usage.explain.monthly'));
  });

  it('the reset date is in the BUSINESS timezone', async () => {
    mockLang.timezone = 'Pacific/Auckland';
    await renderWith(with_({ period: { kind: 'monthly', resetsOn: '2026-10-13T20:00:00.000Z' } }));
    // 20:00 UTC on the 13th is already the 14th in Auckland.
    const date = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'Pacific/Auckland' }).format(
      new Date('2026-10-13T20:00:00.000Z')
    );
    expect(date).toMatch(/14/);
    expect(screen.getByTestId('credits-period')).toHaveTextContent(date);
  });

  it('nothing used yet this period', async () => {
    await renderWith(with_({ used: 0, usedByOwner: 0, usedAutomatic: 0, remaining: 32250 }));
    expect(screen.getByTestId('credits-headline')).toHaveTextContent(pct(100));
    // The "Nothing used yet" wording lived on the removed line (user decision 2026-10-01).
    expectNoSplitLine();
  });

  it('less than one credit used: no longer "100%" (100% only when nothing was used)', async () => {
    await renderWith(with_({ used: 0.4, usedByOwner: 0.4, usedAutomatic: 0, remaining: 32249.6 }));
    expect(screen.getByTestId('credits-headline')).toHaveTextContent(pct(99));
    expectNoSplitLine();
  });

  it.each([
    // Slice 8a: the colour is the band of the SHOWN percentage (BD-19).
    ['59% → blue', 32250 * 0.41, 'comfortable'],
    ['29% → orange', 32250 * 0.71, 'low'],
    ['9% → red', 32250 * 0.91, 'below_line'],
  ])('near the allowance, %s — and nothing else changes (no warning text)', async (_name, used, band) => {
    await renderWith(with_({ used, usedByOwner: used, usedAutomatic: 0, remaining: 32250 - used }));
    expect(screen.getByTestId('credits-arc')).toHaveAttribute('data-band', band);
    expect(screen.getByTestId('credits-card').textContent).not.toMatch(/warn|paus|upgrade|limit|running out/i);
  });

  it('over the allowance: 0% — no "paused" wording', async () => {
    await renderWith(with_({ used: 32260, usedByOwner: 32000, usedAutomatic: 260, remaining: 0 }));
    expect(screen.getByTestId('credits-headline')).toHaveTextContent(pct(0));
    expect(screen.getByTestId('credits-ring')).toHaveAttribute('data-band', 'below_line');
    expect(screen.queryByTestId('credits-arc')).not.toBeInTheDocument();
    expectNoSplitLine();
    expect(screen.getByTestId('credits-card').textContent).not.toMatch(/paus|upgrade|limit/i);
  });

  it('a trial: "For your trial", the percentage of the one-off total, no reset date and no "per month"', async () => {
    await renderWith({
      period: { kind: 'trial_total', resetsOn: null },
      allowance: { amount: 2000, per: 'total' },
      used: 348,
      usedByOwner: 300,
      usedAutomatic: 48,
      granted: 0,
      remaining: 1652,
    });
    expect(screen.getByTestId('credits-period')).toHaveTextContent('For your trial');
    // 1,652 of 2,000 left → 82.6% → "82%".
    expect(screen.getByTestId('credits-headline')).toHaveTextContent(pct(82));
    expect(screen.queryByTestId('credits-of')).not.toBeInTheDocument();
    expectExplainOnlyInTooltip(t('usage.explain.trial'));
    expect(screen.getByTestId('credits-card').textContent).not.toMatch(/Resets|per month|every month/);
  });

  it('a trial with nothing used: the full ring, no "Nothing used yet" line', async () => {
    await renderWith({
      period: { kind: 'trial_total', resetsOn: null },
      allowance: { amount: 2000, per: 'total' },
      used: 0,
      usedByOwner: 0,
      usedAutomatic: 0,
      granted: 0,
      remaining: 2000,
    });
    expect(screen.getByTestId('credits-headline')).toHaveTextContent(pct(100));
    expectNoSplitLine();
  });

  it('no allowance (a lapsed plan): usage with no gauge, no "left", no label, never "0 of 0"', async () => {
    await renderWith(with_({ period: { kind: 'monthly', resetsOn: null }, allowance: null, remaining: null }));
    expect(screen.getByTestId('credits-headline')).toHaveTextContent('63');
    expect(screen.getByText('used')).toBeInTheDocument();
    expect(screen.queryByTestId('credits-of')).not.toBeInTheDocument();
    expect(screen.queryByTestId('credits-period')).not.toBeInTheDocument();
    expect(screen.queryByTestId('credits-arc')).not.toBeInTheDocument();
    // DV-3: no allowance, no explanation — and so no tooltip and no tab stop.
    expect(screen.queryByTestId('credits-explain-tooltip')).not.toBeInTheDocument();
    expect(screen.queryByRole('tooltip', { hidden: true })).not.toBeInTheDocument();
    expect(screen.getByTestId('credits-ring')).not.toHaveAttribute('tabindex');
    expect(screen.getByTestId('credits-ring')).not.toHaveAttribute('aria-describedby');
    expectNoSplitLine();
    expect(screen.getByTestId('credits-card').textContent).not.toMatch(/left|of 0/);
  });

  it('no plan row: "This month", usage only', async () => {
    await renderWith(with_({ period: { kind: 'calendar_month', resetsOn: null }, allowance: null, remaining: null }));
    expect(screen.getByTestId('credits-period')).toHaveTextContent('This month');
    expect(screen.queryByTestId('credits-of')).not.toBeInTheDocument();
  });

  it('a failed read: the error line, never a zero', async () => {
    replies = [{ ok: false, status: 500, body: { success: false, error: 'Could not load your credits' } }];
    installFetch();
    render(<UsageCard />);
    await waitFor(() => expect(screen.getByTestId('credits-error')).toBeInTheDocument());
    expect(screen.getByTestId('credits-error')).toHaveTextContent(t('usage.error'));
    expect(screen.getByTestId('credits-headline')).toHaveTextContent('—');
    expect(screen.queryByRole('tooltip', { hidden: true })).not.toBeInTheDocument();
  });

  it('a malformed answer is an error, not a zero', async () => {
    replies = [{ ok: true, status: 200, body: { success: true, data: { used: 'lots' } } }];
    installFetch();
    render(<UsageCard />);
    await waitFor(() => expect(screen.getByTestId('credits-error')).toBeInTheDocument());
  });
});

describe.each<Lang>(['en', 'he', 'es'])('in %s', (language) => {
  beforeEach(() => {
    mockLang.language = language;
  });

  it('renders the title, the figures in the locale, and the direction', async () => {
    const view = await renderWith(FOUNDING_PARTNER);
    expect(screen.getByText(t('usage.title'))).toBeInTheDocument();
    expect(screen.getByTestId('credits-headline')).toHaveTextContent(pct(99));
    expect(screen.queryByTestId('credits-of')).not.toBeInTheDocument();
    expectNoSplitLine();
    expect(view.getByTestId('credits-card')).toHaveStyle({ direction: language === 'he' ? 'rtl' : 'ltr' });
  });

  it('the explanation is a tooltip on the ring, in the language, for a plan and a trial — not card text', async () => {
    const monthly = await renderWith(FOUNDING_PARTNER);
    expectExplainOnlyInTooltip(t('usage.explain.monthly'));
    monthly.unmount();

    await renderWith({
      period: { kind: 'trial_total', resetsOn: null },
      allowance: { amount: 2000, per: 'total' },
      used: 348,
      usedByOwner: 300,
      usedAutomatic: 48,
      granted: 0,
      remaining: 1652,
    });
    expectExplainOnlyInTooltip(t('usage.explain.trial'));
  });

  it('the tooltip opens on keyboard focus and on hover, and closes on blur, Escape and mouse-out', async () => {
    await renderWith(FOUNDING_PARTNER);
    const ring = screen.getByTestId('credits-ring');
    const tooltip = screen.getByRole('tooltip', { hidden: true });

    // Reachable by keyboard: the ring is a tab stop, described by the tooltip.
    expect(ring).toHaveAttribute('tabindex', '0');
    expect(ring).toHaveAttribute('aria-describedby', tooltip.id);
    expect(ring).toHaveAccessibleDescription(t('usage.explain.monthly'));
    expect(tooltip).not.toBeVisible();

    act(() => ring.focus());
    expect(ring).toHaveFocus();
    expect(tooltip).toBeVisible();
    expect(tooltip).toHaveTextContent(t('usage.explain.monthly'));

    fireEvent.keyDown(ring, { key: 'Escape' });
    expect(tooltip).not.toBeVisible();

    act(() => ring.blur());
    fireEvent.mouseEnter(ring);
    expect(tooltip).toBeVisible();
    fireEvent.mouseLeave(ring);
    expect(tooltip).not.toBeVisible();
  });

  it('never says "AI", tokens, dollars or cost anywhere on the card', async () => {
    for (const data of [FOUNDING_PARTNER, with_({ allowance: null, remaining: null })]) {
      const view = await renderWith(data);
      const text = view.getByTestId('credits-card').textContent ?? '';
      expect(text).not.toMatch(/\bAI\b|\bIA\b|token|\$|cost|dollar|pilot/i);
      view.unmount();
    }
  });
});

describe('refresh triggers (FR-39) — never a timer', () => {
  it('mount reads once, never cached', async () => {
    await renderWith(FOUNDING_PARTNER);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/business-os/usage', expect.objectContaining({ cache: 'no-store' }));
  });

  it('(a) the credit-usage signal re-reads once', async () => {
    await renderWith(FOUNDING_PARTNER);
    act(() => notifyCreditUsageChanged());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('(b) returning to the tab re-reads once; hiding it does not', async () => {
    await renderWith(FOUNDING_PARTNER);
    const visibility = jest.spyOn(document, 'visibilityState', 'get');

    visibility.mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    visibility.mockReturnValue('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    visibility.mockRestore();
  });

  it('(b) a page restored from the back-forward cache re-reads; an ordinary pageshow does not', async () => {
    await renderWith(FOUNDING_PARTNER);
    const pageshow = (persisted: boolean) => {
      const event = new Event('pageshow') as Event & { persisted: boolean };
      Object.defineProperty(event, 'persisted', { value: persisted });
      window.dispatchEvent(event);
    };
    act(() => pageshow(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => pageshow(true));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('(c) the refresh icon shows a loading state, then the figures', async () => {
    const releases = installHeldFetch();
    render(<UsageCard />);
    const button = screen.getByRole('button', { name: t('usage.refresh') });
    expect(button).toBeDisabled();
    await act(async () => releases.shift()!());
    await waitFor(() => expect(button).not.toBeDisabled());

    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => releases.shift()!());
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(screen.getByTestId('credits-headline')).toHaveTextContent(pct(99));
  });

  it('three triggers during a read cause exactly ONE more read (one request at a time)', async () => {
    const releases = installHeldFetch();
    render(<UsageCard />);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => {
      notifyCreditUsageChanged();
      notifyCreditUsageChanged();
      window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => releases.shift()!());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await act(async () => releases.shift()!());
    // Settled, and nothing more queued.
    await waitFor(() => expect(screen.getByRole('button', { name: t('usage.refresh') })).not.toBeDisabled());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('unmounting aborts the read in flight and stops listening', async () => {
    const releases = installHeldFetch();
    const view = render(<UsageCard />);
    const signal = (fetchMock.mock.calls[0][1] as RequestInit).signal!;
    view.unmount();
    expect(signal.aborted).toBe(true);
    act(() => notifyCreditUsageChanged());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    releases.forEach((r) => r());
  });
});
