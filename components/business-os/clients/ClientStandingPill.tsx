'use client';

/**
 * One pill for a client's standing, wherever a client is shown.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS SHARED AND NOT COPIED
 *
 * There were two of these for a few hours: one in the contact drawer and one
 * written inline in the Needs-You row. They already disagreed — the drawer's
 * showed a word and the dashboard's a number — and a client who read "needs
 * attention" beside their own name read as a bare figure on the dashboard.
 *
 * Two renderings of one judgement drift the moment anybody edits one of them,
 * and this is the judgement that is hardest to be casual about: it is a claim
 * about a PERSON, shown to the owner who deals with them.
 *
 * ── WHAT IT SHOWS, AND IN WHICH ORDER ───────────────────────────────────────
 *
 * The word, then the figure. The word is the judgement and survives being read
 * aloud with the client in the room; the figure only ranks two flagged clients
 * against each other, which words cannot do — "needs attention" twice tells an
 * owner nothing about which to ring first, 94 and 81 do. So the number is
 * quieter than the word, always.
 *
 * `new` renders NOTHING. Below the evidence floor there is no standing to
 * show, and a flattering word would be worse than silence.
 *
 * @module components/business-os/clients/ClientStandingPill
 */

import { useLanguage } from '@/lib/business-os/LanguageContext';

export type StandingBand = 'new' | 'reliable' | 'watch' | 'at_risk';
export type StandingTrend = 'improving' | 'steady' | 'worsening';

/**
 * The status family, which BOTH themes define — unlike `--v2-success` and its
 * neighbours, which are one colour and sit wrong on a dark ground.
 *
 * ── THE COLOUR FOLLOWS THE SCORE ────────────────────────────────────────────
 *
 * `reliable` used to be neutral — `var(--v2-bg)` and secondary text — on the
 * reasoning that "a rosette on every well-behaved client makes the two that
 * matter harder to find". Changed on request: the badge carries a figure, and
 * a green word beside a 2 with a grey ground read as a mismatch, as though the
 * colour and the number were answering different questions.
 *
 * They are not: the band IS the score. `bandFromScore` draws it, so these
 * three grounds are already the score's own thresholds — `at_risk` at the
 * firing line, `watch` below it, `reliable` under that. Giving the quiet band a
 * quiet green makes that visible instead of leaving it implied.
 *
 * Deliberately the SOFT success ground, not a saturated one. The original
 * concern still has force — three loud badges would flatten the difference
 * between a client to ring today and one to leave alone — so this reads as
 * settled rather than congratulated, and the two that matter still carry the
 * only warm colours on the row. To go back, restore the two values above.
 */
const TONE: Record<Exclude<StandingBand, 'new'>, { bg: string; fg: string }> = {
  reliable: { bg: 'var(--v2-status-success-bg)', fg: 'var(--v2-status-success-text)' },
  watch: { bg: 'var(--v2-status-warning-bg)', fg: 'var(--v2-status-warning-text)' },
  at_risk: { bg: 'var(--v2-status-error-bg)', fg: 'var(--v2-status-error-text)' },
};

export interface ClientStandingPillProps {
  band: StandingBand;
  /** 0–100, the Needs-You card's own firing line at 60. Hidden at zero. */
  score?: number | null;
  /** Only where two readings far enough apart exist. `steady` stays silent. */
  trend?: StandingTrend | null;
  /** `sm` for a row inside a list; the default suits a header. */
  size?: 'sm' | 'md';
  /**
   * The counts behind the word, for the hover title.
   *
   * The drawer header shows the pill alone — a word and a number — because the
   * counts under it were a second line in a place with no room for one. They
   * are not dropped: a claim about a PERSON has to stay checkable by the owner
   * reading it, so they are appended to the title here instead. Omitted
   * everywhere else, where the generic explanation is all a pill in a list can
   * usefully say.
   */
  detail?: string;
}

export function ClientStandingPill({ band, score, trend, size = 'md', detail }: ClientStandingPillProps) {
  const { t } = useLanguage();

  if (band === 'new') return null;

  const tone = TONE[band];
  /*
   * `steady` says nothing on purpose. An owner glancing at a client does not
   * need to be told that nothing changed, and a word on every pill would make
   * the two that mean something harder to see.
   */
  const direction = trend === 'worsening' || trend === 'improving' ? trend : null;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${
        size === 'sm' ? 'h-5 px-2 text-[11px]' : 'h-6 px-2.5 text-xs'
      }`}
      style={{ background: tone.bg, color: tone.fg }}
      title={detail ? `${t('client.standing.explain')} — ${detail}` : t('client.standing.explain')}
    >
      {t(`client.standing.${band}`)}

      {typeof score === 'number' && score > 0 && (
        <span className="font-medium tabular-nums opacity-80" title={t('client.score.explain')}>
          {score}
        </span>
      )}

      {direction && (
        <span className="font-medium opacity-80">· {t(`client.standing.trend.${direction}`)}</span>
      )}
    </span>
  );
}
