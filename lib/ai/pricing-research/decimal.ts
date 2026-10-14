/**
 * Exact decimal arithmetic for model prices (AI model price review slice 3,
 * workplan §3, SA ruling O-11 and change C-8).
 *
 * WHY. A price is a money input on every Business OS charge. A JS float cannot
 * hold most decimal prices exactly: 0.00000015 × 1e6 is 0.15000000000000002,
 * so a float comparison could paint a covered model red (or an undercharging
 * one green) at the exact boundary the colour rule cares about. Every value
 * here is a `BigInt` count of units at a decimal scale, and every operation
 * the read model needs is exact:
 *
 *   - per 1M to per token and back is a SCALE SHIFT (never a division);
 *   - comparison aligns scales and compares integers;
 *   - halving (the OpenAI derived cached-input rule) multiplies by 5 and adds
 *     one decimal place, which is exact.
 *
 * The only rounding anywhere is `gapBasisPoints`, which is for display and
 * sorting ONLY. Colour comes from `compareDecimals`, the exact sign (C-8).
 *
 * No dependency: there is no decimal library in the repo and none is added.
 * Pure, no I/O.
 */

/** units × 10^(-scale). `scale` is never negative. */
export interface Decimal {
  readonly units: bigint;
  readonly scale: number;
}

const PLAIN_DECIMAL = /^(-?)([0-9]+)(?:[.]([0-9]+))?$/;
const EXPONENT_DECIMAL = /^(-?)([0-9]+)(?:[.]([0-9]+))?e([+-]?[0-9]+)$/i;

/** Parse a plain decimal string ("0.075", "12", "-3.5"). Throws on anything else. */
export function parseDecimal(text: string): Decimal {
  const match = PLAIN_DECIMAL.exec(text.trim());
  if (!match) throw new Error(`not a plain decimal: ${JSON.stringify(text)}`);
  const [, sign, whole, fraction = ''] = match;
  const units = BigInt(`${whole}${fraction}`);
  return { units: sign === '-' ? -units : units, scale: fraction.length };
}

/** True when the text is a plain decimal `parseDecimal` accepts. */
export function isPlainDecimal(text: string): boolean {
  return PLAIN_DECIMAL.test(text.trim());
}

/** Trailing zeros removed, so equal values print identically. */
function normalise(value: Decimal): Decimal {
  let { units, scale } = value;
  while (scale > 0 && units % BigInt(10) === BigInt(0)) {
    units /= BigInt(10);
    scale -= 1;
  }
  return { units, scale };
}

