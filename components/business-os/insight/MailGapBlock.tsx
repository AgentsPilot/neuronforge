'use client';

/**
 * A waiting message, drawn the same way wherever it appears.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A COMPONENT AND NOT MARKUP INSIDE THE CARD
 *
 * `NeedsYouCard` draws a task TWICE, in two unrelated pieces of markup: the
 * promoted row at the top, and the rows inside the fold. Which one an owner is
 * looking at is decided by `mostUrgent`, and they cannot influence it — one
 * reply-waiting row is the headline, and the next is in the fold because an
 * invoice happened to outrank it that morning.
 *
 * So when the mail facts were added they were added twice, drifted immediately,
 * and the card's usefulness became a lottery: the same client waiting in the
 * same way showed their words and the agent's reasoning in one position, and a
 * subject line beside a clock in the other. This is the third round of fixing
 * that by hand, which is two more than the pattern deserves.
 *
 * One block, both positions. `dense` changes how much of it is shown, never
 * which facts exist.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * The headline sentence and the action buttons. Both already differ by position
 * for good reasons — the promoted row confirms irreversible sends inline and
 * tracks its own working/done state — and pulling them in would mean this
 * component owning the card's whole interaction model. It owns the READING of a
 * message, which is the part that was wrong in both places.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module components/business-os/insight/MailGapBlock
 */

import { Bot, Mail } from 'lucide-react';

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BLOCK ALIGNS WITH THE CARD; THE TEXT ORDERS ITSELF.
 *
 * Two different questions, and every single-property answer gets one of them
 * wrong:
 *
 *   dir="auto"                sets the element's DIRECTION from its content, so
 *                             an English quote became a left-aligned block under
 *                             a right-aligned Hebrew label.
 *
 *   unicode-bidi: plaintext   resolves each paragraph by its own content, which
 *   on the block               is correct for ordering — and ALSO derives the
 *                             paragraph direction, so the English line still
 *                             aligned left. Better, same symptom.
 *
 * So the two are split. The block keeps the card's inherited direction and
 * `text-align: start`, which is the right edge in Hebrew whatever language the
 * text happens to be in. The inner span carries `unicode-bidi: plaintext`, so
 * the characters order themselves and the trailing punctuation and ellipsis
 * land at the correct end — without the inline being able to move the block it
 * sits in.
 *
 * The result is what an owner expects of a Hebrew card: every line starts at
 * the same edge, and an English sentence still reads as English.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const ALIGNS_WITH_THE_CARD = { textAlign: 'start' } as const;
const READS_IN_ITS_OWN_LANGUAGE = { unicodeBidi: 'plaintext' } as const;

export interface MailGapBlockProps {
  /** The thread's subject — what the owner recognises it by. */
  subject?: string | null;
  /** The client's own words, as the agent copied them. */
  quote?: string | null;
  /** The agent's reading of what was asked, and what it would have needed. */
  note?: string | null;
  /** The mail thread to open, where one was recorded. */
  threadId?: string | null;
  /** Translation key for where this row came from. */
  contextKey?: string | null;
  /** When it arrived, already formatted by the caller in the owner's locale. */
  when?: string | null;
  /**
   * Tighter, for a row inside the fold.
   *
   * Changes the clamp and the type scale only. A dense row that silently
   * dropped the explanation is exactly the drift this component exists to
   * stop.
   */
  dense?: boolean;
  t: (key: string) => string;
}

