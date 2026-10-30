'use client';

/**
 * Six questions about the business, each answered with a rate and a direction.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE RATE COMES FIRST
 *
 * The labels are the `health.measure.*` keys that `businessHealth.ts` emits, and
 * they are deliberately sentence FRAGMENTS: "of your hours booked", "clients who
 * came back". That is not an accident to be worked around by capitalising them
 * into headings — it is what makes the row readable:
 *
 *     82%   invoices paid on time
 *     31%   clients who came back
 *
 * Put the label first and you have to invent a second set of noun-phrase keys in
 * three languages, saying the same thing worse.
 *
 * The rate sits in a fixed-width right-aligned gutter so six percentages form a
 * true column. That alignment is the whole readability argument for this band;
 * ragged figures turn it back into a list of unrelated facts.
 *
 * ── THREE STATES, AND THE DIFFERENCE BETWEEN THEM MATTERS ───────────────────
 *
 *   0%    a real measurement whose answer is zero. Nobody came back. The sample
 *         cleared `MIN_SAMPLE`, the arithmetic ran, and the result was none.
 *         This MUST render as 0% — it is the most actionable figure on the page.
 *
 *   —  +  "not enough data yet · needs 8, has 5"
 *         The platform measured and cannot say. Below `MIN_SAMPLE` a percentage
 *         swings on a single event: with four contacts a conversion rate can
 *         only be 0, 25, 50 or 75, and none of those is information. The
 *         shortfall is named because it closes by trading, not by waiting.
 *
 *   —     no figure at all, and no text. No nightly summary exists for this
 *         account, so nothing has been computed either way.
 *
 * Collapsing the first into the second loses a real answer. Collapsing the
 * second into the first invents one — it would tell a business with four website
 * visitors that NOBODY who visits ever gets in touch. `scoreCategory` already
 * keeps `0` and `null` apart; this component's only job is not to flatten them.
 *
 * THE BAND STAYS OPEN WITH NOTHING IN IT
 *
 * All six rows are drawn from `MEASURE_KEY` whether or not a summary exists.
 * Hiding the band was the first behaviour and it made the page look unfinished
 * rather than un-run: an owner could not see that these six questions are what
 * the page answers, so there was nothing to wait for.
 *
 * The order is pinned here rather than taken from the summary, so rows do not
 * reshuffle between periods as categories become measurable.
 *
 * `change === null` is yet another absence: there IS a rate this period, but no
 * comparable previous one. A first month has a figure and no trend. It gets no
 * arrow rather than a flat one, because a flat arrow asserts "unchanged".
 *
 * Every measure here is higher-is-better, so up is always good. If a
 * lower-is-better measure is ever added to `businessHealth.ts`, this assumption
 * breaks and the colours silently invert.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { HealthMeasure } from '@/hooks/useInsights';
import { useLanguage } from '@/lib/business-os/LanguageContext';
// Pure module, zero imports of its own, so a client component may read it.
import {
  MIN_SAMPLE,
  MEASURE_KEY,
  HIGHER_IS_BETTER,
  type HealthCategory,
} from '@/lib/business-os/insight/health/businessHealth';

interface HealthRowsProps {
  /**
   * The measured rates, or null when no nightly summary exists for this
   * account. Null draws all six rows empty rather than drawing nothing.
   */
  categories: HealthMeasure[] | null;
}

/**
 * The order the rows are read in, money first.
 *
 * `pricing` is absent on purpose: its `MIN_SAMPLE` is Infinity because nothing
 * in the platform records a discount, so it can never carry a figure. A seventh
 * row that is permanently empty would imply one is coming.
 */
const DISPLAY_ORDER: HealthCategory[] = [
  'cash_flow',
  'retention',
  'sales',
  'conversion',
  'acquisition',
  'operations',
  /*
   * Last, and deliberately. The five above are things the owner is trying to
   * grow; this is the one they are trying to shrink, and ending on it keeps the
   * card reading as a list of what is working before what is not.
   */
  'cancellations',
];

/**
 * One decimal at most, and never a trailing `.0`.
 *
 * `pct(0)` is "0%", deliberately. See the three states above.
 */
