'use client';

import { useState } from 'react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { BusinessHealthSummaryData, HealthMeasure } from '@/hooks/useInsights';

/**
 * The week, in the platform's own words and its own numbers.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A SECTION, NOT A CARD
 *
 * It draws no background, border or radius of its own: it is composed INTO the
 * verdict card, beneath that card's figures. It began as a standalone card and
 * that produced the defect it now prevents — `summary_title` rendered here AND
 * as the verdict card's sub-line, so the owner read the same sentence twice,
 * once under the other. Living inside the card it interprets makes the
 * duplication impossible rather than something to remember.
 *
 * The verdict card says what the week HELD. This says what it MEANT.
 *
 * WHY THIS EXISTS
 *
 * All of this was already being computed, weekly, per business, at the cost of
 * an LLM call: a narrative, three typed highlights, ranked priorities and seven
 * category figures. Exactly one field reached the screen — `summary_title`, as
 * a sub-line on another card. The rest was written to the database and never
 * read by anything.
 *
 * WHAT THE NUMBERS NOW MEAN
 *
 * They used to be scores out of 100 derived from how many insights we had
 * raised: 80 for a category with none, minus a penalty each. So an empty
 * account read 81/100 and was told it was doing well, and shipping a detector
 * lowered everybody's figure.
 *
 * They are now measured rates — invoices paid on time, clients who came back,
 * visitors who got in touch — each compared with the SAME BUSINESS's previous
 * 28 days. No industry benchmark is involved, because the platform has none.
 *
 * `rate === null` MEANS NOT ENOUGH DATA AND MUST NEVER RENDER AS ZERO.
 * A new business has almost nothing measurable, and saying so is the honest
 * card. `0%` in that position is a failing grade for something nobody measured.
 * ─────────────────────────────────────────────────────────────────────────────
 */

interface WeeklyReviewProps {
  summary: BusinessHealthSummaryData;
  /** Jump to an insight the priorities name. */
  onOpenInsight?: (insightId: string) => void;
}

