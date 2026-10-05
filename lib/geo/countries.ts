/**
 * Countries, from a real list rather than from whatever somebody typed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * `business_profiles.invoice_address.country` was a free-text input. On the live
 * account that produced "Israel" ×4 and "USA" ×2 — tidy by luck, not by design —
 * and anything keyed off it had to guess: a refund disclaimer, a tax rule, a
 * currency default. Guessing from free text means "Isreal" silently resolves to
 * nothing, or worse, to the wrong country.
 *
 * So the country is now PICKED, and what is stored is an ISO 3166-1 alpha-2
 * code. There is nothing left to normalise.
 *
 * THE LIST IS NOT WRITTEN HERE. It comes from `react-phone-number-input`, which
 * this app already depends on for phone prefixes and which ships 258 countries
 * with translated names in exactly the three locales this product speaks. A
 * hand-maintained country list is a thing that goes out of date and gets names
 * wrong in ways that offend people.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READING BACK IS NOT SYMMETRIC, AND THAT IS DELIBERATE.
 *
 * `countryName` accepts anything, because the column still holds the old
 * free-text values and WILL for as long as nobody re-saves those settings. A
 * stored "Israel" must keep printing "Israel" on an invoice; only a recognised
 * code is translated. That is what makes this change safe without a data
 * migration.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/geo/countries
 */

/*
 * THE COUNTRY LIST COMES FROM `libphonenumber-js`, NOT FROM
 * `react-phone-number-input` — and the difference is not cosmetic.
 *
 * This module is imported by SERVER code: `publicBranding.ts` builds the public
 * pages with it and `InvoicePDFGenerator.tsx` renders invoices with it. The
 * `react-phone-number-input` entry point pulls in `PhoneInputWithCountry`, a
 * React class component, which cannot be evaluated in a React Server Component
 * and failed outright:
 *
 *     TypeError: Super expression must either be null or a function
 *       at _inherits (.../PhoneInputWithCountry.js)
 *
 * That took down /book/manage/[token]/reschedule — a page with no address on it
 * at all, reached only because it renders public branding.
 *
 * `libphonenumber-js` is where that package gets its data anyway: same 245
 * countries, no React. The locale files below ARE safe to import here — they are
 * plain data modules (`export default { … }`) with no component in them.
 */
import en from 'react-phone-number-input/locale/en';
import es from 'react-phone-number-input/locale/es';
import he from 'react-phone-number-input/locale/he';

/** The three the product speaks; anything else reads English. */
export type CountryLocale = 'en' | 'es' | 'he';

const LABELS: Record<CountryLocale, Record<string, string>> = {
  en: en as Record<string, string>,
  es: es as Record<string, string>,
  he: he as Record<string, string>,
};

/** ISO 3166-1 alpha-2, which is what is stored. */
export type CountryCode = string;

/*
 * The country list, derived from the locale data itself.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * No `getCountries()` from anywhere. `react-phone-number-input` exports one but
 * importing its entry pulls a React class component into server code, and
 * `libphonenumber-js` exports one that needs its metadata bundle and breaks
 * under ESM interop. The locale file already holds every code as a key, so the
 * list is simply its own keys.
 *
 * The three non-country keys are lowercase UI strings — 'ext', 'country',
 * 'phone' — so a two-uppercase-letter test separates them exactly rather than
 * approximately. 255 codes at the time of writing.
 * ───────────────────────────────────────────────────────────────────────────
 */
const COUNTRY_CODES: readonly string[] = Object.keys(en as Record<string, string>)
  .filter(key => /^[A-Z]{2}$/.test(key))
  /*
   * 'ZZ' is not a country — it is CLDR's placeholder for an unknown region, and
   * the locale file labels it "International" / "בינלאומי". It passes the
   * two-uppercase-letter test and would sit in the dropdown between Zambia and
   * Zimbabwe, selectable, and then save as a country code nothing can resolve.
   */
  .filter(key => key !== 'ZZ')
  .sort();