function pct(value: number): string {
  return `${Number(value.toFixed(1))}%`;
}

export function HealthRows({ categories }: HealthRowsProps) {
  const { t } = useLanguage();

  /*
   * What the summary said about each category, if it said anything.
   *
   * `not_measurable` entries are dropped on the way in, so a category the
   * platform can never measure is indistinguishable from one it has not
   * measured yet. Both draw an empty row, which is the truth in both cases.
   */
  const measured = new Map<string, HealthMeasure>();
  for (const c of categories ?? []) {
    if (c.unavailable !== 'not_measurable') measured.set(c.category, c);
  }

  return (
    <div className="flex flex-col">
      {DISPLAY_ORDER.map(category => {
        const row = measured.get(category);
        const measureKey = row?.measureKey ?? MEASURE_KEY[category];

        // `rate: 0` is a figure. Only `null` and a missing row are not.
        const hasRate = row != null && row.rate !== null;
        const hasChange = row != null && row.change !== null;
        // Zero change is "steady", a real answer, and not the same as absent.
        const up = hasChange && row!.change! > 0;
        const flat = hasChange && row!.change === 0;
        /*
         * WHICH WAY IT MOVED AND WHETHER THAT IS GOOD ARE TWO QUESTIONS.
         *
         * They were one, because every measure was higher-is-better and the
         * header of this file said so — and said what would happen if that ever
         * stopped being true: "the colours silently invert". `cancellations` is
         * the measure that stopped it. A rate climbing from 4% to 19% would have
         * drawn a green up-arrow and told the owner their business was improving.
         *
         * The arrow still follows the NUMBER, because a rate that rose did rise
         * and an arrow that lied about that would be its own confusion. Only the
         * colour follows the meaning.
         */
        const good = hasChange && (HIGHER_IS_BETTER[category] ? up : !up);

        /*
         * How far short the sample is, when that is why there is no rate.
         *
         * Only for `too_little_data`, and only when the minimum is finite. A row
         * with no summary behind it says nothing at all: there is no shortfall
         * to report because nothing was attempted.
         */
        const needed = MIN_SAMPLE[category];
        const shortfall =
          row?.unavailable === 'too_little_data' && Number.isFinite(needed)
            ? t('reports.needs_has')
                .replace('{min}', String(needed))
                .replace('{sample}', String(row.sample))
            : null;

        return (
          <div
            key={category}
            className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-4 px-[18px] py-[13px] border-b border-[var(--v2-border)] last:border-b-0"
          >
            {/* The figure, in its gutter. */}
            <div
              className={`text-end text-[21px] tracking-[-0.02em] tabular-nums leading-none ${
                hasRate
                  ? 'font-bold text-[var(--v2-text-primary)]'
                  : 'font-semibold text-[var(--v2-text-muted)]'
              }`}
            >
              {hasRate ? pct(row!.rate!) : '—'}
            </div>

            {/* What the figure counts, in the owner's own words. */}
            <div className="min-w-0 text-[14.5px] text-[var(--v2-text-primary)]">
              {t(measureKey)}
              {/* Why there is no figure — but only when something tried to
                  produce one. An empty row stays silent. */}
              {!hasRate && row && (
                <span className="block text-xs text-[var(--v2-text-muted)] mt-px">
                  {t('reports.not_enough_data')}
                  {shortfall && ` · ${shortfall}`}
                </span>
              )}
            </div>

            {/* The direction. Absent entirely when there is nothing to compare
                with, rather than shown as unchanged. */}
            <div className="text-sm tabular-nums">
              {hasChange && (
                <span
                  className={`inline-flex items-center gap-1.5 font-semibold whitespace-nowrap ${
                    flat
                      ? 'text-[var(--v2-text-muted)]'
                      : good
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {flat ? (
                    <Minus className="w-3.5 h-3.5" />
                  ) : up ? (
                    <TrendingUp className="w-3.5 h-3.5" />
                  ) : (
                    <TrendingDown className="w-3.5 h-3.5" />
                  )}
                  {!flat && `${Math.abs(Number(row!.change!.toFixed(1)))} ${t('reports.points')}`}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
