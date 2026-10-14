/**
 * Sanity bounds for a pending provider price (SA RR-1, added to R-4).
 *
 * Named config constants, as decimal STRINGS (never floats): the checks
 * compare them exactly through `decimal.ts`.
 *
 *  - Above a ceiling: HARD refusal, the line is never stored.
 *  - A move of more than LARGE_MOVE_BASIS_POINTS either way against the price
 *    we charge today: stored, but flagged `large_move`, which needs an
 *    override reason at apply (slice 8).
 */

/** USD per 1M tokens. No listed model is near it; a value above it is a typo or a mis-parse. */
export const MAX_PRICE_PER_MILLION_TOKENS = '1000';

/** USD per generated image. */
export const MAX_PRICE_PER_IMAGE = '5';

/** 50% (5,000 basis points) either way against the current price. */
export const LARGE_MOVE_BASIS_POINTS = 5000;

/**
 * The R-1 price string: up to 6 integer digits and up to 9 decimals, per 1M
 * tokens or per image. The same pattern is pinned in the migration's CHECK
 * (the slice 3 migration test compares the two).
 */
export const PRICE_STRING_PATTERN = '^[0-9]{1,6}([.][0-9]{1,9})?$';
