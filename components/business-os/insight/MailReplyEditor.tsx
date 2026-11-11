'use client';

/**
 * A small rich-text editor for one reply, and the serialiser that makes it safe.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT LEAVES THIS COMPONENT IS NOT HTML
 *
 * The owner composes in a `contentEditable`, so the DOM here holds real markup —
 * and a `contentEditable` will accept anything a paste brings with it: style
 * attributes, spans, tables, scripts from a copied web page. Posting that to the
 * server would mean the server parsing and sanitising markup it did not write,
 * on a path that ends in a client's inbox.
 *
 * So `serializeEditor` walks the DOM and produces the RESTRICTED structure in
 * `lib/business-os/mail/replyBody` — paragraphs and list items, each a run of
 * text carrying at most bold, italic and a link. Everything else is discarded on
 * the way out: a pasted `<table>` contributes its text and nothing more. The
 * server then renders HTML from that structure, escaping every character the
 * owner typed, so no byte of user input is ever interpreted as markup.
 *
 * The practical consequence is worth stating: the editor is allowed to be
 * permissive, because the serialiser is the gate. Nothing about what the DOM
 * tolerates can widen what gets sent.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `document.execCommand` IS DEPRECATED AND IS STILL THE RIGHT CHOICE HERE
 *
 * It is the only API that applies bold, italics and lists to a selection in one
 * call, across browsers, with the selection and the undo stack left intact. The
 * alternative is a Selection/Range implementation of the same four operations,
 * which is a well-known way to lose a weekend and still mishandle a selection
 * that spans a list boundary.
 *
 * The deprecation is a documented status, not a removal: every current engine
 * implements it, and the risk of a browser dropping it is carried by a handful
 * of calls in one file rather than spread through the app. If it ever does go,
 * the serialiser and the renderer are unaffected — only `apply` below changes.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module components/business-os/insight/MailReplyEditor
 */

import { useEffect, useRef } from 'react';
import { Bold, Italic, List } from 'lucide-react';
import type { ReplyBlock, ReplyRun } from '@/lib/business-os/mail/replyBody';

export interface MailReplyEditorProps {
  /** Seeds the editor once, on mount. Plain text; newlines become paragraphs. */
  initialText?: string | null;
  placeholder: string;
  disabled?: boolean;
  /** Fires on every edit, so the caller can enable or disable its send button. */
  onInput?: () => void;
  /** The editor's root, so the caller can serialise it and insert links. */
  editorRef: React.MutableRefObject<HTMLDivElement | null>;
  /**
   * The "add a link" control, rendered INSIDE the toolbar.
   *
   * Passed in rather than built here, because the list of links is the
   * caller's business — it is fetched per business, from that owner's own
   * services — while WHERE the control sits is the editor's. The alternative
   * was the editor fetching links itself, which would tie a text editor to the
   * booking catalogue.
   */
  linkControl?: React.ReactNode;
  t: (key: string) => string;
}

/** The inline tags the serialiser understands. Everything else is unwrapped. */
const MARKS: Record<string, keyof Pick<ReplyRun, 'bold' | 'italic'>> = {
  B: 'bold',
  STRONG: 'bold',
  I: 'italic',
  EM: 'italic',
};

/**
 * Walk one block's children into runs, carrying marks down the tree.
 *
 * Adjacent runs with identical marks are merged, because a browser splits text
 * nodes freely as you type and the unmerged output is a dozen one-character
 * runs that render identically and compare as different.
 */
function runsFrom(node: Node, inherited: Partial<ReplyRun> = {}): ReplyRun[] {
  const out: ReplyRun[] = [];

  const push = (run: ReplyRun) => {
    if (!run.text) return;
    const last = out[out.length - 1];
    if (
      last &&
      !!last.bold === !!run.bold &&
      !!last.italic === !!run.italic &&
      last.href === run.href
    ) {
      last.text += run.text;
      return;
    }
    out.push(run);
  };

  node.childNodes.forEach(child => {
    if (child.nodeType === Node.TEXT_NODE) {
      push({ ...inherited, text: child.textContent ?? '' });
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;

    const el = child as HTMLElement;

    /* A line break inside a paragraph is a space once the mail is laid out;
       the block structure is what carries real line breaks. */
    if (el.tagName === 'BR') {
      push({ ...inherited, text: ' ' });
      return;
    }

    const next: Partial<ReplyRun> = { ...inherited };
    const mark = MARKS[el.tagName];
    if (mark) next[mark] = true;
    if (el.tagName === 'A') {
      const href = el.getAttribute('href');
      if (href) next.href = href;
    }

    /* Unknown elements contribute their CONTENT and nothing else — this is
       where a pasted table, span or script stops being markup. */
    runsFrom(el, next).forEach(push);
  });

  return out;
}

/**
 * The editor's DOM, as the restricted structure the server will render.
 *
 * Exported separately from the component so the send path can call it without
 * the editor having to push state upward on every keystroke.
 */
export function serializeEditor(root: HTMLElement | null): ReplyBlock[] {
  if (!root) return [];
  const blocks: ReplyBlock[] = [];

  const addList = (list: HTMLElement, kind: 'ul' | 'ol') => {
    list.querySelectorAll(':scope > li').forEach(li => {
      blocks.push({ type: 'li', list: kind, runs: runsFrom(li) });
    });
  };

  root.childNodes.forEach(child => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? '';
      if (text.trim()) blocks.push({ type: 'p', runs: [{ text }] });
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;

    const el = child as HTMLElement;
    if (el.tagName === 'UL') return addList(el, 'ul');
    if (el.tagName === 'OL') return addList(el, 'ol');

    blocks.push({ type: 'p', runs: runsFrom(el) });
  });

  return blocks;
}

