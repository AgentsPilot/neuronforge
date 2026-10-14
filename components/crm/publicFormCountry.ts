/**
 * Where a PUBLIC form's phone field should start, without the phone library.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS ITS OWN MODULE (BR-2)
 *
 * The public contact form picks its starting country in a `useState`
 * initialiser, at its very first render. The phone library now arrives after
 * the page has painted (`components/crm/usePhoneLib.ts`), so this function
 * cannot live in `phoneField.ts`, which imports the library at module level:
 * importing it from there would put the whole library back into the page's
 * first download. Only `import type` from the library is allowed here, and
 * `components/crm/__tests__/phoneLibLazy.guard.test.ts` pins that.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module components/crm/publicFormCountry
 */

import type { Country } from 'react-phone-number-input';

/** The only countries `publicFormCountry` can return. */
export type PublicFormCountry = 'IL' | 'ES' | 'US';

/**
 * Where a PUBLIC form's phone field should start.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A visitor filling in a website contact form has no record to answer from, so
 * this is the one place a country is genuinely guessed. It is guessed from the
 * page's own language, which is the business's: a Hebrew page belongs to a
 * business whose callers are overwhelmingly Israeli, and starting it on US made
 * every one of them correct the dropdown before typing.
 *
 * Deliberately NOT read from the business's own phone number. That number may
 * itself be one of the malformed ones `phoneField.ts` exists for (`+2013643030`
 * parses as Egypt), and seeding a visitor's field from corrupt data would turn
 * one bad record into many.
 *
 * English stays US because `en` spans the US, the UK, Australia and more, and
 * there is nothing here to separate them. A visitor can always change it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function publicFormCountry(locale: string | null | undefined): PublicFormCountry & Country {
  switch (locale) {
    case 'he':
      return 'IL';
    case 'es':
      return 'ES';
    default:
      return 'US';
  }
}

/*
 * The calling code of each starting country, for the placeholder's country box
 * only. Before the library arrives the visitor cannot change the country (the
 * box is not interactive), so the placeholder only ever shows one of these
 * three. It must show the SAME text as the real country button, or the number
 * box beside it starts at a different x and the row shifts when the field
 * arrives (AC-2.3). Typed as a Record so the compiler keeps it exhaustive; a
 * test pins each value to the library's `getCountryCallingCode`.
 */
const CALLING_CODES: Record<PublicFormCountry, string> = {
  IL: '972',
  ES: '34',
  US: '1',
};

/** The calling code for a starting country, without the library. */
export function publicFormCallingCode(country: PublicFormCountry): string {
  return CALLING_CODES[country];
}
