/**
 * The owner's formatted reply, turned into mail that is safe by construction.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SERVER NEVER PARSES HTML IT DID NOT WRITE
 *
 * The reply box is a small rich-text editor, so what the owner composes has
 * bold, italics, bullets and links in it. The obvious route — post that HTML and
 * sanitise it server-side — means running an HTML parser over attacker-shaped
 * input and trusting the result, on a path whose output lands in a client's
 * inbox. It also wants a sanitiser dependency, and neither `dompurify` nor
 * `jsdom` is a production dependency of this app; both arrive transitively,
 * through tooling.
 *
 * So the editor sends a RESTRICTED STRUCTURE instead — paragraphs and list
 * items, each a sequence of text runs carrying at most bold, italic and a link
 * — and this module renders the HTML. Nothing the owner types is ever
 * interpreted as markup: every character of their text goes through
 * `escapeHtml`, and every tag in the output was written here.
 *
 * That turns "did we sanitise it correctly" into "can this function emit
 * anything unexpected", which is a question a test can answer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BOTH HALVES ARE SENT
 *
 * `renderHtml` and `renderText` are produced from the same blocks, because a
 * `multipart/alternative` reply needs both and they must say the same thing. A
 * client reading plain text sees the link as a bare address, which is the one
 * place the two legitimately differ.
 *
 * @module lib/business-os/mail/replyBody
 */

/** One run of text, with at most the marks the toolbar can apply. */
export interface ReplyRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  /** Absolute http(s) address. Anything else is dropped — see `safeHref`. */
  href?: string;
}

/** A paragraph, or one item of a list. */
export interface ReplyBlock {
  type: 'p' | 'li';
  /** Only meaningful on `li`. Defaults to an unordered list. */
  list?: 'ul' | 'ol';
  runs: ReplyRun[];
}

/**
 * The five characters that can end a text node and start markup.
 *
 * `'` and `"` are escaped as well as the three obvious ones, because runs are
 * also interpolated into the `href` attribute below, where a bare quote would
 * close it.
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
 * An address we are willing to put in front of a client, or nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONLY `http:` AND `https:`. The attack this closes is not theoretical and not
 * exotic: `javascript:` in an href is the oldest one there is, and `data:` URLs
 * carry whole documents. Neither has any business in a reply to a customer.
 *
 * Parsed with `URL` rather than matched with a regular expression, so the
 * decision is made by the same parser the browser will use. A string that does
 * not parse is not a link, and is dropped rather than guessed at — a reply
 * carrying a mangled address is worse than one carrying none, because the
 * client clicks it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function safeHref(href: unknown): string | undefined {
  if (typeof href !== 'string' || !href.trim()) return undefined;
  try {
    const parsed = new URL(href.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function renderRun(run: ReplyRun): string {
  /* Text first, escaped, before any tag is wrapped around it. */
  let html = escapeHtml(String(run.text ?? ''));
  if (!html) return '';

  if (run.bold) html = `<strong>${html}</strong>`;
  if (run.italic) html = `<em>${html}</em>`;

  const href = safeHref(run.href);
  if (href) {
    /* `rel` on every outbound link: these are read in a mail client, and the
       owner is linking to their own booking page, not vouching for a target. */
    html = `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${html}</a>`;
  }
  return html;
}

/**
 * The HTML half of the reply.
 *
 * Consecutive `li` blocks of the same kind are gathered into one list, because
 * the editor emits them one at a time and a run of single-item lists is both
 * wrong and visibly wrong in a mail client.
 */
export function renderHtml(blocks: ReplyBlock[]): string {
  const out: string[] = [];
  let openList: 'ul' | 'ol' | null = null;

  const closeList = () => {
    if (openList) {
      out.push(`</${openList}>`);
      openList = null;
    }
  };

  for (const block of blocks) {
    const inner = (block.runs ?? []).map(renderRun).join('');

    if (block.type === 'li') {
      const kind = block.list === 'ol' ? 'ol' : 'ul';
      if (openList !== kind) {
        closeList();
        out.push(`<${kind}>`);
        openList = kind;
      }
      out.push(`<li>${inner}</li>`);
      continue;
    }

    closeList();
    /* An empty paragraph is a blank line the owner deliberately left. */
    out.push(inner ? `<p>${inner}</p>` : '<p><br></p>');
  }

  closeList();
  return out.join('');
}

/**
 * The plain-text half, for clients that read it and for our own records.
 *
 * Links become "text (address)" rather than disappearing: in plain text the
 * address is the only way the reader can follow it, and dropping it silently
 * would make the two halves of the same message say different things.
 */
export function renderText(blocks: ReplyBlock[]): string {
  const lines = blocks.map(block => {
    const inner = (block.runs ?? [])
      .map(run => {
        const text = String(run.text ?? '');
        const href = safeHref(run.href);
        if (!href) return text;
        /* A link whose text IS the address does not need it twice. */
        return text.trim() === href.trim() ? href : `${text} (${href})`;
      })
      .join('');

    return block.type === 'li' ? `• ${inner}` : inner;
  });

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Is there anything here worth sending? */
export function isEmpty(blocks: ReplyBlock[]): boolean {
  return renderText(blocks).trim().length === 0;
}
