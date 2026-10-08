/**
 * What a business charges in, and how to write it.
 *
 * Currency used to be inferred from the interface language: Hebrew meant
 * shekels, Spanish meant euros, anything else meant dollars. That is a guess
 * about geography made from a reading preference, and it is wrong for exactly
 * the people most likely to notice — an Israeli practice serving clients in the
 * United States, working in Hebrew and charging in dollars, watched every price
 * it typed come back with the wrong symbol on it.
 *
 * So the currency a person actually wrote wins, and the language is only the
 * fallback for when they never said.
 */

import { fromMinorUnits, minorUnitsPerMajor } from '@/lib/payments/refundMath';

export type CurrencyCode = 'USD' | 'ILS' | 'EUR' | 'GBP';

const SYMBOLS: Record<string, string> = {
  USD: '$',
  ILS: '₪',
  EUR: '€',
  GBP: '£',
};

/** The symbol for a code, or the code itself when it is one we do not draw. */
export function currencySymbol(code: string | null | undefined): string {
  if (!code) return '';
  return SYMBOLS[code.toUpperCase()] || code;
}

/**
 * What someone writing in this language most likely charges in.
 *
 * A last resort, used only when nothing in the conversation said otherwise.
 */
export function currencyForLanguage(language: string | null | undefined): CurrencyCode {
  switch (language) {
    case 'he': return 'ILS';
    case 'es': return 'EUR';
    default: return 'USD';
  }
}

/**
 * The currency a price was written in.
 *
 * Reads the symbol or the name out of what the person typed — "$80",
 * "150 ש"ח", "€40", "80 dollars" — and returns null when the number stands
 * alone, because a bare number is not evidence of anything.
 */
export function currencyFromText(text: string | null | undefined): CurrencyCode | null {
  if (!text) return null;
  const lower = text.toLowerCase();

  if (/[$]|usd|dollar|דולר|dólar/.test(lower)) return 'USD';
  if (/[₪]|ils|shekel|שקל|ש"ח|שח/.test(lower)) return 'ILS';
  if (/[€]|eur\b|euro|אירו/.test(lower)) return 'EUR';
  if (/[£]|gbp|pound|פאונד|libra/.test(lower)) return 'GBP';

  return null;
}

/**
 * One currency for a business, from what its services were priced in.
 *
 * Takes the first currency anyone actually named; a business quoting some
 * services in dollars and others with bare numbers is charging dollars.
 */
export function resolveBusinessCurrency(
  priced: Array<{ currency?: string | null }>,
  language: string | null | undefined
): CurrencyCode {
  const named = priced.find(item => item.currency)?.currency;
  if (named && SYMBOLS[named.toUpperCase()]) return named.toUpperCase() as CurrencyCode;

  return currencyForLanguage(language);
}

/**
 * A price held in minor units (cents), written for a reader in their language
 * (credits boost slice 5a, SA C-1, NFR-9).
 *
 * The conversion is `refundMath`'s, never a typed `/ 100`: a currency's minor
 * unit is not always a hundredth. A whole amount is written without decimals
 * ("$25"), anything else with the currency's own ("$12.50"). The currency is
 * the price's own: nothing here converts one currency into another (FR-28).
 * `refundMath` has no imports, so this stays safe in a client bundle.
 */
export function formatMinorAmount(minor: number, currency: string, language: string): string {
  const per = minorUnitsPerMajor(currency);
  const digits = minor % per === 0 ? 0 : per === 1000 ? 3 : per === 1 ? 0 : 2;
  return new Intl.NumberFormat(language, {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(fromMinorUnits(minor, currency));
}
