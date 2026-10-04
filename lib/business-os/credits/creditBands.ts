/**
 * Credits left as a percentage, and the colour bands every surface shows it in
 * (credit deduction slice 8a; FR-46, FR-47; BD-19, BD-20; SA SQ-39).
 *
 * CLIENT-SAFE and pure: it imports nothing (a source guard pins it), so the
 * owner card and the admin Businesses screen can both import it.
 *
 * ── THE ONE DEFINITION ───────────────────────────────────────────────────────
 * The cut-offs, the colours, the low line and the rounding live here and only
 * here. The card, the admin column and (slice 8b) the low-line audit record
 * import them; a guard fails on a cut-off defined or compared anywhere else.
 *
 * ── THE RULE (BD-20) ─────────────────────────────────────────────────────────
 * Whole percent, rounded DOWN; 100% only when nothing at all was used; "less
 * than 1%" while anything at all is left below 1%; 0% at or over the allowance.
 * The band is taken from the SHOWN whole percentage, so a "10%" is always
 * orange and a "9%" always red — number and colour never disagree.
 *
 * ── WHY INTEGERS ─────────────────────────────────────────────────────────────
 * Ledger figures carry 6 decimals. In floats, an exact 10.000000% can come out
 * as 9.999…% and floor to 9. So both figures are scaled to micro-credits and
 * rounded first; the percentage is then exact integer division.
 *
 * @module lib/business-os/credits/creditBands
 */

export type CreditBandId = 'plenty' | 'comfortable' | 'low' | 'below_line';

export interface CreditBand {
  id: CreditBandId;
  /** Lower bound on the SHOWN whole percentage (inclusive). */
  from: number;
  /** Non-text contrast ≥ 3:1 on #FFFFFF and #1E293B (SA SQ-39). */
  color: string;
}

/** Highest first. The only cut-offs in the codebase. */
export const CREDIT_BANDS: readonly CreditBand[] = [
  { id: 'plenty', from: 60, color: '#059669' },
  { id: 'comfortable', from: 30, color: '#2a78d6' },
  { id: 'low', from: 10, color: '#EA580C' },
  { id: 'below_line', from: 0, color: '#EF4444' },
];

/** The top of the red band: the lower bound of the band directly above it. */
export function lowLineOf(bands: readonly CreditBand[]): number {
  const index = bands.findIndex((band) => band.id === 'below_line');
  if (index < 1) throw new Error('The band table has no band above the low line');
  return bands[index - 1].from;
}

/** Below this shown percentage an account is under the low line. Derived, never a second literal. */
export const LOW_LINE_PERCENT: number = lowLineOf(CREDIT_BANDS);

export type ShownPercentLeft = { kind: 'percent'; value: number } | { kind: 'less_than_one' };

export interface CreditPercentLeft {
  shown: ShownPercentLeft;
  band: CreditBandId;
  /** The exact share left, 0..1 — the ring's arc only, never shown as text. */
  share: number;
}

const MICRO = 1_000_000;

/** The band of a shown percentage. */
export function bandFor(shown: ShownPercentLeft): CreditBandId {
  if (shown.kind === 'less_than_one') return 'below_line';
  for (const band of CREDIT_BANDS) {
    if (shown.value >= band.from) return band.id;
  }
  return 'below_line';
}

/** The colour of a band. */
export function bandColor(band: CreditBandId): string {
  const found = CREDIT_BANDS.find((entry) => entry.id === band);
  return found ? found.color : CREDIT_BANDS[CREDIT_BANDS.length - 1].color;
}

/**
 * The percentage of the allowance left, its band and the exact share.
 *
 * `null` when there is no usable allowance (null, not finite, not positive),
 * when `used` is not finite, or when the allowance is too large for exact
 * integer maths (above ≈ 9 × 10⁷ credits; SA Q-10) — the card then shows no
 * gauge and the admin column "Unknown".
 */
export function creditPercentLeft(used: number, allowance: number | null): CreditPercentLeft | null {
  if (allowance === null || !Number.isFinite(allowance) || allowance <= 0) return null;
  if (!Number.isFinite(used)) return null;

  const allowanceMicro = Math.round(allowance * MICRO);
  const usedMicro = Math.round(Math.max(0, used) * MICRO);
  if (allowanceMicro <= 0 || !Number.isSafeInteger(allowanceMicro * 100) || !Number.isSafeInteger(usedMicro)) return null;

  const leftMicro = allowanceMicro - usedMicro;
  const share = Math.max(0, leftMicro) / allowanceMicro;

  let shown: ShownPercentLeft;
  if (usedMicro === 0) {
    shown = { kind: 'percent', value: 100 };
  } else if (leftMicro <= 0) {
    shown = { kind: 'percent', value: 0 };
  } else {
    const percent = Math.floor((leftMicro * 100) / allowanceMicro);
    shown = percent === 0 ? { kind: 'less_than_one' } : { kind: 'percent', value: percent };
  }

  return { shown, band: bandFor(shown), share };
}
