/**
 * Renders a privacy notice held as Markdown.
 *
 * Deliberately NOT a general Markdown renderer, and deliberately not
 * `dangerouslySetInnerHTML`. The body it renders is written by the business
 * owner and served on a public page, so anything that turns their text into
 * markup turns a text field in a settings panel into stored XSS on every
 * visitor's browser. Everything here goes through React as text.
 *
 * It handles what `lib/consent/privacyPolicy.ts` emits and what an owner
 * plausibly types: headings, bullets, bold, italics, rules, paragraphs.
 * Anything else renders as the literal characters, which is the right failure:
 * visible and harmless.
 *
 * @module components/public/PrivacyNotice
 */

import React from 'react';

/** `**bold**` and `*italic*`, as text nodes. No raw HTML, ever. */
function inline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith('**')) {
      out.push(<strong key={`${keyPrefix}-b${i++}`}>{token.slice(2, -2)}</strong>);
    } else {
      out.push(<em key={`${keyPrefix}-i${i++}`}>{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function PrivacyNotice({ body }: { body: string }) {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];

  let paragraph: string[] = [];
  let bullets: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const key = `p-${blocks.length}`;
    blocks.push(
      <p key={key} className="ap-privacy-p">
        {inline(paragraph.join(' '), key)}
      </p>
    );
    paragraph = [];
  };

  const flushBullets = () => {
    if (!bullets.length) return;
    const key = `ul-${blocks.length}`;
    blocks.push(
      <ul key={key} className="ap-privacy-ul">
        {bullets.map((item, idx) => (
          <li key={`${key}-${idx}`}>{inline(item, `${key}-${idx}`)}</li>
        ))}
      </ul>
    );
    bullets = [];
  };

  const flushAll = () => {
    flushParagraph();
    flushBullets();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) {
      flushAll();
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      flushAll();
      blocks.push(<hr key={`hr-${blocks.length}`} className="ap-privacy-hr" />);
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      const key = `h-${blocks.length}`;
      const content = inline(heading[2], key);
      blocks.push(
        level === 1 ? (
          <h1 key={key} className="ap-privacy-h1">{content}</h1>
        ) : level === 2 ? (
          <h2 key={key} className="ap-privacy-h2">{content}</h2>
        ) : (
          <h3 key={key} className="ap-privacy-h3">{content}</h3>
        )
      );
      continue;
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      // A bullet ends a paragraph but continues a list.
      flushParagraph();
      bullets.push(bullet[1]);
      continue;
    }

    // An indented line under a bullet is a continuation of it, not a new
    // paragraph — the generated notice wraps long bullets that way.
    if (bullets.length && /^\s{2,}\S/.test(raw)) {
      bullets[bullets.length - 1] += ` ${line.trim()}`;
      continue;
    }

    flushBullets();
    paragraph.push(line.trim());
  }

  flushAll();

  return <div className="ap-privacy">{blocks}</div>;
}