/** A plain decimal string with no exponent and no trailing zeros ("0.000000075"). */
export function formatDecimal(value: Decimal): string {
  const { units, scale } = normalise(value);
  const negative = units < BigInt(0);
  const digits = (negative ? -units : units).toString();
  if (scale === 0) return `${negative ? '-' : ''}${digits}`;
  const padded = digits.padStart(scale + 1, '0');
  const whole = padded.slice(0, padded.length - scale);
  const fraction = padded.slice(padded.length - scale);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/** Multiply by 10^places (places may be negative): a pure scale shift, exact. */
export function shiftDecimal(value: Decimal, places: number): Decimal {
  if (places >= 0) {
    if (value.scale >= places) return { units: value.units, scale: value.scale - places };
    return { units: value.units * BigInt(10) ** BigInt(places - value.scale), scale: 0 };
  }
  return { units: value.units, scale: value.scale - places };
}

function align(a: Decimal, b: Decimal): [bigint, bigint] {
  const scale = Math.max(a.scale, b.scale);
  return [
    a.units * BigInt(10) ** BigInt(scale - a.scale),
    b.units * BigInt(10) ** BigInt(scale - b.scale),
  ];
}

/** -1, 0 or 1: the exact sign of (a − b). */
export function compareDecimals(a: Decimal, b: Decimal): -1 | 0 | 1 {
  const [left, right] = align(a, b);
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** a − b, exact. */
export function subtractDecimals(a: Decimal, b: Decimal): Decimal {
  const [left, right] = align(a, b);
  return { units: left - right, scale: Math.max(a.scale, b.scale) };
}

/** |value|, exact. */
export function absDecimal(value: Decimal): Decimal {
  return value.units < BigInt(0) ? { units: -value.units, scale: value.scale } : value;
}

/** value × an integer, exact. */
export function multiplyDecimalByInteger(value: Decimal, factor: number): Decimal {
  if (!Number.isSafeInteger(factor)) throw new Error(`not a safe integer: ${factor}`);
  return { units: value.units * BigInt(factor), scale: value.scale };
}

/**
 * True when |next − base| is MORE than `basisPoints` of base, decided exactly
 * (|next − base| × 10,000 > base × basisPoints). A zero base with a non-zero
 * next is always a move beyond any bound.
 */
export function movesBeyondBasisPoints(next: Decimal, base: Decimal, basisPoints: number): boolean {
  const difference = absDecimal(subtractDecimals(next, base));
  if (isZeroDecimal(base)) return !isZeroDecimal(difference);
  return (
    compareDecimals(multiplyDecimalByInteger(difference, 10000), multiplyDecimalByInteger(absDecimal(base), basisPoints)) > 0
  );
}

/** Half, exact: × 5 at one more decimal place. */
export function halveDecimal(value: Decimal): Decimal {
  return { units: value.units * BigInt(5), scale: value.scale + 1 };
}

export function isZeroDecimal(value: Decimal): boolean {
  return value.units === BigInt(0);
}

export function signOfDecimal(value: Decimal): -1 | 0 | 1 {
  if (value.units === BigInt(0)) return 0;
  return value.units < BigInt(0) ? -1 : 1;
}

/**
 * (a − b) ÷ b in basis points (1% = 100), rounded half away from zero.
 * DISPLAY AND SORTING ONLY: never decide a colour from this (C-8).
 * Returns null when b is zero (no meaningful percentage).
 */
export function gapBasisPoints(a: Decimal, b: Decimal): number | null {
  const [left, right] = align(a, b);
  if (right === BigInt(0)) return null;
  const numerator = (left - right) * BigInt(10000);
  const denominator = right < BigInt(0) ? -right : right;
  const signedNumerator = right < BigInt(0) ? -numerator : numerator;
  const negative = signedNumerator < BigInt(0);
  const magnitude = negative ? -signedNumerator : signedNumerator;
  const quotient = magnitude / denominator;
  const remainder = magnitude % denominator;
  const rounded = remainder * BigInt(2) >= denominator ? quotient + BigInt(1) : quotient;
  return Number(negative ? -rounded : rounded);
}

/**
 * The decimal a JS number literal was written as, from its shortest round-trip
 * form (`String(n)`): `0.00075` stays "0.00075", `1.5e-7` becomes "0.00000015".
 * Used only for the in-code fallback tables, whose values are decimal literals
 * in source (C-8: tested on every one of them). Throws on NaN or Infinity.
 */
export function decimalFromNumberLiteral(value: number): Decimal {
  if (!Number.isFinite(value)) throw new Error(`not a finite number: ${value}`);
  const text = String(value);
  const exponent = EXPONENT_DECIMAL.exec(text);
  if (!exponent) return parseDecimal(text);
  const [, sign, whole, fraction = '', power] = exponent;
  const mantissa = parseDecimal(`${sign}${whole}${fraction ? `.${fraction}` : ''}`);
  return shiftDecimal(mantissa, Number(power));
}

/** "0.075" per 1M tokens → "0.000000075" per token. */
export function perMillionToPerToken(per1m: string): string {
  return formatDecimal(shiftDecimal(parseDecimal(per1m), -6));
}

/** "0.000000075" per token → "0.075" per 1M tokens. */
export function perTokenToPerMillion(perToken: string): string {
  return formatDecimal(shiftDecimal(parseDecimal(perToken), 6));
}