export function WeeklyReview({ summary, onOpenInsight }: WeeklyReviewProps) {
  const { t, language } = useLanguage();
  const isRTL = language === 'he';
  const [expanded, setExpanded] = useState(false);

  const measures = summary.health_measures ?? null;
  const measured = (measures?.categories ?? []).filter(c => c.rate !== null);
  const unavailable = (measures?.categories ?? []).filter(c => c.rate === null);

  const font = isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif';

  return (
    <div
      style={{
        direction: isRTL ? 'rtl' : 'ltr',
        // A rule, not a panel. The card around it owns the surface.
        borderTop: '1px solid var(--v2-border)',
        marginTop: '14px',
        paddingTop: '13px',
        fontFamily: font,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' }}>
        {/*
          The direction of travel, not a grade.
          Withheld entirely below two comparable measures — "100% of measures
          improved" from a single measure is a sentence about one number.

          No "This week" eyebrow here: the verdict card above already carries
          one, and two in a column read as two cards fused together.
        */}
        {measures?.movingUp !== null && measures !== null && (
          <span style={{ fontSize: '12.5px', color: 'var(--v2-text-secondary)' }}>
            {t('health.moving', {
              improved: measures.improved,
              total: measures.improved + measures.declined + measures.steady,
            })}
          </span>
        )}
      </div>

      {/*
        The ONE place this sentence renders. It was also the verdict card's
        sub-line until the two were merged.
      */}
      <h3 style={{ fontSize: '15.5px', fontWeight: 650, color: 'var(--v2-text-primary)', margin: '0 0 8px', lineHeight: 1.35 }}>
        {summary.summary_title}
      </h3>

      {summary.summary_narrative && (
        <p
          style={{
            fontSize: '14.5px',
            lineHeight: 1.55,
            color: 'var(--v2-text-secondary)',
            margin: '0 0 14px',
            maxWidth: '46rem',
            // Collapsed to three lines: this is a 750-character paragraph and
            // the figures below are what the card is for.
            display: expanded ? 'block' : '-webkit-box',
            WebkitLineClamp: expanded ? 'none' : 3,
            WebkitBoxOrient: 'vertical',
            overflow: expanded ? 'visible' : 'hidden',
          }}
        >
          {summary.summary_narrative}
        </p>
      )}

      {summary.summary_narrative && summary.summary_narrative.length > 220 && (
        <button
          onClick={() => setExpanded(v => !v)}
          style={{
            border: 'none', background: 'transparent', padding: 0, cursor: 'pointer',
            fontSize: '13px', fontWeight: 600, color: 'var(--v2-primary)',
            fontFamily: font, marginBottom: '14px',
          }}
        >
          {expanded ? (t('health.less') || 'Show less') : (t('health.more') || 'Read the rest')}
        </button>
      )}

      {measured.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: unavailable.length ? '12px' : 0 }}>
          {measured.map(measure => (
            <MeasureChip key={measure.category} measure={measure} font={font} />
          ))}
        </div>
      )}

      {/*
        Named, not hidden.
        A card showing four figures and silently omitting three invites the
        reader to assume the other three are fine. Saying "not enough data yet"
        is the whole point of measuring honestly.
      */}
      {unavailable.length > 0 && (
        <p style={{ fontSize: '12.5px', color: 'var(--v2-text-secondary)', margin: 0, lineHeight: 1.5 }}>
          {t('health.not_yet', {
            categories: unavailable.map(c => t(`health.measuring.${c.category}`) || c.category).join(', '),
          })}
        </p>
      )}

      {summary.priorities?.length > 0 && (
        <ol style={{ margin: '14px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {summary.priorities.slice(0, 3).map(priority => (
            <li key={priority.rank} style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--v2-primary)', minWidth: '14px' }}>
                {priority.rank}
              </span>
              {priority.insight_id && onOpenInsight ? (
                <button
                  onClick={() => onOpenInsight(priority.insight_id!)}
                  style={{
                    border: 'none', background: 'transparent', padding: 0, cursor: 'pointer',
                    fontSize: '13.5px', color: 'var(--v2-text-primary)', textAlign: isRTL ? 'right' : 'left',
                    fontFamily: font, textDecoration: 'underline', textUnderlineOffset: '3px',
                  }}
                >
                  {priority.title}
                </button>
              ) : (
                <span style={{ fontSize: '13.5px', color: 'var(--v2-text-primary)' }}>{priority.title}</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * One measured rate and how it moved.
 *
 * The sample is shown because a rate without one is not checkable: 50% from two
 * clients and 50% from two hundred are different claims, and only the reader
 * can tell which they are looking at.
 */
function MeasureChip({ measure, font }: { measure: HealthMeasure; font: string }) {
  const { t } = useLanguage();

  const up = measure.change !== null && measure.change > 0;
  const down = measure.change !== null && measure.change < 0;

  return (
    <div
      style={{
        border: '1px solid var(--v2-border)',
        borderRadius: '12px',
        padding: '8px 12px',
        minWidth: '132px',
        fontFamily: font,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
        <span style={{ fontSize: '17px', fontWeight: 650, color: 'var(--v2-text-primary)', fontVariantNumeric: 'tabular-nums' }}>
          {measure.rate}%
        </span>
        {measure.change !== null && (
          <span style={{ fontSize: '12px', fontWeight: 600, color: up ? '#15803D' : down ? '#B91C1C' : 'var(--v2-text-secondary)' }}>
            {up ? '+' : ''}{measure.change}
          </span>
        )}
      </div>
      <div style={{ fontSize: '11.5px', color: 'var(--v2-text-secondary)', marginTop: '2px', lineHeight: 1.35 }}>
        {t(measure.measureKey) || measure.category}
      </div>
      <div style={{ fontSize: '11px', color: 'var(--v2-text-secondary)', opacity: 0.75, marginTop: '1px' }}>
        {t('health.of_n', { n: measure.sample })}
      </div>
    </div>
  );
}
