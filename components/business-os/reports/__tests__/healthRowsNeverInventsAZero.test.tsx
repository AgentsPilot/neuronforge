/**
 * @jest-environment jsdom
 *
 * The three states a health rate can be in, and why flattening any two of them
 * loses or invents information.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *   0%   a real measurement whose answer is zero. The sample cleared
 *        `MIN_SAMPLE`, the arithmetic ran, the result was none. Nobody came
 *        back. This is the most actionable figure the page can show and it MUST
 *        render as 0%.
 *
 *   —    with "not enough data yet · needs 8, has 5": the platform measured and
 *        cannot say. Below `MIN_SAMPLE` a percentage swings on one event — with
 *        four contacts a conversion rate can only be 0, 25, 50 or 75, none of
 *        which is information.
 *
 *   —    alone: no nightly summary exists, so nothing was computed either way.
 *
 * Rendering the second as "0%" would tell a business with four website visitors
 * that NOBODY who visits ever gets in touch. Rendering the first as a dash
 * throws away a real answer. `scoreCategory` keeps `0` and `null` apart; this
 * component's only job is not to flatten them, which is what these tests pin.
 *
 * The band also always draws all six rows, so an owner can see which six
 * questions the page answers before it has answers.
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
      formatCurrency: (amount: number) => String(amount),
    }),
  };
});

import { HealthRows } from '@/components/business-os/reports/HealthRows';
import type { HealthMeasure } from '@/hooks/useInsights';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: { en: Record<string, string> };
};
const NOT_ENOUGH = translations.en['reports.not_enough_data'];

/** Measured, moving up. The ordinary case. */
const measured: HealthMeasure = {
  category: 'cash_flow',
  rate: 82.4,
  previousRate: 75.2,
  change: 7.2,
  measureKey: 'health.measure.invoices_paid_on_time',
  unavailable: null,
  sample: 17,
};

/** Measured, and the answer is none. Nine clients, not one came back. */
const measuredZero: HealthMeasure = {
  category: 'retention',
  rate: 0,
  previousRate: 12,
  change: -12,
  measureKey: 'health.measure.clients_who_returned',
  unavailable: null,
  sample: 9,
};

/** Below MIN_SAMPLE for acquisition, which needs 25. There is no rate. */
const tooLittle: HealthMeasure = {
  category: 'acquisition',
  rate: null,
  previousRate: null,
  change: null,
  measureKey: 'health.measure.visitors_who_got_in_touch',
  unavailable: 'too_little_data',
  sample: 4,
};

/** A rate, but no previous period to compare it with. A first month. */
const noTrend: HealthMeasure = {
  category: 'sales',
  rate: 31,
  previousRate: null,
  change: null,
  measureKey: 'health.measure.enquiries_replied_to',
  unavailable: null,
  sample: 9,
};

/** Measured and genuinely unchanged, which is a real answer. */
const steady: HealthMeasure = {
  category: 'conversion',
  rate: 64,
  previousRate: 64,
  change: 0,
  measureKey: 'health.measure.contacts_who_became_clients',
  unavailable: null,
  sample: 11,
};

/** Nothing records a discount, so pricing can never be measured. */
const pricing: HealthMeasure = {
  category: 'pricing',
  rate: null,
  previousRate: null,
  change: null,
  measureKey: 'health.measure.none',
  unavailable: 'not_measurable',
  sample: 0,
};

/**
 * Cancellations rising. The one measure where the number going UP is bad news.
 *
 * This file's subject used to be "never invent a zero". It is also now the only
 * place that can catch the hazard `HealthRows.tsx` wrote down for itself:
 * "every measure here is higher-is-better, so up is always good. If a
 * lower-is-better measure is ever added, this assumption breaks and the colours
 * silently invert." Nothing would have failed. The owner would simply have been
 * congratulated, in green, for cancellations tripling.
 */
const cancellationsUp: HealthMeasure = {
  category: 'cancellations',
  rate: 19,
  previousRate: 4,
  change: 15,
  measureKey: 'health.measure.appointments_called_off',
  unavailable: null,
  sample: 21,
};

/** And falling, which IS good news however the arrow points. */
const cancellationsDown: HealthMeasure = {
  category: 'cancellations',
  rate: 4,
  previousRate: 19,
  change: -15,
  measureKey: 'health.measure.appointments_called_off',
  unavailable: null,
  sample: 21,
};

