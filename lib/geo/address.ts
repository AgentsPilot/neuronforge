/**
 * Turning a structured address into something a person reads.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE FORMATTER, BECAUSE THE COUNTRY IS NOW A CODE.
 *
 * Two private `formatAddress` functions existed — one in `publicBranding.ts` for
 * the public pages, one in `InvoicePDFGenerator.tsx` for the invoice — and both
 * pushed `address.country` onto the output verbatim. That was fine while the
 * column held "Israel". It stopped being fine the moment the country became a
 * picker storing 'IL', because the invoice is a tax document and it would have
 * started printing "IL".
 *
 * So the country goes through `countryName`, which translates a real code and
 * passes anything else through untouched — meaning a business that has not yet
 * re-saved its settings keeps printing exactly what it typed.
 *
 * THE LOCALE MATTERS. An invoice rendered in Hebrew should say ישראל, and the
 * same business's English invoice should say Israel. The caller knows which
 * document it is rendering; this does not.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/geo/address
 */

import { countryName, type CountryLocale } from './countries';

/** The shape stored in `invoice_address` and in `address_parts`. */
export interface StructuredAddress {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

/** True when there is enough here to show anybody. */
export function hasAddressContent(address: StructuredAddress | null | undefined): boolean {
  if (!address) return false;
  return Boolean(clean(address.line1) || clean(address.city) || clean(address.country));
}

/**
 * The address as display lines — street, then city/state/postcode, then country.
 *
 * Shaped for a document that has vertical room, which is why the city line is
 * joined and the country stands alone.
 */
export function formatAddressLines(
  address: StructuredAddress | null | undefined,
  locale: CountryLocale = 'en'
): string[] {
  if (!address) return [];

  const lines: string[] = [];

  if (clean(address.line1)) lines.push(clean(address.line1));
  if (clean(address.line2)) lines.push(clean(address.line2));

  const cityLine = [clean(address.city), clean(address.state), clean(address.postal_code)]
    .filter(Boolean)
    .join(', ');
  if (cityLine) lines.push(cityLine);

  // The one part that is stored as a code and shown as a name.
  const country = countryName(address.country, locale);
  if (country) lines.push(country);

  return lines;
}

/**
 * The address on one line, for somewhere with no room — a public page, a
 * website block, a privacy policy.
 */
export function formatAddressOneLine(
  address: StructuredAddress | null | undefined,
  locale: CountryLocale = 'en'
): string | null {
  const lines = formatAddressLines(address, locale);
  return lines.length ? lines.join(', ') : null;
}
