// lib/email/htmlToText.ts
// D12: the ONE shared, dependency-free HTML→plaintext converter for email.
//
// Extracted from lib/notifications/emailTransport.ts (added in D9) so every email
// send path — the notification transport, the Gmail plugin executor, the contact
// form, and the V1 sender — derives its plaintext MIME part from the SAME logic,
// and multipart/alternative can never fragment or duplicate again.

/**
 * Derive a readable plaintext alternative from an HTML document. Deliberately
 * dependency-free (no html-to-text lib): drop non-content elements, turn block-level
 * boundaries into newlines, strip the remaining tags, decode the common entities,
 * and collapse whitespace. Good enough for a plaintext MIME part; the HTML part
 * remains the primary render.
 */
export function htmlToText(html: string): string {
  if (!html) return '';
  return html
    /*
     * COMMENTS FIRST, before anything else touches the markup.
     *
     * The tag strip below is `<[^>]+>`, which stops at the first `>` it meets.
     * Inside a comment that `>` is usually part of the prose — `Gmail rewrites
     * <body> into a <div>` — so the comment was chopped at that point and its
     * remainder survived as body copy.
     *
     * The templates in this repository are heavily commented, so the plaintext
     * MIME part of real emails went out reading "into a and several clients
     * drop its styles outright, so content that sets no colour of its own…".
     * That is internal commentary in front of a client, and a text part that
     * does not match the HTML part is a well-known spam signal.
     *
     * Conditional comments (`<!--[if mso]> … <![endif]-->`) are the same shape
     * and go the same way.
     */
    .replace(/<!--[\s\S]*?-->/g, '')
    // Remove elements whose text content is not human-readable body copy.
    .replace(/<(style|script|head|title)[^>]*>[\s\S]*?<\/\1>/gi, '')
    // Line breaks and block boundaries → newlines.
    .replace(/<br\s*\/?>(?=\s*)/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|thead|tbody|section|header|footer|ul|ol)>/gi, '\n')
    // Strip all remaining tags.
    .replace(/<[^>]+>/g, '')
    // Decode the entities our templates actually emit.
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    // Collapse whitespace: trim each line, cap consecutive blank lines.
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
