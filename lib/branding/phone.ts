/**
 * What counts as a phone number, and what can be done with one.
 *
 * WHY THIS IS ONE MODULE
 *
 * The rule that decides whether a number is acceptable (the settings form) and
 * the rule that decides whether it can become a WhatsApp link (the public
 * pages) have to agree, or an owner saves a number the product then quietly
 * refuses to use. They were about to be written in two files.
 *
 * Pure and dependency-free, so both the API route and the public branding
 * resolver can import it, and so the cases below can be tested directly rather
 * than through a request.
 *
 * @module lib/branding/phone
 */

/**
 * The characters a phone number may be written with.
 *
 * Deliberately permissive, and checked as a character set rather than as a
 * shape. Phone formatting is not universal — a business writes `054-123-4567`,
 * `+972 54 123 4567` or `(054) 1234567`, and each is correct where it is used.
 * An earlier version of this anchored on the first character being `+` or a
 * digit and rejected the parenthesised form, which is one of the most common
 * ways to write a number with an area code.
 *
 * Normalising into one canonical shape would mangle numbers this platform has
 * no business having an opinion about; rejecting them would stop owners
 * entering the number their clients actually dial.
 */
export const PHONE_PATTERN = /^[+\d(][\d\s().\-/+]*$/;

/** The longest number worth storing; past this it is not a phone number. */
export const PHONE_MAX_LENGTH = 40;

/**
 * The fewest digits that could be a real number.
 *
 * Counting digits, rather than measuring the string, is what separates a short
 * internal extension from `((((((` — both pass a character-set check.
 */
export const PHONE_MIN_DIGITS = 5;

/**
 * A number in E.164 (`+972541234567`), given the calling code to assume.
 *
 * The calling code is passed in rather than looked up so this module stays free
 * of `react-phone-number-input`, which is a client-side dependency and has no
 * business being pulled into an API route.
 *
 * Only used when a stored number has no `+`: numbers were saved as free text
 * before the country selector existed, and they still have to be shown in a
 * field that expects E.164.
 */
export function toE164(phone: string | null | undefined, callingCode: string): string | undefined {
  if (!phone?.trim()) return undefined;

  const trimmed = phone.trim();
  if (trimmed.startsWith('+')) return trimmed;

  // `00` is the same intent as `+`, written the other way.
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('00')) return `+${digits.replace(/^00/, '')}`;

  return `+${callingCode}${digits}`;
}

/** Whether this could be dialled. Empty is allowed — it means "cleared". */
export function isPlausiblePhone(value: string | null | undefined): boolean {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') return true;
  if (trimmed.length > PHONE_MAX_LENGTH) return false;
  if (!PHONE_PATTERN.test(trimmed)) return false;

  return (trimmed.match(/\d/g) || []).length >= PHONE_MIN_DIGITS;
}

/**
 * A `wa.me` link for a phone number, or null.
 *
 * WhatsApp wants digits only, with a country code and no leading `+`. A number
 * stored without one cannot be turned into a working link — guessing a country
 * from the business's language would produce a link that dials a stranger — so
 * this returns null and the page offers the plain number instead.
 */
export function whatsappLink(phone: string | null | undefined): string | null {
  if (!phone) return null;

  const trimmed = phone.trim();
  // `00` is the international prefix outside the `+` convention.
  if (!trimmed.startsWith('+') && !trimmed.startsWith('00')) return null;

  const digits = trimmed.replace(/\D/g, '');
  // Shorter than this is not an international number, whatever the prefix says.
  if (digits.length < 9) return null;

  return `https://wa.me/${digits.replace(/^00/, '')}`;
}
