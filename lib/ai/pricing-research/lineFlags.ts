/**
 * Server-computed refusals and flags for one pending price line (SA R-4 as
 * extended by RR-1). Pure: every input is passed in, nothing is read here.
 * The researcher's or admin's own flags are never trusted; there is no input
 * for them.
 *
 *   HARD REFUSAL (the line is never stored; manual entry refuses the whole
 *   request, SA O-7): a zero or negative price (output 0 only for input-only
 *   models), more than 9 decimals (already refused by the schema), or a price
 *   above the sanity ceiling.
 *
 *   BLOCKING FLAG (stored; slice 8 requires an override reason to apply):
 *   `large_move`, more than 50% either way against the price charged today.
 *
 *   INFORMATIONAL FLAGS: `new_model` (a model Business OS does not cover yet,
 *   shown as "not used yet"; user decision 2026-10-14), `above_conservative_rate`
 *   (the FR-12 unknown-model rate would then undercharge), `fallback_differs`
 *   (the in-code outage fallback needs a PR), `cached_input_listed`.
 *
 * Slice 5 adds the cross-check and retiring flags; their names are already in
 * the migration's CHECK.
 */

import { MAX_PRICE_PER_IMAGE, MAX_PRICE_PER_MILLION_TOKENS, LARGE_MOVE_BASIS_POINTS } from './bounds';
import { compareDecimals, isZeroDecimal, movesBeyondBasisPoints, parseDecimal, perMillionToPerToken } from './decimal';
import type { PendingLineInput } from './pendingLineSchema';

export const PENDING_LINE_FLAGS = [
  'new_model',
  'large_move',
  'above_conservative_rate',
  'fallback_differs',
  'cached_input_listed',
  'cross_check_differs',
  'cross_check_unavailable',
  'cross_check_not_listed',
  'retiring',
  'renamed',
] as const;

export type PendingLineFlag = (typeof PENDING_LINE_FLAGS)[number];

/**
 * The user's wording for `new_model` (decision 2026-10-14): a price recorded
 * for a model Business OS does not use yet. Shown wherever the flag is shown.
 * Not the same fact as RR-3's "not used by Business OS", which describes the
 * live settings, not a pending line.
 */
export const NEW_MODEL_LABEL = 'not used yet';

/**
 * The words shown beside each flag code. A full record (slice 4, SA RC-3), so
 * `tsc` demands a label for any flag added later. "Needs a reason to apply" is
 * not part of a label: the page derives it from `BLOCKING_FLAGS`.
 */
export const FLAG_LABELS: Record<PendingLineFlag, string> = {
  new_model: NEW_MODEL_LABEL,
  large_move: 'price moves more than 50%',
  above_conservative_rate: 'above the rate we charge for an unknown model',
  fallback_differs: 'built-in backup price differs; update it by code change',
  cached_input_listed: 'provider lists a cached-input price',
  cross_check_differs: 'differs from the second price list by more than 5%',
  cross_check_unavailable: 'second price list could not be read',
  cross_check_not_listed: 'not on the second price list',
  retiring: 'provider is retiring this model',
  renamed: 'provider renamed this model',
};

/** The flags that need an override reason at apply (slice 8). */
export const BLOCKING_FLAGS: readonly PendingLineFlag[] = ['large_move', 'cross_check_differs', 'retiring'];

/** Per-token (token lines) or per-image (image lines) decimal strings. Absent means "none". */
export interface UnitPrices {
  input?: string;
  output?: string;
  cachedInput?: string;
  perImage?: string;
}

export interface LineFlagContext {
  /** What we charge today for this unit (the basis does not matter here). */
  current: UnitPrices;
  /** The in-code outage fallback for this model or image key, if any. */
  fallback: UnitPrices;
  /** The FR-12 conservative rate for this provider and kind, if any. */
  conservative: UnitPrices;
  /** Is the model in the computed coverage set? */
  inCoverage: boolean;
  /** Is the model priced on input only (embeddings)? */
  inputOnly: boolean;
}

export interface LineEvaluation {
  refusals: string[];
  flags: PendingLineFlag[];
}

/** The proposed prices of a line in the same unit as the context (per token or per image). */
export function proposedUnitPrices(line: PendingLineInput): UnitPrices {
  if (line.kind === 'image') return { perImage: line.price_per_image };
  return {
    input: perMillionToPerToken(line.input_per_1m),
    output: perMillionToPerToken(line.output_per_1m),
    cachedInput: line.cached_input_per_1m === undefined ? undefined : perMillionToPerToken(line.cached_input_per_1m),
  };
}

const UNIT_KEYS: Array<keyof UnitPrices> = ['input', 'output', 'cachedInput', 'perImage'];

function differs(proposed: UnitPrices, other: UnitPrices): boolean {
  return UNIT_KEYS.some((unit) => {
    const mine = proposed[unit];
    const theirs = other[unit];
    if (mine === undefined || theirs === undefined) return false;
    return compareDecimals(parseDecimal(mine), parseDecimal(theirs)) !== 0;
  });
}

export function evaluatePendingLine(line: PendingLineInput, context: LineFlagContext): LineEvaluation {
  const refusals: string[] = [];
  const flags: PendingLineFlag[] = [];

  if (line.kind === 'token') {
    const ceiling = parseDecimal(MAX_PRICE_PER_MILLION_TOKENS);
    const sides: Array<[string, string | undefined, boolean]> = [
      ['input', line.input_per_1m, false],
      ['output', line.output_per_1m, context.inputOnly],
      ['cached input', line.cached_input_per_1m, false],
    ];
    for (const [name, value, zeroAllowed] of sides) {
      if (value === undefined) continue;
      const price = parseDecimal(value);
      if (isZeroDecimal(price) && !zeroAllowed) refusals.push(`The ${name} price must be above 0`);
      if (compareDecimals(price, ceiling) > 0) {
        refusals.push(`The ${name} price is above the sanity ceiling of $${MAX_PRICE_PER_MILLION_TOKENS} per 1M tokens`);
      }
    }
  } else {
    const price = parseDecimal(line.price_per_image);
    if (isZeroDecimal(price)) refusals.push('The image price must be above 0');
    if (compareDecimals(price, parseDecimal(MAX_PRICE_PER_IMAGE)) > 0) {
      refusals.push(`The image price is above the sanity ceiling of $${MAX_PRICE_PER_IMAGE} per image`);
    }
  }

  if (refusals.length > 0) return { refusals, flags };

  const proposed = proposedUnitPrices(line);

  if (!context.inCoverage) flags.push('new_model');

  const largeMove = UNIT_KEYS.some((unit) => {
    const mine = proposed[unit];
    const today = context.current[unit];
    if (mine === undefined || today === undefined) return false;
    return movesBeyondBasisPoints(parseDecimal(mine), parseDecimal(today), LARGE_MOVE_BASIS_POINTS);
  });
  if (largeMove) flags.push('large_move');

  const aboveConservative = UNIT_KEYS.some((unit) => {
    const mine = proposed[unit];
    const cap = context.conservative[unit === 'cachedInput' ? 'input' : unit];
    if (mine === undefined || cap === undefined) return false;
    return compareDecimals(parseDecimal(mine), parseDecimal(cap)) > 0;
  });
  if (aboveConservative) flags.push('above_conservative_rate');

  if (differs(proposed, context.fallback)) flags.push('fallback_differs');

  if (line.kind === 'token' && line.cached_input_per_1m !== undefined) flags.push('cached_input_listed');

  return { refusals, flags };
}

/** Unit keys that appear more than once in one request (refused: one pending line per unit). */
export function duplicateUnitKeys(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return [...duplicates];
}
