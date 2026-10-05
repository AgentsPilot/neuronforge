/**
 * How the owner card rounds credits (credit deduction slice 6a, decision D-c).
 *
 * CLIENT-SAFE and pure: it imports nothing (a source guard pins it).
 *
 * The rule, in one place:
 *   - used: 0 → "nothing"; between 0 and 1 → "less than 1" (counted as 1
 *     below); otherwise rounded to a whole credit. Negative clamps to 0.
 *   - the two parts ("by you", "automatic"): negatives clamp to 0, then the
 *     largest-remainder method shares out the DISPLAYED used, so the parts
 *     always add up to it. In the "less than 1" case the unit goes to the
 *     larger part (shown "less than 1"), the other shows 0.
 *   - left = max(0, allowance − displayed used), so "left" and "used" visibly
 *     add up to the allowance.
 *
 * A consequence worth knowing (SA note): with used ≥ 1, a part between 0 and 1
 * can show as 0 — "63 used — 63 by you · 0 automatic" after one lead reply.
 * The sum rule wins; that is not a bug.
 *
 * @module lib/business-os/credits/creditDisplay
 */

/** One figure as the card shows it. */
export type DisplayedCreditFigure =
  | { kind: 'whole'; value: number }
  | { kind: 'less_than_one' };

export interface DisplayedCreditsInput {
  used: number;
  usedByOwner: number;
  usedAutomatic: number;
  /** Null when there is no allowance: no "left" figure at all. */
  allowanceAmount: number | null;
}

export interface DisplayedCredits {
  /** True when nothing at all was used: the card says so instead of the split. */
  nothingUsed: boolean;
  used: DisplayedCreditFigure;
  byOwner: DisplayedCreditFigure;
  automatic: DisplayedCreditFigure;
  /** Whole credits left, or null without an allowance. */
  left: number | null;
}

const whole = (value: number): DisplayedCreditFigure => ({ kind: 'whole', value });

