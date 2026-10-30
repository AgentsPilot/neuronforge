/**
 * @jest-environment jsdom
 *
 * "Read the rest" is offered only when there IS a rest.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * The button rendered on `summary_narrative.length > 220` — a character count
 * standing in for a question only the layout can answer. The paragraph is
 * clamped to three LINES, and how many lines a string takes depends on the
 * column width, the font and the language.
 *
 * A Hebrew note on a desktop fitted inside its three lines with nothing hidden,
 * ran past 220 characters, and the card offered to show the owner the rest of a
 * paragraph they had just finished reading. Pressing it did nothing visible,
 * which is the worst kind of control: one that lies about there being more.
 *
 * So the component now MEASURES — `scrollHeight` against `clientHeight` on the
 * clamped element — and these tests drive that measurement directly, because
 * jsdom lays nothing out and reports both as zero.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import '@testing-library/jest-dom';
import { render, screen, act } from '@testing-library/react';

import { WeeklyReview } from '../WeeklyReview';
import type { BusinessHealthSummaryData } from '@/hooks/useInsights';

let language = 'en';
jest.mock('@/lib/business-os/LanguageContext', () => ({
  useLanguage: () => ({
    language,
    isRTL: language === 'he',
    t: (key: string, params?: Record<string, unknown>) => {
      const dict: Record<string, string> = {
        'health.more': 'Read the rest',
        'health.less': 'Show less',
      };
      return (dict[key] ?? key).replace(/\{(\w+)\}/g, (_, p) => String(params?.[p] ?? ''));
    },
  }),
}));

/**
 * The paragraph's two heights, which jsdom does not compute.
 *
 * Both are read-only accessors on the prototype, so they are stubbed there and
 * restored after each test. `clamped` is the three lines on screen; `full` is
 * what the text would need.
 */
function layout({ full, clamped }: { full: number; clamped: number }) {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      return this.tagName === 'P' ? full : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return this.tagName === 'P' ? clamped : 0;
    },
  });
}

afterEach(() => {
  // @ts-expect-error -- removing the stub restores jsdom's own zero-height getters.
  delete HTMLElement.prototype.scrollHeight;
  // @ts-expect-error -- as above.
  delete HTMLElement.prototype.clientHeight;
  language = 'en';
});

/* The Hebrew note from the live account: 221 characters, three lines, nothing
   hidden. The exact case that shipped the wrong button. */
const HEBREW_NOTE =
  'בשבוע האחרון, 53.8% מהחשבוניות שלך שולמו בזמן, עלייה של 8.4 נקודות מ-45.5%. ' +
  'יש לך 29 שעות ריקות בשבוע הקרוב, עם פוטנציאל הכנסה של 11,600₪. ' +
  'כדאי לפרסם מבצע מיוחד או הנחה לפגישות הקרובות כדי למלא את הפניות הפנויות שלך היום.';

const summary = (narrative: string) =>
  ({
    id: 'sum-1',
    health_score: null,
    summary_title: 'More invoices were paid on time',
    summary_narrative: narrative,
    highlights: [],
    priorities: [],
    period_start: '2026-10-25T00:00:00+00:00',
    period_end: '2026-10-31T23:59:59+00:00',
    created_at: '2026-10-25T03:30:51+00:00',
    insight_count: 0,
    critical_count: 0,
    high_count: 0,
    total_impact_usd: 0,
  }) as unknown as BusinessHealthSummaryData;

describe('the read-the-rest button', () => {
  it('is absent when the note fits, however many characters it runs to', () => {
    /*
     * 221 characters and three lines. The old rule showed the button on the
     * character count alone; the measurement says there is nothing below the
     * fold, and there is not.
     */
    language = 'he';
    layout({ full: 63, clamped: 63 });

    render(<WeeklyReview summary={summary(HEBREW_NOTE)} />);

    expect(HEBREW_NOTE.length).toBeGreaterThan(220);
    expect(screen.queryByRole('button', { name: 'Read the rest' })).toBeNull();
  });

  it('is there when the clamp is genuinely hiding lines', () => {
    layout({ full: 147, clamped: 63 });

    render(<WeeklyReview summary={summary(HEBREW_NOTE)} />);

    expect(screen.getByRole('button', { name: 'Read the rest' })).toBeInTheDocument();
  });

  it('is absent for a short note, as it always was', () => {
    layout({ full: 21, clamped: 21 });

    render(<WeeklyReview summary={summary('Short note.')} />);

    expect(screen.queryByRole('button', { name: 'Read the rest' })).toBeNull();
  });

  it('becomes "show less" once pressed, and does not vanish mid-read', () => {
    /*
     * Expanded, the paragraph grows to fit and reports no overflow. Measuring
     * in that state would withdraw the only control that collapses it again —
     * so the component stops measuring while expanded, and this pins that.
     */
    layout({ full: 147, clamped: 63 });

    render(<WeeklyReview summary={summary(HEBREW_NOTE)} />);

    act(() => {
      screen.getByRole('button', { name: 'Read the rest' }).click();
    });

    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument();
  });

  it('tolerates a sub-pixel difference rather than offering a phantom line', () => {
    // Fractional line heights round the two apart with nothing actually hidden.
    layout({ full: 63.5, clamped: 63 });

    render(<WeeklyReview summary={summary(HEBREW_NOTE)} />);

    expect(screen.queryByRole('button', { name: 'Read the rest' })).toBeNull();
  });
});
