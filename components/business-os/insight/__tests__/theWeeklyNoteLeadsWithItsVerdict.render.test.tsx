/**
 * @jest-environment jsdom
 *
 * The weekly note shows its verdict and nothing else until asked.
 *
 * The collapse used to cut the PARAGRAPH to three lines and leave everything
 * else standing: the figures, the "not enough data yet" line, and the rest of
 * the prose. On a dashboard where this card is one of several, that is still a
 * full-height block. Owner decision 2026-11-10: the headline leads, the detail
 * is behind the toggle.
 *
 * Rendered rather than read as source, because what matters is what an owner
 * can see before they click, and these assertions fail against the old clamp:
 * a clamped paragraph is in the DOM, which is exactly the thing being changed.
 *
 * SUPERSEDES `readTheRestIsOfferedOnlyWhenThereIsMore.render.test.tsx`, which
 * drove the clamp's `scrollHeight` against `clientHeight` measurement with
 * stubbed layout. That measurement is gone with the clamp, so its five cases
 * tested a component that no longer exists. The one rule of its that still
 * holds — a toggle is offered only when something is behind it — is the
 * "nothing to open" block below. Its lesson, that `narrative.length > 220` is a
 * biased proxy for a question only the layout can answer, is kept in the
 * component itself, where the next person to add a clamp will read it.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('@/lib/business-os/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en',
    /* `key` is genuinely optional here: a measure carries its own
       `measureKey`, and a fixture without one asks the translator for
       undefined. The real translator tolerates it; so must this. */
    t: (key?: string, vars?: Record<string, string>) => {
      if (!key) return '';
      if (key === 'health.open') return 'Show the detail';
      if (key === 'health.less') return 'Show less';
      if (key === 'health.not_yet') return `Not enough data yet to measure ${vars?.categories ?? ''}.`;
      if (key.startsWith('health.measuring.')) return key.replace('health.measuring.', '');
      if (key === 'health.as_of') return `Worked out ${vars?.date ?? ''}.`;
      return key;
    },
  }),
}));

import { WeeklyReview } from '@/components/business-os/insight/WeeklyReview';

const NARRATIVE =
  'In the last month, 38.9% of meetings were cancelled, up 31.7 points from 7.1%.';

const summary = {
  summary_title: 'Cancellations are eating the week.',
  summary_narrative: NARRATIVE,
  created_at: '2026-11-08T03:30:00Z',
  period_start: '2026-11-08',
  priorities: [],
  health_measures: {
    categories: [
      { category: 'invoices_paid_on_time', rate: 47.1, change: -0.9, sample: 17 },
      { category: 'hours_booked', rate: 8.6, change: -0.8, sample: 128 },
      { category: 'meetings_cancelled', rate: 38.9, change: 31.7, sample: 18 },
      { category: 'repeat_clients', rate: null, change: null, sample: 0 },
    ],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

describe('collapsed', () => {
  it('shows the verdict headline', () => {
    render(<WeeklyReview summary={summary} />);
    expect(screen.getByText('Cancellations are eating the week.')).toBeInTheDocument();
  });

  it('hides the narrative, the figures and the not-yet line', () => {
    render(<WeeklyReview summary={summary} />);

    expect(screen.queryByText(NARRATIVE)).not.toBeInTheDocument();
    /* The figures: a sample line that only a measure chip renders. */
    expect(screen.queryByText(/47\.1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/38\.9/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Not enough data yet/)).not.toBeInTheDocument();
  });

  it('offers one control, and says it opens detail rather than "the rest"', () => {
    render(<WeeklyReview summary={summary} />);
    const toggle = screen.getByRole('button', { name: 'Show the detail' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('opened', () => {
  it('shows all of it, and the toggle turns into Show less', () => {
    render(<WeeklyReview summary={summary} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show the detail' }));

    expect(screen.getByText(NARRATIVE)).toBeInTheDocument();
    /* `getAll`, because 38.9 is in the narrative AND on its chip: the figure
       the owner reads twice is the point, not an ambiguity to assert around. */
    expect(screen.getAllByText(/47\.1/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/38\.9/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Not enough data yet/)).toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: 'Show less' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes again', () => {
    render(<WeeklyReview summary={summary} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show the detail' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }));

    expect(screen.queryByText(NARRATIVE)).not.toBeInTheDocument();
  });
});

describe('nothing to open', () => {
  it('renders no toggle when there is no narrative and no measures', () => {
    render(
      <WeeklyReview
        summary={
          {
            summary_title: 'Quiet week.',
            summary_narrative: null,
            created_at: '2026-11-08T03:30:00Z',
            period_start: '2026-11-08',
            priorities: [],
            health_measures: { categories: [] },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any
        }
      />
    );

    expect(screen.getByText('Quiet week.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  /*
   * The old button appeared only when a clamped paragraph overflowed. With the
   * figures hidden too, that test would strand them behind a control that never
   * renders — so short prose plus measures must still offer the toggle.
   */
  it('still offers the toggle when the prose is short but there are figures', () => {
    render(
      <WeeklyReview
        summary={
          {
            summary_title: 'Short.',
            summary_narrative: 'Two words.',
            created_at: '2026-11-08T03:30:00Z',
            period_start: '2026-11-08',
            priorities: [],
            health_measures: {
              categories: [{ category: 'hours_booked', rate: 8.6, change: -0.8, sample: 128 }],
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any
        }
      />
    );

    expect(screen.getByRole('button', { name: 'Show the detail' })).toBeInTheDocument();
  });
});
