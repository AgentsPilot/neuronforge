/**
 * @jest-environment jsdom
 *
 * The verdict chips name what moved, and never say it moved the wrong way.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE OWNER SAW
 *
 *     2 השתפרו · 1 ירדו · 5 חסרים נתונים
 *
 * and asked the only question that matters about a summary:
 *
 *     "What does it mean? what improved or decreased?"
 *
 * The answer was on the same page, sixty lines below, in `HealthRows`. Nothing
 * connected them. And the single declined category was cancellations — 23.5%,
 * up from 10% — the most actionable fact on the page, rendered as the digit 1.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TRAP THIS FILE EXISTS FOR
 *
 * `HIGHER_IS_BETTER.cancellations` is FALSE. It is the one category where the
 * rate going UP is the bad news. So the chip must not pair a category name with
 * a word about the number moving:
 *
 *     "ביטולים ירדו"   cancellations went DOWN   — the opposite of the truth
 *     "הרעה: ביטולים"  worsening: cancellations  — what actually happened
 *
 * Hence nouns before a colon. They describe the MOVE rather than the figure,
 * and need no agreement with however many categories follow.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

jest.mock('@/lib/business-os/LanguageContext', () => {
  const { translations } = jest.requireActual('@/lib/business-os/LanguageContext');
  return {
    useLanguage: () => ({
      language: 'en',
      isRTL: false,
      t: (key: string) => translations.en[key] || key,
    }),
  };
});

import { VerdictLine } from '@/components/business-os/reports/VerdictLine';
import type { CategoryHealth } from '@/lib/business-os/insight/health/businessHealth';

/** One measured category, moved by `change` points. */
const cat = (category: string, change: number | null): CategoryHealth =>
  ({
    category,
    measureKey: 'health.measure.none',
    rate: 50,
    previousRate: 50 - (change ?? 0),
    change,
    sample: 20,
    unavailable: change === null ? 'too_little_data' : null,
  }) as unknown as CategoryHealth;

describe('naming what moved', () => {
  it('names a single improved category instead of counting it', () => {
    render(
      <VerdictLine
        narrative="x"
        improved={1}
        declined={0}
        steady={0}
        unavailable={0}
        categories={[cat('cash_flow', 15.7)]}
      />
    );

    expect(screen.getByText('Improved: Cash Flow')).toBeInTheDocument();
    expect(screen.queryByText('1 improved')).not.toBeInTheDocument();
  });

  it('names two, which is the limit before a chip becomes a sentence', () => {
    render(
      <VerdictLine
        narrative="x"
        improved={2}
        declined={0}
        steady={0}
        unavailable={0}
        categories={[cat('cash_flow', 15.7), cat('operations', 3.9)]}
      />
    );

    expect(screen.getByText('Improved: Cash Flow, Operations')).toBeInTheDocument();
  });

  it('falls back to the count at three, rather than listing them', () => {
    render(
      <VerdictLine
        narrative="x"
        improved={3}
        declined={0}
        steady={0}
        unavailable={0}
        categories={[cat('cash_flow', 10), cat('operations', 10), cat('retention', 10)]}
      />
    );

    expect(screen.getByText('3 improved')).toBeInTheDocument();
  });
});

describe('the cancellations trap', () => {
  it('files a RISING cancellation rate as worsened, never as improved', () => {
    /*
     * THE BUG THIS FILE IS MOST FOR. A local `change > 0` means "improved" for
     * seven categories and the exact opposite for this one. The component
     * imports `movedForTheWorse` rather than reimplementing the rule.
     */
    render(
      <VerdictLine
        narrative="x"
        improved={0}
        declined={1}
        steady={0}
        unavailable={0}
        categories={[cat('cancellations', 13.5)]}
      />
    );

    expect(screen.getByText('Worsened: Cancellations')).toBeInTheDocument();
  });

  it('never pairs the name with a word about the number moving', () => {
    /* "Cancellations slipped" would read as the rate falling, which is the
       opposite of what a declined cancellations category means. */
    render(
      <VerdictLine
        narrative="x"
        improved={0}
        declined={1}
        steady={0}
        unavailable={0}
        categories={[cat('cancellations', 13.5)]}
      />
    );

    expect(screen.queryByText(/slipped/)).not.toBeInTheDocument();
  });

  it('files a FALLING cancellation rate as improved', () => {
    render(
      <VerdictLine
        narrative="x"
        improved={1}
        declined={0}
        steady={0}
        unavailable={0}
        categories={[cat('cancellations', -13.5)]}
      />
    );

    expect(screen.getByText('Improved: Cancellations')).toBeInTheDocument();
  });
});

describe('what is deliberately still a count', () => {
  it('the categories with too little data, however few', () => {
    /* Naming the measures nobody can measure yet is the noise the zero
       suppression exists to avoid. */
    render(
      <VerdictLine
        narrative="x"
        improved={0}
        declined={0}
        steady={0}
        unavailable={2}
        categories={[cat('sales', null), cat('retention', null)]}
      />
    );

    expect(screen.getByText('2 need more data')).toBeInTheDocument();
  });
});

describe('an account whose summary predates the field', () => {
  it('still gets the counts it always had', () => {
    /* `categories` absent is not `categories` empty, and neither may blank the
       chip: the counts are the behaviour this component shipped with. */
    render(<VerdictLine narrative="x" improved={2} declined={1} steady={0} unavailable={5} />);

    expect(screen.getByText('2 improved')).toBeInTheDocument();
    expect(screen.getByText('1 slipped')).toBeInTheDocument();
    expect(screen.getByText('5 need more data')).toBeInTheDocument();
  });
});
