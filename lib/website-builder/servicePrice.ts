/**
 * How a price is written on the website surfaces.
 *
 * Byte-identical copies of this lived in the editor route and the public route,
 * which is two chances for the editor and the live site to disagree about what
 * a client will be charged.
 *
 * @module lib/website-builder/servicePrice
 */

/** The symbols the website surfaces use. */
const SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', ILS: '₪', GBP: '£' };

/**
 * A price as the public pages render it.
 *
 * Whole units, symbol first, no grouping — matching what the generator wrote
 * into blocks and what every website surface has shown since. Deliberately NOT
 * `Intl.NumberFormat`: that would change the text on existing published pages.
 */
export function formatPrice(price: number, currency?: string): string {
  const symbol = SYMBOLS[currency || 'USD'] || '$';
  return `${symbol}${price.toFixed(0)}`;
}
