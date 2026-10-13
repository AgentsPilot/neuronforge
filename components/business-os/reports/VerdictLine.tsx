'use client';

/**
 * The one-line answer to "how did it go?", above everything that explains it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE NARRATIVE IS NOT WRITTEN HERE, AND THAT IS THE POINT.
 *
 * `summary_narrative` is produced by the insight pipeline during the nightly
 * `insight-detect` run and stored on `business_health_summaries`. This component
 * reads it. It does NOT call a model, so opening the reports page costs no
 * tokens, takes no latency, and says the same thing on the tenth load as on the
 * first. The dashboard's `WeeklyReview` already renders this same string, so
 * this page adds no spend at all.
 *
 * The cost of that is staleness: the sentence describes the period as of the
 * last detection run, while the figures below it are live. In practice they are
 * hours apart and agree. If they ever disagree visibly, the fix is to regenerate
 * the summary, never to start generating prose on render.
 *
 * THE COUNTS ARE NOT A SCORE.
 *
 * "3 improved, 1 slipped" is a tally of DIRECTIONS, which is the only thing that
 * can honestly be combined across measures of different quantities — averaging a
 * 31% repeat rate with a 95% on-time payment rate produces a number with no
 * meaning. The `health_score` column still exists and is deliberately ignored:
 * it was 100 minus severity penalties over our own detector counts, so it moved
 * when we shipped code rather than when the business changed.
 *
 * Only non-zero counts appear. "0 slipped" is noise on a good month, and a row
 * of zeros trains the owner to skip the line that is meant to be the summary.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useLanguage } from '@/lib/business-os/LanguageContext';

interface VerdictLineProps {
  /** The stored narrative. Absent on accounts the nightly run has not reached. */
  narrative?: string | null;
  improved: number;
  declined: number;
  steady: number;
  /** Categories with too little data to measure, so the tally adds up. */
  unavailable: number;
}

export function VerdictLine({
  narrative,
  improved,
  declined,
  steady,
  unavailable,
}: VerdictLineProps) {
  const { t } = useLanguage();

  const chips: { key: string; text: string; tone: 'up' | 'down' | 'flat' }[] = [];
  if (improved > 0) {
    chips.push({ key: 'up', text: `${improved} ${t('reports.count_improved')}`, tone: 'up' });
  }
  if (declined > 0) {
    chips.push({ key: 'down', text: `${declined} ${t('reports.count_slipped')}`, tone: 'down' });
  }
  if (steady > 0) {
    chips.push({ key: 'flat', text: `${steady} ${t('reports.count_steady')}`, tone: 'flat' });
  }
  if (unavailable > 0) {
    chips.push({ key: 'none', text: `${unavailable} ${t('reports.count_need_data')}`, tone: 'flat' });
  }

  /*
   * Nothing stored: the band stays, and says when it will fill.
   *
   * Returning null was the first behaviour, and it made the top of the page
   * look like the design had simply not been built. An owner cannot wait for
   * something they cannot see is coming — so the card holds its place and names
   * the one thing that will change it, the nightly run.
   *
   * Muted and italic so it never reads as the summary itself.
   */
  const pending = !narrative && chips.length === 0;

  return (
    <div
      className="bg-[var(--v2-surface)] border border-[var(--v2-border)] px-[18px] py-[18px]"
      style={{ borderRadius: 'var(--v2-radius-card, 16px)' }}
    >
      {/*
        * The sentence runs the FULL width of the card.
        *
        * It was capped at 64ch, the usual reading measure for prose. In Hebrew
        * Heebo at 16.5px that is about 576px inside a card nearer 1200px, so
        * the text filled under half of it and the card read as a narrow column
        * with dead space beside it. Laying the tally into that space was tried
        * and read as two columns, which is worse: this band is one sentence,
        * not a layout.
        *
        * So the cap is gone and the paragraph spans the card. Lines are longer
        * than the typographic ideal; the narrative is three or four sentences,
        * which is short enough that it does not cost the reader their place.
        * Do not reintroduce a max-width here without looking at it in Hebrew on
        * a wide screen first.
        */}
      {pending && (
        <p className="m-0 text-sm italic text-[var(--v2-text-muted)]">
          {t('reports.verdict_pending')}
        </p>
      )}
      {narrative && (
        <p className="m-0 text-[16.5px] leading-[1.52] tracking-[-0.005em] text-[var(--v2-text-primary)]">
          {narrative}
        </p>
      )}

      {chips.length > 0 && (
        <div className={`flex flex-wrap gap-2 ${narrative || pending ? 'mt-3.5' : ''}`}>
          {chips.map(chip => (
            <span
              key={chip.key}
              className={`text-xs font-semibold px-2.5 py-1 rounded-full border tabular-nums whitespace-nowrap ${
                chip.tone === 'up'
                  ? 'text-emerald-600 dark:text-emerald-400 border-emerald-600/35 dark:border-emerald-400/35'
                  : chip.tone === 'down'
                    ? 'text-rose-600 dark:text-rose-400 border-rose-600/35 dark:border-rose-400/35'
                    : 'text-[var(--v2-text-secondary)] border-[var(--v2-border)]'
              }`}
            >
              {chip.text}
            </span>
          ))}
        </div>
      )}

      {/*
        * How it works, and therefore what to expect.
        *
        * Last, quiet, and under a rule, because it is not part of the answer —
        * it is the note that stops the answer being misread. Two things an
        * owner cannot otherwise know: the figures cover a ROLLING 28 DAYS
        * against the 28 before them, so they are not "this month"; and the
        * sentence is rewritten ONCE A WEEK, so prose identical to yesterday's
        * is a stable page rather than a stuck one.
        *
        * Shown in the pending state too, where it is the more useful half: it
        * tells someone with an empty card what is coming and roughly when.
        */}
      <p className="m-0 mt-4 pt-3 border-t border-[var(--v2-border)] text-xs leading-relaxed text-[var(--v2-text-muted)]">
        {t('reports.verdict_cadence')}
      </p>
    </div>
  );
}
