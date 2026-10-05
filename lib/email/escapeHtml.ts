// lib/email/escapeHtml.ts
// The one HTML escaper every email template uses.

/**
 * Escape text for HTML: element text, or an attribute value in double quotes.
 *
 * Escapes `&`, `<`, `>`, `"` and `'`. `&` goes first so the entities written
 * by the later replacements are not escaped a second time.
 *
 * Seven templates each had a private copy of this function (found in PR #171).
 * One of them, `consent-confirmation`, left out `'`. That made no difference in
 * a double-quoted attribute or in element text, but it was a copy that had
 * already drifted from the rest. Now there is one copy.
 *
 * NOT idempotent: escaping `&amp;` gives `&amp;amp;`. Escape a value once, at
 * the point where it goes into the markup. The helpers in `base-template.ts`
 * expect text and labels already escaped by the caller (see the note there).
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Make a URL safe to place inside a double-quoted `href="…"`, without touching
 * a URL that is already safe there.
 *
 * Only `"`, `<` and `>` are replaced. A well-formed URL never contains them
 * raw (RFC 3986 requires them percent-encoded), so every valid URL passes
 * through byte for byte. A URL that was already HTML-escaped also passes
 * through unchanged, because escaping removes those three characters. So this
 * can run on caller input that may or may not be escaped, without
 * double-escaping either kind.
 *
 * `&` is left alone on purpose. Escaping it would turn a caller's `&amp;` into
 * `&amp;amp;`. A raw `&` in an attribute is tolerated by every mail client.
 *
 * This guards the attribute only: it stops a value from closing the quote and
 * adding markup. It does NOT check the scheme. Callers that take a URL from
 * outside keep their own scheme check (for example `safeHref` in
 * `invite-existing-account.ts`, or `safeExternalUrl` in `lib/email/branding.ts`).
 */
export function escapeHrefAttribute(url: string): string {
  return url.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
