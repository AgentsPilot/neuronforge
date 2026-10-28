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

  /*
   * The day this note was written, named rather than dated: "Sunday 25 Oct"
   * tells an owner how old it is at a glance, where "25/10" makes them count.
   *
   * `created_at` is when the nightly run wrote it; `period_start` is the Sunday
   * the week began. Normally the same day, and the fallback keeps the line on
   * summaries written before that column reached this type.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * AND NO CLOCK MAY MOVE IT.
   *
   * The stamp is 03:30 UTC, so handing the raw timestamp to `toLocaleDateString`
   * printed SATURDAY for anyone west of Greenwich: the correct instant, the
   * wrong day, on a line whose whole job is to say which day. Measured, not
   * guessed — it is what this component did when first written.
   *
   * Built from the date part with local parts and formatted with no `timeZone`,
   * the way `formatPublicDay` (lib/i18n/public-pages.ts) settles the same
   * question for the client-facing pages. The day named is then the Sunday the
   * week belongs to, the same one for every reader.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(summary.created_at ?? summary.period_start ?? '');
  const asOf = parts
    ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])).toLocaleDateString(
        language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-GB',
        { weekday: 'long', day: 'numeric', month: 'short' }
      )
    : null;

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

        {/*
          WHEN THIS WAS WORKED OUT, AND WHEN IT CHANGES.

          The row is written once a week, on the first nightly run of the
          period, and deliberately never recomputed until the next one. Without
          this line the card reads as live: the first question asked of it was
          "is this really updated?", by an owner looking on Wednesday at
          Sunday's note, beside an issue they had dismissed on Tuesday.

          Both halves matter. The date says how old it is; "updates again next
          Sunday" says it is a weekly note rather than something broken.
        */}
        {asOf && (
          <span style={{ fontSize: '12px', color: 'var(--v2-text-muted)' }}>
            {t('health.as_of', { date: asOf })}
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
