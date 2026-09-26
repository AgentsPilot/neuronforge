/**
 * Small, pure rules of the Businesses list (admin reorganisation slice 4).
 * Client-safe: no imports.
 */

/**
 * Whether a login has a person's name. `profiles.full_name` is `null` until the
 * owner saves one in Settings (signup never writes it), and the Settings form
 * can save `''`; a whitespace-only value is no name either.
 */
export function hasPersonName(fullName: string | null | undefined): fullName is string {
  return typeof fullName === 'string' && fullName.trim().length > 0;
}

/** The list's status filter. The list route accepts exactly these three. */
export type StatusFilter = 'all' | 'active' | 'inactive';

/** Narrow a `<select>` value without a cast (SA C-15 (d)); anything unknown is `'all'`. */
export function toStatusFilter(value: string): StatusFilter {
  return value === 'active' || value === 'inactive' ? value : 'all';
}

/**
 * The route's `stats.totalUsers` is the FILTERED count, so "total" is only true
 * under "All users" (SA C-15 (a)). The card and the header pill say "shown"
 * otherwise.
 */
export function countLabels(filter: StatusFilter): { card: string; pill: string } {
  if (filter === 'active') return { card: 'Users shown (active)', pill: 'shown' };
  if (filter === 'inactive') return { card: 'Users shown (inactive)', pill: 'shown' };
  return { card: 'All users', pill: 'total' };
}

/**
 * How the Active badge beside the name is coloured.
 *
 * DECIDED (user, 2026-09-26, U-7 / SA C-17): `'neutral'` — the Active badge is
 * never green, anywhere. It sits beside the name, so a green "Active" next to a
 * red "No name" was the contradiction the user reported. The email-verified
 * tick stays green (also the user's choice): it sits by the email, not the name.
 *
 * The other two modes are kept as options and stay tested:
 *   'green'               a green Active badge on every row (the old styling);
 *   'neutral-on-no-name'  non-green only on rows with no name.
 * `userNameLine.render.test.tsx` pins that the active value is `'neutral'`.
 */
export type ActiveBadgeMode = 'green' | 'neutral' | 'neutral-on-no-name';
export const ACTIVE_BADGE_MODE: ActiveBadgeMode = 'neutral';
