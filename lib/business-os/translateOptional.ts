/**
 * `t()`, but it admits when a key is missing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TRAP THIS EXISTS TO CLOSE
 *
 * `LanguageContext`'s `t()` ends with `|| key`: a missing translation comes back
 * as the key itself. A key is a non-empty string, so it is TRUTHY — and the
 * idiom everybody reaches for cannot work:
 *
 *     t('crm.next.badge.meeting_ahead') || t('crm.next.meeting_ahead')
 *
 * The left side returns `'crm.next.badge.meeting_ahead'`, the `||` is satisfied,
 * and the raw key is rendered to the owner. The fallback written right beside it
 * never runs.
 *
 * That was live: the next-step badge composes
 * `crm.next.badge.${state}` for sixteen states and only seven have a short
 * form. Its own comment says it "falls back to the full sentence where no short
 * form exists". It could not. The nine states without one printed their key.
 *
 * The same shape burned `crm.email.status.complained`, whose absence rendered a
 * key on a card — `emailSendStatus.ts` records it — and five components have
 * since hand-rolled a local `tr` to work around it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO IMPORTS, DELIBERATELY
 *
 * Client components need this, and a module that reaches a server-only import
 * takes the service-role Supabase client into the browser bundle. That happened
 * once already and stopped the platform loading. `t` is passed in rather than
 * read from context for the same reason: nothing here depends on React.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** A `t`-shaped function: a key in, a string out, the key back on a miss. */
export type Translate = (key: string) => string;

/**
 * The translation, or `null` when the key is missing.
 *
 * Detected by comparing against the key, which is exactly what `t()` returns on
 * a miss. An empty string is also treated as missing: a blank translation
 * renders as nothing, which is never what a caller wanted.
 */
export function translated(t: Translate, key: string): string | null {
  const value = t(key);
  if (!value || value === key) return null;
  return value;
}

/**
 * The first key that actually has a translation.
 *
 * This is the shape the broken `||` chains were reaching for — a short form
 * where one exists, the long form otherwise — and it now behaves that way:
 *
 *     firstTranslated(t, `crm.next.badge.${state}`, `crm.next.${state}`)
 *
 * Returns `null` when none of them resolve, so the caller can choose between a
 * hard-coded fallback and rendering nothing. It never returns a key.
 */
export function firstTranslated(t: Translate, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = translated(t, key);
    if (value) return value;
  }
  return null;
}
