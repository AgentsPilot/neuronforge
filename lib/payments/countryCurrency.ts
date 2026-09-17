/**
 * The currency a Stripe Connect account settles in, by country.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This existed as `country === 'US' ? 'USD' : 'EUR'` — one ternary standing in
 * for twenty-four countries. Every account outside the United States was
 * recorded as euros: an Israeli business settling in shekels, a British one in
 * pounds and a Japanese one in yen were all stored as EUR, and anything reading
 * that column — a total, a report, a currency symbol beside a figure — had the
 * wrong denomination for the money it was describing.
 *
 * The value is OURS, not Stripe's: Stripe derives the real settlement currency
 * from the country when the account is created. This column records what we
 * believe it to be, so being wrong here is a quiet kind of wrong — nothing
 * fails, the numbers simply mean something other than they say.
 *
 * Keyed to the list the connect wizard offers (`SUPPORTED_COUNTRIES`). A code
 * that is not here answers `null` rather than guessing, so a caller can leave
 * the column empty instead of writing a currency nobody chose.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const SETTLEMENT_CURRENCY: Record<string, string> = {
  US: 'USD',
  GB: 'GBP',
  CA: 'CAD',
  AU: 'AUD',
  IL: 'ILS',
  CH: 'CHF',
  SE: 'SEK',
  NO: 'NOK',
  DK: 'DKK',
  NZ: 'NZD',
  SG: 'SGD',
  HK: 'HKD',
  JP: 'JPY',
  MX: 'MXN',
  BR: 'BRL',

  // The eurozone members the wizard offers. Listed one by one rather than
  // treated as the fallback: "not on this list" and "uses the euro" are
  // different facts, and collapsing them is exactly what put Israel in EUR.
  DE: 'EUR',
  FR: 'EUR',
  ES: 'EUR',
  IT: 'EUR',
  NL: 'EUR',
  BE: 'EUR',
  AT: 'EUR',
  IE: 'EUR',
  PT: 'EUR',
  FI: 'EUR',
};

/**
 * The settlement currency for a country, or null when we do not know.
 *
 * Null deliberately, rather than a default. A wrong currency is worse than an
 * absent one: an empty column reads as "not recorded" and a wrong one reads as
 * fact.
 */
export function settlementCurrencyFor(countryCode: string | null | undefined): string | null {
  if (!countryCode) return null;
  return SETTLEMENT_CURRENCY[countryCode.toUpperCase()] ?? null;
}
