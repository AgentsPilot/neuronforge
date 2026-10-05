/**
 * Remove developer comments from outgoing email HTML.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY
 *
 * The templates carry long design notes as `<!-- … -->` comments. A mail client
 * does not render them, but anyone who opens "Show original" reads them, and
 * they are internal commentary sent to every client of every business
 * (invite-only signup Slice 3a, E-1; SA ruling Q-7: every wrapped email).
 *
 * WHAT IS KEPT, BYTE FOR BYTE
 *
 * Conditional comments are instructions to Outlook, not notes:
 *
 *   - the hidden form, `<!--[if mso]> … <![endif]-->`, kept whole (its content
 *     is only for the clients the condition names);
 *   - the downlevel-revealed opener `<!--[if !mso]><!-->` and its closer
 *     `<!--<![endif]-->`, kept as markers. The content between them is ordinary
 *     markup every client renders, so comments inside it are still removed.
 *
 * An unterminated `<!--` is left alone: there is no comment to remove, and
 * guessing where one ends could delete real content.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/email/htmlComments
 */

/*
 * One pass, alternatives in priority order. The downlevel-revealed opener must
 * be tried before the hidden block, which would otherwise match from that
 * opener to the revealed closer and keep everything between them verbatim.
 */
const COMMENT =
  /(<!--\[if[^\]]*\]><!-->)|(<!--<!\[endif\]-->)|(<!--\[if[^\]]*\]>[\s\S]*?<!\[endif\]-->)|<!--[\s\S]*?-->/g;

export function stripHtmlComments(html: string): string {
  if (!html || !html.includes('<!--')) return html;
  return html.replace(COMMENT, (match, revealedOpen?: string, revealedClose?: string, hidden?: string) =>
    revealedOpen || revealedClose || hidden ? match : ''
  );
}
