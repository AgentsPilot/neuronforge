/**
 * @jest-environment jsdom
 *
 * The credit history panel, as an owner reads it (credit deduction slice 7a,
 * workplan §4.9, §7 "Render — states × languages"; SA SQ-37, Q-1, Q-4, Q-5).
 *
 * Rendered with the REAL dictionary in en, he and es, so the words asserted are
 * the words an owner sees. Every state: loading, error, empty (period and
 * trial), monthly, ungauged monthly, trial, no plan row, over the allowance,
 * restart, "Show more", a correction, "Other activity", a failed action,
 * "less than 0.1", Today / Yesterday in the business's clock. Numbers through
 * the same `Intl` call the panel makes.
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import type { CreditHistoryLine, CreditHistoryPage, CreditHistorySummary } from '@/lib/business-os/credits/creditHistoryTypes';

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
jest.mock('@/lib/supabaseClient', () => ({ supabase: {} }));

import { CreditHistoryPanel } from '@/components/business-os/CreditHistoryPanel';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};
const t = (key: string, vars: Record<string, string> = {}) => {
  let text = translations[mockLang.language][key];
  for (const [name, value] of Object.entries(vars)) text = text.replace(`{${name}}`, value);
  return text;
};
const n1 = (value: number) => new Intl.NumberFormat(mockLang.language, { maximumFractionDigits: 1 }).format(value);

const NOW = new Date('2026-10-02T12:00:00.000Z');

const LABEL = {
  chat: { en: 'Answered a question', he: 'מענה לשאלה', es: 'Respuesta a una pregunta' },
  briefing: { en: 'Wrote your daily briefing', he: 'כתיבת התדריך היומי', es: 'Redacción del resumen diario' },
  image: { en: 'Created an image', he: 'יצירת תמונה', es: 'Creación de una imagen' },
};

let idSeq = 0;
function line(over: Partial<CreditHistoryLine> = {}): CreditHistoryLine {
  idSeq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(idSeq).padStart(12, '0')}`,
    at: '2026-10-02T09:14:00.000Z',
    area: 'chat',
    label: LABEL.chat,
    who: 'you',
    didNotComplete: false,
    isCorrection: false,
    credits: 2.1,
    ...over,
  };
}

const MONTHLY: CreditHistorySummary = {
  period: { kind: 'monthly', startsOn: '2026-09-14T00:00:00.000Z', endsBefore: '2026-10-14T00:00:00.000Z' },
  used: 63.4,
  usedByOwner: 41.2,
  usedAutomatic: 22.2,
};

let fetchMock: jest.Mock;
function answer(...bodies: Array<{ status?: number; data?: unknown; success?: boolean }>) {
  let i = 0;
  fetchMock = jest.fn(async () => {
    const b = bodies[Math.min(i, bodies.length - 1)];
    i += 1;
    return { ok: (b.status ?? 200) < 400, status: b.status ?? 200, json: async () => ({ success: b.success ?? true, data: b.data }) };
  });
  global.fetch = fetchMock as unknown as typeof fetch;
}
const page = (p: Partial<CreditHistoryPage>): CreditHistoryPage => ({ lines: [], nextCursor: null, ...p });

async function openPanel() {
  render(<CreditHistoryPanel open onOpenChange={() => {}} />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByTestId('credit-history-loading')).not.toBeInTheDocument());
}

const panelText = () => screen.getByTestId('credit-history-panel').textContent ?? '';

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'setTimeout', 'setInterval'] });
  jest.setSystemTime(NOW);
  mockLang.language = 'en';
  mockLang.timezone = 'UTC';
  idSeq = 0;
});
afterEach(() => jest.useRealTimers());

describe.each<Lang>(['en', 'he', 'es'])('in %s', (lang) => {
  beforeEach(() => {
    mockLang.language = lang;
  });

  it('a monthly period: heading, period, exact total, split, lines, footnote', async () => {
    answer({
      data: page({
        summary: MONTHLY,
        lines: [
          line(),
          line({ area: 'briefing', label: LABEL.briefing, who: 'automatic', credits: 0.2, at: '2026-10-01T07:00:00.000Z' }),
          line({ area: 'leads', label: null, who: 'automatic', credits: 0.04, at: '2026-09-29T16:20:00.000Z' }),
        ],
      }),
    });
    await openPanel();

    expect(screen.getByText(t('credits.history.title'))).toBeInTheDocument();
    const dm = (iso: string) => new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(iso));
    expect(screen.getByTestId('credit-history-period')).toHaveTextContent(
      t('credits.history.period.this', { from: dm('2026-09-14T00:00:00.000Z'), to: dm('2026-10-13T12:00:00.000Z') })
    );
    expect(screen.getByTestId('credit-history-used')).toHaveTextContent(t('credits.history.used', { n: n1(63.4) }));
    expect(screen.getByTestId('credit-history-split')).toHaveTextContent(
      t('credits.history.split', { owner: n1(41.2), automatic: n1(22.2) })
    );

    const rows = screen.getAllByTestId('credit-history-line');
    expect(rows).toHaveLength(3);
    const clock = (iso: string) => new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(iso));
    expect(rows[0]).toHaveTextContent(t('credits.area.chat'));
    expect(rows[0]).toHaveTextContent(LABEL.chat[lang]);
    expect(rows[0]).toHaveTextContent(t('credits.history.today', { time: clock('2026-10-02T09:14:00.000Z') }));
    expect(rows[0]).toHaveTextContent(t('credits.history.who.you'));
    expect(within(rows[0]).getByTestId('credit-history-credits')).toHaveTextContent(n1(2.1));
    expect(rows[1]).toHaveTextContent(t('credits.history.yesterday', { time: clock('2026-10-01T07:00:00.000Z') }));
    expect(rows[1]).toHaveTextContent(t('credits.history.who.automatic'));
    // An older line: day and month; no label → "Other activity"; a tiny line → "less than 0.1".
    expect(rows[2]).toHaveTextContent(dm('2026-09-29T16:20:00.000Z'));
    expect(rows[2]).toHaveTextContent(t('credits.history.other'));
    expect(within(rows[2]).getByTestId('credit-history-credits')).toHaveTextContent(t('credits.history.less_than_tenth'));
    expect(screen.getByTestId('credit-history-footnote')).toHaveTextContent(t('credits.history.footnote'));
  });

  it('opens from the same side as the product\'s other drawers, with the reader\'s direction (SA Q-1)', async () => {
    answer({ data: page({ summary: MONTHLY, lines: [line()] }) });
    await openPanel();
    const panel = screen.getByTestId('credit-history-panel');
    expect(panel).toHaveAttribute('data-side', lang === 'he' ? 'left' : 'right');
    expect(panel).toHaveAttribute('dir', lang === 'he' ? 'rtl' : 'ltr');
  });

  it('a failed action is marked, and still shows its credits', async () => {
    answer({ data: page({ summary: MONTHLY, lines: [line({ didNotComplete: true, credits: 0.2 })] }) });
    await openPanel();
    expect(screen.getByTestId('credit-history-did-not-complete')).toHaveTextContent(t('credits.history.did_not_complete'));
    expect(screen.getByTestId('credit-history-credits')).toHaveTextContent(n1(0.2));
  });

  it('a correction reads "Correction to: {label}", signed; an unresolved one "Correction to: Other activity", with no You / Automatic (SA Q-4)', async () => {
    answer({
      data: page({
        summary: MONTHLY,
        lines: [
          line({ area: 'images', label: LABEL.image, who: 'you', isCorrection: true, credits: -12.5 }),
          line({ area: null, label: null, who: null, isCorrection: true, credits: -1 }),
        ],
      }),
    });
    await openPanel();
    const rows = screen.getAllByTestId('credit-history-line');
    expect(rows[0]).toHaveTextContent(t('credits.history.correction', { label: LABEL.image[lang] }));
    // QA-3: one minus sign, U+2212, for every negative figure.
    expect(within(rows[0]).getByTestId('credit-history-credits').textContent).toBe(`−${n1(12.5)}`);
    expect(rows[1]).toHaveTextContent(t('credits.history.correction', { label: t('credits.history.other') }));
    expect(rows[1].textContent).not.toContain(t('credits.history.who.you'));
    expect(rows[1].textContent).not.toContain(t('credits.history.who.automatic'));
  });

  it('a trial: "Since your trial began", no end date', async () => {
    answer({
      data: page({
        summary: { ...MONTHLY, period: { kind: 'trial_total', startsOn: '2026-09-20T00:00:00.000Z', endsBefore: null } },
        lines: [line()],
      }),
    });
    await openPanel();
    expect(screen.getByTestId('credit-history-period')).toHaveTextContent(t('credits.history.period.trial'));
  });

  it('no plan row: "This month"', async () => {
    answer({
      data: page({
        summary: { ...MONTHLY, period: { kind: 'calendar_month', startsOn: '2026-10-01T00:00:00.000Z', endsBefore: null } },
        lines: [line()],
      }),
    });
    await openPanel();
    expect(screen.getByTestId('credit-history-period')).toHaveTextContent(t('credits.history.period.month'));
  });

  it('a monthly period with no allowance: "since {from}", no end', async () => {
    answer({ data: page({ summary: { ...MONTHLY, period: { ...MONTHLY.period, endsBefore: null } }, lines: [line()] }) });
    await openPanel();
    const dm = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(MONTHLY.period.startsOn));
    expect(screen.getByTestId('credit-history-period')).toHaveTextContent(t('credits.history.period.since', { from: dm }));
  });

  it('over the allowance: the true total, no "left", no warning', async () => {
    answer({ data: page({ summary: { ...MONTHLY, used: 32260.4, usedByOwner: 32000.2, usedAutomatic: 260.2 }, lines: [line({ credits: 32000.2 })] }) });
    await openPanel();
    expect(screen.getByTestId('credit-history-used')).toHaveTextContent(n1(32260.4));
    const words = [translations[lang]['usage.left'], 'warn', 'paus', 'upgrade', 'limit'];
    for (const word of words) expect(panelText().toLowerCase()).not.toContain(word.toLowerCase());
  });

  it('nothing used this period: the empty sentence and the explanation — never an error', async () => {
    answer({ data: page({ summary: { ...MONTHLY, used: 0, usedByOwner: 0, usedAutomatic: 0 }, lines: [] }) });
    await openPanel();
    expect(screen.getByTestId('credit-history-empty')).toHaveTextContent(t('credits.history.empty'));
    expect(screen.getByTestId('credit-history-empty')).toHaveTextContent(translations[lang]['usage.explain.monthly']);
    expect(screen.queryByTestId('credit-history-footnote')).not.toBeInTheDocument();
    expect(screen.queryByTestId('credit-history-split')).not.toBeInTheDocument();
  });

  it('nothing used in a trial: the trial sentence (SA Q-5)', async () => {
    answer({
      data: page({
        summary: { period: { kind: 'trial_total', startsOn: '2026-09-20T00:00:00.000Z', endsBefore: null }, used: 0, usedByOwner: 0, usedAutomatic: 0 },
        lines: [],
      }),
    });
    await openPanel();
    expect(screen.getByTestId('credit-history-empty')).toHaveTextContent(t('credits.history.empty_trial'));
  });

  it('a failed read: the error line — never the empty state, never a zero', async () => {
    answer({ status: 500, success: false });
    await openPanel();
    expect(screen.getByTestId('credit-history-error')).toHaveTextContent(t('credits.history.error'));
    expect(screen.queryByTestId('credit-history-empty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('credit-history-used')).not.toBeInTheDocument();
  });

  it('never says "AI", tokens, dollars or cost', async () => {
    answer({ data: page({ summary: MONTHLY, lines: [line(), line({ area: 'images', label: LABEL.image })] }) });
    await openPanel();
    expect(panelText()).not.toMatch(/\bAI\b|\bIA\b|token|\$|cost|dollar|pilot/i);
  });
});

describe('reading', () => {
  it('a malformed payload is an error, not an empty history', async () => {
    answer({ data: { lines: 'nope' } });
    await openPanel();
    expect(screen.getByTestId('credit-history-error')).toBeInTheDocument();
  });

  it('shows a loading line while the first read is in flight', async () => {
    fetchMock = jest.fn(() => new Promise(() => {}));
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<CreditHistoryPanel open onOpenChange={() => {}} />);
    expect(await screen.findByTestId('credit-history-loading')).toHaveTextContent(t('credits.history.loading'));
  });

  it('reads once on open, never cached, and "Show more" appends the next page with the opaque cursor', async () => {
    answer(
      { data: page({ summary: MONTHLY, lines: [line(), line()], nextCursor: 'abc_DEF-123' }) },
      { data: page({ lines: [line({ credits: 0.2 })], nextCursor: null }) }
    );
    await openPanel();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual(['/api/business-os/credits/history', expect.objectContaining({ cache: 'no-store' })]);

    fireEvent.click(screen.getByTestId('credit-history-more'));
    await waitFor(() => expect(screen.getAllByTestId('credit-history-line')).toHaveLength(3));
    expect(fetchMock.mock.calls[1][0]).toBe('/api/business-os/credits/history?cursor=abc_DEF-123');
    expect(screen.queryByTestId('credit-history-more')).not.toBeInTheDocument();
    // The summary of page one stays.
    expect(screen.getByTestId('credit-history-used')).toBeInTheDocument();
  });

  it('a restart reloads page one under a fresh summary', async () => {
    answer(
      { data: page({ summary: MONTHLY, lines: [line(), line()], nextCursor: 'abc' }) },
      { data: { restart: true } },
      { data: page({ summary: { ...MONTHLY, used: 1.5, usedByOwner: 1.5, usedAutomatic: 0 }, lines: [line({ credits: 1.5 })] }) }
    );
    await openPanel();
    fireEvent.click(screen.getByTestId('credit-history-more'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2][0]).toBe('/api/business-os/credits/history');
    await waitFor(() => expect(screen.getAllByTestId('credit-history-line')).toHaveLength(1));
    expect(screen.getByTestId('credit-history-used')).toHaveTextContent(n1(1.5));
  });

  it('a second restart in a row is an error, not a loop', async () => {
    answer({ data: { restart: true } });
    await openPanel();
    await waitFor(() => expect(screen.getByTestId('credit-history-error')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reads again each time it opens, and not while closed', async () => {
    answer({ data: page({ summary: MONTHLY, lines: [line()] }) });
    const { rerender } = render(<CreditHistoryPanel open={false} onOpenChange={() => {}} />);
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
    rerender(<CreditHistoryPanel open onOpenChange={() => {}} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    rerender(<CreditHistoryPanel open={false} onOpenChange={() => {}} />);
    rerender(<CreditHistoryPanel open onOpenChange={() => {}} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('Today / Yesterday follow the business clock, not UTC', async () => {
    // 23:30 UTC on 1 Oct is already 2 Oct in Jerusalem (UTC+3): "Today".
    mockLang.timezone = 'Asia/Jerusalem';
    answer({ data: page({ summary: MONTHLY, lines: [line({ at: '2026-10-01T23:30:00.000Z' })] }) });
    await openPanel();
    const time = new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' }).format(new Date('2026-10-01T23:30:00.000Z'));
    expect(screen.getByTestId('credit-history-line')).toHaveTextContent(t('credits.history.today', { time }));
  });
});

describe('SA / QA follow-ups (CR7-4, CR7-7, QA-1, QA-3)', () => {
  it('QA-3: every negative figure uses the same minus sign (U+2212), tenths and "less than 0.1" alike', async () => {
    answer({
      data: page({
        summary: MONTHLY,
        lines: [line({ isCorrection: true, credits: -12.5 }), line({ isCorrection: true, credits: -0.04 })],
      }),
    });
    await openPanel();
    const figures = screen.getAllByTestId('credit-history-credits').map((el) => el.textContent ?? '');
    expect(figures).toEqual([`−${n1(12.5)}`, `−${t('credits.history.less_than_tenth')}`]);
    for (const text of figures) expect(text).not.toContain('-');
  });

  it.each<Lang>(['en', 'he', 'es'])('CR7-7: exactly 1.0 used reads in the singular (%s); 2 in the plural', async (lang) => {
    mockLang.language = lang;
    answer({ data: page({ summary: { ...MONTHLY, used: 1, usedByOwner: 1, usedAutomatic: 0 }, lines: [line({ credits: 1 })] }) });
    await openPanel();
    expect(screen.getByTestId('credit-history-used')).toHaveTextContent(t('credits.history.used_one', { n: n1(1) }));
    expect(t('credits.history.used_one', { n: '1' })).not.toBe(t('credits.history.used', { n: '1' }));
  });

  it('CR7-7: 2 credits stays plural', async () => {
    answer({ data: page({ summary: { ...MONTHLY, used: 2, usedByOwner: 2, usedAutomatic: 0 }, lines: [line({ credits: 2 })] }) });
    await openPanel();
    expect(screen.getByTestId('credit-history-used')).toHaveTextContent(t('credits.history.used', { n: n1(2) }));
  });

  it('CR7-4: "Yesterday" is the calendar day before today in the business clock, even on a daylight-saving day', async () => {
    // London springs forward on 29 Mar 2026. At 00:30 BST on 30 Mar, "now − 24 h"
    // is 23:30 GMT on 28 Mar — one day too far back. A line on 29 Mar is still Yesterday.
    jest.setSystemTime(new Date('2026-03-29T23:30:00.000Z'));
    mockLang.timezone = 'Europe/London';
    answer({ data: page({ summary: MONTHLY, lines: [line({ at: '2026-03-29T09:00:00.000Z' }), line({ at: '2026-03-28T09:00:00.000Z' })] }) });
    await openPanel();
    const rows = screen.getAllByTestId('credit-history-line');
    const clock = (iso: string) => new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }).format(new Date(iso));
    expect(rows[0]).toHaveTextContent(t('credits.history.yesterday', { time: clock('2026-03-29T09:00:00.000Z') }));
    expect(rows[1].textContent).not.toContain(t('credits.history.yesterday', { time: '' }).trim());
  });

  it('QA-1: on reopen the previous figures are not shown while page one is read again', async () => {
    answer({ data: page({ summary: MONTHLY, lines: [line(), line()] }) });
    const { rerender } = render(<CreditHistoryPanel open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getAllByTestId('credit-history-line')).toHaveLength(2));

    rerender(<CreditHistoryPanel open={false} onOpenChange={() => {}} />);
    fetchMock = jest.fn(() => new Promise(() => {}));
    global.fetch = fetchMock as unknown as typeof fetch;
    rerender(<CreditHistoryPanel open onOpenChange={() => {}} />);

    expect(await screen.findByTestId('credit-history-loading')).toBeInTheDocument();
    expect(screen.queryAllByTestId('credit-history-line')).toHaveLength(0);
    expect(screen.queryByTestId('credit-history-used')).not.toBeInTheDocument();
  });
});
