/**
 * @jest-environment jsdom
 *
 * The weekly note says when it was worked out.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE QUESTION THIS ANSWERS
 *
 * "Is this really doing anything? Is this live and updated?" — asked by an
 * owner looking at the card on a Wednesday.
 *
 * It was live, and it was three days old. The row is written once, on the first
 * nightly run of the week, and `createOrUpdateHealthSummary` deliberately
 * returns early for the rest of the week: a rolling 28-day window moves a
 * quarter per week, and regenerating the narrative nightly meant paying for
 * seven and showing one. The freeze is right; saying nothing about it was not.
 *
 * On that Wednesday the card was also still quoting an issue the owner had
 * dismissed the day before, which is what a frozen snapshot looks like from the
 * outside when it does not admit to being one.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

import { WeeklyReview } from '../WeeklyReview';
import type { BusinessHealthSummaryData } from '@/hooks/useInsights';

let language = 'en';
jest.mock('@/lib/business-os/LanguageContext', () => ({
  useLanguage: () => ({
    language,
    isRTL: language === 'he',
    // The real strings, so a changed key is a failure here rather than a blank.
    t: (key: string, params?: Record<string, unknown>) => {
      const dict: Record<string, string> = {
        'health.as_of': 'Worked out {date}. Updates again next Sunday.',
        'health.moving': '{improved} of {total} measures improved',
      };
      return (dict[key] ?? key).replace(/\{(\w+)\}/g, (_, p) => String(params?.[p] ?? ''));
    },
  }),
}));

const summary = (overrides: Partial<BusinessHealthSummaryData> = {}) =>
  ({
    id: 'sum-1',
    health_score: null,
    summary_title: 'More invoices were paid on time',
    summary_narrative: 'Short note.',
    highlights: [],
    priorities: [],
    period_start: '2026-10-25T00:00:00+00:00',
    period_end: '2026-10-31T23:59:59+00:00',
    created_at: '2026-10-25T03:30:51+00:00',
    insight_count: 7,
    critical_count: 2,
    high_count: 1,
    total_impact_usd: 0,
    ...overrides,
  }) as unknown as BusinessHealthSummaryData;

describe('the stamp', () => {
  beforeEach(() => {
    language = 'en';
  });

  it('names the day it was written, not just a date', () => {
    /*
     * "Sunday 25 Oct" is read at a glance. "25/10" has to be counted back from
     * today, which is the work the line exists to save.
     */
    render(<WeeklyReview summary={summary()} />);

    expect(screen.getByText(/Worked out Sunday 25 Oct/)).toBeInTheDocument();
  });

  it('names the same day whatever clock the reader is on', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE BUG THIS LINE SHIPPED WITH, CAUGHT BY THIS FILE.
     *
     * The stamp is 03:30 UTC. Handed to `toLocaleDateString` as an instant it
     * printed "Saturday 24 Oct" for every reader west of Greenwich: the right
     * moment, the wrong day, on a line that exists to name the day.
     *
     * Asserted by running the component under a US timezone. A plain date
     * cannot shift; a timestamp can, and did.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const tz = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';

    try {
      render(<WeeklyReview summary={summary()} />);
      expect(screen.getByText(/Sunday 25 Oct/)).toBeInTheDocument();
      expect(screen.queryByText(/24 Oct/)).toBeNull();
    } finally {
      process.env.TZ = tz;
    }
  });

  it('says when it will change, so a week-old note does not read as broken', () => {
    render(<WeeklyReview summary={summary()} />);

    expect(screen.getByText(/Updates again next Sunday/)).toBeInTheDocument();
  });

  it('falls back to the period when the row predates the column', () => {
    // `created_at` reached the client type late. Summaries written before that
    // still have a period start, and the Sunday it names is the same day.
    render(<WeeklyReview summary={summary({ created_at: undefined })} />);

    expect(screen.getByText(/Worked out Sunday 25 Oct/)).toBeInTheDocument();
  });

  it('is written in the owner\'s own calendar words', () => {
    language = 'he';
    render(<WeeklyReview summary={summary()} />);

    // Hebrew weekday for a Sunday, formatted by the browser rather than by us.
    expect(screen.getByText(/יום ראשון, 25/)).toBeInTheDocument();
  });
});
