/**
 * The coverage colour of a model price (UF-2, SA RR-4). Pure.
 *
 * Per unit (input, output, cached input, one image size and quality):
 *   - GREEN when what we charge today is at or above the provider's new price
 *     (we are covered): "no change" when equal, otherwise "we charge X% above
 *     provider" (BQ-3: no third colour, the gap is shown in text);
 *   - RED when it is below (we undercharge), or when a Business OS model has
 *     no current price at all ("not priced");
 *   - GREY "not compared" when only one side has the unit.
 *
 * The colour comes from the EXACT sign of (current − new) (SA C-8). The basis
 * points beside it are rounded and are for display and sorting only.
 *
 * Per row: red if any compared unit is red, green only when every compared
 * unit is green, grey when nothing compares. The red units are named in text,
 * so colour is never the only signal (MP-NFR-8).
 */

import { compareDecimals, gapBasisPoints, parseDecimal } from './decimal';

export type CoverageColour = 'green' | 'red' | 'grey';
export type CoverageStatus = 'no_change' | 'covered' | 'undercharging' | 'not_compared' | 'not_priced';
export type CurrentBasis = 'table' | 'in_code_fallback' | 'image_setting' | 'derived' | 'unpriced';

export interface UnitComparisonInput {
  /** `input`, `output`, `cached_input`, or `image <size> <quality>`. */
  unit: string;
  /** Per 1M tokens, or per image. Null when we charge nothing known today. */
  current: string | null;
  currentBasis: CurrentBasis;
  /** The provider's new price in the same unit, or null when none is pending. */
  pending: string | null;
}

export interface UnitComparison extends UnitComparisonInput {
  colour: CoverageColour;
  status: CoverageStatus;
  /** (current − new) ÷ new in basis points, rounded half away from zero. Display and sorting only. */
  gapBasisPoints: number | null;
  label: string;
}

export interface RowCoverage {
  colour: CoverageColour;
  redUnits: string[];
  summary: string;
}

/**
 * "-12.00%" / "+35.00%" / "-0.01%" from basis points. Two decimals (SA CR-2):
 * one basis point is 0.01%, so any non-zero gap prints as non-zero.
 */
export function formatGapPercent(basisPoints: number): string {
  const sign = basisPoints > 0 ? '+' : basisPoints < 0 ? '-' : '';
  return `${sign}${(Math.abs(basisPoints) / 100).toFixed(2)}%`;
}

/**
 * The gap as text for a unit whose exact sign is known. A gap that rounds to
 * 0 basis points but is not equal reads "less than -0.01%" (or "+0.01%"),
 * never "0.00%", so a red unit can never look like "no change" (D-3, QA E-2).
 */
function gapText(sign: -1 | 1, basisPoints: number): string {
  if (basisPoints === 0) return sign < 0 ? 'less than -0.01%' : 'less than +0.01%';
  return formatGapPercent(basisPoints);
}

/**
 * The gap of one unit as short text for a table cell (slice 4, SA N-2). The
 * sign comes from the exact `status`, never from the rounded basis points, so
 * a red unit under 1 bp reads "less than -0.01%", never "0.00%". A unit with
 * no gap (not compared, not priced, provider price 0) returns its `label`.
 */
export function unitGapText(unit: Pick<UnitComparison, 'status' | 'gapBasisPoints' | 'label'>): string {
  if (unit.status === 'no_change') return formatGapPercent(0);
  if (unit.gapBasisPoints === null) return unit.label;
  if (unit.status === 'undercharging') return gapText(-1, unit.gapBasisPoints);
  if (unit.status === 'covered') return gapText(1, unit.gapBasisPoints);
  return unit.label;
}

function unitLabel(unit: string): string {
  return unit.replace('_', ' ');
}

export function compareUnit(input: UnitComparisonInput, options: { usedByBusinessOs: boolean }): UnitComparison {
  const { current, pending } = input;
  // Cached input is optional on both sides; its absence is never "not priced".
  const canBeUnpriced = options.usedByBusinessOs && input.unit !== 'cached_input';

  if (current === null) {
    if (canBeUnpriced) {
      return { ...input, colour: 'red', status: 'not_priced', gapBasisPoints: null, label: 'Not priced' };
    }
    return { ...input, colour: 'grey', status: 'not_compared', gapBasisPoints: null, label: 'Not compared' };
  }
  if (pending === null) {
    return { ...input, colour: 'grey', status: 'not_compared', gapBasisPoints: null, label: 'No new price' };
  }

  const ours = parseDecimal(current);
  const theirs = parseDecimal(pending);
  const sign = compareDecimals(ours, theirs);
  const gap = gapBasisPoints(ours, theirs);

  if (sign === 0) {
    return { ...input, colour: 'green', status: 'no_change', gapBasisPoints: 0, label: 'No change' };
  }
  if (sign > 0) {
    const label = gap === null ? 'Covered (provider price is 0)' : `Covered: we charge ${gapText(1, gap)} vs provider`;
    return { ...input, colour: 'green', status: 'covered', gapBasisPoints: gap, label };
  }
  const label = gap === null ? 'Undercharging' : `Undercharging: ${gapText(-1, gap)}`;
  return { ...input, colour: 'red', status: 'undercharging', gapBasisPoints: gap, label };
}

export function rowCoverage(units: readonly UnitComparison[]): RowCoverage {
  const red = units.filter((unit) => unit.colour === 'red');
  if (red.length > 0) {
    const parts = red.map((unit) =>
      unit.status === 'not_priced'
        ? `${unitLabel(unit.unit)} not priced`
        : `${unitLabel(unit.unit)} ${unit.gapBasisPoints === null ? '' : gapText(-1, unit.gapBasisPoints)}`.trim()
    );
    return { colour: 'red', redUnits: red.map((unit) => unit.unit), summary: `Undercharging: ${parts.join(', ')}` };
  }
  const green = units.filter((unit) => unit.colour === 'green');
  if (green.length > 0) {
    const allEqual = green.every((unit) => unit.status === 'no_change');
    return { colour: 'green', redUnits: [], summary: allEqual ? 'Covered: no change' : 'Covered' };
  }
  return { colour: 'grey', redUnits: [], summary: 'Not compared' };
}