/** Plain text — an agent draft, or a suggestion — as starting paragraphs. */
export function blocksFromPlainText(text: string): ReplyBlock[] {
  return text
    .split(/\n/)
    .map(line => ({ type: 'p' as const, runs: line ? [{ text: line }] : [] }));
}

export function MailReplyEditor({
  initialText,
  placeholder,
  disabled,
  onInput,
  editorRef,
  linkControl,
  t,
}: MailReplyEditorProps) {
  const seeded = useRef(false);

  /*
   * Seeded ONCE, imperatively.
   *
   * A `contentEditable` cannot be a controlled React input: writing to
   * `innerHTML` on every render destroys the caret, and the caret is the thing
   * the owner is using. React owns the element; the content inside it is the
   * DOM's, and `serializeEditor` is how it comes back out.
   */
  useEffect(() => {
    const node = editorRef.current;
    if (!node || seeded.current) return;
    seeded.current = true;

    if (initialText) {
      node.innerHTML = initialText
        .split(/\n/)
        .map(line => `<p>${line ? escapeForSeed(line) : '<br>'}</p>`)
        .join('');
    } else {
      node.innerHTML = '<p><br></p>';
    }
  }, [initialText, editorRef]);

  /*
   * `execCommand` returns focus to the editor itself, so the toolbar buttons
   * must not take it in the first place — `onMouseDown` + `preventDefault`
   * keeps the selection the owner made.
   */
  const apply = (command: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false);
    onInput?.();
  };

  const buttons: Array<{ key: string; command: string; icon: typeof Bold; label: string }> = [
    { key: 'bold', command: 'bold', icon: Bold, label: t('gaps.reply.bold') },
    { key: 'italic', command: 'italic', icon: Italic, label: t('gaps.reply.italic') },
    { key: 'list', command: 'insertUnorderedList', icon: List, label: t('gaps.reply.bullets') },
  ];

  return (
    <div>
      <div className="flex items-center gap-0.5 mb-1">
        {buttons.map(({ key, command, icon: Icon, label }) => (
          <button
            key={key}
            type="button"
            title={label}
            aria-label={label}
            disabled={disabled}
            onMouseDown={event => event.preventDefault()}
            onClick={() => apply(command)}
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-bg)] transition-colors disabled:opacity-40"
          >
            <Icon className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        ))}
        {/*
          The link control sits with the other formatting controls, because
          inserting a link IS formatting — it was below the box, next to the
          send button, where it read as a second action rather than a tool.
        */}
        {linkControl && (
          <>
            <span
              className="w-px h-4 mx-1"
              style={{ background: 'var(--v2-border)' }}
              aria-hidden="true"
            />
            {linkControl}
          </>
        )}
      </div>

      {/*
        `unicode-bidi: plaintext` for the reason the rest of this card uses it:
        the owner may be writing Hebrew while quoting an English sentence, and
        each paragraph should lay out by its own language without dragging the
        box's alignment with it.

        `[&_p]:min-h-[1.2em]` keeps an empty paragraph tall enough to click
        into — a blank line the owner left is a line they may want to type on.
      */}
      <div
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={placeholder}
        data-placeholder={placeholder}
        onInput={() => onInput?.()}
        className="w-full rounded-lg p-2 text-[12.5px] leading-relaxed min-h-[84px] max-h-[260px] overflow-y-auto outline-none [&_p]:min-h-[1.2em] [&_ul]:ps-5 [&_ul]:list-disc [&_a]:underline"
        style={{
          background: 'var(--v2-surface)',
          color: 'var(--v2-text-primary)',
          border: '1px solid var(--v2-border)',
          unicodeBidi: 'plaintext',
        }}
      />
    </div>
  );
}

/**
 * Seed text, escaped before it is written as `innerHTML`.
 *
 * The seed is an agent draft, which is model output rather than owner input —
 * but it is still text being turned into markup, and the one rule this file
 * keeps is that no text becomes markup by accident.
 */
function escapeForSeed(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
