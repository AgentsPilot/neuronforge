/**
 * The settings address with only `section` taken off (settings drawer review,
 * C-3 / SA-2).
 *
 * A drawer opened BY A LINK (`?section=plan`) has to drop `section` when it
 * closes, or a reload would reopen it. Nothing else may go: `checkout` is the
 * plan-checkout return marker (C-11) and `tab` belongs to whoever sent it, so
 * this deletes one key and leaves the rest, in their order, untouched.
 *
 * Takes anything with a `toString()` (URLSearchParams, Next's read-only search
 * params) so it needs no type import from `next/navigation` (SA O-2).
 */
export function settingsUrlWithoutSection(
  pathname: string,
  params: { toString(): string } | null | undefined
): string {
  const remaining = new URLSearchParams(params?.toString() ?? '');
  remaining.delete('section');
  const query = remaining.toString();
  return query ? `${pathname}?${query}` : pathname;
}
