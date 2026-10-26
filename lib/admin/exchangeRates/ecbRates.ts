/**
 * Exchange rates admin, slice 1e: the ECB daily reference-rate parser and the
 * per-USD derivation (requirement §5.7.2; SA §13.7 SQ-37, SA-1e-3).
 *
 * SQ-42: a per-USD rate is derived from two rates of the same official feed
 * (ECB(X) ÷ ECB(USD)); it is a rate, not a converted figure. No amount of money
 * is taken or produced here (D-5).
 *
 * The parser is a pure string reader: no XML library, no `DOMParser`, no
 * `eval`. Without an XML parser there is no entity expansion, so no XXE or
 * "billion laughs". Every pattern is anchored and linear (bounded digit runs,
 * no nested or adjacent unbounded quantifiers over the same characters), and
 * the input is already capped at 64 KB by `ecbFeed.ts` before any runs.
 *
 * Anchors, each a `layout_changed` failure with its own name:
 *   E1  `<gesmes:name>European Central Bank</gesmes:name>` is present;
 *   E2  exactly one `<Cube time='YYYY-MM-DD'>`, and it is a real date;
 *   E3  every rate line has the strict shape, and the strict count equals
 *       BOTH the count of every self-closing `<Cube …/>` tag AND the plain
 *       count of `currency=`, so a changed attribute order, an extra
 *       attribute or an explicit-close line (`<Cube …></Cube>`) fails loudly
 *       instead of silently dropping a currency;
 *   E4  no currency code twice;
 *   E5  USD is present with a non-zero rate.
 */

import { isRealDate } from '@/app/admin/components/adminWindowPresets';
import { parseDecimal } from '@/lib/ai/pricing-research/decimal';

import { BASE_CURRENCY, isPositiveRate } from './exchangeRateRules';
import { divideHalfUp, toFixedPlaces } from './rateMath';
import type { RateSuggestionStatus } from './rateSyncRules';

export type EcbAnchor = 'E1' | 'E2' | 'E3' | 'E4' | 'E5';

export type EcbDailyParse =
  | { ok: true; rateDate: string; perEur: ReadonlyMap<string, string> }
  | { ok: false; anchor: EcbAnchor };

const SENDER_NAME = '<gesmes:name>European Central Bank</gesmes:name>';
const TIME_LOOSE = /<Cube\s+time=/g;
const TIME_STRICT = /<Cube\s+time=(['"])(\d{4}-\d{2}-\d{2})\1\s*>/g;
// Every self-closing Cube tag is a rate line, whatever its attribute order (DV-3: the
// `<Cube\s+currency=` count alone cannot see a swapped order, so the swap would drop silently).
// The run excludes `<` as well as `>` (QA F-1): each attempt stops at the next tag, so the scan
// is linear even on a run of unclosed `<Cube` (`[^>]*` alone was quadratic there).
const RATE_LOOSE = /<Cube\b[^<>]*\/>/g;
// Every `currency=` anywhere: an explicit-close rate line is not self-closing, so only this sees it.
const CURRENCY_ATTRIBUTE = /currency=/g;
const RATE_STRICT = /<Cube\s+currency=(['"])([A-Z]{3})\1\s+rate=(['"])(\d{1,6}(?:\.\d{1,10})?)\3\s*\/>/g;

/** A decimal string with a non-zero digit is above zero (the pattern allows no sign). */
const hasNonZeroDigit = (rate: string) => /[1-9]/.test(rate);

/** Parse the ECB daily file: the rate date and each currency's rate per 1 EUR, as written. */
export function parseEcbDaily(text: string): EcbDailyParse {
  if (!text.includes(SENDER_NAME)) return { ok: false, anchor: 'E1' };

  const times = [...text.matchAll(TIME_STRICT)];
  const looseTimes = text.match(TIME_LOOSE)?.length ?? 0;
  if (times.length !== 1 || looseTimes !== 1 || !isRealDate(times[0][2])) return { ok: false, anchor: 'E2' };
  const rateDate = times[0][2];

  const lines = [...text.matchAll(RATE_STRICT)];
  const looseLines = text.match(RATE_LOOSE)?.length ?? 0;
  const currencyAttributes = text.match(CURRENCY_ATTRIBUTE)?.length ?? 0;
  if (lines.length === 0 || lines.length !== looseLines || lines.length !== currencyAttributes) {
    return { ok: false, anchor: 'E3' };
  }

  const perEur = new Map<string, string>();
  for (const line of lines) {
    const code = line[2];
    if (perEur.has(code)) return { ok: false, anchor: 'E4' };
    perEur.set(code, line[4]);
  }

  const usd = perEur.get(BASE_CURRENCY);
  if (usd === undefined || !hasNonZeroDigit(usd)) return { ok: false, anchor: 'E5' };

  return { ok: true, rateDate, perEur };
}

export interface PerUsdRate {
  currencyCode: string;
  status: RateSuggestionStatus;
  /** 6 decimals, half-up; null unless `status` is `suggested`. */
  suggestedRate: string | null;
}

/**
 * Each requested code per 1 USD, 6 decimals, half up (SA-1e-3):
 *   X ≠ EUR → ECB(X) ÷ ECB(USD); EUR → 1 ÷ ECB(USD) (the feed's base);
 *   a code the feed lacks → `not_in_feed` (never 1, D-4);
 *   a zero feed rate, or a result that is not a storable positive rate
 *   (it rounds to 0, or it exceeds RATE_MAX) → `no_usable_rate`.
 * USD itself is never requested (its rate is fixed at 1); asking for it throws.
 * `perEur` must come from a successful `parseEcbDaily` (E5 holds).
 */
export function perUsdRates(perEur: ReadonlyMap<string, string>, codes: readonly string[]): PerUsdRate[] {
  const usd = perEur.get(BASE_CURRENCY);
  if (usd === undefined || !hasNonZeroDigit(usd)) throw new Error('perUsdRates: the feed has no usable USD rate');
  const usdRate = parseDecimal(usd);

  return codes.map((currencyCode): PerUsdRate => {
    if (currencyCode === BASE_CURRENCY) throw new Error('perUsdRates: USD is never synced');
    const perEurRate = currencyCode === 'EUR' ? '1' : perEur.get(currencyCode);
    if (perEurRate === undefined) return { currencyCode, status: 'not_in_feed', suggestedRate: null };
    if (!hasNonZeroDigit(perEurRate)) return { currencyCode, status: 'no_usable_rate', suggestedRate: null };
    const derived = toFixedPlaces(divideHalfUp(parseDecimal(perEurRate), usdRate, 6), 6);
    if (!isPositiveRate(derived)) return { currencyCode, status: 'no_usable_rate', suggestedRate: null };
    return { currencyCode, status: 'suggested', suggestedRate: derived };
  });
}