function clamp(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Share `total` whole units between two parts in proportion, largest remainder first. */
function shareOut(total: number, a: number, b: number): [number, number] {
  const sum = a + b;
  // Both parts empty: nothing to share by. Rare (every correction unresolved),
  // and shown as 0 / 0 rather than inventing an attribution.
  if (sum <= 0) return [0, 0];
  const exactA = (a / sum) * total;
  const exactB = (b / sum) * total;
  let floorA = Math.floor(exactA);
  let floorB = Math.floor(exactB);
  let spare = total - floorA - floorB;
  // At most one unit is ever spare with two parts; loop kept general and bounded.
  while (spare > 0) {
    const remainderA = exactA - floorA;
    const remainderB = exactB - floorB;
    // Ties go to the larger part, then to "by you".
    if (remainderA > remainderB || (remainderA === remainderB && a >= b)) floorA += 1;
    else floorB += 1;
    spare -= 1;
  }
  return [floorA, floorB];
}

export function toDisplayedCredits(input: DisplayedCreditsInput): DisplayedCredits {
  const used = clamp(input.used);
  const owner = clamp(input.usedByOwner);
  const automatic = clamp(input.usedAutomatic);

  let usedFigure: DisplayedCreditFigure;
  let byOwner: DisplayedCreditFigure;
  let byAutomatic: DisplayedCreditFigure;
  let counted: number;

  if (used === 0) {
    counted = 0;
    usedFigure = whole(0);
    byOwner = whole(0);
    byAutomatic = whole(0);
  } else if (used < 1) {
    counted = 1;
    usedFigure = { kind: 'less_than_one' };
    const ownerTakesIt = owner >= automatic;
    byOwner = ownerTakesIt ? { kind: 'less_than_one' } : whole(0);
    byAutomatic = ownerTakesIt ? whole(0) : { kind: 'less_than_one' };
  } else {
    counted = Math.round(used);
    usedFigure = whole(counted);
    const [ownerShare, automaticShare] = shareOut(counted, owner, automatic);
    byOwner = whole(ownerShare);
    byAutomatic = whole(automaticShare);
  }

  const allowance = input.allowanceAmount;
  const left =
    allowance === null || !Number.isFinite(allowance) ? null : Math.max(0, Math.round(allowance) - counted);

  return { nothingUsed: used === 0, used: usedFigure, byOwner, automatic: byAutomatic, left };
}

// ── Extra credits on the owner card (slice 11d, SA OP-43, BQ-11d-1) ─────────

/**
 * The owner card's "Extra credits" figure, or null when the block is hidden:
 * 0 (the user's decision 2026-10-04: nothing is shown at 0), or anything not a
 * finite, positive number. Between 0 and 1 → "less than 1" (never hidden: it is
 * not 0). Otherwise ROUNDED DOWN to a whole credit, so a remainder is never
 * shown higher than it is (the used figure above rounds to nearest; this is
 * what is left, so down).
 */
export function toDisplayedExtraCredits(extra: number): DisplayedCreditFigure | null {
  if (typeof extra !== 'number' || !Number.isFinite(extra) || extra <= 0) return null;
  if (extra < 1) return { kind: 'less_than_one' };
  return whole(Math.floor(extra));
}

// ── The credit history (slice 7a, decision D-m) ─────────────────────────────
//
// One decimal; a non-zero line that would show as 0.0 shows "less than 0.1"
// (a correction keeps its sign — never "0.0" or "−0.0"); whole numbers show
// without ".0" (the caller formats with `maximumFractionDigits: 1`). The
// payload carries the EXACT credits; only the display rounds. The summary
// total is the exact sum shown at the same precision, and its two parts are
// shared out at tenths so they add up to it (the D-c rule at D-m precision).

/** One history figure as the panel shows it. */
export type DiaryCreditFigure =
  | { kind: 'zero' }
  | { kind: 'tenths'; value: number }
  | { kind: 'less_than_tenth'; negative: boolean };

/** A line's credits, for display. */
export function toDiaryCredits(credits: number): DiaryCreditFigure {
  if (!Number.isFinite(credits) || credits === 0) return { kind: 'zero' };
  const tenths = Math.round(Math.abs(credits) * 10);
  if (tenths === 0) return { kind: 'less_than_tenth', negative: credits < 0 };
  return { kind: 'tenths', value: (credits < 0 ? -tenths : tenths) / 10 };
}

export interface DiarySummaryInput {
  used: number;
  usedByOwner: number;
  usedAutomatic: number;
}

export interface DisplayedDiarySummary {
  used: DiaryCreditFigure;
  byOwner: DiaryCreditFigure;
  automatic: DiaryCreditFigure;
}

const tenthsFigure = (tenths: number): DiaryCreditFigure =>
  tenths === 0 ? { kind: 'zero' } : { kind: 'tenths', value: tenths / 10 };

/** The summary's total and its split, at one decimal, the parts adding up to the shown total. */
export function toDiarySummary(input: DiarySummaryInput): DisplayedDiarySummary {
  const used = Number.isFinite(input.used) ? input.used : 0;
  const owner = clamp(input.usedByOwner);
  const automatic = clamp(input.usedAutomatic);

  if (used <= 0) {
    // Only reachable through corrections larger than the charges; never split.
    return { used: toDiaryCredits(used), byOwner: { kind: 'zero' }, automatic: { kind: 'zero' } };
  }
  const usedTenths = Math.round(used * 10);
  if (usedTenths === 0) {
    const ownerTakesIt = owner >= automatic;
    const tiny: DiaryCreditFigure = { kind: 'less_than_tenth', negative: false };
    return { used: tiny, byOwner: ownerTakesIt ? tiny : { kind: 'zero' }, automatic: ownerTakesIt ? { kind: 'zero' } : tiny };
  }
  const [ownerTenths, automaticTenths] = shareOut(usedTenths, owner, automatic);
  return { used: tenthsFigure(usedTenths), byOwner: tenthsFigure(ownerTenths), automatic: tenthsFigure(automaticTenths) };
}
