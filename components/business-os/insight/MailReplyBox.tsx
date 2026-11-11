'use client';

/**
 * Answering the client, on the card, without opening the mailbox.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE WHOLE POINT OF THE ROW
 *
 * Everything above this box is reading: who wrote, what they asked, what the
 * agent made of it. Until now the only move was "open the client", so the owner
 * left for Gmail, found the thread and answered there — and every fact the card
 * had assembled was thrown away at the door.
 *
 * TWO STATES, ONE LAYOUT. An escalation arrives with an empty box; a drafted
 * reply arrives with the agent's text already in it and a button that says so.
 * Deliberately not two components: the second is the first with a value and a
 * different label, and splitting them is how the two halves of this card
 * drifted the last three times.
 *
 * THE DRAFT IS EDITABLE, which is the difference between this and the Gmail
 * draft it mirrors. The owner fixes a word and sends; they do not have to
 * accept the agent's wording to get the benefit of it.
 *
 * NOTHING SENDS ON ONE TAP. Four of this card's other actions put mail in a
 * client's inbox and each asks first; the row's own comment records why. This
 * one asks in the same shape — the button becomes the confirmation — because an
 * unsendable second tap is cheap and an unrecallable first one is not.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module components/business-os/insight/MailReplyBox
 */

import { useRef, useState } from 'react';
import { Send, Check, PenLine, Trash2, Link2, Loader2 } from 'lucide-react';
import { MailReplyEditor, serializeEditor } from './MailReplyEditor';
import { isEmpty as blocksAreEmpty, renderText } from '@/lib/business-os/mail/replyBody';

/** One thing the owner can link to: a service, or the booking page itself. */
export interface ReplyLink {
  label: string;
  url: string;
  kind: 'service' | 'generic';
  isFree: boolean;
  isQuote: boolean;
}

export interface MailReplyBoxProps {
  contactId: string;
  /** The conversation to answer. Without it only "handled" is offered. */
  threadId?: string | null;
  /** The agent's draft object, where it made one. */
  draftId?: string | null;
  /** The agent's proposed text, which seeds the box. */
  draftBody?: string | null;
  /** Shown on the client's timeline so the settling row says what it was. */
  subject?: string | null;
  /** Which mailbox this came from; only Gmail can send from here today. */
  provider?: string | null;
  /**
   * When this person was last answered from the card, if they were.
   *
   * Survives a reload, which the component's own `sent` phase does not. See
   * `GapItem.answeredAt`.
   */
  answeredAt?: string | null;
  /** The owner's locale, for the "answered 20 minutes ago" line. */
  language?: string;
  /** Refetch, so a settled row leaves the card. */
  onDone?: () => void;
  t: (key: string) => string;
}

/**
 * "20 minutes ago", in the owner's language.
 *
 * `Intl.RelativeTimeFormat` rather than a hand-rolled ladder, and the locale is
 * passed in rather than left to the browser: a Hebrew card printed an English
 * clock everywhere this was defaulted, which is the same bug the gap card's
 * `startedOn` carries a comment about.
 */
function relativeWhen(iso: string, language?: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const minutes = Math.round((then - Date.now()) / 60000);
  const locale = language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-GB';
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  if (Math.abs(minutes) < 60) return format.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return format.format(hours, 'hour');
  return format.format(Math.round(hours / 24), 'day');
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'confirming' }
  | { kind: 'working' }
  /** The reply has gone. The row STAYS until the owner clears it. */
  | { kind: 'sent' }
  /** The owner said it is done; the row is about to leave. */
  | { kind: 'cleared' }
  | { kind: 'failed'; message: string };

