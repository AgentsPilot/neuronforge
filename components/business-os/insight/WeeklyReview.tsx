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

  /*
   * NO LINE-CLAMP MEASUREMENT ANY MORE, AND THE LESSON IT LEFT.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The paragraph used to be clamped to three lines, and the button appeared
   * only when something was genuinely hidden. Answering THAT needed a real
   * measurement — `scrollHeight` against `clientHeight`, re-run on resize and
   * once more after the webfont swapped in — because the obvious proxy,
   * `narrative.length > 220`, is a character count standing in for a question
   * only the layout can answer. It was biased too: Heebo sets narrower than
   * Inter and Hebrew carries no capitals, so the Hebrew note fitted its three
   * lines and still offered "read the rest" of a paragraph just finished.
   *
   * None of that is needed now that the body is either shown whole or not at
   * all, so the measurement is gone rather than left running against an element
   * nothing clamps. Kept here because the next person to add a clamp to this
   * card will reach for the character count first.
   * ───────────────────────────────────────────────────────────────────────────
   */

  const measures = summary.health_measures ?? null;
  const measured = (measures?.categories ?? []).filter(c => c.rate !== null);
  const unavailable = (measures?.categories ?? []).filter(c => c.rate === null);

  /*
   * Is there anything behind the toggle?
   *
   * Asked of all three parts, not just the paragraph. The old button appeared
   * only when the clamped narrative overflowed, which was the right test while
   * the clamp was the only thing hiding anything. Now the figures are hidden
   * too, and a card with short prose and four measures would otherwise hide
   * them behind a button that never renders.
   */
  const hasDetail =
    Boolean(summary.summary_narrative) || measured.length > 0 || unavailable.length > 0;

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

      {/*
        ── THE WHOLE NOTE IS BEHIND THE TOGGLE, NOT JUST ITS TAIL ──────────────
        The collapse used to cut the PARAGRAPH to three lines and leave the
        figures, the "not enough data yet" line and the rest of the prose in
        place — so the card still opened at full height on a dashboard where it
        is one of several. Owner decision 2026-11-10: the weekly note leads with
        its verdict and nothing else until asked.

        The toggle sits directly under the headline rather than after the
        paragraph, so it does not move when the body opens: "Show less" is in
        the same place the owner just clicked.
      */}
      {hasDetail && (
        <button
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          style={{
            border: 'none', background: 'transparent', padding: 0, cursor: 'pointer',
            fontSize: '13px', fontWeight: 600, color: 'var(--v2-primary)',
            fontFamily: font, marginBottom: expanded ? '14px' : 0,
          }}
        >
          {expanded ? (t('health.less') || 'Show less') : (t('health.open') || 'Show the detail')}
        </button>
      )}

      {expanded && (
        <>
          {summary.summary_narrative && (
            <p
              style={{
                fontSize: '14.5px',
                lineHeight: 1.55,
                color: 'var(--v2-text-secondary)',
                margin: '0 0 14px',
                maxWidth: '46rem',
              }}
            >
              {summary.summary_narrative}
            </p>
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

            Still true inside the collapse: the point is that the figures and
            their gaps are read TOGETHER, so they open and close together.
          */}
          {unavailable.length > 0 && (
            <p style={{ fontSize: '12.5px', color: 'var(--v2-text-secondary)', margin: 0, lineHeight: 1.5 }}>
              {t('health.not_yet', {
                categories: unavailable.map(c => t(`health.measuring.${c.category}`) || c.category).join(', '),
              })}
            </p>
          )}
        </>
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
      {/*
        The number the rate was actually taken OF.

        `sample` is that number for every measure but one. Operations divides
        booked hours by available hours while its sample counts bookings, so
        this line read "12.5% of your hours booked — from 16" with 16 being
        neither the denominator (128 hours) nor hours at all. Where a measure
        carries its own denominator, that is what is shown, with its unit named
        so the two figures cannot be read as different things.
      */}
      <div style={{ fontSize: '11px', color: 'var(--v2-text-secondary)', opacity: 0.75, marginTop: '1px' }}>
        {measure.basis
          ? t('health.of_n_unit', {
              n: measure.basis.value,
              unit: t(measure.basis.unitKey) || measure.basis.unitKey,
            })
          : t('health.of_n', { n: measure.sample })}
      </div>
    </div>
  );
}
