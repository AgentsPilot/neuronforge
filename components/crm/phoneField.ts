/**
 * The country a phone field should start on, and what it may show.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Three screens edit a contact's phone — the drawer's details section, the
 * contact modal and the older drawer — and all three did the same two things
 * wrong, in three copies:
 *
 *   1. `useState<Country>('US')`, never seeded from anything. An Israeli
 *      business opening any contact started on US, so `054…` was read as a US
 *      number and saved with the wrong calling code.
 *
 *   2. On a country lookup failure they fabricated a `+`:
 *
 *          catch { return `+${phone.replace(/\D/g, '')}` }
 *
 *      A `+` asserts "what follows is a COMPLETE international number". Putting
 *      one in front of a national number does not make it international — it
 *      makes a different number. Live data carries the result: `+546778512`
 *      (an Israeli mobile missing its `972`) and `+2013643030` (a US number
 *      missing its `1`), alongside correct rows for the same people.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE HERE
 *
 * A stored number is ANSWERED FROM, never rewritten. If it already carries a
 * `+`, it knows its own country and that is the answer. If it does not, this
 * says so by returning it unchanged, and the field shows what the business
 * actually typed rather than a guess dressed up as E.164.
 *
 * Guessing is confined to ONE place — which country an empty field starts on —
 * where being wrong costs a dropdown click rather than a corrupted number.
 *
 * @module components/crm/phoneField
 */

import {
  getCountryCallingCode,
  isSupportedCountry,
  isValidPhoneNumber,
  parsePhoneNumber,
} from 'react-phone-number-input';
import type { Country } from 'react-phone-number-input';

/**
 * Where a phone field should start.
 *
 * In preference order: the country the EXISTING number declares, then the one
 * the business works in, then US — which is a last resort and not a default
 * worth relying on, since it is the assumption that caused the damage.
 *
 * `businessCountry` is whatever the profile holds: an ISO code, something
 * lowercase, or nothing at all. It is checked rather than trusted, because an
 * unsupported value handed to the phone input throws.
 */
export function phoneFieldCountry(
  phone: string | null | undefined,
  businessCountry?: string | null
): Country {
  const fromNumber = countryOfPhone(phone);
  if (fromNumber) return fromNumber;

  const candidate = businessCountry?.trim().toUpperCase();
  if (candidate && isSupportedCountry(candidate)) return candidate as Country;

  return 'US';
}

/**
 * The country a number declares about itself, or null.
 *
 * Only a number carrying a `+` declares anything. `0546778512` could be Israeli
 * or British or a dozen other things, and this returns null rather than pick
 * one — the whole bug was code that picked one.
 */
export function countryOfPhone(phone: string | null | undefined): Country | null {
  const trimmed = phone?.trim();
  if (!trimmed || !trimmed.startsWith('+')) return null;

  try {
    return parsePhoneNumber(trimmed)?.country ?? null;
  } catch {
    return null;
  }
}

/**
 * What the field shows for a stored number.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `PhoneInput` is a controlled component whose value must be E.164 or nothing.
 * Handed `2013643030` it has no way to know what that means, and what it does
 * with it is not something to rely on.
 *
 * So: a number that already declares its country is passed through untouched —
 * it is the record, and nothing here may reinterpret it. A number that does not
 * is rendered through the country the owner has SELECTED, which is the only
 * statement anyone has made about what it means.
 *
 * That last part is not the old bug returning. The bug was the selected country
 * defaulting to US no matter what the number was; now it is seeded from the
 * number and only moves when an owner moves it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function phoneFieldValue(
  phone: string | null | undefined,
  country?: Country
): string | undefined {
  const trimmed = phone?.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('+')) return trimmed;

  return country ? applyCountryToPhone(trimmed, country) : undefined;
}

/**
 * The number, written for the country the owner just chose.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS IS FOR
 *
 * The country selector was wired to `setPhoneCountry` and nothing else. Picking
 * "United States" changed a dropdown and left the number alone, so `2013643030`
 * stayed national, something later put a bare `+` on it, and the saved value
 * `+2013643030` reads as EGYPT — `+20` — which is what the owner saw when they
 * reopened the contact.
 *
 * Choosing a country is a statement about the number. This applies it.
 *
 * The national part is taken from the parse when the value parses, so switching
 * between countries does not accumulate calling codes. A leading `0` is dropped
 * because it is a national trunk prefix and never appears after a `+`.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function applyCountryToPhone(
  phone: string | null | undefined,
  country: Country
): string | undefined {
  const trimmed = phone?.trim();
  if (!trimmed) return undefined;

  let callingCode: string;
  try {
    callingCode = getCountryCallingCode(country);
  } catch {
    // An unsupported country. Fabricating a `+` is the fault this module
    // exists for, so the number is returned exactly as it was.
    return trimmed;
  }

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * TWO READINGS, AND THE VALID ONE WINS.
   *
   * A number already carrying a `+` can be read two ways when the owner says it
   * belongs somewhere else, and neither is right in every case:
   *
   *   A  strip the calling code the parser found   `+2013643030` → 13643030
   *   B  strip only the `+`                        `+2013643030` → 2013643030
   *
   * `+2013643030` is a VALID Egyptian number — `+20` — so nothing in the value
   * says it was meant to be American. But it was: the owner picked United
   * States, saved, and reopened the contact to find Egypt. Reading A gives
   * `+113643030`, nine digits and not a US number; reading B gives
   * `+12013643030`, which is the number they meant.
   *
   * Switch a genuine Israeli number to the US and it is the other way round: A
   * is the sensible reading and B glues `972` into the middle.
   *
   * So both are built and the one that is a VALID number for the chosen country
   * is used. Where neither is valid — `+972546778512` asked to become American
   * has no sensible answer — A wins, because stripping the calling code is the
   * principled reading and the owner can see the result and retype.
   *
   * An earlier version took A always, which destroyed digits: `+546778512`
   * parses as ARGENTINA, so "this is Israeli" produced `+9726778512` and the
   * `54` was gone. Under this rule it produces `+972546778512`, which is the
   * repair.
   * ───────────────────────────────────────────────────────────────────────────
   */
  let fromParse: string | undefined;
  if (trimmed.startsWith('+')) {
    try {
      fromParse = parsePhoneNumber(trimmed)?.nationalNumber?.toString();
    } catch {
      fromParse = undefined;
    }
  }

  // Every digit, with the national trunk prefix dropped: a leading `0` never
  // appears after a `+`.
  const fromDigits = trimmed.replace(/\D/g, '').replace(/^0+/, '');
  if (!fromDigits && !fromParse) return undefined;

  const candidates = [
    fromParse ? `+${callingCode}${fromParse}` : undefined,
    fromDigits ? `+${callingCode}${fromDigits}` : undefined,
  ].filter((value): value is string => Boolean(value));

  const valid = candidates.find(candidate => {
    try {
      return isValidPhoneNumber(candidate);
    } catch {
      return false;
    }
  });

  return valid ?? candidates[0];
}

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
 * itself be one of the malformed ones this module exists for — `+2013643030`
 * parses as Egypt — and seeding a visitor's field from corrupt data would turn
 * one bad record into many.
 *
 * English stays US because `en` spans the US, the UK, Australia and more, and
 * there is nothing here to separate them. A visitor can always change it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function publicFormCountry(locale: string | null | undefined): Country {
  switch (locale) {
    case 'he':
      return 'IL';
    case 'es':
      return 'ES';
    default:
      return 'US';
  }
}
