/**
 * Exchange rates admin, slice 1e: exact decimal maths for the rate sync
 * (requirement §5.7.2, §5.7.5; SA §13.7 SQ-38, SQ-41).
 *
 * SQ-42: only two operations live here, and neither is a conversion. A rate is
 * derived from two rates of the same official feed (ECB(X) ÷ ECB(USD)), and a
 * gap is the difference between two rates of the SAME currency, absolute or as
 * a % of one of them. Nothing here takes or produces an amount of money (D-5).
 *
 * SQ-38: the pure `decimal.ts` primitives are reused unedited; this file adds
 * only the division (half away from zero) and fixed-place printing. Values are
 * `BigInt` counts of units at a decimal scale: no float, no JS number, and no
 * BigInt literal (the tsconfig target is ES2017, where `10n` is TS2737), so
 * every power of ten is a `BigInt(…)` call.
 */

import {
  absDecimal,
  compareDecimals,
  parseDecimal,
  signOfDecimal,
  subtractDecimals,
  type Decimal,
} from '@/lib/ai/pricing-research/decimal';

import type { GapDirection } from './rateSyncRules';

const ZERO = BigInt(0);
const FIVE = BigInt(5);
const TEN = BigInt(10);
const HUNDRED = BigInt(100);

function powerOfTen(exponent: number): bigint {
  return TEN ** BigInt(exponent);
}

/**
 * numerator ÷ denominator rounded to `places` decimals, half AWAY from zero:
 * align the scales, scale the numerator by 10^(places + 1), integer-divide the
 * magnitudes, then round the one extra digit. Truncating below that digit
 * never changes whether it is 5 or more, so the rounding is exact. The sign is
 * applied after. A zero denominator throws: callers refuse one first, so
 * reaching it is a programming error.
 */
export function divideHalfUp(numerator: Decimal, denominator: Decimal, places: number): Decimal {
  if (denominator.units === ZERO) throw new Error('divideHalfUp: division by zero');
  if (!Number.isInteger(places) || places < 0) throw new Error(`divideHalfUp: bad places ${places}`);
  const scale = numerator.scale > denominator.scale ? numerator.scale : denominator.scale;
  const top = numerator.units * powerOfTen(scale - numerator.scale);
  const bottom = denominator.units * powerOfTen(scale - denominator.scale);
  const negative = (top < ZERO) !== (bottom < ZERO);
  const topMagnitude = top < ZERO ? -top : top;
  const bottomMagnitude = bottom < ZERO ? -bottom : bottom;
  const withExtraDigit = (topMagnitude * powerOfTen(places + 1)) / bottomMagnitude;
  const rounded = (withExtraDigit + FIVE) / TEN;
  return { units: negative ? -rounded : rounded, scale: places };
}

/**
 * Exactly `places` decimals ("3.09" at 6 → "3.090000"), `-` for a negative, no
 * `+`. A value with more decimals than `places` throws: it would need rounding,
 * and silently cutting digits is never right here.
 */
export function toFixedPlaces(value: Decimal, places: number): string {
  if (value.scale > places) throw new Error(`toFixedPlaces: ${value.scale} decimals do not fit in ${places}`);
  const units = value.units * powerOfTen(places - value.scale);
  const negative = units < ZERO;
  const digits = (negative ? -units : units).toString().padStart(places + 1, '0');
  const sign = negative ? '-' : '';
  if (places === 0) return `${sign}${digits}`;
  return `${sign}${digits.slice(0, digits.length - places)}.${digits.slice(digits.length - places)}`;
}

/** `+` / `-` / nothing, from an exact sign. */
function signPrefix(sign: -1 | 0 | 1): string {
  if (sign > 0) return '+';
  return sign < 0 ? '-' : '';
}

export interface RateGap {
  /** Suggested − current, 6 decimals, signed ("+0.610000"). */
  gapAbsolute: string;
  /** The gap as a % of the current rate, 2 decimals, signed ("+19.74%"). */
  gapPercent: string;
  direction: GapDirection;
}

/**
 * The §5.7.5 gap between two rates of ONE currency (SQ-41). The direction, and
 * so the colour, comes from the exact comparison, never from the rounded %: a
 * gap of +0.000001 reads "+0.00%" and is still `up`. The sign printed on both
 * figures is the exact sign too, so a tiny negative gap reads "-0.00%".
 */
export function rateGap(current: string, suggested: string): RateGap {
  const base = parseDecimal(current);
  const next = parseDecimal(suggested);
  if (signOfDecimal(base) <= 0) throw new Error('rateGap: the current rate must be above 0');
  const difference = subtractDecimals(next, base);
  const sign = signOfDecimal(difference);
  const comparison = compareDecimals(next, base);
  const percent = divideHalfUp({ units: difference.units * HUNDRED, scale: difference.scale }, base, 2);
  return {
    gapAbsolute: `${signPrefix(sign)}${toFixedPlaces(absDecimal(difference), 6)}`,
    gapPercent: `${signPrefix(sign)}${toFixedPlaces(absDecimal(percent), 2)}%`,
    direction: comparison > 0 ? 'up' : comparison < 0 ? 'down' : 'none',
  };
}