export function MailGapBlock({
  subject,
  quote,
  note,
  threadId,
  contextKey,
  when,
  dense = false,
  t,
}: MailGapBlockProps) {
  /* Nothing mail-shaped to show: the caller renders whatever it did before. */
  if (!subject && !quote) return null;

  const noteIsNew = note && note !== subject;

  return (
    <div className={dense ? 'mt-1.5' : 'mb-2.5'}>
      {/*
        WHO FOUND THIS, AS A BADGE RATHER THAN A SENTENCE.

        The sentence alone was already on the row and read as one more piece of
        metadata in a muted strip. An owner did not create this task and no
        form produced it; until the attribution is legible WITHOUT being read,
        the row looks like something the system invented about them.
      */}
      {contextKey && (
        <p className="flex items-center gap-1.5 flex-wrap text-[11.5px] mb-1.5 text-[var(--v2-text-secondary)]">
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
            style={{
              /* A TINT of the primary, not the solid fill the action button
                 uses: this names an author, it is not a thing to press. An
                 unsupported `color-mix` is dropped inline, where as a Tailwind
                 class it would repaint the pill solid indigo. */
              background: 'color-mix(in srgb, var(--v2-primary) 13%, transparent)',
              color: 'var(--v2-primary)',
            }}
          >
            <Bot className="w-3 h-3" aria-hidden="true" />
            {t('gaps.from.agent_badge')}
          </span>
          <span>{t(contextKey)}</span>
          {when && (
            <>
              <span aria-hidden="true" className="text-[var(--v2-text-muted)]">·</span>
              <span className="text-[var(--v2-text-muted)]">{when}</span>
            </>
          )}
        </p>
      )}

      {/*
        THE MESSAGE. Everything in here was written by somebody else.

        `border-s-2` and `ps-*` are LOGICAL, so the rail sits on the right in
        Hebrew with no second rule.
      */}
      <div
        className={`rounded-lg border-s-2 ${dense ? 'ps-2 pe-2 py-1.5' : 'ps-2.5 pe-2.5 py-2'}`}
        style={{
          background: 'var(--v2-bg)',
          borderInlineStartColor: 'color-mix(in srgb, var(--v2-primary) 45%, transparent)',
        }}
      >
        <p
          className="text-[10.5px] font-semibold mb-1 flex items-center gap-1"
          style={{ color: 'var(--v2-text-muted)' }}
        >
          <Mail className="w-3 h-3" aria-hidden="true" />
          {t('gaps.message.wrote')}
        </p>

        {/*
          ─────────────────────────────────────────────────────────────────
          EACH PART NAMED, because two quoted lines in a box are ambiguous.

          The block header says these are the client's words; it does not say
          WHICH of the two lines is the subject and which is what they wrote.
          On a thread whose subject is itself a sentence — and a reply subject
          usually is — the two read as one run-on quotation, and an owner has
          to work out the boundary from punctuation.

          Set in the owner's interface language, not the client's: these are
          our labels for their fields, so they stay put while the text beside
          them changes language with the sender.
          ─────────────────────────────────────────────────────────────────
        */}
        {subject && (
          <>
            <p className="text-[10px] font-semibold" style={{ color: 'var(--v2-text-muted)' }}>
              {t('gaps.message.subject')}
            </p>
            {/*
              Bidi handling on every line the CLIENT supplied — see
              READS_IN_ITS_OWN_LANGUAGE above. These are in whatever language
              they wrote in, so a Hebrew card routinely carries an English
              sentence, and a plain RTL block would lay it out right-to-left
              and put the ellipsis at the START, trimming away the half that
              said what they wanted.
            */}
            <p
              style={ALIGNS_WITH_THE_CARD}
              className="text-[12.5px] font-medium text-[var(--v2-text-primary)] line-clamp-2"
            >
              <span style={READS_IN_ITS_OWN_LANGUAGE}>{subject}</span>
            </p>
          </>
        )}

        {quote && (
          <>
            <p
              className="text-[10px] font-semibold mt-1.5"
              style={{ color: 'var(--v2-text-muted)' }}
            >
              {t('gaps.message.content')}
            </p>
            <p
              className={`${dense ? 'text-[12px] line-clamp-2' : 'text-[13px] line-clamp-4'} leading-relaxed text-[var(--v2-text-primary)]`}
              style={{ fontStyle: 'italic', ...ALIGNS_WITH_THE_CARD }}
            >
              <span style={READS_IN_ITS_OWN_LANGUAGE}>{`"${quote}"`}</span>
            </p>
          </>
        )}

        {/*
          The way into the actual conversation — attachments, what was said
          three messages ago, the other person on cc. A plain link rather than
          a fetch-and-render: the mail already has a reader and the owner is
          signed into it.

          `authuser` is deliberately NOT pinned to an index. `/mail/u/0/` opens
          whichever account is first in that browser, which on a machine with
          two Google accounts is the wrong mailbox.

          Only where a thread id was recorded. Rows filed before the column
          existed get no link rather than one landing on an empty search.
        */}
        {threadId && (
          <a
            href={`https://mail.google.com/mail/#all/${encodeURIComponent(threadId)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-1.5 text-[11.5px] font-semibold hover:underline"
            style={{ color: 'var(--v2-primary)' }}
          >
            <Mail className="w-3 h-3" aria-hidden="true" />
            {t('gaps.message.open_mail')}
          </a>
        )}
      </div>

      {/*
        THE AGENT'S READING, OUTSIDE THE BLOCK.

        Two different authors must not share one container: the client's
        sentences and the agent's note about them, in the same tinted box with
        the same rail, left a reader unable to tell which half somebody else
        had written.

        Below, because this is the order the task actually has — what they
        asked first, why it reached you second. The owner is deciding how to
        answer a person, not auditing the agent.
      */}
      {noteIsNew && (
        <p
          style={ALIGNS_WITH_THE_CARD}
          className={`${dense ? 'text-[11.5px] line-clamp-2' : 'text-[12px] line-clamp-3'} leading-relaxed text-[var(--v2-text-secondary)] mt-1.5`}
        >
          <span className="font-semibold text-[var(--v2-text-muted)]">
            {t('gaps.message.why')}{' '}
          </span>
          {/* The agent's note is in the OWNER's language now, but the span
              costs nothing and keeps every client-facing line consistent. */}
          <span style={READS_IN_ITS_OWN_LANGUAGE}>{note}</span>
        </p>
      )}
    </div>
  );
}
