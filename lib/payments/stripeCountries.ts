/**
 * The countries a business can open a Stripe Connect account in.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This list lived inside `StripeConnectWizard`, a component nothing renders any
 * more (`showStripeWizard` is only ever set to false). The live payments screen
 * needs the same list to ask the one question that cannot be asked later, so it
 * moves here rather than being typed out a second time — `countryCurrency.ts`
 * already documents itself as "keyed to the list the connect wizard offers",
 * and two copies of that list would eventually disagree.
 *
 * Names are carried per language rather than translated at the call site: a
 * country name is data, not copy, and the three we support are known here.
 *
 * @module lib/payments/stripeCountries
 */

export interface StripeCountry {
  /** ISO 3166-1 alpha-2. What `accounts.create` takes, and what it fixes. */
  code: string;
  name: string;
  flag: string;
  nameHe: string;
  nameEs: string;
}

export const SUPPORTED_COUNTRIES: StripeCountry[] = [
  { code: 'US', name: 'United States', flag: '🇺🇸', nameHe: 'ארצות הברית', nameEs: 'Estados Unidos' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', nameHe: 'בריטניה', nameEs: 'Reino Unido' },
  { code: 'CA', name: 'Canada', flag: '🇨🇦', nameHe: 'קנדה', nameEs: 'Canadá' },
  { code: 'AU', name: 'Australia', flag: '🇦🇺', nameHe: 'אוסטרליה', nameEs: 'Australia' },
  { code: 'IL', name: 'Israel', flag: '🇮🇱', nameHe: 'ישראל', nameEs: 'Israel' },
  { code: 'DE', name: 'Germany', flag: '🇩🇪', nameHe: 'גרמניה', nameEs: 'Alemania' },
  { code: 'FR', name: 'France', flag: '🇫🇷', nameHe: 'צרפת', nameEs: 'Francia' },
  { code: 'ES', name: 'Spain', flag: '🇪🇸', nameHe: 'ספרד', nameEs: 'España' },
  { code: 'IT', name: 'Italy', flag: '🇮🇹', nameHe: 'איטליה', nameEs: 'Italia' },
  { code: 'NL', name: 'Netherlands', flag: '🇳🇱', nameHe: 'הולנד', nameEs: 'Países Bajos' },
  { code: 'BE', name: 'Belgium', flag: '🇧🇪', nameHe: 'בלגיה', nameEs: 'Bélgica' },
  { code: 'AT', name: 'Austria', flag: '🇦🇹', nameHe: 'אוסטריה', nameEs: 'Austria' },
  { code: 'CH', name: 'Switzerland', flag: '🇨🇭', nameHe: 'שוויץ', nameEs: 'Suiza' },
  { code: 'IE', name: 'Ireland', flag: '🇮🇪', nameHe: 'אירלנד', nameEs: 'Irlanda' },
  { code: 'PT', name: 'Portugal', flag: '🇵🇹', nameHe: 'פורטוגל', nameEs: 'Portugal' },
  { code: 'SE', name: 'Sweden', flag: '🇸🇪', nameHe: 'שוודיה', nameEs: 'Suecia' },
  { code: 'NO', name: 'Norway', flag: '🇳🇴', nameHe: 'נורווגיה', nameEs: 'Noruega' },
  { code: 'DK', name: 'Denmark', flag: '🇩🇰', nameHe: 'דנמרק', nameEs: 'Dinamarca' },
  { code: 'FI', name: 'Finland', flag: '🇫🇮', nameHe: 'פינלנד', nameEs: 'Finlandia' },
  { code: 'NZ', name: 'New Zealand', flag: '🇳🇿', nameHe: 'ניו זילנד', nameEs: 'Nueva Zelanda' },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬', nameHe: 'סינגפור', nameEs: 'Singapur' },
  { code: 'HK', name: 'Hong Kong', flag: '🇭🇰', nameHe: 'הונג קונג', nameEs: 'Hong Kong' },
  { code: 'JP', name: 'Japan', flag: '🇯🇵', nameHe: 'יפן', nameEs: 'Japón' },
  { code: 'MX', name: 'Mexico', flag: '🇲🇽', nameHe: 'מקסיקו', nameEs: 'México' },
  { code: 'BR', name: 'Brazil', flag: '🇧🇷', nameHe: 'ברזיל', nameEs: 'Brasil' },
];

/** Is this a country we can open an account in? */
export function isSupportedCountry(code: string | null | undefined): boolean {
  if (!code) return false;
  const upper = code.toUpperCase();
  return SUPPORTED_COUNTRIES.some(country => country.code === upper);
}

/** The country's name in the language on screen, falling back to English. */
export function countryNameIn(country: StripeCountry, language: string | null | undefined): string {
  if (language === 'he') return country.nameHe;
  if (language === 'es') return country.nameEs;
  return country.name;
}

/** The row for a code, or undefined. */
export function findCountry(code: string | null | undefined): StripeCountry | undefined {
  if (!code) return undefined;
  const upper = code.toUpperCase();
  return SUPPORTED_COUNTRIES.find(country => country.code === upper);
}
