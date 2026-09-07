/**
 * The business's own website address, made safe to put in an `href`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * `business_profiles.website_url` is rendered as a link on public pages
 * (`BusinessInfoPanel`), in email branding, and as the "book again" target of a
 * booking email. Until now nothing could write the column — onboarding stopped
 * asking for the address and the settings screen showed it read-only — so it
 * was always null and those links never rendered.
 *
 * Giving it a writer makes those code paths reachable for the first time, with
 * a value the owner typed. An `href` built from unchecked text is how
 * `javascript:` ends up on a customer-facing page, so the value is parsed
 * rather than trusted, and anything that is not http(s) is dropped entirely.
 *
 * A bare domain is what people actually type — `example.com`, not
 * `https://example.com`. Rejecting that would be technically correct and
 * useless, so it is upgraded to https rather than refused.
 *
 * Returns null rather than throwing: a business with a mistyped website should
 * lose the link, not the page.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * A URL fit for an `href`, or null.
 *
 * @param value what the owner typed, or whatever is in the column
 */
export function safeExternalUrl(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  /*
   * Something with a scheme is taken at its word and then checked; anything
   * else is assumed to be a bare host. `//example.com` counts as schemeless and
   * would otherwise inherit the page's protocol.
   *
   * This deliberately reads `example.co.il:8080` as a scheme and therefore
   * drops it. Nothing can distinguish a bare host:port from an unknown scheme
   * by shape alone, and the two errors are not equal: refusing a website on an
   * explicit port costs one rare business a link, while admitting an unknown
   * scheme puts it in an href on a customer's screen. Owners who need a port
   * can type the https:// themselves.
   */
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
  const candidate = hasScheme ? raw : `https://${raw.replace(/^\/+/, '')}`;

  try {
    const url = new URL(candidate);

    // The whole point. `javascript:`, `data:`, `vbscript:` and `file:` all
    // parse perfectly well and none of them belong in a link we publish.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

    // A scheme with no host — `https:///foo` — parses but points nowhere.
    if (!url.hostname) return null;

    return url.toString();
  } catch {
    return null;
  }
}