const COUNTRY_CODE_SET = new Set(COUNTRY_CODES);

/** Every country, already sorted by name in the reader's language. */
export function countryOptions(
  locale: CountryLocale = 'en'
): Array<{ code: CountryCode; name: string }> {
  const labels = LABELS[locale] ?? LABELS.en;

  return COUNTRY_CODES
    .map(code => ({ code, name: labels[code] || (en as Record<string, string>)[code] || code }))
    .sort((a, b) =>
      // Collated in the reader's own language: an alphabetical list that is
      // alphabetical in English only is not sorted at all to a Hebrew reader.
      a.name.localeCompare(b.name, locale)
    );
}

/**
 * True when a stored value is a real country code rather than typed prose.
 *
 * A plain boolean, NOT a `value is CountryCode` guard. `CountryCode` is a string
 * alias, so narrowing on it left the else-branch as `never` — and the next line
 * to call `.toLowerCase()` on what TypeScript now believed was nothing failed to
 * compile. A guard that narrows a type to itself subtracts everything.
 */
export function isCountryCode(value: string | null | undefined): boolean {
  if (!value || value.length !== 2) return false;
  return COUNTRY_CODE_SET.has(value.toUpperCase());
}

/**
 * Spellings that predate the picker, mapped to a code.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONLY FOR DATA ALREADY IN THE COLUMN. Nothing new goes through here: the
 * dropdown emits a code, which is the entire point of it.
 *
 * It exists so a business that typed "Israel" before the picker existed sees
 * Israel already selected when it opens its settings, and stores 'IL' the next
 * time it saves. Without it that field would look empty and the owner would
 * think their address had been lost.
 *
 * Deliberately small, and deliberately NOT fuzzy. Every entry is a country this
 * platform actually bills in, or a form of one that is on the live data today
 * ("Israel" ×4, "USA" ×2). A misspelling resolves to null and the owner picks
 * from the list — which is the correct outcome, because guessing a country from
 * a typo is how the wrong one gets stored.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const LEGACY_ALIASES: Record<string, string> = {
  il: 'IL', isr: 'IL', israel: 'IL', 'ישראל': 'IL', 'מדינת ישראל': 'IL',
  us: 'US', usa: 'US', 'u.s.': 'US', 'u.s.a.': 'US',
  'united states': 'US', 'united states of america': 'US',
  uk: 'GB', gb: 'GB', 'united kingdom': 'GB', 'great britain': 'GB', england: 'GB',
  es: 'ES', esp: 'ES', spain: 'ES', 'españa': 'ES', espana: 'ES',
};

/**
 * A code for a value that may be a code already, or may be old free text.
 *
 * Returns null when it cannot be told — which callers must treat as "ask the
 * owner", never as a default.
 */
export function legacyCountryToCode(raw: string | null | undefined): CountryCode | null {
  if (!raw) return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Already a real code: the common case from here on.
  if (isCountryCode(trimmed)) return trimmed.toUpperCase() as CountryCode;

  const alias = LEGACY_ALIASES[trimmed.toLowerCase().replace(/\s+/g, ' ')];
  return (alias as CountryCode) ?? null;
}

/**
 * A stored value, as something to show a human.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PASSES UNKNOWN VALUES THROUGH UNCHANGED, which is the whole point.
 *
 * The invoice PDF prints this straight onto a tax document. Storing codes while
 * printing them would put "IL" where "Israel" used to be — so a code becomes a
 * name, and anything that is not a code (every row saved before the dropdown
 * existed) is returned exactly as it was typed.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function countryName(
  value: string | null | undefined,
  locale: CountryLocale = 'en'
): string {
  if (!value) return '';

  const trimmed = value.trim();
  if (!isCountryCode(trimmed)) return trimmed;

  const code = trimmed.toUpperCase();
  const labels = LABELS[locale] ?? LABELS.en;
  return labels[code] || (en as Record<string, string>)[code] || code;
}
