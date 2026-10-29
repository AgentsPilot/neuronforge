/**
 * The owner's initials, for the identity chip in the Business OS header.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS A FUNCTION AND NOT TWO LINES AT THE CALL SITE
 *
 * The chip stands in for a person, so the ways it can be wrong are all small
 * and all visible on every screen: a lower-case letter, a stray initial from a
 * middle name, `@` taken from an email, or an empty square for an account whose
 * profile row was never written. Each of those is decided once here, with the
 * reasoning attached, rather than guessed again the next time something needs
 * initials.
 *
 * `Array.from` rather than `charAt`, because a name may begin with a character
 * outside the basic plane and `charAt(0)` would return half of it — a
 * replacement glyph where a letter should be.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * The first character of one word, upper-cased with the locale's own rule —
 * `toLocaleUpperCase`, not `toUpperCase`, because a Turkish `i` upper-cases to
 * `İ` and the platform has owners who write their names in scripts whose
 * casing is not English's. Scripts with no case at all (Hebrew, Arabic) are
 * returned unchanged, which is correct.
 */
function firstLetter(word: string): string | null {
  const [character] = Array.from(word);

  return character ? character.toLocaleUpperCase() : null;
}

/**
 * Up to two letters from `name`, falling back to the first letter of `email`,
 * falling back to an empty string.
 *
 * An empty result is meaningful: it tells the caller it has nothing to show, so
 * the header can keep the gear rather than draw a blank square.
 *
 * FIRST AND LAST, never the middle — "Ada Byron Lovelace" is `AL`. Three
 * letters do not fit the button, and the pair people recognise is the one on
 * the ends.
 */
export function ownerInitials(
  name?: string | null,
  email?: string | null
): string {
  const words = (name ?? '')
    .trim()
    .split(/\s+/)
    .map(word => firstLetter(word))
    .filter((letter): letter is string => Boolean(letter));

  if (words.length >= 2) return `${words[0]}${words[words.length - 1]}`;
  if (words.length === 1) return words[0];

  /*
   * No name at all. The local part of the address is the only thing left that
   * came from the person, and its first letter at least changes between
   * accounts — which is what a chip in the corner is for.
   */
  const local = (email ?? '').trim().split('@')[0] ?? '';

  return firstLetter(local) ?? '';
}
