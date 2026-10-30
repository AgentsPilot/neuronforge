/**
 * @jest-environment jsdom
 *
 * The line under a rate names the number it was taken of, and its unit.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The live card read "12.5% מהשעות שלך תפוסות · מתוך 16" — 12.5% of your hours
 * booked, from 16. The rate was 16 booked hours over the 128 the owner offers;
 * the 16 underneath was the BOOKINGS count, which is what `MIN_SAMPLE` gates on
 * and not what anything divided by. A reader checking it got 2 of 16.
 *
 * Where a measure carries its own denominator, the chip shows that with its
 * unit named. Where it does not — every measure but operations, and every
 * summary stored before the field existed — it shows the sample exactly as it
 * always did.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

import { WeeklyReview } from '../WeeklyReview';
import type { BusinessHealthSummaryData, HealthMeasure } from '@/hooks/useInsights';

jest.mock('@/lib/business-os/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en',
    isRTL: false,
    t: (key: string, params?: Record<string, unknown>) => {
      const dict: Record<string, string> = {
        'health.of_n': 'from {n}',
        'health.of_n_unit': 'of {n} {unit}',
        'health.unit.hours': 'hours you offer',
        'health.measure.calendar_filled': 'of your hours booked',
        'health.measure.invoices_paid_on_time': 'invoices paid on time',
      };
      return (dict[key] ?? key).replace(/\{(\w+)\}/g, (_, p) => String(params?.[p] ?? ''));
    },
  }),
}));

const measure = (overrides: Partial<HealthMeasure>): HealthMeasure =>
  ({
    category: 'operations',
    rate: 12.5,
    previousRate: null,
    change: null,
    measureKey: 'health.measure.calendar_filled',
    unavailable: null,
    sample: 16,
    ...overrides,
  }) as HealthMeasure;

const summary = (measures: HealthMeasure[]) =>
  ({
    id: 'sum-1',
    health_score: null,
    summary_title: 'More invoices were paid on time',
    summary_narrative: 'Short note.',
    highlights: [],
    priorities: [],
    period_start: '2026-10-25T00:00:00+00:00',
    period_end: '2026-10-31T23:59:59.999+00:00',
    created_at: '2026-10-25T03:30:51+00:00',
    insight_count: 0,
    critical_count: 0,
    high_count: 0,
    total_impact_usd: 0,
    health_measures: {
      categories: measures,
      movingUp: null,
      improved: 0,
      declined: 0,
      steady: 0,
      measured: measures.length,
      unavailable: 0,
    },
  }) as unknown as BusinessHealthSummaryData;

describe('the figure under a measured rate', () => {
  it('names the hours the calendar rate was divided by, not the booking count', () => {
    render(
      <WeeklyReview
        summary={summary([
          measure({ basis: { value: 128, unitKey: 'health.unit.hours' } }),
        ])}
      />
    );

    expect(screen.getByText('of 128 hours you offer')).toBeInTheDocument();
    // 16 was the bookings count. 12.5% of 16 is 2, which is not what happened.
    expect(screen.queryByText('from 16')).toBeNull();
  });

  it('still shows the sample for a measure whose sample IS the denominator', () => {
    render(
      <WeeklyReview
        summary={summary([
          measure({
            category: 'cash_flow',
            rate: 53.8,
            sample: 26,
            measureKey: 'health.measure.invoices_paid_on_time',
          }),
        ])}
      />
    );

    expect(screen.getByText('from 26')).toBeInTheDocument();
  });

  it('renders a summary stored before the field existed exactly as before', () => {
    // Old rows carry no `basis` at all. They must not lose their sample line.
    render(<WeeklyReview summary={summary([measure({ basis: undefined })])} />);

    expect(screen.getByText('from 16')).toBeInTheDocument();
  });
});