describe('HealthRows', () => {
  it('paints a RISING cancellation rate as bad news, not good', () => {
    render(<HealthRows categories={[cancellationsUp]} />);

    const change = screen.getByText(/15/);
    const tone = change.closest('span')!.className;

    /* The number rose, so the arrow points up — a down arrow beside "+15
       points" would be its own lie. Only the COLOUR carries the meaning. */
    expect(tone).toMatch(/rose-/);
    expect(tone).not.toMatch(/emerald-/);
  });

  it('paints a FALLING cancellation rate as good news', () => {
    render(<HealthRows categories={[cancellationsDown]} />);

    const tone = screen.getByText(/15/).closest('span')!.className;
    expect(tone).toMatch(/emerald-/);
    expect(tone).not.toMatch(/rose-/);
  });

  it('still paints a FALLING higher-is-better measure as bad', () => {
    /* The control: the direction change must not have inverted everything
       else. Retention fell 12 points here, which is bad news and always was. */
    render(<HealthRows categories={[measuredZero]} />);

    const tone = screen.getByText(/12/).closest('span')!.className;
    expect(tone).toMatch(/rose-/);
    expect(tone).not.toMatch(/emerald-/);
  });

  it('shows a measured zero as 0%, because none is an answer', () => {
    render(<HealthRows categories={[measuredZero]} />);

    expect(screen.getByText('0%')).toBeInTheDocument();
    // It is a measurement, so it must not carry the "cannot say" caption.
    expect(screen.queryByText(new RegExp(NOT_ENOUGH))).not.toBeInTheDocument();
    // And it moved, so the direction is real too.
    expect(screen.getByText(/12/)).toBeInTheDocument();
  });

  it('shows an unmeasurable rate as a dash, never as a zero', () => {
    render(<HealthRows categories={[tooLittle]} />);

    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(screen.getByText(new RegExp(NOT_ENOUGH))).toBeInTheDocument();
  });

  it('says how far short the sample is, so the gap reads as closable', () => {
    // Acquisition needs 25 and this fixture has 4. Naming both turns a bare
    // dash into something the owner can act on: the gap closes by trading.
    render(<HealthRows categories={[tooLittle]} />);

    expect(screen.getByText(/needs 25, has 4/)).toBeInTheDocument();
  });

  it('shows the rate and the points moved when both are known', () => {
    render(<HealthRows categories={[measured]} />);

    expect(screen.getByText('82.4%')).toBeInTheDocument();
    expect(screen.getByText(/7\.2/)).toBeInTheDocument();
  });

  it('shows a rate with no trend figure when there is nothing to compare with', () => {
    render(<HealthRows categories={[noTrend]} />);

    expect(screen.getByText('31%')).toBeInTheDocument();
    // Nothing may claim a direction. A first month has not moved anywhere.
    expect(screen.queryByText(/pts/)).not.toBeInTheDocument();
  });

  it('marks a genuinely unchanged measure without inventing a points figure', () => {
    render(<HealthRows categories={[steady]} />);

    expect(screen.getByText('64%')).toBeInTheDocument();
    // Steady is shown by the icon alone: "0 pts" reads as a measurement error.
    expect(screen.queryByText(/pts/)).not.toBeInTheDocument();
  });

  it('keeps every row with no summary at all, and stays silent in them', () => {
    render(<HealthRows categories={null} />);

    // The six questions are visible before there are answers, so an owner can
    // see what the page will report rather than an apparently unbuilt band.
    /* One per DISPLAY_ORDER entry. Grew to 7 when `cancellations` was
       added; the count is the point, not the number. */
    expect(screen.getAllByText('—')).toHaveLength(7);
    // Nothing was attempted, so there is no shortfall to explain.
    expect(screen.queryByText(new RegExp(NOT_ENOUGH))).not.toBeInTheDocument();
    expect(screen.getByText(translations.en['health.measure.invoices_paid_on_time'])).toBeInTheDocument();
    // The last row in DISPLAY_ORDER, so the whole list is present and in order.
    expect(screen.getByText(translations.en['health.measure.calendar_filled'])).toBeInTheDocument();
  });

  it('always draws every row, filling only the ones it has', () => {
    render(<HealthRows categories={[measured, measuredZero]} />);

    expect(screen.getByText('82.4%')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
    // The other four are present and empty.
    expect(screen.getAllByText('—')).toHaveLength(5);
  });

  it('never shows pricing, which nothing can ever measure', () => {
    render(<HealthRows categories={[measured, pricing]} />);

    expect(screen.queryByText(translations.en['health.measure.none'])).not.toBeInTheDocument();
    // And no row may leak the Infinity minimum as a shortfall.
    expect(screen.queryByText(/Infinity/)).not.toBeInTheDocument();
    expect(screen.queryByText(/needs/)).not.toBeInTheDocument();
  });
});