export function MailReplyBox({
  contactId,
  threadId,
  draftId,
  draftBody,
  subject,
  provider,
  answeredAt,
  language,
  onDone,
  t,
}: MailReplyBoxProps) {
  /*
   * A reply already recorded for this person opens the row in its ANSWERED
   * state, not with a fresh box. The component's own `sent` phase lives in
   * browser memory and does not survive a reload — which is exactly how a
   * client came to be looking at a row that showed no sign of having been
   * answered minutes earlier.
   */
  const [phase, setPhase] = useState<Phase>(
    answeredAt ? { kind: 'sent' } : { kind: 'idle' }
  );

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE REPLY LIVES IN THE EDITOR'S DOM, NOT IN REACT STATE.
   *
   * A `contentEditable` cannot be a controlled input — writing to it on every
   * render destroys the caret the owner is typing with. So the element owns
   * its content, `serializeEditor` reads it out when there is a reason to, and
   * the only thing tracked here is whether there is anything in it at all,
   * which is what the send button needs to know.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [hasText, setHasText] = useState(Boolean(draftBody && draftBody.trim()));

  const readEditor = () => serializeEditor(editorRef.current);
  const noteEdit = () => {
    setHasText(!blocksAreEmpty(readEditor()));
    if (phase.kind === 'confirming' || phase.kind === 'failed') setPhase({ kind: 'idle' });
  };

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE LINKS, FETCHED ONLY IF SOMEBODY ASKS FOR ONE.
   *
   * The commonest reply to a waiting client is a link — "pick a time", "the
   * free consultation is here" — and without one the owner leaves the card to
   * copy an address out of their own booking page, which is the round trip
   * this box exists to remove.
   *
   * Most rows never open this, so the list is loaded on the first press rather
   * than with the card. `null` means not asked yet, which is distinct from an
   * empty array — a business with no bookable service and no booking page gets
   * a menu that says so, not a spinner that never resolves.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const [links, setLinks] = useState<ReplyLink[] | null>(null);
  const [linksOpen, setLinksOpen] = useState(false);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const box = useRef<HTMLTextAreaElement | null>(null);

  const openLinks = async () => {
    setLinksOpen(open => !open);
    if (links || loadingLinks) return;
    setLoadingLinks(true);
    try {
      const response = await fetch('/api/business-os/gaps/links');
      const data = await response.json();
      setLinks(data?.success ? (data.data?.links ?? []) : []);
    } catch {
      setLinks([]);
    } finally {
      setLoadingLinks(false);
    }
  };

  /**
   * Put the link where the caret is, named rather than spelled out.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The owner picked "פגישת היכרות", so that is what the client should see —
   * a 90-character booking URL in the middle of a sentence is noise, and the
   * whole point of a rich editor is that the address can hide behind its name.
   *
   * `insertHTML` rather than building a node by hand, because the caret may sit
   * inside a bold run or a list item and the browser knows how to splice into
   * that. The href is OURS — minted server-side from this business's own
   * services — so there is nothing user-supplied in the markup being inserted.
   * The serialiser reads it back out as a run with an `href`, and the server
   * re-escapes it anyway.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const insertLink = (url: string, label: string) => {
    const node = editorRef.current;
    if (!node) return;
    node.focus();

    const safeLabel = label
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    document.execCommand(
      'insertHTML',
      false,
      `<a href="${encodeURI(url)}">${safeLabel}</a>&nbsp;`
    );

    setLinksOpen(false);
    noteEdit();
  };

  const hasDraft = Boolean(draftBody);
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * A SUGGESTION IS NOT A DRAFT, AND THE BOX MUST NOT PRETEND OTHERWISE.
   *
   * Both arrive as `draftBody`, and they are different claims:
   *
   *   a DRAFT      the agent could answer in full from the service list, and
   *                wrote the reply. A real Gmail draft exists behind it.
   *
   *   a SUGGESTION the agent could NOT answer — it needed the diary, a price,
   *                something only the owner knows — so it wrote a holding reply
   *                that commits to nothing. No Gmail draft exists.
   *
   * `draftId` is the honest discriminator and needs no new field: only the
   * drafting branch creates a draft object. Labelling a suggestion "the agent's
   * draft" would invite the one-glance approval that the draft state is
   * designed for and the suggestion has not earned — this one is a starting
   * point the owner is expected to finish.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const isSuggestion = Boolean(draftBody) && !draftId;
  /*
   * Outlook has `create_draft` and no reply action at all, so a send button on
   * an Outlook row would be a button that cannot work. The box still renders —
   * reading the draft is useful on its own — and the owner is pointed at the
   * mailbox instead.
   */
  const canSend = Boolean(threadId) && provider !== 'outlook';

  const post = async (action: 'send' | 'discard' | 'handled') => {
    setPhase({ kind: 'working' });
    try {
      const response = await fetch('/api/business-os/gaps/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          contactId,
          threadId: threadId ?? undefined,
          draftId: draftId ?? undefined,
          subject: subject ?? undefined,
          provider: provider === 'outlook' ? 'outlook' : 'google-mail',
          /*
           * BLOCKS, not HTML. The server renders the markup itself from this
           * structure — see `lib/business-os/mail/replyBody`. `body` rides
           * along as the plain-text half of the same message.
           */
          ...(action === 'send'
            ? { blocks: readEditor(), body: renderText(readEditor()) }
            : {}),
        }),
      });
      const data = await response.json();

      if (data?.success) {
        /*
         * Only a SETTLING action takes the row away. A send leaves it, because
         * the owner decides when a conversation is finished — see the route.
         * `settled` is the server's answer to that, not an assumption here.
         */
        if (data?.data?.settled) {
          setPhase({ kind: 'cleared' });
          setTimeout(() => onDone?.(), 900);
        } else {
          setPhase({ kind: 'sent' });
        }
        return;
      }
      setPhase({ kind: 'failed', message: data?.error || t('gaps.refused.generic') });
    } catch {
      setPhase({ kind: 'failed', message: t('gaps.refused.generic') });
    }
  };

  const send = () => {
    if (blocksAreEmpty(readEditor())) return;
    if (phase.kind !== 'confirming') {
      setPhase({ kind: 'confirming' });
      return;
    }
    void post('send');
  };

  /*
   * The link menu, built here and rendered by the EDITOR's toolbar.
   *
   * Which links exist is this component's business — they are fetched per
   * business from the owner's own services. Where the control sits is the
   * editor's, and it belongs beside bold and italic: inserting a link is
   * formatting, not a second action competing with Send.
   */
  /*
   * Declared HERE, above `linkControl`, and the order is load-bearing.
   *
   * `linkControl` is a JSX expression evaluated at its own declaration, so it
   * reads `busy` the moment the component body runs — not at render time, the
   * way markup further down does. With the declaration below it the component
   * threw "Cannot access 'busy' before initialization" on first paint, which
   * is the temporal dead zone doing exactly what it says.
   *
   * It only depends on `phase`, so moving it up costs nothing.
   */
  const busy = phase.kind === 'working';

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * A LINK THE OWNER PICKS, NEVER ONE ANYBODY TYPED.
   *
   * Every address here is minted server-side from this business's own services
   * and booking page. The owner chooses a NAME and the URL comes from
   * `resolveBookingUrl` — so the one failure that matters, a plausible-looking
   * booking link that goes nowhere, cannot be produced by this control at all.
   *
   * That is also why the agent is forbidden from writing links (rule 5 of its
   * drafting prompt): a model asked for a booking address invents one. The
   * owner inserting a real one is the other half of that rule, not an
   * exception to it.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const linkControl = (
    <div className="relative">
      <button
        type="button"
        onClick={() => void openLinks()}
        disabled={busy}
        className="inline-flex items-center gap-1 text-[11.5px] font-semibold rounded hover:underline disabled:opacity-50"
        style={{ color: 'var(--v2-primary)' }}
      >
        {loadingLinks ? (
          <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
        ) : (
          <Link2 className="w-3 h-3" aria-hidden="true" />
        )}
        {t('gaps.reply.add_link')}
      </button>

      {/*
        ─────────────────────────────────────────────────────────────────────
        A POPOVER, NOT A PANEL IN THE FLOW.

        In normal flow this list is a child of the toolbar row, so opening it
        made the row as tall as ten services: the formatting buttons were
        shoved sideways and the editor pushed down the page. The owner opened
        a menu and the thing they were writing moved.

        `absolute` takes it out of the flow entirely, so the toolbar keeps its
        height and the editor stays where it was. `start-0` and `top-full` are
        LOGICAL, so it hangs from the start edge — right in Hebrew — with no
        second rule.

        `z-20` clears the card's own stacking, and the scroll cap matters: this
        business has ten bookable services and another could have fifty.
        ─────────────────────────────────────────────────────────────────────
      */}
      {linksOpen && !loadingLinks && (
        <div
          className="absolute top-full start-0 z-20 mt-1 min-w-[220px] max-h-[240px] overflow-y-auto rounded-lg p-1 flex flex-col"
          style={{
            background: 'var(--v2-surface)',
            border: '1px solid var(--v2-border)',
            boxShadow: '0 10px 28px -12px rgba(16,22,42,0.45)',
          }}
        >
          {links && links.length > 0 ? (
            links.map(link => (
              <button
                key={link.url}
                type="button"
                onClick={() =>
                  insertLink(
                    link.url,
                    link.kind === 'generic' ? t('gaps.reply.link_all') : link.label
                  )
                }
                className="text-start px-2 py-1.5 rounded text-[12px] hover:bg-[var(--v2-bg)] transition-colors flex items-center gap-2"
                style={{ color: 'var(--v2-text-primary)', unicodeBidi: 'plaintext' }}
              >
                {/*
                  The generic entry's label is minted server-side as
                  "Everything we offer" — English, because
                  `buildLeadReplyCandidates` also feeds a model prompt and
                  that label is what the model reads. A Hebrew card must
                  not show it, so the one fixed entry is translated here
                  and the owner's own service names pass through untouched.
                */}
                <span className="truncate">
                  {link.kind === 'generic' ? t('gaps.reply.link_all') : link.label}
                </span>
                {/*
                  FREE is worth saying and nothing else is. It is the one
                  fact that changes which link an owner reaches for — a free
                  consultation is the invitation you send a hesitant client
                  — and a price here would be a second place for prices to
                  go stale.
                */}
                {link.isFree && (
                  <span
                    className="text-[10px] font-semibold rounded-full px-1.5 py-0.5 shrink-0"
                    style={{
                      background: 'color-mix(in srgb, var(--v2-primary) 13%, transparent)',
                      color: 'var(--v2-primary)',
                    }}
                  >
                    {t('gaps.reply.link_free')}
                  </span>
                )}
              </button>
            ))
          ) : (
            /* No bookable service and no booking page. Said plainly rather
               than shown as an empty box the owner has to interpret. */
            <p className="px-2 py-1.5 text-[11.5px]" style={{ color: 'var(--v2-text-muted)' }}>
              {t('gaps.reply.no_links')}
            </p>
          )}
        </div>
      )}
    </div>
  );

  if (phase.kind === 'cleared') {
    return (
      <p
        className="flex items-center gap-1.5 text-[12.5px] font-semibold mt-2"
        style={{ color: 'var(--v2-success, #0f9d6e)' }}
      >
        <Check className="w-3.5 h-3.5" aria-hidden="true" />
        {t('gaps.reply.cleared')}
      </p>
    );
  }

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * SENT, AND STILL ON THE CARD.
   *
   * The box collapses — there is nothing more to write — but the row stays,
   * because sending is not the same as finishing. A reply often opens the next
   * question, and this card is the only thing holding the thread in front of
   * the owner.
   *
   * The control that DOES finish it is not here. It sits on the row itself,
   * beside the "open the client" icon, where every other row keeps its action:
   * a button that appears only after sending, inside a box that collapses, is
   * a button in a different place depending on what you last did.
   * ───────────────────────────────────────────────────────────────────────────
   */
  if (phase.kind === 'sent') {
    return (
      <p
        className="flex items-center gap-1.5 text-[12.5px] font-semibold mt-2"
        style={{ color: 'var(--v2-success, #0f9d6e)' }}
      >
        <Check className="w-3.5 h-3.5" aria-hidden="true" />
        {answeredAt
          ? t('gaps.reply.answered').replace('{when}', relativeWhen(answeredAt, language))
          : t('gaps.reply.sent')}
      </p>
    );
  }


  return (
    <div className="mt-2">
      <div
        className="rounded-lg ps-2.5 pe-2.5 py-2 border-s-2"
        style={{
          background: 'var(--v2-bg)',
          borderInlineStartColor: 'color-mix(in srgb, var(--v2-primary) 55%, transparent)',
        }}
      >
        <p
          className="text-[10.5px] font-semibold mb-1 flex items-center gap-1"
          style={{ color: 'var(--v2-text-muted)' }}
        >
          <PenLine className="w-3 h-3" aria-hidden="true" />
          {isSuggestion
            ? t('gaps.reply.suggested_label')
            : hasDraft
              ? t('gaps.reply.draft_label')
              : t('gaps.reply.label')}
        </p>

        <MailReplyEditor
          initialText={draftBody}
          placeholder={t('gaps.reply.placeholder')}
          disabled={busy}
          onInput={noteEdit}
          editorRef={editorRef}
          linkControl={linkControl}
          t={t}
        />

        {hasDraft && (
          /*
            WHAT THE DRAFT IS BASED ON, so the owner can approve it without
            re-reading the thread. The agent is given the services list and
            nothing else — no diary, no prices beyond that list — and saying so
            is what makes a one-glance approval reasonable rather than reckless.
          */
          <p className="text-[11px] mt-1" style={{ color: 'var(--v2-text-muted)' }}>
            {isSuggestion ? t('gaps.reply.suggested_note') : t('gaps.reply.draft_note')}
          </p>
        )}
      </div>

      {phase.kind === 'failed' && (
        <p className="text-[11.5px] mt-1.5" style={{ color: 'var(--v2-warning)' }}>
          {phase.message}
        </p>
      )}

      <div className="flex gap-2 flex-wrap mt-2">
        {canSend && (
          <button
            type="button"
            onClick={send}
            disabled={busy || !hasText}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg ap-primary-lift transition-all hover:brightness-110 active:scale-[0.97] disabled:opacity-50"
            style={{ background: 'var(--v2-primary)', color: '#fff' }}
          >
            <Send className="w-3.5 h-3.5" aria-hidden="true" />
            {phase.kind === 'confirming'
              ? t('gaps.reply.confirm')
              : hasDraft && !isSuggestion
                ? t('gaps.reply.send_draft')
                : t('gaps.reply.send')}
          </button>
        )}

        {phase.kind === 'confirming' && (
          <button
            type="button"
            onClick={() => setPhase({ kind: 'idle' })}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors"
          >
            {t('common.cancel') || 'Cancel'}
          </button>
        )}

        {/*
          Discard is about the DRAFT, so it belongs with the draft. "Mark as
          handled" is about the ROW, and lives on the row — see the note on the
          sent state above.
        */}
        {hasDraft && !isSuggestion && phase.kind !== 'confirming' && (
          <button
            type="button"
            onClick={() => void post('discard')}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
            style={{
              background: 'transparent',
              color: 'var(--v2-text-secondary)',
              border: '1px solid var(--v2-border)',
            }}
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            {t('gaps.reply.discard')}
          </button>
        )}
      </div>
    </div>
  );
}
